import fs from 'node:fs';
import { storagePath, LOCK_FILE, loadConfig } from './config.js';

/** Roots held by this process (re-entrant). */
const held = new Set();

/**
 * Acquire a simple lock file with stale-timeout recovery.
 * Re-entrant for the same process+root.
 */
export function withLock(root, fn) {
  const key = storagePath(root);
  if (held.has(key)) {
    return fn();
  }

  const cfg = loadConfig(root);
  const lockPath = storagePath(root, LOCK_FILE);
  fs.mkdirSync(storagePath(root), { recursive: true });

  const started = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, `${process.pid}\n${Date.now()}\n`);
      fs.closeSync(fd);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let stale = false;
      try {
        const raw = fs.readFileSync(lockPath, 'utf8');
        const lines = raw.split('\n');
        const ts = Number(lines[1] || 0);
        if (!ts || Date.now() - ts > cfg.lockTimeoutMs) stale = true;
      } catch {
        stale = true;
      }
      if (stale) {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
        continue;
      }
      if (Date.now() - started > cfg.lockTimeoutMs) {
        throw new Error('Could not acquire Ctrl+Z lock (timeout)');
      }
      const waitUntil = Date.now() + 50;
      while (Date.now() < waitUntil) {
        /* spin */
      }
    }
  }

  held.add(key);
  try {
    return fn();
  } finally {
    held.delete(key);
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  }
}
