import { git, gitDir } from './shadow.js';
import fs from 'node:fs';

function parseCommitMessage(raw) {
  const lines = raw.split('\n');
  const label = lines[0] || '';
  let meta = {};
  const jsonStart = raw.indexOf('{');
  if (jsonStart !== -1) {
    try {
      meta = JSON.parse(raw.slice(jsonStart));
    } catch {
      meta = {};
    }
  }
  return { label, meta };
}

function relativeTime(isoOrUnix) {
  let ms;
  if (typeof isoOrUnix === 'number') ms = isoOrUnix * 1000;
  else ms = Date.parse(isoOrUnix);
  if (!Number.isFinite(ms)) return 'unknown';
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

/**
 * List all snapshot refs, newest first.
 * Uses `git for-each-ref` so packed refs (after gc) are still found.
 */
export function listSnapshots(root, opts = {}) {
  if (!fs.existsSync(gitDir(root))) {
    return [];
  }

  const listed = git(root, [
    'for-each-ref',
    '--format=%(refname)%09%(objectname)%09%(creatordate:unix)',
    'refs/snaps',
  ]);
  if (!listed.ok || !listed.stdout.trim()) {
    return [];
  }

  const snaps = [];
  for (const line of listed.stdout.split('\n').filter(Boolean)) {
    const [ref, commit, createdUnix] = line.split('\t');
    if (!ref || !commit) continue;
    const name = ref.replace(/^refs\/snaps\//, '');
    const msgR = git(root, ['log', '-1', '--format=%B', commit]);
    const { label, meta } = parseCommitMessage(msgR.stdout || '');
    const unix =
      Number(createdUnix) ||
      (meta.time ? Math.floor(Date.parse(meta.time) / 1000) : 0);
    snaps.push({
      id: name,
      ref,
      commit,
      label,
      meta,
      unix,
      time: meta.time || (unix ? new Date(unix * 1000).toISOString() : ''),
    });
  }

  snaps.sort((a, b) => b.unix - a.unix || b.id.localeCompare(a.id));

  if (opts.raw) return snaps;

  return snaps.map((s, i) => {
    let filesChanged = 0;
    if (i < snaps.length - 1) {
      const prev = snaps[i + 1];
      const diff = git(root, [
        'diff',
        '--name-only',
        prev.commit,
        s.commit,
      ]);
      if (diff.ok && diff.stdout) {
        filesChanged = diff.stdout.split('\n').filter(Boolean).length;
      }
    } else {
      const diff = git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', s.commit]);
      if (diff.ok && diff.stdout) {
        filesChanged = diff.stdout.split('\n').filter(Boolean).length;
      }
    }
    return {
      number: i + 1,
      ...s,
      relative: relativeTime(s.unix || s.time),
      filesChanged,
    };
  });
}

export function resolveSnapshot(root, selector) {
  const snaps = listSnapshots(root, { raw: true });
  if (!snaps.length) return null;
  if (selector == null || selector === '' || selector === '1') {
    return { ...snaps[0], number: 1 };
  }
  const asNum = Number(selector);
  if (Number.isInteger(asNum) && asNum >= 1) {
    const s = snaps[asNum - 1];
    return s ? { ...s, number: asNum } : null;
  }
  const byId = snaps.find(
    (s) => s.id === selector || s.id.startsWith(String(selector)) || s.ref === selector,
  );
  if (byId) {
    return { ...byId, number: snaps.indexOf(byId) + 1 };
  }
  return null;
}

export function formatList(snaps) {
  if (!snaps.length) return 'No snapshots yet. Run: ctrl-z snap';
  const lines = snaps.map(
    (s) =>
      `${String(s.number).padStart(3)}.  ${s.relative.padEnd(12)}  ${s.filesChanged} files  ${s.label}`,
  );
  return lines.join('\n');
}

/**
 * Diff working tree vs snapshot (default: latest).
 */
export function diffSnapshot(root, selector) {
  const snap = resolveSnapshot(root, selector ?? '1');
  if (!snap) return { ok: false, error: 'No matching snapshot' };
  // Stage current state into index for a meaningful diff against commit
  git(root, ['add', '-A']);
  const r = git(root, ['diff', '--stat', snap.commit]);
  const names = git(root, ['diff', '--name-status', snap.commit]);
  return {
    ok: true,
    snap,
    stat: r.stdout || '(no differences)',
    names: names.stdout || '',
  };
}
