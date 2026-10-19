// Economy constants and pure price functions (spec M2, ch. 6). Tuned only here.
import { ALL_PART_KEYS, parsePartKey, partKey, VARIANT_PART_KEYS, type PartId, type PartInventory, type PartKey, type Tier } from './parts';
import { VARIANT_FEE_MULT } from './variants';
import { RESOURCE_IDS, type Cargo, type ResourceId } from './resources';

export type RingIndex = 1 | 2 | 3 | 4;
export const RING_INDICES: readonly RingIndex[] = [1, 2, 3, 4];

/** Base price of a resource (cr per unit). */
export const RESOURCE_BASE_PRICE: Record<ResourceId, number> = { iron: 4, copper: 5, ice: 3, titanium: 10 };

/** Resources are cheaper where they are mined. */
export const RING_RESOURCE_MULT: Record<RingIndex, Record<ResourceId, number>> = {
  1: { iron: 1.0, copper: 1.0, ice: 1.0, titanium: 1.0 },
  2: { iron: 0.9, copper: 1.1, ice: 0.85, titanium: 1.0 },
  3: { iron: 1.1, copper: 1.2, ice: 1.0, titanium: 0.95 },
  4: { iron: 1.2, copper: 1.3, ice: 1.1, titanium: 1.0 },
};

/** The station sells to the player at u × BUY_SPREAD and buys at u × SELL_SPREAD. */
export const BUY_SPREAD = 1.25;
export const SELL_SPREAD = 0.8;
/** Local deviation of a station's prices. */
export const PRICE_JITTER_MIN = 0.95;
export const PRICE_JITTER_MAX = 1.05;

/** Multiplier of service prices (fuel, repairs) by ring. */
export const RING_SERVICE_MULT: Record<RingIndex, number> = { 1: 1.0, 2: 1.1, 3: 1.25, 4: 1.4 };

export const FUEL_PER_ICE = 2;
export const FUEL_BASE_PRICE = 2.0;
/** Emergency ration and the minimum fuel after a tow (share of the tank capacity). */
export const EMERGENCY_FUEL_FRACTION = 0.25;
/**
 * …but at least this much fuel (whole tank if smaller): a quarter of a tiny tank (a liquidated hull) is
 * not enough for one mining trip, and a broke player must always be able to make one (saboteur report).
 */
export const EMERGENCY_FUEL_MIN = 15;

/** Fuel the emergency ration (and a free tow) fills the tank up to. */
export const emergencyFuelTarget = (capacity: number): number => Math.min(capacity, Math.max(capacity * EMERGENCY_FUEL_FRACTION, EMERGENCY_FUEL_MIN));
export const TOW_BASE = 100;
export const TOW_PER_UNIT = 0.2;

/** A finished part on the market costs 50 % more than its value (crafting is always the better deal). */
export const PART_BUY_MARKUP = 1.5;
/** The station buys parts at 40 % of their value (the same everywhere). */
export const PART_SELL_FACTOR = 0.4;
/** Multiplier of the parts' purchase price by ring. */
export const RING_PART_MULT: Record<RingIndex, number> = { 1: 1.0, 2: 1.1, 3: 1.2, 4: 1.3 };
/** Finished T2 parts are sold only from this ring (they can be crafted anywhere). */
export const T2_MARKET_MIN_RING: RingIndex = 2;
/** Fitting a new or moved part in the shipyard. */
export const INSTALL_FEE = 10;
/** Repairs (spec 6.5): credits and material as a share of the recipe × the missing share of HP. */
export const REPAIR_CREDIT_FACTOR = 0.15;
export const REPAIR_MATERIAL_FACTOR = 0.25;
/**
 * Scrap (I7, M12): the stock holds only parts with full HP. A damaged part that leaves the ship without repair
 * (a detached own part loaded from a wreck, loot from a pirate, dismantling without repair) is broken down
 * into resources: SCRAP_FACTOR × recipe × HP share, every resource rounded down.
 */
export const SCRAP_FACTOR = 0.5;

export const STARTING_CREDITS = 250;
/** Start: 2 armour and a cannon (M3a) in the home station's stock – fitted in the shipyard. */
export const STARTING_HOME_PARTS: PartInventory = { 'armor:1': 2, 'cannon:1': 1 };

/** Tolerance against floating-point errors when rounding sums. */
const EPS = 1e-9;

export const round1 = (x: number): number => Math.round((x + EPS) * 10) / 10;

/** Rounding of a part's price to 5 cr. */
export const round5 = (x: number): number => Math.round((x + EPS) / 5) * 5;

export interface UnitPrice {
  /** What the station pays the player. */
  sell: number;
  /** What the station charges the player. */
  buy: number;
}

export function resourcePrice(resource: ResourceId, ring: RingIndex, jitter: number): UnitPrice {
  const u = RESOURCE_BASE_PRICE[resource] * RING_RESOURCE_MULT[ring][resource] * jitter;
  return { sell: round1(u * SELL_SPREAD), buy: round1(u * BUY_SPREAD) };
}

/** Sum for a sale (fractions of the haul are sold, the sum is rounded down). */
export const saleValue = (qty: number, unitSell: number): number => Math.max(0, Math.floor(qty * unitSell + EPS));

/** Purchase price (rounded up). */
export const purchaseCost = (qty: number, unitBuy: number): number => Math.max(0, Math.ceil(qty * unitBuy - EPS));

export const fuelUnitPrice = (ring: RingIndex): number => FUEL_BASE_PRICE * RING_SERVICE_MULT[ring];

export const fuelCost = (amount: number, ring: RingIndex): number => purchaseCost(amount, fuelUnitPrice(ring));

/** Towing to a station `distance` units away. */
export const towCost = (distance: number): number => Math.ceil(TOW_BASE + TOW_PER_UNIT * distance - EPS);

export interface Recipe {
  output: PartKey;
  resources: Partial<Cargo>;
  /** Crafting fee. */
  credits: number;
}

const recipe = (output: PartKey, resources: Partial<Cargo>, credits: number): Recipe => ({ output, resources, credits });

/** Recipes of the base parts (spec 6.3) – available everywhere there is crafting. */
const BASE_RECIPES: Record<`${PartId}:${Tier}`, Recipe> = {
  'armor:1': recipe('armor:1', { iron: 15 }, 200),
  'cargo:1': recipe('cargo:1', { iron: 30, copper: 10 }, 900),
  'fuelTank:1': recipe('fuelTank:1', { iron: 25, copper: 5 }, 650),
  'engine:1': recipe('engine:1', { iron: 25, copper: 15 }, 800),
  'gyro:1': recipe('gyro:1', { iron: 20, copper: 20 }, 800),
  'radar:1': recipe('radar:1', { iron: 10, copper: 25 }, 700),
  'miningLaser:1': recipe('miningLaser:1', { iron: 20, copper: 30 }, 1150),
  'reactor:1': recipe('reactor:1', { iron: 30, copper: 30, ice: 20 }, 1250),
  'cockpit:1': recipe('cockpit:1', { iron: 50, copper: 40, ice: 10 }, 2500),
  'cannon:1': recipe('cannon:1', { iron: 25, copper: 20 }, 1000),
  'shield:1': recipe('shield:1', { iron: 20, copper: 30, ice: 15 }, 1400),
  // M2d: heavy laser ≈ 2.4 lasers, large cargo ≈ 4 small, battery without a reactor
  'heavyLaser:1': recipe('heavyLaser:1', { iron: 45, copper: 70 }, 2750),
  'largeCargo:1': recipe('largeCargo:1', { iron: 120, copper: 40 }, 3500),
  'battery:1': recipe('battery:1', { iron: 20, copper: 25, ice: 10 }, 750),
  // M3.6: tractor beam ≈ cannon (fee by convention ×1.25 against comparable parts)
  'tractorBeam:1': recipe('tractorBeam:1', { iron: 20, copper: 25 }, 1150),
  // M4c (plan 2026-10-20 §2.4): Archive parts
  'largeReactor:1': recipe('largeReactor:1', { iron: 110, copper: 110, ice: 70 }, 4500),
  'repairModule:1': recipe('repairModule:1', { iron: 30, copper: 30 }, 1500),
  'refinery:1': recipe('refinery:1', { iron: 60, copper: 50, ice: 10 }, 3000),
  'armor:2': recipe('armor:2', { titanium: 12, iron: 5 }, 400),
  'cargo:2': recipe('cargo:2', { titanium: 20, iron: 10, copper: 10 }, 2000),
  'fuelTank:2': recipe('fuelTank:2', { titanium: 18, iron: 8, copper: 8 }, 1500),
  'engine:2': recipe('engine:2', { titanium: 20, iron: 10, copper: 20 }, 1900),
  'gyro:2': recipe('gyro:2', { titanium: 16, iron: 8, copper: 25 }, 1900),
  'radar:2': recipe('radar:2', { titanium: 10, iron: 5, copper: 30 }, 1650),
  'miningLaser:2': recipe('miningLaser:2', { titanium: 18, iron: 8, copper: 40 }, 2650),
  'reactor:2': recipe('reactor:2', { titanium: 25, iron: 10, copper: 40, ice: 30 }, 3000),
  'cockpit:2': recipe('cockpit:2', { titanium: 40, iron: 20, copper: 50, ice: 20 }, 5650),
  'cannon:2': recipe('cannon:2', { titanium: 20, iron: 10, copper: 25 }, 2250),
  'shield:2': recipe('shield:2', { titanium: 22, iron: 8, copper: 40, ice: 25 }, 3150),
  'heavyLaser:2': recipe('heavyLaser:2', { titanium: 40, iron: 18, copper: 90 }, 5900),
  'largeCargo:2': recipe('largeCargo:2', { titanium: 80, iron: 40, copper: 40 }, 8000),
  'battery:2': recipe('battery:2', { titanium: 15, iron: 8, copper: 35, ice: 15 }, 1750),
  'tractorBeam:2': recipe('tractorBeam:2', { titanium: 15, iron: 8, copper: 30 }, 2500),
  'largeReactor:2': recipe('largeReactor:2', { titanium: 90, iron: 35, copper: 140, ice: 100 }, 10500),
  'repairModule:2': recipe('repairModule:2', { titanium: 25, iron: 10, copper: 40 }, 3400),
  'refinery:2': recipe('refinery:2', { titanium: 45, iron: 20, copper: 65, ice: 15 }, 6800),
};

/**
 * Recipes of all parts: base + variants (M3.5b) – a variant has the base part's resources
 * and a fee × VARIANT_FEE_MULT (rounded to 50 cr). A variant can be crafted only with a blueprint
 * or an Archive node (sim/discovery/unlocks.ts).
 */
export const RECIPES: Readonly<Record<PartKey, Recipe>> = (() => {
  const out = { ...BASE_RECIPES } as Record<PartKey, Recipe>;
  for (const key of VARIANT_PART_KEYS) {
    const { partId, tier } = parsePartKey(key);
    const base = BASE_RECIPES[partKey(partId, tier) as `${PartId}:${Tier}`];
    out[key] = { output: key, resources: { ...base.resources }, credits: Math.round((base.credits * VARIANT_FEE_MULT) / 50) * 50 };
  }
  return out;
})();

/** Part value V = recipe resources at base prices + the fee. */
export function partValue(key: PartKey): number {
  const r = RECIPES[key];
  let value = r.credits;
  for (const id of RESOURCE_IDS) value += (r.resources[id] ?? 0) * RESOURCE_BASE_PRICE[id];
  return value;
}

/** Price of a finished part on the market, or null if it is not sold in the ring (T2 in ring 1). */
export function partBuyPrice(key: PartKey, ring: RingIndex): number | null {
  const { tier, variant } = parsePartKey(key);
  // variants are not sold on the market (crafting only, with a blueprint)
  if (variant || (tier === 2 && ring < T2_MARKET_MIN_RING)) return null;
  return round5(partValue(key) * PART_BUY_MARKUP * RING_PART_MULT[ring]);
}

/** Buyback price of a part (the same everywhere). */
export const partSellPrice = (key: PartKey): number => round5(partValue(key) * PART_SELL_FACTOR);

export interface PartPrice {
  /** What the station sells a finished part for (null = not sold here). */
  buy: number | null;
  /** What the station buys a part for. */
  sell: number;
}

export const partPrice = (key: PartKey, ring: RingIndex): PartPrice => ({
  buy: partBuyPrice(key, ring),
  sell: partSellPrice(key),
});

/** Main repair material: iron for T1, titanium for T2. */
export const repairMaterial = (key: PartKey): ResourceId => (parsePartKey(key).tier === 2 ? 'titanium' : 'iron');

export interface RepairCost {
  credits: number;
  material: ResourceId;
  amount: number;
}

/**
 * Price of repairing a part from `hp` to full HP (spec 6.5); zero at full HP. `mult` scales the damaged
 * fraction: shaped armour passes its `hpMultOf` (SL2 E2 §2.3) so a missing HP costs exactly what it costs
 * on a full plate (`(1 − hp / max) × hpMult` = missing HP / the full part's HP). Default 1 = unshaped.
 * The multiplier is applied after the clamp: a badly damaged nose 2×1 (area 1.67) may miss more HP than a
 * whole plate has, and every one of them costs the same.
 */
export function repairCost(key: PartKey, hp: number, maxHp: number, ring: RingIndex, mult = 1): RepairCost {
  const f = Math.min(1, Math.max(0, 1 - hp / maxHp)) * mult;
  const r = RECIPES[key];
  const material = repairMaterial(key);
  return {
    credits: Math.max(0, Math.ceil(f * r.credits * REPAIR_CREDIT_FACTOR * RING_SERVICE_MULT[ring] - EPS)),
    material,
    amount: Math.max(0, Math.ceil(f * REPAIR_MATERIAL_FACTOR * (r.resources[material] ?? 0) - EPS)),
  };
}

/** Resources from scrapping a damaged part with `hp` out of `maxHp` (positive items only). */
export function scrapResources(key: PartKey, hp: number, maxHp: number): Partial<Cargo> {
  const share = SCRAP_FACTOR * Math.min(1, Math.max(0, hp / maxHp));
  const out: Partial<Cargo> = {};
  for (const r of RESOURCE_IDS) {
    const amount = Math.floor((RECIPES[key].resources[r] ?? 0) * share + EPS);
    if (amount > 0) out[r] = amount;
  }
  return out;
}

export interface PriceList {
  resources: Record<ResourceId, UnitPrice>;
  /** Part prices by ring (whether a station has a parts market is decided by its services). */
  parts: Record<PartKey, PartPrice>;
  fuelPerUnit: number;
}

/** Station price list – depends only on the ring and the deviation, can be cached. */
export function priceList(station: { ring: RingIndex; priceJitter: Record<ResourceId, number> }): PriceList {
  const resources = {} as Record<ResourceId, UnitPrice>;
  for (const id of RESOURCE_IDS) resources[id] = resourcePrice(id, station.ring, station.priceJitter[id]);
  const parts = {} as Record<PartKey, PartPrice>;
  for (const key of ALL_PART_KEYS) parts[key] = partPrice(key, station.ring);
  return { resources, parts, fuelPerUnit: fuelUnitPrice(station.ring) };
}

/**
 * Hangar slots (M4a, long-term design 3.4.4, overview question 1). Every stored ship stands in a slot
 * bought at its station (a station with a shipyard); the active ship never needs one. The price is
 * by the number of slots bought in the whole game so far (`slotPrices[bought]`), slots are never
 * refunded. At most `maxSlots.base` slots in total, `maxSlots.plus` with the Archive node "Hangar +2"
 * (`hangarPlus`). The econ model's side goal "Hangar slot 2" = the first price (econOracle).
 */
export const HANGAR = {
  slotPrices: [5000, 15000, 40000, 40000],
  maxSlots: { base: 2, plus: 4 },
} as const satisfies { slotPrices: readonly number[]; maxSlots: { base: number; plus: number } };
