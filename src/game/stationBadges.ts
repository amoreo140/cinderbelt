// Station hub: what the tab badges and the arrival card ("After docking") tell the player – pure functions
// over the simulation state (no DOM).
import { cargoUsed } from '../data/resources';
import { canTurnIn } from '../sim/career/career';
import type { SimState } from '../sim/Simulation';
import { stationStorage } from '../sim/station/storage';
import type { StationDef } from '../sim/world/stations';

/** Contracts that can be handed in at the docked station right now. */
export interface TurnInReady {
  /** Contract serials, in the order of the contract list. */
  ids: readonly number[];
  /** Sum of the rewards in credits. */
  reward: number;
}

export const NO_TURN_IN: TurnInReady = { ids: [], reward: 0 };

export function turnInReady(state: SimState, station: StationDef): TurnInReady {
  let ids: number[] | null = null;
  let reward = 0;
  for (const c of state.career.contracts) {
    if (!canTurnIn(state, station, c)) continue;
    (ids ??= []).push(c.serial);
    reward += c.reward;
  }
  return ids ? { ids, reward } : NO_TURN_IN;
}

/** Attention marks on the tabs (spec: Jobs = contracts to hand in, Market = cargo aboard, Shipyard = parts in storage). */
export interface HubBadges {
  /** Contracts ready to turn in here (0 = no badge). */
  jobs: number;
  /** The ship carries cargo and the station buys it. */
  market: boolean;
  /** The station storage holds parts and the station has a shipyard. */
  shipyard: boolean;
}

export function hubBadges(state: SimState, station: StationDef, turnIn: TurnInReady): HubBadges {
  const parts = stationStorage(state, station.id).parts;
  let stored = false;
  for (const key in parts) {
    if ((parts[key as keyof typeof parts] ?? 0) > 0) {
      stored = true;
      break;
    }
  }
  return {
    jobs: turnIn.ids.length,
    market: station.services.market && cargoUsed(state.player.cargo) >= 0.05,
    shipyard: station.services.shipyard && stored,
  };
}
