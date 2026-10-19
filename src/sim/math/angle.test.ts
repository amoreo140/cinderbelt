import { describe, expect, it } from 'vitest';
import { lerpAngle, normalizeAngle } from './angle';

describe('angle', () => {
  it('normalizes into (-PI, PI]', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(3 * Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
    expect(normalizeAngle(-5 * Math.PI)).toBeCloseTo(Math.PI);
  });

  it('lerps along the shortest arc', () => {
    const a = 3.0;
    const b = -3.0; // the shortest way goes through PI
    const mid = lerpAngle(a, b, 0.5);
    expect(Math.abs(normalizeAngle(mid))).toBeCloseTo(Math.PI, 1);
  });
});
