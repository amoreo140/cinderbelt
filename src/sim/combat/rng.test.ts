import { describe, expect, it } from 'vitest';
import { createRng } from '../math/rng';
import { rngNext, rngRange } from './rng';

describe('combat rng', () => {
  it('produces the same sequence as createRng and stores its state', () => {
    const holder = { rng: 1234 };
    const reference = createRng(1234);
    for (let i = 0; i < 20; i++) expect(rngNext(holder)).toBe(reference());
    // the state can be saved and continued
    const copy = { rng: holder.rng };
    expect(rngNext(copy)).toBe(rngNext(holder));
  });

  it('draws from a range', () => {
    const holder = { rng: 7 };
    for (let i = 0; i < 100; i++) {
      const v = rngRange(holder, -2, 3);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(3);
    }
  });
});
