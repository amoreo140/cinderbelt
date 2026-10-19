// The ship log (M4a plan §2): the active ship's own share of the global `GameStats`.
// `Simulation.trackProgress` adds the growth of the global stats since the last step to the active
// record, so no other system has to know about ships; deaths are counted in `applyDeath`.
import { RESOURCE_IDS } from '../../data/resources';
import type { GameStats } from '../Simulation';
import type { ShipLog } from './types';

/** The global stats the log follows, as they were at the last update. */
export interface LogMark {
  distance: number;
  kills: number;
  mined: number;
}

const minedTotal = (stats: GameStats): number => RESOURCE_IDS.reduce((sum, r) => sum + stats.mined[r], 0);

export const logMark = (stats: GameStats): LogMark => ({ distance: stats.distanceFlown, kills: stats.kills, mined: minedTotal(stats) });

/**
 * Adds what the global stats gained since `mark` to `log` and moves `mark` to the current stats (both
 * in place). Only growth is credited: the stats never shrink, a negative delta would be a foreign edit.
 */
export function advanceShipLog(log: ShipLog, mark: LogMark, stats: GameStats): void {
  const mined = minedTotal(stats);
  if (stats.distanceFlown > mark.distance) log.distance += stats.distanceFlown - mark.distance;
  if (stats.kills > mark.kills) log.kills += stats.kills - mark.kills;
  if (mined > mark.mined) log.mined += mined - mark.mined;
  mark.distance = stats.distanceFlown;
  mark.kills = stats.kills;
  mark.mined = mined;
}
