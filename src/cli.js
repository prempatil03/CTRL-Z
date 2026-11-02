#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  VERSION,
  PRODUCT_NAME,
  STORAGE_DIR,
  setDisabled,
  isDisabled,
  storagePath,
  loadConfig,
} from './config.js';
import { findProjectRoot, ensureInit, gitDir } from './shadow.js';
import { snapshot } from './snapshot.js';
import { listSnapshots, formatList, diffSnapshot, resolveSnapshot } from './list.js';
import { restore, redo, planRestore } from './restore.js';
import { prune, dirSizeBytes } from './prune.js';

function printHelp() {
  console.log(`${PRODUCT_NAME} v${VERSION}

Usage: ctrl-z <command> [args]

Commands:
  snap [-m <label>]     Take a snapshot of the project
  list                  List snapshots (newest first)
  restore [n]           Restore snapshot n (default: 1 = newest)
  diff [n]              Diff working tree vs snapshot n
  redo                  Undo the last undo
  status                Show status and disk use
  prune                 Apply retention and garbage-collect
  off                   Disable automatic / CLI snapshots
  on                    Re-enable snapshots
  reset                 Delete .ctrl-z/ entirely
  init                  Initialize shadow storage in this project
  version               Print version
  help                  Show this help

Flags:
  --dry-run             With restore: show what would change
  --yes, -y             Skip confirmation prompts
  -m, --message <msg>   Label for snap
  --cwd <dir>           Project directory (default: cwd)
`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {
    dryRun: false,
    yes: false,
    message: null,
    cwd: null,
  };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--yes' || a === '-y') flags.yes = true;
    else if (a === '-m' || a === '--message') flags.message = args[++i];
    else if (a === '--cwd') flags.cwd = args[++i];
    else if (a.startsWith('-m=')) flags.message = a.slice(3);
    else positional.push(a);
  }
  return { cmd: positional[0] || 'help', positional: positional.slice(1), flags };
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const { cmd, positional, flags } = parseArgs(process.argv);
  const startDir = flags.cwd ? path.resolve(flags.cwd) : process.cwd();
  const root = findProjectRoot(startDir);

  try {
    switch (cmd) {
      case 'version':
      case '-v':
      case '--version': {
        console.log(VERSION);
        break;
      }
      case 'help':
      case '-h':
      case '--help': {
        printHelp();
        break;
      }
      case 'init': {
        ensureInit(root);
        console.log(`Initialized ${STORAGE_DIR}/ in ${root}`);
        break;
      }
      case 'snap': {
        const label =
          flags.message ||
          positional.join(' ') ||
          'manual snapshot';
        const result = snapshot(root, { label, tool: 'cli' });
        if (result.skipped) {
          console.log(
            result.reason === 'disabled'
              ? 'Ctrl+Z is off. Run: ctrl-z on'
              : `No changes since last snapshot (skipped).`,
          );
        } else {
          console.log(`Snapshot saved: "${result.label}" (${result.id})`);
          if (result.skippedFiles) {
            console.log(`  Skipped ${result.skippedFiles} file(s) over size limit.`);
          }
        }
        break;
      }
      case 'list': {
        ensureInit(root);
        const snaps = listSnapshots(root);
        console.log(formatList(snaps));
        break;
      }
      case 'restore': {
        const selector = positional[0] || '1';
        if (flags.dryRun) {
          const plan = planRestore(root, selector);
          if (!plan.ok) {
            console.error(plan.error);
            process.exitCode = 1;
            break;
          }
          console.log(`Dry run — would restore to: "${plan.snap.label}"`);
          console.log(`  Files in snapshot: ${plan.toRestore.length}`);
          console.log(`  Files to remove:   ${plan.toRemove.length}`);
          if (plan.toRemove.length) {
            for (const f of plan.toRemove.slice(0, 50)) console.log(`    - ${f}`);
            if (plan.toRemove.length > 50) {
              console.log(`    ... and ${plan.toRemove.length - 50} more`);
            }
          }
          break;
        }
        const result = await restore(root, selector, {
          yes: flags.yes,
          dryRun: false,
        });
        if (result.cancelled) {
          console.log('Cancelled.');
          break;
        }
        if (!result.ok) {
          console.error(result.error || 'Restore failed');
          process.exitCode = 1;
          break;
        }
        console.log(`Restored project to: "${result.label}"`);
        console.log(`  - ${result.restored} files restored`);
        console.log(`  - ${result.removed.length} file(s) removed`);
        break;
      }
      case 'diff': {
        ensureInit(root);
        const d = diffSnapshot(root, positional[0]);
        if (!d.ok) {
          console.error(d.error);
          process.exitCode = 1;
          break;
        }
        console.log(`Diff vs "${d.snap.label}" (${d.snap.id}):`);
        console.log(d.stat);
        if (d.names) console.log(d.names);
        break;
      }
      case 'redo': {
        const result = await redo(root, { yes: true });
        if (!result.ok) {
          console.error(result.error || 'Redo failed');
          process.exitCode = 1;
          break;
        }
        console.log(`Redo: restored to "${result.label}"`);
        console.log(`  - ${result.restored} files restored`);
        console.log(`  - ${result.removed.length} file(s) removed`);
        break;
      }
      case 'status': {
        const exists = fs.existsSync(gitDir(root));
        const disabled = isDisabled(root);
        let count = 0;
        let disk = 0;
        if (exists) {
          ensureInit(root);
          count = listSnapshots(root, { raw: true }).length;
          disk = dirSizeBytes(storagePath(root));
        }
        const cfg = loadConfig(root);
        console.log(`${PRODUCT_NAME} v${VERSION}`);
        console.log(`  Root:     ${root}`);
        console.log(`  Active:   ${exists && !disabled ? 'yes' : disabled ? 'off' : 'not initialized'}`);
        console.log(`  Snaps:    ${count}`);
        console.log(`  Disk:     ${formatBytes(disk)} (limit ${formatBytes(cfg.maxStorageBytes)})`);
        console.log(`  Storage:  ${path.join(root, STORAGE_DIR)}`);
        break;
      }
      case 'prune':
      case 'clean': {
        ensureInit(root);
        const r = prune(root);
        console.log(`Pruned ${r.deleted} snapshot(s), kept ${r.kept}.`);
        break;
      }
      case 'off': {
        ensureInit(root);
        setDisabled(root, true);
        console.log('Ctrl+Z snapshots disabled. Run ctrl-z on to re-enable.');
        break;
      }
      case 'on': {
        ensureInit(root);
        setDisabled(root, false);
        console.log('Ctrl+Z snapshots enabled.');
        break;
      }
      case 'reset': {
        const dir = storagePath(root);
        if (!fs.existsSync(dir)) {
          console.log('Nothing to reset.');
          break;
        }
        if (!flags.yes) {
          console.error('This deletes all snapshots. Re-run with --yes to confirm.');
          process.exitCode = 1;
          break;
        }
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`Deleted ${dir}`);
        break;
      }
      default: {
        console.error(`Unknown command: ${cmd}`);
        printHelp();
        process.exitCode = 1;
      }
    }
  } catch (err) {
    console.error(`Error: ${err.message || err}`);
    process.exitCode = 1;
  }
}

main();
