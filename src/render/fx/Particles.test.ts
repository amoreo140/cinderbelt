import { Color, Texture, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Particles, type ParticleSpec } from './Particles';

const spec = (life: number): ParticleSpec => ({ pos: new Vector3(), life, size: 1, color: new Color(1, 1, 1) });

describe('Particles (M30)', () => {
  it('drops the oldest particle when full instead of shifting the whole list', () => {
    const p = new Particles({ texture: new Texture(), additive: true, max: 8 });
    p.spawn(spec(0.5)); // the oldest – a short life
    for (let i = 0; i < 7; i++) p.spawn(spec(10));
    expect(p.count).toBe(8);
    p.spawn(spec(10)); // full → replaces the oldest
    expect(p.count).toBe(8);
    p.update(1);
    // if one other than the oldest were dropped, the short one would die now and 7 would remain
    expect(p.count).toBe(8);
  });

  it('keeps the spawn order through updates and wrap-around', () => {
    const p = new Particles({ texture: new Texture(), additive: true, max: 4 });
    for (let i = 0; i < 4; i++) p.spawn(spec(1 + i)); // lives 1, 2, 3, 4
    p.update(1.5); // the first (1) dies
    expect(p.count).toBe(3);
    p.spawn(spec(0.2));
    p.spawn(spec(10)); // full → replaces the oldest (life 2)
    p.update(0.6); // 0.2 dies and the original two is gone
    expect(p.count).toBe(3);
    p.update(1); // at age 3.1: the three dies, the four and the ten remain
    expect(p.count).toBe(2);
  });

  it('handles a large burst at capacity in constant time per particle', () => {
    const p = new Particles({ texture: new Texture(), additive: true, max: 512 });
    const t0 = performance.now();
    for (let i = 0; i < 50_000; i++) p.spawn(spec(5));
    expect(p.count).toBe(512);
    expect(performance.now() - t0).toBeLessThan(2000);
    p.clear();
    expect(p.count).toBe(0);
  });
});
