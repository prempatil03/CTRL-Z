import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { ensureInit } from '../src/shadow.js';
import { snapshot } from '../src/snapshot.js';
import { restore } from '../src/restore.js';

function hashTree(root) {
  const files = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (rel === '.ctrl-z' || rel.startsWith('.ctrl-z/')) continue;
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) {
        const buf = fs.readFileSync(full);
        files.push([rel, crypto.createHash('sha256').update(buf).digest('hex')]);
      }
    }
  };
  walk(root);
  files.sort((a, b) => a[0].localeCompare(b[0]));
  return crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex');
}

describe('chaos', () => {
  it('random edits then restore matches earlier hash', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrlz-chaos-'));
    try {
      const N = 40;
      for (let i = 0; i < N; i++) {
        const dir = path.join(root, `d${i % 5}`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `f${i}.txt`), `seed-${i}\n`);
      }
      ensureInit(root);
      const hashes = [];
      const ids = [];

      for (let step = 0; step < 25; step++) {
        const action = step % 3;
        if (action === 0) {
          const f = path.join(root, `d${step % 5}`, `f${step % N}.txt`);
          if (fs.existsSync(f)) fs.writeFileSync(f, `edit-${step}-${Math.random()}\n`);
        } else if (action === 1) {
          const f = path.join(root, `d${step % 5}`, `f${step % N}.txt`);
          if (fs.existsSync(f)) fs.unlinkSync(f);
        } else {
          fs.writeFileSync(
            path.join(root, `d${step % 5}`, `extra-${step}.txt`),
            `extra-${step}\n`,
          );
        }
        const r = snapshot(root, { label: `step-${step}`, force: true });
        ids.push(r.id);
        hashes.push(hashTree(root));
      }

      const pick = 10;
      await restore(root, ids[pick], { yes: true });
      assert.equal(hashTree(root), hashes[pick]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
