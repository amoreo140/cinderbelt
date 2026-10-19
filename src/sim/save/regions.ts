// Sector charts <-> save (V15, sectors stage 2): the region generator id, the marked survey points,
// the bought and sold charts and per-sector cooldowns – sorted, so a save is canonical.
import { REGION_GEN_IDS, type RegionGenId } from '../regions/constants';
import { createRegionsState, type RegionsState } from '../regions/state';
import { sectorInfo } from '../regions/sectors';
import { surveyMask } from '../regions/survey';
import type { SavedRegionsV15 } from './types';
import type { Checker } from './validate';

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function regionsToSave(r: RegionsState): SavedRegionsV15 {
  return {
    gen: r.gen,
    points: [...r.points].filter(([, m]) => m > 0).sort((a, b) => byString(a[0], b[0])),
    bought: [...r.bought].sort(byString),
    sold: [...r.sold].sort(byString),
    cooldowns: [...r.cooldowns].sort((a, b) => byString(a[0], b[0])),
  };
}

export function regionsFromSave(s: SavedRegionsV15): RegionsState {
  return { gen: s.gen, points: new Map(s.points), bought: new Set(s.bought), sold: new Set(s.sold), cooldowns: new Map(s.cooldowns) };
}

/** What a save before V15 gets: generator 1, nothing surveyed, bought or sold (the 14 → 15 migration). */
export const legacyRegions = (): SavedRegionsV15 => regionsToSave(createRegionsState());

const SECTOR_ID = /^rg:[AB]:-?\d+,-?\d+$/;

/** Validation of `regions` (V15): a clean, sorted copy; sector ids must exist for the seed. */
export function validateRegions(c: Checker, v: unknown, path: string, seed: number): SavedRegionsV15 {
  const o = c.obj(v, path) ?? {};
  const gen = c.oneOf<RegionGenId>(o.gen, REGION_GEN_IDS, `${path}.gen`);
  const sector = (x: unknown, p: string): string => {
    const id = c.str(x, p, true);
    if (!SECTOR_ID.test(id) || !sectorInfo(seed, id)) c.err(p, 'expected a sector id of the seed');
    return id;
  };
  const ids = (key: 'bought' | 'sold'): string[] => {
    const list = (c.arr(o[key], `${path}.${key}`) ?? []).map((x, i) => sector(x, `${path}.${key}[${i}]`));
    return [...new Set(list)].sort(byString);
  };
  const pairs = (key: 'points' | 'cooldowns', value: (x: unknown, p: string, id: string) => number): [string, number][] => {
    const out = new Map<string, number>();
    (c.arr(o[key], `${path}.${key}`) ?? []).forEach((entry, i) => {
      const p = `${path}.${key}[${i}]`;
      if (!Array.isArray(entry) || entry.length !== 2) return c.err(p, 'expected [sectorId, number]');
      const id = sector(entry[0], p);
      if (out.has(id)) return c.err(p, 'duplicate sector');
      out.set(id, value(entry[1], p, id));
    });
    return [...out].sort((a, b) => byString(a[0], b[0]));
  };
  const points = pairs('points', (x, p, id) => {
    const mask = c.int(x, p, 1);
    if (SECTOR_ID.test(id) && sectorInfo(seed, id) && (mask & ~surveyMask(seed, id)) !== 0) c.err(p, 'survey point bits outside the sector');
    return mask;
  });
  const cooldowns = pairs('cooldowns', (x, p) => c.int(x, p, 0));
  return { gen, points, bought: ids('bought'), sold: ids('sold'), cooldowns };
}
