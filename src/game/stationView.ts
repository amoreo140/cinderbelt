// Data for the station tabs Market – parts, Crafting and Service – repairs (pure functions over the simulation).
import { partPrice, RECIPES } from '../data/economy';
import { PART_IDS, partKey, type PartId, type PartInventory, type PartKey, type Tier } from '../data/parts';
import { RESOURCE_IDS, type ResourceId } from '../data/resources';
import { tx } from '../i18n';
import { VARIANTS, VARIANT_IDS, type VariantId } from '../data/variants';
import { partUnlocked } from '../sim/discovery/archive';
import { lockReason, partBaseName } from './discovery/names';
import { partIconPath } from '../render/assets/catalog';
import type { SimState } from '../sim/Simulation';
import { craftQuote, maxCraftable } from '../sim/station/partActions';
import { repairQuote, type RepairSelection } from '../sim/station/repair';
import { stationStorage } from '../sim/station/storage';
import type { StationDef } from '../sim/world/stations';
import { formatCredits } from '../ui/format';
import { formatResources, partName, partStats, type PartStat } from './shipyardView';

// ---------------------------------------------------------------------------
// parts market

export interface PartMarketRow {
  key: PartKey;
  partId: PartId;
  tier: Tier;
  /** Why the part cannot be bought (Archive – M3.5b), or null. */
  locked: string | null;
  name: string;
  icon: string;
  inStorage: number;
  /** Price of the finished part (null = not sold in this ring). */
  buy: number | null;
  sell: number;
  canBuy: boolean;
  canSell: boolean;
  /** How many pieces the credits allow. */
  maxBuy: number;
}

export function partsMarketRows(
  station: StationDef,
  inventory: PartInventory,
  credits: number,
  tier: Tier,
  lock: (key: PartKey) => string | null = () => null,
): PartMarketRow[] {
  const market = station.services.partsMarket;
  return PART_IDS.map((partId) => {
    const key = partKey(partId, tier);
    const price = partPrice(key, station.ring);
    const inStorage = inventory[key] ?? 0;
    const locked = lock(key);
    const maxBuy = market && price.buy !== null && !locked ? Math.floor(credits / price.buy) : 0;
    return {
      key, partId, tier, locked, name: tx().parts[partId], icon: partIconPath(partId, tier), inStorage,
      buy: price.buy, sell: price.sell, canBuy: maxBuy > 0, canSell: market && inStorage > 0, maxBuy,
    };
  });
}

// ---------------------------------------------------------------------------
// crafting

export interface CraftIngredient {
  resource: ResourceId;
  name: string;
  symbol: string;
  need: number;
  /** Storage + cargo. */
  have: number;
  ok: boolean;
}

export interface CraftRow {
  key: PartKey;
  partId: PartId;
  tier: Tier;
  /** Part variant (M3.5b). */
  variant?: VariantId;
  /** Why the part cannot be crafted (Archive, blueprint), or null. */
  locked: string | null;
  name: string;
  icon: string;
  ingredients: CraftIngredient[];
  credits: { need: number; have: number; ok: boolean };
  /** At least one piece can be crafted now (✓ in the list). */
  canCraft: boolean;
  maxCount: number;
  /** The finished part on the market (null = not sold here, or the station has no parts market). */
  marketBuy: number | null;
  inStorage: number;
  /** How many such parts are fitted on the ship. */
  onShip: number;
  stats: PartStat[];
}

export function craftingRows(state: SimState, station: StationDef, tier: Tier): CraftRow[] {
  const inventory = stationStorage(state, station.id).parts;
  // base parts, then unlocked variants (M3.5b)
  const list: { partId: PartId; variant?: VariantId }[] = PART_IDS.map((partId) => ({ partId }));
  for (const v of VARIANT_IDS) if (partUnlocked(state, partKey(VARIANTS[v].base, tier, v))) list.push({ partId: VARIANTS[v].base, variant: v });
  return list.map(({ partId, variant }) => {
    const key = partKey(partId, tier, variant);
    const locked = lockReason(state, key);
    const q = craftQuote(state, station, key, 1);
    const ingredients = RESOURCE_IDS.filter((r) => (RECIPES[key].resources[r] ?? 0) > 0).map<CraftIngredient>((r) => ({
      resource: r,
      name: tx().resources[r],
      symbol: tx().resourceSymbols[r],
      need: RECIPES[key].resources[r]!,
      have: q.available[r],
      ok: !(q.missing[r] && q.missing[r] > 0),
    }));
    const maxCount = station.services.crafting && !locked ? maxCraftable(state, station, key) : 0;
    return {
      key, partId, tier, locked, name: partBaseName(key), icon: partIconPath(partId, tier),
      ...(variant ? { variant } : {}),
      ingredients,
      credits: { need: q.credits, have: state.credits, ok: q.creditsMissing === 0 },
      canCraft: maxCount > 0,
      maxCount,
      marketBuy: station.services.partsMarket ? partPrice(key, station.ring).buy : null,
      inStorage: inventory[key] ?? 0,
      onShip: state.player.grid.parts.filter((p) => p.partId === partId && p.tier === tier && p.variant === variant).length,
      stats: partStats(key),
    };
  });
}

// ---------------------------------------------------------------------------
// repairs

export interface RepairRow {
  id: number;
  key: PartKey;
  /** "Motor T1". */
  name: string;
  hp: number;
  maxHp: number;
  fraction: number;
  credits: number;
  material: ResourceId;
  amount: number;
  /** "59 kr + 4 Fe". */
  text: string;
}

export interface RepairView {
  damaged: boolean;
  rows: RepairRow[];
  /** Repair everything. */
  all: {
    credits: number;
    autoBuyCredits: number;
    total: number;
    /** The action can be done (the material is there or will be bought, the credits suffice). */
    ok: boolean;
    text: string;
  };
  hull: { current: number; max: number; fraction: number };
}

const costText = (credits: number, res: Partial<Record<ResourceId, number>>): string =>
  [formatCredits(credits), formatResources(res)].filter(Boolean).join(' + ');

export function repairView(state: SimState, station: StationDef, autoBuy: boolean, selection: RepairSelection = 'all'): RepairView {
  const q = repairQuote(state, station, selection, autoBuy);
  const rows = q.lines.map<RepairRow>((l) => ({
    id: l.id, key: l.key, name: partName(l.key), hp: l.hp, maxHp: l.maxHp, fraction: l.hp / l.maxHp,
    credits: l.credits, material: l.material, amount: l.amount, text: costText(l.credits, { [l.material]: l.amount }),
  }));
  return {
    damaged: rows.length > 0,
    rows,
    all: {
      credits: q.credits,
      autoBuyCredits: q.autoBuyCredits,
      total: q.total,
      ok: q.ok && station.services.repair,
      text: costText(q.credits, q.materials),
    },
    hull: { ...q.hull, fraction: q.hull.max > 0 ? q.hull.current / q.hull.max : 1 },
  };
}
