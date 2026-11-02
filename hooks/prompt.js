#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit hook — snapshot at turn start.
 * Must never crash or block the agent: always exit 0.
 */
import { findProjectRoot } from '../src/shadow.js';
import { snapshot } from '../src/snapshot.js';

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(chunks.join('')));
    process.stdin.on('error', () => resolve(''));
    setTimeout(() => resolve(chunks.join('')), 2000);
  });
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

    const prompt = String(
      payload.prompt || payload.text || payload.message || '',
    );
    const cwd =
      payload.cwd ||
      payload.working_directory ||
      payload.workingDirectory ||
      process.cwd();
    const session = payload.session_id || payload.sessionId || '';
    const snippet = prompt.replace(/\s+/g, ' ').trim().slice(0, 40);
    const label = snippet ? `turn start: ${snippet}` : 'turn start';

    const root = findProjectRoot(cwd);
    const t0 = Date.now();
    snapshot(root, { label, tool: 'prompt', session });
    if (Date.now() - t0 > 1000) {
      console.error('Ctrl+Z: snapshot took longer than 1s (continuing)');
    }
  } catch (err) {
    console.error(`Ctrl+Z hook warning: ${err?.message || err}`);
  }
  process.exit(0);
}

main();
