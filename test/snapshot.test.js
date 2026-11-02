import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { snapshot } from '../src/snapshot.js';
import { listSnapshots } from '../src/list.js';
import { ensureInit } from '../src/shadow.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctrlz-snap-'));
}

describe('snapshot', () => {
  let root;

  before(() => {
    root = tmpDir();
    fs.writeFileSync(path.join(root, 'a.txt'), 'one');
    fs.writeFileSync(path.join(root, 'b.txt'), 'two');
    fs.writeFileSync(path.join(root, 'c.txt'), 'three');
    ensureInit(root);
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('creates a snapshot', () => {
    const r = snapshot(root, { label: 'first' });
    assert.equal(r.skipped, false);
    assert.ok(r.id);
    const list = listSnapshots(root);
    assert.equal(list.length, 1);
    assert.equal(list[0].label, 'first');
  });

  it('skips when nothing changed', () => {
    const r = snapshot(root, { label: 'again' });
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'unchanged');
    assert.equal(listSnapshots(root, { raw: true }).length, 1);
  });

  it('creates another snapshot after edit', () => {
    fs.writeFileSync(path.join(root, 'a.txt'), 'one-edited');
    const r = snapshot(root, { label: 'after edit' });
    assert.equal(r.skipped, false);
    assert.equal(listSnapshots(root, { raw: true }).length, 2);
  });

  it('works in a folder that is not a git repo', () => {
    assert.equal(fs.existsSync(path.join(root, '.git')), false);
    assert.ok(fs.existsSync(path.join(root, '.ctrl-z', 'repo.git')));
  });
});
