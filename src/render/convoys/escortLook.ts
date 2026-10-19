// Escort contract convoys as the render sees them (M4d plan §2.7, T6 poses): the living ships of every
// accepted escort (`escortShips` – the trader at the escort's progress, the tanker 16 u behind it),
// interpolated between the last two simulation steps, with their hull shares (the combat layer's damage
// smoke) and whether their drives burn. Pure – ConvoyLayer draws the hulls, CombatLayer the hits,
// smoke and explosions.
import { ESCORT, type ConvoyShipKind } from '../../data/convoys';
import { escortShips, type EscortShipPose } from '../../sim/convoys/escort';
import type { EscortState } from '../../sim/convoys/types';
import type { SimState } from '../../sim/Simulation';

const SIM_DT = 1 / 60;

/** One living escort convoy ship this frame. */
export interface EscortShipView extends EscortShipPose {
  /** Hull share 0..1 (no shields – the hull is all an escorted ship has). */
  hull: number;
  /** The convoy flies (cruise flames); false while it waits at the meeting point or stops for pirates. */
  moving: boolean;
}

/** Full hull of an escorted ship. */
export const escortFullHull = (kind: ConvoyShipKind): number => (kind === 'tanker' ? ESCORT.tankerHull : ESCORT.traderHull);

/** The convoy flies this step (its ships have the cruise velocity). */
export const escortMoving = (e: Pick<EscortState, 'state'>): boolean => e.state === 'moving' || e.state === 'done';

/**
 * The progress drawn this frame: a flying convoy advanced `ESCORT.speed · SIM_DT` in the last step, so the
 * render steps back the part of the step not yet shown (`alpha` = 0 → the previous step's pose).
 */
export function escortRenderProgress(e: Pick<EscortState, 'state' | 'progress'>, alpha: number): number {
  if (!escortMoving(e)) return e.progress;
  return e.progress - (1 - Math.min(1, Math.max(0, alpha))) * ESCORT.speed * SIM_DT;
}

/**
 * Every living escort convoy ship (appended to `out`, which is returned); `center`/`range` limit the list
 * to ships near the view (no limit when `center` is null).
 */
export function escortShipsNow(
  state: SimState,
  alpha: number,
  out: EscortShipView[] = [],
  center: { x: number; y: number } | null = null,
  range = Infinity,
): EscortShipView[] {
  const escorts = state.convoys.escorts;
  if (escorts.size === 0) return out;
  for (const c of state.career.contracts) {
    if (c.target.kind !== 'escort') continue;
    const e = escorts.get(c.serial);
    if (!e) continue;
    const shown: EscortState = { ...e, progress: escortRenderProgress(e, alpha) };
    const moving = escortMoving(e);
    for (const s of escortShips(state, c.serial, shown, c.target)) {
      if (center && Math.hypot(s.pos.x - center.x, s.pos.y - center.y) > range) continue;
      const full = escortFullHull(s.kind);
      out.push({ ...s, hull: Math.max(0, Math.min(1, (e.hulls[s.index] ?? 0) / full)), moving });
    }
  }
  return out;
}
