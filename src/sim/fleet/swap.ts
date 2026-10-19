// Switching the active ship (M4a plan §2 "What a switch does to the state"): `swapActiveShip` parks
// (or dissolves) the active ship at this station and makes another ship active – a stored one
// (`hangarSwitch`) or a new cockpit-only ship (`hangarNewShip`). One function, so a switch and a new
// ship can never treat the ship left behind differently.
//
// Value is never created or destroyed: the parked ship keeps its parts, HP, fuel, cargo, blueprint and
// record. Only the Guild's loan parts leave it (they go back to the Guild – loans never enter the
// hangar); owned parts held on only by a loan part, and a ship without a cockpit of its own (the Hard
// respawn hull) are taken off by the shipyard's removal rules into this station's storage.
import { partKey, type PartInventory, type PartKey } from '../../data/parts';
import { emptyCargo, RESOURCE_IDS, type Cargo } from '../../data/resources';
import { mergeInventory } from '../combat/combat';
import { recordShipCapability } from '../contracts/board';
import type { SimEvent, SimState } from '../Simulation';
import { connectedToCockpit } from '../ship/grid';
import { isLoanPart } from '../ship/loan';
import { clampRefined, idleWorkshop } from '../ship/workshop';
import { computeProperties } from '../ship/properties';
import type { HpMap, PlacedPart, ShipGrid } from '../ship/types';
import { cargoOverflowMoves, evaluateDesign, shipyardContext, type DesignCost } from '../shipyard/design';
import { dockPose } from '../station/dock';
import { addParts, ensureStorage, stationStorage, take, takeResources } from '../station/storage';
import type { StationDef } from '../world/stations';
import type { ShipId, StoredShip } from './types';

/** A ship about to become active: a stored ship, or a new cockpit-only ship. */
export type IncomingShip = Omit<StoredShip, 'stationId'>;

/** What leaving the active ship at a station does (pure, no state change). */
export interface LeavePlan {
  /** park = it stands in a slot here; dissolve = it has no cockpit of its own (a Guild loan hull). */
  kind: 'park' | 'dissolve';
  /** Guild loan parts taken off the hull – back to the Guild. */
  returned: PartInventory;
  /** The hull that is parked: the owned parts connected to its own cockpit (empty on dissolve). */
  kept: ShipGrid;
  /**
   * The other owned parts (held on only by a loan part, or every owned part of a dissolved ship) taken
   * off by the shipyard's removal rules: repaired into storage for a fee, or scrapped. Null = nothing.
   */
  removal: DesignCost | null;
}

const keyOf = (p: PlacedPart): PartKey => partKey(p.partId, p.tier, p.variant);

/** How the active ship would leave if the player switched away from it here. */
export function planLeave(state: SimState, station: StationDef): LeavePlan {
  const { player } = state;
  const grid = player.grid;
  const returned: PartInventory = {};
  for (const p of grid.parts) if (isLoanPart(p)) addParts(returned, keyOf(p), 1);
  const owned = grid.parts.filter((p) => !isLoanPart(p));
  const cockpit = owned.some((p) => p.partId === 'cockpit');
  const connected = cockpit ? connectedToCockpit({ nextId: grid.nextId, parts: owned }) : new Set<number>();
  const keptParts = owned.filter((p) => connected.has(p.id));
  const kept: ShipGrid = keptParts.length === grid.parts.length ? grid : { nextId: grid.nextId, parts: keptParts };
  let removal: DesignCost | null = null;
  if (keptParts.length < owned.length) {
    const inventory = stationStorage(state, station.id).parts;
    removal = evaluateDesign({ base: { grid, hp: player.hp, inventory }, grid: kept, acquire: {} }, shipyardContext(state, station)).cost;
  }
  return { kind: cockpit ? 'park' : 'dissolve', returned, kept, removal };
}

/** Does leaving the active ship return Guild loan parts, or dissolve it? (UI note before confirming.) */
export function leaveNote(state: SimState, station: StationDef): 'returned' | 'dissolved' | null {
  const plan = planLeave(state, station);
  if (plan.kind === 'dissolve') return 'dissolved';
  return Object.keys(plan.returned).length > 0 ? 'returned' : null;
}

export interface SwapResult {
  /** The old active ship, now stored here; null when it was dissolved. */
  parked: ShipId | null;
  /** Guild loan parts taken off the old ship. */
  loanReturned: PartInventory;
  /** Credits paid for repairing removed owned parts into storage (0 almost always). */
  fee: number;
  /** `shipDissolved` when the old ship was dissolved (comes before the caller's main event). */
  events: SimEvent[];
}

const nonZero = (cargo: Cargo): Partial<Cargo> => {
  const out: Partial<Cargo> = {};
  for (const r of RESOURCE_IDS) if (cargo[r] > 0) out[r] = cargo[r];
  return out;
};

const hasRefined = (refined: Cargo): boolean => RESOURCE_IDS.some((r) => refined[r] > 0);

/** The blueprint without loan flags (a stored ship holds no Guild property; same object when clean). */
const withoutLoans = (grid: ShipGrid): ShipGrid =>
  grid.parts.some(isLoanPart) ? { nextId: grid.nextId, parts: grid.parts.map(ownedCopy) } : grid;

function ownedCopy(p: PlacedPart): PlacedPart {
  const { loan, ...rest } = p;
  void loan;
  return rest;
}

/** Keeps the stored ships sorted by id. */
const byId = (a: StoredShip, b: StoredShip): number => a.record.id - b.record.id;

/**
 * Parks (or dissolves) the active ship at `station` and activates `incoming`. The caller has checked
 * everything (docked here, a shipyard, a free slot unless the old ship dissolves, `incoming` stands
 * here) – this never fails. When `incoming` is a stored ship it is taken out of the hangar.
 */
export function swapActiveShip(state: SimState, station: StationDef, incoming: IncomingShip): SwapResult {
  const { player, fleet } = state;
  const storage = ensureStorage(state, station.id);
  // salvage on board goes to storage first (as on docking – normally already empty in the dock)
  mergeInventory(storage.parts, player.salvage);
  player.salvage = {};

  const plan = planLeave(state, station);
  const fee = plan.removal?.repairCredits ?? 0;
  if (plan.removal) {
    state.credits -= fee;
    takeResources(state, station.id, plan.removal.resources);
    mergeInventory(storage.parts, plan.removal.toStorage);
    for (const r of RESOURCE_IDS) storage.resources[r] += plan.removal.scrap[r] ?? 0;
  }

  const outgoing = fleet.active;
  const events: SimEvent[] = [];
  let parked: ShipId | null = null;
  if (plan.kind === 'park') {
    const changed = plan.kept !== player.grid;
    const ids = new Set(plan.kept.parts.map((p) => p.id));
    const hp: HpMap = changed ? new Map([...player.hp].filter(([id]) => ids.has(id))) : player.hp;
    const props = changed ? computeProperties(plan.kept) : player.props;
    const cargo = player.cargo;
    // a hull that lost a loan part may hold less: the rest goes to storage like after a rebuild
    const overflow = cargoOverflowMoves(cargo, props.cargoCapacity);
    for (const r of RESOURCE_IDS) {
      const amount = overflow[r] ?? 0;
      if (amount <= 0) continue;
      take(cargo, r, amount);
      storage.resources[r] += amount;
    }
    // refined ore (M4c) stays on the ship: what the overflow took went raw first
    const refined = { ...player.refined };
    clampRefined(cargo, refined);
    fleet.stored.push({
      record: outgoing,
      stationId: station.id,
      grid: plan.kept,
      blueprint: withoutLoans(player.blueprint),
      hp,
      fuel: Math.min(player.fuel, props.fuelCapacity),
      cargo,
      ...(hasRefined(refined) ? { refined } : {}),
    });
    parked = outgoing.id;
  } else {
    const cargo = nonZero(player.cargo);
    for (const r of RESOURCE_IDS) storage.resources[r] += player.cargo[r];
    events.push({
      type: 'shipDissolved',
      stationId: station.id,
      shipId: outgoing.id,
      parts: { ...(plan.removal?.toStorage ?? {}) },
      cargo,
      loanReturned: plan.returned,
    });
  }
  fleet.stored = fleet.stored.filter((s) => s.record.id !== incoming.record.id).sort(byId);
  fleet.active = incoming.record;

  // the incoming ship starts cold: full battery and shield, no heat, cooldowns or tractor
  const props = computeProperties(incoming.grid);
  player.grid = incoming.grid;
  player.blueprint = incoming.blueprint;
  player.hp = incoming.hp;
  player.cargo = incoming.cargo;
  player.refined = incoming.refined ? { ...incoming.refined } : emptyCargo();
  clampRefined(player.cargo, player.refined);
  // the repair bank belonged to the old ship's parts; the workshop starts idle
  player.repair = null;
  player.workshop = idleWorkshop();
  player.fuel = Math.min(incoming.fuel, props.fuelCapacity);
  player.props = props;
  player.gridVersion++;
  player.energy = props.batteryCapacity;
  player.shield = props.shield.capacity;
  player.shieldDelay = 0;
  player.cooldowns = new Map();
  player.heat = new Map();
  player.tractor = null;
  player.beams = [];
  player.lastLocalForce = { x: 0, y: 0 };
  player.dampers = true;
  player.body = dockPose(station, props.boundingRadius);
  player.prevBody = player.body;
  state.respawn = { stationId: station.id, grid: player.grid };
  // contract quotes keep using the best ship the player ever had (saboteur report X2)
  recordShipCapability(state);
  return { parked, loanReturned: plan.returned, fee, events };
}
