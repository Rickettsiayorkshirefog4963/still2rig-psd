import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { colabConnectionInfo } from '../src/colab.mjs';
import { STATE_ROOT } from '../src/utils.mjs';

const roots = [];

function tempState() {
  fs.mkdirSync(STATE_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(STATE_ROOT, 'test-colab-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'colab-token'), 'test-token\n', { mode: 0o600 });
  return root;
}

function writeState(root, port) {
  fs.writeFileSync(path.join(root, 'state.json'), `${JSON.stringify({
    pid: process.pid,
    port,
    started_at: new Date().toISOString(),
    ws_connected: false,
    last_updated: new Date().toISOString(),
  }, null, 2)}\n`, { mode: 0o600 });
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

test('builds the Colab URL from the auto-selected port in state.json', () => {
  const stateDir = tempState();
  writeState(stateDir, 43123);
  const info = colabConnectionInfo({ stateDir, configuredPort: 0 });
  const fragment = new URLSearchParams(new URL(info.url).hash.slice(1));
  assert.equal(info.port, 43123);
  assert.equal(fragment.get('mcpProxyPort'), '43123');
  assert.equal(fragment.get('mcpProxyToken'), 'test-token');
});

test('refuses to print a URL until the bridge records its selected port', () => {
  const stateDir = tempState();
  assert.throws(
    () => colabConnectionInfo({ stateDir, configuredPort: 0 }),
    /Colab MCP is not running yet/,
  );
});

test('detects a mismatch when a fixed port override is configured', () => {
  const stateDir = tempState();
  writeState(stateDir, 43123);
  assert.throws(
    () => colabConnectionInfo({ stateDir, configuredPort: 8765 }),
    /port mismatch/,
  );
});
