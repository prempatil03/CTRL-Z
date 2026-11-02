import fs from 'node:fs';
import path from 'node:path';

export const VERSION = '0.1.0';
export const PRODUCT_NAME = 'Ctrl+Z';
export const STORAGE_DIR = '.ctrl-z';
export const REPO_DIR = 'repo.git';
export const LOCK_FILE = 'lock';
export const DISABLED_FLAG = 'disabled';
export const FIRST_SNAP_FLAG = 'first-snap-warned';

export const DEFAULTS = {
  maxFileBytes: 5 * 1024 * 1024, // 5 MB
  keepCount: 50,
  keepDays: 7,
  maxStorageBytes: 500 * 1024 * 1024, // 500 MB
  lockTimeoutMs: 10_000,
  slowSnapshotMs: 3000,
  excludePatterns: [
    '.ctrl-z/',
    '.git/',
    'node_modules/',
    'dist/',
    'build/',
    '.next/',
    '__pycache__/',
    '*.log',
    '.env',
    '.env.*',
    '*.pem',
    '*.key',
  ],
};

/**
 * Load user config from .ctrl-z/config.json merged over defaults.
 */
export function loadConfig(root) {
  const cfgPath = path.join(root, STORAGE_DIR, 'config.json');
  let user = {};
  try {
    if (fs.existsSync(cfgPath)) {
      user = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    }
  } catch {
    user = {};
  }
  return {
    ...DEFAULTS,
    ...user,
    excludePatterns: user.excludePatterns ?? DEFAULTS.excludePatterns,
  };
}

export function storagePath(root, ...parts) {
  return path.join(root, STORAGE_DIR, ...parts);
}

export function isDisabled(root) {
  return fs.existsSync(storagePath(root, DISABLED_FLAG));
}

export function setDisabled(root, disabled) {
  const flag = storagePath(root, DISABLED_FLAG);
  fs.mkdirSync(path.dirname(flag), { recursive: true });
  if (disabled) {
    fs.writeFileSync(flag, '1\n');
  } else if (fs.existsSync(flag)) {
    fs.unlinkSync(flag);
  }
}
