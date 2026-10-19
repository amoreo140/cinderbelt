import { describe, expect, it } from 'vitest';
import {
  DRS_BOUNCE,
  DRS_FAST_WINDOWS,
  DRS_LIMITS,
  DRS_SETTLE,
  DRS_SLOW_WINDOWS,
  DRS_UP_COOLDOWN,
  DRS_WINDOW,
  DynamicResolution,
  RENDER_SCALES,
} from './dynamicResolution';

/**
 * Feeds `seconds` of frames of `dt`; the GPU time follows the scale (fixed part + a part per pixel) like
 * a real GPU-bound frame. Returns every scale change.
 */
function run(drs: DynamicResolution, seconds: number, gpu: (scale: number) => number | null, dt = 1 / 60): number[] {
  const out: number[] = [];
  for (let t = 0; t < seconds; t += dt) {
    const s = drs.frame(dt, gpu(drs.scale));
    if (s !== null) out.push(s);
  }
  return out;
}

/** A GPU whose frame costs `fixed` ms plus `perPixel` ms at full resolution, scaled by the pixel count. */
const gpuOf = (fixed: number, perPixel: number) => (scale: number) => fixed + perPixel * scale * scale;

const STEP = DRS_SETTLE + DRS_WINDOW * DRS_SLOW_WINDOWS + 0.1;

describe('DynamicResolution', () => {
  it('starts at full resolution and stays there on a fast GPU', () => {
    const drs = new DynamicResolution();
    expect(drs.scale).toBe(1);
    expect(run(drs, 60, () => 4)).toEqual([]);
    expect(drs.gpuMs).toBeCloseTo(4);
    expect(drs.holdsQuality).toBe(false);
  });

  it('steps down one scale at a time while the GPU stays over the limit', () => {
    const drs = new DynamicResolution();
    const heavy = gpuOf(2, 30);
    expect(run(drs, STEP, heavy)).toEqual([RENDER_SCALES[1]]);
    expect(run(drs, STEP, heavy)).toEqual([RENDER_SCALES[2]]);
    // at the floor nothing more to give: the preset may step down now
    expect(run(drs, 20, heavy)).toEqual([]);
    expect(drs.holdsQuality).toBe(false);
  });

  it('holds the quality step-down while GPU-bound with room left or settling after a change', () => {
    const drs = new DynamicResolution();
    run(drs, DRS_SETTLE + DRS_WINDOW + 0.1, () => 20);
    expect(drs.holdsQuality).toBe(true);
    run(drs, DRS_WINDOW, () => 20);
    expect(drs.scale).toBe(RENDER_SCALES[1]);
    // settling after the change
    expect(drs.holdsQuality).toBe(true);
  });

  it('does not react to frame time: a CPU-bound frame with a light GPU keeps the resolution', () => {
    const drs = new DynamicResolution();
    // 30 fps frames (CPU-bound), 5 ms of GPU work
    expect(run(drs, 60, () => 5, 1 / 30)).toEqual([]);
    expect(drs.scale).toBe(1);
  });

  it('keeps the scale without timer results (no extension, disjoint events)', () => {
    const drs = new DynamicResolution();
    expect(run(drs, 30, () => null)).toEqual([]);
    expect(drs.gpuMs).toBe(0);
    expect(drs.holdsQuality).toBe(false);
  });

  it('ignores hitches (one long frame is not a slow GPU)', () => {
    const drs = new DynamicResolution();
    for (let i = 0; i < 20; i++) {
      run(drs, 0.5, () => 3);
      drs.frame(0.6, 200);
    }
    expect(drs.scale).toBe(1);
  });

  it('climbs back when the scene gets lighter, after the cooldown, one step at a time', () => {
    const drs = new DynamicResolution();
    run(drs, STEP * 2, () => 20);
    expect(drs.scale).toBe(RENDER_SCALES[2]);
    const light = gpuOf(1, 4);
    const ups = run(drs, DRS_UP_COOLDOWN + (DRS_SETTLE + DRS_WINDOW * DRS_FAST_WINDOWS) * 2 + 1, light);
    expect(ups).toEqual([RENDER_SCALES[1], 1]);
  });

  it('no step up when the larger scale would land near the limit (no ping-pong)', () => {
    const drs = new DynamicResolution();
    // 15 ms at full scale: down to 85 %, where it is ~11 ms – the projection back up is over the fast limit
    const gpu = gpuOf(1, 14);
    expect(run(drs, STEP, gpu)).toEqual([RENDER_SCALES[1]]);
    expect(gpu(RENDER_SCALES[1]!)).toBeLessThan(DRS_LIMITS.slowMs);
    expect(run(drs, 120, gpu)).toEqual([]);
  });

  it('a bounce (a step down soon after a step up) doubles the wait for the next step up', () => {
    const drs = new DynamicResolution();
    let heavy = true;
    const changes: { t: number; s: number }[] = [];
    let t = 0;
    const dt = 1 / 60;
    // a GPU that is slow at full resolution and fast below it: it would flip every few seconds
    for (; t < 300; t += dt) {
      const s = drs.frame(dt, drs.scale === 1 ? (heavy ? 20 : 3) : 4);
      if (s !== null) changes.push({ t, s });
    }
    heavy = false;
    const ups = changes.filter((c) => c.s === 1).map((c) => c.t);
    const downs = changes.filter((c) => c.s < 1).map((c) => c.t);
    expect(downs.length).toBeGreaterThan(1);
    // each step up waits longer than the one before
    const waits = ups.map((u) => u - Math.max(...downs.filter((d) => d < u)));
    for (let i = 1; i < waits.length; i++) expect(waits[i]!).toBeGreaterThan(waits[i - 1]! * 1.5);
    expect(waits.length).toBeLessThan(8);
    expect(DRS_BOUNCE).toBeGreaterThan(DRS_SETTLE + DRS_WINDOW * DRS_SLOW_WINDOWS);
  });

  it('settle() after a preset change and reset() back to full resolution', () => {
    const drs = new DynamicResolution();
    run(drs, STEP, () => 20);
    expect(drs.scale).toBe(RENDER_SCALES[1]);
    drs.settle();
    expect(run(drs, DRS_SETTLE - 0.1, () => 20)).toEqual([]);
    drs.reset();
    expect(drs.scale).toBe(1);
    expect(drs.gpuMs).toBe(0);
  });

  it('limits can be overridden (dev probes force a GPU-heavy configuration)', () => {
    const drs = new DynamicResolution();
    drs.limits = { slowMs: 0.5, fastMs: 0.2 };
    expect(run(drs, STEP, () => 1)).toEqual([RENDER_SCALES[1]]);
  });
});
