import { describe, expect, it } from 'vitest';
import { GRADE_TABLES, ORE } from '../../data/ore';
import { RING_INDICES } from '../../data/economy';
import { generateChunk } from '../world/generate';
import { assayChunksAround, chunkOfAsteroid, isRich, oreGrade, ringOfAsteroid } from './grade';

describe('ore grade tables', () => {
  it('average to 100 % in every ring (pacing unchanged)', () => {
    for (const ring of RING_INDICES) {
      const table = GRADE_TABLES[ring];
      const total = table.reduce((s, x) => s + x.weight, 0);
      const mean = table.reduce((s, x) => s + x.grade * x.weight, 0) / total;
      expect(total, `ring ${ring}`).toBe(1000);
      expect(Math.abs(mean - 1), `ring ${ring} mean ${mean}`).toBeLessThan(0.005);
    }
  });

  it('range 60–160 % with rare rich rocks', () => {
    for (const ring of RING_INDICES) {
      const table = GRADE_TABLES[ring];
      expect(Math.min(...table.map((x) => x.grade))).toBeGreaterThanOrEqual(0.6);
      expect(Math.max(...table.map((x) => x.grade))).toBeLessThanOrEqual(1.6);
      const rich = table.filter((x) => x.grade >= ORE.richGrade).reduce((s, x) => s + x.weight, 0) / 1000;
      expect(rich).toBeGreaterThan(0.04);
      expect(rich).toBeLessThan(0.15);
    }
  });
});

describe('oreGrade', () => {
  it('is a pure function of the seed and the asteroid id', () => {
    const a = { id: '3,-2:7', pos: { x: 700, y: -500 } };
    expect(oreGrade(42, a)).toBe(oreGrade(42, { ...a, pos: { x: 0, y: 0 } }));
    const seeds = new Set<number>();
    for (let s = 1; s <= 40; s++) seeds.add(oreGrade(s, a));
    expect(seeds.size).toBeGreaterThan(3);
  });

  it('ice fragments keep the grade of the rock they cracked from', () => {
    const parent = { id: '1,1:4', pos: { x: 300, y: 300 } };
    expect(oreGrade(9, { id: '1,1:4~2', pos: { x: 302, y: 301 } })).toBe(oreGrade(9, parent));
  });

  it('takes the ring from the chunk in the id (ring 1 never above 145 %)', () => {
    expect(ringOfAsteroid({ id: '0,0:1', pos: { x: 99999, y: 0 } })).toBe(1);
    expect(ringOfAsteroid({ id: '12,0:1', pos: { x: 0, y: 0 } })).toBe(2);
    // ids of test generators fall back to the position
    expect(ringOfAsteroid({ id: 'rock', pos: { x: 5000, y: 0 } })).toBe(3);
    for (let i = 0; i < 500; i++) expect(oreGrade(7, { id: `1,2:${i}`, pos: { x: 0, y: 0 } })).toBeLessThanOrEqual(1.45);
  });

  it('averages ~100 % over a real world (weighted by rock content)', () => {
    let units = 0;
    let ore = 0;
    let rich = 0;
    let count = 0;
    for (let cx = -6; cx <= 6; cx++) {
      for (let cy = -6; cy <= 6; cy++) {
        for (const a of generateChunk(5, cx, cy).asteroids) {
          const g = oreGrade(5, a);
          units += a.initialAmount;
          ore += a.initialAmount * g;
          count++;
          if (isRich(g)) rich++;
        }
      }
    }
    expect(count).toBeGreaterThan(1000);
    expect(ore / units).toBeGreaterThan(0.96);
    expect(ore / units).toBeLessThan(1.04);
    expect(rich / count).toBeGreaterThan(0.03);
  });
});

describe('assay', () => {
  it('covers the chunks a circle touches', () => {
    const keys = assayChunksAround({ x: 10, y: 10 }, 150);
    expect(keys).toContain('0,0');
    expect(keys).toContain('-1,-1');
    expect(keys).not.toContain('2,0');
    expect(chunkOfAsteroid({ id: '-1,-1:3~1', pos: { x: 0, y: 0 } })).toBe('-1,-1');
    expect(chunkOfAsteroid({ id: 'rock', pos: { x: 250, y: -10 } })).toBe('1,-1');
  });
});
