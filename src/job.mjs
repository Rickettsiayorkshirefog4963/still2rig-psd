import fs from 'node:fs';
import path from 'node:path';
import {
  JOBS_ROOT,
  jobRoot,
  loadDefaults,
  relativeProjectPath,
  safeSlug,
  sha256File,
  timestampId,
  writeJson,
  readJson,
} from './utils.mjs';
import { generateColabCells } from './colab.mjs';

const allowedExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function verifyMagic(file, extension) {
  const header = fs.readFileSync(file).subarray(0, 16);
  const png = header.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const webp = header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP';
  if (extension === '.png' && !png) throw new Error('The .png input does not have a PNG signature.');
  if (['.jpg', '.jpeg'].includes(extension) && !jpeg) throw new Error('The JPEG input does not have a JPEG signature.');
  if (extension === '.webp' && !webp) throw new Error('The .webp input does not have a WebP signature.');
}

export function prepareJob(inputValue, requestedName) {
  if (!inputValue) throw new Error('Usage: still2rig-psd prepare IMAGE [--name JOB]');
  const input = path.resolve(inputValue);
  const stat = fs.statSync(input);
  if (!stat.isFile()) throw new Error('Input must be a regular file.');
  const extension = path.extname(input).toLowerCase();
  if (!allowedExtensions.has(extension)) throw new Error('Input must be PNG, JPEG, or WebP.');
  verifyMagic(input, extension);

  const defaults = loadDefaults();
  if (stat.size > defaults.quality.maximumInputBytes) {
    throw new Error(`Input exceeds ${defaults.quality.maximumInputBytes} bytes.`);
  }

  const stem = safeSlug(path.basename(input, extension));
  const jobId = requestedName ? safeSlug(requestedName) : `${timestampId()}-${stem}`;
  const root = jobRoot(jobId);
  if (fs.existsSync(root)) throw new Error(`Job already exists: ${jobId}`);

  for (const dir of ['input', 'colab', 'raw', 'processed', 'output', 'reports']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  const copiedInput = path.join(root, 'input', `source${extension}`);
  fs.copyFileSync(input, copiedInput);
  const inputSha256 = sha256File(copiedInput);
  const manifest = {
    schemaVersion: 1,
    jobId,
    createdAt: new Date().toISOString(),
    state: 'prepared',
    input: {
      file: relativeProjectPath(copiedInput),
      mediaType: extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg',
      bytes: stat.size,
      sha256: inputSha256,
    },
    inference: defaults.seeThrough,
    colab: {
      requiredGpuPattern: defaults.colab.requiredGpuPattern,
    },
    result: null,
  };
  writeJson(path.join(root, 'job.json'), manifest);
  generateColabCells(root, manifest, copiedInput);
  return manifest;
}

export function loadJob(jobId) {
  const root = jobRoot(jobId);
  const file = path.join(root, 'job.json');
  if (!fs.existsSync(file)) throw new Error(`Unknown job: ${jobId}`);
  return { root, manifest: readJson(file) };
}

export function updateJob(jobId, mutate) {
  const { root, manifest } = loadJob(jobId);
  const next = mutate(structuredClone(manifest)) || manifest;
  writeJson(path.join(root, 'job.json'), next);
  return next;
}

export function listJobs() {
  if (!fs.existsSync(JOBS_ROOT)) return [];
  return fs.readdirSync(JOBS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        return readJson(path.join(JOBS_ROOT, entry.name, 'job.json'));
      } catch {
        return { jobId: entry.name, state: 'invalid' };
      }
    })
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}
