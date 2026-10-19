// M4d T2: the Guild relay sites (plan §2.2 "Relay sites") – one per lane in the first statically
// Contested depth-2 lane sector (lane A may fall back to depth 3), clear of the world, deterministic;
// the mast as a relay candidate (only while repaired), an obstacle and a projectile stop.
import { describe, expect, it } from 'vitest';
import { GUILD_RELAY_LAYOUT, RELAY_CHAIN } from '../../data/guild';
import { DERELICT_LAYOUTS, GRAVEYARD } from '../../data/sites';
import { flyingAt } from '../discovery/testing';
import type { MiningBeam } from '../mining/mining';
import { FORTRESS_LAYOUT, fortressSites } from '../pirates/sites';
import { REGION_GEN, sectorIdAt, sectorInfo, surveyPointsNear } from '../regions';
import { relayById, relayCandidates, sitesNear } from '../sites/placement';
import { receiverPos } from '../sites/relays';
import { CHUNK_SIZE, chunkCoord } from '../world/chunks';
import { generateChunk } from '../world/generate';
import { stationsInArea } from '../world/stations';
import { WORLD_GENS } from '../world/worldGen';
import {
  buildGuildRelaySites,
  guildRelayCandidates,
  guildRelaySites,
  laneRuns,
  relayMastColliders,
  relayMastHitTargets,
} from './relaySites';
import { sectorLanes } from '../regions';

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

describe('Guild relay sites', () => {
  it('20 seeds: most lanes get a site, each in a statically Contested on-lane sector of depth 2 (A: 2–3)', () => {
    let count = 0;
    for (const seed of SEEDS) {
      const sites = guildRelaySites(seed);
      count += sites.length;
      expect(sites.map((s) => s.lane)).toEqual([...new Set(sites.map((s) => s.lane))].sort());
      for (const s of sites) {
        expect(s.id).toBe(`gr:${s.lane}`);
        expect(s.relay).toEqual({ id: s.id, pos: s.pos, angle: s.angle, owner: 'guild', group: s.id });
        const info = sectorInfo(seed, s.sector)!;
        expect(info.security).toBe('contested');
        expect(info.fixed).toBeNull();
        expect(info.onLane).toBe(true);
        expect(info.depth).toBe(s.depth);
        expect(s.lane === 'A' ? [2, 3] : [2]).toContain(s.depth);
        expect(sectorIdAt(seed, s.pos.x, s.pos.y)).toBe(s.sector);
        // inside the corridor, outside the buoy line
        const lane = sectorLanes(seed).find((l) => l.id === s.lane)!;
        const toLane = Math.min(...lane.points.map((p) => dist(p, s.pos)));
        expect(toLane).toBeLessThanOrEqual(REGION_GEN.lanes.corridor);
      }
      // the lanes never share a relay sector
      expect(new Set(sites.map((s) => s.sector)).size).toBe(sites.length);
    }
    // plan estimate ≥ 36/40; the measured worlds give 34/40 – every miss is a lane B that crosses no
    // Contested depth-2 sector at all (the rule offers only Contested sectors)
    expect(count).toBeGreaterThanOrEqual(34);
  });

  it('a lane without a site has no eligible run (never a site lost to the clearances)', () => {
    for (const seed of SEEDS) {
      const sites = guildRelaySites(seed);
      for (const lane of sectorLanes(seed)) {
        if (sites.some((s) => s.lane === lane.id)) continue;
        const eligible = laneRuns(seed, lane).filter((r) => {
          const info = sectorInfo(seed, r.sector)!;
          return r.to - r.from >= REGION_GEN.lanes.laneMin && info.security === 'contested' && info.fixed === null && info.depth <= 3;
        });
        expect(eligible, `seed ${seed} lane ${lane.id}`).toEqual([]);
      }
    }
  });

  it('every mast keeps clear of stations, M4b sites, rocks, fortresses and survey points', () => {
    const C = RELAY_CHAIN.clear;
    const own = GUILD_RELAY_LAYOUT.clearRadius;
    for (const seed of SEEDS) {
      for (const s of guildRelaySites(seed)) {
        const cx = chunkCoord(s.pos.x);
        const cy = chunkCoord(s.pos.y);
        for (const gen of WORLD_GENS) {
          for (const st of stationsInArea(seed, cx - 3, cx + 3, cy - 3, cy + 3, gen)) expect(dist(st.pos, s.pos)).toBeGreaterThanOrEqual(st.clearRadius + C.station + own);
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              for (const a of generateChunk(seed, cx + dx, cy + dy, gen).asteroids) expect(dist(a.pos, s.pos)).toBeGreaterThanOrEqual(a.baseRadius + C.rock + own);
            }
          }
        }
        for (const site of sitesNear(seed, s.pos, 3 * CHUNK_SIZE)) {
          const r = site.kind === 'graveyard' ? GRAVEYARD.radius : DERELICT_LAYOUTS[site.model].clearRadius;
          expect(dist(site.pos, s.pos)).toBeGreaterThanOrEqual(r + C.site + own);
        }
        for (const f of fortressSites(seed)) expect(dist(f.pos, s.pos)).toBeGreaterThanOrEqual(FORTRESS_LAYOUT.clearRadius + C.fortress + own);
        expect(surveyPointsNear(seed, s.pos, C.survey + own).filter((p) => dist(p.pos, s.pos) < C.survey + own)).toEqual([]);
      }
    }
  });

  it('is deterministic (the cache equals a fresh build)', () => {
    for (const seed of [1, 2, 3, 9, 14]) expect(JSON.stringify(buildGuildRelaySites(seed))).toBe(JSON.stringify(guildRelaySites(seed)));
  });

  it('golden: the sites of seeds 1–5', () => {
    const golden = [1, 2, 3, 4, 5].map((seed) =>
      guildRelaySites(seed).map((s) => `${seed} ${s.id} ${s.sector} d${s.depth} (${s.pos.x.toFixed(1)}, ${s.pos.y.toFixed(1)}) ${s.angle.toFixed(3)}`),
    );
    expect(golden.flat()).toMatchInlineSnapshot(`
      [
        "1 gr:A rg:B:-4,-3 d2 (-1903.0, -1642.4) -0.831",
        "1 gr:B rg:B:2,1 d2 (1328.9, 1397.4) 1.081",
        "2 gr:A rg:B:0,4 d2 (383.0, 2729.1) 3.028",
        "2 gr:B rg:B:2,-7 d2 (1184.5, -3053.4) -3.106",
        "3 gr:A rg:B:-2,-7 d2 (-1117.5, -3554.3) 2.818",
        "3 gr:B rg:B:-3,3 d2 (-1517.2, 2205.4) -2.513",
        "4 gr:A rg:B:3,1 d2 (1786.4, 1154.4) 2.177",
        "5 gr:A rg:B:0,2 d2 (713.8, 1628.4) 2.844",
        "5 gr:B rg:B:-3,-2 d2 (-1488.4, -914.3) -0.980",
      ]
    `);
  });
});

describe('Guild relay mast in the world', () => {
  const seed = 1;
  const site = guildRelaySites(seed)[0]!;
  const beamOnLens = (): MiningBeam => {
    const lens = receiverPos(site.relay);
    return { laser: 0, from: { x: lens.x - 10, y: lens.y + 0.3 }, to: { x: lens.x + 0.2, y: lens.y }, asteroidId: null, resource: null, bonus: 1, vein: null };
  };

  it('relayById resolves the Guild ids of the seed only', () => {
    expect(relayById(seed, site.id)).toEqual(site.relay);
    expect(relayById(seed, 'gr:C')).toBeNull();
  });

  it('is a relay candidate only while its lane is repaired and not powered', () => {
    const sim = flyingAt(seed, { x: site.pos.x - 20, y: site.pos.y });
    const state = sim.state;
    state.player.beams = [beamOnLens()];
    expect(guildRelayCandidates(state)).toEqual([]);
    expect(relayCandidates(state).some((r) => r.id === site.id)).toBe(false);
    state.guild.relays.set(site.lane, { stage: 'repaired', sector: site.sector, tick: 0 });
    expect(guildRelayCandidates(state)).toEqual([site.relay]);
    expect(relayCandidates(state).some((r) => r.id === site.id)).toBe(true);
    state.sites.powered.add(site.id);
    expect(guildRelayCandidates(state)).toEqual([]);
    // out of laser reach
    state.sites.powered.delete(site.id);
    state.player.body = { ...state.player.body, pos: { x: site.pos.x + 400, y: site.pos.y } };
    expect(guildRelayCandidates(state)).toEqual([]);
  });

  it('collides and stops projectiles near the player, whatever its stage', () => {
    const sim = flyingAt(seed, { x: site.pos.x - 30, y: site.pos.y });
    const c = relayMastColliders(sim.state, site.pos, 5);
    expect(c).toHaveLength(1);
    expect(c[0]!.radius).toBe(GUILD_RELAY_LAYOUT.circles[0]!.r);
    expect(relayMastColliders(sim.state, { x: site.pos.x + 50, y: site.pos.y }, 5)).toHaveLength(0);
    expect(relayMastHitTargets(sim.state)).toEqual([{ id: site.id, kind: 'relay', pos: site.pos, radius: 1.5, shield: 0, damageable: false }]);
    sim.state.player.body = { ...sim.state.player.body, pos: { x: site.pos.x + 2000, y: site.pos.y } };
    expect(relayMastHitTargets(sim.state)).toHaveLength(0);
  });
});
