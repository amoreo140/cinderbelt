import { clamp, normalizeAngle } from '../math/angle';
import { hypot, type Vec2 } from '../math/vec2';

export interface Body {
  /** Position of the centre of mass in the world. */
  pos: Vec2;
  vel: Vec2;
  angle: number;
  angVel: number;
}

export const MAX_SPEED = 60;
export const MAX_ANG_VEL = 2.5;

export function createBody(pos: Vec2 = { x: 0, y: 0 }, angle = 0): Body {
  return { pos: { ...pos }, vel: { x: 0, y: 0 }, angle, angVel: 0 };
}

/**
 * A free drift (no force, no torque, mass and inertia 1) followed by a damping of the velocity by
 * `max(0, 1 − linear·dt)` and of the spin by `max(0, 1 − angular·dt)`: exactly
 * `{ ...integrate(body, {0, 0}, 0, 1, 1, dt), vel: vel·k, angVel: angVel·ka }` – the drift of wrecks and
 * containers – as one new body instead of two (perf audit 2026-10-17, P4).
 */
export function driftDamped(body: Body, dt: number, linear: number, angular: number): Body {
  // integrate(body, { x: 0, y: 0 }, 0, 1, 1, dt), operation for operation
  const k0 = dt / 1;
  let vx = body.vel.x + 0 * k0;
  let vy = body.vel.y + 0 * k0;
  const speed = hypot(vx, vy);
  if (speed > MAX_SPEED) {
    const f = MAX_SPEED / speed;
    vx = vx * f;
    vy = vy * f;
  }
  const pos = { x: body.pos.x + vx * dt, y: body.pos.y + vy * dt };
  const angVel = clamp(body.angVel + (0 / 1) * dt, -MAX_ANG_VEL, MAX_ANG_VEL);
  const angle = normalizeAngle(body.angle + angVel * dt);
  // the damping of the old `{ ...moved, vel, angVel }`
  const k = Math.max(0, 1 - linear * dt);
  const ka = Math.max(0, 1 - angular * dt);
  return { pos, vel: { x: vx * k, y: vy * k }, angle, angVel: angVel * ka };
}

/** One semi-implicit Euler step. Returns a new body. */
export function integrate(
  body: Body,
  force: Vec2,
  torque: number,
  mass: number,
  inertia: number,
  dt: number,
): Body {
  // scalars instead of temporaries – the arithmetic of add/scale/length, operation for operation
  const k = dt / mass;
  let vx = body.vel.x + force.x * k;
  let vy = body.vel.y + force.y * k;
  const speed = hypot(vx, vy);
  if (speed > MAX_SPEED) {
    const f = MAX_SPEED / speed;
    vx = vx * f;
    vy = vy * f;
  }
  const pos = { x: body.pos.x + vx * dt, y: body.pos.y + vy * dt };

  const angVel = clamp(body.angVel + (torque / inertia) * dt, -MAX_ANG_VEL, MAX_ANG_VEL);
  const angle = normalizeAngle(body.angle + angVel * dt);

  return { pos, vel: { x: vx, y: vy }, angle, angVel };
}
