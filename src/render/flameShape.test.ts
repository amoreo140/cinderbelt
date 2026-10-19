import { describe, expect, it } from 'vitest';
import { flameShape } from './ShipView';

describe('flameShape (M3.8 ignition flare)', () => {
  it('grows with throttle', () => {
    expect(flameShape(1, 0).length).toBeGreaterThan(flameShape(0.3, 0).length);
  });

  it('a fresh burn flares longer and brighter, then settles to the steady flame', () => {
    const steady = flameShape(1, 0);
    const lit = flameShape(1, 1);
    expect(lit.length).toBeGreaterThan(steady.length);
    expect(lit.intensity).toBeGreaterThan(steady.intensity);
    expect(flameShape(1, 0.3).length).toBeLessThan(lit.length);
  });
});
