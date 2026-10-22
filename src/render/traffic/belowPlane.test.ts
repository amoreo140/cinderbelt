import { describe, expect, it } from 'vitest';
import { BELOW_DARKEN, BELOW_DESATURATE, BELOW_FLAME_DIM, BELOW_FULL_DEPTH, BELOW_HAZE, belowPlaneFade } from './belowPlane';

describe('belowPlaneFade', () => {
  it('is zero at and above the plane, so a vehicle at its berth looks as the model', () => {
    expect(belowPlaneFade(0)).toBe(0);
    expect(belowPlaneFade(0.6)).toBe(0);
    expect(belowPlaneFade(2.2)).toBe(0);
    expect(belowPlaneFade(40)).toBe(0);
  });

  it('is full at the full depth and deeper', () => {
    expect(belowPlaneFade(-BELOW_FULL_DEPTH)).toBe(1);
    expect(belowPlaneFade(-70)).toBe(1);
  });

  it('ramps up smoothly and monotonically with depth', () => {
    let prev = 0;
    for (let d = 0; d <= BELOW_FULL_DEPTH; d += 0.25) {
      const f = belowPlaneFade(-d);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    expect(belowPlaneFade(-BELOW_FULL_DEPTH / 2)).toBeCloseTo(0.5, 5);
    // the docking wobble of a berthed vehicle is invisible
    expect(belowPlaneFade(-0.08)).toBeLessThan(0.001);
  });

  it('keeps the full effect gentle', () => {
    expect(BELOW_DESATURATE).toBeCloseTo(0.35);
    expect(BELOW_DARKEN).toBeCloseTo(0.25);
    expect(BELOW_HAZE).toBeLessThanOrEqual(0.15);
    expect(BELOW_FLAME_DIM).toBeLessThanOrEqual(0.4);
  });
});
