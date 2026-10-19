import { describe, expect, it } from 'vitest';
import {
  ACTIVE_SECTOR_MODIFIERS,
  MAX_SECTOR_MODIFIERS,
  SECTOR_AREA_CHUNKS,
  SECTOR_EPOCH_TICKS,
  SECTOR_MODIFIERS,
  SECTOR_MODIFIER_IDS,
} from '../../data/sector';
import { isDangerousSecurity, regionWorld, sectorChunkKeys, sectorIdAt, sectorInfo } from '../regions';
import { CHUNK_SIZE } from '../world/chunks';
import { areaCenter, areaOf, sectorAt, sectorBonus, sectorEffects, sectorEpoch, sectorState } from './sector';

const AREA = SECTOR_AREA_CHUNKS * CHUNK_SIZE;

describe('sector modifier data', () => {
  it('has about twelve modifiers with sane values', () => {
    expect(SECTOR_MODIFIER_IDS.length).toBeGreaterThanOrEqual(12);
    expect(ACTIVE_SECTOR_MODIFIERS.length).toBeGreaterThanOrEqual(8);
    for (const id of SECTOR_MODIFIER_IDS) {
      const m = SECTOR_MODIFIERS[id];
      expect(m.id).toBe(id);
      expect(m.rings.length).toBeGreaterThan(0);
      expect(m.weight).toBeGreaterThan(0);
      expect(m.bonus).toBeGreaterThanOrEqual(0);
      if (m.kind !== 'warning') expect(m.bonus).toBe(0);
      for (const v of Object.values(m.effects)) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('every active modifier has a real effect (or is a market modifier)', () => {
    for (const id of ACTIVE_SECTOR_MODIFIERS) {
      const m = SECTOR_MODIFIERS[id];
      expect(m.kind === 'market' || Object.keys(m.effects).length > 0).toBe(true);
    }
  });
});

describe('areas and epochs', () => {
  it('maps positions to 5×5 chunk areas', () => {
    expect(areaOf({ x: 0, y: 0 })).toEqual({ ax: 0, ay: 0 });
    expect(areaOf({ x: AREA - 0.1, y: -0.1 })).toEqual({ ax: 0, ay: -1 });
    expect(areaOf({ x: AREA, y: 2 * AREA + 5 })).toEqual({ ax: 1, ay: 2 });
    expect(areaCenter(1, -1)).toEqual({ x: 1.5 * AREA, y: -0.5 * AREA });
  });

  it('rotates every 30 game minutes', () => {
    expect(sectorEpoch(0)).toBe(0);
    expect(sectorEpoch(SECTOR_EPOCH_TICKS - 1)).toBe(0);
    expect(sectorEpoch(SECTOR_EPOCH_TICKS)).toBe(1);
  });
});

/** Finite sectors of a seed within ~4 600 u of home (all three depths). */
const sectorsOf = (seed: number): string[] =>
  regionWorld(seed)
    .regions.filter((r) => Math.hypot(r.seed.x, r.seed.y) < 4600)
    .map((r) => r.seed.id);

describe('sectorState (local conditions by sector, sectors design 6.3)', () => {
  it('is calm everywhere during the first half hour', () => {
    for (const id of sectorsOf(5)) expect(sectorState(5, id, 0).modifiers).toEqual([]);
  });

  it('is deterministic and respects the limits; the sector depth picks the table', () => {
    let total = 0;
    const counts = [0, 0, 0];
    const ids = sectorsOf(77);
    for (let epoch = 1; epoch < 40; epoch++) {
      for (const id of ids) {
        const full = sectorState(77, id, epoch);
        expect(sectorState(77, id, epoch)).toEqual(full);
        expect(full.region).toBe(id);
        // the derived comet flyby (M4b) comes on top of the rolled modifiers
        const s = { ...full, modifiers: full.modifiers.filter((m) => !SECTOR_MODIFIERS[m.id].derived) };
        expect(s.modifiers.length).toBeLessThanOrEqual(MAX_SECTOR_MODIFIERS);
        counts[s.modifiers.length]!++;
        const mods = s.modifiers.map((m) => m.id);
        expect(new Set(mods).size).toBe(mods.length);
        const kinds = mods.map((m) => SECTOR_MODIFIERS[m].kind);
        expect(kinds.filter((k) => k === 'warning').length).toBeLessThanOrEqual(1);
        expect(kinds.filter((k) => k === 'market').length).toBeLessThanOrEqual(1);
        const info = sectorInfo(77, id)!;
        for (const m of s.modifiers) {
          expect(ACTIVE_SECTOR_MODIFIERS).toContain(m.id);
          expect(SECTOR_MODIFIERS[m.id].rings).toContain(info.depth);
          if (m.id === 'demand') expect(m.resource).toBeDefined();
          total++;
        }
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(counts.every((c) => c > 0)).toBe(true);
  });

  it('hunting grounds and clan war come only to Contested and Pirate sectors', () => {
    const seen = { safe: 0, dangerous: 0 };
    for (const seed of [3, 77, 1337]) {
      for (const id of sectorsOf(seed)) {
        const dangerous = isDangerousSecurity(sectorInfo(seed, id)!.security);
        for (let epoch = 1; epoch < 30; epoch++) {
          const hit = sectorState(seed, id, epoch).modifiers.some((m) => m.id === 'huntingGrounds' || m.id === 'pirateWar');
          if (hit && !dangerous) seen.safe++;
          if (hit && dangerous) seen.dangerous++;
        }
      }
    }
    expect(seen.safe).toBe(0);
    expect(seen.dangerous).toBeGreaterThan(0);
  });

  it('is the same over the whole sector and changes over time and between seeds', () => {
    const home = sectorIdAt(1, 0, 0);
    const a = JSON.stringify([1, 2, 3, 4, 5, 6].map((e) => sectorState(1, home, e).modifiers));
    const b = JSON.stringify([1, 2, 3, 4, 5, 6].map((e) => sectorState(2, sectorIdAt(2, 0, 0), e).modifiers));
    expect(a).not.toBe(b);
    const id = sectorsOf(1)[3]!;
    const epochs = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((e) => JSON.stringify(sectorState(1, id, e).modifiers)));
    expect(epochs.size).toBeGreaterThan(1);
    // two points of one sector share its conditions, whatever 5 × 5 block they lie in
    const tick = SECTOR_EPOCH_TICKS * 4 + 1;
    const far = sectorChunkKeys(1, home)
      .map((k) => k.split(',').map(Number) as [number, number])
      .find(([cx, cy]) => Math.floor(cx / SECTOR_AREA_CHUNKS) !== 0 || Math.floor(cy / SECTOR_AREA_CHUNKS) !== 0)!;
    expect(sectorAt(1, { x: 0, y: 0 }, tick)).toBe(sectorAt(1, { x: (far[0] + 0.5) * CHUNK_SIZE, y: (far[1] + 0.5) * CHUNK_SIZE }, tick));
  });

  it('an unknown sector id is calm', () => {
    expect(sectorState(1, 'rg:B:nope', 5).modifiers).toEqual([]);
  });
});

describe('effects', () => {
  it('combines effects and warning bonuses', () => {
    const state = { region: 'rg:B:0', epoch: 3, modifiers: [{ id: 'ionSeason' as const }, { id: 'richVein' as const }] };
    expect(sectorEffects(state).ionStormMult).toBe(3);
    expect(sectorEffects(state).energyGenMult).toBe(1);
    expect(sectorEffects(state).veinYieldMult).toBe(2);
    expect(sectorEffects(state).pirateMult).toBe(1);
    expect(sectorBonus(state)).toBeCloseTo(0.25);
  });

  it('sectorAt finds the state of the sector under a position', () => {
    const tick = SECTOR_EPOCH_TICKS * 5 + 10;
    const pos = { x: AREA * 2.5, y: -10 };
    expect(sectorAt(9, pos, tick)).toEqual(sectorState(9, sectorIdAt(9, pos.x, pos.y), 5));
  });
});
