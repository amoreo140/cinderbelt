// Procedural generation of samples into a Float32Array (noise, crackle, reverb impulse response).
// Pure functions - a Web Audio buffer is only filled with their output.

import type { Rng } from './math';

/** White noise in the range -1..1. */
export function fillWhiteNoise(out: Float32Array, rand: Rng): void {
  for (let i = 0; i < out.length; i++) out[i] = rand() * 2 - 1;
}

/** Pink noise (Paul Kellet) - softer, "airy". */
export function fillPinkNoise(out: Float32Array, rand: Rng): void {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < out.length; i++) {
    const white = rand() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  normalizePeak(out, 0.9);
}

/** Brown noise - a deep rumble (integrated white noise with leakage). */
export function fillBrownNoise(out: Float32Array, rand: Rng): void {
  let last = 0;
  for (let i = 0; i < out.length; i++) {
    const white = rand() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    out[i] = last;
  }
  removeDc(out);
  normalizePeak(out, 0.9);
}

/** Removes the DC component (mean) so the loop does not click. */
export function removeDc(out: Float32Array): void {
  if (out.length === 0) return;
  let sum = 0;
  for (let i = 0; i < out.length; i++) sum += out[i]!;
  const mean = sum / out.length;
  for (let i = 0; i < out.length; i++) out[i] = out[i]! - mean;
}

export function peakOf(data: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]!));
  return peak;
}

export function normalizePeak(out: Float32Array, target: number): void {
  const peak = peakOf(out);
  if (peak <= 0) return;
  const k = target / peak;
  for (let i = 0; i < out.length; i++) out[i] = out[i]! * k;
}

/**
 * A short crossfade of the start and end so the buffer is safe as a loop
 * (no jump at the boundary).
 */
export function applyLoopFade(out: Float32Array, fadeSamples: number): void {
  const n = Math.min(fadeSamples, Math.floor(out.length / 2));
  for (let i = 0; i < n; i++) {
    const g = i / n;
    out[i] = out[i]! * g;
    out[out.length - 1 - i] = out[out.length - 1 - i]! * g;
  }
}

export interface CrackleOptions {
  /** Average number of "crackles" per second. */
  density: number;
  /** Range of the length of one crackle in seconds. */
  minGrain: number;
  maxGrain: number;
}

export const DEFAULT_CRACKLE: CrackleOptions = { density: 55, minGrain: 0.0015, maxGrain: 0.008 };

/**
 * Sparse short bursts of noise with a fast decay - the "crackle" of rock
 * under the laser. The output is loop-ready.
 */
export function fillCrackle(out: Float32Array, sampleRate: number, rand: Rng, options: CrackleOptions = DEFAULT_CRACKLE): void {
  out.fill(0);
  const guard = Math.floor(sampleRate * 0.01);
  const probability = options.density / sampleRate;
  let i = 0;
  while (i < out.length - guard) {
    if (rand() < probability) {
      const len = Math.max(2, Math.floor(sampleRate * (options.minGrain + (options.maxGrain - options.minGrain) * rand())));
      const amp = 0.25 + 0.75 * rand() * rand();
      for (let j = 0; j < len && i + j < out.length - guard; j++) {
        const env = Math.exp((-5 * j) / len);
        out[i + j] = out[i + j]! + (rand() * 2 - 1) * amp * env;
      }
      i += len;
    } else {
      i++;
    }
  }
  normalizePeak(out, 0.95);
}

export interface ReverbOptions {
  /** Reverb length in seconds. */
  seconds: number;
  /** Speed of the exponential decay (larger = shorter). */
  decay: number;
  /** 0..1 - how much the tail darkens (high-frequency damping over time). */
  damping: number;
}

export const DEFAULT_REVERB: ReverbOptions = { seconds: 3.2, decay: 2.4, damping: 0.6 };

/**
 * Impulse response for a ConvolverNode: noise with an exponential decay
 * that gradually darkens - a soft "space" room.
 */
export function fillImpulseResponse(out: Float32Array, sampleRate: number, rand: Rng, options: ReverbOptions = DEFAULT_REVERB): void {
  const fadeIn = Math.floor(sampleRate * 0.004);
  let lp = 0;
  for (let i = 0; i < out.length; i++) {
    const progress = i / Math.max(1, out.length);
    const env = Math.pow(1 - progress, options.decay) * (i < fadeIn ? i / fadeIn : 1);
    // one-pole low-pass filter with rising damping
    const coef = Math.min(0.97, options.damping * progress + 0.05);
    lp = lp * coef + (rand() * 2 - 1) * (1 - coef);
    out[i] = lp * env;
  }
  normalizePeak(out, 0.8);
}

/** Soft saturation curve for a WaveShaperNode (tanh). */
export function fillSoftClipCurve(out: Float32Array, drive: number): void {
  const n = out.length;
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    out[i] = Math.tanh(x * drive) / norm;
  }
}
