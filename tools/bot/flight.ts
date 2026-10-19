// Flight helpers of the balance bot: a velocity controller with a PD heading loop, obstacle avoidance
// (detour waypoints checked on both sides of the first blocking rock, a speed cap from the corridor
// ahead, push-away from rocks in contact) and laser aiming at vein segments. Everything only reads the
// simulation state; the output is a FlightInput / aim point for PlayerCommand.
import { cargoMass } from '../../src/data/resources';
import { clamp, normalizeAngle } from '../../src/sim/math/angle';
import { rotate, type Vec2 } from '../../src/sim/math/vec2';
import { aimDirection } from '../../src/sim/mining/laser';
import { activeSegment, findVeinHit, veinPointAt, veinsOf } from '../../src/sim/mining/veins';
import { MAX_ANG_VEL } from '../../src/sim/physics/body';
import type { FlightInput } from '../../src/sim/ship/control';
import type { ShipProperties, ThrustGroup } from '../../src/sim/ship/properties';
import { SIM_DT, type SimState } from '../../src/sim/Simulation';
import type { Asteroid } from '../../src/sim/world/generate';
import type { StationDef } from '../../src/sim/world/stations';
import { checkDock, dockHeading, dockPoint, type DockTarget } from '../../src/sim/station/dock';
import { playerDockRules } from '../../src/sim/station/dockRules';
import { GRAVEYARD, MINE } from '../../src/data/sites';
import { siteColliders } from '../../src/sim/sites';
import { liveMines } from '../../src/sim/sites/mines';

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (v: Vec2): Vec2 => {
  const l = Math.hypot(v.x, v.y);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: 1, y: 0 };
};

export interface NavGoal {
  target: Vec2;
  /** Speed when reaching the target (0 = stop there). */
  arriveSpeed: number;
  maxSpeed: number;
  /** Heading to hold (rad); undefined = face the direction of travel when far away. */
  face?: number;
  /** Hover / docking: dampers on, tiny inputs zeroed so the dampers settle the ship. */
  precise: boolean;
  /** Skip obstacle avoidance (final metres to a hover point). */
  noAvoid?: boolean;
}

export interface SteerOut {
  flight: FlightInput;
  dampers: boolean;
  /** Point actually steered at (detour waypoint or the target). */
  via: Vec2;
}

interface Obstacle {
  pos: Vec2;
  radius: number;
  id?: string;
}

/** Ship mass with cargo, as the simulation uses it. */
export const shipMass = (state: SimState): number => state.player.props.mass + cargoMass(state.player.cargo);

/** Extra clearance of planned paths beyond the ship radius. */
const PATH_MARGIN = 0.8;

/** Live mines are kept this far beyond their arming distance (u of hull gap). */
const MINE_MARGIN = 3;

function obstaclesNear(state: SimState, pos: Vec2, reach: number, ignoreId?: string): Obstacle[] {
  const out: Obstacle[] = [];
  for (const c of state.world.circlesNear(pos, reach)) if (c.asteroid.id !== ignoreId) out.push({ pos: c.circle.pos, radius: c.circle.radius, id: c.asteroid.id });
  for (const c of state.world.stationCirclesNear(pos, reach)) out.push({ pos: c.pos, radius: c.radius });
  // M4b: derelict stations, relay masts and moving comet nuclei are solid; a live mine is a no-go circle
  for (const c of siteColliders(state, pos, reach)) out.push({ pos: c.pos, radius: c.radius });
  for (const m of liveMines(state, pos, reach + GRAVEYARD.radius)) {
    if (dist(m.pos, pos) <= reach + MINE.armRange + MINE_MARGIN) out.push({ pos: m.pos, radius: MINE.armRange + MINE_MARGIN, id: m.id });
  }
  return out;
}

/** Nearest rock or station surface (minus the ship radius) within `reach`. */
export function clearance(state: SimState, pos: Vec2, reach: number): number {
  const r = state.player.props.boundingRadius;
  let best = Infinity;
  for (const o of obstaclesNear(state, pos, reach)) best = Math.min(best, dist(pos, o.pos) - o.radius - r);
  return best;
}

/** First obstacle hit by the segment a→b, inflated by `margin` (t = distance from a), or null. */
function firstHit(obstacles: readonly Obstacle[], a: Vec2, b: Vec2, margin: number): { t: number; o: Obstacle; R: number } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-6) return null;
  const u = { x: dx / L, y: dy / L };
  let first: { t: number; o: Obstacle; R: number } | null = null;
  for (const o of obstacles) {
    const R = o.radius + margin;
    const mx = a.x - o.pos.x;
    const my = a.y - o.pos.y;
    const bb = mx * u.x + my * u.y;
    const k = mx * mx + my * my - R * R;
    let t: number;
    if (k <= 0) {
      if (bb >= 0) continue; // inside the inflated circle but leaving it
      t = 0;
    } else {
      if (bb > 0) continue;
      const disc = bb * bb - k;
      if (disc < 0) continue;
      t = -bb - Math.sqrt(disc);
    }
    if (t > L) continue;
    if (!first || t < first.t) first = { t, o, R };
  }
  return first;
}

/**
 * Detour waypoint for the straight path `from` → `to` (look-ahead ≤ 180 u): the first blocking
 * obstacle is passed on the side whose path is clear (checked a few levels deep); otherwise `to`.
 */
export function avoid(state: SimState, from: Vec2, to: Vec2, ignoreId?: string): Vec2 {
  const L = dist(from, to);
  if (L < 1) return to;
  const look = Math.min(L, 180);
  const u = { x: (to.x - from.x) / L, y: (to.y - from.y) / L };
  const end = { x: from.x + u.x * look, y: from.y + u.y * look };
  const mid = { x: (from.x + end.x) / 2, y: (from.y + end.y) / 2 };
  const obstacles = obstaclesNear(state, mid, look / 2 + 45, ignoreId);
  const margin = state.player.props.boundingRadius + PATH_MARGIN;
  const route = (a: Vec2, b: Vec2, depth: number): { via: Vec2; cost: number } => {
    const hit = firstHit(obstacles, a, b, margin);
    if (!hit) return { via: b, cost: dist(a, b) };
    if (depth >= 3) return { via: b, cost: dist(a, b) + 1000 };
    const dir = norm({ x: b.x - a.x, y: b.y - a.y });
    const perp = { x: -dir.y, y: dir.x };
    let best: { via: Vec2; cost: number } | null = null;
    // points beside the obstacle (a bit past its centre along the path), wider when a cluster blocks both sides
    for (const extra of [2.5, 8, 16, 28]) {
      for (const side of [1, -1]) {
        const off = hit.R + extra;
        const p = { x: hit.o.pos.x + perp.x * side * off + dir.x * 1.5, y: hit.o.pos.y + perp.y * side * off + dir.y * 1.5 };
        // the detour point itself must be free
        if (obstacles.some((o) => dist(p, o.pos) < o.radius + margin)) continue;
        const leg = route(a, p, depth + 1);
        const cost = leg.cost + dist(p, b) + (firstHit(obstacles, p, b, margin) ? 30 : 0);
        if (!best || cost < best.cost) best = { via: leg.via, cost };
      }
      if (best && best.cost < 1000) break;
    }
    return best ?? { via: b, cost: dist(a, b) + 2000 };
  };
  const r = route(from, end, 0);
  return r.via === end ? to : r.via;
}

/** Distance to the first obstacle in the corridor along `dir` (ship radius + 2 wide). */
function corridorAhead(state: SimState, pos: Vec2, dir: Vec2, range: number, ignoreId?: string): number {
  const end = { x: pos.x + dir.x * range, y: pos.y + dir.y * range };
  const mid = { x: (pos.x + end.x) / 2, y: (pos.y + end.y) / 2 };
  const hit = firstHit(obstaclesNear(state, mid, range / 2 + 10, ignoreId), pos, end, state.player.props.boundingRadius + 1);
  return hit ? hit.t : Infinity;
}

/** Detour memory: keeps the chosen detour while its path stays clear (no left/right flip-flop). */
export interface NavMemory {
  via: Vec2 | null;
  target: Vec2 | null;
  tick: number;
}

export const newNavMemory = (): NavMemory => ({ via: null, target: null, tick: -1 });

/** Is the straight path a→b free (ship radius + margin)? */
export function pathClear(state: SimState, a: Vec2, b: Vec2, ignoreId?: string, margin = PATH_MARGIN): boolean {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return !firstHit(obstaclesNear(state, mid, dist(a, b) / 2 + 10, ignoreId), a, b, state.player.props.boundingRadius + margin);
}

function viaPoint(state: SimState, nav: NavGoal, ignoreId: string | undefined, mem: NavMemory | undefined): Vec2 {
  const pos = state.player.body.pos;
  if (nav.noAvoid || dist(nav.target, pos) < 10) return nav.target;
  if (mem && mem.via && mem.target && dist(mem.target, nav.target) < 3 && state.tick - mem.tick < 90 && dist(pos, mem.via) > 4 && pathClear(state, pos, mem.via, ignoreId)) {
    return mem.via;
  }
  const via = avoid(state, pos, nav.target, ignoreId);
  if (mem) {
    mem.via = via === nav.target ? null : via;
    mem.target = { ...nav.target };
    mem.tick = state.tick;
  }
  return via;
}

/**
 * The thrust per direction as the dampers have it: the engines, or the cockpit's weak manoeuvring
 * thrusters (RCS) where a direction has none (sim/ship/control.ts).
 */
function damperThrust(props: ShipProperties): Record<ThrustGroup, number> {
  const t = props.thrust;
  const or = (x: number): number => (x > 0 ? x : props.rcsThrust);
  return { forward: or(t.forward), backward: or(t.backward), left: or(t.left), right: or(t.right) };
}

/**
 * Deceleration the ship can produce against its current velocity with the present heading: each axis
 * brakes with its own thrusters (the lateral ones are weak), so a ship sliding sideways stops slowly.
 */
function brakeAlongVelocity(state: SimState, m: number): number {
  const { body, props } = state.player;
  const t = damperThrust(props);
  const speed = Math.hypot(body.vel.x, body.vel.y);
  const min = Math.max(1e-3, Math.min(t.forward, t.backward, t.left, t.right) / m);
  if (speed < 1e-3) return min;
  const u = rotate({ x: body.vel.x / speed, y: body.vel.y / speed }, -body.angle);
  const ax = (u.x > 0 ? t.backward : t.forward) / m;
  const ay = (u.y > 0 ? t.right : t.left) / m;
  const lim = Math.min(Math.abs(u.x) > 1e-6 ? ax / Math.abs(u.x) : Infinity, Math.abs(u.y) > 1e-6 ? ay / Math.abs(u.y) : Infinity);
  return Math.max(min, Number.isFinite(lim) ? lim : min);
}

/** Velocity controller + PD heading. */
export function steer(state: SimState, nav: NavGoal, ignoreId?: string, mem?: NavMemory): SteerOut {
  const { player } = state;
  const { body, props } = player;
  const m = shipMass(state);
  const t = props.thrust;
  const via = viaPoint(state, nav, ignoreId, mem);
  const to = { x: via.x - body.pos.x, y: via.y - body.pos.y };
  const d = Math.hypot(to.x, to.y);

  const brake = Math.max(1e-3, Math.min(t.forward, t.backward > 0 ? t.backward : t.forward * 0.5) / m);
  const speed = Math.hypot(body.vel.x, body.vel.y);
  let vmax = nav.maxSpeed;
  // speed cap: be able to stop before the first rock in the corridor ahead (of motion and of intent)
  if (!nav.noAvoid) {
    const range = Math.max(40, (speed * speed) / (2 * brake * 0.5) + 25);
    // (the intent corridor ends before a detour point – the rock it passes lies right beside it)
    const reach = via === nav.target ? Math.min(range, d + 3) : Math.min(range, d - 3);
    let ahead = d > 1e-6 && reach > 1 ? corridorAhead(state, body.pos, { x: to.x / d, y: to.y / d }, reach, ignoreId) : Infinity;
    if (speed > 3) ahead = Math.min(ahead, corridorAhead(state, body.pos, { x: body.vel.x / speed, y: body.vel.y / speed }, range, ignoreId));
    if (Number.isFinite(ahead)) vmax = Math.min(vmax, 5 + Math.sqrt(2 * brakeAlongVelocity(state, m) * 0.6 * Math.max(0, ahead - 2)));
  }
  const arrive = via === nav.target ? nav.arriveSpeed : Math.min(vmax, 15);
  let vd = Math.min(vmax, Math.sqrt(arrive * arrive + 2 * brake * 0.6 * Math.max(0, d - 0.3)));
  vd = Math.min(vd, arrive + 1.5 * d);
  const vDes = d > 1e-6 ? { x: (to.x / d) * vd, y: (to.y / d) * vd } : { x: 0, y: 0 };
  // push away from rocks the ship (almost) touches
  const br = props.boundingRadius;
  for (const o of obstaclesNear(state, body.pos, br + 4, nav.noAvoid ? undefined : ignoreId)) {
    const gap = dist(body.pos, o.pos) - o.radius - br;
    if (gap < 0.8) {
      const away = norm({ x: body.pos.x - o.pos.x, y: body.pos.y - o.pos.y });
      const k = (0.8 - gap) * 3;
      vDes.x += away.x * k;
      vDes.y += away.y * k;
    }
  }

  const err = { x: vDes.x - body.vel.x, y: vDes.y - body.vel.y };
  const local = rotate(err, -body.angle);
  const tau = 0.2;
  const axis = (e: number, pos: number, neg: number): number => {
    const thrust = e > 0 ? pos : neg;
    if (thrust <= 0) return 0;
    return clamp(((e / tau) * m) / thrust, -1, 1);
  };
  // with a main engine the keys work the cockpit RCS where there are no reverse / side engines
  const keyed = t.forward > 0 ? damperThrust(props) : t;
  let forward = axis(local.x, t.forward, keyed.backward);
  let strafe = axis(local.y, keyed.left, keyed.right);
  // cruising: coast when the velocity is close enough (saves fuel; dampers are off)
  if (!nav.precise && Math.hypot(err.x, err.y) < 1) {
    forward = 0;
    strafe = 0;
  }
  if (nav.precise) {
    if (Math.abs(forward) < 0.02) forward = 0;
    if (Math.abs(strafe) < 0.02) strafe = 0;
  }

  // heading
  let face = nav.face;
  if (face === undefined && Math.hypot(vDes.x, vDes.y) > 3 && d > 15) face = Math.atan2(vDes.y, vDes.x);
  // flip and burn: a ship without (enough) backward or side thrust turns its main engines to the burn
  const weakBack = t.backward < 0.25 * t.forward;
  const weakSide = (local.y > 0 ? t.left : t.right) < 0.25 * t.forward;
  if (Math.hypot(err.x, err.y) > 2 && ((local.x < -0.5 && weakBack) || (Math.abs(local.y) > 1.5 && weakSide))) {
    face = Math.atan2(err.y, err.x);
  }
  let turn = 0;
  if (face !== undefined) {
    const inertia = (props.inertia * m) / props.mass;
    const alpha = Math.max(1e-3, props.torque / inertia);
    const delta = normalizeAngle(face - body.angle);
    if (Math.abs(delta) > 0.004 || Math.abs(body.angVel) > 0.02) {
      const wDes = Math.sign(delta) * Math.min(MAX_ANG_VEL, Math.sqrt(2 * alpha * 0.7 * Math.abs(delta)));
      turn = clamp((wDes - body.angVel) / (alpha * 0.06), -1, 1);
      if (Math.abs(turn) < 0.01) turn = 0;
    }
  }
  return { flight: { forward, strafe, turn }, dampers: nav.precise, via };
}

/** Distance of the approach staging point out on the dock axis from the docking point. */
const DOCK_STAGING = 9;

/**
 * The docking manoeuvre (2026-10-17): first a staging point out on the dock axis, then straight in to
 * the docking point by the clamp – slowly, with the bow along the axis at the station. `ready` = the
 * simulation's own check passes for this station (press F); `final` = on the last, slow leg.
 */
export function dockNav(state: SimState, st: StationDef, maxSpeed: number): { nav: NavGoal; ready: boolean; final: boolean } {
  const { body, props } = state.player;
  const loaded = state.world.stations();
  const check = loaded.some((x) => x.id === st.id) ? checkDock(body, props.boundingRadius, loaded, playerDockRules(state)) : null;
  return approachNav(state, st, maxSpeed, check !== null && check.status === 'ok' && check.station?.id === st.id);
}

/**
 * The docking manoeuvre towards any dock target (a station, or an M4b derelict's clamp – the same rules);
 * `ready` comes from the caller's own check of the simulation's rules.
 */
export function approachNav(state: SimState, st: DockTarget, maxSpeed: number, ready: boolean): { nav: NavGoal; ready: boolean; final: boolean } {
  const { body, props } = state.player;
  const rules = playerDockRules(state);
  const point = dockPoint(st, props.boundingRadius);
  const out = { x: Math.cos(st.portAngle), y: Math.sin(st.portAngle) };
  const rel = { x: body.pos.x - point.x, y: body.pos.y - point.y };
  const along = rel.x * out.x + rel.y * out.y;
  const lateral = Math.abs(rel.x * out.y - rel.y * out.x);
  const d = Math.hypot(rel.x, rel.y);
  // the approach corridor: outside the station, near the axis – straight in, slow, bow at the station
  const final = d < DOCK_STAGING + 4 && along > -1.5 && lateral < 2.5 + Math.max(0, along) * 0.5;
  if (final) {
    return {
      nav: { target: point, arriveSpeed: 0, maxSpeed: Math.min(2.4, rules.maxSpeed * 0.8), face: dockHeading(st), precise: true, noAvoid: true },
      ready,
      final,
    };
  }
  const staging = { x: point.x + out.x * DOCK_STAGING, y: point.y + out.y * DOCK_STAGING };
  const ds = dist(body.pos, staging);
  // near the staging point: slow down and turn the bow to the station already
  const nav: NavGoal = { target: staging, arriveSpeed: 0, maxSpeed, precise: ds < 40, ...(ds < 12 ? { face: dockHeading(st) } : {}) };
  return { nav, ready, final };
}

/** Bang-bang turn towards `heading` (rad) that brakes the spin in time. */
function turnTowards(state: SimState, heading: number): number {
  const { body, props } = state.player;
  const e = normalizeAngle(heading - body.angle);
  const alpha = props.torque / ((props.inertia * shipMass(state)) / props.mass);
  const want = Math.sign(e) * Math.min(1, Math.sqrt(2 * alpha * 0.45 * Math.abs(e)));
  return body.angVel < want - 0.08 ? 1 : body.angVel > want + 0.08 ? -1 : 0;
}

/**
 * Docking for a ship without reverse engines (the Guild loan hull after a Hard respawn – its cockpit
 * RCS alone brakes far too slowly) the way a pilot does it: fly to
 * the docking point by the clamp (from outside, via the staging point on the dock axis) and stop there
 * with flip-and-burn, then turn the bow to the station while drifting – F once the simulation's rules
 * are met (the latch does the rest).
 */
export function creepDock(state: SimState, st: StationDef): { flight: FlightInput; ready: boolean } {
  const { body, props } = state.player;
  const point = dockPoint(st, props.boundingRadius);
  const out = { x: Math.cos(st.portAngle), y: Math.sin(st.portAngle) };
  const heading = dockHeading(st);
  const d = dist(body.pos, point);
  const along = (body.pos.x - point.x) * out.x + (body.pos.y - point.y) * out.y;
  const speed = Math.hypot(body.vel.x, body.vel.y);
  const loaded = state.world.stations();
  const check = loaded.some((x) => x.id === st.id) ? checkDock(body, props.boundingRadius, loaded, playerDockRules(state)) : null;
  const ready = check !== null && check.status === 'ok' && check.station?.id === st.id;
  // stopped by the clamp: turn the bow to the station while drifting
  if (d < 3 && speed < 0.6) return { flight: { forward: 0, strafe: 0, turn: turnTowards(state, heading) }, ready };
  // fly to the clamp (from the far side via the staging point) and stop there: match a velocity that
  // falls off near the target, flip the tail forward and burn to brake
  const target = along > 3 || d < 6 ? point : { x: point.x + out.x * DOCK_STAGING, y: point.y + out.y * DOCK_STAGING };
  const to = { x: target.x - body.pos.x, y: target.y - body.pos.y };
  const dn = Math.max(Math.hypot(to.x, to.y), 1e-6);
  const vmax = Math.min(12, 0.25 * dn + 0.15);
  const vTo = (body.vel.x * to.x + body.vel.y * to.y) / dn;
  let want: number;
  let burn: boolean;
  if (speed > vmax + 0.8 || vTo < -0.4) {
    want = Math.atan2(-body.vel.y, -body.vel.x);
    burn = Math.abs(normalizeAngle(want - body.angle)) < 0.3;
  } else {
    const ex = (to.x / dn) * vmax - body.vel.x;
    const ey = (to.y / dn) * vmax - body.vel.y;
    const err = Math.hypot(ex, ey);
    want = err < 0.25 ? body.angle : Math.atan2(ey, ex);
    burn = err > 0.35 && Math.abs(normalizeAngle(want - body.angle)) < 0.25;
  }
  return { flight: { forward: burn ? 1 : 0, strafe: 0, turn: turnTowards(state, want) }, ready };
}

/** Direction to back out of a pocket of rocks: long free ray, preferably towards the goal. */
export function freeDirection(state: SimState, goal: Vec2): Vec2 {
  const pos = state.player.body.pos;
  const obstacles = obstaclesNear(state, pos, 50);
  const g = norm({ x: goal.x - pos.x, y: goal.y - pos.y });
  const margin = state.player.props.boundingRadius + 0.3;
  let best = g;
  let bestScore = -Infinity;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const d = { x: Math.cos(a), y: Math.sin(a) };
    const hit = firstHit(obstacles, pos, { x: pos.x + d.x * 40, y: pos.y + d.y * 40 }, margin);
    const free = hit ? hit.t : 40;
    const score = free + 8 * (d.x * g.x + d.y * g.y);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** World position of the laser pivot. */
export function laserOrigin(state: SimState, index: number): Vec2 {
  const { body, props } = state.player;
  const l = props.lasers[index]!;
  const o = rotate(l.offset, body.angle);
  return { x: body.pos.x + o.x, y: body.pos.y + o.y };
}

/** How many lasers can put their beam end on `p` (range and firing arc). */
function lasersReaching(state: SimState, p: Vec2): number {
  const { body, props } = state.player;
  let n = 0;
  for (let i = 0; i < props.lasers.length; i++) {
    const l = props.lasers[i]!;
    const from = laserOrigin(state, i);
    if (dist(from, p) > l.range - 0.3) continue;
    if (!aimDirection(from, rotate(l.facing, body.angle), p)) continue;
    n++;
  }
  return n;
}

export interface AimChoice {
  aim: Vec2;
  /** The aim point lies on an active vein segment. */
  vein: boolean;
  /** Lasers that can reach the aim point. */
  reach: number;
}

/**
 * Aim point on `a`: the visible centre of an active vein segment (most lasers in reach) when
 * `wantVein`, otherwise a rock point away from any active segment (lets the heat bars cool down).
 */
export function chooseAim(state: SimState, a: Asteroid, wantVein: boolean): AimChoice {
  const world = state.world;
  const radius = world.radiusOf(a);
  const time = state.tick * SIM_DT;
  const vs = world.veinState(a);
  const pos = state.player.body.pos;
  if (wantVein) {
    let best: AimChoice | null = null;
    let bestD = Infinity;
    for (const vein of veinsOf(a)) {
      const seg = activeSegment(vein, radius, vs);
      const pt = veinPointAt(a, vein, radius, time, seg.center);
      if (pt.up < 0.02) continue;
      const reach = lasersReaching(state, pt.pos);
      if (reach === 0) continue;
      const d = dist(pt.pos, pos);
      if (!best || reach > best.reach || (reach === best.reach && d < bestD)) {
        if (!findVeinHit(a, radius, time, vs, pt.pos)) continue;
        best = { aim: pt.pos, vein: true, reach };
        bestD = d;
      }
    }
    if (best) return best;
  }
  // rock point: from the side facing the ship towards the centre, off any active segment
  const toShip = norm({ x: pos.x - a.pos.x, y: pos.y - a.pos.y });
  const side = { x: -toShip.y, y: toShip.x };
  const offsets: [number, number][] = [[0.5, 0], [0.2, 0], [0.5, 0.45], [0.5, -0.45], [0, 0], [0.75, 0.3], [0.75, -0.3]];
  let fallback: AimChoice | null = null;
  for (const [f, s] of offsets) {
    const p = { x: a.pos.x + (toShip.x * f + side.x * s) * radius, y: a.pos.y + (toShip.y * f + side.y * s) * radius };
    const reach = lasersReaching(state, p);
    if (reach === 0) continue;
    const onVein = veinsOf(a).length > 0 && findVeinHit(a, radius, time, vs, p) !== null;
    if (!onVein) return { aim: p, vein: false, reach };
    fallback ??= { aim: p, vein: true, reach };
  }
  return fallback ?? { aim: { ...a.pos }, vein: false, reach: lasersReaching(state, a.pos) };
}
