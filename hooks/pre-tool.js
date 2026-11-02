#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook — snapshot before destructive tools.
 * Must never crash or block the agent: always exit 0.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findProjectRoot } from '../src/shadow.js';
import { snapshot } from '../src/snapshot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(chunks.join('')));
    process.stdin.on('error', () => resolve(''));
    // If no stdin piped, don't hang forever
    setTimeout(() => resolve(chunks.join('')), 2000);
  });
}

function labelFrom(tool, input) {
  const file =
    input?.file_path ||
    input?.filePath ||
    input?.path ||
    input?.notebook_path ||
    '';
  const short = file ? path.basename(String(file)) : '';
  if (short) return `${tool} ${short}`;
  if (tool === 'Bash') {
    const cmd = String(input?.command || '').slice(0, 40);
    return cmd ? `Bash ${cmd}` : 'Bash';
  }
  return String(tool || 'tool');
}

async function main() {
  try {
    const raw = await readStdin();
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = {};
    }

    const tool = payload.tool_name || payload.toolName || 'tool';
    const input = payload.tool_input || payload.toolInput || payload.input || {};
    const cwd =
      payload.cwd ||
      payload.working_directory ||
      payload.workingDirectory ||
      process.cwd();
    const session = payload.session_id || payload.sessionId || '';

    const root = findProjectRoot(cwd);
    const label = labelFrom(tool, input);
    const t0 = Date.now();
    snapshot(root, {
      label,
      tool,
      file: input?.file_path || input?.filePath || '',
      session,
    });
    if (Date.now() - t0 > 1000) {
      console.error('Ctrl+Z: snapshot took longer than 1s (continuing)');
    }
  } catch (err) {
    console.error(`Ctrl+Z hook warning: ${err?.message || err}`);
  }
  process.exit(0);
}

main();
