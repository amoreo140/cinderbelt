// The Guild Watch schedule in the simulation (M4d T3): the routes moved from the render are bit-identical
// (golden recorded from src/render/borders/guildWatch.ts + ObstacleMap before the move), a secured sector
// gets the same sector patrols a static Guarded one would, and the scheduled ships near a point.
import { describe, expect, it } from 'vitest';
import { sectorIdAt, sectorInfoAt, sectorLanes } from '../regions/sectors';
import { Simulation } from '../Simulation';
import {
  guardedNow,
  lanePatrols,
  parseWatchId,
  routeById,
  routeShips,
  routeStationsNear,
  scheduledAt,
  scheduledWatchNear,
  sectorPatrol,
  staticGuarded,
  watchId,
  type PatrolRoute,
} from './watchRoutes';

/** FNV-1a over a string (the golden hashes). */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Recorded from the render's guildWatch.ts (ObstacleMap stations) before the move (M4d T3). */
const GOLDEN: Record<number, { lanes: [number, string]; sectors: [number, string]; poses: string; sample: { x: number; y: number; heading: number } }> = {
  1: { lanes: [9, 'a64cf236'], sectors: [22, '89a96c36'], poses: 'b8cb8f28', sample: { x: -1128.851691641229, y: -261.25069010307857, heading: -1.8246364545255715 } },
  2: { lanes: [8, '56ac390e'], sectors: [7, 'ee661ce4'], poses: 'f899bc59', sample: { x: 233.55366112502136, y: 508.4516378492359, heading: 1.2207120819047 } },
  3: { lanes: [9, '08f86f8a'], sectors: [21, '83319089'], poses: 'fd05fcff', sample: { x: -337.62389081888927, y: -887.2623762776105, heading: -1.8869807115494897 } },
};

describe('Guild Watch routes in the simulation', () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: lane and sector routes and poses equal the pre-move render output`, () => {
      const near = routeStationsNear(seed);
      const lanes = lanePatrols(seed, sectorLanes(seed), near);
      const sectors: PatrolRoute[] = [];
      for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) {
        const r = sectorPatrol(seed, i, j, near);
        if (r) sectors.push(r);
      }
      const g = GOLDEN[seed]!;
      expect([lanes.length, fnv(JSON.stringify(lanes))]).toEqual(g.lanes);
      expect([sectors.length, fnv(JSON.stringify(sectors))]).toEqual(g.sectors);
      const poses = [...lanes, ...sectors].map((r) => [0, 17.3, 123.45, 1000.5, 98765.4321].map((t) => routeShips(r, t)));
      expect(fnv(JSON.stringify(poses))).toBe(g.poses);
      const s = routeShips(lanes[0]!, 17.3)[0]!;
      expect({ x: s.pos.x, y: s.pos.y, heading: s.heading }).toEqual(g.sample);
    });
  }

  it('a secured sector gets the sector patrols a static Guarded sector would', () => {
    const seed = 3;
    const sim = new Simulation({ seed });
    const near = routeStationsNear(seed);
    // a cell that rolls a patrol whose centre lies in a statically Contested sector
    let found: { i: number; j: number; route: PatrolRoute; sector: string } | null = null;
    for (let i = -10; i <= 10 && !found; i++) {
      for (let j = -10; j <= 10 && !found; j++) {
        const route = sectorPatrol(seed, i, j, near, () => true);
        if (!route) continue;
        // the centre is jittered within the middle half of the cell – ask the predicate the way the builder does
        const secured = new Set<string>();
        const probe = sectorPatrol(seed, i, j, near, (x, y) => {
          if (sectorInfoAt(seed, x, y).security === 'contested') secured.add(sectorIdAt(seed, x, y));
          return false;
        });
        expect(probe).toBeNull();
        if (secured.size === 1) found = { i, j, route, sector: [...secured][0]! };
      }
    }
    expect(found).not.toBeNull();
    const { i, j, route, sector } = found!;
    expect(sectorPatrol(seed, i, j, near, staticGuarded(seed))).toBeNull();
    expect(routeById(sim.state, route.id)).toBeNull();
    sim.state.guild.relays.set('A', { stage: 'secured', sector, tick: 0 });
    expect(sectorPatrol(seed, i, j, near, guardedNow(sim.state))).toEqual(route);
    expect(routeById(sim.state, route.id)).toEqual(route);
    // its ships are on the schedule near their loop
    const p = route.points[0]!;
    const ids = scheduledWatchNear(sim.state, p, 600).map((w) => w.id);
    expect(ids).toContain(watchId(route.id, 0));
    expect(ids).toContain(watchId(route.id, 1));
  });

  it('lists the scheduled ships near a point, nearest first, at their route poses', () => {
    const sim = new Simulation({ seed: 1 });
    const lane = routeById(sim.state, 'lane:A:0')!;
    sim.state.tick = 12_345;
    const w = scheduledAt(lane, 0, sim.state.tick);
    const near = scheduledWatchNear(sim.state, w.pos, 520);
    expect(near[0]!.id).toBe('gw:lane:A:0|0');
    expect(near[0]!.pos).toEqual(routeShips(lane, sim.state.tick / 60)[0]!.pos);
    for (let k = 1; k < near.length; k++) {
      const a = Math.hypot(near[k - 1]!.pos.x - w.pos.x, near[k - 1]!.pos.y - w.pos.y);
      const b = Math.hypot(near[k]!.pos.x - w.pos.x, near[k]!.pos.y - w.pos.y);
      expect(a).toBeLessThanOrEqual(b);
      expect(b).toBeLessThanOrEqual(520);
    }
    // the velocity is the schedule's motion (the frigate group's speed)
    expect(Math.hypot(w.vel.x, w.vel.y)).toBeCloseTo(lane.speed, 0);
    expect(parseWatchId('gw:sector:12,-3|1')).toEqual({ route: 'sector:12,-3', slot: 1 });
    expect(parseWatchId('pr:1,2:0')).toBeNull();
  });
});
