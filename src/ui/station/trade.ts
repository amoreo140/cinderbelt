// Trade previews for the UI – they use the same price functions as the simulation.
import { FUEL_PER_ICE, fuelCost, fuelUnitPrice, purchaseCost, saleValue, type RingIndex, type UnitPrice } from '../../data/economy';
import { RESOURCE_IDS, type Cargo, type ResourceId } from '../../data/resources';
import { shipSaleValue } from '../../sim/ship/workshop';

/** Quantity choice on the market. */
export type QtyMode = 1 | 10 | 100 | 'max';

const EPS = 1e-9;

/** Quantity to sell (or move to storage): 'all' sells a fraction too; null = nothing to do. */
export function sellQuantity(mode: QtyMode, available: number): number | 'all' | null {
  if (available <= EPS) return null;
  if (mode === 'max' || mode >= available - EPS) return 'all';
  return mode;
}

/** The largest whole number of units that can be bought for `credits`. */
export function maxAffordableUnits(credits: number, unitPrice: number): number {
  if (unitPrice <= 0) return 0;
  let n = Math.floor((credits + EPS) / unitPrice);
  while (n > 0 && purchaseCost(n, unitPrice) > credits) n--;
  return Math.max(0, n);
}

export function buyQuantity(mode: QtyMode, credits: number, unitPrice: number): { qty: number | null; reason?: 'notEnoughCredits' } {
  const max = maxAffordableUnits(credits, unitPrice);
  const qty = mode === 'max' ? max : mode;
  if (qty <= 0 || qty > max) return { qty: null, reason: 'notEnoughCredits' };
  return { qty };
}

/** Quantity to load from storage into the ship (limited by free space). */
export function transferQuantity(mode: QtyMode, available: number, free: number): number | 'all' | null {
  if (available <= EPS || free <= EPS) return null;
  const wanted = mode === 'max' ? available : Math.min(mode, available);
  if (wanted <= free + EPS) return wanted >= available - EPS ? 'all' : wanted;
  return free;
}

/**
 * Credits for a sale of `qty` units (M4c): `refined` refined units on the ship sell first with their bonus,
 * `demandLeft` units of the station's demand at the demand price – never both on one unit. The same
 * `shipSaleValue` the simulation pays with (`sellResource`); a sale from storage passes refined 0.
 */
export function sellQuote(p: { resource: ResourceId; qty: number; refined: number; demandLeft: number; unitSell: number }): number {
  return shipSaleValue(p.resource, p.qty, p.refined, Math.min(p.qty, Math.max(0, p.demandLeft)), p.unitSell);
}

/**
 * Credits for selling the whole cargo; with the ship's refined ore (M4c) and the station's demand when
 * given (both as the simulation pays them).
 */
export function sellAllValue(
  cargo: Cargo,
  prices: Record<ResourceId, UnitPrice>,
  refined?: Cargo,
  demand?: { resource: ResourceId; left: number } | null,
): number {
  let sum = 0;
  for (const id of RESOURCE_IDS) {
    const demandLeft = demand?.resource === id ? demand.left : 0;
    sum += sellQuote({ resource: id, qty: cargo[id], refined: refined?.[id] ?? 0, demandLeft, unitSell: prices[id].sell });
  }
  return sum;
}

/**
 * Refined units a transfer of `qty` to the station storage turns into ordinary ore (M4c: refined ore lives
 * only on ships; every outflow takes raw units first, so only `refined > cargo − qty` is lost). 0 = no warning.
 */
export function refinedLost(cargo: number, refined: number, qty: number | 'all' | null): number {
  if (qty === null || refined <= EPS) return 0;
  const moved = qty === 'all' ? cargo : qty;
  return Math.max(0, Math.min(refined, refined - (cargo - moved)));
}

export interface RefuelQuote {
  missing: number;
  /** How much ice would be spent and how much fuel it yields. */
  iceUsed: number;
  iceFuel: number;
  /** Price of a full tank in credits. */
  fullCost: number;
  affordableFull: boolean;
  /** How much fuel can be bought with all the credits. */
  affordableUnits: number;
  tenCost: number;
  unitPrice: number;
}

/** `unitPrice` = the fuel price at a station with a sector state (Fuel shortage); otherwise by ring. */
export function refuelQuote(p: { fuel: number; capacity: number; ice: number; credits: number; ring: RingIndex; unitPrice?: number }): RefuelQuote {
  const missing = Math.max(0, p.capacity - p.fuel);
  const iceUsed = Math.min(p.ice, missing / FUEL_PER_ICE);
  const unitPrice = p.unitPrice ?? fuelUnitPrice(p.ring);
  const fullCost = p.unitPrice === undefined ? fuelCost(missing, p.ring) : purchaseCost(missing, unitPrice);
  return {
    missing,
    iceUsed,
    iceFuel: iceUsed * FUEL_PER_ICE,
    fullCost,
    affordableFull: fullCost <= p.credits,
    affordableUnits: Math.min(missing, p.credits / unitPrice),
    tenCost: p.unitPrice === undefined ? fuelCost(Math.min(10, missing), p.ring) : purchaseCost(Math.min(10, missing), unitPrice),
    unitPrice,
  };
}
