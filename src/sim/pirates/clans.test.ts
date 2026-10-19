import { describe, expect, it } from 'vitest';
import { CAPTAIN_CLANS } from '../../data/captains';
import { captainDef, captainEnemyId } from '../captains/captains';
import { spawnSlots } from '../combat/enemies';
import { clanAt, enemyClan, fortressClan } from './clans';
import { fortressSites } from './sites';

const SEED = 4242;

describe('pirate clans (derived, not saved)', () => {
  it('every fortress belongs to a different clan, and its territory is its own', () => {
    const sites = fortressSites(SEED);
    const clans = sites.map((s) => fortressClan(SEED, s.index));
    expect(new Set(clans).size).toBe(Math.min(sites.length, CAPTAIN_CLANS.length));
    for (const s of sites) {
      expect(clanAt(SEED, s.pos)).toBe(fortressClan(SEED, s.index));
      // far out along the same direction it is still that clan's wedge
      expect(clanAt(SEED, { x: s.pos.x * 3, y: s.pos.y * 3 })).toBe(fortressClan(SEED, s.index));
    }
  });

  it('is deterministic per seed and differs between seeds', () => {
    const points = Array.from({ length: 24 }, (_, i) => ({ x: Math.cos(i * 0.7) * 5000, y: Math.sin(i * 0.7) * 5000 }));
    const a = points.map((p) => clanAt(SEED, p));
    expect(points.map((p) => clanAt(SEED, p))).toEqual(a);
    expect(new Set(a).size).toBe(3);
    const rotations = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => fortressClan(seed, 0)));
    expect(rotations.size).toBeGreaterThan(1);
  });

  it('a patrol group flies one clan (shared home)', () => {
    let found = 0;
    for (let cx = -20; cx <= 20 && found < 5; cx++) {
      for (let cy = -20; cy <= 20 && found < 5; cy++) {
        const slots = spawnSlots(SEED, cx, cy, 'normal');
        if (slots.length < 2) continue;
        found++;
        const clans = slots.map((s) => enemyClan(SEED, s));
        expect(new Set(clans).size).toBe(1);
        expect(clans[0]).toBe(clanAt(SEED, slots[0]!.home));
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('a captain flies his own clan and his escorts take it', () => {
    for (let index = 0; index < 6; index++) {
      const clan = captainDef(SEED, index)!.clan;
      const home = { x: 3000, y: -1200 };
      const captain = { id: captainEnemyId(index), home };
      expect(enemyClan(SEED, captain)).toBe(clan);
      const escort = { id: `hp:7:${index}`, home: { ...home } };
      expect(enemyClan(SEED, escort, [captain, escort])).toBe(clan);
      // without the captain nearby the escort falls back to the territory
      expect(enemyClan(SEED, escort, [escort])).toBe(clanAt(SEED, home));
    }
  });
});
