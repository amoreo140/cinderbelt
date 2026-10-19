import { describe, expect, it } from 'vitest';
import { RESOURCE_IDS } from '../../data/resources';
import { resourceWeightsAt, ringIndexAt } from './rings';

const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);

describe('rings', () => {
  it('finds the ring by distance', () => {
    expect(ringIndexAt(0)).toBe(1);
    expect(ringIndexAt(1499)).toBe(1);
    expect(ringIndexAt(1500)).toBe(2);
    expect(ringIndexAt(4000)).toBe(3);
    expect(ringIndexAt(100000)).toBe(4);
  });

  it('has no titanium in the home belt', () => {
    expect(resourceWeightsAt(100).titanium).toBe(0);
    expect(resourceWeightsAt(100).iron).toBeGreaterThan(0);
  });

  it('blends weights across a ring boundary', () => {
    // iron, copper and ice transition smoothly across the ±10% border
    expect(resourceWeightsAt(1500).iron).toBeLessThan(resourceWeightsAt(1349).iron);
    expect(resourceWeightsAt(1500).iron).toBeGreaterThan(resourceWeightsAt(1651).iron);
    expect(resourceWeightsAt(1651).titanium).toBeCloseTo(0.3);
  });

  it('never blends titanium into ring 1: it only fades in on the outer side of the border', () => {
    for (const d of [0, 800, 1349, 1350, 1420, 1499, 1499.99, 1500]) expect(resourceWeightsAt(d).titanium, `${d}`).toBe(0);
    const ti = [1510, 1550, 1600, 1649].map((d) => resourceWeightsAt(d).titanium);
    for (let i = 1; i < ti.length; i++) expect(ti[i]!).toBeGreaterThan(ti[i - 1]!);
    expect(ti[0]!).toBeGreaterThan(0);
    expect(ti[3]!).toBeLessThan(0.3);
  });

  it('always sums to 1 and covers every resource', () => {
    for (const d of [0, 800, 1400, 1500, 1600, 3000, 4000, 9000]) {
      const w = resourceWeightsAt(d);
      expect(Object.keys(w).sort()).toEqual([...RESOURCE_IDS].sort());
      expect(sum(w)).toBeCloseTo(1);
    }
  });
});
