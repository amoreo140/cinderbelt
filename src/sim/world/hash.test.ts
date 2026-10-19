import { describe, expect, it } from 'vitest';
import { hash3 } from './hash';

describe('hash3', () => {
  it('is deterministic', () => {
    expect(hash3(1, 2, 3)).toBe(hash3(1, 2, 3));
  });

  it('distinguishes argument order and neighbors', () => {
    expect(hash3(7, 1, 0)).not.toBe(hash3(7, 0, 1));
    expect(hash3(7, -1, 0)).not.toBe(hash3(7, 1, 0));
    expect(hash3(1, 5, 5)).not.toBe(hash3(2, 5, 5));
  });

  it('spreads values over a 20x20 grid without collisions', () => {
    const seen = new Set<number>();
    for (let x = -10; x < 10; x++) for (let y = -10; y < 10; y++) seen.add(hash3(42, x, y));
    expect(seen.size).toBe(400);
  });

  it('returns an unsigned 32-bit integer', () => {
    const h = hash3(-5, -7, -9);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });
});
