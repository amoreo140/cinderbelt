import { describe, expect, it } from 'vitest';
import { ImpactLimiter, KeyedRateLimiter, RateLimiter } from './rateLimiter';

describe('RateLimiter', () => {
  it('allows the first event and blocks events inside the interval', () => {
    const r = new RateLimiter(0.1);
    expect(r.tryAcquire(0)).toBe(true);
    expect(r.tryAcquire(0.05)).toBe(false);
    expect(r.tryAcquire(0.0999)).toBe(false);
    expect(r.tryAcquire(0.1)).toBe(true);
  });

  it('limits a 60 fps stream of events to the configured rate', () => {
    const r = new RateLimiter(0.12);
    let allowed = 0;
    for (let frame = 0; frame < 60; frame++) if (r.tryAcquire(frame / 60)) allowed++;
    // 1 second / 0.12 s = about 8 allowed (rounded to frames)
    expect(allowed).toBeGreaterThanOrEqual(7);
    expect(allowed).toBeLessThanOrEqual(9);
  });

  it('reports remaining time and can be reset', () => {
    const r = new RateLimiter(1);
    r.tryAcquire(10);
    expect(r.remaining(10.25)).toBeCloseTo(0.75);
    expect(r.remaining(12)).toBe(0);
    r.reset();
    expect(r.tryAcquire(10.5)).toBe(true);
  });
});

describe('KeyedRateLimiter', () => {
  it('tracks each key independently with its own interval', () => {
    const k = new KeyedRateLimiter<'a' | 'b'>((key) => (key === 'a' ? 1 : 0.1));
    expect(k.tryAcquire('a', 0)).toBe(true);
    expect(k.tryAcquire('b', 0)).toBe(true);
    expect(k.tryAcquire('a', 0.5)).toBe(false);
    expect(k.tryAcquire('b', 0.5)).toBe(true);
    expect(k.tryAcquire('a', 1)).toBe(true);
  });
});

describe('ImpactLimiter', () => {
  it('blocks rapid similar impacts', () => {
    const l = new ImpactLimiter(0.1);
    expect(l.tryAcquire(0.3, 0)).toBe(true);
    expect(l.tryAcquire(0.3, 0.02)).toBe(false);
    expect(l.tryAcquire(0.3, 0.11)).toBe(true);
  });

  it('lets a much stronger impact through early', () => {
    const l = new ImpactLimiter(0.1);
    l.tryAcquire(0.2, 0);
    expect(l.tryAcquire(0.9, 0.02)).toBe(true);
    expect(l.tryAcquire(0.95, 0.03)).toBe(false);
  });
});
