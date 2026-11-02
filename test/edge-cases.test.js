import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { snapshot } from '../src/snapshot.js';
import { restore, planRestore } from '../src/restore.js';
import { ensureInit, git, recoverBrokenRepo, isRepoHealthy, gitDir } from '../src/shadow.js';
import { withLock } from '../src/lock.js';
import {
  setDisabled,
  isDisabled,
  storagePath,
  loadConfig,
} from '../src/config.js';
import { prune, dirSizeBytes } from '../src/prune.js';
import { listSnapshots } from '../src/list.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctrlz-edge-'));
}

describe('edge cases', () => {
  let root;

  beforeEach(() => {
    root = tmpDir();
    fs.writeFileSync(path.join(root, 'f.txt'), 'hello');
    ensureInit(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('concurrency: nested locks do not deadlock', () => {
    const out = withLock(root, () =>
      withLock(root, () => {
        snapshot(root, { label: 'nested' });
        return 'ok';
      }),
    );
    assert.equal(out, 'ok');
    assert.ok(listSnapshots(root, { raw: true }).length >= 1);
  });

  it('secrets: .env is ignored by default', () => {
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=1');
    snapshot(root, { label: 'with env' });
    const tree = git(root, ['ls-tree', '-r', '--name-only', 'HEAD']);
    // HEAD may not exist on bare; use newest snap
    const snaps = listSnapshots(root, { raw: true });
    const names = git(root, [
      'ls-tree',
      '-r',
      '--name-only',
      snaps[0].commit,
    ]);
    assert.ok(!names.stdout.split('\n').includes('.env'));
  });

  it('dry-run restore shows plan without changing', async () => {
    snapshot(root, { label: 'base' });
    fs.writeFileSync(path.join(root, 'f.txt'), 'changed');
    snapshot(root, { label: 'changed' });
    const plan = planRestore(root, '2');
    assert.equal(plan.ok, true);
    const r = await restore(root, '2', { dryRun: true, yes: true });
    assert.equal(r.dryRun, true);
    assert.equal(fs.readFileSync(path.join(root, 'f.txt'), 'utf8'), 'changed');
  });

  it('off disables snapshots', () => {
    setDisabled(root, true);
    assert.equal(isDisabled(root), true);
    const r = snapshot(root, { label: 'nope' });
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'disabled');
    setDisabled(root, false);
  });

  it('corruption: broken repo is renamed and re-inited', () => {
    snapshot(root, { label: 'ok' });
    const gd = gitDir(root);
    // Corrupt HEAD
    fs.writeFileSync(path.join(gd, 'HEAD'), 'garbage');
    // Also trash objects marker
    assert.equal(isRepoHealthy(root), false);
    const recovered = recoverBrokenRepo(root);
    assert.equal(recovered, true);
    ensureInit(root);
    assert.equal(isRepoHealthy(root), true);
    const r = snapshot(root, { label: 'fresh' });
    assert.equal(r.skipped, false);
  });

  it('line endings: content restored byte-for-byte', async () => {
    const crlf = 'line1\r\nline2\r\n';
    fs.writeFileSync(path.join(root, 'crlf.txt'), crlf, 'binary');
    const s = snapshot(root, { label: 'crlf' });
    fs.writeFileSync(path.join(root, 'crlf.txt'), 'other', 'binary');
    await restore(root, s.id, { yes: true });
    const buf = fs.readFileSync(path.join(root, 'crlf.txt'));
    assert.equal(buf.toString('binary'), crlf);
  });

  it('spaces and unicode in filenames', async () => {
    const name = 'файл with spaces.txt';
    fs.writeFileSync(path.join(root, name), 'unicode');
    const s = snapshot(root, { label: 'unicode' });
    fs.unlinkSync(path.join(root, name));
    await restore(root, s.id, { yes: true });
    assert.equal(fs.readFileSync(path.join(root, name), 'utf8'), 'unicode');
  });

  it('binary file restored byte for byte', async () => {
    const bin = Buffer.from([0, 1, 2, 255, 128, 0]);
    fs.writeFileSync(path.join(root, 'img.bin'), bin);
    const s = snapshot(root, { label: 'bin' });
    fs.writeFileSync(path.join(root, 'img.bin'), Buffer.from([9]));
    await restore(root, s.id, { yes: true });
    assert.deepEqual(fs.readFileSync(path.join(root, 'img.bin')), bin);
  });

  it('prune respects retention config', () => {
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(root, 'f.txt'), `v${i}`);
      snapshot(root, { label: `s${i}` });
    }
    const before = listSnapshots(root, { raw: true }).length;
    assert.ok(before >= 5);
    const r = prune(root, { keepCount: 2, keepDays: 0 });
    assert.equal(r.kept, 2);
    assert.equal(r.deleted, before - 2);
    assert.equal(listSnapshots(root, { raw: true }).length, 2);
  });

  it('disk size helper works', () => {
    snapshot(root, { label: 'disk' });
    const n = dirSizeBytes(storagePath(root));
    assert.ok(n > 0);
  });

  it('config loads defaults', () => {
    const cfg = loadConfig(root);
    assert.equal(cfg.keepCount, 50);
    assert.ok(cfg.maxFileBytes > 0);
  });

  it('size guard skips huge files', () => {
    const cfgPath = storagePath(root, 'config.json');
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ maxFileBytes: 100 }),
    );
    const big = Buffer.alloc(200, 7);
    fs.writeFileSync(path.join(root, 'big.bin'), big);
    const r = snapshot(root, { label: 'big' });
    assert.ok(r.skippedFiles >= 1);
    const snaps = listSnapshots(root, { raw: true });
    const names = git(root, [
      'ls-tree',
      '-r',
      '--name-only',
      snaps[0].commit,
    ]);
    assert.ok(!names.stdout.split('\n').includes('big.bin'));
  });
});
