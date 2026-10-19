// The public surface of the home station (M4c Home and Workshop plan,
// home station section, T0). Every function lives in the file of the task that fills it and is re-exported here, so
// this file never changes after T0:
//
//   state.ts     T0   createHome
//   modules.ts   T1   homeBuild, homeColliders, forgeIndex, stepHome
//   paint.ts     T1   paintShip
//   trophies.ts  T1   trophiesOf, trophyShelf, trophyPin
//
// Hooks in hot files (T0): Simulation.ts (`SimState.home`, `RestoredState.home?`, home actions routed
// here, `stepHome` in the step, `homeColliders` → `World.setStationExtraColliders` on restore).
import type { GameAction } from '../commands';
import type { SimEvent, SimState } from '../Simulation';
import type { ActionError } from '../station/actions';
import { homeBuild } from './modules';
import { paintShip } from './paint';
import { trophyPin } from './trophies';

export { createHome } from './state';
export { forgeIndex, homeColliders, stepHome } from './modules';
export { trophiesOf, trophyShelf } from './trophies';
export type { HomeEvent, HomeState, TrophyId, TrophyItem } from './types';

const HOME_ACTIONS = new Set<GameAction['type']>(['homeBuild', 'paintShip', 'trophyPin']);
export const isHomeAction = (a: GameAction): boolean => HOME_ACTIONS.has(a.type);

/** Runs a home action atomically: a refused action changes nothing and answers with its error. */
export function homeAction(state: SimState, action: GameAction): SimEvent[] {
  const { reqId } = action;
  const events: SimEvent[] = [];
  let error: ActionError | null;
  switch (action.type) {
    case 'homeBuild':
      error = homeBuild(state, action.module, events);
      break;
    case 'paintShip':
      error = paintShip(state, action.shipId, action.paint, events);
      break;
    case 'trophyPin':
      error = trophyPin(state, action.id, action.pinned, events);
      break;
    default:
      error = 'serviceUnavailable';
  }
  if (error) return [{ type: 'actionResult', reqId, ok: false, reason: error }];
  return [{ type: 'actionResult', reqId, ok: true }, ...events];
}
