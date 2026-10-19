// Data for the mining strip of the HUD (long-term design 2.1.1): the heat bar of the hottest laser and a short
// "bonus ×1.5" feedback when the beam mines on the active section of a vein.
import { HEAT_MAX, type LaserHeat } from '../sim/mining/heat';
import type { MiningBeam } from '../sim/mining/mining';

/** How long the bonus label stays after leaving the vein (s) – it does not flicker while tracking the section. */
export const BONUS_HOLD = 0.4;

export interface MiningHudData {
  /** Heat of the hottest laser (s on the vein). */
  heat: number;
  heatMax: number;
  /** A laser is cooling down (not firing). */
  overheated: boolean;
  /** Mining bonus on the vein (×1.5 …), or null. */
  bonus: number | null;
  /** The ship is mining right now or a laser is warm (otherwise the bar is dimmed). */
  active: boolean;
}

/** Memory of the last bonus (game layer – the time is frame time, not simulation time). */
export class MiningHudMemo {
  bonus = 0;
  until = -Infinity;
}

export function miningHud(
  ship: { lasers: number; heat: ReadonlyMap<number, LaserHeat>; beams: readonly MiningBeam[] },
  now: number,
  memo: MiningHudMemo,
): MiningHudData | null {
  if (ship.lasers === 0) return null;
  let heat = 0;
  let overheated = false;
  for (const h of ship.heat.values()) {
    heat = Math.max(heat, h.heat);
    if (h.cooling > 0) overheated = true;
  }
  const bonusNow = ship.beams.reduce((m, b) => Math.max(m, b.bonus), 1);
  if (bonusNow > 1) {
    memo.bonus = bonusNow;
    memo.until = now + BONUS_HOLD;
  }
  const bonus = now <= memo.until ? memo.bonus : null;
  // with a laser ship the bar is always there (the HUD console does not change height), only dimmed outside mining
  const active = heat > 0 || overheated || ship.beams.length > 0 || bonus !== null;
  return { heat, heatMax: HEAT_MAX, overheated, bonus, active };
}
