// Demo page of the audio module (audio-demo.html) - simulates calls from the game.

import type { ResourceId } from '../data/resources';
import { AudioEngine } from './index';

declare global {
  interface Window {
    /** For debugging in the browser console. */
    cinderAudio?: AudioEngine;
  }
}

const audio = new AudioEngine();
audio.attachUnlock(window);
window.cinderAudio = audio;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

/** A slider that prints its value in the neighbouring <output>. */
function slider(id: string, onInput?: (value: number) => void): () => number {
  const input = el<HTMLInputElement>(id);
  const out = input.parentElement?.querySelector('output');
  const update = () => {
    if (out) out.textContent = Number(input.value).toFixed(2);
    onInput?.(Number(input.value));
  };
  input.addEventListener('input', update);
  update();
  return () => Number(input.value);
}

// ---------- volume ----------
slider('vol-master', (v) => audio.setVolumes({ master: v }));
slider('vol-sfx', (v) => audio.setVolumes({ sfx: v }));
slider('vol-ambient', (v) => audio.setVolumes({ ambient: v }));
const muteBtn = el<HTMLButtonElement>('mute');
muteBtn.addEventListener('click', () => {
  const muted = audio.toggleMute();
  muteBtn.textContent = muted ? 'Unmute' : 'Mute';
  muteBtn.classList.toggle('on', muted);
});

// ---------- engine ----------
const thrMain = slider('thr-main');
const thrReverse = slider('thr-reverse');
const thrSide = slider('thr-side');
el('thr-stop').addEventListener('click', () => {
  for (const id of ['thr-main', 'thr-reverse', 'thr-side']) {
    const input = el<HTMLInputElement>(id);
    input.value = '0';
    input.dispatchEvent(new Event('input'));
  }
});

const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.code === 'Space') e.preventDefault();
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// ---------- laser ----------
const laserOn = el<HTMLInputElement>('laser-on');
const laserHit = el<HTMLInputElement>('laser-hit');
const resourceSelect = el<HTMLSelectElement>('laser-resource');
const resource = () => resourceSelect.value as ResourceId;

// ---------- impact ----------
const impactIntensity = slider('impact-intensity');
const impactPan = slider('impact-pan');
el('impact').addEventListener('click', () => audio.playImpact(impactIntensity(), { pan: impactPan() }));
for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-impact]')) {
  btn.addEventListener('click', () => audio.playImpact(Number(btn.dataset.impact), { pan: impactPan() }));
}

// ---------- resources and alerts ----------
const collectSpam = el<HTMLInputElement>('collect-spam');
el('collect').addEventListener('click', () => audio.playResourceCollected(resource()));
el('alert-cargo').addEventListener('click', () => audio.playAlert('cargoFull'));
el('alert-fuel').addEventListener('click', () => audio.playAlert('outOfFuel'));

// ---------- ship and UI ----------
let dampersOn = false;
const dampersBtn = el<HTMLButtonElement>('dampers');
dampersBtn.addEventListener('click', () => {
  dampersOn = !dampersOn;
  audio.playDampers(dampersOn);
  dampersBtn.textContent = `Dampers: ${dampersOn ? 'on' : 'off'}`;
  dampersBtn.classList.toggle('on', dampersOn);
});
el('dock').addEventListener('click', () => audio.playDock());
el('undock').addEventListener('click', () => audio.playUndock());

const uiSounds = el<HTMLInputElement>('ui-sounds');
for (const btn of document.querySelectorAll<HTMLButtonElement>('button')) {
  btn.addEventListener('pointerenter', () => {
    if (uiSounds.checked) audio.playUi('hover');
  });
}
// interface click only for buttons without a sound of their own
for (const id of ['mute', 'thr-stop', 'ambient-toggle']) {
  el(id).addEventListener('click', () => {
    if (uiSounds.checked) audio.playUi('click');
  });
}

// ---------- ambience ----------
const ambientBtn = el<HTMLButtonElement>('ambient-toggle');
const ringButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-ring]')];
function refreshAmbientUi(): void {
  const { running, ring } = audio.ambientState;
  ambientBtn.textContent = running ? 'Turn ambience off' : 'Turn ambience on';
  ambientBtn.classList.toggle('on', running);
  for (const b of ringButtons) b.classList.toggle('on', Number(b.dataset.ring) === ring);
}
ambientBtn.addEventListener('click', () => {
  if (audio.ambientState.running) audio.stopAmbient();
  else audio.startAmbient();
  refreshAmbientUi();
});
for (const b of ringButtons) {
  b.addEventListener('click', () => {
    audio.setAmbientRing(Number(b.dataset.ring));
    if (uiSounds.checked) audio.playUi('click');
    refreshAmbientUi();
  });
}
refreshAmbientUi();

// ---------- status and oscilloscope ----------
const statusEl = el('status');
const scope = el<HTMLCanvasElement>('scope');
const scopeCtx = scope.getContext('2d');
let analyser: AnalyserNode | null = null;
let samples: Float32Array<ArrayBuffer> | null = null;

const STATUS_TEXT: Record<string, string> = {
  locked: 'Audio is locked - click anywhere',
  running: 'Audio running',
  suspended: 'Suspended',
  closed: 'Closed',
  unsupported: 'This browser does not support Web Audio',
};

function drawScope(): void {
  if (!scopeCtx) return;
  const w = (scope.width = scope.clientWidth * devicePixelRatio);
  const h = (scope.height = scope.clientHeight * devicePixelRatio);
  scopeCtx.clearRect(0, 0, w, h);
  if (!analyser) {
    analyser = audio.createAnalyser(1024);
    if (analyser) samples = new Float32Array(analyser.fftSize);
  }
  if (!analyser || !samples) return;
  analyser.getFloatTimeDomainData(samples);
  scopeCtx.strokeStyle = '#7aa2ff';
  scopeCtx.lineWidth = 1.5 * devicePixelRatio;
  scopeCtx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const x = (i / (samples.length - 1)) * w;
    const y = h / 2 - samples[i]! * (h / 2) * 0.9;
    if (i === 0) scopeCtx.moveTo(x, y);
    else scopeCtx.lineTo(x, y);
  }
  scopeCtx.stroke();
}

// ---------- game loop (as in the game: calls every frame) ----------
function frame(): void {
  const keyMain = keys.has('KeyW') ? 1 : 0;
  const keyReverse = keys.has('KeyS') ? 1 : 0;
  const keySide = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
  audio.setThrust({
    main: Math.max(thrMain(), keyMain),
    reverse: Math.max(thrReverse(), keyReverse),
    side: keySide !== 0 ? keySide : thrSide(),
  });

  const space = keys.has('Space');
  audio.setMiningLaser({ active: laserOn.checked || space, hitting: laserHit.checked || space, resource: resource() });
  if (collectSpam.checked) audio.playResourceCollected(resource());

  const state = audio.state;
  statusEl.textContent = STATUS_TEXT[state] ?? state;
  statusEl.classList.toggle('running', state === 'running');
  refreshAmbientUi();
  drawScope();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
