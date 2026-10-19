import { describe, expect, it } from 'vitest';
import { AMBIENT_RINGS, ambientParamsForRing, normalizeRing, type Ring } from './ambientParams';

const RINGS: Ring[] = [1, 2, 3, 4];

describe('normalizeRing', () => {
  it('rounds and clamps to 1..4', () => {
    expect(normalizeRing(0)).toBe(1);
    expect(normalizeRing(2.4)).toBe(2);
    expect(normalizeRing(2.6)).toBe(3);
    expect(normalizeRing(9)).toBe(4);
    expect(normalizeRing(Number.NaN)).toBe(1);
  });
});

describe('ambientParamsForRing', () => {
  it('returns the table entry for each ring', () => {
    for (const r of RINGS) expect(ambientParamsForRing(r)).toBe(AMBIENT_RINGS[r]);
    expect(ambientParamsForRing(17).ring).toBe(4);
  });

  it('every ring has its own colour of wind', () => {
    expect(new Set(RINGS.map((r) => AMBIENT_RINGS[r].windHz)).size).toBe(4);
  });

  it('crystal nebulae are the airiest, dead zones the lowest and windiest', () => {
    const p = RINGS.map((r) => AMBIENT_RINGS[r]);
    expect(Math.max(...p.map((x) => x.air))).toBe(AMBIENT_RINGS[3].air);
    expect(Math.min(...p.map((x) => x.windHz))).toBe(AMBIENT_RINGS[4].windHz);
    expect(Math.max(...p.map((x) => x.wind))).toBe(AMBIENT_RINGS[4].wind);
  });

  it('stays a quiet bed under the music', () => {
    for (const r of RINGS) {
      const p = AMBIENT_RINGS[r];
      expect(p.level).toBeLessThanOrEqual(0.2);
      expect(p.windDrift).toBeLessThan(p.windHz);
      expect(p.wind).toBeLessThanOrEqual(1);
      expect(p.air).toBeLessThanOrEqual(1);
    }
  });
});
