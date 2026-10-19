// Parts market and crafting. Actions are atomic as in actions.ts.
import { partBuyPrice, partSellPrice, RECIPES } from '../../data/economy';
import { isPartKey, type PartKey } from '../../data/parts';
import { RESOURCE_IDS, type Cargo } from '../../data/resources';
import type { SimEvent, SimState } from '../Simulation';
import { partUnlocked } from '../discovery/archive';
import type { StationDef } from '../world/stations';
import type { ActionError, CreditReason } from './actions';
import {
  addParts,
  availableResources,
  ensureStorage,
  isEmptyResources,
  missingResources,
  RES_EPS,
  scaleResources,
  stationStorage,
  takeResources,
} from './storage';

const ok = (reqId: number): SimEvent => ({ type: 'actionResult', reqId, ok: true });
const fail = (reqId: number, reason: ActionError): SimEvent[] => [{ type: 'actionResult', reqId, ok: false, reason }];
const credits = (delta: number, reason: CreditReason): SimEvent[] =>
  delta !== 0 ? [{ type: 'creditsChanged', delta, reason }] : [];

/** The count of pieces must be a positive integer. */
const validCount = (count: number): boolean => Number.isInteger(count) && count > 0;

export function buyPart(state: SimState, station: StationDef, key: PartKey, count: number, reqId: number): SimEvent[] {
  if (!isPartKey(key)) return fail(reqId, 'unknownPart');
  if (!station.services.partsMarket) return fail(reqId, 'serviceUnavailable');
  if (!validCount(count)) return fail(reqId, 'invalidQuantity');
  // parts from the Archive and variants from blueprints (M3.5b)
  if (!partUnlocked(state, key)) return fail(reqId, 'partLocked');
  const price = partBuyPrice(key, station.ring);
  if (price === null) return fail(reqId, 'notAvailableHere');
  const cost = price * count;
  if (cost > state.credits) return fail(reqId, 'notEnoughCredits');
  state.credits -= cost;
  addParts(ensureStorage(state, station.id).parts, key, count);
  return [ok(reqId), ...credits(-cost, 'buy')];
}

export function sellPart(state: SimState, station: StationDef, key: PartKey, count: number, reqId: number): SimEvent[] {
  if (!isPartKey(key)) return fail(reqId, 'unknownPart');
  if (!station.services.partsMarket) return fail(reqId, 'serviceUnavailable');
  if (!validCount(count)) return fail(reqId, 'invalidQuantity');
  if ((stationStorage(state, station.id).parts[key] ?? 0) < count) return fail(reqId, 'notEnoughParts');
  const value = partSellPrice(key) * count;
  addParts(ensureStorage(state, station.id).parts, key, -count);
  state.credits += value;
  return [ok(reqId), ...credits(value, 'sell')];
}

export interface CraftQuote {
  key: PartKey;
  count: number;
  /** Total required materials. */
  resources: Partial<Cargo>;
  /** Total fee. */
  credits: number;
  /** Storage + cargo. */
  available: Cargo;
  missing: Partial<Cargo>;
  creditsMissing: number;
  ok: boolean;
}

/** Preview of crafting `count` pieces – the same computation the `craft` action uses. */
export function craftQuote(state: SimState, station: StationDef, key: PartKey, count: number): CraftQuote {
  const recipe = RECIPES[key];
  const resources = scaleResources(recipe.resources, count);
  const fee = recipe.credits * count;
  const available = availableResources(state, station.id);
  const missing = missingResources(resources, available);
  const creditsMissing = Math.max(0, fee - state.credits);
  return {
    key, count, resources, credits: fee, available, missing, creditsMissing,
    ok: isEmptyResources(missing) && creditsMissing === 0,
  };
}

/** How many pieces can be crafted now (materials and credits). */
export function maxCraftable(state: SimState, station: StationDef, key: PartKey): number {
  const recipe = RECIPES[key];
  const available = availableResources(state, station.id);
  let max = recipe.credits > 0 ? Math.floor(state.credits / recipe.credits) : Infinity;
  for (const r of RESOURCE_IDS) {
    const need = recipe.resources[r] ?? 0;
    if (need > 0) max = Math.min(max, Math.floor((available[r] + RES_EPS) / need));
  }
  return Number.isFinite(max) ? Math.max(0, max) : 0;
}

export function craft(state: SimState, station: StationDef, key: PartKey, count: number, reqId: number): SimEvent[] {
  if (!isPartKey(key)) return fail(reqId, 'unknownPart');
  if (!station.services.crafting) return fail(reqId, 'serviceUnavailable');
  if (!validCount(count)) return fail(reqId, 'invalidQuantity');
  if (!partUnlocked(state, key)) return fail(reqId, 'partLocked');
  const quote = craftQuote(state, station, key, count);
  if (!isEmptyResources(quote.missing)) return fail(reqId, 'notEnoughResources');
  if (quote.creditsMissing > 0) return fail(reqId, 'notEnoughCredits');
  takeResources(state, station.id, quote.resources);
  state.credits -= quote.credits;
  addParts(ensureStorage(state, station.id).parts, key, count);
  return [ok(reqId), ...credits(-quote.credits, 'craft')];
}
