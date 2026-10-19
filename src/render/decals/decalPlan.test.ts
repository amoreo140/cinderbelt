import { describe, expect, it } from 'vitest';
import { DECAL_ROW, MAX_DECALS_PER_PART, WRECK_LEVEL, damageLevel, decalCount, decalSpecs } from './decalPlan';

const ONE = { w: 1, h: 1 };

describe('damage decals', () => {
  it('levels follow the README thresholds (< 70 % scorch, < 40 % torn / holes)', () => {
    expect(damageLevel(1)).toBe(0);
    expect(damageLevel(0.7)).toBe(0);
    expect(damageLevel(0.69)).toBe(1);
    expect(damageLevel(0.4)).toBe(1);
    expect(damageLevel(0.39)).toBe(2);
    expect(damageLevel(0)).toBe(2);
    expect(damageLevel(Number.NaN)).toBe(0);
  });

  it('is deterministic per seed and part', () => {
    expect(decalSpecs(7, 3, 2, ONE)).toEqual(decalSpecs(7, 3, 2, ONE));
    expect(decalSpecs(7, 3, 2, ONE)).not.toEqual(decalSpecs(7, 4, 2, ONE));
  });

  it('a clean part has none, a scorched part one scorch, a heavier level keeps the lighter decals', () => {
    for (let part = 1; part < 60; part++) {
      expect(decalSpecs(1, part, 0, ONE)).toEqual([]);
      const light = decalSpecs(1, part, 1, ONE);
      const heavy = decalSpecs(1, part, 2, ONE);
      const wreck = decalSpecs(1, part, WRECK_LEVEL, ONE);
      expect(light).toHaveLength(1);
      expect(light[0]!.row).toBe(DECAL_ROW.scorch);
      expect(heavy.length).toBeGreaterThanOrEqual(2);
      expect(heavy.slice(0, 1)).toEqual(light);
      expect(wreck.length).toBeGreaterThanOrEqual(2);
      expect(wreck.length).toBeLessThanOrEqual(3);
      expect(wreck.slice(0, heavy.length)).toEqual(heavy.slice(0, wreck.length));
    }
  });

  it('decals stay on the part footprint, sized 0.4–0.9 of a cell, capped per part', () => {
    for (let part = 1; part < 80; part++) {
      for (const fp of [ONE, { w: 2, h: 1 }, { w: 2, h: 2 }, { w: 3, h: 1 }]) {
        const list = decalSpecs(99, part, WRECK_LEVEL, fp);
        expect(list.length).toBeLessThanOrEqual(MAX_DECALS_PER_PART);
        for (const d of list) {
          expect(Math.abs(d.x)).toBeLessThanOrEqual(fp.w / 2);
          expect(Math.abs(d.y)).toBeLessThanOrEqual(fp.h / 2);
          expect(d.size).toBeGreaterThanOrEqual(0.4);
          expect(d.size).toBeLessThanOrEqual(0.9);
          expect([0, 1, 2]).toContain(d.col);
        }
      }
    }
    expect(decalCount(2, 4, 0.1)).toBeLessThanOrEqual(MAX_DECALS_PER_PART);
  });
});
