import { BufferAttribute, type Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { SpaceDust, STREAK_FROM, STREAK_FULL, streakFor } from './SpaceDust';

describe('streakFor (M3.8)', () => {
  it('leaves the dust as dots at cruising speed', () => {
    expect(streakFor(0)).toEqual({ length: 0, opacity: 0 });
    expect(streakFor(STREAK_FROM)).toEqual({ length: 0, opacity: 0 });
  });

  it('stretches the dust with speed, up to a cap', () => {
    const mid = streakFor((STREAK_FROM + STREAK_FULL) / 2);
    const full = streakFor(STREAK_FULL);
    expect(mid.length).toBeGreaterThan(0);
    expect(full.length).toBeGreaterThan(mid.length);
    expect(streakFor(STREAK_FULL * 3)).toEqual(full);
  });

  it('keeps the streaks a subtle cue: short and faint even at full speed, none at the 25 u/s cruise cap', () => {
    const full = streakFor(STREAK_FULL);
    expect(full.length).toBeLessThanOrEqual(2.5);
    expect(full.opacity).toBeLessThanOrEqual(0.25);
    expect(streakFor(25).length).toBeLessThan(0.5);
  });
});

describe('SpaceDust streaks', () => {
  it('writes each grain a quad from the grain forward along the motion', () => {
    const dust = new SpaceDust(7, 3);
    dust.update(new Vector3(0, 0, 0), new Vector3(STREAK_FULL, 0, 0));
    const streaks = dust.object.children[0] as Mesh;
    expect(streaks.visible).toBe(true);
    const grains = (dust.object.geometry.getAttribute('position') as BufferAttribute).array;
    const quad = (streaks.geometry.getAttribute('position') as BufferAttribute).array;
    const len = streakFor(STREAK_FULL).length;
    for (let i = 0; i < 3; i++) {
      const [x, y, z] = [grains[i * 3]!, grains[i * 3 + 1]!, grains[i * 3 + 2]!];
      const q = Array.from(quad.slice(i * 12, i * 12 + 12));
      // head at the grain (±half width across the motion, i.e. along z), tail `len` ahead along x
      expect(q[0]).toBeCloseTo(x);
      expect(q[1]).toBeCloseTo(y);
      expect(q[6]).toBeCloseTo(x + len);
      expect(q[9]).toBeCloseTo(x + len);
      expect(Math.abs(q[5]! - q[2]!)).toBeCloseTo(0.07);
      expect((q[2]! + q[5]!) / 2).toBeCloseTo(z);
    }
    dust.dispose();
  });
});
