// "Scrap" (M4a plan §2): a stored ship standing here is taken apart exactly as if the player
// removed every part in the shipyard – the shipyard's removal rules (`evaluateDesign` with an empty
// draft): intact parts go to this station's storage, damaged ones are repaired into storage for the
// fee, or scrapped where the station does not repair (or the player cannot pay the repair). Its cargo
// goes to storage, its fuel is lost; the slot stays bought and becomes free.
import type { PartInventory } from '../../data/parts';
import { RESOURCE_IDS, type Cargo } from '../../data/resources';
import { mergeInventory } from '../combat/combat';
import type { SimEvent, SimState } from '../Simulation';
import { evaluateDesign, shipyardContext, type RepairLine } from '../shipyard/design';
import { ensureStorage, stationStorage, takeResources } from '../station/storage';
import type { StationDef } from '../world/stations';
import type { StoredShip } from './types';

export interface DismantleQuote {
  /** Repair fee (credits) for the damaged parts that are repaired into storage. */
  fee: number;
  /** Repair materials (from storage – the ship's cargo is already there – then the active cargo). */
  resources: Partial<Cargo>;
  repairs: RepairLine[];
  /** Parts that go to storage (repaired where damaged). */
  parts: PartInventory;
  /** Damaged parts scrapped, and the resources the scrap yields (to storage). */
  scrapped: PartInventory;
  scrap: Partial<Cargo>;
  /** The ship's cargo (to storage). */
  cargo: Partial<Cargo>;
}

const nonZero = (cargo: Cargo): Partial<Cargo> => {
  const out: Partial<Cargo> = {};
  for (const r of RESOURCE_IDS) if (cargo[r] > 0) out[r] = cargo[r];
  return out;
};

/** What dismantling `ship` here yields and costs (pure). Never fails: an unaffordable repair is scrap. */
export function dismantleQuote(state: SimState, station: StationDef, ship: StoredShip): DismantleQuote {
  const ctx = shipyardContext(state, station);
  // the cargo is unloaded first, so the repairs may use it
  for (const r of RESOURCE_IDS) ctx.storage[r] += ship.cargo[r];
  const inventory = stationStorage(state, station.id).parts;
  const { cost } = evaluateDesign({ base: { grid: ship.grid, hp: ship.hp, inventory }, grid: { nextId: ship.grid.nextId, parts: [] }, acquire: {} }, ctx);
  return {
    fee: cost.repairCredits,
    resources: cost.resources,
    repairs: cost.repairs,
    parts: cost.toStorage,
    scrapped: cost.scrapped,
    scrap: cost.scrap,
    cargo: nonZero(ship.cargo),
  };
}

/** Takes apart the stored ship `ship` (standing here – checked by the caller). */
export function dismantle(state: SimState, station: StationDef, reqId: number, ship: StoredShip): SimEvent[] {
  const quote = dismantleQuote(state, station, ship);
  const storage = ensureStorage(state, station.id);
  for (const r of RESOURCE_IDS) storage.resources[r] += ship.cargo[r];
  state.credits -= quote.fee;
  takeResources(state, station.id, quote.resources);
  mergeInventory(storage.parts, quote.parts);
  for (const r of RESOURCE_IDS) storage.resources[r] += quote.scrap[r] ?? 0;
  state.fleet.stored = state.fleet.stored.filter((s) => s !== ship);
  const events: SimEvent[] = [
    { type: 'actionResult', reqId, ok: true },
    {
      type: 'shipDismantled',
      stationId: station.id,
      shipId: ship.record.id,
      fee: quote.fee,
      parts: quote.parts,
      scrapped: quote.scrapped,
      scrap: quote.scrap,
      cargo: quote.cargo,
    },
  ];
  if (quote.fee > 0) events.push({ type: 'creditsChanged', delta: -quote.fee, reason: 'repair' });
  return events;
}
