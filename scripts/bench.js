#!/usr/bin/env node
/**
 * Benchmark Ctrl+Z snapshot/restore on synthetic trees.
 * Prints a markdown table with measured numbers only.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ensureInit } from '../src/shadow.js';
import { snapshot } from '../src/snapshot.js';
import { restore } from '../src/restore.js';
import { listSnapshots } from '../src/list.js';
import { dirSizeBytes } from '../src/prune.js';
import { storagePath } from '../src/config.js';

function hrtimeMs() {
  const [s, n] = process.hrtime();
  return s * 1000 + n / 1e6;
}

function makeTree(root, fileCount) {
  fs.mkdirSync(root, { recursive: true });
  const perDir = 50;
  let n = 0;
  let dirIdx = 0;
  while (n < fileCount) {
    const dir = path.join(root, `d${dirIdx}`);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < perDir && n < fileCount; i++, n++) {
      fs.writeFileSync(
        path.join(dir, `f${i}.txt`),
        `content-${n}-${'x'.repeat(64)}\n`,
      );
    }
    dirIdx++;
  }
}

async function benchSize(fileCount) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ctrlz-bench-${fileCount}-`));
  try {
    makeTree(root, fileCount);
    ensureInit(root);

    let t0 = hrtimeMs();
    const first = snapshot(root, { label: 'first' });
    const firstMs = hrtimeMs() - t0;

    t0 = hrtimeMs();
    snapshot(root, { label: 'noop' });
    const noopMs = hrtimeMs() - t0;

    fs.writeFileSync(path.join(root, 'd0', 'f0.txt'), `changed-${Date.now()}\n`);
    t0 = hrtimeMs();
    snapshot(root, { label: 'one-file' });
    const oneMs = hrtimeMs() - t0;

    const snaps = listSnapshots(root, { raw: true });
    const target = snaps.find((s) => s.label === 'first') || snaps[snaps.length - 1];
    t0 = hrtimeMs();
    await restore(root, target.id, { yes: true });
    const restoreMs = hrtimeMs() - t0;

    const disk = dirSizeBytes(storagePath(root));

    return {
      fileCount,
      firstMs,
      noopMs,
      oneMs,
      restoreMs,
      disk,
      ok: !first.skipped,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function fmtMs(n) {
  if (n < 1000) return `${n.toFixed(0)} ms`;
  return `${(n / 1000).toFixed(2)} s`;
}

function fmtBytes(n) {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const sizes = process.argv.includes('--quick')
  ? [100]
  : [100, 2000, 20000];

const results = [];
for (const n of sizes) {
  process.stderr.write(`Benchmarking ${n} files...\n`);
  results.push(await benchSize(n));
}

console.log('| Project size | First snapshot | No-change snapshot | One-file change | Restore | Disk used |');
console.log('|---|---|---|---|---|---|');
for (const r of results) {
  console.log(
    `| ${r.fileCount.toLocaleString()} files | ${fmtMs(r.firstMs)} | ${fmtMs(r.noopMs)} | ${fmtMs(r.oneMs)} | ${fmtMs(r.restoreMs)} | ${fmtBytes(r.disk)} |`,
  );
}
