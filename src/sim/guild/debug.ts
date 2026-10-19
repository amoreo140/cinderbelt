// `debugGuild { what, lane? }` – dev builds only (the game sends it only with `import.meta.env.DEV`,
// like `debugEvent`): 'secure' = secure a lane's relay sector now (T2), 'watch' = materialise the nearest
// scheduled Watch ship (T3), 'convoy' = move the player beside the nearest convoy pass (T5). Production
// builds answer "unavailable" – checked here for every command and again in each handler (saboteur G4).
import type { GameAction } from '../commands';
import type { SimEvent, SimState } from '../Simulation';
import { debugConvoyNear } from '../convoys/link';
import { debugSecureRelay } from './relayChain';
import { debugWatchNear } from './watch';

export const isGuildAction = (a: GameAction): boolean => a.type === 'debugGuild';

export function guildAction(state: SimState, action: GameAction): SimEvent[] {
  if (!import.meta.env.DEV) return [{ type: 'actionResult', reqId: action.reqId, ok: false, reason: 'serviceUnavailable' }];
  if (action.type === 'debugGuild' && action.what === 'secure') return debugSecureRelay(state, action);
  if (action.type === 'debugGuild' && action.what === 'watch') return debugWatchNear(state, action);
  if (action.type === 'debugGuild' && action.what === 'convoy') return debugConvoyNear(state, action);
  return [{ type: 'actionResult', reqId: action.reqId, ok: false, reason: 'serviceUnavailable' }];
}
