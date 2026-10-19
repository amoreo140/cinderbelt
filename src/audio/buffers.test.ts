import { describe, expect, it } from 'vitest';
import {
  applyLoopFade,
  fillBrownNoise,
  fillCrackle,
  fillImpulseResponse,
  fillPinkNoise,
  fillSoftClipCurve,
  fillWhiteNoise,
  normalizePeak,
  peakOf,
  removeDc,
} from './buffers';
import { mulberry32 } from './math';

const SR = 8000;

function mean(data: Float32Array): number {
  let s = 0;
  for (const v of data) s += v;
  return s / data.length;
}

function rms(data: Float32Array): number {
  let s = 0;
  for (const v of data) s += v * v;
  return Math.sqrt(s / data.length);
}

/** Mean absolute change between neighbouring samples - a measure of "sharpness". */
function roughness(data: Float32Array): number {
  let s = 0;
  for (let i = 1; i < data.length; i++) s += Math.abs(data[i]! - data[i - 1]!);
  return s / (data.length - 1);
}

describe('noise generators', () => {
  it('white noise is bounded and roughly zero-mean', () => {
    const d = new Float32Array(SR);
    fillWhiteNoise(d, mulberry32(1));
    expect(peakOf(d)).toBeLessThanOrEqual(1);
    expect(Math.abs(mean(d))).toBeLessThan(0.05);
  });

  it('pink and brown noise are progressively smoother than white', () => {
    const white = new Float32Array(SR);
    const pink = new Float32Array(SR);
    const brown = new Float32Array(SR);
    fillWhiteNoise(white, mulberry32(2));
    fillPinkNoise(pink, mulberry32(2));
    fillBrownNoise(brown, mulberry32(2));
    const rw = roughness(white) / rms(white);
    const rp = roughness(pink) / rms(pink);
    const rb = roughness(brown) / rms(brown);
    expect(rp).toBeLessThan(rw);
    expect(rb).toBeLessThan(rp);
  });

  it('pink and brown noise are normalized below clipping', () => {
    const pink = new Float32Array(SR);
    const brown = new Float32Array(SR);
    fillPinkNoise(pink, mulberry32(3));
    fillBrownNoise(brown, mulberry32(3));
    expect(peakOf(pink)).toBeCloseTo(0.9, 5);
    expect(peakOf(brown)).toBeCloseTo(0.9, 5);
    expect(Math.abs(mean(brown))).toBeLessThan(0.01);
  });
});

describe('buffer utilities', () => {
  it('removeDc centers the signal', () => {
    const d = new Float32Array([1, 2, 3]);
    removeDc(d);
    expect(mean(d)).toBeCloseTo(0);
  });

  it('normalizePeak scales to target and ignores silence', () => {
    const d = new Float32Array([0.1, -0.2]);
    normalizePeak(d, 1);
    expect(peakOf(d)).toBeCloseTo(1);
    const silent = new Float32Array(4);
    normalizePeak(silent, 1);
    expect(peakOf(silent)).toBe(0);
  });

  it('applyLoopFade zeroes both ends', () => {
    const d = new Float32Array(100).fill(1);
    applyLoopFade(d, 10);
    expect(d[0]).toBe(0);
    expect(d[99]).toBe(0);
    expect(d[50]).toBe(1);
  });
});

describe('fillCrackle', () => {
  it('is sparse, bounded and silent at the loop boundary', () => {
    const d = new Float32Array(SR * 2);
    fillCrackle(d, SR, mulberry32(5));
    expect(peakOf(d)).toBeCloseTo(0.95, 5);
    let silent = 0;
    for (const v of d) if (Math.abs(v) < 1e-6) silent++;
    expect(silent / d.length).toBeGreaterThan(0.3);
    const tail = d.subarray(d.length - Math.floor(SR * 0.01));
    expect(peakOf(tail)).toBe(0);
  });

  it('density controls the amount of crackle', () => {
    const sparse = new Float32Array(SR * 2);
    const dense = new Float32Array(SR * 2);
    fillCrackle(sparse, SR, mulberry32(6), { density: 10, minGrain: 0.002, maxGrain: 0.004 });
    fillCrackle(dense, SR, mulberry32(6), { density: 200, minGrain: 0.002, maxGrain: 0.004 });
    const active = (d: Float32Array) => d.filter((v) => Math.abs(v) > 1e-6).length;
    expect(active(dense)).toBeGreaterThan(active(sparse) * 3);
  });
});

describe('fillImpulseResponse', () => {
  it('decays over time and starts with a short fade-in', () => {
    const d = new Float32Array(SR * 2);
    fillImpulseResponse(d, SR, mulberry32(7));
    expect(Math.abs(d[0]!)).toBe(0);
    const early = rms(d.subarray(0, SR / 4));
    const late = rms(d.subarray(d.length - SR / 4));
    expect(late).toBeLessThan(early * 0.2);
    expect(peakOf(d)).toBeCloseTo(0.8, 5);
  });
});

describe('fillSoftClipCurve', () => {
  it('is symmetric, monotonic and maps ±1 to ±1', () => {
    const c = new Float32Array(257);
    fillSoftClipCurve(c, 2);
    expect(c[0]).toBeCloseTo(-1);
    expect(c[256]).toBeCloseTo(1);
    expect(c[128]).toBeCloseTo(0);
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThanOrEqual(c[i - 1]!);
  });
});
