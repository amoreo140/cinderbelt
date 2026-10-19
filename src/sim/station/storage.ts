// Station storage and drawing materials "first from storage, then from cargo".
import type { PartInventory, PartKey } from '../../data/parts';
import { emptyCargo, RESOURCE_IDS, type Cargo, type ResourceId } from '../../data/resources';
import type { SimState, StationState } from '../Simulation';
import type { StationId } from '../world/stations';

/** Leftovers smaller than this count as zero (fractions from mining). */
export const RES_EPS = 1e-9;

/** Station storage for reading (an untouched station has empty storage, it is not put into the state). */
export function stationStorage(state: SimState, id: StationId): StationState {
  return state.stations.get(id) ?? { resources: emptyCargo(), parts: {} };
}

export function ensureStorage(state: SimState, id: StationId): StationState {
  let storage = state.stations.get(id);
  if (!storage) {
    storage = { resources: emptyCargo(), parts: {} };
    state.stations.set(id, storage);
  }
  return storage;
}

/** Removes the amount; a remainder close to zero is rounded to zero. */
export function take(cargo: Cargo, id: ResourceId, amount: number): void {
  const rest = cargo[id] - amount;
  cargo[id] = rest < RES_EPS ? 0 : rest;
}

/** Materials available for station services: storage + the ship's cargo. */
export function availableResources(state: SimState, id: StationId): Cargo {
  const storage = stationStorage(state, id).resources;
  const cargo = state.player.cargo;
  const out = emptyCargo();
  for (const r of RESOURCE_IDS) out[r] = storage[r] + cargo[r];
  return out;
}

export function scaleResources(res: Partial<Cargo>, n: number): Partial<Cargo> {
  const out: Partial<Cargo> = {};
  for (const r of RESOURCE_IDS) if (res[r]) out[r] = res[r] * n;
  return out;
}

export function addResources(a: Partial<Cargo>, b: Partial<Cargo>): Partial<Cargo> {
  const out: Partial<Cargo> = {};
  for (const r of RESOURCE_IDS) {
    const sum = (a[r] ?? 0) + (b[r] ?? 0);
    if (sum) out[r] = sum;
  }
  return out;
}

/** What is missing to meet the need (positive entries only). */
export function missingResources(needs: Partial<Cargo>, available: Cargo): Partial<Cargo> {
  const out: Partial<Cargo> = {};
  for (const r of RESOURCE_IDS) {
    const short = (needs[r] ?? 0) - available[r];
    if (short > RES_EPS) out[r] = short;
  }
  return out;
}

export const isEmptyResources = (res: Partial<Cargo>): boolean => RESOURCE_IDS.every((r) => !(res[r] && res[r] > RES_EPS));

/** Removes materials first from the station storage, then from the cargo (the caller does the validation). */
export function takeResources(state: SimState, id: StationId, needs: Partial<Cargo>): void {
  if (isEmptyResources(needs)) return;
  const storage = ensureStorage(state, id).resources;
  const cargo = state.player.cargo;
  for (const r of RESOURCE_IDS) {
    const need = needs[r] ?? 0;
    if (need <= 0) continue;
    const fromStorage = Math.min(need, storage[r]);
    take(storage, r, fromStorage);
    take(cargo, r, Math.min(need - fromStorage, cargo[r]));
  }
}

/** Adds (or, for a negative `n`, removes) pieces to the parts storage; zero entries are deleted. */
export function addParts(inventory: PartInventory, key: PartKey, n: number): void {
  const count = (inventory[key] ?? 0) + n;
  if (count > 0) inventory[key] = count;
  else delete inventory[key];
}
