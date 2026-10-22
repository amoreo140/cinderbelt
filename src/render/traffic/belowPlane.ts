// Station traffic below the gameplay plane (cosmetic only: it never collides). A vehicle rises from its
// lane far below the plane to a berth beside the station; while it is under the plane it fades a little
// – slightly grey, darker and hazed – so it reads as background and not as a ship the player can meet.
// Always on, opaque: at full depth the lit colour loses 60 % of its saturation, 40 % of its
// brightness and mixes 20 % of the zone haze in; the flame and the trail are dimmed too. At and above
// the plane the factor is exactly 0; the berths are 8–10 u below it, so a berthed vehicle is fully faded.

/** Depth below the plane (u) at which the fade is complete. */
export const BELOW_FULL_DEPTH = 8;
/** Effect at full fade: share of the saturation removed, brightness removed, zone haze mixed in. */
export const BELOW_DESATURATE = 0.6;
export const BELOW_DARKEN = 0.4;
export const BELOW_HAZE = 0.2;
/** Share of the flame intensity and of the trail strength removed at full fade. */
export const BELOW_FLAME_DIM = 0.5;
export const BELOW_TRAIL_DIM = 0.5;

/** Fade factor 0..1 for a vehicle at height `y` (u, plane = 0, below = negative): smoothstep over the depth. */
export function belowPlaneFade(y: number): number {
  const t = Math.min(1, Math.max(0, -y / BELOW_FULL_DEPTH));
  return t * t * (3 - 2 * t);
}
