// Courier service (long-term design, Guild level 2): moving goods from the storage of one discovered
// station to another for a fee of 200 cr + 2% of the value and with a delay (distance ÷ 40 u/s).
import { partValue, RESOURCE_BASE_PRICE } from '../../data/economy';
import { ALL_PART_KEYS, isPartKey, type PartInventory } from '../../data/parts';
import { RESOURCE_IDS, type Cargo } from '../../data/resources';
import type { SimEvent, SimState } from '../Simulation';
import { addParts, ensureStorage, RES_EPS, stationStorage, take } from '../station/storage';
import { stationById, type StationId } from '../world/stations';
import type { Shipment } from '../career/types';

export const COURIER_BASE_FEE = 200;
export const COURIER_VALUE_FEE = 0.02;
/** Courier speed (u/s) → 2,400 u = 1 min. */
export const COURIER_SPEED = 40;
/** Most shipments in transit at once. */
export const COURIER_MAX_SHIPMENTS = 6;

export type CourierError =
  | 'serviceLocked'
  | 'invalidQuantity'
  | 'sameStation'
  | 'unknownStation'
  | 'notEnoughResources'
  | 'notEnoughParts'
  | 'notEnoughCredits'
  | 'tooManyShipments';

export interface CourierQuote {
  fee: number;
  /** Duration in simulation steps (60/s). */
  ticks: number;
  value: number;
}

/** Value of the shipment at base prices. */
export function shipmentValue(resources: Partial<Cargo>, parts: PartInventory): number {
  let v = 0;
  for (const r of RESOURCE_IDS) v += (resources[r] ?? 0) * RESOURCE_BASE_PRICE[r];
  for (const k of ALL_PART_KEYS) v += (parts[k] ?? 0) * partValue(k);
  return v;
}

export function courierQuote(seed: number, from: StationId, to: StationId, resources: Partial<Cargo>, parts: PartInventory): CourierQuote | null {
  const a = stationById(seed, from);
  const b = stationById(seed, to);
  if (!a || !b) return null;
  const value = shipmentValue(resources, parts);
  const distance = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
  return { fee: Math.ceil(COURIER_BASE_FEE + COURIER_VALUE_FEE * value), ticks: Math.max(60, Math.round((distance / COURIER_SPEED) * 60)), value };
}

/** Sends a shipment (validate first, then change everything at once). */
export function sendShipment(
  state: SimState,
  from: StationId,
  to: StationId,
  resources: Partial<Cargo>,
  parts: PartInventory,
  unlocked: boolean,
): Shipment | CourierError {
  if (!unlocked) return 'serviceLocked';
  if (from === to) return 'sameStation';
  const discovered = state.world.discovered;
  if (!discovered.has(from) || !discovered.has(to)) return 'unknownStation';
  if (state.career.shipments.length >= COURIER_MAX_SHIPMENTS) return 'tooManyShipments';
  const res: Partial<Cargo> = {};
  const inv: PartInventory = {};
  let any = false;
  const storage = stationStorage(state, from);
  for (const r of RESOURCE_IDS) {
    const q = resources[r];
    if (q === undefined || q === 0) continue;
    if (!Number.isFinite(q) || q < 0) return 'invalidQuantity';
    if (q > storage.resources[r] + RES_EPS) return 'notEnoughResources';
    res[r] = Math.min(q, storage.resources[r]);
    any = true;
  }
  for (const [k, n] of Object.entries(parts)) {
    if (!isPartKey(k) || !Number.isInteger(n) || (n ?? 0) < 0) return 'invalidQuantity';
    if (!n) continue;
    if (n > (storage.parts[k] ?? 0)) return 'notEnoughParts';
    inv[k] = n;
    any = true;
  }
  if (!any) return 'invalidQuantity';
  const quote = courierQuote(state.seed, from, to, res, inv);
  if (!quote) return 'unknownStation';
  if (quote.fee > state.credits) return 'notEnoughCredits';
  const src = ensureStorage(state, from);
  for (const r of RESOURCE_IDS) if (res[r]) take(src.resources, r, res[r]);
  for (const k of ALL_PART_KEYS) if (inv[k]) addParts(src.parts, k, -inv[k]);
  state.credits -= quote.fee;
  const shipment: Shipment = { id: state.career.nextId++, from, to, resources: res, parts: inv, arrival: state.tick + quote.ticks };
  state.career.shipments.push(shipment);
  return shipment;
}

/** Delivers shipments whose time has elapsed. */
export function deliverShipments(state: SimState): SimEvent[] {
  const events: SimEvent[] = [];
  const due = state.career.shipments.filter((s) => s.arrival <= state.tick);
  if (due.length === 0) return events;
  state.career.shipments = state.career.shipments.filter((s) => s.arrival > state.tick);
  for (const s of due) {
    const dst = ensureStorage(state, s.to);
    for (const r of RESOURCE_IDS) if (s.resources[r]) dst.resources[r] += s.resources[r];
    for (const k of ALL_PART_KEYS) if (s.parts[k]) addParts(dst.parts, k, s.parts[k]);
    events.push({ type: 'courierDelivered', shipment: s.id, to: s.to });
  }
  return events;
}
