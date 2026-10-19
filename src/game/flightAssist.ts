// Flight assist (M3.8): the collision warning (does the path of the next few seconds hit a rock hard
// enough to damage the hull?) and the dampers' stopping point for the flight-path marker. Pure
// read-only maths over the simulation state – nothing here changes the game.
import { RAM_SAFE_SPEED } from '../sim/combat/ram';
import { giantCircles } from '../sim/discovery/giants';
import { add, dot, length, rotate, scale, sub, type Vec2 } from '../sim/math/vec2';
import type { Body } from '../sim/physics/body';
import { fortressObstacles } from '../sim/pirates/fortress';
import type { ShipProperties } from '../sim/ship/properties';
import type { SimState } from '../sim/Simulation';

/** How far ahead the warning looks (s). */
export const COLLISION_HORIZON = 3;

export interface CollisionWarning {
  /** Asteroid id, or null for a giant or a fortress. */
  id: string | null;
  /** Centre and radius of the obstacle. */
  pos: Vec2;
  radius: number;
  /** Seconds to contact. */
  time: number;
  /** Speed into the obstacle at contact (along the contact normal). */
  speed: number;
  /** 0 (at the horizon) … 1 (contact now). */
  urgency: number;
}

/**
 * When does a circle (p, radius r) moving at v first touch a still circle (c, radius s)?
 * 0 = already touching; null = never (passing by or moving away).
 */
export function firstContact(p: Vec2, v: Vec2, r: number, c: Vec2, s: number): number | null {
  const d = sub(p, c);
  const reach = r + s;
  const cc = dot(d, d) - reach * reach;
  if (cc <= 0) return dot(d, v) < 0 ? 0 : null;
  const a = dot(v, v);
  const b = 2 * dot(d, v);
  if (a < 1e-12 || b >= 0) return null;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  return (-b - Math.sqrt(disc)) / (2 * a);
}

/** The earliest damaging contact on the current path within the horizon, or null. */
export function predictCollision(state: SimState, horizon = COLLISION_HORIZON): CollisionWarning | null {
  const { player, world } = state;
  if (player.dock.mode !== 'flying' || player.destroyed) return null;
  const { pos, vel } = player.body;
  const speed = length(vel);
  // slower than this nothing can hurt the hull (stations never do – docking stays quiet)
  if (speed <= RAM_SAFE_SPEED) return null;
  const r = player.props.boundingRadius;
  const reach = speed * horizon + r;
  const candidates: { id: string | null; pos: Vec2; radius: number }[] = world
    .circlesNear(pos, reach)
    .map((c) => ({ id: c.asteroid.id, pos: c.circle.pos, radius: c.circle.radius }));
  for (const c of [...giantCircles(state, pos, reach), ...fortressObstacles(state, pos, reach)]) {
    candidates.push({ id: null, pos: c.pos, radius: c.radius });
  }
  let best: CollisionWarning | null = null;
  for (const c of candidates) {
    if (c.radius <= 0) continue;
    const t = firstContact(pos, vel, r, c.pos, c.radius);
    if (t === null || t > horizon || (best && t >= best.time)) continue;
    const at = add(pos, scale(vel, t));
    const n = sub(at, c.pos);
    const len = length(n);
    const into = len > 1e-9 ? -dot(vel, n) / len : speed;
    if (into <= RAM_SAFE_SPEED) continue;
    best = { id: c.id, pos: c.pos, radius: c.radius, time: t, speed: into, urgency: Math.min(1, Math.max(0, 1 - t / horizon)) };
  }
  return best;
}

/**
 * Where the dampers bring the ship to rest with no input: each axis of the ship frame brakes with
 * the opposite thruster group, or the cockpit RCS where there are no engines (v² / 2a). Null when
 * some drift cannot be braked (a ship without RCS).
 */
export function stoppingPoint(props: Pick<ShipProperties, 'thrust' | 'rcsThrust'>, mass: number, body: Pick<Body, 'pos' | 'vel' | 'angle'>): Vec2 | null {
  const local = rotate(body.vel, -body.angle);
  const axis = (v: number, plus: number, minus: number): number | null => {
    if (Math.abs(v) < 1e-6) return 0;
    // positive velocity is braked by the group that pushes the other way
    const engines = v > 0 ? minus : plus;
    const thrust = engines > 0 ? engines : props.rcsThrust;
    if (thrust <= 0 || mass <= 0) return null;
    return (Math.sign(v) * v * v) / (2 * (thrust / mass));
  };
  const dx = axis(local.x, props.thrust.forward, props.thrust.backward);
  const dy = axis(local.y, props.thrust.left, props.thrust.right);
  if (dx === null || dy === null) return null;
  return add(body.pos, rotate({ x: dx, y: dy }, body.angle));
}
