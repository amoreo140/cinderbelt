// M4d T5: the published convoy schedule (plan §2.5) – deterministic passes on both lanes, the period and
// the lane offset, out → turn-around → back, clear of every station, the composition and its spacing,
// the colliders / hit targets of the scheduled ships and the sectors a pass crosses in an epoch.
import { describe, expect, it } from 'vitest';
import { CONVOY, CONVOY_SHAPES } from '../../data/convoys';
import { GIANT_RADIUS } from '../../data/poi';
import { SECTOR_EPOCH_TICKS } from '../../data/sector';
import { poisInChunk } from '../discovery/poi';
import { flyingAt } from '../discovery/testing';
import { sectorIdAt, sectorLanes } from '../regions/sectors';
import { chunkCoord } from '../world/chunks';
import { generateChunk } from '../world/generate';
import { stationAt } from '../world/stations';
import { WORLD_GENS } from '../world/worldGen';
import { linkPose } from './link';
import {
  convoyAt,
  convoyComposition,
  convoyPassWindow,
  convoyRoutes,
  convoySectorsInEpoch,
  convoyShipCircles,
  convoysInFlight,
  convoysNear,
  departureTick,
  parseConvoyPass,
  scheduledConvoyColliders,
  scheduledConvoyHitTargets,
} from './schedule';

const SEEDS = [1, 2, 3, 42, 1337] as const;
const T = 60;

describe('convoy schedule', () => {
  it('every seed has a route on both lanes, flown in rings 1–3', () => {
    for (const seed of SEEDS) {
      const routes = convoyRoutes(seed);
      expect(routes.map((r) => r.lane)).toEqual(['A', 'B']);
      for (const r of routes) {
        expect(r.outLen).toBeGreaterThan(1000);
        expect(Math.max(...r.points.map((p) => Math.hypot(p.x, p.y)))).toBeLessThan(8000);
        // out + U-turn + back at the cruise speed, the turn takes its 60 s
        expect(r.turnTicks).toBe(CONVOY.turnSeconds * T);
        expect(r.durationTicks).toBeCloseTo(((r.outLen + r.backLen) / CONVOY.speed + CONVOY.turnSeconds) * T, 6);
        // a lane's passes never overlap
        expect(r.durationTicks).toBeLessThan(CONVOY.periodTicks);
      }
    }
  });

  it('is deterministic and the pass ids are stable', () => {
    const tick = 3 * CONVOY.periodTicks + 12_345;
    const a = convoysInFlight(42, tick);
    const b = convoysInFlight(42, tick);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    for (const p of a) {
      expect(p.pass).toMatch(/^cv:[AB]@\d+$/);
      expect(convoyAt(42, p.pass, tick)).toEqual(p);
      const id = parseConvoyPass(p.pass)!;
      expect(id.lane).toBe(p.lane);
    }
    expect(parseConvoyPass('cv:C@1')).toBeNull();
    expect(parseConvoyPass('cv:A@-1')).toBeNull();
    expect(convoyAt(42, 'garbage', tick)).toBeNull();
  });

  it('departs every period on each lane, lane B half a period later', () => {
    for (const n of [0, 1, 7]) {
      expect(departureTick('A', n)).toBe(n * CONVOY.periodTicks);
      expect(departureTick('B', n) - departureTick('A', n)).toBe(CONVOY.periodTicks / 2);
      for (const lane of ['A', 'B'] as const) {
        const pass = `cv:${lane}@${n}`;
        const d = departureTick(lane, n);
        expect(convoyAt(1, pass, d - 1)).toBeNull();
        const start = convoyAt(1, pass, d)!;
        expect(start.leg).toBe('out');
        // the route starts CONVOY.startOffset past home (± the side offset)
        expect(Math.abs(Math.hypot(start.ships[0]!.pos.x, start.ships[0]!.pos.y) - CONVOY.startOffset)).toBeLessThan(CONVOY.side + 5);
      }
    }
  });

  it('flies out, turns around at the lane end for 60 s and comes back, then the pass is over', () => {
    for (const seed of SEEDS) {
      const pass = 'cv:B@2';
      const w = convoyPassWindow(seed, pass)!;
      expect(convoyAt(seed, pass, w.turn - 1)!.leg).toBe('out');
      expect(convoyAt(seed, pass, w.turn + 1)!.leg).toBe('turn');
      expect(w.back - w.turn).toBe(CONVOY.turnSeconds * T);
      expect(convoyAt(seed, pass, w.back + 1)!.leg).toBe('back');
      expect(convoyAt(seed, pass, Math.ceil(w.end))).toBeNull();
      // out on the right of the lane, back on its left (mostly – a leg may swing across around a rock field)
      const lane = sectorLanes(seed).find((l) => l.id === 'B')!.points;
      const sideOf = (p: { x: number; y: number }): number => {
        let best = Infinity;
        let side = 0;
        for (let i = 1; i < lane.length; i++) {
          const a = lane[i - 1]!;
          const b = lane[i]!;
          const abx = b.x - a.x;
          const aby = b.y - a.y;
          const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby)));
          const d = Math.hypot(p.x - a.x - abx * t, p.y - a.y - aby * t);
          if (d < best) {
            best = d;
            side = Math.sign(abx * (p.y - a.y) - aby * (p.x - a.x));
          }
        }
        return side;
      };
      let right = 0;
      let left = 0;
      for (let k = 1; k <= 20; k++) {
        if (sideOf(convoyAt(seed, pass, w.depart + k * 20 * T)!.ships[0]!.pos) < 0) right++;
        if (sideOf(convoyAt(seed, pass, Math.ceil(w.end) - k * 20 * T)!.ships[0]!.pos) > 0) left++;
      }
      expect(right, `${seed} out`).toBeGreaterThanOrEqual(12);
      expect(left, `${seed} back`).toBeGreaterThanOrEqual(12);
      // the turn-around is slow, the legs fly at the cruise speed
      expect(Math.hypot(convoyAt(seed, pass, w.depart + 100 * T)!.vel.x, convoyAt(seed, pass, w.depart + 100 * T)!.vel.y)).toBeCloseTo(CONVOY.speed, 9);
      const turn = convoyAt(seed, pass, w.turn + 30 * T)!.vel;
      // (~1 u/s; faster when the U-turn swings wide around a rock)
      expect(Math.hypot(turn.x, turn.y)).toBeLessThan(CONVOY.speed / 2);
    }
  });

  it('the velocity is the motion of the trader', () => {
    const pass = 'cv:A@1';
    const w = convoyPassWindow(3, pass)!;
    for (const t of [w.depart + 200 * T, w.back + 120 * T]) {
      const a = convoyAt(3, pass, t)!;
      const b = convoyAt(3, pass, t + 1)!;
      expect((b.ships[0]!.pos.x - a.ships[0]!.pos.x) * T).toBeCloseTo(a.vel.x, 1);
      expect((b.ships[0]!.pos.y - a.ships[0]!.pos.y) * T).toBeCloseTo(a.vel.y, 1);
    }
  });

  it('never flies inside a station clear circle, the hulls never touch a station', () => {
    for (const seed of SEEDS) {
      for (const route of convoyRoutes(seed)) {
        const pass = `cv:${route.lane}@0`;
        const w = convoyPassWindow(seed, pass)!;
        for (let t = Math.ceil(w.depart); t < w.end; t += 30) {
          const pose = convoyAt(seed, pass, t)!;
          for (const ship of pose.ships) {
            for (let dx = -1; dx <= 1; dx++) {
              for (let dy = -1; dy <= 1; dy++) {
                for (const gen of WORLD_GENS) {
                  const s = stationAt(seed, chunkCoord(ship.pos.x) + dx, chunkCoord(ship.pos.y) + dy, gen);
                  if (!s) continue;
                  const d = Math.hypot(ship.pos.x - s.pos.x, ship.pos.y - s.pos.y);
                  if (ship.kind === 'trader') expect(d, `${seed} ${pass} ${t} ${s.id}`).toBeGreaterThanOrEqual(s.clearRadius - 1e-6);
                  for (const c of convoyShipCircles(ship.kind, ship.pos, ship.heading, pose.vel)) {
                    expect(Math.hypot(c.pos.x - s.pos.x, c.pos.y - s.pos.y)).toBeGreaterThan(s.radius + c.radius);
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  it('flies around the rocks and the giants on the way: no ship and no linked ship (bounding radius 7) touches one', () => {
    const touching: string[] = [];
    for (const seed of [2, 3, 11]) {
      const memo = new Map<string, { x: number; y: number; r: number }[]>();
      const rocksNear = (p: { x: number; y: number }): { x: number; y: number; r: number }[] => {
        const out: { x: number; y: number; r: number }[] = [];
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const cx = chunkCoord(p.x) + dx;
            const cy = chunkCoord(p.y) + dy;
            const key = `${cx},${cy}`;
            let list = memo.get(key);
            if (!list) {
              list = [];
              for (const gen of WORLD_GENS) for (const a of generateChunk(seed, cx, cy, gen).asteroids) list.push({ x: a.pos.x, y: a.pos.y, r: a.baseRadius });
              for (const poi of poisInChunk(seed, cx, cy)) if (poi.kind === 'giant') list.push({ x: poi.pos.x, y: poi.pos.y, r: GIANT_RADIUS });
              memo.set(key, list);
            }
            out.push(...list);
          }
        }
        return out;
      };
      for (const route of convoyRoutes(seed)) {
        let n = 1;
        while (!(convoyComposition(seed, route.lane, n).tanker && convoyComposition(seed, route.lane, n).cutter)) n++;
        const pass = `cv:${route.lane}@${n}`;
        const w = convoyPassWindow(seed, pass)!;
        for (let t = Math.ceil(w.depart); t < w.end; t += 30) {
          const pose = convoyAt(seed, pass, t)!;
          const rocks = rocksNear(pose.ships[0]!.pos);
          const circles = pose.ships.flatMap((ship) => convoyShipCircles(ship.kind, ship.pos, ship.heading, pose.vel));
          if (pose.leg !== 'turn') circles.push({ pos: linkPose(pose, 7).pos, radius: 7 });
          for (const c of circles) {
            for (const r of rocks) if (Math.hypot(c.pos.x - r.x, c.pos.y - r.y) <= c.radius + r.r) touching.push(`${seed} ${pass} ${t} (${r.x.toFixed(0)}, ${r.y.toFixed(0)})`);
          }
        }
      }
    }
    expect(touching).toEqual([]);
  }, 20_000);

  it('the tanker trails 16 u behind, the cutter flies ahead; the hulls never overlap', () => {
    let tankers = 0;
    let cutters = 0;
    for (let n = 0; n < 200; n++) {
      const mix = convoyComposition(1, n % 2 ? 'A' : 'B', n);
      tankers += mix.tanker ? 1 : 0;
      cutters += mix.cutter ? 1 : 0;
    }
    expect(tankers / 200).toBeGreaterThan(0.35);
    expect(tankers / 200).toBeLessThan(0.65);
    expect(cutters / 200).toBeGreaterThan(0.18);
    expect(cutters / 200).toBeLessThan(0.42);
    // a pass with all three ships, followed through the whole flight
    let n = 0;
    while (!(convoyComposition(2, 'A', n).tanker && convoyComposition(2, 'A', n).cutter)) n++;
    const pass = `cv:A@${n}`;
    const w = convoyPassWindow(2, pass)!;
    for (let t = Math.ceil(w.depart); t < w.end; t += 20) {
      const pose = convoyAt(2, pass, t)!;
      expect(pose.ships.map((s) => s.kind)).toEqual(['trader', 'tanker', 'cutter']);
      const circles = pose.ships.map((s) => convoyShipCircles(s.kind, s.pos, s.heading, pose.vel));
      for (let i = 0; i < circles.length; i++) {
        for (let j = i + 1; j < circles.length; j++) {
          for (const a of circles[i]!) for (const b of circles[j]!) expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y)).toBeGreaterThan(a.radius + b.radius);
        }
      }
      const [trader, tanker] = pose.ships;
      if (pose.leg !== 'turn') expect(Math.hypot(trader!.pos.x - tanker!.pos.x, trader!.pos.y - tanker!.pos.y)).toBeGreaterThan(14.3);
    }
  });

  it('convoysNear finds a pass by any of its ships', () => {
    const tick = departureTick('A', 4) + 150 * T;
    const pose = convoyAt(1, 'cv:A@4', tick)!;
    const at = pose.ships[0]!.pos;
    expect(convoysNear(1, { x: at.x + 30, y: at.y }, 31, tick).map((p) => p.pass)).toContain('cv:A@4');
    expect(convoysNear(1, { x: at.x + 300, y: at.y }, 31, tick).map((p) => p.pass)).not.toContain('cv:A@4');
  });
});

describe('scheduled convoy ships in the simulation', () => {
  it('are safe moving obstacles near a point and projectile targets near the player, never damageable', () => {
    const tick = departureTick('B', 3) + 120 * T;
    const pose = convoyAt(3, 'cv:B@3', tick + 1)!;
    const trader = pose.ships[0]!;
    const sim = flyingAt(3, { x: trader.pos.x + 60, y: trader.pos.y });
    sim.state.tick = tick;
    const near = scheduledConvoyColliders(sim.state, trader.pos, 10);
    expect(near.length).toBeGreaterThanOrEqual(CONVOY_SHAPES.trader.circles.length);
    for (const c of near) {
      expect(c.safe).toBe(true);
      expect(c.vel).toEqual(pose.vel);
    }
    expect(scheduledConvoyColliders(sim.state, { x: trader.pos.x + 500, y: trader.pos.y }, 10)).toHaveLength(0);
    const targets = scheduledConvoyHitTargets(sim.state);
    expect(targets.length).toBe(pose.ships.reduce((a, s) => a + CONVOY_SHAPES[s.kind].circles.length, 0));
    for (const t of targets) {
      expect(t).toMatchObject({ kind: 'convoy', damageable: false, shield: 0 });
      expect(t.id).toMatch(/^cv:B@3:(trader|tanker|cutter)$/);
    }
    // far from every pass: nothing (and no allocation)
    const far = flyingAt(3, { x: 20_000, y: 20_000 });
    far.state.tick = tick;
    expect(scheduledConvoyHitTargets(far.state)).toBe(scheduledConvoyHitTargets(far.state));
    expect(scheduledConvoyHitTargets(far.state)).toHaveLength(0);
  });
});

describe('sectors a convoy crosses in an epoch', () => {
  it('holds every sector the trader is in during the epoch, and nothing when no pass flies', () => {
    for (const seed of [1, 42]) {
      for (const epoch of [1, 2, 5]) {
        const set = convoySectorsInEpoch(seed, epoch);
        expect(set.size).toBeGreaterThan(0);
        const from = epoch * SECTOR_EPOCH_TICKS;
        for (let t = from; t < from + SECTOR_EPOCH_TICKS; t += 600) {
          for (const pose of convoysInFlight(seed, t)) {
            const p = pose.ships[0]!.pos;
            expect(set.has(sectorIdAt(seed, p.x, p.y))).toBe(true);
          }
        }
        // the same set again (cached, pure)
        expect(convoySectorsInEpoch(seed, epoch)).toEqual(set);
      }
    }
  });
});
