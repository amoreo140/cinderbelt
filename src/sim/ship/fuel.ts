import type { Vec2 } from '../math/vec2';
import type { FlightOutput } from './control';

/** Fuel used per unit of force per second. */
export const FUEL_PER_FORCE_SECOND = 0.003;

export function fuelNeeded(localForce: Vec2, dt: number): number {
  return (Math.abs(localForce.x) + Math.abs(localForce.y)) * FUEL_PER_FORCE_SECOND * dt;
}

/**
 * Fuel of one flight step (before the sector's multiplier): the engines' share at the ship's engine
 * multiplier (overdrive / eco variants), the cockpit RCS at the base rate – as much per force as a
 * standard engine, so the weak thrusters are never a cheaper way to move.
 */
export function flightFuel(out: Pick<FlightOutput, 'localForce' | 'rcs'>, engineFuelMult: number, dt: number): number {
  // fuelNeeded of the engines' share without the temporary vector (same arithmetic)
  const engines = (Math.abs(out.localForce.x - out.rcs.x) + Math.abs(out.localForce.y - out.rcs.y)) * FUEL_PER_FORCE_SECOND * dt;
  return engines * engineFuelMult + fuelNeeded(out.rcs, dt);
}
