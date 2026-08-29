import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT, STATE_ROOT, loadDefaults, relativeProjectPath, writeJson } from './utils.mjs';

function pythonString(value) {
  return JSON.stringify(value);
}

function writeCell(file, content) {
  fs.writeFileSync(file, `${content.trim()}\n`, { mode: 0o600 });
}

export function generateColabCells(jobRoot, manifest, copiedInput) {
  const cellDir = path.join(jobRoot, 'colab');
  const inputBase64 = fs.readFileSync(copiedInput).toString('base64');
  const workerSource = fs.readFileSync(path.join(PROJECT_ROOT, 'colab', 'still2rig-psd_worker.py'), 'utf8');
  const workerBase64 = Buffer.from(workerSource).toString('base64');
  const request = {
    schemaVersion: 1,
    jobId: manifest.jobId,
    inputName: path.basename(copiedInput),
    inputSha256: manifest.input.sha256,
    inference: manifest.inference,
    requiredGpuPattern: manifest.colab.requiredGpuPattern,
  };
  const requestBase64 = Buffer.from(`${JSON.stringify(request, null, 2)}\n`).toString('base64');

  writeCell(path.join(cellDir, '01-upload.py'), `
import base64
import hashlib
from pathlib import Path

root = Path('/content/still2rig-psd')
root.mkdir(parents=True, exist_ok=True)
input_path = root / ${pythonString(request.inputName)}
input_path.write_bytes(base64.b64decode(${pythonString(inputBase64)}))
actual = hashlib.sha256(input_path.read_bytes()).hexdigest()
expected = ${pythonString(request.inputSha256)}
if actual != expected:
    raise RuntimeError(f'input hash mismatch: {actual} != {expected}')
(root / 'job-request.json').write_bytes(base64.b64decode(${pythonString(requestBase64)}))
(root / 'still2rig-psd_worker.py').write_bytes(base64.b64decode(${pythonString(workerBase64)}))
print({'stage': 'uploaded', 'input': input_path.name, 'bytes': input_path.stat().st_size, 'sha256': actual})
  `);

  writeCell(path.join(cellDir, '02-setup.py'), `
import subprocess
subprocess.run([
    'python', '/content/still2rig-psd/still2rig-psd_worker.py',
    'setup', '--request', '/content/still2rig-psd/job-request.json'
], check=True)
  `);

  writeCell(path.join(cellDir, '03-run.py'), `
import subprocess
subprocess.run([
    'python', '/content/still2rig-psd/still2rig-psd_worker.py',
    'run', '--request', '/content/still2rig-psd/job-request.json'
], check=True)
  `);

  writeCell(path.join(cellDir, '04-download.py'), `
import hashlib
import json
from pathlib import Path
from google.colab import files

result = json.loads(Path('/content/still2rig-psd/latest-result.json').read_text())
archive = Path(result['archive'])
if hashlib.sha256(archive.read_bytes()).hexdigest() != result['sha256']:
    raise RuntimeError('archive hash changed before download')
print({'stage': 'download', 'file': archive.name, 'bytes': archive.stat().st_size, 'sha256': result['sha256']})
files.download(str(archive))
  `);

  writeJson(path.join(cellDir, 'cell-manifest.json'), {
    schemaVersion: 1,
    order: ['01-upload.py', '02-setup.py', '03-run.py', '04-download.py'],
    generatedFor: manifest.jobId,
    sourceInput: relativeProjectPath(copiedInput),
    note: 'Generated job cells are private artifacts under the ignored .still2rig-psd directory.',
  });
}

export function colabBridgePaths(stateDir = process.env.STILL2RIG_COLAB_STATE_DIR) {
  const resolvedStateDir = stateDir
    ? path.resolve(stateDir)
    : path.join(STATE_ROOT, 'secrets');
  return {
    stateDir: resolvedStateDir,
    tokenFile: path.join(resolvedStateDir, 'colab-token'),
    stateFile: path.join(resolvedStateDir, 'state.json'),
  };
}

function readBridgeState(stateFile) {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Colab MCP is not running yet. Restart Codex after trusting the project configuration.');
    }
    throw new Error(`The Colab MCP state file is invalid: ${error.message}`);
  }
  if (!Number.isInteger(state.port) || state.port < 1 || state.port > 65535) {
    throw new Error('Colab MCP has not finished selecting a local port yet.');
  }
  return state;
}

export function colabConnectionInfo(options = {}) {
  const defaults = loadDefaults();
  const { tokenFile, stateFile } = colabBridgePaths(options.stateDir);
  if (!fs.existsSync(tokenFile)) {
    throw new Error('Colab MCP is not running yet. Restart Codex after trusting the project configuration.');
  }
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  if (!token) throw new Error('The Colab MCP token file is empty.');
  const state = readBridgeState(stateFile);
  const configuredValue = options.configuredPort
    ?? process.env.STILL2RIG_COLAB_PORT
    ?? defaults.colab.port;
  const configuredPort = Number(configuredValue);
  if (!Number.isInteger(configuredPort) || configuredPort < 0 || configuredPort > 65535) {
    throw new Error('The configured Colab MCP port must be an integer from 0 to 65535.');
  }
  if (configuredPort > 0 && configuredPort !== state.port) {
    throw new Error(`Colab MCP port mismatch: running on ${state.port}, configured for ${configuredPort}.`);
  }
  const port = state.port;
  const fragment = new URLSearchParams({ mcpProxyToken: token, mcpProxyPort: String(port) });
  return {
    port,
    url: `https://colab.research.google.com/notebooks/empty.ipynb#${fragment.toString()}`,
    warning: 'Open this URL yourself in the Chrome profile you intend to use. The project does not control Chrome.',
  };
}
