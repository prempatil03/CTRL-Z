import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { snapshot } from '../src/snapshot.js';
import { restore, redo } from '../src/restore.js';
import { ensureInit } from '../src/shadow.js';
import { listSnapshots } from '../src/list.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctrlz-restore-'));
}

describe('restore', () => {
  let root;
  let firstId;

  before(async () => {
    root = tmpDir();
    fs.writeFileSync(path.join(root, 'a.txt'), 'one');
    fs.writeFileSync(path.join(root, 'b.txt'), 'two');
    fs.writeFileSync(path.join(root, 'c.txt'), 'three');
    ensureInit(root);
    const r = snapshot(root, { label: 'original' });
    firstId = r.id;

    fs.writeFileSync(path.join(root, 'a.txt'), 'edited');
    fs.unlinkSync(path.join(root, 'b.txt'));
    fs.writeFileSync(path.join(root, 'd.txt'), 'new');
    snapshot(root, { label: 'after edits' });
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('restores folder to original exactly', async () => {
    const result = await restore(root, firstId, { yes: true });
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'one');
    assert.equal(fs.readFileSync(path.join(root, 'b.txt'), 'utf8'), 'two');
    assert.equal(fs.readFileSync(path.join(root, 'c.txt'), 'utf8'), 'three');
    assert.equal(fs.existsSync(path.join(root, 'd.txt')), false);
  });

  it('redo returns to post-edit state', async () => {
    // Current state is original. Redo should go to "before undo" which was post-edit.
    const result = await redo(root, { yes: true });
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'edited');
    assert.equal(fs.existsSync(path.join(root, 'b.txt')), false);
    assert.equal(fs.readFileSync(path.join(root, 'd.txt'), 'utf8'), 'new');
  });

  it('dry-run does not change files', async () => {
    const before = fs.readFileSync(path.join(root, 'a.txt'), 'utf8');
    const snaps = listSnapshots(root, { raw: true });
    const original = snaps.find((s) => s.label === 'original');
    const plan = await restore(root, original.id, { dryRun: true, yes: true });
    assert.equal(plan.dryRun, true);
    assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), before);
  });
});
