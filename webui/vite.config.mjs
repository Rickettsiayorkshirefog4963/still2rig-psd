import fs from 'node:fs';
import path from 'node:path';

import { defineConfig } from 'vite';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const configuredJobsRoot = process.env.STILL2RIG_PSD_JOBS_ROOT;
const jobsRoot = configuredJobsRoot
  ? path.resolve(repositoryRoot, configuredJobsRoot)
  : path.join(repositoryRoot, '.still2rig-psd', 'jobs');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function listGeneratedPsds() {
  if (!fs.existsSync(jobsRoot) || !fs.lstatSync(jobsRoot).isDirectory()) return [];
  const results = [];
  for (const entry of fs.readdirSync(jobsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const jobRoot = path.join(jobsRoot, entry.name);
    const outputRoot = path.join(jobRoot, 'output');
    if (!fs.existsSync(outputRoot) || !fs.lstatSync(outputRoot).isDirectory()) continue;
    const manifest = readJson(path.join(jobRoot, 'job.json'));
    for (const fileName of fs.readdirSync(outputRoot)) {
      if (!/\.psd$/i.test(fileName)) continue;
      const file = path.join(outputRoot, fileName);
      const stat = fs.lstatSync(file);
      if (!stat.isFile()) continue;
      const relativeFile = path.relative(jobsRoot, file);
      const id = Buffer.from(relativeFile).toString('base64url');
      results.push({
        id,
        name: fileName,
        url: `/api/generated-psds/${id}`,
        createdAt: manifest?.createdAt ?? stat.mtime.toISOString(),
        state: manifest?.state ?? 'generated',
        productionReady: manifest?.result?.productionReady ?? null,
        bytes: stat.size,
        file,
      });
    }
  }
  return results.sort((left, right) =>
    String(right.createdAt).localeCompare(String(left.createdAt)),
  );
}

function sendJson(response, value) {
  const body = JSON.stringify(value);
  response.statusCode = 200;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(body);
}

function generatedPsdMiddleware(request, response, next) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return next();
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (requestUrl.pathname === '/api/generated-psds') {
    const publicItems = listGeneratedPsds().map(({ file: _file, ...item }) => item);
    sendJson(response, { items: publicItems });
    return;
  }
  const prefix = '/api/generated-psds/';
  if (!requestUrl.pathname.startsWith(prefix)) return next();
  const id = requestUrl.pathname.slice(prefix.length);
  const item = listGeneratedPsds().find((candidate) => candidate.id === id);
  if (!item) {
    response.statusCode = 404;
    response.end('PSD not found');
    return;
  }
  response.statusCode = 200;
  response.setHeader('Content-Type', 'image/vnd.adobe.photoshop');
  response.setHeader('Content-Length', String(item.bytes));
  response.setHeader('Cache-Control', 'no-store');
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  fs.createReadStream(item.file).pipe(response);
}

function generatedPsdPlugin() {
  return {
    name: 'still2rig-generated-psds',
    configureServer(server) {
      server.middlewares.use(generatedPsdMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(generatedPsdMiddleware);
    },
  };
}

export default defineConfig({
  plugins: [generatedPsdPlugin()],
});
