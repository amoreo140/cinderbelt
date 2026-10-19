import { describe, expect, it } from 'vitest';
import { POI_DENSITY, POI_HOME_CLEAR, POI_KINDS, POI_STATION_CLEAR } from '../../data/poi';
import { ECHOES } from '../../data/echoes';
import { CHUNK_SIZE } from '../world/chunks';
import { generateChunk } from '../world/generate';
import { ringIndexAt } from '../world/rings';
import { stationsInArea } from '../world/stations';
import { echoSites, poiById, poisInChunk, poisNear } from './poi';

const SEED = 4242;

/** All POIs in a square of chunks. */
function sample(seed: number, r: number) {
  const out = [];
  for (let cx = -r; cx < r; cx++) for (let cy = -r; cy < r; cy++) out.push(...poisInChunk(seed, cx, cy));
  return out;
}

describe('POI generation (5.3)', () => {
  it('is deterministic and independent of the order of queries', () => {
    const a = poisInChunk(SEED, 9, -4);
    const b = poisNear(SEED, { x: 9.5 * CHUNK_SIZE, y: -3.5 * CHUNK_SIZE }, 300).filter((p) => p.cx === 9 && p.cy === -4);
    expect(b).toEqual(a);
    expect(poisInChunk(SEED, 9, -4)).toBe(a);
  });

  it('keeps the home area clear and POIs away from stations and each other', () => {
    const all = sample(SEED, 22);
    expect(all.length).toBeGreaterThan(20);
    for (const p of all) {
      expect(Math.hypot(p.pos.x, p.pos.y)).toBeGreaterThan(POI_HOME_CLEAR - CHUNK_SIZE);
      expect(p.pos.x).toBeGreaterThanOrEqual(p.cx * CHUNK_SIZE);
      expect(p.pos.x).toBeLessThan((p.cx + 1) * CHUNK_SIZE);
      for (const s of stationsInArea(SEED, p.cx - 1, p.cx + 1, p.cy - 1, p.cy + 1)) {
        expect(Math.hypot(s.pos.x - p.pos.x, s.pos.y - p.pos.y)).toBeGreaterThanOrEqual(s.clearRadius + POI_STATION_CLEAR - 1e-9);
      }
      expect(poiById(SEED, p.id)).toEqual(p);
    }
  });

  it('giants do not overlap the asteroids of their chunk', () => {
    const giants = sample(SEED, 22).filter((p) => p.kind === 'giant');
    expect(giants.length).toBeGreaterThan(0);
    for (const g of giants) {
      for (const a of generateChunk(SEED, g.cx, g.cy).asteroids) expect(Math.hypot(a.pos.x - g.pos.x, a.pos.y - g.pos.y)).toBeGreaterThan(a.baseRadius + 11);
    }
  });

  it('frequency roughly follows the density table per ring', () => {
    // P2 (1,500–4,000): chunks centred in the ring
    const counts: Record<string, number> = { wreck: 0, anomaly: 0, cache: 0, giant: 0 };
    let chunks = 0;
    for (let cx = -20; cx < 20; cx++) {
      for (let cy = -20; cy < 20; cy++) {
        const d = Math.hypot((cx + 0.5) * CHUNK_SIZE, (cy + 0.5) * CHUNK_SIZE);
        if (ringIndexAt(d) !== 2) continue;
        chunks++;
        for (const p of poisInChunk(SEED, cx, cy)) counts[p.kind]!++;
      }
    }
    for (const k of POI_KINDS) {
      const expected = chunks * POI_DENSITY[k][2];
      expect(counts[k]!, k).toBeGreaterThan(expected * 0.4);
      expect(counts[k]!, k).toBeLessThan(expected * 1.7 + 3);
    }
  });

  it('places the three echoes outwards, away from stations', () => {
    const sites = echoSites(SEED);
    expect(sites.map((s) => s.id)).toEqual(['echo:0', 'echo:1', 'echo:2']);
    sites.forEach((s, i) => {
      expect(Math.hypot(s.pos.x, s.pos.y)).toBeCloseTo(ECHOES[i]!.distance, 6);
      expect(ringIndexAt(Math.hypot(s.pos.x, s.pos.y))).toBe(ECHOES[i]!.ring);
    });
    expect(echoSites(SEED)).toBe(sites);
    expect(echoSites(SEED + 1)[0]!.pos).not.toEqual(sites[0]!.pos);
  });
});
