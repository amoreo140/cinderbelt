// Station actions (spec M2, 7.1). Every action is atomic: everything is checked first, then the state
// changes at once – a failed action changes nothing.
import {
  emergencyFuelTarget,
  FUEL_PER_ICE,
  purchaseCost,
  resourcePrice,
} from '../../data/economy';
import { cargoUsed } from '../../data/resources';
import type { GameAction } from '../commands';
import type { SimEvent, SimState } from '../Simulation';
import { shipyardCommit } from '../shipyard/commit';
import type { StationDef } from '../world/stations';
import { undockPose } from './dock';
import { buyPart, craft, sellPart } from './partActions';
import { debugDamage, repair } from './repair';
import { ensureStorage, RES_EPS as EPS, stationStorage, take } from './storage';
import { demandSale, recordDemand, stationFuelPrice } from '../sector/market';
import { shipSaleValue } from '../ship/workshop';

export { stationStorage } from './storage';

export type ActionError =
  | 'notDocked'
  | 'serviceUnavailable'
  | 'invalidQuantity'
  | 'notEnoughCredits'
  | 'notEnoughResources'
  | 'cargoFull'
  | 'tankFull'
  /** The emergency ration is not needed (fuel ≥ 25 %, or it can be had with ice or credits). */
  | 'notNeeded'
  /** Not enough pieces of the part in storage. */
  | 'notEnoughParts'
  /** The part cannot be bought at this station (T2 in ring 1) nor had otherwise. */
  | 'notAvailableHere'
  | 'nothingToRepair'
  /** The ship design is invalid (the error in `detail`). */
  | 'invalidDesign'
  /** The ship or the storage changed between the preview and the design commit. */
  | 'staleDraft'
  /** An unknown part key (a corrupt command) – the action is refused instead of throwing (M16). */
  | 'unknownPart'
  // --- career (M3.5a) ---
  /** The slip is no longer on the board / the contract does not exist. */
  | 'contractUnavailable'
  /** At most 3 active contracts. */
  | 'tooManyContracts'
  /** The contract's goals are not met yet. */
  | 'contractNotReady'
  /** A Delivery is handed in at the destination. */
  | 'notAtDestination'
  /** The service needs a higher reputation (courier: Guild 2). */
  | 'serviceLocked'
  | 'sameStation'
  | 'unknownStation'
  | 'tooManyShipments'
  // --- discoveries (M3.5b) ---
  /** The part or variant is unlocked by the Archive or a blueprint. */
  | 'partLocked'
  /** The Archive node cannot be bought now (bought already, hidden, missing the licence or a predecessor, comes later). */
  | 'archiveLocked'
  | 'notEnoughData'
  // --- Cartography (sectors stage 2, sim/charts/charts.ts) ---
  | 'chartUnavailable'
  | 'chartNotCharted'
  | 'chartAlreadyCharted'
  | 'chartSold'
  | 'chartReserved'
  // --- Hangar, fleet and templates (M4a, sim/fleet, sim/templates) ---
  /** No free hangar slot at this station for the ship that would be parked. */
  | 'noSlot'
  /** All slots the game allows are bought (2, or 4 with the Archive node "Hangar +2"). */
  | 'slotCap'
  /** The stored ship stands at another station. */
  | 'shipNotHere'
  /** No ship with this id (active or stored). */
  | 'unknownShip'
  /** All template slots are full, or the Archive has not unlocked templates yet. */
  | 'templateCap'
  /** Template parts are not a valid design, or the template index does not exist. */
  | 'invalidTemplate'
  /** The name is empty, too long or not a string after sanitising (sanitizeName). */
  | 'invalidName'
  /** Not available during the Guild Training (until it is done or skipped). */
  | 'trainingActive'
  // --- World sites (M4b, sim/sites/actions.ts) ---
  /** The derelict's dock clamp works only with all its relays powered. */
  | 'relaysUnpowered'
  /** The action needs the ship berthed at that derelict. */
  | 'notBerthed'
  /** The ship's part hold has no room for the item. */
  | 'holdFull'
  /** This terminal item was taken already. */
  | 'itemTaken'
  /** The ship's cargo lacks the materials for the free fabrication. */
  | 'noMaterials'
  // --- Home station (M4c, sim/home) ---
  /** The action needs the ship docked at the home station. */
  | 'notHome'
  /** The home module is built already. */
  | 'moduleOwned'
  /** The home module cannot be built (it comes with a later milestone, or an unknown id). */
  | 'moduleUnavailable'
  /** Painting needs the paint shop at home. */
  | 'noPaintShop'
  /** The ship to paint is neither docked nor stored at the home station. */
  | 'shipNotHome'
  /** The ship already has this paint. */
  | 'samePaint'
  /** Pinning trophies needs the trophy hall. */
  | 'noTrophyHall'
  /** All pedestals hold a pinned trophy. */
  | 'shelfFull'
  /** No such trophy in this game. */
  | 'unknownTrophy'
  // --- Convoy trade and map notes (M4d, sim/convoys/trade.ts, sim/navigation/notes.ts) ---
  /** The action needs the ship linked to a convoy trader. */
  | 'notLinked'
  /** This rare item of the convoy pass was bought already. */
  | 'slotSold'
  /** The convoy buys no more cargo this pass (CONVOY.buyCap), or sells no more fuel (CONVOY.fuelCap). */
  | 'convoyCapReached'
  /** The convoy has no tanker (no fuel to sell). */
  | 'noTanker'
  /** Map notes need the Archive node "Map markers". */
  | 'noMapNotes'
  /** All note slots are used (NOTES.max). */
  | 'notesFull'
  /** No note with this id. */
  | 'unknownNote'
  /** The note is invalid: empty or too long text, an unknown icon, a non-finite position. */
  | 'invalidNote';

export type CreditReason = 'sell' | 'buy' | 'refuel' | 'tow' | 'craft' | 'shipyard' | 'repair' | 'contract' | 'courier' | 'archive' | 'discovery' | 'toll' | 'bounty' | 'chart' | 'hangar' | 'homeModule';

const ok = (reqId: number): SimEvent => ({ type: 'actionResult', reqId, ok: true });
const fail = (reqId: number, reason: ActionError): SimEvent[] => [{ type: 'actionResult', reqId, ok: false, reason }];
const credits = (delta: number, reason: CreditReason): SimEvent[] =>
  delta !== 0 ? [{ type: 'creditsChanged', delta, reason }] : [];

/** The requested quantity (all / a number) of what is available, or null for an invalid quantity. */
function quantity(qty: number | 'all', available: number): number | null {
  if (qty === 'all') return available > EPS ? available : null;
  if (!Number.isFinite(qty) || qty <= 0 || qty > available + EPS) return null;
  return Math.min(qty, available);
}

/** How much fuel can still be had with ice (storage + ship) and credits. */
function obtainableFuel(state: SimState, station: StationDef): number {
  const ice = stationStorage(state, station.id).resources.ice + state.player.cargo.ice;
  return ice * FUEL_PER_ICE + state.credits / stationFuelPrice(state, station);
}

/** The emergency ration: fuel below 25 % and neither ice nor credits reach 25 % (the game must not get stuck). */
export function emergencyFuelAvailable(state: SimState, station: StationDef): boolean {
  const target = emergencyFuelTarget(state.player.props.fuelCapacity);
  const missing = target - state.player.fuel;
  return missing > EPS && obtainableFuel(state, station) < missing;
}

/** Runs an action on the docked ship (the caller checks the `docked` state). */
export function applyAction(state: SimState, station: StationDef, action: GameAction): SimEvent[] {
  const { reqId } = action;
  switch (action.type) {
    case 'undock':
      return undock(state, station, reqId);
    case 'sellResource': {
      if (!station.services.market) return fail(reqId, 'serviceUnavailable');
      const source = action.from === 'ship' ? state.player.cargo : stationStorage(state, station.id).resources;
      const amount = quantity(action.qty, source[action.resource]);
      if (amount === null) return fail(reqId, 'invalidQuantity');
      // demand from the sector state: a premium up to the cap (M3.5a)
      const unitSell = resourcePrice(action.resource, station.ring, station.priceJitter[action.resource]).sell;
      const sale = demandSale(state, station, action.resource, amount, unitSell);
      const { demand } = sale;
      // refined ore (M4c) on the ship sells first, with its bonus (never stacked with the demand bonus)
      const refined = action.from === 'ship' ? state.player.refined : null;
      const value = refined && refined[action.resource] > 0 ? shipSaleValue(action.resource, amount, refined[action.resource], demand, unitSell) : sale.value;
      if (refined) refined[action.resource] = Math.max(0, refined[action.resource] - amount);
      if (action.qty === 'all') source[action.resource] = 0;
      else take(source, action.resource, amount);
      state.credits += value;
      recordDemand(state, station, demand);
      return [ok(reqId), ...credits(value, 'sell')];
    }
    case 'buyResource': {
      if (!station.services.market) return fail(reqId, 'serviceUnavailable');
      if (!Number.isInteger(action.qty) || action.qty <= 0) return fail(reqId, 'invalidQuantity');
      const cost = purchaseCost(action.qty, resourcePrice(action.resource, station.ring, station.priceJitter[action.resource]).buy);
      if (cost > state.credits) return fail(reqId, 'notEnoughCredits');
      state.credits -= cost;
      ensureStorage(state, station.id).resources[action.resource] += action.qty;
      return [ok(reqId), ...credits(-cost, 'buy')];
    }
    case 'transfer':
      return transfer(state, station, action, reqId);
    case 'refuel':
      return refuel(state, station, action, reqId);
    case 'buyPart':
      return buyPart(state, station, action.key, action.count, reqId);
    case 'sellPart':
      return sellPart(state, station, action.key, action.count, reqId);
    case 'craft':
      return craft(state, station, action.key, action.count, reqId);
    case 'shipyardCommit':
      return shipyardCommit(state, station, action);
    case 'repair':
      return repair(state, station, action.partIds, action.autoBuy, reqId);
    case 'debugDamage':
      return debugDamage(state, action.partId, action.hp, reqId);
    default:
      // career actions are handled by sim/career (Simulation does not send them here)
      return fail(reqId, 'serviceUnavailable');
  }
}

function undock(state: SimState, station: StationDef, reqId: number): SimEvent[] {
  const player = state.player;
  const pose = undockPose(station, player.props.boundingRadius);
  player.dock = { mode: 'flying' };
  player.body = pose;
  player.prevBody = pose;
  player.dampers = true;
  return [ok(reqId), { type: 'undocked', stationId: station.id }];
}

function transfer(
  state: SimState,
  station: StationDef,
  action: Extract<GameAction, { type: 'transfer' }>,
  reqId: number,
): SimEvent[] {
  const cargo = state.player.cargo;
  const { resource } = action;
  if (action.to === 'storage') {
    const amount = quantity(action.qty, cargo[resource]);
    if (amount === null) return fail(reqId, 'invalidQuantity');
    ensureStorage(state, station.id).resources[resource] += amount;
    if (action.qty === 'all') cargo[resource] = 0;
    else take(cargo, resource, amount);
    return [ok(reqId)];
  }
  const stored = stationStorage(state, station.id).resources[resource];
  const requested = quantity(action.qty, stored);
  if (requested === null) return fail(reqId, 'invalidQuantity');
  const free = state.player.props.cargoCapacity - cargoUsed(cargo);
  if (free <= EPS) return fail(reqId, 'cargoFull');
  // only as much as fits is loaded
  const amount = Math.min(requested, free);
  take(ensureStorage(state, station.id).resources, resource, amount);
  cargo[resource] += amount;
  return [ok(reqId)];
}

function refuel(
  state: SimState,
  station: StationDef,
  action: Extract<GameAction, { type: 'refuel' }>,
  reqId: number,
): SimEvent[] {
  if (!station.services.refuel) return fail(reqId, 'serviceUnavailable');
  const player = state.player;
  const capacity = player.props.fuelCapacity;

  if (action.source === 'emergency') {
    if (!emergencyFuelAvailable(state, station)) return fail(reqId, 'notNeeded');
    player.fuel = emergencyFuelTarget(capacity);
    return [ok(reqId)];
  }

  const missing = capacity - player.fuel;
  if (missing <= EPS) return fail(reqId, 'tankFull');
  if (action.amount !== 'full' && (!Number.isFinite(action.amount) || action.amount <= 0)) {
    return fail(reqId, 'invalidQuantity');
  }
  const amount = action.amount === 'full' ? missing : Math.min(action.amount, missing);

  if (action.source === 'ice') {
    const storage = stationStorage(state, station.id).resources;
    const available = storage.ice + player.cargo.ice;
    if (available <= EPS) return fail(reqId, 'notEnoughResources');
    // ice from storage first, then from the cargo
    const ice = Math.min(amount / FUEL_PER_ICE, available);
    const fromStorage = Math.min(ice, storage.ice);
    if (fromStorage > 0) take(ensureStorage(state, station.id).resources, 'ice', fromStorage);
    take(player.cargo, 'ice', ice - fromStorage);
    player.fuel = Math.min(capacity, player.fuel + ice * FUEL_PER_ICE);
    return [ok(reqId)];
  }

  const cost = purchaseCost(amount, stationFuelPrice(state, station));
  if (cost > state.credits) return fail(reqId, 'notEnoughCredits');
  state.credits -= cost;
  player.fuel = Math.min(capacity, player.fuel + amount);
  return [ok(reqId), ...credits(-cost, 'refuel')];
}
