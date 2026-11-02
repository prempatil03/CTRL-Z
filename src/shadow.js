import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  STORAGE_DIR,
  REPO_DIR,
  loadConfig,
  storagePath,
} from './config.js';

/**
 * Walk up from startDir to find nearest .git; else use startDir.
 */
export function findProjectRoot(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

export function gitDir(root) {
  return storagePath(root, REPO_DIR);
}

export function workTree(root) {
  return root;
}

/**
 * Run git against the shadow repo. Returns { ok, stdout, stderr, status }.
 */
export function git(root, args, opts = {}) {
  const gd = gitDir(root);
  const wt = workTree(root);
  const result = spawnSync(
    'git',
    ['--git-dir', gd, '--work-tree', wt, ...args],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      ...opts,
    },
  );
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: (result.stdout || '').trimEnd(),
    stderr: (result.stderr || '').trimEnd(),
    error: result.error,
  };
}

/**
 * Check whether the shadow repo looks healthy.
 */
export function isRepoHealthy(root) {
  if (!fs.existsSync(gitDir(root))) return false;
  const r = git(root, ['rev-parse', '--git-dir']);
  return r.ok;
}

/**
 * If broken, rename to repo.git.broken[.n] and return true if recovered.
 */
export function recoverBrokenRepo(root) {
  const gd = gitDir(root);
  if (!fs.existsSync(gd)) return false;
  if (isRepoHealthy(root)) return false;

  let dest = storagePath(root, `${REPO_DIR}.broken`);
  let n = 1;
  while (fs.existsSync(dest)) {
    dest = storagePath(root, `${REPO_DIR}.broken.${n++}`);
  }
  fs.renameSync(gd, dest);
  return true;
}

/**
 * Create shadow repo if missing. Writes info/exclude with built-in ignores.
 */
export function init(root) {
  fs.mkdirSync(storagePath(root), { recursive: true });

  if (fs.existsSync(gitDir(root)) && !isRepoHealthy(root)) {
    recoverBrokenRepo(root);
  }

  if (!fs.existsSync(gitDir(root))) {
    const r = spawnSync('git', ['init', '--bare', gitDir(root)], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (r.status !== 0) {
      throw new Error(
        `Failed to init shadow repo: ${(r.stderr || r.stdout || '').trim()}`,
      );
    }
  }

  // Line endings: do not convert on checkout (preserve CRLF/LF as stored)
  git(root, ['config', 'core.autocrlf', 'false']);
  git(root, ['config', 'core.symlinks', 'false']);

  const cfg = loadConfig(root);
  const excludePath = path.join(gitDir(root), 'info', 'exclude');
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  const lines = [
    '# Ctrl+Z built-in excludes — do not push this repo anywhere',
    ...cfg.excludePatterns,
    '',
  ];
  fs.writeFileSync(excludePath, lines.join('\n'));

  // Ensure never remotes (local only)
  const remotes = git(root, ['remote']);
  if (remotes.ok && remotes.stdout) {
    for (const name of remotes.stdout.split('\n').filter(Boolean)) {
      git(root, ['remote', 'remove', name]);
    }
  }

  return { root, gitDir: gitDir(root) };
}

export function ensureInit(root) {
  return init(root);
}

export { STORAGE_DIR };
