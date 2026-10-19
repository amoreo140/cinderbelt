import { describe, expect, it } from 'vitest';
import { polylineDistance } from '../../sim/regions/lanes';
import { sectorInfoAt, sectorLanes } from '../../sim/regions/sectors';
import { ObstacleMap } from './obstacles';
import { CUTTER_SPEED, LANE_SIDE, lanePatrols, PATROL_CELL, routeShips, sectorPatrol, type PatrolRoute } from './guildWatch';

const SEED = 1337;
const obstacles = new ObstacleMap(SEED);
const near = (p: { x: number; y: number }) => obstacles.stationsNear(p);

function sectorRoutes(): PatrolRoute[] {
  const out: PatrolRoute[] = [];
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
    const r = sectorPatrol(SEED, i, j, near);
    if (r) out.push(r);
  }
  return out;
}

describe('Guild Watch lane patrols', () => {
  const routes = lanePatrols(SEED, sectorLanes(SEED), near);

  it('flies every lane, with a frigate group on lane A', () => {
    expect(new Set(routes.map((r) => r.id.split(':')[1]))).toEqual(new Set(['A', 'B']));
    expect(routes.some((r) => r.id.startsWith('lane:A') && r.members.some((m) => m.kind === 'frigate'))).toBe(true);
    expect(lanePatrols(SEED, sectorLanes(SEED), near)).toEqual(routes);
  });

  it('keeps beside its lane and out of the stations', () => {
    const lanes = sectorLanes(SEED);
    for (const r of routes) {
      const lane = lanes.find((l) => l.id === r.id.split(':')[1])!;
      let beside = 0;
      for (const p of r.points) {
        const d = polylineDistance(p, lane.points);
        if (Math.abs(d - LANE_SIDE) < 12) beside++;
        for (const s of obstacles.stationsNear(p)) expect(Math.hypot(p.x - s.pos.x, p.y - s.pos.y)).toBeGreaterThan(s.radius + 25);
      }
      expect(beside / r.points.length).toBeGreaterThan(0.8);
    }
  });

  it('moves smoothly at its speed – no jumps, also across the loop seam', () => {
    for (const r of routes) {
      for (let t = 0; t < r.length / r.speed + 5; t += 1.7) {
        const a = routeShips(r, t)[0]!;
        const b = routeShips(r, t + 0.1)[0]!;
        const d = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y);
        expect(d).toBeLessThan(r.speed * 0.1 * 1.6 + 0.05);
        expect(d).toBeGreaterThan(r.speed * 0.1 * 0.4);
        // the bow points along the motion
        const dir = Math.atan2(b.pos.y - a.pos.y, b.pos.x - a.pos.x);
        expect(Math.abs(Math.atan2(Math.sin(dir - a.heading), Math.cos(dir - a.heading)))).toBeLessThan(0.5);
      }
    }
    expect(CUTTER_SPEED).toBeGreaterThan(0);
  });

  it('swings the cutter guns within ±35°', () => {
    const r = routes.find((x) => x.members[0]!.kind === 'cutter')!;
    for (let t = 0; t < 60; t += 0.7) expect(Math.abs(routeShips(r, t)[0]!.gunYaw)).toBeLessThanOrEqual(0.61);
  });
});

describe('Guild Watch sector patrols', () => {
  it('circles only in Guarded sectors, deterministic, clear of the stations', () => {
    const routes = sectorRoutes();
    expect(routes.length).toBeGreaterThan(0);
    expect(sectorRoutes()).toEqual(routes);
    for (const r of routes) {
      let cx = 0;
      let cy = 0;
      for (const p of r.points) {
        cx += p.x;
        cy += p.y;
        for (const s of obstacles.stationsNear(p)) expect(Math.hypot(p.x - s.pos.x, p.y - s.pos.y)).toBeGreaterThan(s.radius + 25);
      }
      const [i, j] = r.id.slice(7).split(',').map(Number) as [number, number];
      // the centre was rolled inside the cell and in a Guarded sector
      const c = { x: cx / r.points.length, y: cy / r.points.length };
      expect(Math.floor(c.x / PATROL_CELL)).toBeGreaterThanOrEqual(i - 1);
      expect(Math.floor(c.y / PATROL_CELL)).toBeLessThanOrEqual(j + 1);
      expect(r.members.every((m) => m.kind === 'cutter')).toBe(true);
    }
    // no cell outside Guarded space gets one
    for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
      const r = sectorPatrol(SEED, i, j, near);
      if (!r) continue;
      const mid = r.points[0]!;
      expect(['guarded', 'quiet', 'contested', 'pirate']).toContain(sectorInfoAt(SEED, mid.x, mid.y).security);
    }
  });
});
