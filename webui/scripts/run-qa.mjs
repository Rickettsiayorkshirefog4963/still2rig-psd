import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

import { chromium } from 'playwright';

const webuiRoot = path.resolve(import.meta.dirname, '..');
const repositoryRoot = path.resolve(webuiRoot, '..');
const outputRoot = path.join(repositoryRoot, '.still2rig-psd', 'webui-qa');
const jobsRoot = path.join(outputRoot, 'jobs');
const fixtureJobId = 'qa-generated-preview';
const fixtureJobRoot = path.join(jobsRoot, fixtureJobId);
const fixtureFile = path.join(fixtureJobRoot, 'output', `${fixtureJobId}.psd`);
const qaRoot = path.join(outputRoot, 'qa');
const port = Number(process.env.WEBUI_QA_PORT || 4183);
const baseUrl = `http://127.0.0.1:${port}`;
const require = createRequire(import.meta.url);
const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');

await fs.mkdir(qaRoot, { recursive: true });

function runNode(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: webuiRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(output || `${script} exited with ${code}`));
    });
  });
}

await runNode(path.join(webuiRoot, 'scripts', 'generate-fixture.mjs'), [fixtureFile]);
await fs.writeFile(path.join(fixtureJobRoot, 'job.json'), `${JSON.stringify({
  schemaVersion: 1,
  jobId: fixtureJobId,
  createdAt: '2026-01-01T00:00:00.000Z',
  state: 'production-structure-ready',
  result: {
    productionReady: true,
    psd: `.still2rig-psd/jobs/${fixtureJobId}/output/${fixtureJobId}.psd`,
  },
}, null, 2)}\n`);

const server = spawn(process.execPath, [
  viteBin,
  '--host',
  '127.0.0.1',
  '--port',
  String(port),
], {
  cwd: webuiRoot,
  env: {
    ...process.env,
    STILL2RIG_PSD_JOBS_ROOT: jobsRoot,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk; });
server.stderr.on('data', (chunk) => { serverLog += chunk; });

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error(`Vite did not start.\n${serverLog}`);
}

let browser;
try {
  await waitForServer();
  const libraryResponse = await fetch(`${baseUrl}/api/generated-psds`);
  const libraryPayload = await libraryResponse.json();
  const unknownPsdStatus = (await fetch(`${baseUrl}/api/generated-psds/not-a-real-id`)).status;
  browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto(`${baseUrl}?autoload=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelectorAll('#generated-psd-select option').length > 1,
  );
  const waitingState = await page.evaluate(() => ({
    ready: window.rigQa?.ready,
    status: document.querySelector('#status')?.textContent,
    avatarReady: document.body.dataset.avatarReady,
    generatedOptions: document.querySelectorAll('#generated-psd-select option').length - 1,
    legacyBadgeCount: document.querySelectorAll('.badge').length,
    titleParent: document.querySelector('h1')?.parentElement?.className,
  }));
  await page.screenshot({ path: path.join(qaRoot, 'waiting-with-library.png') });

  const generatedId = await page.locator('#generated-psd-select option').nth(1).getAttribute('value');
  if (!generatedId) throw new Error('Generated PSD option was not available.');
  await page.selectOption('#generated-psd-select', generatedId);
  await page.waitForFunction(
    () => window.rigQa?.ready === true && window.rigQa?.error === null,
    null,
    { timeout: 30_000 },
  );
  const selectedGeneratedState = await page.evaluate(() => ({
    modelName: document.querySelector('#model-name')?.textContent,
    selectedValue: document.querySelector('#generated-psd-select')?.value,
  }));
  await page.waitForTimeout(220);
  const initialLayout = await page.evaluate(() => {
    const header = document.querySelector('.app-header')?.getBoundingClientRect();
    const stage = document.querySelector('.stage')?.getBoundingClientRect();
    const panel = document.querySelector('.control-panel')?.getBoundingClientRect();
    const canvas = document.querySelector('#rig-canvas')?.getBoundingClientRect();
    return {
      headerBottom: header?.bottom,
      stageTop: stage?.top,
      stageBottom: stage?.bottom,
      stageWidth: stage?.width,
      panelWidth: panel?.width,
      canvasTop: canvas?.top,
      canvasBottom: canvas?.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      zoomLabel: document.querySelector('#zoom-value')?.value,
      view: window.rigQa.getViewTransform(),
    };
  });
  await page.screenshot({ path: path.join(qaRoot, 'generated-loaded.png') });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.rigQa?.ready === true && window.rigQa?.error === null,
    null,
    { timeout: 30_000 },
  );
  const autoLoadedState = await page.evaluate(() => ({
    modelName: document.querySelector('#model-name')?.textContent,
    selectedValue: document.querySelector('#generated-psd-select')?.value,
  }));

  const fixtureBase64 = (await fs.readFile(fixtureFile)).toString('base64');
  const transfer = await page.evaluateHandle((base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([bytes], 'uploaded-fixture.psd', {
      type: 'image/vnd.adobe.photoshop',
    }));
    return dataTransfer;
  }, fixtureBase64);
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: transfer });
  await page.waitForTimeout(180);
  const overlayVisible =
    (await page.locator('#drop-overlay').getAttribute('aria-hidden')) === 'false';
  await page.screenshot({ path: path.join(qaRoot, 'drop-overlay.png') });
  await page.dispatchEvent('body', 'drop', { dataTransfer: transfer });
  await page.waitForFunction(
    () => window.rigQa?.ready === true &&
      window.rigQa?.error === null &&
      document.querySelector('#model-name')?.textContent === 'uploaded-fixture.psd',
    null,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(500);
  const summary = await page.evaluate(() => window.rigQa.summary);
  await page.screenshot({ path: path.join(qaRoot, 'uploaded.png') });
  const canvas = page.locator('#rig-canvas');

  const autoBlinkDefaultsOn = await page.evaluate(() => window.rigQa.getAutoBlink());
  await page.click('#blink-toggle');
  const autoBlinkDisabled = await page.evaluate(() => ({
    enabled: window.rigQa.getAutoBlink(),
    pressed: document.querySelector('#blink-toggle')?.getAttribute('aria-pressed'),
    label: document.querySelector('#blink-value')?.value,
  }));
  await page.click('#blink-toggle');
  await page.waitForFunction(
    () => window.rigQa.getEyeOpen().left < 0.2 && window.rigQa.getEyeOpen().right < 0.2,
    null,
    { timeout: 5_000 },
  );
  const blinkClosed = await page.evaluate(() => window.rigQa.getEyeOpen());
  await canvas.screenshot({ path: path.join(qaRoot, 'blink-closed.png') });
  await page.waitForFunction(
    () => window.rigQa.getEyeOpen().left > 0.9 && window.rigQa.getEyeOpen().right > 0.9,
    null,
    { timeout: 5_000 },
  );
  const blinkReopened = await page.evaluate(() => window.rigQa.getEyeOpen());
  await canvas.screenshot({ path: path.join(qaRoot, 'blink-open.png') });
  await page.click('#blink-toggle');

  await page.locator('#advanced-parameters').evaluate((details) => { details.open = true; });
  await page.locator('[data-parameter-group="face"]').evaluate((details) => { details.open = true; });
  const advancedInitial = await page.evaluate(() => ({
    itemCount: document.querySelectorAll('.advanced-item').length,
    groupCount: document.querySelectorAll('.parameter-group').length,
    angleZ: window.rigQa.getProfileParameters().angleZ,
    physAmp: window.rigQa.getProfileParameters().physAmp,
    fhSoft: window.rigQa.getProfileParameters().fhSoft,
    numberValue: document.querySelector('#parameter-angleZ-number')?.value,
  }));
  await page.evaluate(() => {
    const canvas = document.querySelector('#rig-canvas');
    const gl = canvas.getContext('webgl');
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    window.__still2rigAdvancedFrame = pixels;
  });
  await page.locator('#parameter-angleZ-number').fill('0.55');
  await page.locator('#parameter-angleZ-number').dispatchEvent('change');
  await page.waitForTimeout(520);
  const advancedAdjusted = await page.evaluate(() => {
    const canvas = document.querySelector('#rig-canvas');
    const gl = canvas.getContext('webgl');
    const before = window.__still2rigAdvancedFrame;
    const after = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, after);
    let changedPixels = 0;
    for (let offset = 0; offset < after.length; offset += 4) {
      if (
        after[offset] !== before[offset] ||
        after[offset + 1] !== before[offset + 1] ||
        after[offset + 2] !== before[offset + 2] ||
        after[offset + 3] !== before[offset + 3]
      ) changedPixels += 1;
    }
    return {
      angleZ: window.rigQa.getProfileParameters().angleZ,
      rangeValue: document.querySelector('#parameter-angleZ')?.value,
      numberValue: document.querySelector('#parameter-angleZ-number')?.value,
      changedPixelRatio: changedPixels / (canvas.width * canvas.height),
    };
  });
  await page.locator('#advanced-parameters').screenshot({ path: path.join(qaRoot, 'advanced-parameters.png') });
  await page.click('#advanced-reset');
  await page.waitForTimeout(420);
  const advancedResetState = await page.evaluate(() => ({
    angleZ: window.rigQa.getProfileParameters().angleZ,
    physAmp: window.rigQa.getProfileParameters().physAmp,
    fhSoft: window.rigQa.getProfileParameters().fhSoft,
    numberValue: document.querySelector('#parameter-angleZ-number')?.value,
  }));
  await page.locator('#advanced-parameters').evaluate((details) => { details.open = false; });

  await page.click('[data-motion-preset="calm"]');
  await page.click('[data-mode="physics"]');
  await page.waitForTimeout(1800);
  await canvas.screenshot({ path: path.join(qaRoot, 'calm-a.png') });
  await page.evaluate(() => {
    const canvas = document.querySelector('#rig-canvas');
    const gl = canvas.getContext('webgl');
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    window.__still2rigQaFrame = pixels;
  });
  await page.waitForTimeout(900);
  await canvas.screenshot({ path: path.join(qaRoot, 'calm-b.png') });
  const motionMetrics = await page.evaluate(() => {
    const canvas = document.querySelector('#rig-canvas');
    const gl = canvas.getContext('webgl');
    const before = window.__still2rigQaFrame;
    const after = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, after);
    let changedPixels = 0;
    let absoluteError = 0;
    for (let offset = 0; offset < after.length; offset += 4) {
      let pixelChanged = false;
      for (let channel = 0; channel < 4; channel += 1) {
        const delta = Math.abs(after[offset + channel] - before[offset + channel]);
        absoluteError += delta;
        pixelChanged ||= delta > 0;
      }
      if (pixelChanged) changedPixels += 1;
    }
    return {
      changedPixelRatio: changedPixels / (canvas.width * canvas.height),
      meanAbsoluteError: absoluteError / after.length,
    };
  });
  const tuning = await page.evaluate(() => window.rigQa.getMotionTuning());

  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas bounding box was not available.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 45, { steps: 6 });
  await page.mouse.up();
  const drag = await page.evaluate(() => window.rigQa.getViewTransform());
  await page.locator('#zoom-control').evaluate((input) => {
    input.value = '135';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const zoom = await page.evaluate(() => window.rigQa.getViewTransform());
  await page.screenshot({ path: path.join(qaRoot, 'operated.png') });

  const mobileConsoleErrors = [];
  const mobilePage = await browser.newPage({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  });
  mobilePage.on('console', (message) => {
    if (message.type() === 'error') mobileConsoleErrors.push(message.text());
  });
  await mobilePage.goto(`${baseUrl}?autoload=0`, { waitUntil: 'domcontentloaded' });
  await mobilePage.waitForFunction(
    () => document.querySelectorAll('#generated-psd-select option').length > 1,
  );
  const mobileWaitingLayout = await mobilePage.evaluate(() => {
    const header = document.querySelector('.app-header')?.getBoundingClientRect();
    const source = document.querySelector('.header-source')?.getBoundingClientRect();
    const stage = document.querySelector('.stage')?.getBoundingClientRect();
    const canvas = document.querySelector('#rig-canvas')?.getBoundingClientRect();
    const emptyState = document.querySelector('.empty-state')?.getBoundingClientRect();
    const fileButton = document.querySelector('#psd-file-button')?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      headerBottom: header?.bottom,
      sourceBottom: source?.bottom,
      stageTop: stage?.top,
      canvasTop: canvas?.top,
      canvasBottom: canvas?.bottom,
      emptyTop: emptyState?.top,
      emptyBottom: emptyState?.bottom,
      fileButtonHeight: fileButton?.height,
      legacyBadgeCount: document.querySelectorAll('.badge').length,
    };
  });
  await mobilePage.screenshot({ path: path.join(qaRoot, 'mobile-waiting.png'), fullPage: true });
  await mobilePage.selectOption('#generated-psd-select', generatedId);
  await mobilePage.waitForFunction(
    () => window.rigQa?.ready === true && window.rigQa?.error === null,
    null,
    { timeout: 30_000 },
  );
  await mobilePage.waitForTimeout(220);
  const mobileLoadedLayout = await mobilePage.evaluate(() => {
    const stage = document.querySelector('.stage')?.getBoundingClientRect();
    const panel = document.querySelector('.control-panel')?.getBoundingClientRect();
    return {
      stageBottom: stage?.bottom,
      panelTop: panel?.top,
      modelName: document.querySelector('#model-name')?.textContent,
      emptyStateOpacity: getComputedStyle(document.querySelector('.empty-state')).opacity,
    };
  });
  await mobilePage.screenshot({ path: path.join(qaRoot, 'mobile-loaded.png'), fullPage: true });
  await mobilePage.close();

  const checks = {
    startsWithoutBundledArtwork:
      waitingState.ready === false &&
      waitingState.status === '待機中' &&
      waitingState.avatarReady === 'false',
    legacyWebglBadgeRemoved:
      waitingState.legacyBadgeCount === 0 && waitingState.titleParent === 'brand-block',
    generatedLibraryListsOutputs: waitingState.generatedOptions === 1,
    generatedLibraryHidesLocalPaths:
      libraryResponse.ok &&
      libraryPayload.items?.length === 1 &&
      !Object.hasOwn(libraryPayload.items[0], 'file') &&
      !JSON.stringify(libraryPayload).includes(repositoryRoot),
    unknownGeneratedPsdIsRejected: unknownPsdStatus === 404,
    generatedSelectorLoadsPsd:
      selectedGeneratedState.modelName === `${fixtureJobId}.psd` &&
      selectedGeneratedState.selectedValue === generatedId,
    latestGeneratedPsdAutoLoads:
      autoLoadedState.modelName === `${fixtureJobId}.psd` &&
      autoLoadedState.selectedValue === generatedId,
    previewStartsNearTop:
      typeof initialLayout.canvasTop === 'number' && initialLayout.canvasTop < 175,
    previewFitsViewport:
      typeof initialLayout.canvasBottom === 'number' &&
      initialLayout.canvasBottom <= initialLayout.viewportHeight - 30,
    avatarStartsWithMargin:
      Math.abs(initialLayout.view.scale - 0.9) < 0.001 && initialLayout.zoomLabel === '90%',
    previewIsVisuallyDominant:
      initialLayout.stageWidth / initialLayout.viewportWidth > 0.68 &&
      initialLayout.panelWidth <= 400 &&
      Math.abs(initialLayout.headerBottom - initialLayout.stageTop) < 1,
    dropOverlayAppears: overlayVisible,
    localPsdUploadLoads:
      summary?.canvasWidth === 256 &&
      summary?.missingRequiredParts?.length === 0,
    autoBlinkDefaultsOn,
    autoBlinkCanBeDisabled:
      autoBlinkDisabled.enabled === false &&
      autoBlinkDisabled.pressed === 'false' &&
      autoBlinkDisabled.label === 'OFF',
    autoBlinkClosesAndReopens:
      blinkClosed.left < 0.2 &&
      blinkClosed.right < 0.2 &&
      blinkReopened.left > 0.9 &&
      blinkReopened.right > 0.9,
    advancedParametersExposeInternalDefaults:
      advancedInitial.itemCount === 32 &&
      advancedInitial.groupCount === 4 &&
      advancedInitial.angleZ === 0 &&
      advancedInitial.physAmp === 2 &&
      advancedInitial.fhSoft === 0.4 &&
      advancedInitial.numberValue === '0.00',
    advancedParameterUpdatesRenderer:
      Math.abs(advancedAdjusted.angleZ - 0.55) < 0.001 &&
      advancedAdjusted.rangeValue === '0.55' &&
      advancedAdjusted.numberValue === '0.55' &&
      advancedAdjusted.changedPixelRatio > 0.001,
    advancedParametersResetToDefaults:
      advancedResetState.angleZ === 0 &&
      advancedResetState.physAmp === 2 &&
      advancedResetState.fhSoft === 0.4 &&
      advancedResetState.numberValue === '0.00',
    calmPresetReachesRenderer:
      Math.abs(tuning.intensity - 0.65) < 0.001 &&
      Math.abs(tuning.hairWindScale - 0.5) < 0.001,
    calmHairStillMoves:
      motionMetrics.changedPixelRatio > 0.001 &&
      motionMetrics.meanAbsoluteError > 0.01,
    // Pointer deltas are converted from CSS pixels to the PSD canvas space.
    avatarDragWorks: Math.abs(drag.offsetX) > 25 && Math.abs(drag.offsetY) > 12,
    zoomWorks: Math.abs(zoom.scale - 1.35) < 0.001,
    mobileSourceComesBeforePreview:
      mobileWaitingLayout.sourceBottom <= mobileWaitingLayout.stageTop + 1 &&
      mobileWaitingLayout.headerBottom <= mobileWaitingLayout.stageTop + 1,
    mobileWaitingCardFitsCanvas:
      mobileWaitingLayout.emptyTop >= mobileWaitingLayout.canvasTop &&
      mobileWaitingLayout.emptyBottom <= mobileWaitingLayout.canvasBottom,
    mobileHasNoHorizontalOverflow:
      mobileWaitingLayout.scrollWidth <= mobileWaitingLayout.viewportWidth,
    mobileControlsRemainTouchSized:
      mobileWaitingLayout.fileButtonHeight >= 44,
    mobileLoadedPsd:
      mobileLoadedLayout.modelName === `${fixtureJobId}.psd` &&
      mobileLoadedLayout.stageBottom <= mobileLoadedLayout.panelTop + 1 &&
      mobileLoadedLayout.emptyStateOpacity === '0',
    noConsoleErrors: consoleErrors.length === 0,
    noMobileConsoleErrors: mobileConsoleErrors.length === 0,
  };
  const report = {
    pass: Object.values(checks).every(Boolean),
    checks,
    waitingState,
    libraryPayload,
    unknownPsdStatus,
    selectedGeneratedState,
    autoLoadedState,
    initialLayout,
    summary,
    autoBlinkDefaultsOn,
    autoBlinkDisabled,
    blinkClosed,
    blinkReopened,
    advancedInitial,
    advancedAdjusted,
    advancedResetState,
    tuning,
    motionMetrics,
    drag,
    zoom,
    mobileWaitingLayout,
    mobileLoadedLayout,
    consoleErrors,
    mobileConsoleErrors,
  };
  await fs.writeFile(path.join(qaRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
