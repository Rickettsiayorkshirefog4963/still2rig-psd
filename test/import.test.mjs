import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, test } from 'node:test';
import { PROJECT_ROOT, STATE_ROOT } from '../src/utils.mjs';

const roots = [];

function tempRoot(name) {
  fs.mkdirSync(STATE_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(STATE_ROOT, `test-${name}-`));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

test('rejects ZIP path traversal before extraction', () => {
  const root = tempRoot('zip');
  const archive = path.join(root, 'malicious.zip');
  const make = spawnSync('python3', ['-c', [
    'import zipfile,sys',
    "z=zipfile.ZipFile(sys.argv[1],'w')",
    "z.writestr('../escape.txt','no')",
    'z.close()',
  ].join(';'), archive], { encoding: 'utf8' });
  assert.equal(make.status, 0, make.stderr);
  const destination = path.join(root, 'destination');
  const result = spawnSync('python3', [
    path.join(PROJECT_ROOT, 'scripts', 'import_colab_bundle.py'),
    '--archive', archive,
    '--destination', destination,
    '--expected-input-sha256', '0'.repeat(64),
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsafe archive member/);
  assert.equal(fs.existsSync(path.join(root, 'escape.txt')), false);
});
