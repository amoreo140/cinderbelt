// Turning: the "Turn 180°" figure of the shipyard and the lever arms
// of the V layer – the heavy parts far from the centre of mass that make the ship turn slowly.
import { partDef } from '../../data/parts';
import type { Vec2 } from '../math/vec2';
import { MAX_ANG_VEL } from '../physics/body';
import { partCenter } from './grid';
import type { ShipGrid } from './types';

/**
 * Seconds for a 180° turn from rest to rest (bang-bang): full torque to the half-way point, then the
 * gyros brake (the simulation always damps the spin); the spin is capped at MAX_ANG_VEL.
 * With α = torque / inertia: if the peak spin √(π·α) stays under the cap, 2·√(π/α); otherwise the ship
 * cruises at the cap: π / ω_max + ω_max / α. null = the ship cannot turn (no torque or no mass).
 */
export function turnTime180(torque: number, inertia: number): number | null {
  if (torque <= 0 || inertia <= 0) return null;
  const alpha = torque / inertia;
  if (Math.sqrt(Math.PI * alpha) <= MAX_ANG_VEL) return 2 * Math.sqrt(Math.PI / alpha);
  return Math.PI / MAX_ANG_VEL + MAX_ANG_VEL / alpha;
}

export interface LeverArm {
  /** Placed part id. */
  partId: number;
  /** Centre of the part (grid coordinates). */
  at: Vec2;
  /** The part's share of the moment of inertia: m·r² around the centre of mass. */
  moment: number;
}

/**
 * The `count` parts with the largest m·r² around the centre of mass, largest first (ties by part id).
 * A part sitting on the centre of mass is no lever and is left out.
 */
export function leverArms(grid: ShipGrid, centerOfMass: Vec2, count = 2): LeverArm[] {
  const arms: LeverArm[] = [];
  for (const p of grid.parts) {
    const at = partCenter(p);
    const dx = at.x - centerOfMass.x;
    const dy = at.y - centerOfMass.y;
    const moment = partDef(p.partId, p.tier, p.variant).mass * (dx * dx + dy * dy);
    if (moment > 1e-9) arms.push({ partId: p.id, at, moment });
  }
  arms.sort((a, b) => b.moment - a.moment || a.partId - b.partId);
  return arms.slice(0, count);
}
