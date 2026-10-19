// Hangar and fleet actions (M4a, plan §2): buy a slot, switch ships, start a new ship,
// rename, dismantle. Atomic like every station action – everything is checked first, a refused action
// changes nothing.
import type { GameAction, GameActionType } from '../commands';
import type { SimEvent, SimState } from '../Simulation';
import type { ActionError } from '../station/actions';
import { trainingActive } from '../training/training';
import type { StationDef } from '../world/stations';
import { dismantle } from './dismantle';
import { sanitizeName } from './names';
import { newShip } from './newShip';
import { buySlot } from './slots';
import { swapActiveShip } from './swap';
import type { ShipRecord, StoredShip } from './types';

export type FleetActionType = 'hangarBuySlot' | 'hangarSwitch' | 'hangarNewShip' | 'hangarRename' | 'hangarDismantle';
export type FleetAction = Extract<GameAction, { type: FleetActionType }>;

const FLEET_ACTIONS = new Set<GameActionType>(['hangarBuySlot', 'hangarSwitch', 'hangarNewShip', 'hangarRename', 'hangarDismantle']);
export const isFleetAction = (a: GameAction): a is FleetAction => FLEET_ACTIONS.has(a.type);

/**
 * Why the hangar cannot be used now (null = it can): the ship is destroyed, not docked (or still
 * latching), the station has no shipyard, or the Guild Training is running. Shared with the view models.
 */
export function hangarError(state: SimState, at: StationDef | null): ActionError | null {
  if (state.player.destroyed) return 'serviceUnavailable';
  if (!at) return 'notDocked';
  if (!at.services.shipyard) return 'serviceUnavailable';
  if (trainingActive(state)) return 'trainingActive';
  return null;
}

/** The active or a stored ship's record by id. */
export function shipRecord(state: SimState, shipId: unknown): ShipRecord | null {
  const { fleet } = state;
  if (fleet.active.id === shipId) return fleet.active;
  return fleet.stored.find((s) => s.record.id === shipId)?.record ?? null;
}

/** A stored ship by id. */
export const storedShip = (state: SimState, shipId: unknown): StoredShip | null => state.fleet.stored.find((s) => s.record.id === shipId) ?? null;

/** Why the stored ship `shipId` cannot be switched to / dismantled at `at` (hangar guards aside). */
export function storedHereError(state: SimState, at: StationDef, shipId: unknown): ActionError | null {
  const ship = storedShip(state, shipId);
  if (!ship) return 'unknownShip';
  return ship.stationId === at.id ? null : 'shipNotHere';
}

const fail = (reqId: number, reason: ActionError): SimEvent[] => [{ type: 'actionResult', reqId, ok: false, reason }];

/**
 * Runs a fleet action. `at` = the station the player is docked at (null in flight or while docking);
 * the action checks docking, the shipyard service, the Training and `player.destroyed` itself
 * (`hangarRename` works anywhere).
 */
export function fleetAction(state: SimState, at: StationDef | null, action: FleetAction): SimEvent[] {
  const { reqId } = action;
  if (action.type === 'hangarRename') return rename(state, action);
  const guard = hangarError(state, at);
  if (guard) return fail(reqId, guard);
  const station = at!;
  switch (action.type) {
    case 'hangarBuySlot':
      return buySlot(state, station, reqId);
    case 'hangarSwitch': {
      const error = storedHereError(state, station, action.shipId);
      if (error) return fail(reqId, error);
      const ship = storedShip(state, action.shipId)!;
      const from = state.fleet.active.id;
      const swap = swapActiveShip(state, station, ship);
      const events: SimEvent[] = [
        { type: 'actionResult', reqId, ok: true },
        ...swap.events,
        { type: 'shipSwitched', stationId: station.id, from, to: ship.record.id, loanReturned: swap.loanReturned },
      ];
      if (swap.fee > 0) events.push({ type: 'creditsChanged', delta: -swap.fee, reason: 'repair' });
      return events;
    }
    case 'hangarNewShip':
      return newShip(state, station, reqId, action.cockpit, action.acquire);
    case 'hangarDismantle': {
      const error = storedHereError(state, station, action.shipId);
      if (error) return fail(reqId, error);
      return dismantle(state, station, reqId, storedShip(state, action.shipId)!);
    }
  }
}

function rename(state: SimState, action: Extract<FleetAction, { type: 'hangarRename' }>): SimEvent[] {
  const record = shipRecord(state, action.shipId);
  if (!record) return fail(action.reqId, 'unknownShip');
  const name = action.name === null ? null : sanitizeName(action.name);
  if (action.name !== null && name === null) return fail(action.reqId, 'invalidName');
  record.name = name;
  return [
    { type: 'actionResult', reqId: action.reqId, ok: true },
    { type: 'shipRenamed', shipId: record.id, name },
  ];
}
