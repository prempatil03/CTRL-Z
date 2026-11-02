import fs from 'node:fs';
import path from 'node:path';
import { git } from './shadow.js';
import { loadConfig, storagePath } from './config.js';
import { listSnapshots } from './list.js';

export function dirSizeBytes(dir) {
  let total = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(dir);
  return total;
}

function deleteRef(root, ref) {
  git(root, ['update-ref', '-d', ref]);
}

/**
 * Keep last keepCount OR keepDays (whichever retains more), delete the rest, gc.
 */
export function prune(root, opts = {}) {
  const cfg = loadConfig(root);
  const keepCount = opts.keepCount ?? cfg.keepCount;
  const keepDays = opts.keepDays ?? cfg.keepDays;
  const snaps = listSnapshots(root, { raw: true });
  if (!snaps.length) {
    return { deleted: 0, kept: 0 };
  }

  // Keep the newest `keepCount`, plus anything within `keepDays` (union).
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const keepSet = new Set();
  for (const s of snaps.slice(0, Math.max(0, keepCount))) {
    keepSet.add(s.ref);
  }
  if (keepDays > 0) {
    for (const s of snaps) {
      if (s.unix * 1000 >= cutoff) keepSet.add(s.ref);
    }
  }
  let deleted = 0;
  for (const s of snaps) {
    if (!keepSet.has(s.ref)) {
      deleteRef(root, s.ref);
      deleted++;
    }
  }
  git(root, ['gc', '--prune=now']);
  return { deleted, kept: snaps.length - deleted };
}

/**
 * Delete oldest snapshots until storage under limitBytes.
 */
export function pruneToDiskLimit(root, limitBytes) {
  let snaps = listSnapshots(root, { raw: true });
  let deleted = 0;
  while (snaps.length > 1 && dirSizeBytes(storagePath(root)) > limitBytes) {
    const oldest = snaps[snaps.length - 1];
    deleteRef(root, oldest.ref);
    deleted++;
    snaps = snaps.slice(0, -1);
  }
  git(root, ['gc', '--prune=now']);
  return { deleted };
}
