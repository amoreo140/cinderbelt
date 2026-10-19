// Pirate AI (spec 2.7): a state machine patrol → attack (close in, circle, fire with a lead) → flee
// on low hull, and retreat home on low fuel. The Jackal attacks in runs (hit and run), the Hammer goes
// straight in and then circles close to the target. M4b: the Gunner holds a standoff at its cannon
// reach and evades when the player closes in; the derelict's sentry guards its station on a leash; a
// graveyard sleeper lies dormant until woken. The gunnery (aim error, reaction time) follows the
// difficulty (aim.ts). Randomness only through the saved combat RNG.
import { GUNNER, SENTRY, TOLL } from '../../data/pirates';
import { clamp, normalizeAngle } from '../math/angle';
import { add, dot, length, rotate, scale, sub, type Vec2 } from '../math/vec2';
import { TICKS_PER_SECOND } from './damage';
import type { Body } from '../physics/body';
import type { FlightInput } from '../ship/control';
import { hullCurrent } from '../ship/hp';
import { acquire, AIM_SKILL, aimWithError, react, type AimSkill } from './aim';
import { rngNext, rngRange } from './rng';
import type { Enemy, EnemyKind } from './types';
import { leadPoint } from './weapons';

/** A pirate notices the player within this distance (a sentry: the player within its guard radius of the derelict). */
export const AGGRO_RANGE: Record<EnemyKind, number> = { jackal: 140, hammer: 160, scavenger: 0, gunner: GUNNER.aggroRange, sentry: SENTRY.aggroRange };
/** Beyond this distance a pirate gives up the chase (the Gunner too – data/pirates.ts GUNNER.leashRange). */
export const LEASH_RANGE = 420;
/** Below this share of its HP a pirate flees (the Hammer fights longer; a sentry never flees). */
export const FLEE_HULL: Record<EnemyKind, number> = { jackal: 0.3, hammer: 0.2, scavenger: 1, gunner: GUNNER.fleeHull, sentry: 0 };
/** A fleeing pirate calms down at this distance. */
export const FLEE_SAFE = 380;
/** Orbit distance around the target (the Gunner holds its standoff instead – `gunnerStandoff`). */
const ORBIT_DISTANCE: Record<EnemyKind, number> = { jackal: 22, hammer: 26, scavenger: 30, gunner: 26, sentry: SENTRY.orbit };
const PATROL_RADIUS = 60;
const PATROL_THROTTLE = 0.45;
/** Patrol cruise speed (u/s): the pirate coasts between waypoints instead of burning all the way. */
const PATROL_SPEED = 4;
/** Steps per patrol leg (the flight plus the wait at the waypoint). */
const PATROL_LEG: [number, number] = [900, 1800];
/** Retreat cruise speed (u/s) on the way home. */
const RETREAT_SPEED = 10;
/** Below this share of the tanks the pirate breaks off and heads home (and stays there). */
export const LOW_FUEL = 0.2;
/** A retreating pirate is home within this distance of its patrol centre. */
const HOME_RADIUS = 12;
/** At home a retreating pirate refuels a full tank in this many seconds (I14)… */
export const HOME_REFUEL_SECONDS = 90;
/** …and goes back on patrol once its tanks are this full. */
export const RESUME_FUEL = 0.9;
/** Jackal: length of a run and of the retreat (steps). */
const JACKAL_ATTACK: [number, number] = [240, 360];
const JACKAL_BREAK: [number, number] = [90, 150];

export interface AiTarget {
  pos: Vec2;
  vel: Vec2;
}

export interface AiCommand {
  flight: FlightInput;
  aim: Vec2;
  fire: boolean;
  /** Flight dampers (default on); a cruising pirate turns them off to coast and save fuel. */
  dampers?: boolean;
  /**
   * A patrol around the home base: the gang keeps its patrols supplied, so it burns no fuel (I14 – a
   * patrol must not end in a retreat that never ends).
   */
  patrol?: boolean;
}

export interface AiResult {
  cmd: AiCommand;
  /** The pirate has just started an attack (for the HUD and sound). */
  alerted: boolean;
}

/** Turns the ship toward a point and adds thrust when it points roughly right. */
export function steerTo(body: Body, point: Vec2, throttle: number): FlightInput {
  const d = sub(point, body.pos);
  const desired = Math.atan2(d.y, d.x);
  const diff = normalizeAngle(desired - body.angle);
  const turn = clamp(diff * 2.5 - body.angVel * 0.6, -1, 1);
  const forward = Math.abs(diff) < 0.7 ? throttle * (1 - Math.abs(diff) / 1.4) : 0;
  return { forward, strafe: 0, turn };
}

/**
 * Turn towards a point without overshooting: spin no faster than the gyros can stop within the
 * remaining angle. `fallback` when the ship has no torque.
 */
function brakingTurn(e: Pick<Enemy, 'body' | 'props'>, point: Vec2, fallback: number): number {
  const alpha = e.props.inertia > 0 ? e.props.torque / e.props.inertia : 0;
  if (alpha <= 0) return fallback;
  const d = sub(point, e.body.pos);
  const diff = normalizeAngle(Math.atan2(d.y, d.x) - e.body.angle);
  return clamp((Math.sign(diff) * Math.sqrt(2 * alpha * Math.abs(diff)) * 0.8 - e.body.angVel) * 2, -1, 1);
}

const hullFraction = (e: Enemy): number => (e.maxHull > 0 ? hullCurrent(e.grid, e.hp) / e.maxHull : 1);

/** Share of the tanks still full (a ship without tanks counts as empty). */
export const fuelFraction = (e: Pick<Enemy, 'fuel' | 'props'>): number => (e.props.fuelCapacity > 0 ? e.fuel / e.props.fuelCapacity : 0);

/**
 * Economical flight to a point: thrust only up to `speed` (less near the point, so the brakes can stop
 * the ship there), coast with the dampers off, trim sideways drift with the side engines and brake
 * with the dampers on arrival. Used on patrol and retreat – the attack flies flat out.
 */
export function cruiseTo(e: Pick<Enemy, 'body' | 'props'>, point: Vec2, speed: number, throttle: number): AiCommand {
  const to = sub(point, e.body.pos);
  const dist = length(to);
  const dir = dist > 1e-6 ? scale(to, 1 / dist) : { x: 1, y: 0 };
  const brake = e.props.mass > 0 ? e.props.thrust.backward / e.props.mass : 0;
  const cap = Math.min(speed, Math.sqrt(2 * Math.max(brake, 0.5) * dist) * 0.7);
  const along = dot(e.body.vel, dir);
  const flight = steerTo(e.body, point, along < cap ? throttle : 0);
  flight.turn = brakingTurn(e, point, flight.turn);
  const diff = normalizeAngle(Math.atan2(dir.y, dir.x) - e.body.angle);
  // drift across the course (in the ship's frame): the side engines trim it once the nose points on course
  const across = rotate(sub(e.body.vel, scale(dir, along)), -e.body.angle);
  if (Math.abs(diff) < 0.5 && Math.abs(across.y) > 0.4) {
    flight.strafe = clamp(-across.y * 0.5, -1, 1);
  }
  return { flight, aim: point, fire: false, dampers: along > cap + 1 };
}

function patrol(e: Enemy, holder: { rng: number }): AiCommand {
  const ai = e.ai;
  const near = length(sub(ai.waypoint, e.body.pos)) < 8;
  if (ai.timer <= 0) {
    const a = rngNext(holder) * Math.PI * 2;
    const r = Math.sqrt(rngNext(holder)) * PATROL_RADIUS;
    ai.waypoint = { x: e.home.x + Math.cos(a) * r, y: e.home.y + Math.sin(a) * r };
    ai.timer = Math.round(rngRange(holder, ...PATROL_LEG));
  } else if (near) {
    // at the waypoint: the dampers stop the ship and it waits for the next leg
    return { flight: { forward: 0, strafe: 0, turn: 0 }, aim: ai.waypoint, fire: false, patrol: true };
  }
  return { ...cruiseTo(e, ai.waypoint, PATROL_SPEED, PATROL_THROTTLE), patrol: true };
}

/**
 * At home a retreating ship refuels from its base over time; with the tanks full enough it goes back
 * on patrol (I14). Returns true when it left the retreat.
 */
export function refuelAtHome(e: Pick<Enemy, 'fuel' | 'props' | 'ai' | 'home' | 'body'>): boolean {
  if (length(sub(e.home, e.body.pos)) > HOME_RADIUS) return false;
  const cap = e.props.fuelCapacity;
  e.fuel = Math.min(cap, e.fuel + cap / (HOME_REFUEL_SECONDS * 60));
  if (cap <= 0 || e.fuel < cap * RESUME_FUEL) return false;
  e.ai.mode = 'patrol';
  e.ai.timer = 0;
  return true;
}

/** Where to aim: the lead of the first cannon with the difficulty's aim error. */
function aimAt(e: Enemy, target: AiTarget, skill: AimSkill, holder: { rng: number }): { aim: Vec2; range: number } {
  const w = e.props.weapons[0];
  const speed = w?.projectileSpeed ?? 75;
  return { aim: aimWithError(e.body.pos, e.body.vel, target.pos, target.vel, speed, skill, holder), range: w?.range ?? 0 };
}

/**
 * The pirate's decision for this step (changes `e.ai`). `target` = the flying player, otherwise null;
 * `skill` = gunnery of the game's difficulty.
 */
export function think(e: Enemy, target: AiTarget | null, holder: { rng: number }, skill: AimSkill = AIM_SKILL.mild): AiResult {
  const ai = e.ai;
  // a graveyard sleeper (M4b): no thrust, no fire, shield down until something wakes it (sites/graveyard.ts)
  if (ai.mode === 'dormant') return { cmd: dormant(e), alerted: false };
  if (e.kind === 'sentry') return thinkSentry(e, target, holder, skill);
  // only a Gunner evades; any other ship found in the mode (a crafted save) fights on
  if (ai.mode === 'evade' && e.kind !== 'gunner') ai.mode = 'attack';
  ai.timer--;
  const dist = target ? length(sub(target.pos, e.body.pos)) : Infinity;
  let alerted = false;

  // low on fuel (the same tanks and burn as the player's): break off and head home, then wait there
  if (ai.mode !== 'retreat' && ai.mode !== 'flee' && fuelFraction(e) < LOW_FUEL) ai.mode = 'retreat';
  // at home it refuels and, with full enough tanks, patrols again (I14)
  if (ai.mode === 'retreat' && !refuelAtHome(e)) return { cmd: retreat(e, target, dist, skill, holder), alerted };

  // toll demand (M3.6): hold position facing the player, do not fire
  if (ai.mode === 'hail' && target) {
    const away = dist > 1e-6 ? scale(sub(e.body.pos, target.pos), 1 / dist) : { x: 1, y: 0 };
    const point = add(target.pos, scale(rotate(away, ai.orbit * 0.15), TOLL.hailDistance));
    const throttle = Math.abs(dist - TOLL.hailDistance) > 8 ? 0.6 : 0.15;
    return { cmd: { flight: steerTo(e.body, point, throttle), aim: target.pos, fire: false }, alerted };
  }
  if (ai.mode === 'hail') ai.mode = 'patrol';
  if (ai.mode === 'patrol' && target && dist < AGGRO_RANGE[e.kind] && !e.calm) {
    ai.mode = 'attack';
    ai.timer = Math.round(rngRange(holder, ...JACKAL_ATTACK));
    ai.breakOff = 0;
    alerted = true;
    acquire(ai, target.vel, skill);
  }
  if ((ai.mode === 'attack' || ai.mode === 'evade') && (!target || dist > LEASH_RANGE || e.calm)) ai.mode = 'patrol';
  // a Gunner that lost every cannon has nothing to stand off with: it keeps away
  if (e.kind === 'gunner' && e.props.weapons.length === 0 && target && dist < FLEE_SAFE) ai.mode = 'flee';
  if (ai.mode !== 'flee' && hullFraction(e) < FLEE_HULL[e.kind] && target && dist < FLEE_SAFE) ai.mode = 'flee';
  if (ai.mode === 'flee' && (!target || dist > FLEE_SAFE)) {
    ai.mode = 'patrol';
    ai.timer = 0;
  }

  if (ai.mode === 'patrol' || !target) return { cmd: patrol(e, holder), alerted };

  const away = dist > 1e-6 ? scale(sub(e.body.pos, target.pos), 1 / dist) : { x: 1, y: 0 };
  if (ai.mode === 'flee') {
    const point = add(e.body.pos, scale(rotate(away, ai.orbit * 0.3), 50));
    return { cmd: { flight: steerTo(e.body, point, 1), aim: point, fire: false }, alerted };
  }

  if (e.kind === 'gunner') return { cmd: gunnerAttack(e, target, dist, away, skill, holder), alerted };

  // attack: fire once the gunner has reacted to the target (and to its last course change)
  const { aim, range } = aimAt(e, target, skill, holder);
  const ready = react(ai, target.vel, skill);
  const fire = ready && dist < range * 0.9;
  if (e.kind === 'jackal') {
    if (ai.breakOff > 0) {
      ai.breakOff--;
      if (ai.breakOff === 0) ai.timer = Math.round(rngRange(holder, ...JACKAL_ATTACK));
      const point = add(e.body.pos, scale(rotate(away, ai.orbit * 0.6), 60));
      return { cmd: { flight: steerTo(e.body, point, 1), aim, fire }, alerted };
    }
    if (ai.timer <= 0) {
      ai.breakOff = Math.round(rngRange(holder, ...JACKAL_BREAK));
      ai.orbit = ai.orbit === 1 ? -1 : 1;
    }
  }
  const orbit = ORBIT_DISTANCE[e.kind];
  let point: Vec2;
  let throttle = 1;
  if (dist > orbit * 1.6) {
    point = leadPoint(e.body.pos, e.body.vel, target.pos, target.vel, 40);
  } else {
    // circling: a point on the circle around the target, a little further along the orbit
    point = add(target.pos, scale(rotate(away, ai.orbit * 0.9), orbit));
    throttle = 0.7;
  }
  return { cmd: { flight: steerTo(e.body, point, throttle), aim, fire }, alerted };
}

/**
 * Low on fuel: away from the player first (when close), then home at an economical cruise; at home the
 * dampers stop the ship and it waits with its last fuel. It shoots back only at a player in reach.
 */
function retreat(e: Enemy, target: AiTarget | null, dist: number, skill: AimSkill, holder: { rng: number }): AiCommand {
  const ai = e.ai;
  const home = length(sub(e.home, e.body.pos));
  let cmd: AiCommand;
  if (target && dist < FLEE_SAFE * 0.5 && home > HOME_RADIUS) {
    const away = dist > 1e-6 ? scale(sub(e.body.pos, target.pos), 1 / dist) : { x: 1, y: 0 };
    // away from the player, bending towards home
    const toHome = home > 1e-6 ? scale(sub(e.home, e.body.pos), 1 / home) : away;
    cmd = cruiseTo(e, add(e.body.pos, scale(add(away, scale(toHome, 0.5)), 50)), RETREAT_SPEED, 1);
  } else if (home > HOME_RADIUS) {
    cmd = cruiseTo(e, e.home, RETREAT_SPEED, 1);
  } else {
    cmd = { flight: { forward: 0, strafe: 0, turn: 0 }, aim: e.home, fire: false };
  }
  if (target) {
    const { aim, range } = aimAt(e, target, skill, holder);
    const ready = react(ai, target.vel, skill);
    cmd = { ...cmd, aim, fire: ready && dist < range * 0.9 };
  }
  return cmd;
}

// ---------------------------------------------------------------------------
// Gunner (M4b, design 6.2): standoff at its cannon reach, evade when the player closes in

/** Longest reach of the ship's cannons (0 without cannons). */
const cannonReach = (e: Pick<Enemy, 'props'>): number => e.props.weapons.reduce((r, w) => Math.max(r, w.range), 0);

/** The Gunner's standoff: min(120, 0.9 × its cannon range) – 90 u with its T2 cannons. */
export const gunnerStandoff = (e: Pick<Enemy, 'props'>): number => Math.min(GUNNER.maxStandoff, GUNNER.standoffShare * cannonReach(e));

/**
 * Station keeping with the guns on the target: the ship flies to `point` (speed relative to the
 * target capped at `speed`, slowing down near the point; world speed capped at `GUNNER.cruiseSpeed`)
 * on all its engines – forward, backward and sideways in its own frame – while the gyros keep its
 * nose on `face`.
 */
function holdStation(e: Enemy, point: Vec2, targetVel: Vec2, face: Vec2, speed: number): FlightInput {
  const to = sub(point, e.body.pos);
  const dist = length(to);
  const rel = dist > 1e-6 ? scale(to, Math.min(speed, dist * GUNNER.closeGain) / dist) : { x: 0, y: 0 };
  let want = add(targetVel, rel);
  // it never outruns a chase: the world speed is capped (the evade is the only sprint)
  if (length(want) > GUNNER.cruiseSpeed) want = scale(want, GUNNER.cruiseSpeed / length(want));
  const err = rotate(sub(want, e.body.vel), -e.body.angle);
  return { forward: clamp(err.x * 0.6, -1, 1), strafe: clamp(err.y * 0.6, -1, 1), turn: steerTo(e.body, face, 0).turn };
}

/**
 * The Gunner's attack step: within `evadeShare` × standoff it breaks away (mode 'evade': full thrust
 * away and sideways for 4–6 s, guns off the target, then back); otherwise it holds the standoff band,
 * drifting slowly around the target, and fires salvos when in reach. It moves no faster than
 * `GUNNER.cruiseSpeed`, so a ship that chases it closes in.
 */
function gunnerAttack(e: Enemy, target: AiTarget, dist: number, away: Vec2, skill: AimSkill, holder: { rng: number }): AiCommand {
  const ai = e.ai;
  const standoff = gunnerStandoff(e);
  if (ai.mode === 'attack' && dist < standoff * GUNNER.evadeShare) {
    ai.mode = 'evade';
    ai.timer = Math.round(rngRange(holder, GUNNER.evadeSeconds[0], GUNNER.evadeSeconds[1]) * TICKS_PER_SECOND);
  }
  if (ai.mode === 'evade') {
    if (ai.timer > 0) {
      const point = add(e.body.pos, scale(rotate(away, ai.orbit * GUNNER.evadeAngle), 60));
      return { flight: steerTo(e.body, point, 1), aim: point, fire: false };
    }
    // back to the standoff: the gunner has to find the target again before it fires
    ai.mode = 'attack';
    ai.orbit = ai.orbit === 1 ? -1 : 1;
    acquire(ai, target.vel, skill);
  }
  const { aim, range } = aimAt(e, target, skill, holder);
  const ready = react(ai, target.vel, skill);
  // the salvo clock (a Gunner never breaks off like a Jackal, so `breakOff` keeps it – saved with the ship)
  const on = Math.round(GUNNER.salvo.on * TICKS_PER_SECOND);
  const cycle = on + Math.round(GUNNER.salvo.off * TICKS_PER_SECOND);
  const salvo = ai.breakOff < on;
  ai.breakOff = (Math.max(0, ai.breakOff) + 1) % cycle;
  const point = add(target.pos, scale(rotate(away, ai.orbit * GUNNER.orbitStep), standoff));
  const flight = holdStation(e, point, target.vel, aim, GUNNER.moveSpeed);
  return { flight, aim, fire: ready && salvo && dist < range * GUNNER.fireShare };
}

// ---------------------------------------------------------------------------
// Sentry drone (M4b, plan §2.4): guards its derelict (`home`) from its post (`ai.waypoint`)

/**
 * A sentry attacks a player within `SENTRY.guardRadius` of its derelict and keeps at it while the
 * player stays within the leash; it never strays farther than the leash from the derelict, never
 * flees, never runs low on fuel (the station powers it – its flight burns nothing) and never tolls.
 * Without a target in its zone it flies back to its post and waits there.
 */
function thinkSentry(e: Enemy, target: AiTarget | null, holder: { rng: number }, skill: AimSkill): AiResult {
  const ai = e.ai;
  const fromHome = target ? length(sub(target.pos, e.home)) : Infinity;
  let alerted = false;
  if (ai.mode !== 'attack' && target && fromHome < SENTRY.guardRadius) {
    ai.mode = 'attack';
    alerted = true;
    acquire(ai, target.vel, skill);
  }
  if (ai.mode === 'attack' && (!target || fromHome > SENTRY.leash)) ai.mode = 'patrol';
  if (ai.mode !== 'attack' || !target) {
    ai.mode = 'patrol';
    const post = ai.waypoint;
    if (length(sub(post, e.body.pos)) < 4) return { cmd: { flight: { forward: 0, strafe: 0, turn: 0 }, aim: post, fire: false, patrol: true }, alerted };
    return { cmd: { ...cruiseTo(e, post, SENTRY.returnSpeed, 1), patrol: true }, alerted };
  }
  const dist = length(sub(target.pos, e.body.pos));
  const { aim, range } = aimAt(e, target, skill, holder);
  const ready = react(ai, target.vel, skill);
  const away = dist > 1e-6 ? scale(sub(e.body.pos, target.pos), 1 / dist) : { x: 1, y: 0 };
  // the leash: it never goes farther than `reach` from the derelict. A target beyond that is held from
  // the edge of the zone (the point of the circle nearest to it); a drone whose outward speed would
  // carry it past the leash (stopping distance on its main engine) turns home first.
  const reach = SENTRY.leash - SENTRY.leashMargin;
  const fromCentre = sub(target.pos, e.home);
  let point: Vec2;
  if (length(fromCentre) > reach) {
    point = add(e.home, scale(fromCentre, reach / length(fromCentre)));
  } else {
    point = dist > SENTRY.orbit * 1.6 ? leadPoint(e.body.pos, e.body.vel, target.pos, target.vel, 40) : add(target.pos, scale(rotate(away, ai.orbit * 0.9), SENTRY.orbit));
    const out = sub(point, e.home);
    if (length(out) > reach) point = add(e.home, scale(out, reach / length(out)));
  }
  const off = sub(e.body.pos, e.home);
  const r = length(off);
  const outward = r > 1e-6 ? dot(e.body.vel, off) / r : 0;
  const decel = e.props.mass > 0 ? e.props.thrust.forward / e.props.mass : 0;
  if (outward > 0 && r + (outward * outward) / (2 * Math.max(decel, 0.5)) > SENTRY.leash) point = { ...e.home };
  const fire = ready && dist < range * 0.9;
  // at its spot it holds still like a turret and brings its gun round to the target
  if (length(sub(point, e.body.pos)) < SENTRY.holdRadius) {
    return { cmd: { flight: { forward: 0, strafe: 0, turn: brakingTurn(e, aim, 0) }, aim, fire, patrol: true }, alerted };
  }
  const move = cruiseTo(e, point, SENTRY.chaseSpeed, 1);
  return { cmd: { ...move, dampers: true, aim, fire, patrol: true }, alerted };
}

// ---------------------------------------------------------------------------
// Dormant sleepers (M4b, plan §2.5)

/** A dormant ship's step: no thrust, no dampers, no fire; its shield stays down (no regeneration). */
function dormant(e: Enemy): AiCommand {
  e.shield = 0;
  // regenShield only counts the delay down while it is positive – the shield never comes up
  e.shieldDelay = Math.max(e.shieldDelay, 2);
  return { flight: { forward: 0, strafe: 0, turn: 0 }, aim: e.body.pos, fire: false, dampers: false, patrol: true };
}

/** Puts a freshly created enemy to sleep (a graveyard sleeper): mode 'dormant', shield down. */
export function makeDormant(e: Enemy): Enemy {
  e.ai.mode = 'dormant';
  e.shield = 0;
  e.shieldDelay = Math.max(e.shieldDelay, 2);
  return e;
}

/**
 * Wakes a dormant ship (the graveyard's wake rules decide when – sites/graveyard.ts): it attacks at
 * once and its shield starts charging, but its gunner still needs a reaction time (`skill`) before the
 * first shot. A ship that is not dormant is left alone. Returns true when it woke.
 */
export function wakeEnemy(e: Enemy, skill: AimSkill = AIM_SKILL.mild): boolean {
  if (e.ai.mode !== 'dormant') return false;
  e.ai.mode = 'attack';
  e.ai.timer = 0;
  e.ai.breakOff = 0;
  e.shieldDelay = 0;
  e.ai.react = skill.reaction;
  return true;
}
