// Hangar view models (M4a, T4): the Hangar modal, the Shipyard header and the
// ship rows of the Storages overview, built from `SimState`. Pure: every reason comes from the same
// helpers the fleet actions use (src/sim/fleet), translated through `tx().actionErrors`.
import { ALL_PART_KEYS, parsePartKey, placedKey, type PartKey } from '../../data/parts';
import { cargoUsed, type Cargo } from '../../data/resources';
import { tx } from '../../i18n';
import type { ActionError } from '../../sim/station/actions';
import { hangarError, storedHereError } from '../../sim/fleet/actions';
import { buySlotError } from '../../sim/fleet/slots';
import { dismantleQuote } from '../../sim/fleet/dismantle';
import { shipDisplayName } from '../../sim/fleet/names';
import { cockpitGrid, cockpitQuote, newShipSlotError } from '../../sim/fleet/newShip';
import { hangarSlotCap, nextSlotPrice, paintOf, slotsAt, slotsBought, storedAt } from '../../sim/fleet/state';
import { leaveNote } from '../../sim/fleet/swap';
import type { ShipRecord, StoredShip } from '../../sim/fleet/types';
import { hullBudgetOf } from '../../sim/ship/budget';
import { currentHp, maxHp } from '../../sim/ship/hp';
import { computeProperties } from '../../sim/ship/properties';
import type { HpMap, ShipGrid } from '../../sim/ship/types';
import type { SimState } from '../../sim/Simulation';
import { evaluateDesign, shipyardContext } from '../../sim/shipyard/design';
import type { AcquireMode } from '../../sim/shipyard/draft';
import { stationStorage } from '../../sim/station/storage';
import { templateCap } from '../../sim/templates/state';
import { stationById, type StationDef, type StationId } from '../../sim/world/stations';
import { shipLogLine } from '../../ui/station/hangarFormat';
import { stationLabel } from '../board/names';
import { silhouette, type Silhouette } from '../combatView';
import { lockReason } from '../discovery/names';
import { partName } from '../shipyardView';
import type { CockpitOption, HangarView, ShipCardView, ShipHeaderView, StorageShipRow } from './types';

type ActionErrorKey = ActionError;
const reasonText = (error: ActionErrorKey | null): string | undefined => (error ? tx().actionErrors[error] : undefined);

/** A station definition by id (like `Simulation.station`: the active chunks first, then the world hash). */
export const stationDef = (state: SimState, id: StationId): StationDef | null =>
  state.world.stations().find((s) => s.id === id) ?? stationById(state.seed, id, state.world.gen);

/** The station the player is docked at (null in flight or while docking). */
export function dockedStation(state: SimState): StationDef | null {
  const dock = state.player.dock;
  return dock.mode === 'docked' ? stationDef(state, dock.stationId) : null;
}

/** The drawing of a grid with its HP (the same as the flight silhouette of a ship with that grid). */
export function gridSilhouette(grid: ShipGrid, hp: HpMap): Silhouette {
  return silhouette({ player: { grid, hp } } as Pick<SimState, 'player'>);
}

/** Class / tier label from the ship's cockpit ("Cockpit – combat T2"); empty without a cockpit. */
export function tierLabel(grid: ShipGrid): string {
  const cockpit = grid.parts.find((p) => p.partId === 'cockpit');
  return cockpit ? partName(placedKey(cockpit)) : '';
}

/** HP of all parts as a share of their max (1 for an empty grid). */
function hpShare(grid: ShipGrid, hp: HpMap): number {
  let now = 0;
  let max = 0;
  for (const p of grid.parts) {
    now += currentHp(hp, p);
    max += maxHp(p);
  }
  return max > 0 ? now / max : 1;
}

const displayName = (record: ShipRecord): string => shipDisplayName(record, tx().fleet.names);

interface ShipData {
  record: ShipRecord;
  grid: ShipGrid;
  hp: HpMap;
  fuel: number;
  cargo: Cargo;
  cargoCap: number;
  fuelCap: number;
}

function shipCard(data: ShipData, where: { stationId: StationId | null; here: boolean; active: boolean }, seed: number): ShipCardView {
  const budget = hullBudgetOf(data.grid);
  return {
    id: data.record.id,
    name: displayName(data.record),
    generated: data.record.name === null,
    active: where.active,
    stationId: where.stationId,
    stationName: where.stationId ? stationLabel(seed, where.stationId) : null,
    here: where.here,
    tierLabel: tierLabel(data.grid),
    hull: { used: budget.used, budget: budget.budget ?? 0 },
    hpPct: hpShare(data.grid, data.hp),
    cargo: { used: cargoUsed(data.cargo), cap: data.cargoCap },
    fuelPct: data.fuelCap > 0 ? Math.min(1, data.fuel / data.fuelCap) : 0,
    log: { ...data.record.log },
    grid: data.grid,
    hp: data.hp,
    silhouette: gridSilhouette(data.grid, data.hp),
    paint: paintOf(data.record),
  };
}

function storedData(ship: StoredShip): ShipData {
  const props = computeProperties(ship.grid);
  return { record: ship.record, grid: ship.grid, hp: ship.hp, fuel: ship.fuel, cargo: ship.cargo, cargoCap: props.cargoCapacity, fuelCap: props.fuelCapacity };
}

/** Number of parts in an inventory. */
const countParts = (inv: Readonly<Partial<Record<PartKey, number>>>): number => Object.values(inv).reduce<number>((s, n) => s + (n ?? 0), 0);

/** Cockpits the "New ship" action can start from here: storage copies, then buy / craft offers. */
export function cockpitOptions(state: SimState, station: StationDef): CockpitOption[] {
  const cockpits = ALL_PART_KEYS.filter((k) => parsePartKey(k).partId === 'cockpit');
  const out: CockpitOption[] = [];
  const storage = stationStorage(state, station.id).parts;
  for (const key of cockpits) if ((storage[key] ?? 0) > 0) out.push({ key, source: 'storage', price: 0 });
  const ctx = shipyardContext(state, station);
  const empty: ShipGrid = { nextId: 1, parts: [] };
  for (const key of cockpits) {
    // locked cockpits (Archive / plans) are not offered – the shipyard palette explains them
    if (lockReason(state, key) !== null) continue;
    for (const acquire of ['buy', 'craft'] as const satisfies readonly AcquireMode[]) {
      const report = evaluateDesign({ base: { grid: empty, hp: new Map(), inventory: {} }, grid: cockpitGrid(key), acquire: { [key]: acquire } }, ctx);
      // not sold / not craftable here: no option
      if (Object.keys(report.cost.missing).length > 0) continue;
      const quote = cockpitQuote(state, station, key, acquire);
      if (quote === 'notAvailableHere') continue;
      const option: CockpitOption = { key, source: acquire, price: report.cost.buyCredits + report.cost.craftCredits, acquire };
      if (typeof quote === 'string') option.reason = reasonText(quote);
      out.push(option);
    }
  }
  return out;
}

/**
 * The Hangar modal's view model at the station the player is docked at (`station`; null in flight).
 * `detail` = false skips the cockpit offers and the dismantle quotes (the hub overview row needs neither).
 */
export function hangarView(state: SimState, station: StationDef | null = dockedStation(state), detail = true): HangarView {
  const { fleet, player } = state;
  const guard = hangarError(state, station);
  const reason = reasonText(guard);
  const hereId = station?.id ?? null;
  const usable = guard === null && station !== null;

  const ships: ShipCardView[] = [];
  const props = player.props;
  const active = shipCard(
    { record: fleet.active, grid: player.grid, hp: player.hp, fuel: player.fuel, cargo: player.cargo, cargoCap: props.cargoCapacity, fuelCap: props.fuelCapacity },
    { stationId: hereId, here: hereId !== null, active: true },
    state.seed,
  );
  const note = usable ? leaveNote(state, station!) : null;
  if (note) active.loanNote = note;
  ships.push(active);

  for (const ship of fleet.stored) {
    const card = shipCard(storedData(ship), { stationId: ship.stationId, here: ship.stationId === hereId, active: false }, state.seed);
    const here = usable ? storedHereError(state, station!, ship.record.id) : null;
    const switchReason = reason ?? reasonText(here);
    if (switchReason) card.switchReason = switchReason;
    // the quote at the station the ship stands at (its repairs, its storage)
    const at = !detail ? null : card.here ? station : stationDef(state, ship.stationId);
    if (at) {
      const q = dismantleQuote(state, at, ship);
      card.dismantle = { fee: q.fee, scrap: countParts(q.scrapped) };
      const why = reason ?? reasonText(here);
      if (why) card.dismantle.reason = why;
    }
    ships.push(card);
  }

  const price = nextSlotPrice(state);
  const buyReason = reason ?? reasonText(buySlotError(state));
  const slots: HangarView['slots'] = {
    here: hereId ? slotsAt(fleet, hereId) : 0,
    usedHere: hereId ? storedAt(fleet, hereId).length : 0,
    total: slotsBought(fleet),
    cap: hangarSlotCap(state),
    nextPrice: price,
  };
  if (buyReason) slots.buyReason = buyReason;

  const newShip: HangarView['newShip'] = { cockpits: usable && detail ? cockpitOptions(state, station!) : [] };
  const newReason = reason ?? (usable ? reasonText(newShipSlotError(state, station!)) : undefined);
  if (newReason) newShip.reason = newReason;

  const view: HangarView = { stationId: hereId, slots, ships, newShip };
  if (reason) view.reason = reason;
  return view;
}

/** The Archive lock of templates ("Archive: Ship templates"). */
export const templatesLockText = (): string => tx().discovery.archive.lockedPart(tx().discovery.archive.nodes.templates);

/** The Shipyard tab header: the active ship's name, log line and the two modal buttons. */
export function shipHeaderView(state: SimState, station: StationDef | null = dockedStation(state)): ShipHeaderView {
  const record = state.fleet.active;
  const view: ShipHeaderView = {
    id: record.id,
    name: displayName(record),
    generated: record.name === null,
    log: { ...record.log },
    logLine: shipLogLine(record.log),
  };
  const hangar = reasonText(hangarError(state, station));
  if (hangar) view.hangarReason = hangar;
  if (templateCap(state) <= 0) view.templatesReason = templatesLockText();
  return view;
}

/** Ship rows of the Storages overview: the active ship first, then the stored ones by id. */
export function storageShipRows(state: SimState): StorageShipRow[] {
  const { fleet, player } = state;
  const dock = player.dock;
  const hereId = dock.mode === 'docked' ? dock.stationId : null;
  const row = (record: ShipRecord, grid: ShipGrid, stationId: StationId | null, active: boolean): StorageShipRow => ({
    id: record.id,
    name: displayName(record),
    generated: record.name === null,
    active,
    stationId,
    stationName: stationId ? stationLabel(state.seed, stationId) : null,
    here: stationId !== null && stationId === hereId,
    tierLabel: tierLabel(grid),
    hullPoints: hullBudgetOf(grid).used,
  });
  return [row(fleet.active, player.grid, hereId, true), ...fleet.stored.map((s) => row(s.record, s.grid, s.stationId, false))];
}
