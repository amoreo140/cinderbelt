// Laser overheating (long-term design): every laser has its own heat bar. Heat rises
// only while the beam mines a vein; after 4 s the laser switches off for 1.5 s and cools down. Off a vein the heat falls.

/** Seconds on a vein until overheating. */
export const HEAT_MAX = 4;
/** Cooling after overheating in simulation steps (1.5 s at 60 Hz). */
export const COOL_TICKS = 90;
/** How fast the heat falls off a vein (s per s). */
export const HEAT_DECAY = 1;

export interface LaserHeat {
  /** Seconds on a vein (0 … HEAT_MAX). */
  heat: number;
  /** Steps until cooling ends (0 = the laser can fire). */
  cooling: number;
}

export const canFire = (h: LaserHeat | undefined): boolean => !h || h.cooling <= 0;

/** One heat step of a laser; returns true on the step the laser overheated. */
export function stepHeat(h: LaserHeat, onVein: boolean, dt: number): boolean {
  if (h.cooling > 0) {
    h.cooling--;
    h.heat = h.cooling > 0 ? (HEAT_MAX * h.cooling) / COOL_TICKS : 0;
    return false;
  }
  if (onVein) {
    h.heat += dt;
    if (h.heat >= HEAT_MAX - 1e-9) {
      h.heat = HEAT_MAX;
      h.cooling = COOL_TICKS;
      return true;
    }
    return false;
  }
  h.heat = Math.max(0, h.heat - HEAT_DECAY * dt);
  return false;
}

/** Heat bar 0 … 1 (falls from full during cooling). */
export const heatFraction = (h: LaserHeat): number => Math.min(1, Math.max(0, h.heat / HEAT_MAX));

/** The hottest laser for the HUD. */
export function hottest(heat: ReadonlyMap<number, LaserHeat>): { fraction: number; overheated: boolean } {
  let fraction = 0;
  let overheated = false;
  for (const h of heat.values()) {
    fraction = Math.max(fraction, heatFraction(h));
    if (h.cooling > 0) overheated = true;
  }
  return { fraction, overheated };
}
