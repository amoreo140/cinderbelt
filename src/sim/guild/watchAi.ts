// Guild Watch AI (M4d plan §2.3 "Modes and beat") – one step of a live Watch ship.
//
//   patrol  – kinematic on the schedule: the pose IS the scheduled pose (seamless with the scenery).
//   engage  – target choice every 0.5 s, first match wins: (1) defend – a pirate attacking / hailing
//             someone other than the Watch (the player, an escorted convoy ship) within `defendRange` of
//             this ship; (2) retaliate – the pirate that hit this ship in the last 4 s; (3) the nearest
//             pirate within `engageRange` in the beat (a lane corridor ±250 u or a sector Guarded now; a
//             relay reinforcement also guards its mast) – scavengers and dormant sleepers never. Every
//             candidate lies within `leash` of the ship's scheduled point, so the Watch never chases off its
//             route. Orbit the target, fire when in range and arc.
//   return  – fly back to the scheduled pose at `catchUp` × max speed; within `returnRadius` → patrol.
//   retreat – hull below 25 %: away from the nearest pirate, never fights; farther than `retreatLeave`
//             from the player it leaves (removed by watch.ts, the id goes to `guild.lost`).
//
// Flight is kinematic (steer toward a desired velocity, accel / turn limited, max speed), steered around and
// pushed out of big rocks, stations, giants, fortresses, world sites and relay masts like a circle (it flies
// over the small rocks of a field). Shots are normal projectiles (owner = the Watch id, tier 1, T1 cannon
// speed) aimed with the lead and the Standard aim error through the combat RNG. No friendly fire: Watch
// shots never hit the player (npc/sides.ts).
import { clearList, truncateList } from '../scratch';
import { WATCH, RELAY_CHAIN, type WatchGunDef } from '../../data/guild';
import { partDef } from '../../data/parts';
import { AIM_SKILL, aimWithError } from '../combat/aim';
import { TICKS_PER_SECOND } from '../combat/damage';
import type { Enemy, Projectile } from '../combat/types';
import { giantCirclesInto } from '../discovery/giants';
import { normalizeAngle } from '../math/angle';
import { add, hypot, length, rotate, scale, sub, type Vec2 } from '../math/vec2';
import { CELL_RADIUS, resolveCollisions, type Circle } from '../physics/collide';
import { fortressObstaclesInto } from '../pirates/fortress';
import { pirateTarget } from '../npc/targets';
import { inCorridor } from '../regions/lanes';
import { sectorLanes } from '../regions/sectors';
import { siteCollidersInto } from '../sites';
import type { SimEvent, SimState } from '../Simulation';
import { relayMastColliders, guildRelaySites } from './relaySites';
import type { WatchMode, WatchShip } from './types';
import { guardedNow, routeById, routePose, scheduleTime, type PatrolRoute, type RoutePose } from './watchRoutes';

/** The Watch gunners aim like a pirate on Standard (the plan's "normal" aim), whatever the difficulty. */
export const WATCH_AIM = AIM_SKILL.mild;
/** Watch shots fly like a T1 cannon's. */
export const WATCH_SHOT_SPEED = partDef('cannon', 1).weapon!.projectileSpeed;
/** Target choice period (steps). */
const RETARGET_TICKS = Math.round(WATCH.retargetSeconds * TICKS_PER_SECOND);
/** Retaliation window (steps). */
const RETALIATE_TICKS = Math.round(WATCH.retaliateSeconds * TICKS_PER_SECOND);
/** Engage orbit: the share of the max speed flown around the target, and the radial gain (1/s). */
const ORBIT_SPEED = 0.55;
const ORBIT_GAIN = 0.8;
/** A shot leaves this far in front of the muzzle (like a cannon's MUZZLE_OFFSET). */
const MUZZLE_OUT = 0.5;

/** Pirates a Watch ship may fight: not a scavenger, not a dormant sleeper (it is a wreck until it wakes). */
const fightable = (e: Enemy): boolean => e.kind !== 'scavenger' && e.ai.mode !== 'dormant';

const dist = (a: Vec2, b: Vec2): number => hypot(a.x - b.x, a.y - b.y);

/** Switches the mode (and stamps the tick). */
export function setMode(ship: WatchShip, mode: WatchMode, tick: number): void {
  if (ship.mode === mode) return;
  ship.mode = mode;
  ship.modeTick = tick;
}

/** Is the point in the ship's beat: a lane corridor, a sector Guarded now, or (relay reinforcement) near its mast? */
function inBeat(state: SimState, ship: WatchShip, p: Vec2, guarded: (x: number, y: number) => boolean): boolean {
  if (inCorridor(sectorLanes(state.seed), p.x, p.y)) return true;
  if (ship.route.startsWith('relay:')) {
    const site = guildRelaySites(state.seed).find((s) => `relay:${s.lane}` === ship.route);
    if (site && dist(site.pos, p) <= RELAY_CHAIN.holdRadius) return true;
  }
  return guarded(p.x, p.y);
}

/** Does pirate `e` attack / hail someone that is not a live Watch ship (the player, an escorted convoy ship)? */
function attacksProtected(state: SimState, e: Enemy): boolean {
  if (e.ai.mode !== 'attack' && e.ai.mode !== 'hail') return false;
  const t = pirateTarget(state, e);
  if (!t) return false;
  for (const w of state.guild.watch) if (w.body.pos.x === t.pos.x && w.body.pos.y === t.pos.y) return false;
  return true;
}

/** The pirate this ship should fight now (see the header), or null. `anchor` = its scheduled point. */
export function chooseTarget(state: SimState, ship: WatchShip, anchor: Vec2): Enemy | null {
  const pos = ship.body.pos;
  // within the leash with room for the orbit – an engagement never ends at once on the leash
  const reach = WATCH.leash - WATCH.ships[ship.kind].orbit;
  const pirates = state.combat.enemies.filter((e) => fightable(e) && dist(e.body.pos, anchor) <= reach);
  if (pirates.length === 0) return null;
  const nearest = (list: Enemy[]): Enemy | null => {
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of list) {
      const d = dist(e.body.pos, pos);
      if (d < bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
  };
  // (1) defend the player / the escorted convoy
  const defend = nearest(pirates.filter((e) => dist(e.body.pos, pos) <= WATCH.defendRange && attacksProtected(state, e)));
  if (defend) return defend;
  // (2) the pirate that hit this ship lately (onWatchHit stores it as the target)
  if (ship.target !== null && state.tick - ship.lastHitBy <= RETALIATE_TICKS) {
    const hitter = pirates.find((e) => e.id === ship.target);
    if (hitter) return hitter;
  }
  // (3) the nearest pirate in the beat
  const guarded = guardedNow(state);
  return nearest(pirates.filter((e) => dist(e.body.pos, pos) <= WATCH.engageRange && inBeat(state, ship, e.body.pos, guarded)));
}

/**
 * Obstacles a live Watch ship of `radius` is pushed out of: stations, giants, fortresses, world sites, relay
 * masts and rocks at least as big as the ship – it flies over the small rocks of a field (a 7 u hull does
 * not fit between them; the scheduled scenery crossed the fields the same way). NPC ships overlap freely.
 */
function obstaclesNear(state: SimState, pos: Vec2, reach: number, radius: number): Circle[] {
  const { world } = state;
  // one reused list (filled and consumed within `fly`; perf audit 2026-10-17, P4)
  const out = OBSTACLES;
  clearList(out);
  world.circlesInto(pos, reach, out);
  // only the rocks at least as big as the ship (in place, order kept)
  let n = 0;
  for (let i = 0; i < out.length; i++) if (out[i]!.radius >= radius) out[n++] = out[i]!;
  truncateList(out, n);
  world.stationCirclesInto(pos, reach, out);
  giantCirclesInto(state, pos, reach, out);
  fortressObstaclesInto(state, pos, reach, out);
  siteCollidersInto(state, pos, reach, out);
  for (const c of relayMastColliders(state, pos, reach)) out.push(c);
  return out;
}

/** Scratch of `obstaclesNear` / `fly`. */
const OBSTACLES: Circle[] = [];
const NO_OBSTACLES: readonly Circle[] = [];
/** The grown obstacles of `fly`: reused circle objects (resolveCollisions keeps none). */
const GROWN: Circle[] = [];
const GROWN_POOL: Circle[] = [];
const ONE_CELL: readonly Vec2[] = [{ x: 0, y: 0 }];

/** Look-ahead of the obstacle avoidance (s of flight at the desired speed) and the side gap kept (u). */
const AVOID_SECONDS = 1.2;
const AVOID_GAP = 2;
/** A ship still returning after this long flies through obstacles (it never stays stuck behind a rock). */
const RETURN_GHOST_TICKS = 30 * TICKS_PER_SECOND;

/**
 * Steers the desired velocity around the obstacles ahead (circles grown by the ship's radius): the blocking
 * circles' weighted centre decides the side, the ship turns away from it – a cluster of rock circles is
 * passed as one body.
 */
function avoid(pos: Vec2, desired: Vec2, radius: number, obstacles: readonly Circle[]): Vec2 {
  const speed = length(desired);
  if (speed < 1e-3 || obstacles.length === 0) return desired;
  const dir = scale(desired, 1 / speed);
  const look = radius + speed * AVOID_SECONDS + 4;
  let weight = 0;
  let lateral = 0;
  let nearest = Infinity;
  for (const o of obstacles) {
    const rx = o.pos.x - pos.x;
    const ry = o.pos.y - pos.y;
    const ahead = rx * dir.x + ry * dir.y;
    if (ahead <= -o.radius || ahead > look + o.radius) continue;
    const lat = dir.x * ry - dir.y * rx;
    const clear = o.radius + radius + AVOID_GAP;
    if (Math.abs(lat) >= clear) continue;
    const w = o.radius * o.radius;
    weight += w;
    lateral += lat * w;
    nearest = Math.min(nearest, Math.max(0, ahead - o.radius - radius));
  }
  if (weight === 0) return desired;
  // obstacles on the left (lat > 0) → steer right, and the other way round; dead ahead → right
  const side = lateral / weight > 0 ? -1 : 1;
  const urgency = Math.max(0.35, 1 - nearest / look);
  const perp = { x: -dir.y * side, y: dir.x * side };
  const steer = add(scale(dir, 1 - urgency * 0.7), scale(perp, urgency));
  const l = length(steer);
  return scale(steer, speed / l);
}

/**
 * Kinematic flight: the velocity turns toward `desired` (steered around the obstacles ahead) at most
 * `accel · dt` per step and never exceeds `maxSpeed`; the bow turns toward `face` (or the motion) at the
 * turn rate; then the ship is pushed out of the obstacles as a circle of its radius (`solid` false: a ship
 * returning for too long passes through).
 */
function fly(state: SimState, ship: WatchShip, desired: Vec2, maxSpeed: number, face: Vec2 | null, dt: number, solid = true): void {
  const def = WATCH.ships[ship.kind];
  const body = ship.body;
  const obstacles = solid ? obstaclesNear(state, body.pos, def.radius + Math.max(length(desired), length(body.vel)) * AVOID_SECONDS + 12, def.radius) : NO_OBSTACLES;
  let dv = sub(avoid(body.pos, desired, def.radius, obstacles), body.vel);
  const dl = length(dv);
  const maxDv = def.accel * dt;
  if (dl > maxDv) dv = scale(dv, maxDv / dl);
  let vel = add(body.vel, dv);
  const speed = length(vel);
  if (speed > maxSpeed) vel = scale(vel, maxSpeed / speed);
  const look = face ?? (length(vel) > 0.5 ? vel : null);
  let angle = body.angle;
  let angVel = 0;
  if (look) {
    const diff = normalizeAngle(Math.atan2(look.y, look.x) - angle);
    const step = Math.max(-def.turn * dt, Math.min(def.turn * dt, diff));
    angle = normalizeAngle(angle + step);
    angVel = step / dt;
  }
  const moved = { pos: add(body.pos, scale(vel, dt)), vel, angle, angVel };
  if (obstacles.length === 0) {
    ship.body = moved;
    return;
  }
  // a circle of the ship's radius = one cell with the obstacles grown by (radius − cell radius)
  // ({ ...o, radius: o.radius + def.radius − CELL_RADIUS } in reused objects – an absent `safe` / `vel`
  // reads as undefined either way)
  const grown = GROWN;
  clearList(grown);
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i]!;
    const g = (GROWN_POOL[i] ??= { pos: o.pos, radius: 0 });
    g.pos = o.pos;
    g.radius = o.radius + def.radius - CELL_RADIUS;
    g.safe = o.safe;
    g.vel = o.vel;
    grown.push(g);
  }
  ship.body = resolveCollisions(moved, ONE_CELL, 0, grown).body;
  clearList(grown);
}

/** World position of a gun's muzzle; a turret's muzzle turns around its pivot toward `aim`. */
export function muzzleWorld(ship: WatchShip, gun: WatchGunDef, aim: Vec2 | null): Vec2 {
  const { pos, angle } = ship.body;
  if (!gun.pivot || !aim) return add(pos, rotate(gun.muzzle, angle));
  const pivot = add(pos, rotate(gun.pivot, angle));
  const yaw = Math.atan2(aim.y - pivot.y, aim.x - pivot.x);
  return add(pivot, rotate(sub(gun.muzzle, gun.pivot), yaw));
}

/** Fires every ready gun that has the target in range and arc. */
function fireGuns(state: SimState, ship: WatchShip, target: Enemy, events: SimEvent[]): void {
  const def = WATCH.ships[ship.kind];
  const { combat } = state;
  const bow = { x: Math.cos(ship.body.angle), y: Math.sin(ship.body.angle) };
  def.guns.forEach((gun, i) => {
    if ((ship.cooldowns[i] ?? 0) > 0) return;
    const muzzle = muzzleWorld(ship, gun, target.body.pos);
    if (dist(muzzle, target.body.pos) > gun.range + target.props.boundingRadius) return;
    // quick arc pre-check on the target itself (no RNG drawn for a gun that cannot bear)
    const toT = sub(target.body.pos, muzzle);
    const tl = length(toT);
    if (gun.arc < Math.PI && tl > 1e-6 && (toT.x * bow.x + toT.y * bow.y) / tl < Math.cos(gun.arc)) return;
    const aim = aimWithError(muzzle, ship.body.vel, target.body.pos, target.body.vel, WATCH_SHOT_SPEED, WATCH_AIM, combat);
    const d = sub(aim, muzzle);
    const len = length(d);
    if (len < 1e-6) return;
    const dir = scale(d, 1 / len);
    if (gun.arc < Math.PI && dir.x * bow.x + dir.y * bow.y < Math.cos(gun.arc)) return;
    const from = add(muzzle, scale(dir, MUZZLE_OUT));
    const shot: Projectile = {
      id: combat.nextId++,
      owner: ship.id,
      pos: from,
      vel: add(ship.body.vel, scale(dir, WATCH_SHOT_SPEED)),
      ttl: Math.ceil((gun.range / WATCH_SHOT_SPEED) * TICKS_PER_SECOND),
      damage: gun.damage,
      tier: 1,
      origin: from,
    };
    combat.projectiles.push(shot);
    ship.cooldowns[i] = 1 / gun.rate;
    events.push({ type: 'shotFired', owner: ship.id, pos: { ...from }, dir, tier: 1 });
  });
}

/** Snaps the ship onto its schedule (patrol); the velocity is the step's motion. */
function followSchedule(ship: WatchShip, s: RoutePose, speed: number, dt: number): void {
  const angVel = normalizeAngle(s.heading - ship.body.angle) / dt;
  const dx = s.pos.x - ship.body.pos.x;
  const dy = s.pos.y - ship.body.pos.y;
  // the snap at the end of a return is no motion: then the schedule's own velocity
  const vel = dx * dx + dy * dy <= (3 * speed * dt) ** 2 ? { x: dx / dt, y: dy / dt } : { x: Math.cos(s.heading) * speed, y: Math.sin(s.heading) * speed };
  ship.body = { pos: s.pos, vel, angle: s.heading, angVel };
}

/**
 * The route of a live ship object (a pure function of the seed and its id; a route never stops existing
 * while the ship lives – secured sectors stay secured – and a load makes new ship objects).
 */
const routes = new WeakMap<WatchShip, PatrolRoute>();

/**
 * One AI + flight + guns step of a live Watch ship. Returns false when the ship leaves (a retreat far
 * from the player, or its route no longer exists) – the caller removes it.
 */
export function stepWatchAi(state: SimState, ship: WatchShip, events: SimEvent[], dt: number): boolean {
  const def = WATCH.ships[ship.kind];
  let route = routes.get(ship);
  if (route === undefined) {
    route = routeById(state, ship.route) ?? undefined;
    if (route) routes.set(ship, route);
  }
  if (!route || ship.slot >= route.members.length) return false;
  // one scheduled pose per step (hot path)
  const sched = routePose(route, ship.slot, scheduleTime(state.tick));
  ship.prevBody = ship.body;

  // shield and guns
  if (ship.shieldDelay > 0) ship.shieldDelay = Math.max(0, ship.shieldDelay - dt);
  else ship.shield = Math.min(def.shield, ship.shield + def.shieldRegen * dt);
  for (let i = 0; i < ship.cooldowns.length; i++) ship.cooldowns[i] = Math.max(0, ship.cooldowns[i]! - dt);

  if (ship.mode !== 'retreat' && ship.hull < def.hull * WATCH.retreatHull) {
    setMode(ship, 'retreat', state.tick);
    ship.target = null;
    events.push({ type: 'watchRetreated', id: ship.id });
  }

  if (ship.mode === 'retreat') {
    let threat: Enemy | null = null;
    for (const e of state.combat.enemies) if (fightable(e) && (!threat || dist(e.body.pos, ship.body.pos) < dist(threat.body.pos, ship.body.pos))) threat = e;
    const away = threat ? sub(ship.body.pos, threat.body.pos) : sub(ship.body.pos, state.player.body.pos);
    const l = length(away);
    const dir = l > 1e-6 ? scale(away, 1 / l) : { x: Math.cos(ship.body.angle), y: Math.sin(ship.body.angle) };
    fly(state, ship, scale(dir, def.maxSpeed), def.maxSpeed, null, dt);
    return dist(ship.body.pos, state.player.body.pos) <= WATCH.retreatLeave;
  }

  // target choice: every 0.5 s, and at once when the target is gone
  let target = ship.mode === 'engage' && ship.target !== null ? (state.combat.enemies.find((e) => e.id === ship.target && fightable(e)) ?? null) : null;
  if (state.tick % RETARGET_TICKS === 0 || (ship.mode === 'engage' && !target)) {
    target = chooseTarget(state, ship, sched.pos);
    if (target && ship.mode !== 'engage') {
      setMode(ship, 'engage', state.tick);
      engagedRadio(state, ship, target.id, events);
    }
    ship.target = target?.id ?? (ship.mode === 'engage' ? null : ship.target);
    if (!target && ship.mode === 'engage') setMode(ship, 'return', state.tick);
  }
  // the leash: never farther than `leash` from the scheduled point
  if (ship.mode === 'engage' && dist(ship.body.pos, sched.pos) > WATCH.leash) {
    setMode(ship, 'return', state.tick);
    ship.target = null;
    target = null;
  }

  if (ship.mode === 'engage' && target) {
    const d = sub(ship.body.pos, target.body.pos);
    const r = length(d);
    const u = r > 1e-6 ? scale(d, 1 / r) : { x: 1, y: 0 };
    const spin = ship.slot % 2 === 0 ? 1 : -1;
    const tangent = { x: -u.y * spin, y: u.x * spin };
    const radial = Math.max(-def.maxSpeed, Math.min(def.maxSpeed, (def.orbit - r) * ORBIT_GAIN));
    const desired = add(target.body.vel, add(scale(u, radial), scale(tangent, def.maxSpeed * ORBIT_SPEED)));
    // the cutter's guns look ahead (±35°): it keeps its bow on the target; the frigate's turret turns
    const face = def.guns.some((g) => g.arc < Math.PI) ? sub(target.body.pos, ship.body.pos) : null;
    fly(state, ship, desired, def.maxSpeed, face, dt);
    fireGuns(state, ship, target, events);
    return true;
  }

  if (ship.mode === 'return') {
    const d = sub(sched.pos, ship.body.pos);
    const r = length(d);
    if (r <= WATCH.returnRadius) {
      setMode(ship, 'patrol', state.tick);
    } else {
      const top = def.maxSpeed * WATCH.catchUp;
      // slow down into the schedule's own motion near the end
      const schedVel = { x: Math.cos(sched.heading) * route.speed, y: Math.sin(sched.heading) * route.speed };
      const want = add(schedVel, scale(d, Math.min(top, r * 1.2) / r));
      fly(state, ship, want, top, null, dt, state.tick - ship.modeTick < RETURN_GHOST_TICKS);
      return true;
    }
  }

  followSchedule(ship, sched, route.speed, dt);
  return true;
}

/** The Watch radio ("Contact, engaging." / "Covering you, pilot."): an engagement near the flying player, once per `radioSeconds`. */
function engagedRadio(state: SimState, ship: WatchShip, target: string, events: SimEvent[]): void {
  const { player } = state;
  if (player.dock.mode !== 'flying' || player.destroyed) return;
  if (dist(ship.body.pos, player.body.pos) > WATCH.liveRadius) return;
  if (state.tick - state.guild.lastRadio < WATCH.radioSeconds * TICKS_PER_SECOND) return;
  state.guild.lastRadio = state.tick;
  events.push({ type: 'watchEngaged', id: ship.id, target });
}
