// Secured sectors (M4d plan §2.1, T1): a Contested sector whose lane's Guild relay chain reached stage
// `secured` is Guarded through every "security now" read; static security, placement and balancing stay.
import { describe, expect, it } from 'vitest';
import { PIRATE_GROUPS, TOLL } from '../../data/pirates';
import { flyingAt } from '../discovery/testing';
import {
  chunkPirates,
  dangerousAt,
  NO_SECURITY_OVERRIDES,
  REGION_GEN,
  regionWorld,
  sectorInfo,
  sectorSecurity,
  securityOf,
  type SpawnContext,
} from '../regions';
import type { SimState } from '../Simulation';
import { CHUNK_SIZE } from '../world/chunks';
import { dangerousSector, securedSectors, securityHere, securityOverrides, spawnContext } from './sectors';

const SEED = 4242;
const world = regionWorld(SEED);
const awake = (secured: string[] = [], destroyed: string[] = []): SpawnContext => ({
  training: false,
  epoch: 2,
  destroyedFortresses: new Set(destroyed),
  secured: new Set(secured),
});

const laneDist = (x: number, y: number) => Math.min(...world.lanes.map((l) => Math.min(...l.points.map((q) => Math.hypot(q.x - x, q.y - y)))));

/** A depth-2 Contested sector (not a corner) with a chunk centre in it, off the lane corridors. */
function contestedChunk(): { id: string; cx: number; cy: number } {
  for (const r of world.regions) {
    if (r.seed.depth !== 2 || r.security !== 'contested' || r.fixed !== null) continue;
    for (let cx = -40; cx <= 40; cx++) {
      for (let cy = -40; cy <= 40; cy++) {
        if (world.field.regionOfChunk(cx, cy).id !== r.seed.id) continue;
        const x = (cx + 0.5) * CHUNK_SIZE;
        const y = (cy + 0.5) * CHUNK_SIZE;
        if (Math.hypot(x, y) < 1200 || laneDist(x, y) < REGION_GEN.lanes.corridor + 50) continue;
        if (world.field.regionAt(x, y).id !== r.seed.id) continue;
        return { id: r.seed.id, cx, cy };
      }
    }
  }
  throw new Error('no contested chunk');
}

const C = contestedChunk();
const centre = { x: (C.cx + 0.5) * CHUNK_SIZE, y: (C.cy + 0.5) * CHUNK_SIZE };

function secure(state: SimState, sector: string): void {
  state.guild.relays.set('A', { stage: 'secured', sector, tick: state.tick });
}

describe('secured sectors (M4d §2.1)', () => {
  it('securedSectors reads the relays at stage secured only, with a stable set while unchanged', () => {
    const sim = flyingAt(SEED, centre);
    expect(securedSectors(sim.state).size).toBe(0);
    sim.state.guild.relays.set('A', { stage: 'powered', sector: C.id, tick: 0 });
    expect(securedSectors(sim.state).size).toBe(0);
    secure(sim.state, C.id);
    const a = securedSectors(sim.state);
    expect([...a]).toEqual([C.id]);
    expect(securedSectors(sim.state)).toBe(a);
    sim.state.guild.relays.set('B', { stage: 'secured', sector: 'rg:other', tick: 0 });
    expect(new Set(securedSectors(sim.state))).toEqual(new Set([C.id, 'rg:other']));
    expect(securityOverrides(sim.state).secured.has(C.id)).toBe(true);
  });

  it('a Contested sector in `secured` is Guarded: sectorSecurity, securityHere, chunkPirates ×0.5, dangerousAt false, toll 0', () => {
    expect(sectorSecurity(SEED, C.id)).toBe('contested');
    expect(sectorSecurity(SEED, C.id, { destroyedFortresses: new Set(), secured: new Set([C.id]) })).toBe('guarded');

    const sim = flyingAt(SEED, centre);
    sim.state.tick = 2 * 60 * 60 * 30; // well past the calm start (any epoch ≥ 1)
    expect(securityHere(sim.state, centre)).toBe('contested');
    expect(dangerousSector(sim.state, centre)).toBe(true);
    secure(sim.state, C.id);
    expect(securityHere(sim.state, centre)).toBe('guarded');
    expect(spawnContext(sim.state).secured.has(C.id)).toBe(true);
    expect(dangerousSector(sim.state, centre)).toBe(false);

    const open = chunkPirates(world, C.cx, C.cy, awake());
    expect(open.security).toBe('contested');
    expect(open.group).toBeCloseTo(PIRATE_GROUPS.rate[2], 9);
    const held = chunkPirates(world, C.cx, C.cy, awake([C.id]));
    expect(held.security).toBe('guarded');
    expect(held.group).toBeCloseTo(PIRATE_GROUPS.rate[2] * REGION_GEN.groupMult.guarded, 9);
    expect(REGION_GEN.groupMult.guarded).toBe(0.5);
    expect(dangerousAt(world, centre.x, centre.y, awake())).toBe(true);
    expect(dangerousAt(world, centre.x, centre.y, awake([C.id]))).toBe(false);
    expect(TOLL.chance[held.security]).toBe(0);
  });

  it('a Pirate or fortress sector in `secured` is unchanged; a destroyed fortress still turns Contested', () => {
    const [fid, rid] = [...world.fortressRegions][0]!;
    const all = [...world.fortressRegions].filter(([, r]) => r === rid).map(([f]) => f);
    expect(sectorSecurity(SEED, rid, { destroyedFortresses: new Set(), secured: new Set([rid]) })).toBe('pirate');
    expect(sectorSecurity(SEED, rid, { destroyedFortresses: new Set(all), secured: new Set([rid]) })).toBe('contested');
    expect(sectorSecurity(SEED, rid, { destroyedFortresses: new Set(all), secured: new Set() })).toBe('contested');
    expect(all).toContain(fid);
    const pirate = world.regions.find((r) => r.security === 'pirate' && r.fixed !== 'fortress')!;
    expect(sectorSecurity(SEED, pirate.seed.id, { destroyedFortresses: new Set(), secured: new Set([pirate.seed.id]) })).toBe('pirate');
    for (const s of ['quiet', 'guarded'] as const) {
      const r = world.regions.find((x) => x.security === s)!;
      expect(sectorSecurity(SEED, r.seed.id, { destroyedFortresses: new Set(), secured: new Set([r.seed.id]) })).toBe(s);
    }
  });

  it('static security, sector info and the balancing exposure stay a pure function of the seed', () => {
    for (const seed of [1, 7, 42, 1337, 4242]) {
      const w = regionWorld(seed);
      const balance = JSON.stringify(w.balance);
      const contested = w.regions.filter((r) => r.security === 'contested').map((r) => r.seed.id);
      const overrides = { destroyedFortresses: new Set(w.fortressRegions.keys()), secured: new Set(contested) };
      for (const id of contested) expect(sectorSecurity(seed, id, overrides)).toBe('guarded');
      for (const r of w.regions) {
        expect(securityOf(w, r.seed)).toBe(r.security);
        expect(sectorInfo(seed, r.seed.id)!.security).toBe(r.security);
        expect(sectorSecurity(seed, r.seed.id, NO_SECURITY_OVERRIDES)).toBe(r.security);
      }
      expect(JSON.stringify(regionWorld(seed).balance)).toBe(balance);
    }
  });
});
