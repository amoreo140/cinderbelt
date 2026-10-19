import { describe, expect, it } from 'vitest';
import { trailFade, trailNeedsPoint, trailSpread } from './trailMath';

describe('trail math', () => {
  it('fades from full at the nozzle to nothing at the end of its life', () => {
    expect(trailFade(0, 1)).toBe(1);
    expect(trailFade(0.5, 1)).toBeCloseTo(0.25, 6);
    expect(trailFade(1, 1)).toBe(0);
    expect(trailFade(2, 1)).toBe(0);
    expect(trailFade(-0.1, 1)).toBe(0);
    expect(trailFade(0.1, 0)).toBe(0);
  });

  it('fades monotonically', () => {
    let prev = Infinity;
    for (let a = 0; a <= 1; a += 0.05) {
      const f = trailFade(a, 1);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });

  it('spreads with age', () => {
    expect(trailSpread(0, 1)).toBe(1);
    expect(trailSpread(1, 1)).toBeCloseTo(1.8, 6);
    expect(trailSpread(5, 1)).toBeCloseTo(1.8, 6);
  });

  it('lays a point when moved far enough or after a while', () => {
    expect(trailNeedsPoint(0.001, 1)).toBe(true);
    expect(trailNeedsPoint(0.001, 0.01)).toBe(false);
    expect(trailNeedsPoint(0.03, 0.05)).toBe(true);
    expect(trailNeedsPoint(0.2, 0)).toBe(true);
  });
});
