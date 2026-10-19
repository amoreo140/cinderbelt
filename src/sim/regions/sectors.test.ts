import { describe, expect, it } from 'vitest';
import {
  BIOMES_BY_DEPTH,
  SECTOR_NAME_WORDS,
  buildRegionWorld,
  defaultRegionInputs,
  guildCorridorAt,
  isDangerousSecurity,
  regionWorld,
  sectorIdAt,
  sectorInfo,
  sectorInfoAt,
  sectorInfoOfChunk,
  sectorSecurity,
  sectorThreat,
} from './index';

describe('sector API (stage 1a)', () => {
  const SEED = 1337;

  it('answers the same sector for a point, its id and its chunk', () => {
    for (const [x, y] of [
      [0, 0],
      [900, -300],
      [2600, 1400],
      [-5200, 800],
      [12000, -9000],
    ] as const) {
      const id = sectorIdAt(SEED, x, y);
      const info = sectorInfoAt(SEED, x, y);
      expect(info.id).toBe(id);
      expect(sectorInfo(SEED, id)).toBe(info);
    }
    const chunk = sectorInfoOfChunk(SEED, 0, 0);
    expect(chunk.id).toBe(sectorIdAt(SEED, 100, 100));
    expect(sectorInfo(SEED, 'rg:B:not-a-cell')).toBeNull();
  });

  it('Origin is Guarded, Charted, named Origin; fortress sectors are Pirate and turn Contested when their fortress falls', () => {
    const home = sectorInfoAt(SEED, 0, 0);
    expect(home.origin).toBe(true);
    expect(home.security).toBe('guarded');
    expect(home.startKnowledge).toBe('charted');
    expect(home.name).toEqual({ kind: 'origin' });
    const world = regionWorld(SEED);
    for (const [fid, rid] of world.fortressRegions) {
      const info = sectorInfo(SEED, rid)!;
      expect(info.security).toBe('pirate');
      expect(info.name.kind).toBe('fortress');
      expect(info.biome).toBe('rustField');
      const others = [...world.fortressRegions].filter(([f, r]) => r === rid && f !== fid).map(([f]) => f);
      expect(sectorSecurity(SEED, rid, { destroyedFortresses: new Set([fid, ...others]), secured: new Set() })).toBe('contested');
      expect(sectorSecurity(SEED, rid)).toBe('pirate');
    }
  });

  it('marks both pirate corners and names them', () => {
    const world = regionWorld(SEED);
    const c1 = sectorInfo(SEED, world.corners.depth1!)!;
    const c2 = sectorInfo(SEED, world.corners.depth2!)!;
    expect(c1.corner).toBe(1);
    expect(c1.depth).toBe(1);
    expect(c1.name).toEqual({ kind: 'corner', corner: 1 });
    expect(c2.corner).toBe(2);
    expect(c2.depth).toBe(2);
    expect(sectorThreat(c1, c1.security)).toBe('nest');
  });

  it('generated names are unique among the finite sectors and inside the word lists; biomes fit the depth', () => {
    for (const seed of [1, 7, 42, 1337, 90210]) {
      const world = regionWorld(seed);
      const seen = new Set<string>();
      for (const r of world.regions) {
        const info = sectorInfo(seed, r.seed.id)!;
        expect(BIOMES_BY_DEPTH[info.depth]).toContain(info.biome);
        if (info.name.kind !== 'generated') continue;
        expect(info.name.adjective).toBeGreaterThanOrEqual(0);
        expect(info.name.adjective).toBeLessThan(SECTOR_NAME_WORDS.adjectives);
        expect(info.name.noun).toBeLessThan(SECTOR_NAME_WORDS.nouns);
        const key = `${info.name.adjective}.${info.name.noun}.${info.name.numeral}`;
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
    }
  });

  it('depth 4+ sectors outside the rastered world still have an info (rolled security, generated name)', () => {
    const info = sectorInfoAt(SEED, 15000, 2000);
    expect(info.depth).toBe(4);
    expect(info.name.kind).toBe('generated');
    expect(info.startKnowledge).toBe('uncharted');
    expect(['contested', 'pirate']).toContain(info.security);
  });

  it('threat words follow the group density (§3.1)', () => {
    expect(sectorThreat({ depth: 1, corner: null }, 'guarded')).toBe('none');
    expect(sectorThreat({ depth: 2, corner: null }, 'quiet')).toBe('none');
    expect(sectorThreat({ depth: 2, corner: null }, 'guarded')).toBe('rare');
    expect(sectorThreat({ depth: 2, corner: null }, 'contested')).toBe('often');
    expect(sectorThreat({ depth: 3, corner: null }, 'pirate')).toBe('nest');
    expect(isDangerousSecurity('contested')).toBe(true);
    expect(isDangerousSecurity('pirate')).toBe(true);
    expect(isDangerousSecurity('guarded')).toBe(false);
    expect(isDangerousSecurity('quiet')).toBe(false);
  });

  it('the home point lies in a lane corridor (both lanes start at home)', () => {
    expect(guildCorridorAt(SEED, 0, 0)).toBe(true);
  });

  it('is deterministic: a fresh build gives the same infos', () => {
    const a = buildRegionWorld(42, 'B', defaultRegionInputs(42));
    const b = regionWorld(42);
    expect(a.regions.map((r) => [r.seed.id, r.security])).toEqual(b.regions.map((r) => [r.seed.id, r.security]));
  });
});
