// "New ship" (M4a plan §2): the active ship goes into a free slot here and a new ship – a cockpit
// alone – becomes active. The cockpit comes from this station's storage, or is bought / crafted at the
// shipyard's prices: the quote runs the shipyard's own evaluation (`evaluateDesign`) of placing that
// cockpit, so prices, Archive locks, the parts market and crafting rules are never duplicated. The new
// ship pays no install fee (nothing is mounted onto a hull) – a storage cockpit is free.
import { isPartKey, parsePartKey, type PartKey } from '../../data/parts';
import { emptyCargo, type Cargo } from '../../data/resources';
import type { SimEvent, SimState } from '../Simulation';
import type { ShipGrid } from '../ship/types';
import { evaluateDesign, shipyardContext } from '../shipyard/design';
import type { AcquireMode } from '../shipyard/draft';
import type { ActionError } from '../station/actions';
import { addParts, ensureStorage, stationStorage, takeResources } from '../station/storage';
import type { StationDef } from '../world/stations';
import { emptyShipLog, freeSlotsAt } from './state';
import { generatedNameIndex } from './names';
import { planLeave, swapActiveShip } from './swap';

/** The price of a new ship's cockpit here (credits and crafting materials). */
export interface CockpitQuote {
  /** Credits: the buy price or the crafting fee (0 from storage). */
  credits: number;
  /** Crafting materials (taken from this station's storage first, then the cargo). */
  resources: Partial<Cargo>;
}

/** The new ship's hull: the cockpit alone at the origin, facing forward. */
export function cockpitGrid(key: PartKey): ShipGrid {
  const { partId, tier, variant } = parsePartKey(key);
  return { nextId: 2, parts: [{ id: 1, partId, tier, x: 0, y: 0, rot: 0, ...(variant ? { variant } : {}) }] };
}

/**
 * What the cockpit `key` costs here: from storage (`acquire` omitted) or bought / crafted. An error
 * when it cannot be had: not a cockpit, none in storage, locked or not sold here, not enough
 * credits or materials.
 */
export function cockpitQuote(state: SimState, station: StationDef, key: unknown, acquire?: AcquireMode): CockpitQuote | ActionError {
  if (!isPartKey(key)) return 'unknownPart';
  if (parsePartKey(key).partId !== 'cockpit') return 'invalidDesign';
  if (acquire === undefined) return (stationStorage(state, station.id).parts[key] ?? 0) > 0 ? { credits: 0, resources: {} } : 'notEnoughParts';
  if (acquire !== 'buy' && acquire !== 'craft') return 'invalidDesign';
  // an explicit buy / craft never takes the storage copy (the player chose to pay)
  const empty: ShipGrid = { nextId: 1, parts: [] };
  const report = evaluateDesign(
    { base: { grid: empty, hp: new Map(), inventory: {} }, grid: cockpitGrid(key), acquire: { [key]: acquire } },
    shipyardContext(state, station),
  );
  const { cost } = report;
  if (Object.keys(cost.missing).length > 0) return 'notAvailableHere';
  if (report.errors.some((e) => e.code === 'missingResources')) return 'notEnoughResources';
  const credits = cost.buyCredits + cost.craftCredits;
  if (credits > state.credits) return 'notEnoughCredits';
  return { credits, resources: cost.resources };
}

/** Why the active ship cannot be left here for a new one: no free slot (a dissolved ship needs none). */
export function newShipSlotError(state: SimState, station: StationDef): ActionError | null {
  if (planLeave(state, station).kind === 'dissolve') return null;
  return freeSlotsAt(state.fleet, station.id) > 0 ? null : 'noSlot';
}

export function newShip(state: SimState, station: StationDef, reqId: number, key: PartKey, acquire: AcquireMode | undefined): SimEvent[] {
  const fail = (reason: ActionError): SimEvent[] => [{ type: 'actionResult', reqId, ok: false, reason }];
  const slotError = newShipSlotError(state, station);
  if (slotError) return fail(slotError);
  const quote = cockpitQuote(state, station, key, acquire);
  if (typeof quote === 'string') return fail(quote);

  // --- apply (everything checked): pay for the cockpit, then swap ---
  const storage = ensureStorage(state, station.id);
  if (acquire === undefined) addParts(storage.parts, key, -1);
  state.credits -= quote.credits;
  takeResources(state, station.id, quote.resources);

  const { fleet } = state;
  const id = fleet.nextShipId++;
  const taken = new Set([fleet.active.nameIdx, ...fleet.stored.map((s) => s.record.nameIdx)]);
  const grid = cockpitGrid(key);
  const swap = swapActiveShip(state, station, {
    record: { id, name: null, nameIdx: generatedNameIndex(state.seed, id, taken), log: { ...emptyShipLog(), built: state.tick } },
    grid,
    blueprint: grid,
    hp: new Map(),
    fuel: 0,
    cargo: emptyCargo(),
  });
  const paid = quote.credits + swap.fee;
  const events: SimEvent[] = [
    { type: 'actionResult', reqId, ok: true },
    ...swap.events,
    { type: 'shipCreated', stationId: station.id, shipId: id, parked: swap.parked, loanReturned: swap.loanReturned },
  ];
  if (paid > 0) events.push({ type: 'creditsChanged', delta: -paid, reason: 'hangar' });
  return events;
}
