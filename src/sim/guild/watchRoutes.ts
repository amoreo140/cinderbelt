// Guild Watch schedule (M4d "Schedule"; the sector design: Guild Watch in Guarded sectors; art batch
// C1/C2): patrols of Guild cutters – now and then led by a frigate – flying the Guild Lanes and circling
// in Guarded sectors. Every ship is a pure function of (world seed, route, time), like the station
// traffic. The math moved here from src/render/borders/guildWatch.ts (the render re-exports it, golden
// test: the routes and poses are bit-identical); near the player the simulation turns scheduled ships
// into live ones (watch.ts) at exactly these poses.
//
//   Lane patrols: a closed loop per lane – out along the lane 45 u to the right of the line, a wide
//     U-turn at the end, back on the other side, a U-turn short of home – pushed clear of the
//     stations on the way and smoothed. Groups ride the loop evenly spaced.
//   Sector patrols: one cell of 900 u at a time; a cell whose jittered centre lies in a sector Guarded
//     NOW (static Guarded + secured by a Guild relay – the `guarded(x, y)` predicate) may hold a pair of
//     cutters on a circle of 160–260 u.
//   Relay patrols (sim only): the reinforcement of a relay hold circles the Guild relay mast.
//
// Station clearance comes from the stations' layout radii – the same numbers (and the same station
// order) the render ObstacleMap uses, so the render and the simulation build the same loops.
import { RELAY_CHAIN, WATCH, type WatchKind } from '../../data/guild';
import { hypot, type Vec2 } from '../math/vec2';
import { securityOverrides } from '../pirates/sectors';
import type { LaneId } from '../regions/lanes';
import { sectorIdAt, sectorInfoAt, sectorLanes, sectorSecurity } from '../regions/sectors';
import type { SimState } from '../Simulation';
import { chunkCoord } from '../world/chunks';
import { hash3 } from '../world/hash';
import { stationAt } from '../world/stations';
import { guildRelaySites } from './relaySites';
import type { GuildRelaySite } from './types';

/** Lane loop: distance beside the line, first point past home, gap kept from stations (u). */
export const LANE_SIDE = 45;
const LANE_START = 320;
const LANE_END_TRIM = 40;
const STATION_GAP = 30;
/** Speeds (u/s): cutters patrol fast, a frigate group slowly. */
export const CUTTER_SPEED = 16;
export const FRIGATE_SPEED = 9;
const SECTOR_SPEED = 13;
/** Loop length per lane group (u). */
const GROUP_SPACING = 1800;
/** Sector patrol cell (u) and the share of Guarded cells that hold a pair. */
export const PATROL_CELL = WATCH.sectorCell;
const SECTOR_CHANCE = 0.7;
const SALT = 0x6a7c_4ed1;
/** The relay reinforcement circles the mast at this radius (u) and speed (u/s). */
const RELAY_ORBIT = 120;
const RELAY_SPEED = 9;
/** Simulation step (s) – the schedule time of tick n is n · SIM_STEP (the render's `simTime`). */
const SIM_STEP = 1 / 60;

/** A station the routes keep clear of (the render's `ObstacleStation` fits). */
export interface RouteStation {
  pos: Vec2;
  radius: number;
  clearRadius: number;
}

export type StationsNear = (p: Vec2) => readonly RouteStation[];
/** Is the world point in a sector Guarded now? */
export type GuardedAt = (x: number, y: number) => boolean;

export interface PatrolMember {
  kind: WatchKind;
  /** Arc distance behind the group's leader (u) and side offset (u, + = right of travel). */
  behind: number;
  side: number;
}

export interface PatrolRoute {
  id: string;
  /** Closed loop (the last point joins the first). */
  points: Vec2[];
  arc: number[];
  length: number;
  speed: number;
  /** Arc of the group's leader at time 0. */
  start: number;
  members: PatrolMember[];
  /** 0..1 – shown when below the traffic density of the graphics preset. */
  rank: number;
  /** Lane routes show on every setting with traffic; sector patrols only from Medium. */
  lane: boolean;
}

/** A scheduled ship's pose on its route at a time (the render's patrol ship). */
export interface RoutePose {
  route: string;
  slot: number;
  kind: WatchKind;
  pos: Vec2;
  /** Sim heading of the bow (rad). */
  heading: number;
  /** Idle yaw of the cutter's guns (rad, ±35°) and the frigate's turret (rad). */
  gunYaw: number;
  /** 0..1 – lamp phase. */
  phase: number;
}

const unit = (x: number, y: number): Vec2 => {
  const l = hypot(x, y);
  return l > 1e-9 ? { x: x / l, y: y / l } : { x: 1, y: 0 };
};

const rand = (seed: number, a: number, b: number, k: number): number => hash3(hash3(seed ^ SALT, a, b), k, 0x77a1) / 4294967296;

/** Cumulative arc length of a polyline. */
export const polylineArc = (points: readonly Vec2[]): number[] => {
  const arc = [0];
  for (let i = 1; i < points.length; i++) arc.push(arc[i - 1]! + hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  return arc;
};

/** Point at arc `s` of a polyline with its arc table. */
function at(points: readonly Vec2[], arc: readonly number[], s: number): Vec2 {
  return atInto(points, arc, s, { x: 0, y: 0 });
}

/** `at` written into `out` (the per-step poses – no object per query). Returns `out`. */
function atInto(points: readonly Vec2[], arc: readonly number[], s: number, out: Vec2): Vec2 {
  let lo = 0;
  let hi = arc.length - 1;
  if (s <= 0) {
    out.x = points[0]!.x;
    out.y = points[0]!.y;
    return out;
  }
  if (s >= arc[hi]!) {
    out.x = points[hi]!.x;
    out.y = points[hi]!.y;
    return out;
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arc[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const t = (s - arc[lo]!) / Math.max(1e-9, arc[hi]! - arc[lo]!);
  out.x = points[lo]!.x + (points[hi]!.x - points[lo]!.x) * t;
  out.y = points[lo]!.y + (points[hi]!.y - points[lo]!.y) * t;
  return out;
}

/** Pushes loop points out of the stations' clear area and smooths the loop (closed). */
function clearAndSmooth(points: Vec2[], stationsNear: StationsNear): Vec2[] {
  let out = points.map((p) => ({ ...p }));
  for (let pass = 0; pass < 3; pass++) {
    for (const p of out) {
      for (const s of stationsNear(p)) {
        const need = Math.max(s.clearRadius, s.radius + STATION_GAP);
        const dx = p.x - s.pos.x;
        const dy = p.y - s.pos.y;
        const d = hypot(dx, dy);
        if (d >= need) continue;
        const u = d > 1e-6 ? { x: dx / d, y: dy / d } : { x: 1, y: 0 };
        p.x = s.pos.x + u.x * need;
        p.y = s.pos.y + u.y * need;
      }
    }
    if (pass === 2) break;
    // Laplacian smoothing of the closed loop
    const n = out.length;
    out = out.map((p, i) => {
      const a = out[(i - 1 + n) % n]!;
      const b = out[(i + 1) % n]!;
      return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 };
    });
  }
  return out;
}

function closeLoop(points: Vec2[]): { points: Vec2[]; arc: number[]; length: number } {
  const closed = [...points, points[0]!];
  const arc = polylineArc(closed);
  return { points: closed, arc, length: arc[arc.length - 1]! };
}

/** The patrol loop of a lane (see the header), or null for a lane too short to patrol. */
export function laneLoop(lane: { points: readonly Vec2[] }, stationsNear: StationsNear): { points: Vec2[]; arc: number[]; length: number } | null {
  const arc = polylineArc(lane.points);
  const total = arc[arc.length - 1]!;
  const s0 = LANE_START;
  const s1 = total - LANE_END_TRIM;
  if (s1 - s0 < 400) return null;
  // the centre line averaged over ±60 u: corners (the lane turns at G1) round off wider than the
  // side offset, so the offset loop never folds back on the inside of a bend
  const centre = (s: number): Vec2 => {
    let x = 0;
    let y = 0;
    for (let k = -6; k <= 6; k++) {
      const p = at(lane.points, arc, s + k * 10);
      x += p.x;
      y += p.y;
    }
    return { x: x / 13, y: y / 13 };
  };
  const frame = (s: number) => {
    const p = centre(s);
    const q = centre(Math.min(total, s + 8));
    const o = centre(Math.max(0, s - 8));
    return { p, t: unit(q.x - o.x, q.y - o.y) };
  };
  const pts: Vec2[] = [];
  const step = 20;
  // out: right of the outbound direction (right normal = (t.y, −t.x))
  for (let s = s0; s < s1; s += step) {
    const { p, t } = frame(s);
    pts.push({ x: p.x + t.y * LANE_SIDE, y: p.y - t.x * LANE_SIDE });
  }
  // far U-turn: from the right side around the end point to the left side
  const end = frame(s1);
  for (let k = 0; k <= 8; k++) {
    const a = (k / 8) * Math.PI;
    // right → ahead → left
    const r = { x: end.t.y, y: -end.t.x };
    const dx = r.x * Math.cos(a) + end.t.x * Math.sin(a);
    const dy = r.y * Math.cos(a) + end.t.y * Math.sin(a);
    pts.push({ x: end.p.x + dx * LANE_SIDE, y: end.p.y + dy * LANE_SIDE });
  }
  // back: left of the outbound direction
  for (let s = s1 - step; s > s0; s -= step) {
    const { p, t } = frame(s);
    pts.push({ x: p.x - t.y * LANE_SIDE, y: p.y + t.x * LANE_SIDE });
  }
  // near U-turn: left → behind → right
  const start = frame(s0);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI;
    const l = { x: -start.t.y, y: start.t.x };
    const dx = l.x * Math.cos(a) - start.t.x * Math.sin(a);
    const dy = l.y * Math.cos(a) - start.t.y * Math.sin(a);
    pts.push({ x: start.p.x + dx * LANE_SIDE, y: start.p.y + dy * LANE_SIDE });
  }
  return closeLoop(clearAndSmooth(pts, stationsNear));
}

/** The lane patrol routes of a world (a frigate group leads on lane A). */
export function lanePatrols(seed: number, lanes: readonly { id: LaneId; points: readonly Vec2[] }[], stationsNear: StationsNear): PatrolRoute[] {
  const out: PatrolRoute[] = [];
  lanes.forEach((lane, li) => {
    const loop = laneLoop(lane, stationsNear);
    if (!loop) return;
    const groups = Math.max(1, Math.round(loop.length / GROUP_SPACING));
    for (let g = 0; g < groups; g++) {
      const frigate = (li === 0 && g === 0) || rand(seed, li, g, 1) < 0.15;
      const pair = !frigate && rand(seed, li, g, 2) < 0.5;
      const members: PatrolMember[] = frigate
        ? [
            { kind: 'frigate', behind: 0, side: 0 },
            { kind: 'cutter', behind: 16, side: 11 },
            { kind: 'cutter', behind: 16, side: -11 },
          ]
        : pair
          ? [
              { kind: 'cutter', behind: 0, side: 0 },
              { kind: 'cutter', behind: 11, side: 7 },
            ]
          : [{ kind: 'cutter', behind: 0, side: 0 }];
      out.push({
        id: `lane:${lane.id}:${g}`,
        ...loop,
        speed: frigate ? FRIGATE_SPEED : CUTTER_SPEED,
        start: ((g + rand(seed, li, g, 3) * 0.4) / groups) * loop.length,
        members,
        rank: g === 0 ? 0 : rand(seed, li, g, 4),
        lane: true,
      });
    }
  });
  return out;
}

/** Static Guarded security (the default of `sectorPatrol` – what the scenery used before M4d). */
export const staticGuarded =
  (seed: number): GuardedAt =>
  (x, y) =>
    sectorInfoAt(seed, x, y).security === 'guarded';

/**
 * Guarded NOW: the one current-security read (`securityOverrides` – static Guarded or secured by a Guild
 * relay; a destroyed fortress only ever makes a sector Contested).
 */
export function guardedNow(state: SimState): GuardedAt {
  const seed = state.seed;
  const overrides = securityOverrides(state);
  if (overrides.secured.size === 0) return staticGuarded(seed);
  return (x, y) => sectorSecurity(seed, sectorIdAt(seed, x, y), overrides) === 'guarded';
}

/** The jittered centre of sector cell (i, j), or null when the cell rolls no patrol. */
function sectorCentre(seed: number, i: number, j: number): Vec2 | null {
  if (rand(seed, i, j, 10) >= SECTOR_CHANCE) return null;
  return { x: (i + 0.25 + rand(seed, i, j, 11) * 0.5) * PATROL_CELL, y: (j + 0.25 + rand(seed, i, j, 12) * 0.5) * PATROL_CELL };
}

function buildSectorPatrol(seed: number, i: number, j: number, c: Vec2, stationsNear: StationsNear): PatrolRoute {
  const radius = 160 + rand(seed, i, j, 13) * 100;
  const dir = rand(seed, i, j, 14) < 0.5 ? 1 : -1;
  const a0 = rand(seed, i, j, 15) * Math.PI * 2;
  const pts: Vec2[] = [];
  const n = 48;
  for (let k = 0; k < n; k++) {
    const a = a0 + dir * (k / n) * Math.PI * 2;
    pts.push({ x: c.x + Math.cos(a) * radius, y: c.y + Math.sin(a) * radius });
  }
  const loop = closeLoop(clearAndSmooth(pts, stationsNear));
  return {
    id: `sector:${i},${j}`,
    ...loop,
    speed: SECTOR_SPEED,
    start: rand(seed, i, j, 16) * loop.length,
    members: [
      { kind: 'cutter', behind: 0, side: 0 },
      { kind: 'cutter', behind: 12, side: -8 },
    ],
    rank: rand(seed, i, j, 17),
    lane: false,
  };
}

/**
 * The sector patrol of cell (i, j), or null (no patrol rolled, or the cell's centre is not Guarded).
 * `guarded` defaults to the static security (the render passes the current one – a secured sector gets
 * the same cells a static Guarded one would).
 */
export function sectorPatrol(seed: number, i: number, j: number, stationsNear: StationsNear, guarded: GuardedAt = staticGuarded(seed)): PatrolRoute | null {
  const c = sectorCentre(seed, i, j);
  if (!c || !guarded(c.x, c.y)) return null;
  return buildSectorPatrol(seed, i, j, c, stationsNear);
}

/** Scratch of `placeMember`: the member's point on the route and the route's unit tangent there. */
const MEMBER = { px: 0, py: 0, tx: 0, ty: 0 };
const PT_P: Vec2 = { x: 0, y: 0 };
const PT_A: Vec2 = { x: 0, y: 0 };
const PT_B: Vec2 = { x: 0, y: 0 };

/** Member `slot`'s route point and the tangent there at time `t` (s), into `MEMBER` (no objects). */
function placeMember(route: PatrolRoute, slot: number, t: number): void {
  const m = route.members[slot]!;
  const L = route.length;
  const lead = (((route.start + route.speed * t) % L) + L) % L;
  const s = (((lead - m.behind) % L) + L) % L;
  const p = atInto(route.points, route.arc, s, PT_P);
  const a = atInto(route.points, route.arc, (s + L - 5) % L, PT_A);
  const b = atInto(route.points, route.arc, (s + 5) % L, PT_B);
  // unit(b − a)
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = hypot(dx, dy);
  MEMBER.px = p.x;
  MEMBER.py = p.y;
  MEMBER.tx = l > 1e-9 ? dx / l : 1;
  MEMBER.ty = l > 1e-9 ? dy / l : 0;
}

/** The pose of member `slot` of a route at time `t` (s). */
export function routePose(route: PatrolRoute, slot: number, t: number): RoutePose {
  const m = route.members[slot]!;
  placeMember(route, slot, t);
  const { px, py, tx, ty } = MEMBER;
  const phase = (route.start * 0.0137 + slot * 0.31) % 1;
  return {
    route: route.id,
    slot,
    kind: m.kind,
    pos: { x: px + ty * m.side, y: py - tx * m.side },
    heading: Math.atan2(ty, tx),
    gunYaw: m.kind === 'frigate' ? t * 0.25 + phase * 6.283 : 0.6 * Math.sin(t * 0.45 + phase * 6.283),
    phase,
  };
}

/** `routePose(route, slot, t).pos` written into `out` (the per-step distance checks). Returns `out`. */
export function routePosInto(route: PatrolRoute, slot: number, t: number, out: Vec2): Vec2 {
  const m = route.members[slot]!;
  placeMember(route, slot, t);
  out.x = MEMBER.px + MEMBER.ty * m.side;
  out.y = MEMBER.py - MEMBER.tx * m.side;
  return out;
}

/** The ships of a route at time `t` (s). */
export function routeShips(route: PatrolRoute, t: number, out: RoutePose[] = []): RoutePose[] {
  for (let slot = 0; slot < route.members.length; slot++) out.push(routePose(route, slot, t));
  return out;
}

/** Box of a route (for "is it near the camera"). */
export function routeBox(route: PatrolRoute): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of route.points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

// ---------------------------------------------------------------------------------------------------
// The simulation's schedule (cached per seed – pure functions of the seed)

/** Stations near a point exactly as the render ObstacleMap lists them: the 3 × 3 chunks around its chunk. */
export function routeStationsNear(seed: number): StationsNear {
  const memo = new Map<string, RouteStation[]>();
  return (p) => {
    const cx = chunkCoord(p.x);
    const cy = chunkCoord(p.y);
    const key = `${cx},${cy}`;
    let hit = memo.get(key);
    if (!hit) {
      hit = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const s = stationAt(seed, cx + dx, cy + dy);
          if (s) hit.push({ pos: s.pos, radius: s.radius, clearRadius: s.clearRadius });
        }
      }
      if (memo.size >= 512) memo.clear();
      memo.set(key, hit);
    }
    return hit;
  };
}

/** A sector patrol cell: its rolled centre (null = no patrol), whether that is statically Guarded, its route (built lazily). */
interface SectorCell {
  centre: Vec2 | null;
  guarded: boolean;
  route?: PatrolRoute;
}

interface SeedSchedule {
  near: StationsNear;
  lanes: PatrolRoute[];
  laneById: Map<string, PatrolRoute>;
  boxes: { x0: number; y0: number; x1: number; y1: number }[];
  /** Sector patrol cells by key `i,j` (pure – the current security is checked per query). */
  cells: Map<string, SectorCell>;
  relays: Map<LaneId, PatrolRoute>;
}

const schedules = new Map<number, SeedSchedule>();

function schedule(seed: number): SeedSchedule {
  let s = schedules.get(seed);
  if (!s) {
    const near = routeStationsNear(seed);
    const lanes = lanePatrols(seed, sectorLanes(seed), near);
    s = { near, lanes, laneById: new Map(lanes.map((r) => [r.id, r])), boxes: lanes.map(routeBox), cells: new Map(), relays: new Map() };
    if (schedules.size >= 4) schedules.clear();
    schedules.set(seed, s);
  }
  return s;
}

/** Sector cell (i, j) from the cache. */
function sectorCell(seed: number, i: number, j: number): SectorCell {
  const s = schedule(seed);
  const key = `${i},${j}`;
  let c = s.cells.get(key);
  if (!c) {
    const centre = sectorCentre(seed, i, j);
    c = { centre, guarded: centre !== null && staticGuarded(seed)(centre.x, centre.y) };
    if (s.cells.size >= 1024) s.cells.clear();
    s.cells.set(key, c);
  }
  return c;
}

/** The cell's route if a patrol flies it NOW (static Guarded, or secured – asked per call: saves differ). */
function sectorRouteNow(state: SimState, i: number, j: number, guarded: () => GuardedAt): PatrolRoute | null {
  const c = sectorCell(state.seed, i, j);
  if (!c.centre) return null;
  if (!c.guarded && (state.guild.relays.size === 0 || !guarded()(c.centre.x, c.centre.y))) return null;
  c.route ??= buildSectorPatrol(state.seed, i, j, c.centre, schedule(state.seed).near);
  return c.route;
}

/** The relay reinforcement's loop: a circle of `RELAY_ORBIT` around the lane's Guild relay mast. */
export function relayPatrol(site: GuildRelaySite): PatrolRoute {
  const pts: Vec2[] = [];
  const n = 36;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    pts.push({ x: site.pos.x + Math.cos(a) * RELAY_ORBIT, y: site.pos.y + Math.sin(a) * RELAY_ORBIT });
  }
  const loop = closeLoop(pts);
  const kinds = RELAY_CHAIN.reinforcement;
  return {
    id: `relay:${site.lane}`,
    ...loop,
    speed: RELAY_SPEED,
    start: 0,
    members: kinds.map((kind, i) => ({ kind, behind: i * 14, side: i === 0 ? 0 : i % 2 === 1 ? 10 : -10 })),
    rank: 0,
    lane: false,
  };
}

/** The route of a live ship (`lane:A:0`, `sector:12,-3`, `relay:A`), or null when it does not exist now. */
export function routeById(state: SimState, id: string): PatrolRoute | null {
  const s = schedule(state.seed);
  if (id.startsWith('lane:')) return s.laneById.get(id) ?? null;
  if (id.startsWith('sector:')) {
    const comma = id.indexOf(',');
    const i = Number(id.slice(7, comma));
    const j = Number(id.slice(comma + 1));
    if (comma < 0 || !Number.isInteger(i) || !Number.isInteger(j)) return null;
    return sectorRouteNow(state, i, j, () => guardedNow(state));
  }
  if (id.startsWith('relay:')) {
    const lane = id.slice(6) as LaneId;
    let r = s.relays.get(lane);
    if (!r) {
      const site = guildRelaySites(state.seed).find((x) => x.lane === lane);
      if (!site) return null;
      r = relayPatrol(site);
      s.relays.set(lane, r);
    }
    return r;
  }
  return null;
}

/** Schedule time of a tick (s) – the render draws tick n's poses at simTime n · SIM_DT. */
export const scheduleTime = (tick: number): number => tick * SIM_STEP;

/** A scheduled (not live) Watch ship at a tick. */
export interface ScheduledWatch {
  /** `gw:<routeId>|<slot>` – the id it gets when it materialises. */
  id: string;
  route: string;
  slot: number;
  kind: WatchKind;
  pos: Vec2;
  vel: Vec2;
  heading: number;
}

/** The live id of a route member. */
export const watchId = (route: string, slot: number): string => `gw:${route}|${slot}`;

/** Route id and slot of a live id, or null. */
export function parseWatchId(id: string): { route: string; slot: number } | null {
  if (!id.startsWith('gw:')) return null;
  const bar = id.lastIndexOf('|');
  if (bar < 0) return null;
  const slot = Number(id.slice(bar + 1));
  return Number.isInteger(slot) && slot >= 0 ? { route: id.slice(3, bar), slot } : null;
}

/** The scheduled pose and velocity of a route member at a tick. */
export function scheduledAt(route: PatrolRoute, slot: number, tick: number): ScheduledWatch {
  const t = scheduleTime(tick);
  const p = routePose(route, slot, t);
  const q = routePosInto(route, slot, t + SIM_STEP, NEXT_POS);
  return {
    id: watchId(route.id, slot),
    route: route.id,
    slot,
    kind: p.kind,
    pos: p.pos,
    vel: { x: (q.x - p.pos.x) / SIM_STEP, y: (q.y - p.pos.y) / SIM_STEP },
    heading: p.heading,
  };
}

/** Scratch of `scheduledAt` / `scheduledWatchNear`. */
const NEXT_POS: Vec2 = { x: 0, y: 0 };
const NEAR_POS: Vec2 = { x: 0, y: 0 };

/** Scheduled Watch ships within `radius` of `pos` at the state's tick, nearest first (ties by id). */
export function scheduledWatchNear(state: SimState, pos: Vec2, radius: number): ScheduledWatch[] {
  const s = schedule(state.seed);
  const out: { d: number; w: ScheduledWatch }[] = [];
  const t = scheduleTime(state.tick);
  const consider = (r: PatrolRoute) => {
    for (let slot = 0; slot < r.members.length; slot++) {
      const p = routePosInto(r, slot, t, NEAR_POS);
      const d = hypot(p.x - pos.x, p.y - pos.y);
      if (d <= radius) out.push({ d, w: scheduledAt(r, slot, state.tick) });
    }
  };
  s.lanes.forEach((r, k) => {
    const b = s.boxes[k]!;
    if (pos.x > b.x0 - radius && pos.x < b.x1 + radius && pos.y > b.y0 - radius && pos.y < b.y1 + radius) consider(r);
  });
  // a sector loop reaches at most 260 u (+ the station push) from its centre, the centre lies in its cell
  const reach = radius + 400;
  const i0 = Math.floor((pos.x - reach) / PATROL_CELL);
  const i1 = Math.floor((pos.x + reach) / PATROL_CELL);
  const j0 = Math.floor((pos.y - reach) / PATROL_CELL);
  const j1 = Math.floor((pos.y + reach) / PATROL_CELL);
  let guarded: GuardedAt | null = null;
  const lazy = () => (guarded ??= guardedNow(state));
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const r = sectorRouteNow(state, i, j, lazy);
      if (r) consider(r);
    }
  }
  out.sort((a, b) => a.d - b.d || (a.w.id < b.w.id ? -1 : a.w.id > b.w.id ? 1 : 0));
  return out.map((x) => x.w);
}
