// Pirates by sector (sectors design §6.1, stage 1a; bot verification item 8 as a unit test).
import { describe, expect, it } from 'vitest';
import { ATTENTION, PIRATE_GROUPS, TOLL } from '../../data/pirates';
import { spawnSlots } from '../combat/enemies';
import { flyingAt, run, teleport } from '../discovery/testing';
import { chunkPirates, dangerousAt, REGION_GEN, regionWorld, sectorInfo, type SpawnContext } from '../regions';
import { SECTOR_EPOCH_TICKS } from '../../data/sector';
import { sectorAt, sectorEffects } from '../sector/sector';
import { CHUNK_SIZE } from '../world/chunks';
import { distressAt } from '../discovery/events';
import { stationsInArea } from '../world/stations';
import { tollAmount } from './pirates';
import { scavengerSlots } from './scavenger';
import { spawnContext } from './sectors';

const ctx = (training: boolean, epoch: number, destroyed: string[] = []): SpawnContext => ({ training, epoch, destroyedFortresses: new Set(destroyed), secured: new Set() });
const CONTEXTS = [ctx(true, 0), ctx(true, 4), ctx(false, 0), ctx(false, 1), ctx(false, 9)];

const centre = (cx: number, cy: number) => ({ x: (cx + 0.5) * CHUNK_SIZE, y: (cy + 0.5) * CHUNK_SIZE });

/** Chunks (cx, cy) whose centre lies in the sector, within ±n chunks of home. */
function chunksOf(seed: number, id: string, n = 14): [number, number][] {
  const w = regionWorld(seed);
  const out: [number, number][] = [];
  for (let cx = -n; cx <= n; cx++) for (let cy = -n; cy <= n; cy++) if (w.field.regionOfChunk(cx, cy).id === id) out.push([cx, cy]);
  return out;
}

describe('no pirates near home (§6.1, bot item 8)', () => {
  it('no pirate group or scavenger within 1 000 u of home – any seed, density, training or epoch', () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (let cx = -7; cx <= 6; cx++) {
        for (let cy = -7; cy <= 6; cy++) {
          for (const c of CONTEXTS) {
            for (const s of [...spawnSlots(seed, cx, cy, 'high', 1.5, 0.2, c), ...scavengerSlots(seed, cx, cy, 'high', c)]) {
              expect(Math.hypot(s.pos.x, s.pos.y), `seed ${seed} ${s.id}`).toBeGreaterThanOrEqual(REGION_GEN.corner.pirateFreeRadius - 20);
              expect(Math.hypot(s.home.x, s.home.y), `seed ${seed} ${s.id}`).toBeGreaterThanOrEqual(REGION_GEN.corner.pirateFreeRadius);
            }
          }
        }
      }
    }
  });

  it('no distress-signal trap (pirate ambush) within 1 000 u of home', () => {
    let traps = 0;
    for (let seed = 1; seed <= 6; seed++) {
      for (let bucket = 0; bucket < 40; bucket++) {
        for (let cx = -12; cx <= 11; cx++) {
          for (let cy = -12; cy <= 11; cy++) {
            const d = distressAt(seed, cx, cy, bucket);
            if (d?.kind !== 'trap') continue;
            traps++;
            expect(Math.hypot(d.pos.x, d.pos.y)).toBeGreaterThanOrEqual(REGION_GEN.corner.pirateFreeRadius);
          }
        }
      }
    }
    expect(traps).toBeGreaterThan(0);
  });

  it('the depth-1 corner is quiet during the Guild training and in epoch 0, then has a few T1 Jackal groups', () => {
    let awake = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const corner = regionWorld(seed).corners.depth1!;
      for (const [cx, cy] of chunksOf(seed, corner)) {
        expect(spawnSlots(seed, cx, cy, 'high', 1.5, 0.2, ctx(true, 3))).toEqual([]);
        expect(spawnSlots(seed, cx, cy, 'high', 1.5, 0.2, ctx(false, 0))).toEqual([]);
        expect(scavengerSlots(seed, cx, cy, 'high', ctx(false, 3))).toEqual([]);
        for (const s of spawnSlots(seed, cx, cy, 'high', 1, 0.2, ctx(false, 1))) {
          awake++;
          expect(s.kind).toBe('jackal');
          expect(s.tier).toBe(1);
        }
      }
    }
    expect(awake).toBeGreaterThan(0);
  });

  it('a game in training or in its first calm period meets no pirate around home', () => {
    const seed = 11;
    const corner = sectorInfo(seed, regionWorld(seed).corners.depth1!)!;
    const sim = flyingAt(seed, corner.anchor);
    sim.state.career.training.status = 'active';
    run(sim, 5 * 60);
    expect(sim.state.combat.enemies).toEqual([]);
    expect(spawnContext(sim.state).training).toBe(true);
    sim.state.career.training.status = 'done';
    expect(sim.state.tick).toBeLessThan(SECTOR_EPOCH_TICKS);
    run(sim, 5 * 60);
    expect(sim.state.combat.enemies).toEqual([]);
  });
});

describe('group rate by sector depth and security (§3.1, §2.3)', () => {
  const seed = 1337;
  const world = regionWorld(seed);
  const awake = ctx(false, 2);
  /** First chunk of a sector of the depth and security, inside or outside a corridor. */
  function chunkWith(depth: number, security: string, corridor: boolean): [number, number] | null {
    for (const r of world.regions) {
      if (r.seed.depth !== depth || r.security !== security || r.fixed === 'corner1') continue;
      for (const [cx, cy] of chunksOf(seed, r.seed.id, 40)) {
        const c = centre(cx, cy);
        if (Math.hypot(c.x, c.y) < 1000) continue;
        const lane = Math.min(...world.lanes.map((l) => Math.min(...l.points.map((p) => Math.hypot(p.x - c.x, p.y - c.y)))));
        if ((lane <= REGION_GEN.lanes.corridor - 20) === corridor && (corridor || lane > REGION_GEN.lanes.corridor + 20)) return [cx, cy];
      }
    }
    return null;
  }

  it('Guarded ×0.5, Contested ×1, Pirate ×1.4 of the depth rate; the corridor ×0.2; depth 1 (but the corner) none', () => {
    const cases: [number, string, number][] = [
      [2, 'guarded', 0.5],
      [2, 'contested', 1],
      [2, 'pirate', 1.4],
      [3, 'contested', 1],
      [3, 'pirate', 1.4],
    ];
    for (const [depth, security, mult] of cases) {
      const open = chunkWith(depth, security, false);
      expect(open, `${depth} ${security}`).not.toBeNull();
      const p = chunkPirates(world, open![0], open![1], awake);
      expect(p.group).toBeCloseTo(PIRATE_GROUPS.rate[depth as 2 | 3] * mult, 9);
      expect(p.hammerShare).toBe(PIRATE_GROUPS.hammerShare[depth as 2 | 3]);
    }
    const lane = chunkWith(2, 'contested', true) ?? chunkWith(2, 'pirate', true);
    expect(lane).not.toBeNull();
    const p = chunkPirates(world, lane![0], lane![1], awake);
    expect(p.group / (PIRATE_GROUPS.rate[2] * REGION_GEN.groupMult[p.security])).toBeCloseTo(REGION_GEN.lanes.corridorPirates, 9);
    for (const r of world.regions) {
      if (r.seed.depth !== 1 || r.seed.id === world.corners.depth1) continue;
      for (const [cx, cy] of chunksOf(seed, r.seed.id)) expect(chunkPirates(world, cx, cy, awake).group).toBe(0);
    }
  });

  it('a fortress sector turns Contested (×1.0) while its fortress is destroyed', () => {
    const [fid, rid] = [...world.fortressRegions][0]!;
    const [cx, cy] = chunksOf(seed, rid, 25).find(([x, y]) => {
      const c = centre(x, y);
      return Math.min(...world.lanes.map((l) => Math.min(...l.points.map((q) => Math.hypot(q.x - c.x, q.y - c.y))))) > 300;
    })!;
    expect(chunkPirates(world, cx, cy, awake).security).toBe('pirate');
    const fallen = chunkPirates(world, cx, cy, ctx(false, 2, [fid]));
    expect(fallen.security).toBe('contested');
    expect(fallen.group).toBeCloseTo(PIRATE_GROUPS.rate[2], 9);
  });

  it('dangerous = Contested or Pirate (or the awake corner); never within 1 000 u', () => {
    expect(dangerousAt(world, 0, 0, awake)).toBe(false);
    for (const r of world.regions) {
      const p = r.seed;
      if (Math.hypot(p.x, p.y) < 1000 || world.field.regionAt(p.x, p.y).id !== p.id) continue;
      const expected = p.id === world.corners.depth1 ? true : p.depth > 1 && (r.security === 'contested' || r.security === 'pirate');
      expect(dangerousAt(world, p.x, p.y, awake), p.id).toBe(expected);
      if (p.id === world.corners.depth1) expect(dangerousAt(world, p.x, p.y, ctx(false, 0))).toBe(false);
    }
  });
});

describe('attention, toll and hunting parties by sector (§3.1, §6.1)', () => {
  const seed = 4242;
  const world = regionWorld(seed);
  /** A point of a sector that lies in it (its seed, if the seed's own cell holds it), away from the lanes. */
  const pointOf = (pred: (id: string, depth: number, security: string) => boolean) => {
    for (const r of world.regions) {
      const p = r.seed;
      if (Math.hypot(p.x, p.y) < 1200 || world.field.regionAt(p.x, p.y).id !== p.id || !pred(p.id, p.depth, r.security)) continue;
      if (world.lanes.some((l) => l.points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 400))) continue;
      return { x: p.x, y: p.y, id: p.id };
    }
    throw new Error('no such sector');
  };
  /** Attention gains are multiplied by the local conditions where the ship is. */
  const gainAt = (sim: ReturnType<typeof flyingAt>) => sectorEffects(sectorAt(seed, sim.state.player.body.pos, sim.state.tick)).attentionMult;

  it('+2 attention on the first contact with a Pirate sector, never again on a return', () => {
    const pirate = pointOf((id, depth, s) => s === 'pirate' && depth >= 2 && id !== world.corners.depth2);
    const sim = flyingAt(seed, { x: 0, y: 300 });
    sim.state.tick = SECTOR_EPOCH_TICKS * 2;
    run(sim, 2);
    expect(sim.state.pirates.attention).toBe(0);
    teleport(sim, pirate);
    run(sim, 1);
    expect(sim.state.pirates.attention).toBeCloseTo((ATTENTION.pirateSectorFirst + ATTENTION.newChunk) * gainAt(sim), 3);
    // away and back: only the chunk gain
    teleport(sim, { x: 0, y: 300 });
    run(sim, 1);
    const before = sim.state.pirates.attention;
    teleport(sim, pirate);
    run(sim, 1);
    expect(sim.state.pirates.attention - before).toBeCloseTo(ATTENTION.newChunk * gainAt(sim), 3);
  });

  it('Guarded sectors count as "outside": no gains, three times faster decay', () => {
    const guarded = pointOf((_, depth, s) => s === 'guarded' && depth >= 2);
    const sim = flyingAt(seed, guarded);
    sim.state.tick = SECTOR_EPOCH_TICKS * 2;
    run(sim, 1);
    sim.state.pirates.attention = 50;
    sim.state.player.cargo.titanium = 40;
    run(sim, 60 * 60);
    expect(50 - sim.state.pirates.attention).toBeCloseTo(1 / 3, 2);
  });

  it('the toll grows with the sector depth; Guarded sectors never hail (chance 0)', () => {
    const d2 = pointOf((_, depth, s) => depth === 2 && s === 'contested');
    const d3 = pointOf((_, depth, s) => depth === 3 && s === 'contested');
    const a = flyingAt(seed, d2);
    const b = flyingAt(seed, d3);
    expect(tollAmount(b.state) - tollAmount(a.state)).toBe(TOLL.perDepth);
    expect(TOLL.chance.guarded).toBe(0);
    expect(TOLL.chance.quiet).toBe(0);
    expect(TOLL.chance.pirate).toBeGreaterThan(TOLL.chance.contested);
  });

  it('a hunting party only comes in a dangerous sector and out of one', () => {
    const safe = flyingAt(seed, pointOf((_, depth, s) => depth >= 2 && s === 'guarded'));
    safe.state.tick = SECTOR_EPOCH_TICKS * 2;
    safe.state.pirates.attention = 65;
    expect(run(safe, 30).some((e) => e.type === 'huntingParty')).toBe(false);
    const hot = flyingAt(seed, pointOf((_, depth, s) => depth === 2 && s === 'contested'));
    hot.state.tick = SECTOR_EPOCH_TICKS * 2;
    hot.state.pirates.attention = 65;
    const party = run(hot, 30).find((e) => e.type === 'huntingParty');
    expect(party).toBeDefined();
    if (party?.type === 'huntingParty') expect(dangerousAt(world, party.pos.x, party.pos.y, spawnContext(hot.state))).toBe(true);
  });
});

describe('raids strike stations in dangerous sectors (stage 1b)', () => {
  it('the natural raid goes to the nearest discovered station of a Contested or Pirate sector, never a Guarded one', () => {
    let checked = 0;
    for (const seed of [4242, 1337, 7]) {
      const stations = stationsInArea(seed, -20, 20, -20, 20).filter((s) => s.kind !== 'home');
      const dangerous = stations.filter((s) => dangerousAt(regionWorld(seed), s.pos.x, s.pos.y, spawnContext(flyingAt(seed, { x: 0, y: 0 }).state)));
      const safe = stations.filter((s) => !dangerous.includes(s) && Math.hypot(s.pos.x, s.pos.y) > 1500);
      if (dangerous.length === 0 || safe.length === 0) continue;
      // the ship waits next to a station of a safe sector: a ring-based rule would raid it
      const at = safe[0]!;
      const sim = flyingAt(seed, { x: at.pos.x + 300, y: at.pos.y });
      sim.state.career.training.status = 'done';
      sim.state.tick = SECTOR_EPOCH_TICKS * 2;
      for (const s of stations) sim.state.world.discovered.add(s.id);
      sim.state.pirates.attention = 95;
      const announced = run(sim, 1).find((e) => e.type === 'raidAnnounced');
      expect(announced, `seed ${seed}`).toBeDefined();
      if (announced?.type !== 'raidAnnounced') continue;
      const pos = sim.state.player.body.pos;
      const nearest = [...dangerous].sort((a, b) => Math.hypot(a.pos.x - pos.x, a.pos.y - pos.y) - Math.hypot(b.pos.x - pos.x, b.pos.y - pos.y))[0]!;
      expect(announced.station, `seed ${seed}`).toBe(nearest.id);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
