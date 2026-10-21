import { clamp } from '../math/angle';
import { rotate, type Vec2 } from '../math/vec2';
import type { Body } from '../physics/body';
import type { ShipProperties } from './properties';

/** Inputs in the range -1..1. forward + = ahead, strafe + = to the left, turn + = counter-clockwise. */
export interface FlightInput {
  forward: number;
  strafe: number;
  turn: number;
}

export interface FlightOutput {
  /** Force in world coordinates. */
  force: Vec2;
  /** Force in the ship frame (x ahead, y to the left) – for the flames and the fuel use. */
  localForce: Vec2;
  /** The part of `localForce` pushed by the cockpit's manoeuvring thrusters (RCS), not by engines. */
  rcs: Vec2;
  torque: number;
}

/** Cruise cap of the player's ship while its dampers are on (u/s) – assisted flight; free flight goes up to MAX_SPEED. */
export const ASSISTED_SPEED = 25;
/** How softly the dampers pull the speed down to the cap (s) – a short time constant instead of a hard clamp. */
const CAP_TAU = 0.25;

/** Below this speed along an axis the dampers stop the ship completely. */
export const DAMPER_SNAP = 0.05;

// One direction of an axis gives the thrust of its engines; without engines the cockpit's weak
// manoeuvring thrusters stand in: the dampers always use them (any ship can slowly stop), the pilot's keys
// only with `manualRcs` (they never replace the main engine – a ship without one stays stranded). Plain
// numbers instead of an object per direction (perf audit 2026-10-17, P4).

/** Thrust for the pilot's input (0 = the key does nothing). */
const manualThrust = (engines: number, rcs: number, manualRcs: boolean): number => (engines > 0 ? engines : manualRcs ? rcs : 0);
/** Thrust for the dampers. */
const damperThrust = (engines: number, rcs: number): number => (engines > 0 ? engines : rcs);

function axisForce(
  input: number,
  velocity: number,
  posManual: number,
  posDamper: number,
  negManual: number,
  negDamper: number,
  mass: number,
  dampers: boolean,
  dt: number,
): number {
  if (input > 0) return input * posManual;
  if (input < 0) return input * negManual;
  if (!dampers || velocity === 0) return 0;

  const available = velocity > 0 ? negDamper : posDamper;
  if (available <= 0) return 0;

  const desired = (-mass * velocity) / dt;
  if (Math.abs(velocity) < DAMPER_SNAP) return desired;
  return clamp(desired, -negDamper, posDamper);
}

/** The RCS share of an axis force: all of it when its direction has no engines (`posEngines` ≤ 0 …). */
const rcsShare = (force: number, posEngines: number, negEngines: number): number =>
  (force > 0 && !(posEngines > 0)) || (force < 0 && !(negEngines > 0)) ? force : 0;

/**
 * Assisted flight: when the velocity after this tick's pilot force would exceed `cap`, the net force on both
 * axes is replaced by the one that eases the velocity to the capped target (same direction, speed `cap`) over
 * `CAP_TAU`, limited by the damper authority of each direction. The engines cannot push beyond the cap, and an
 * excess (dampers switched back on at 60 u/s) is braked with the ship's own thrusters. `localForce` is edited in place.
 */
function capSpeed(props: FlightProps, localForce: Vec2, lvx: number, lvy: number, cap: number, dt: number): void {
  const k = dt / props.mass;
  const px = lvx + localForce.x * k;
  const py = lvy + localForce.y * k;
  const speed = Math.hypot(px, py);
  if (speed <= cap) return;
  const f = cap / speed;
  const t = props.thrust;
  const rcs = props.rcsThrust;
  const tau = Math.max(dt, CAP_TAU);
  localForce.x = clamp((props.mass * (px * f - lvx)) / tau, -damperThrust(t.backward, rcs), damperThrust(t.forward, rcs));
  localForce.y = clamp((props.mass * (py * f - lvy)) / tau, -damperThrust(t.right, rcs), damperThrust(t.left, rcs));
}

/** What the flight model reads of a ship (a reused view can stand in for the whole properties). */
export type FlightProps = Pick<ShipProperties, 'thrust' | 'rcsThrust' | 'mass' | 'inertia' | 'torque'>;

export function computeFlight(
  props: FlightProps,
  body: Body,
  input: FlightInput,
  dampers: boolean,
  dt: number,
  speedCap = Infinity,
): FlightOutput {
  // rotate(body.vel, -body.angle) without the temporary
  const ca = Math.cos(-body.angle);
  const sa = Math.sin(-body.angle);
  const lvx = body.vel.x * ca - body.vel.y * sa;
  const lvy = body.vel.x * sa + body.vel.y * ca;
  const t = props.thrust;
  const rcs = props.rcsThrust;
  // the RCS answers the pilot's keys only on a ship with a main engine (side and reverse trim)
  const manualRcs = t.forward > 0;
  const localForce = {
    x: axisForce(
      input.forward,
      lvx,
      manualThrust(t.forward, rcs, false),
      damperThrust(t.forward, rcs),
      manualThrust(t.backward, rcs, manualRcs),
      damperThrust(t.backward, rcs),
      props.mass,
      dampers,
      dt,
    ),
    y: axisForce(
      input.strafe,
      lvy,
      manualThrust(t.left, rcs, manualRcs),
      damperThrust(t.left, rcs),
      manualThrust(t.right, rcs, manualRcs),
      damperThrust(t.right, rcs),
      props.mass,
      dampers,
      dt,
    ),
  };
  if (speedCap < Infinity && dampers) capSpeed(props, localForce, lvx, lvy, speedCap, dt);
  const rcsForce = { x: rcsShare(localForce.x, t.forward, t.backward), y: rcsShare(localForce.y, t.left, t.right) };

  const torque =
    input.turn !== 0
      ? input.turn * props.torque
      : clamp((-props.inertia * body.angVel) / dt, -props.torque, props.torque);

  return { force: rotate(localForce, body.angle), localForce, rcs: rcsForce, torque };
}
