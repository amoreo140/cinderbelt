// Storage overview (8.6): what lies at which station, a filter by ring and search by name,
// courier shipments on the way and the courier's price quote.
import { ALL_PART_KEYS, parsePartKey, type PartInventory, type PartKey } from '../../data/parts';
import { RESOURCE_IDS, type Cargo, type ResourceId } from '../../data/resources';
import { getLocale, tx } from '../../i18n';
import { courierQuote, type CourierQuote } from '../../sim/courier/courier';
import { hasUnlock } from '../../sim/factions/reputation';
import type { SimState } from '../../sim/Simulation';
import { stationById, type StationId } from '../../sim/world/stations';
import { storageShipRows } from '../fleet/hangarView';
import type { StorageShipRow } from '../fleet/types';
import { durationText, stationLabel } from './names';

export interface StorageRow {
  stationId: StationId;
  name: string;
  ring: number;
  /** The ship is docked here. */
  here: boolean;
  distance: number;
  resources: Partial<Cargo>;
  parts: PartInventory;
}

export interface ShipmentRow {
  id: number;
  from: string;
  to: string;
  eta: string;
  resources: Partial<Cargo>;
  parts: PartInventory;
}

export interface StoragesData {
  /** All stations with storage (first the one where the ship is, then by distance). */
  rows: StorageRow[];
  shipments: ShipmentRow[];
  courier: boolean;
  /** Discovered stations as courier destinations (nearest first). */
  destinations: { id: StationId; name: string; ring: number }[];
  /** The player's ships (M4a): the active one first, then the ships stored in hangar slots. */
  ships: StorageShipRow[];
}

export interface StoragesFilter {
  query: string;
  ring: number | null;
}

const norm = (s: string): string => s.toLocaleLowerCase(getLocale()).normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Rows by ring and search (a match in the station name shows the whole storage). */
export function filterStorageRows(rows: readonly StorageRow[], filter: StoragesFilter): StorageRow[] {
  return rows.filter((r) => filter.ring === null || r.ring === filter.ring).flatMap((r) => matches(r, filter.query.trim()) ?? []);
}

function matches(row: StorageRow, query: string): StorageRow | null {
  if (!query) return row;
  const q = norm(query);
  const resources: Partial<Cargo> = {};
  const parts: PartInventory = {};
  let any = norm(row.name).includes(q);
  for (const r of RESOURCE_IDS) if (row.resources[r] && norm(tx().resources[r]).includes(q)) (resources[r] = row.resources[r], (any = true));
  for (const k of ALL_PART_KEYS) {
    const { partId, tier } = parsePartKey(k);
    if (row.parts[k] && norm(`${tx().parts[partId]} t${tier}`).includes(q)) (parts[k] = row.parts[k], (any = true));
  }
  if (!any) return null;
  // a match in the station name shows the whole storage
  return norm(row.name).includes(q) ? row : { ...row, resources, parts };
}

export function storagesData(state: SimState): StoragesData {
  const pos = state.player.body.pos;
  const dock = state.player.dock;
  const all: StorageRow[] = [];
  for (const [id, s] of state.stations) {
    const resources: Partial<Cargo> = {};
    const parts: PartInventory = {};
    let any = false;
    for (const r of RESOURCE_IDS) if (s.resources[r] >= 0.05) (resources[r] = s.resources[r], (any = true));
    for (const k of ALL_PART_KEYS) if ((s.parts[k] ?? 0) > 0) (parts[k] = s.parts[k], (any = true));
    if (!any) continue;
    const def = stationById(state.seed, id);
    all.push({
      stationId: id,
      name: stationLabel(state.seed, id),
      ring: def?.ring ?? 1,
      here: dock.mode === 'docked' && dock.stationId === id,
      distance: def ? Math.hypot(def.pos.x - pos.x, def.pos.y - pos.y) : 0,
      resources,
      parts,
    });
  }
  all.sort((a, b) => Number(b.here) - Number(a.here) || a.distance - b.distance);
  const destinations = [...state.world.discovered]
    .map((id) => stationById(state.seed, id))
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => Math.hypot(a.pos.x - pos.x, a.pos.y - pos.y) - Math.hypot(b.pos.x - pos.x, b.pos.y - pos.y))
    .map((s) => ({ id: s.id, name: stationLabel(state.seed, s.id), ring: s.ring }));
  return {
    rows: all,
    shipments: state.career.shipments.map((s) => ({
      id: s.id,
      from: stationLabel(state.seed, s.from),
      to: stationLabel(state.seed, s.to),
      eta: durationText(Math.max(60, s.arrival - state.tick)),
      resources: s.resources,
      parts: s.parts,
    })),
    courier: hasUnlock(state.career.rep, 'courier'),
    destinations,
    ships: storageShipRows(state),
  };
}

/** Courier quote for a station's whole storage (or a selected part of it). */
export function courierOffer(state: SimState, from: StationId, to: StationId, resources: Partial<Cargo>, parts: PartInventory): (CourierQuote & { time: string }) | null {
  const q = courierQuote(state.seed, from, to, resources, parts);
  return q ? { ...q, time: durationText(q.ticks) } : null;
}

export type { PartKey, ResourceId };
