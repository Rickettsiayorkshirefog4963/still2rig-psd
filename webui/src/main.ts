import { detectAnime25RigFromBuffer } from './rig/anime25Rig';
import {
  createAnime25RigAvatar,
  DEFAULT_ANIME25_MOTION_TUNING,
  type Anime25MotionTuning,
  type Anime25RigAvatar,
} from './rig/anime25Renderer';
import {
  createDefaultPsdMotionProfile,
  DEFAULT_PSD_MOTION_PARAMETERS,
  PSD_MOTION_PARAMETER_DEFINITIONS,
  type PsdMotionParameterDefinition,
  type PsdMotionParameterGroup,
  type PsdMotionParameterName,
  type PsdMotionParameters,
  type PsdMotionProfile,
} from './psdMotionProfile';

type QaMode = 'static' | 'physics' | 'idle-physics';
type MotionPreset = 'calm' | 'standard' | 'active' | 'custom';
type UiMotionTuning = Anime25MotionTuning & { intensity: number };

interface GeneratedPsd {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  state: string;
  productionReady: boolean | null;
  bytes: number;
}

interface RigQaApi {
  ready: boolean;
  error: string | null;
  summary: unknown;
  anchors: Record<string, unknown>;
  setState: (eyeOpen: number, mouthOpen: number) => void;
  setMode: (mode: QaMode) => void;
  setAutoBlink: (enabled: boolean) => void;
  getAutoBlink: () => boolean;
  getEyeOpen: () => { left: number; right: number };
  setLabel: (phase: string, detail?: string, progress?: number) => void;
  setBackground: (mode: 'checker' | 'solid') => void;
  setViewTransform: (offsetX: number, offsetY: number, scale: number) => void;
  getViewTransform: () => { offsetX: number; offsetY: number; scale: number };
  getDragMotion: () => { x: number; y: number };
  setMotionTuning: (value: Partial<UiMotionTuning>) => void;
  getMotionTuning: () => UiMotionTuning;
  setProfileParameter: (name: PsdMotionParameterName, value: number) => void;
  getProfileParameters: () => PsdMotionParameters;
  resetProfileParameters: () => void;
  getAverageFps: () => number;
}

declare global {
  interface Window { rigQa: RigQaApi; }
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`QA harness DOM is missing ${selector}.`);
  return element;
}

const canvas = requireElement<HTMLCanvasElement>('#rig-canvas');
const stage = requireElement<HTMLElement>('.stage');
const modelNode = requireElement<HTMLElement>('#model-name');
const phaseNode = requireElement<HTMLElement>('#phase');
const detailNode = requireElement<HTMLElement>('#detail');
const progressNode = requireElement<HTMLElement>('#progress');
const progressTrack = requireElement<HTMLElement>('.track');
const statusNode = requireElement<HTMLElement>('#status');
const reportNode = requireElement<HTMLElement>('#report');
const generatedPsdSelect = requireElement<HTMLSelectElement>('#generated-psd-select');
const generatedPsdRefresh = requireElement<HTMLButtonElement>('#generated-psd-refresh');
const generatedPsdNote = requireElement<HTMLElement>('#generated-psd-note');
const psdFileInput = requireElement<HTMLInputElement>('#psd-file-input');
const dropOverlay = requireElement<HTMLElement>('#drop-overlay');
const eyeControl = requireElement<HTMLInputElement>('#eye-control');
const mouthControl = requireElement<HTMLInputElement>('#mouth-control');
const eyeValue = requireElement<HTMLOutputElement>('#eye-value');
const mouthValue = requireElement<HTMLOutputElement>('#mouth-value');
const blinkToggle = requireElement<HTMLButtonElement>('#blink-toggle');
const blinkValue = requireElement<HTMLOutputElement>('#blink-value');
const zoomControl = requireElement<HTMLInputElement>('#zoom-control');
const zoomValue = requireElement<HTMLOutputElement>('#zoom-value');
const viewReset = requireElement<HTMLButtonElement>('#view-reset');
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-mode]')];
const presetButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-motion-preset]')];
const tuningPresetValue = requireElement<HTMLOutputElement>('#tuning-preset-value');
const tuningInputIds = [
  'motion-intensity',
  'idle-scale',
  'breath-scale',
  'hair-wind-scale',
  'hair-amplitude-scale',
  'hair-softness-scale',
  'drag-scale',
] as const;
type TuningInputId = (typeof tuningInputIds)[number];
const tuningInputs = Object.fromEntries(
  tuningInputIds.map((id) => [id, requireElement<HTMLInputElement>(`#${id}`)]),
) as Record<TuningInputId, HTMLInputElement>;
const tuningOutputs = Object.fromEntries(
  tuningInputIds.map((id) => [id, requireElement<HTMLOutputElement>(`#${id}-value`)]),
) as Record<TuningInputId, HTMLOutputElement>;
const demoStart = requireElement<HTMLButtonElement>('#demo-start');
const demoStop = requireElement<HTMLButtonElement>('#demo-stop');
const advancedParameterGroups = requireElement<HTMLElement>('#advanced-parameter-groups');
const advancedReset = requireElement<HTMLButtonElement>('#advanced-reset');

if (presetButtons.length !== 3) {
  throw new Error('QA harness DOM is incomplete.');
}

let avatar: Anime25RigAvatar | null = null;
let generatedPsds: GeneratedPsd[] = [];
let eyeOpen = 1;
let mouthOpen = 0;
let autoBlinkEnabled = true;
let demoToken = 0;
let loadToken = 0;
let currentMode: QaMode = 'static';
let currentPreset: MotionPreset = 'standard';
let motionTuning: UiMotionTuning = {
  intensity: 1,
  ...DEFAULT_ANIME25_MOTION_TUNING,
};
let profileParameters: PsdMotionParameters = { ...DEFAULT_PSD_MOTION_PARAMETERS };
let viewOffsetX = 0;
let viewOffsetY = 0;
const DEFAULT_VIEW_SCALE = 0.9;
let viewScale = DEFAULT_VIEW_SCALE;
let dragState: { pointerId: number; clientX: number; clientY: number; time: number } | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

const MOTION_PRESETS: Record<Exclude<MotionPreset, 'custom'>, UiMotionTuning> = {
  calm: {
    intensity: 0.65,
    idleScale: 0.6,
    breathScale: 0.75,
    hairWindScale: 0.5,
    hairAmplitudeScale: 0.65,
    hairSoftnessScale: 0.7,
    dragScale: 0.7,
  },
  standard: {
    intensity: 1,
    ...DEFAULT_ANIME25_MOTION_TUNING,
  },
  active: {
    intensity: 1.15,
    idleScale: 1.15,
    breathScale: 1.1,
    hairWindScale: 1.2,
    hairAmplitudeScale: 1.15,
    hairSoftnessScale: 1.05,
    dragScale: 1.15,
  },
};

const PRESET_LABELS: Record<MotionPreset, string> = {
  calm: 'おだやか',
  standard: '標準',
  active: 'よく動く',
  custom: 'カスタム',
};

const tuningKeys: Record<TuningInputId, keyof UiMotionTuning> = {
  'motion-intensity': 'intensity',
  'idle-scale': 'idleScale',
  'breath-scale': 'breathScale',
  'hair-wind-scale': 'hairWindScale',
  'hair-amplitude-scale': 'hairAmplitudeScale',
  'hair-softness-scale': 'hairSoftnessScale',
  'drag-scale': 'dragScale',
};

const PARAMETER_GROUP_LABELS: Record<PsdMotionParameterGroup, string> = {
  face: '姿勢・上半身',
  eyes: '目・眉',
  mouth: '口',
  physics: '髪・物理',
};

const PARAMETER_LABELS: Partial<Record<PsdMotionParameterName, string>> = {
  angleX: '顔の左右向き',
  angleY: '顔の上下向き',
  angleZ: '顔の傾き',
  body: '上半身の傾き',
  armY: '腕の上下',
  armPos: '腕の位置',
  eyeOpenL: '左目の開き',
  eyeOpenR: '右目の開き',
  eyeX: '視線の左右',
  eyeY: '視線の上下',
  irisScale: '瞳の大きさ',
  eyeEase: '目の変形の滑らかさ',
  eyeCY: '目の中心位置',
  eyeCAng: '目の傾き',
  eyeScaleL: '左目の大きさ',
  eyeScaleR: '右目の大きさ',
  brow: '眉の高さ',
  browAngL: '左眉の角度',
  browAngR: '右眉の角度',
  browAngSym: '眉の対称角度',
  mouthOpen: '口の開き',
  mouthForm: '口の形',
  mouthCY: '口の中心位置',
  mouthEase: '口の変形の滑らかさ',
  mouthCAng: '口の傾き',
  mouthScale: '口の大きさ',
  physAmp: '髪全体の揺れ幅',
  soft: '髪全体の柔らかさ',
  fhAmp: '前髪の揺れ幅',
  fhSoft: '前髪の柔らかさ',
  bangL: '左前髪の位置',
  bangC: '中央前髪の位置',
  bangR: '右前髪の位置',
  bust: '胸元の揺れ幅',
  bustY: '胸元の中心位置',
};

const BASIC_PARAMETER_KEYS = new Set<PsdMotionParameterName>([
  'eyeOpenL',
  'eyeOpenR',
  'mouthOpen',
]);

interface AdvancedParameterControl {
  definition: PsdMotionParameterDefinition;
  range: HTMLInputElement;
  number: HTMLInputElement;
}

const advancedControls = new Map<PsdMotionParameterName, AdvancedParameterControl>();

function formatParameterValue(value: number, step: number): string {
  const decimals = String(step).split('.')[1]?.length ?? 0;
  return value.toFixed(decimals);
}

function normalizeParameterValue(
  definition: PsdMotionParameterDefinition,
  value: number,
): number {
  const clamped = clampValue(
    Number.isFinite(value) ? value : DEFAULT_PSD_MOTION_PARAMETERS[definition.key],
    definition.min,
    definition.max,
  );
  const steps = Math.round((clamped - definition.min) / definition.step);
  return Number((definition.min + steps * definition.step).toFixed(6));
}

function syncAdvancedParameterControl(name: PsdMotionParameterName): void {
  const control = advancedControls.get(name);
  if (!control) return;
  const formatted = formatParameterValue(
    profileParameters[name],
    control.definition.step,
  );
  control.range.value = formatted;
  control.number.value = formatted;
}

function applyProfileParameter(
  definition: PsdMotionParameterDefinition,
  value: number,
  announce = true,
): void {
  profileParameters = {
    ...profileParameters,
    [definition.key]: normalizeParameterValue(definition, value),
  };
  syncAdvancedParameterControl(definition.key);
  applyAvatarMotionMode(currentMode);
  if (announce) {
    api.setLabel(
      '細かい設定を変更',
      `${PARAMETER_LABELS[definition.key] ?? definition.label}を${formatParameterValue(profileParameters[definition.key], definition.step)}に設定しました。`,
      0,
    );
  }
}

function resetAdvancedProfileParameters(): void {
  profileParameters = { ...DEFAULT_PSD_MOTION_PARAMETERS };
  for (const name of advancedControls.keys()) syncAdvancedParameterControl(name);
  applyAvatarMotionMode(currentMode);
  api.setLabel('細かい設定を元に戻しました', 'すべて最初の値に戻しました。', 0);
}

function createAdvancedParameterControls(): void {
  const definitions = PSD_MOTION_PARAMETER_DEFINITIONS.filter(
    (definition) => !BASIC_PARAMETER_KEYS.has(definition.key),
  );
  for (const group of ['face', 'eyes', 'mouth', 'physics'] as const) {
    const groupDefinitions = definitions.filter((definition) => definition.group === group);
    const details = document.createElement('details');
    details.className = 'parameter-group';
    details.dataset.parameterGroup = group;
    const summary = document.createElement('summary');
    const label = document.createElement('span');
    label.textContent = PARAMETER_GROUP_LABELS[group];
    const count = document.createElement('span');
    count.className = 'parameter-count';
    count.textContent = `${groupDefinitions.length}項目`;
    summary.append(label, count);
    const grid = document.createElement('div');
    grid.className = 'parameter-grid';
    for (const definition of groupDefinitions) {
      const item = document.createElement('label');
      item.className = 'advanced-item';
      const heading = document.createElement('span');
      heading.className = 'field-head';
      const name = document.createElement('span');
      name.textContent = PARAMETER_LABELS[definition.key] ?? definition.label;
      const defaultValue = document.createElement('span');
      defaultValue.className = 'parameter-default';
      defaultValue.textContent = `最初の値 ${formatParameterValue(DEFAULT_PSD_MOTION_PARAMETERS[definition.key], definition.step)}`;
      heading.append(name, defaultValue);
      const inputRow = document.createElement('span');
      inputRow.className = 'parameter-input-row';
      const range = document.createElement('input');
      range.type = 'range';
      range.id = `parameter-${definition.key}`;
      range.min = String(definition.min);
      range.max = String(definition.max);
      range.step = String(definition.step);
      const number = document.createElement('input');
      number.type = 'number';
      number.id = `parameter-${definition.key}-number`;
      number.className = 'parameter-number';
      number.min = String(definition.min);
      number.max = String(definition.max);
      number.step = String(definition.step);
      number.setAttribute('aria-label', `${name.textContent}の数値`);
      advancedControls.set(definition.key, { definition, range, number });
      syncAdvancedParameterControl(definition.key);
      const update = (input: HTMLInputElement) => {
        demoToken += 1;
        applyProfileParameter(definition, Number(input.value));
      };
      range.addEventListener('input', () => update(range));
      number.addEventListener('change', () => update(number));
      inputRow.append(range, number);
      item.htmlFor = range.id;
      item.append(heading, inputRow);
      grid.append(item);
    }
    details.append(summary, grid);
    advancedParameterGroups.append(details);
  }
}

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function syncMotionTuningControls(): void {
  for (const id of tuningInputIds) {
    const key = tuningKeys[id];
    const percent = Math.round(motionTuning[key] * 100);
    tuningInputs[id]!.value = String(percent);
    tuningOutputs[id]!.value = `${percent}%`;
  }
  tuningPresetValue.value = PRESET_LABELS[currentPreset];
  for (const button of presetButtons) {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.motionPreset === currentPreset),
    );
  }
}

function applyMotionTuning(
  value: Partial<UiMotionTuning>,
  preset: MotionPreset = 'custom',
): void {
  motionTuning = {
    intensity: clampValue(value.intensity ?? motionTuning.intensity, 0, 1.5),
    idleScale: clampValue(value.idleScale ?? motionTuning.idleScale, 0, 1.5),
    breathScale: clampValue(value.breathScale ?? motionTuning.breathScale, 0, 1.5),
    hairWindScale: clampValue(value.hairWindScale ?? motionTuning.hairWindScale, 0, 1.5),
    hairAmplitudeScale: clampValue(
      value.hairAmplitudeScale ?? motionTuning.hairAmplitudeScale,
      0,
      1.5,
    ),
    hairSoftnessScale: clampValue(
      value.hairSoftnessScale ?? motionTuning.hairSoftnessScale,
      0,
      1.2,
    ),
    dragScale: clampValue(value.dragScale ?? motionTuning.dragScale, 0, 1.5),
  };
  currentPreset = preset;
  avatar?.setIntensity(motionTuning.intensity);
  avatar?.setMotionTuning(motionTuning);
  syncMotionTuningControls();
}

function syncControls(): void {
  eyeControl.value = String(Math.round(eyeOpen * 100));
  mouthControl.value = String(Math.round(mouthOpen * 100));
  eyeValue.value = `${eyeControl.value}%`;
  mouthValue.value = `${mouthControl.value}%`;
  zoomControl.value = String(Math.round(viewScale * 100));
  zoomValue.value = `${zoomControl.value}%`;
}

function syncBlinkControls(): void {
  const label = autoBlinkEnabled ? 'ON' : 'OFF';
  blinkToggle.textContent = label;
  blinkToggle.setAttribute('aria-pressed', String(autoBlinkEnabled));
  blinkValue.value = label;
}

function syncViewTransform(): void {
  avatar?.setViewTransform(viewOffsetX, viewOffsetY, viewScale);
  zoomControl.value = String(Math.round(viewScale * 100));
  zoomValue.value = `${zoomControl.value}%`;
}

function setProgress(progress: number): void {
  const normalized = Math.max(0, Math.min(1, progress));
  progressNode.style.width = `${normalized * 100}%`;
  progressTrack.setAttribute('aria-valuenow', String(Math.round(normalized * 100)));
}

function setViewScale(nextScale: number, origin?: { x: number; y: number }): void {
  const scale = Math.max(0.5, Math.min(2, nextScale));
  if (origin && Math.abs(scale - viewScale) > 1e-6) {
    const ratio = scale / viewScale;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    viewOffsetX = origin.x - centerX - (origin.x - centerX - viewOffsetX) * ratio;
    viewOffsetY = origin.y - centerY - (origin.y - centerY - viewOffsetY) * ratio;
  }
  viewScale = scale;
  syncViewTransform();
}

function canvasPoint(clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * canvas.width,
    y: ((clientY - rect.top) / rect.height) * canvas.height,
  };
}

function applyAvatarMotionMode(mode: QaMode): void {
  if (!avatar) return;
  const profile: PsdMotionProfile = createDefaultPsdMotionProfile();
  profile.parameters = {
    ...profileParameters,
    eyeOpenL: eyeOpen,
    eyeOpenR: eyeOpen,
    mouthOpen: 0,
  };
  profile.automation = {
    idle: mode === 'idle-physics',
    randomMotion: false,
    blink: autoBlinkEnabled,
    physics: mode !== 'static',
  };
  avatar.setMotionEnabled(true);
  avatar.setIntensity(motionTuning.intensity);
  avatar.setMotionTuning(motionTuning);
  avatar.setMotionProfile(profile);
  avatar.setEyeOpen(autoBlinkEnabled ? null : eyeOpen);
  avatar.setMouthOpen(mouthOpen);
}

function selectMode(mode: QaMode): void {
  currentMode = mode;
  api.setMode(mode);
  for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  const labels: Record<QaMode, string> = { static: '静止表示', physics: '髪揺れ', 'idle-physics': '全身＋髪' };
  const details: Record<QaMode, string> = {
    static: '自動まばたき以外のモーションを止めます。',
    physics: '顔と胴体を固定し、髪だけを動かします。',
    'idle-physics': '呼吸・上半身・髪をまとめて動かします。',
  };
  api.setLabel(labels[mode], details[mode], 0);
}

async function runDemo(): Promise<void> {
  const token = ++demoToken;
  selectMode('static');
  api.setLabel('動きを自動チェック', '口 → まばたき → 髪揺れ → 全身＋髪', 0.05);
  for (let cycle = 0; cycle < 2 && token === demoToken; cycle += 1) {
    for (let step = 0; step <= 10 && token === demoToken; step += 1) { api.setState(1, step / 10); syncControls(); await delay(55); }
    for (let step = 9; step >= 0 && token === demoToken; step -= 1) { api.setState(1, step / 10); syncControls(); await delay(55); }
  }
  api.setLabel('動きを自動チェック', 'まばたきを確認中', 0.35);
  for (let cycle = 0; cycle < 2 && token === demoToken; cycle += 1) {
    for (let step = 10; step >= 0 && token === demoToken; step -= 1) { api.setState(step / 10, 0); syncControls(); await delay(42); }
    await delay(160);
    for (let step = 1; step <= 10 && token === demoToken; step += 1) { api.setState(step / 10, 0); syncControls(); await delay(42); }
  }
  if (token !== demoToken) return;
  api.setState(1, 0); syncControls(); selectMode('physics'); api.setLabel('動きを自動チェック', '髪揺れを確認中', 0.62); await delay(3500);
  if (token !== demoToken) return;
  selectMode('idle-physics'); api.setLabel('動きを自動チェック', '全身＋髪を確認中', 0.82); await delay(5000);
  if (token !== demoToken) return;
  selectMode('static'); api.setLabel('自動チェック完了', '続けて個別の操作を試せます。', 1);
}

const api: RigQaApi = {
  ready: false,
  error: null,
  summary: null,
  anchors: {},
  setState(nextEyeOpen, nextMouthOpen) {
    const previousEyeOpen = eyeOpen;
    eyeOpen = Math.max(0, Math.min(1, nextEyeOpen));
    mouthOpen = Math.max(0, Math.min(1, nextMouthOpen));
    if (avatar && autoBlinkEnabled && Math.abs(previousEyeOpen - eyeOpen) > 1e-6) {
      applyAvatarMotionMode(currentMode);
    } else {
      avatar?.setEyeOpen(autoBlinkEnabled ? null : eyeOpen);
    }
    avatar?.setMouthOpen(mouthOpen);
  },
  setMode(mode) {
    currentMode = mode;
    applyAvatarMotionMode(mode);
  },
  setAutoBlink(enabled) {
    autoBlinkEnabled = enabled;
    syncBlinkControls();
    applyAvatarMotionMode(currentMode);
  },
  getAutoBlink() { return autoBlinkEnabled; },
  getEyeOpen() { return avatar?.getEyeOpen() ?? { left: eyeOpen, right: eyeOpen }; },
  setLabel(phase, detail = '', progress = 0) {
    phaseNode.textContent = phase;
    detailNode.textContent = detail;
    setProgress(progress);
  },
  setBackground(mode) {
    document.body.dataset.qaBackground = mode === 'solid' ? 'solid' : 'checker';
  },
  setViewTransform(offsetX, offsetY, scale) {
    viewOffsetX = offsetX;
    viewOffsetY = offsetY;
    viewScale = Math.max(0.5, Math.min(2, scale));
    syncViewTransform();
  },
  getViewTransform() { return { offsetX: viewOffsetX, offsetY: viewOffsetY, scale: viewScale }; },
  getDragMotion() { return avatar?.getDragMotion() ?? { x: 0, y: 0 }; },
  setMotionTuning(value) { applyMotionTuning(value); },
  getMotionTuning() { return { ...motionTuning }; },
  setProfileParameter(name, value) {
    const definition = PSD_MOTION_PARAMETER_DEFINITIONS.find(
      (candidate) => candidate.key === name,
    );
    if (!definition || BASIC_PARAMETER_KEYS.has(name)) return;
    applyProfileParameter(definition, value, false);
  },
  getProfileParameters() { return { ...profileParameters }; },
  resetProfileParameters() { resetAdvancedProfileParameters(); },
  getAverageFps() { return avatar?.getAverageFps() ?? 0; },
};
window.rigQa = api;

function setLoadingState(fileName: string): void {
  demoToken += 1;
  api.error = null;
  statusNode.textContent = '読込中';
  phaseNode.textContent = 'PSDを読み込み中';
  detailNode.textContent = `${fileName} をブラウザ内で解析しています。`;
  setProgress(0.36);
  document.body.dataset.fileLoadState = 'loading';
}

function showLoadError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  api.error = message;
  api.ready = Boolean(avatar);
  statusNode.textContent = avatar ? '表示中・読込エラー' : '読込エラー';
  phaseNode.textContent = 'PSDを読み込めませんでした';
  detailNode.textContent = avatar
    ? `${message}（現在のモデルはそのまま操作できます）`
    : message;
  reportNode.textContent = message;
  setProgress(0);
  document.body.dataset.fileLoadState = 'error';
}

async function activatePsd(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<void> {
  const token = ++loadToken;
  setLoadingState(fileName);
  const detection = await detectAnime25RigFromBuffer(buffer);
  if (token !== loadToken) return;
  if (!detection.usable || !detection.rig || !detection.summary) {
    throw new Error(detection.reason || 'Anime2.5リグとして利用できないPSDです。');
  }

  const nextAvatar = createAnime25RigAvatar(canvas, detection.rig);
  if (token !== loadToken) {
    nextAvatar.dispose();
    return;
  }
  const previousAvatar = avatar;
  avatar = nextAvatar;
  previousAvatar?.dispose();

  viewOffsetX = 0;
  viewOffsetY = 0;
  viewScale = DEFAULT_VIEW_SCALE;
  dragState = null;
  document.body.dataset.avatarDragging = 'false';
  syncViewTransform();

  api.summary = detection.summary;
  api.anchors = detection.rig.anchors;
  api.error = null;
  api.ready = true;
  modelNode.textContent = fileName;
  document.body.dataset.avatarReady = 'true';
  setAvatarControlsDisabled(false);
  currentMode = 'static';
  selectMode('static');
  api.setState(eyeOpen, mouthOpen);
  syncControls();
  statusNode.textContent = '準備完了';
  reportNode.textContent = JSON.stringify({ summary: detection.summary, anchors: detection.rig.anchors }, null, 2);
  api.setLabel('PSD読み込み完了', '「動きを自動チェック」または個別の操作を試せます。', 1);
  document.body.dataset.fileLoadState = 'ready';
}

function isPsdFile(file: File): boolean {
  return /\.psd$/i.test(file.name) || file.type === 'image/vnd.adobe.photoshop';
}

async function loadLocalPsd(file: File): Promise<void> {
  if (!isPsdFile(file)) {
    throw new Error('PSDファイル（.psd）を選択してください。');
  }
  generatedPsdSelect.value = '';
  await activatePsd(await file.arrayBuffer(), file.name);
}

function generatedPsdLabel(item: GeneratedPsd): string {
  const readiness = item.productionReady === true
    ? 'レイヤー構造確認済み'
    : item.productionReady === false
      ? '要確認'
      : '';
  return readiness ? `${item.name} · ${readiness}` : item.name;
}

async function loadGeneratedPsd(item: GeneratedPsd): Promise<void> {
  const token = ++loadToken;
  setLoadingState(item.name);
  const response = await fetch(item.url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`生成済みPSDを読み込めませんでした（${response.status}）。`);
  const buffer = await response.arrayBuffer();
  if (token !== loadToken) return;
  await activatePsd(buffer, item.name);
  generatedPsdSelect.value = item.id;
}

async function refreshGeneratedPsdList(autoLoad = false): Promise<void> {
  generatedPsdRefresh.disabled = true;
  generatedPsdNote.textContent = '生成済みPSDを検索しています…';
  try {
    const response = await fetch('/api/generated-psds', { cache: 'no-store' });
    if (!response.ok) throw new Error(`一覧の取得に失敗しました（${response.status}）。`);
    const payload = await response.json() as { items?: GeneratedPsd[] };
    generatedPsds = Array.isArray(payload.items) ? payload.items : [];
    const previousValue = generatedPsdSelect.value;
    generatedPsdSelect.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = generatedPsds.length
      ? '生成済みPSDを選択'
      : '生成済みPSDはありません';
    generatedPsdSelect.append(placeholder);
    for (const item of generatedPsds) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = generatedPsdLabel(item);
      generatedPsdSelect.append(option);
    }
    generatedPsdSelect.disabled = generatedPsds.length === 0;
    generatedPsdNote.textContent = generatedPsds.length
      ? `${generatedPsds.length}件を検出しました。新しいPSDを先頭に表示しています。`
      : '生成が完了したPSDはここへ自動的に表示されます。';
    if (generatedPsds.some((item) => item.id === previousValue)) {
      generatedPsdSelect.value = previousValue;
    }
    if (autoLoad && generatedPsds[0]) {
      await loadGeneratedPsd(generatedPsds[0]);
    } else if (!avatar && generatedPsds.length > 0) {
      api.setLabel('生成済みPSDを選択できます', '一覧から選ぶか、手元のPSDを読み込んでください。', 0);
    }
  } catch (error) {
    generatedPsds = [];
    generatedPsdSelect.disabled = true;
    generatedPsdSelect.replaceChildren(new Option('一覧を取得できませんでした', ''));
    generatedPsdNote.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    generatedPsdRefresh.disabled = false;
  }
}

function setAvatarControlsDisabled(disabled: boolean): void {
  const controls: Array<HTMLInputElement | HTMLButtonElement> = [
    eyeControl,
    mouthControl,
    blinkToggle,
    zoomControl,
    viewReset,
    ...modeButtons,
    ...presetButtons,
    ...Object.values(tuningInputs),
    ...[...advancedControls.values()].flatMap((control) => [control.range, control.number]),
    advancedReset,
    demoStart,
    demoStop,
  ];
  for (const control of controls) control.disabled = disabled;
}

function installEventListeners(): void {
  createAdvancedParameterControls();
  canvas.getContext('webgl', {
    alpha: true,
    stencil: true,
    antialias: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  });

  psdFileInput.addEventListener('change', () => {
    const file = psdFileInput.files?.[0];
    psdFileInput.value = '';
    if (!file) return;
    void loadLocalPsd(file).catch(showLoadError);
  });

  generatedPsdSelect.addEventListener('change', () => {
    const item = generatedPsds.find((candidate) => candidate.id === generatedPsdSelect.value);
    if (!item) return;
    void loadGeneratedPsd(item).catch(showLoadError);
  });
  generatedPsdRefresh.addEventListener('click', () => {
    void refreshGeneratedPsdList(!avatar).catch(showLoadError);
  });

  let fileDragDepth = 0;
  const hasFiles = (event: DragEvent): boolean =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files');
  const hideDropOverlay = (): void => {
    fileDragDepth = 0;
    document.body.dataset.fileDragging = 'false';
    dropOverlay.setAttribute('aria-hidden', 'true');
  };
  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    fileDragDepth += 1;
    document.body.dataset.fileDragging = 'true';
    dropOverlay.setAttribute('aria-hidden', 'false');
  });
  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    fileDragDepth = Math.max(0, fileDragDepth - 1);
    if (fileDragDepth === 0) hideDropOverlay();
  });
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files ?? []);
    hideDropOverlay();
    const file = files.find(isPsdFile) ?? files[0];
    if (!file) return;
    void loadLocalPsd(file).catch(showLoadError);
  });

  eyeControl.addEventListener('input', () => {
    demoToken += 1;
    api.setState(Number(eyeControl.value) / 100, mouthOpen);
    syncControls();
    api.setLabel('手動操作', '目の開閉を調整中', Number(eyeControl.value) / 100);
  });
  mouthControl.addEventListener('input', () => {
    demoToken += 1;
    api.setState(eyeOpen, Number(mouthControl.value) / 100);
    syncControls();
    api.setLabel('手動操作', '口の開閉を調整中', Number(mouthControl.value) / 100);
  });
  blinkToggle.addEventListener('click', () => {
    demoToken += 1;
    api.setAutoBlink(!autoBlinkEnabled);
    api.setLabel(
      '自動まばたき',
      autoBlinkEnabled ? '自然な間隔で自動的にまばたきします。' : '自動まばたきを停止しました。',
      autoBlinkEnabled ? 1 : 0,
    );
  });
  zoomControl.addEventListener('input', () => {
    setViewScale(Number(zoomControl.value) / 100);
    api.setLabel('表示操作', `倍率 ${zoomControl.value}%`, Number(zoomControl.value) / 200);
  });
  viewReset.addEventListener('click', () => {
    viewOffsetX = 0;
    viewOffsetY = 0;
    viewScale = DEFAULT_VIEW_SCALE;
    avatar?.resetDragMotion();
    syncViewTransform();
    api.setLabel('表示をリセット', '位置と倍率を初期状態へ戻しました。', 0);
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !avatar) return;
    dragState = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, time: performance.now() };
    avatar?.setDragMotion(0, 0, true);
    canvas.setPointerCapture(event.pointerId);
    document.body.dataset.avatarDragging = 'true';
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    const deltaX = ((event.clientX - dragState.clientX) / rect.width) * canvas.width;
    const deltaY = ((event.clientY - dragState.clientY) / rect.height) * canvas.height;
    const now = performance.now();
    const elapsed = Math.max(8, Math.min(50, now - dragState.time));
    viewOffsetX += deltaX;
    viewOffsetY += deltaY;
    avatar?.setDragMotion(deltaX / elapsed / 4, deltaY / elapsed / 4, true);
    dragState.clientX = event.clientX;
    dragState.clientY = event.clientY;
    dragState.time = now;
    syncViewTransform();
  });
  const endDrag = (event: PointerEvent) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragState = null;
    avatar?.setDragMotion(0, 0, false);
    document.body.dataset.avatarDragging = 'false';
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    setViewScale(viewScale * Math.exp(-event.deltaY * 0.001), canvasPoint(event.clientX, event.clientY));
    api.setLabel('表示操作', `倍率 ${Math.round(viewScale * 100)}%`, viewScale / 2);
  }, { passive: false });
  for (const button of modeButtons) button.addEventListener('click', () => {
    demoToken += 1;
    selectMode((button.dataset.mode ?? 'static') as QaMode);
  });
  for (const button of presetButtons) button.addEventListener('click', () => {
    const preset = button.dataset.motionPreset as Exclude<MotionPreset, 'custom'>;
    if (!MOTION_PRESETS[preset]) return;
    demoToken += 1;
    applyMotionTuning(MOTION_PRESETS[preset], preset);
    api.setLabel(
      `${PRESET_LABELS[preset]}モーション`,
      '現在のPSDへ動きの強さを反映しました。',
      motionTuning.intensity / 1.5,
    );
  });
  for (const id of tuningInputIds) {
    tuningInputs[id]!.addEventListener('input', () => {
      demoToken += 1;
      const key = tuningKeys[id];
      applyMotionTuning({ [key]: Number(tuningInputs[id]!.value) / 100 });
      api.setLabel(
        'モーションを微調整',
        `${tuningOutputs[id]!.closest('.tuning-item')?.querySelector('span span')?.textContent ?? 'パラメータ'}を${tuningInputs[id]!.value}%に設定しました。`,
        Number(tuningInputs[id]!.value) / Number(tuningInputs[id]!.max),
      );
    });
  }
  advancedReset.addEventListener('click', () => {
    demoToken += 1;
    resetAdvancedProfileParameters();
  });
  demoStart.addEventListener('click', () => { void runDemo(); });
  demoStop.addEventListener('click', () => {
    demoToken += 1;
    api.setState(1, 0); syncControls(); selectMode('static');
    api.setLabel('停止しました', '自由に操作できます。', 0);
  });
  syncControls();
  syncBlinkControls();
  syncMotionTuningControls();
  setAvatarControlsDisabled(true);
}

async function run(): Promise<void> {
  installEventListeners();
  const params = new URLSearchParams(window.location.search);
  const psdUrl = params.get('psd');
  await refreshGeneratedPsdList(!psdUrl && params.get('autoload') !== '0');
  if (!psdUrl) return;
  const selectedModel = psdUrl.split('/').pop() ?? 'avatar.psd';
  try {
    const response = await fetch(psdUrl);
    if (!response.ok) throw new Error(`PSD fetch failed: ${response.status}`);
    await activatePsd(await response.arrayBuffer(), selectedModel);
  } catch (error) {
    showLoadError(error);
  }
}

void run();
