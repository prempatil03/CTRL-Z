import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { git, ensureInit } from './shadow.js';
import { withLock } from './lock.js';
import { snapshot } from './snapshot.js';
import { resolveSnapshot, listSnapshots } from './list.js';

function askConfirm(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.resolve(true);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(String(answer).trim()));
    });
  });
}

function removeEmptyDirs(root, fromDir) {
  let entries;
  try {
    entries = fs.readdirSync(fromDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const full = path.join(fromDir, ent.name);
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (rel === '.ctrl-z' || rel === '.git' || rel.startsWith('.ctrl-z') || rel.startsWith('.git')) {
      continue;
    }
    removeEmptyDirs(root, full);
    try {
      const left = fs.readdirSync(full);
      if (left.length === 0) fs.rmdirSync(full);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Compute what restore would do.
 */
export function planRestore(root, selector) {
  ensureInit(root);
  const snap = resolveSnapshot(root, selector);
  if (!snap) return { ok: false, error: 'No matching snapshot' };

  git(root, ['add', '-A']);
  const onDisk = git(root, ['ls-files', '-co', '--exclude-standard']);
  const diskFiles = new Set(
    (onDisk.stdout || '').split('\n').filter(Boolean).map((f) => f.replace(/\\/g, '/')),
  );
  const inSnap = git(root, ['ls-tree', '-r', '--name-only', snap.commit]);
  const snapFiles = new Set(
    (inSnap.stdout || '').split('\n').filter(Boolean).map((f) => f.replace(/\\/g, '/')),
  );

  const toRemove = [...diskFiles].filter((f) => !snapFiles.has(f));
  const toRestore = [...snapFiles];
  return { ok: true, snap, toRemove, toRestore, snapFiles, diskFiles };
}

/**
 * Restore working tree to a snapshot.
 */
export async function restore(root, selector, options = {}) {
  const { dryRun = false, yes = false, skipSafety = false } = options;

  const plan = planRestore(root, selector);
  if (!plan.ok) return plan;

  const { snap, toRemove, toRestore } = plan;

  if (!yes && !dryRun) {
    const snaps = listSnapshots(root, { raw: true });
    const idx = snaps.findIndex((s) => s.ref === snap.ref);
    if (idx > 0) {
      const ok = await askConfirm(
        `Restore ${idx + 1} steps back to "${snap.label}"? [y/N] `,
      );
      if (!ok) return { ok: false, cancelled: true };
    }
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      snap,
      wouldRestore: toRestore.length,
      wouldRemove: toRemove,
      label: snap.label,
    };
  }

  return withLock(root, () => {
    if (!skipSafety) {
      snapshot(root, {
        label: 'before undo',
        tool: 'undo',
        meta: { target: snap.id },
      });
    }

    // Restore tracked content without touching line endings conversion
    const read = git(root, ['read-tree', snap.commit]);
    if (!read.ok) {
      throw new Error(`read-tree failed: ${read.stderr}`);
    }
    const checkout = git(root, ['checkout-index', '-a', '-f']);
    if (!checkout.ok) {
      throw new Error(`checkout-index failed: ${checkout.stderr}`);
    }

    // Recompute extras after checkout
    git(root, ['add', '-A']);
    const onDisk = git(root, ['ls-files', '-co', '--exclude-standard']);
    const diskFiles = new Set(
      (onDisk.stdout || '')
        .split('\n')
        .filter(Boolean)
        .map((f) => f.replace(/\\/g, '/')),
    );
    const inSnap = git(root, ['ls-tree', '-r', '--name-only', snap.commit]);
    const snapFiles = new Set(
      (inSnap.stdout || '')
        .split('\n')
        .filter(Boolean)
        .map((f) => f.replace(/\\/g, '/')),
    );

    const removed = [];
    for (const f of diskFiles) {
      if (snapFiles.has(f)) continue;
      if (f.startsWith('.ctrl-z/') || f === '.ctrl-z') continue;
      const full = path.join(root, f);
      try {
        if (fs.existsSync(full)) {
          fs.unlinkSync(full);
          removed.push(f);
        }
      } catch {
        /* ignore */
      }
    }

    removeEmptyDirs(root, root);

    // Reset index to match snapshot cleanly
    git(root, ['read-tree', snap.commit]);

    return {
      ok: true,
      snap,
      restored: snapFiles.size,
      removed,
      label: snap.label,
      id: snap.id,
    };
  });
}

/**
 * Redo: restore newest snapshot labeled "before undo".
 */
export async function redo(root, options = {}) {
  const snaps = listSnapshots(root, { raw: true });
  const target = snaps.find((s) => s.label === 'before undo');
  if (!target) {
    return { ok: false, error: 'Nothing to redo (no "before undo" snapshot)' };
  }
  return restore(root, target.id, { ...options, yes: true });
}
