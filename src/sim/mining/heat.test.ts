import { describe, expect, it } from 'vitest';
import { canFire, COOL_TICKS, HEAT_MAX, heatFraction, hottest, stepHeat, type LaserHeat } from './heat';

const DT = 1 / 60;

describe('laser heat (spec 2.1.1: 4 s on a vein → 1.5 s of cooling)', () => {
  it('heats up only on a vein and overheats after 4 s', () => {
    const h: LaserHeat = { heat: 0, cooling: 0 };
    let overheated = 0;
    for (let i = 0; i < 239; i++) if (stepHeat(h, true, DT)) overheated++;
    expect(overheated).toBe(0);
    expect(canFire(h)).toBe(true);
    expect(stepHeat(h, true, DT)).toBe(true);
    expect(h).toEqual({ heat: HEAT_MAX, cooling: COOL_TICKS });
    expect(HEAT_MAX).toBe(4);
    expect(COOL_TICKS).toBe(90);
  });

  it('cools for 1.5 s while the laser cannot fire, then starts cold', () => {
    const h: LaserHeat = { heat: HEAT_MAX, cooling: COOL_TICKS };
    for (let i = 0; i < COOL_TICKS - 1; i++) {
      stepHeat(h, true, DT);
      expect(canFire(h)).toBe(false);
    }
    expect(heatFraction(h)).toBeCloseTo(1 / COOL_TICKS);
    stepHeat(h, true, DT);
    expect(h).toEqual({ heat: 0, cooling: 0 });
    expect(canFire(h)).toBe(true);
  });

  it('cools down off the vein at 1 s per second', () => {
    const h: LaserHeat = { heat: 2, cooling: 0 };
    for (let i = 0; i < 60; i++) stepHeat(h, false, DT);
    expect(h.heat).toBeCloseTo(1);
    for (let i = 0; i < 120; i++) stepHeat(h, false, DT);
    expect(h.heat).toBe(0);
  });

  it('reports the hottest laser as a 0–1 fraction', () => {
    const map = new Map<number, LaserHeat>([
      [3, { heat: 1, cooling: 0 }],
      [7, { heat: 3, cooling: 0 }],
    ]);
    expect(hottest(map)).toEqual({ fraction: 0.75, overheated: false });
    map.set(9, { heat: 2, cooling: 45 });
    expect(hottest(map)).toEqual({ fraction: 0.75, overheated: true });
    expect(hottest(new Map())).toEqual({ fraction: 0, overheated: false });
  });
});
