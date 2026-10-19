// Repairs at the service (spec M2, 4.8 and 6.5) and the debugDamage debug command. Shaped armour pays
// per missing HP exactly what a full plate pays (`hpMultOf` as the repair multiplier, SL2 E2 §2.3).
import { purchaseCost, repairCost, resourcePrice } from '../../data/economy';
import { partKey, type PartKey } from '../../data/parts';
import { RESOURCE_IDS, type Cargo, type ResourceId } from '../../data/resources';
import type { SimEvent, SimState } from '../Simulation';
import { currentHp, damagedParts, hullHp, maxHp } from '../ship/hp';
import { hpMultOf } from '../ship/shape';
import type { StationDef } from '../world/stations';
import type { ActionError } from './actions';
import { addResources, availableResources, isEmptyResources, missingResources, takeResources } from './storage';

export interface RepairQuoteLine {
  id: number;
  key: PartKey;
  hp: number;
  maxHp: number;
  credits: number;
  material: ResourceId;
  amount: number;
}

export interface RepairQuote {
  lines: RepairQuoteLine[];
  /** Credits for the repairs (without buying material). */
  credits: number;
  /** Material in total. */
  materials: Partial<Cargo>;
  /** Material missing from both the storage and the cargo. */
  missing: Partial<Cargo>;
  /** Price of buying the missing material (0 without autoBuy or when nothing is missing). */
  autoBuyCredits: number;
  /** Credits in total (repairs + buying with autoBuy). */
  total: number;
  /** Affordable and the material is there (or will be bought). */
  ok: boolean;
  /** Hull HP before the repair. */
  hull: { current: number; max: number };
}

export type RepairSelection = number[] | 'all';

/** An invalid id in the list (the part is not mounted) → null. */
function selectedParts(state: SimState, ids: RepairSelection) {
  const { grid, hp } = state.player;
  if (ids === 'all') return damagedParts(grid, hp);
  const byId = new Map(grid.parts.map((p) => [p.id, p]));
  if (ids.some((id) => !byId.has(id))) return null;
  return [...new Set(ids)].map((id) => byId.get(id)!).filter((p) => currentHp(hp, p) < maxHp(p));
}

/** Repair preview – the same calculation the `repair` action uses. */
export function repairQuote(state: SimState, station: StationDef, ids: RepairSelection, autoBuy: boolean): RepairQuote {
  const { grid, hp } = state.player;
  const parts = selectedParts(state, ids) ?? [];
  const lines: RepairQuoteLine[] = parts.map((p) => {
    const key = partKey(p.partId, p.tier, p.variant);
    const now = currentHp(hp, p);
    const max = maxHp(p);
    return { id: p.id, key, hp: now, maxHp: max, ...repairCost(key, now, max, station.ring, hpMultOf(p)) };
  });
  const credits = lines.reduce((s, l) => s + l.credits, 0);
  const materials = lines.reduce<Partial<Cargo>>((acc, l) => addResources(acc, { [l.material]: l.amount }), {});
  const missing = missingResources(materials, availableResources(state, station.id));
  const canBuy = autoBuy && station.services.market;
  let autoBuyCredits = 0;
  if (canBuy) {
    for (const r of RESOURCE_IDS) {
      const short = missing[r] ?? 0;
      if (short > 0) autoBuyCredits += purchaseCost(short, resourcePrice(r, station.ring, station.priceJitter[r]).buy);
    }
  }
  const total = credits + autoBuyCredits;
  const materialOk = isEmptyResources(missing) || canBuy;
  return {
    lines, credits, materials, missing, autoBuyCredits, total,
    ok: lines.length > 0 && materialOk && total <= state.credits,
    hull: hullHp(grid, hp),
  };
}

const fail = (reqId: number, reason: ActionError): SimEvent[] => [{ type: 'actionResult', reqId, ok: false, reason }];

export function repair(state: SimState, station: StationDef, ids: RepairSelection, autoBuy: boolean, reqId: number): SimEvent[] {
  if (!station.services.repair) return fail(reqId, 'serviceUnavailable');
  if (selectedParts(state, ids) === null) return fail(reqId, 'invalidQuantity');
  const quote = repairQuote(state, station, ids, autoBuy);
  if (quote.lines.length === 0) return fail(reqId, 'nothingToRepair');
  if (!isEmptyResources(quote.missing) && !(autoBuy && station.services.market)) return fail(reqId, 'notEnoughResources');
  if (quote.total > state.credits) return fail(reqId, 'notEnoughCredits');

  // bought material is used up at once – only what is there is taken from the storage and the cargo
  const own: Partial<Cargo> = {};
  for (const r of RESOURCE_IDS) {
    const need = (quote.materials[r] ?? 0) - (quote.missing[r] ?? 0);
    if (need > 0) own[r] = need;
  }
  takeResources(state, station.id, own);
  state.credits -= quote.total;
  for (const line of quote.lines) state.player.hp.delete(line.id);
  const events: SimEvent[] = [{ type: 'actionResult', reqId, ok: true }];
  if (quote.total > 0) events.push({ type: 'creditsChanged', delta: -quote.total, reason: 'repair' });
  return events;
}

/** Dev build only: sets the HP of a mounted part (0 < hp ≤ max; max = full HP). */
export function debugDamage(state: SimState, partId: number, hp: number, reqId: number): SimEvent[] {
  if (!import.meta.env.DEV) return fail(reqId, 'serviceUnavailable');
  const part = state.player.grid.parts.find((p) => p.id === partId);
  if (!part || !Number.isFinite(hp) || hp <= 0 || hp > maxHp(part)) return fail(reqId, 'invalidQuantity');
  if (hp >= maxHp(part)) state.player.hp.delete(partId);
  else state.player.hp.set(partId, hp);
  return [{ type: 'actionResult', reqId, ok: true }];
}
