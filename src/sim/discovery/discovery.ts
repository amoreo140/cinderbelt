// The discovery step (M3.5b) after the combat step: the scanner (Tab), anomalies, discovering places
// within radar range, POI (and M4b graveyard) wrecks, distress signals, ion storms (`stormAt`, M4b) and
// the Atlas. Station action: buying an Archive node.
import { SCANNER } from '../../data/scanner';
import type { GameAction, PlayerCommand } from '../commands';
import type { SimEvent, SimState } from '../Simulation';
import { buyArchiveNode } from './archive';
import { checkAtlas } from './atlas';
import { stepAnomalies } from './anomalies';
import { stormAt } from '../events/storms';
import { manageSiteWrecks } from '../sites/graveyard';
import { stepDistress } from './interact';
import { discoverNearby, stepScanner } from './scanner';
import { managePoiWrecks } from './wrecks';

/** Events after which the Atlas is worth checking. */
const ATLAS_EVENTS = new Set<SimEvent['type']>(['analysisDone', 'fragmentFound', 'archiveBought', 'captainDefeated']);

export function stepDiscovery(state: SimState, cmd: PlayerCommand, events: SimEvent[]): void {
  const start = events.length;
  const d = state.discovery;
  stepScanner(state, cmd.scan ?? false, cmd.aim, events);
  stepAnomalies(state, events);
  if (state.tick % SCANNER.discoverInterval === 0) {
    managePoiWrecks(state);
    // graveyard wrecks (M4b) beside the POI wrecks
    manageSiteWrecks(state);
    const flying = state.player.dock.mode === 'flying' && !state.player.destroyed;
    if (flying) {
      discoverNearby(state, events);
      stepDistress(state, events);
    }
    // analysed pirate wrecks that are gone need not be kept
    for (const key of [...d.scanned]) {
      if (key.startsWith('wreck#') && !state.combat.wrecks.some((w) => `wreck#${w.id}` === key)) d.scanned.delete(key);
    }
  }
  // ion storm (an area storm or a derelict's local storm): the shield drops (radar ×0.5 is in the radar range)
  if (state.player.dock.mode === 'flying') {
    const pos = state.player.body.pos;
    const storm = stormAt(state, pos, state.tick);
    if (storm) state.player.shield = 0;
    if (storm !== stormAt(state, state.player.prevBody.pos, state.tick - 1)) events.push({ type: 'ionStorm', active: storm });
  }
  for (let i = start; i < events.length; i++) {
    if (ATLAS_EVENTS.has(events[i]!.type)) {
      checkAtlas(state, events);
      break;
    }
  }
}

const DISCOVERY_ACTIONS = new Set<GameAction['type']>(['archiveBuy']);
export const isDiscoveryAction = (a: GameAction): boolean => DISCOVERY_ACTIONS.has(a.type);

/** A discovery action (when docked). */
export function discoveryAction(state: SimState, action: GameAction): SimEvent[] {
  if (action.type !== 'archiveBuy') return [{ type: 'actionResult', reqId: action.reqId, ok: false, reason: 'serviceUnavailable' }];
  if (state.player.dock.mode !== 'docked') return [{ type: 'actionResult', reqId: action.reqId, ok: false, reason: 'notDocked' }];
  const events: SimEvent[] = [];
  const error = buyArchiveNode(state, action.node, events);
  if (error) return [{ type: 'actionResult', reqId: action.reqId, ok: false, reason: error }];
  checkAtlas(state, events);
  return [{ type: 'actionResult', reqId: action.reqId, ok: true }, ...events];
}
