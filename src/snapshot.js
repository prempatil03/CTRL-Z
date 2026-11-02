import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { git, ensureInit } from './shadow.js';
import {
  loadConfig,
  isDisabled,
  storagePath,
  FIRST_SNAP_FLAG,
} from './config.js';
import { withLock } from './lock.js';
import { listSnapshots } from './list.js';
import { dirSizeBytes, pruneToDiskLimit } from './prune.js';

function randomId() {
  return crypto.randomBytes(3).toString('hex');
}

function snapRefName() {
  return `refs/snaps/${Date.now()}-${randomId()}`;
}

/**
 * Find tracked-candidate files over maxFileBytes and exclude them via
 * .git/info/exclude append for this add (we use pathspec excludes via
 * temporary skip-worktree isn't ideal; instead write large paths into
 * a local exclude supplement used only during add).
 */
function excludeOversized(root, maxBytes) {
  const skipped = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (
        rel === '.ctrl-z' ||
        rel.startsWith('.ctrl-z/') ||
        rel === '.git' ||
        rel.startsWith('.git/') ||
        rel === 'node_modules' ||
        rel.startsWith('node_modules/')
      ) {
        continue;
      }
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile()) {
        try {
          const st = fs.statSync(full);
          if (st.size > maxBytes) skipped.push(rel);
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(root);
  return skipped;
}

function writeLargeExcludes(root, largeFiles) {
  const excludePath = path.join(
    storagePath(root, 'repo.git'),
    'info',
    'exclude',
  );
  let base = '';
  try {
    base = fs.readFileSync(excludePath, 'utf8');
  } catch {
    base = '';
  }
  // Strip previous dynamic large-file block
  const markerStart = '# --- ctrl-z large files ---';
  const markerEnd = '# --- end ctrl-z large files ---';
  const start = base.indexOf(markerStart);
  const end = base.indexOf(markerEnd);
  if (start !== -1 && end !== -1) {
    base = base.slice(0, start) + base.slice(end + markerEnd.length);
  }
  const block = [
    markerStart,
    ...largeFiles.map((f) => f),
    markerEnd,
    '',
  ].join('\n');
  fs.writeFileSync(excludePath, base.trimEnd() + '\n' + block);
}

/**
 * Create a snapshot. Returns { skipped, id, ref, label, skippedFiles }.
 */
export function snapshot(root, options = {}) {
  const {
    label = 'manual snapshot',
    tool = 'manual',
    file = '',
    session = '',
    meta = {},
    force = false,
  } = options;

  if (isDisabled(root)) {
    return { skipped: true, reason: 'disabled', label };
  }

  return withLock(root, () => {
    ensureInit(root);
    const cfg = loadConfig(root);
    const t0 = Date.now();

    const large = excludeOversized(root, cfg.maxFileBytes);
    writeLargeExcludes(root, large);

    const add = git(root, ['add', '-A']);
    if (!add.ok && add.stderr && !add.stderr.includes('pathspec')) {
      // soft-fail: continue; empty trees are ok
    }

    const treeR = git(root, ['write-tree']);
    if (!treeR.ok) {
      throw new Error(`write-tree failed: ${treeR.stderr || treeR.stdout}`);
    }
    const tree = treeR.stdout.trim();

    const mustKeep = force === true || label === 'before undo';

    const snaps = listSnapshots(root, { raw: true });
    if (!mustKeep && snaps.length > 0) {
      const newest = snaps[0];
      const prevTree = git(root, ['rev-parse', `${newest.commit}^{tree}`]);
      if (prevTree.ok && prevTree.stdout.trim() === tree) {
        return {
          skipped: true,
          reason: 'unchanged',
          label,
          id: newest.id,
          ref: newest.ref,
          skippedFiles: large.length,
        };
      }
    }

    const body = JSON.stringify({
      tool,
      file,
      session,
      time: new Date().toISOString(),
      ...meta,
    });
    const message = `${label}\n\n${body}`;

    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 'Ctrl+Z',
      GIT_AUTHOR_EMAIL: 'ctrl-z@local',
      GIT_COMMITTER_NAME: 'Ctrl+Z',
      GIT_COMMITTER_EMAIL: 'ctrl-z@local',
    };

    const commitR = git(root, ['commit-tree', tree, '-m', message], { env });
    if (!commitR.ok) {
      throw new Error(`commit-tree failed: ${commitR.stderr || commitR.stdout}`);
    }
    const commit = commitR.stdout.trim();
    const ref = snapRefName();
    const update = git(root, ['update-ref', ref, commit]);
    if (!update.ok) {
      throw new Error(`update-ref failed: ${update.stderr}`);
    }

    const elapsed = Date.now() - t0;
    const firstFlag = storagePath(root, FIRST_SNAP_FLAG);
    if (elapsed > cfg.slowSnapshotMs && !fs.existsSync(firstFlag)) {
      console.error(
        `Ctrl+Z: first snapshot took ${(elapsed / 1000).toFixed(1)}s — later ones are usually faster.`,
      );
      try {
        fs.writeFileSync(firstFlag, String(elapsed));
      } catch {
        /* ignore */
      }
    }

    // Disk guard
    try {
      const size = dirSizeBytes(storagePath(root));
      if (size > cfg.maxStorageBytes) {
        console.error(
          `Ctrl+Z: storage exceeds ${(cfg.maxStorageBytes / 1024 / 1024).toFixed(0)} MB — pruning aggressively.`,
        );
        pruneToDiskLimit(root, Math.floor(cfg.maxStorageBytes * 0.7));
      }
    } catch {
      /* ignore */
    }

    const id = ref.replace('refs/snaps/', '');
    return {
      skipped: false,
      id,
      ref,
      commit,
      label,
      skippedFiles: large.length,
      elapsedMs: elapsed,
    };
  });
}
