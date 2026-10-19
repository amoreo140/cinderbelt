// Evaluation of a ship design (spec M2, 4.6.6–4.6.8): validation, warnings, the price of changes and the
// properties. The same computation runs in the editor (preview) and in the simulation on commit – one
// source of truth.
//
// Shaped armour (SL2 E2, default (b)): a reshape is an
// installation like a move; damage is the HP missing in full-plate HP, so a removed shaped plate is repaired
// at the full plate's price per HP (`hpMultOf`) and scrapped from its full-equivalent HP; only full-HP parts
// are reshaped in place (`reshapeDamaged`), a damaged one goes remove + place.
import { INSTALL_FEE, partBuyPrice, RECIPES, repairCost, scrapResources, type RingIndex } from '../../data/economy';
import { ALL_PART_KEYS, partDef, partKey, type PartInventory, type PartKey, type Tier } from '../../data/parts';
import { emptyCargo, RESOURCE_IDS, type Cargo, type ResourceId } from '../../data/resources';
import type { ShapeId } from '../../data/shapes';
import type { StationServices } from '../../data/stations';
import type { SimState } from '../Simulation';
import { blastNeighbours, blastOf } from '../combat/partBlast';
import { partUnlocked } from '../discovery/archive';
import { hullBudgetOf, hullPoints, type HullBudget } from '../ship/budget';
import { connectedToCockpit, facing, partCells, validateGrid } from '../ship/grid';
import { currentHp, fullEquivalentHp, fullMaxHp, maxHp } from '../ship/hp';
import { computeProperties, type ShipProperties } from '../ship/properties';
import { hpMultOf, solidContact } from '../ship/shape';
import type { HpMap, PlacedPart, ShipGrid } from '../ship/types';
import { addResources, missingResources, RES_EPS, scaleResources, stationStorage } from '../station/storage';
import type { StationDef } from '../world/stations';
import type { AcquireMode } from './draft';
import { inHangar } from './editor';

/** Below this angular acceleration (rad/s²) the editor warns that the ship turns very slowly. */
export const WEAK_TURNING = 0.5;

/** What the editor and the simulation need from the station and the ship. */
export interface ShipyardContext {
  ring: RingIndex;
  /** repair: false = the station does not repair, damaged removed parts are scrapped (missing = it repairs). */
  services: Pick<StationServices, 'crafting' | 'partsMarket'> & { repair?: boolean };
  credits: number;
  /** Resources in the station storage (crafting and repairs take from here first). */
  storage: Cargo;
  /** The ship's cargo. */
  cargo: Cargo;
  fuel: number;
  /** Parts that can be neither crafted nor bought (Archive, plans – M3.5b); from storage they still mount. */
  locked?: ReadonlySet<PartKey>;
  /** Lock reason text for the UI (filled in by the game layer). */
  lockReasons?: ReadonlyMap<PartKey, string>;
}

export function shipyardContext(state: SimState, station: StationDef): ShipyardContext {
  return {
    ring: station.ring,
    services: { crafting: station.services.crafting, partsMarket: station.services.partsMarket, repair: station.services.repair },
    credits: state.credits,
    storage: { ...stationStorage(state, station.id).resources },
    cargo: { ...state.player.cargo },
    fuel: state.player.fuel,
    locked: new Set(ALL_PART_KEYS.filter((k) => !partUnlocked(state, k))),
  };
}

/** Input of the evaluation – a ShipyardDraft satisfies it. */
export interface DesignInput {
  base: { grid: ShipGrid; hp: HpMap; inventory: PartInventory };
  grid: ShipGrid;
  acquire: Partial<Record<PartKey, AcquireMode>>;
}

/** Errors block the commit (texts in sk.shipyard.errors; the shape ones in sk.shipyardV2.shapes). */
export type DesignError =
  | { code: 'noCockpit' }
  | { code: 'multipleCockpits'; count: number }
  | { code: 'disconnected'; partIds: number[] }
  | { code: 'noForwardEngine' }
  | { code: 'overlap' }
  | { code: 'tooLarge' }
  /** Hull points over the cockpit's budget (spec 3.4.1; replaces the original 100-part limit); `used` may be x.5. */
  | { code: 'hullBudget'; used: number; budget: number; cockpitTier: Tier }
  | { code: 'missingParts'; parts: PartInventory }
  | { code: 'missingResources'; resources: Partial<Cargo> }
  | { code: 'unaffordable'; needed: number; available: number }
  /**
   * SL2 E2 §2.3: a damaged part laid in another shape in place (its max HP changes). Only a crafted op does
   * this – the editor sends remove + place for a damaged plate, so the repair is priced.
   */
  | { code: 'reshapeDamaged'; partId: number };

/** Warnings do not block the commit (texts in sk.shipyard.warnings; the shape one in sk.shipyardV2.shapes). */
export type DesignWarning =
  | { code: 'noBackwardEngine' }
  | { code: 'noLeftEngine' }
  | { code: 'noRightEngine' }
  | { code: 'noMiningLaser' }
  /**
   * Sustained draw exceeds the energy generation (M14): mining = all lasers, combat = cannons at full
   * rate of fire + shield recharge. The worse of the two activities is reported (balance < 0, per second).
   */
  | { code: 'energyDeficit'; balance: number; activity: 'mining' | 'combat' }
  /**
   * Damaged removed parts are not repaired but scrapped (resources into the station storage, M12): the
   * station does not repair (M13), or the player lacks the credits or the material for the repair.
   */
  | { code: 'damagedScrapped'; parts: PartInventory; resources: Partial<Cargo>; reason: ScrapReason }
  | { code: 'cargoOverflow'; cargo: number; capacity: number; toStorage: number }
  | { code: 'fuelOverflow'; fuel: number; capacity: number; lost: number }
  | { code: 'blockedExhaust'; partId: number }
  | { code: 'blockedLaser'; partId: number }
  | { code: 'weakTurning'; accel: number }
  /**
   * A ship from an old save is over its hull budget: it keeps flying and can be trimmed, but nothing can
   * be added until it is under the budget.
   */
  | { code: 'overBudgetLegacy'; used: number; budget: number; cockpitTier: Tier }
  /** Guild loan parts on the draft (ship/loan.ts): they work, but belong to the Guild. */
  | { code: 'loanParts'; partIds: number[]; parts: PartInventory }
  /**
   * SL2 E2: a shaped part touches the ship only with its open sides (its longest solid contact with any
   * neighbour is under ½ cell) – it holds by a tip (the wedge holds only by its tip).
   */
  | { code: 'shapeLooseContact'; partId: number; shape: ShapeId }
  /**
   * M4c: a part that blows up when destroyed (`blast > 0`, the large reactor) sits 8-adjacent to the
   * cockpit – its blast would hit the cockpit (design guidance: keep explosive parts away from the cockpit).
   */
  | { code: 'explosiveNearCockpit'; partId: number; key: PartKey; damage: number };

export type DesignErrorCode = DesignError['code'];
export type DesignWarningCode = DesignWarning['code'];

/** Why damaged removed parts are scrapped. */
export type ScrapReason = 'noRepairService' | 'unaffordable';

/** How a missing part is acquired. */
export type AcquireResolution = AcquireMode | 'unavailable';

export interface RepairLine {
  id: number;
  key: PartKey;
  hp: number;
  maxHp: number;
  credits: number;
  material: ResourceId;
  amount: number;
}

export interface DesignCost {
  /** Total: installation + crafting + buying + repairs of removed parts. */
  credits: number;
  installCount: number;
  installCredits: number;
  craftCredits: number;
  buyCredits: number;
  repairCredits: number;
  /** Resources for crafting and repairs (taken from the storage first, then from the cargo). */
  resources: Partial<Cargo>;
  /** New parts from the station storage. */
  fromStorage: PartInventory;
  /** Removed parts into the storage (repaired). */
  toStorage: PartInventory;
  /** Guild loan parts taken off the hull – they go back to the Guild (no storage, repair or scrap). */
  returned: PartInventory;
  /** Damaged removed parts that are scrapped (M12). */
  scrapped: PartInventory;
  /** Resources from the scrap – added to the station storage. */
  scrap: Partial<Cargo>;
  craft: PartInventory;
  buy: PartInventory;
  /** Parts that cannot be acquired here. */
  missing: PartInventory;
  /** How each missing key is acquired (default or chosen). */
  acquired: Partial<Record<PartKey, AcquireResolution>>;
  repairs: RepairLine[];
  /** Cargo overflow moved into the station storage. */
  cargoToStorage: number;
  cargoMoves: Partial<Cargo>;
  fuelLost: number;
}

export interface DesignReport {
  errors: DesignError[];
  warnings: DesignWarning[];
  /** Properties of the design (null for an empty design). */
  props: ShipProperties | null;
  cost: DesignCost;
  /** Ids of parts not connected to the cockpit (the editor paints them red). */
  disconnected: number[];
  /** Hull budget of the design ("HULL 31½ / 48 pts · T2 cockpit"). */
  hull: HullBudget;
  /** The design can be committed (no errors). */
  canCommit: boolean;
}

const keyOf = (p: PlacedPart): PartKey => partKey(p.partId, p.tier, p.variant);

function addCount(inv: PartInventory, key: PartKey, n: number): void {
  if (n > 0) inv[key] = (inv[key] ?? 0) + n;
}

/** How much of each resource comes from the cargo when the storage is used first. */
function takenFromCargo(needs: Partial<Cargo>, storage: Cargo, cargo: Cargo): Cargo {
  const out = emptyCargo();
  for (const r of RESOURCE_IDS) out[r] = Math.min(cargo[r], Math.max(0, (needs[r] ?? 0) - storage[r]));
  return out;
}

/** Cargo overflow into the storage – in a fixed resource order (iron first). */
export function cargoOverflowMoves(cargo: Cargo, capacity: number): Partial<Cargo> {
  let overflow = RESOURCE_IDS.reduce((s, r) => s + cargo[r], 0) - capacity;
  const moves: Partial<Cargo> = {};
  for (const r of RESOURCE_IDS) {
    if (overflow <= RES_EPS) break;
    const amount = Math.min(cargo[r], overflow);
    if (amount > 0) {
      moves[r] = amount;
      overflow -= amount;
    }
  }
  return moves;
}

/** Parts whose output (nozzle / laser) is covered by another part. */
export function blockedOutputs(grid: ShipGrid): DesignWarning[] {
  const owner = new Map<string, number>();
  for (const p of grid.parts) for (const c of partCells(p)) owner.set(`${c.x},${c.y}`, p.id);
  const warnings: DesignWarning[] = [];
  for (const p of grid.parts) {
    const isEngine = p.partId === 'engine';
    if (!isEngine && !partDef(p.partId, p.tier, p.variant).mining) continue;
    const f = facing(p.rot);
    const dir = isEngine ? { x: -f.x, y: -f.y } : f;
    const blocked = partCells(p).some((c) => {
      const o = owner.get(`${c.x + dir.x},${c.y + dir.y}`);
      return o !== undefined && o !== p.id;
    });
    if (blocked) warnings.push(isEngine ? { code: 'blockedExhaust', partId: p.id } : { code: 'blockedLaser', partId: p.id });
  }
  return warnings;
}

/**
 * The draft only takes parts off a ship that already cannot fly forward (no part added or moved): a
 * stranded player may always strip and sell (saboteur report S1) – the missing engine is not new.
 */
function removalOnlyFromStranded(input: DesignInput): boolean {
  const base = new Map(input.base.grid.parts.map((p) => [p.id, p]));
  const onlyRemoves = input.grid.parts.every((p) => {
    const b = base.get(p.id);
    return !!b && sameLaying(b, p);
  });
  return onlyRemoves && input.grid.parts.length < input.base.grid.parts.length && computeProperties(input.base.grid).thrust.forward <= 0;
}

/** Same anchor, rotation and shape – the part was not reinstalled. */
const sameLaying = (a: PlacedPart, b: PlacedPart): boolean => a.x === b.x && a.y === b.y && a.rot === b.rot && a.shape === b.shape;

/**
 * `reshapeDamaged` (§2.3): a base part laid in another shape while below its max HP. A shape change that
 * keeps the max HP (wing L ↔ wing R ↔ full, area 1) carries the HP over unchanged and is allowed – Shift+M
 * of a damaged wing stays possible; every other one would rescale the damage (a free repair).
 */
function reshapeErrors(input: DesignInput): DesignError[] {
  const base = new Map(input.base.grid.parts.map((p) => [p.id, p]));
  const errors: DesignError[] = [];
  for (const p of input.grid.parts) {
    const orig = base.get(p.id);
    if (!orig || orig.shape === p.shape || maxHp(orig) === maxHp(p)) continue;
    if (currentHp(input.base.hp, orig) < maxHp(orig)) errors.push({ code: 'reshapeDamaged', partId: p.id });
  }
  return errors;
}

/** Shortest solid contact (in cells) a shaped part needs with some neighbour not to "hold by a tip". */
export const LOOSE_CONTACT = 0.5;
const CONTACT_EPS = 1e-9;
const NEIGHBOURS = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
] as const;

/**
 * `explosiveNearCockpit` for every part with a blast whose blast would reach a cockpit: the blast's own
 * adjacency (`blastNeighbours`, per cell, diagonals included), so the warning matches what a blast hits.
 */
export function explosivesNearCockpit(grid: ShipGrid): DesignWarning[] {
  const cockpits = new Set(grid.parts.filter((p) => p.partId === 'cockpit').map((p) => p.id));
  if (cockpits.size === 0) return [];
  const warnings: DesignWarning[] = [];
  for (const p of grid.parts) {
    const damage = blastOf(p);
    if (damage > 0 && blastNeighbours(grid, p).some((id) => cockpits.has(id))) {
      warnings.push({ code: 'explosiveNearCockpit', partId: p.id, key: partKey(p.partId, p.tier, p.variant), damage });
    }
  }
  return warnings;
}

/**
 * `shapeLooseContact` for every shaped part whose best solid contact with an edge neighbour is under
 * `LOOSE_CONTACT`. A part with no neighbour at all is the `disconnected` error's business. Grids without
 * shapes return at once.
 */
export function looseShapes(grid: ShipGrid): DesignWarning[] {
  if (!grid.parts.some((p) => p.shape !== undefined)) return [];
  const owner = new Map<string, PlacedPart>();
  for (const p of grid.parts) for (const c of partCells(p)) owner.set(`${c.x},${c.y}`, p);
  const warnings: DesignWarning[] = [];
  for (const p of grid.parts) {
    if (p.shape === undefined) continue;
    const seen = new Set<number>();
    let best = 0;
    for (const c of partCells(p)) {
      for (const d of NEIGHBOURS) {
        const q = owner.get(`${c.x + d.x},${c.y + d.y}`);
        if (!q || q.id === p.id || seen.has(q.id)) continue;
        seen.add(q.id);
        best = Math.max(best, solidContact(p, q));
      }
    }
    if (seen.size > 0 && best < LOOSE_CONTACT - CONTACT_EPS) warnings.push({ code: 'shapeLooseContact', partId: p.id, shape: p.shape });
  }
  return warnings;
}

function structuralErrors(grid: ShipGrid, props: ShipProperties | null, allowEngineless = false): { errors: DesignError[]; disconnected: number[] } {
  const errors: DesignError[] = [];
  const cockpits = grid.parts.filter((p) => p.partId === 'cockpit').length;
  let disconnected: number[] = [];
  if (cockpits === 0) errors.push({ code: 'noCockpit' });
  if (cockpits > 1) errors.push({ code: 'multipleCockpits', count: cockpits });
  if (cockpits >= 1) {
    const connected = connectedToCockpit(grid);
    disconnected = grid.parts.filter((p) => !connected.has(p.id)).map((p) => p.id);
    if (disconnected.length > 0) errors.push({ code: 'disconnected', partIds: disconnected });
  }
  if (!props || (props.thrust.forward <= 0 && !allowEngineless)) errors.push({ code: 'noForwardEngine' });
  if (validateGrid(grid).includes('overlap')) errors.push({ code: 'overlap' });
  if (grid.parts.some((p) => partCells(p).some((c) => !inHangar(c.x, c.y)))) errors.push({ code: 'tooLarge' });
  return { errors, disconnected };
}

/**
 * Hull budget: over the budget is an error, except for an old ship that was over it before the edit – it
 * may be trimmed and rearranged (a warning), but nothing can be added.
 */
function hullBudgetCheck(input: DesignInput, hull: HullBudget): { error: DesignError | null; warning: DesignWarning | null } {
  if (hull.budget === null || hull.cockpitTier === null || !hull.over) return { error: null, warning: null };
  const detail = { used: hull.used, budget: hull.budget, cockpitTier: hull.cockpitTier };
  const baseIds = new Set(input.base.grid.parts.map((p) => p.id));
  const legacy = hullPoints(input.base.grid) > hull.budget;
  const adds = input.grid.parts.some((p) => !baseIds.has(p.id));
  if (legacy && !adds && hull.used <= hullPoints(input.base.grid)) return { error: null, warning: { code: 'overBudgetLegacy', ...detail } };
  return { error: { code: 'hullBudget', ...detail }, warning: null };
}

/** Sustained energy draw per second: mining with every laser and combat (cannons + shield recharge). */
export function energyDraw(props: ShipProperties): { mining: number; combat: number } {
  const mining = props.lasers.reduce((s, l) => s + l.energyPerSecond, 0);
  const cannons = props.weapons.reduce((s, w) => s + w.energyPerShot * w.fireRate, 0);
  return { mining, combat: cannons + props.shield.regen * props.shield.energyPerPoint };
}

const ECONOMIC_ERRORS: readonly DesignErrorCode[] = ['unaffordable', 'missingResources'];
const economicError = (r: DesignReport): boolean => r.errors.some((e) => ECONOMIC_ERRORS.includes(e.code));

/**
 * Evaluates the design. A damaged removed part is repaired and goes into the storage; when the station
 * does not repair, or the repair would make the design unaffordable (and it is affordable without it), it
 * is scrapped with the warning `damagedScrapped` (M12, M13). The storage holds only parts at full HP.
 */
export function evaluateDesign(input: DesignInput, ctx: ShipyardContext): DesignReport {
  if (ctx.services.repair === false) return evaluateWith(input, ctx, 'noRepairService');
  const repaired = evaluateWith(input, ctx, null);
  if (repaired.cost.repairs.length === 0 || !economicError(repaired)) return repaired;
  const scrapped = evaluateWith(input, ctx, 'unaffordable');
  return economicError(scrapped) ? repaired : scrapped;
}

function evaluateWith(input: DesignInput, ctx: ShipyardContext, scrapReason: ScrapReason | null): DesignReport {
  const { base, grid } = input;
  const props = grid.parts.length > 0 ? computeProperties(grid) : null;
  const { errors, disconnected } = structuralErrors(grid, props, removalOnlyFromStranded(input));
  const hull = hullBudgetOf(grid);
  const budget = hullBudgetCheck(input, hull);
  if (budget.error) errors.push(budget.error);

  // --- difference against the original ship ---
  const baseById = new Map(base.grid.parts.map((p) => [p.id, p]));
  const draftIds = new Set(grid.parts.map((p) => p.id));
  const removed: PartInventory = {};
  const needed: PartInventory = {};
  let installCount = 0;
  for (const p of grid.parts) {
    const orig = baseById.get(p.id);
    if (!orig) {
      addCount(needed, keyOf(p), 1);
      installCount++;
    } else if (!sameLaying(orig, p)) {
      // moved, turned or reshaped – one installation however many of these changed
      installCount++;
    }
  }
  errors.push(...reshapeErrors(input));
  const repairs: RepairLine[] = [];
  const scrapped: PartInventory = {};
  const returned: PartInventory = {};
  let scrap: Partial<Cargo> = {};
  for (const p of base.grid.parts) {
    if (draftIds.has(p.id)) continue;
    // a Guild loan part goes back to the Guild: never into storage, never repaired or scrapped, and it
    // never cancels against a new part of the same type (that would turn a loan into an owned part)
    if (p.loan) {
      addCount(returned, keyOf(p), 1);
      continue;
    }
    const hp = currentHp(base.hp, p);
    const max = maxHp(p);
    if (hp < max && scrapReason) {
      // scrap never cancels against a new part of the same type (it would be "repaired" for free); a shaped
      // plate scraps from its full-equivalent HP (identical to hp / max without a shape)
      addCount(scrapped, keyOf(p), 1);
      scrap = addResources(scrap, scrapResources(keyOf(p), fullEquivalentHp(p, hp), fullMaxHp(p)));
      continue;
    }
    addCount(removed, keyOf(p), 1);
    if (hp < max) {
      // a shaped plate's missing HP costs what it costs on the full plate (repair parity, §2.3)
      const c = repairCost(keyOf(p), hp, max, ctx.ring, hpMultOf(p));
      repairs.push({ id: p.id, key: keyOf(p), hp, maxHp: max, credits: c.credits, material: c.material, amount: c.amount });
    }
  }

  // a removed part and a placed part of the same type cancel out
  const toStorage: PartInventory = {};
  const fromStorage: PartInventory = {};
  const craft: PartInventory = {};
  const buy: PartInventory = {};
  const missing: PartInventory = {};
  const acquired: Partial<Record<PartKey, AcquireResolution>> = {};
  const repairResources = repairs.reduce<Partial<Cargo>>((acc, r) => addResources(acc, { [r.material]: r.amount }), {});
  const available = emptyCargo();
  for (const r of RESOURCE_IDS) available[r] = ctx.storage[r] + ctx.cargo[r];
  // resource pool for the default crafting – repairs come first
  const pool = emptyCargo();
  for (const r of RESOURCE_IDS) pool[r] = available[r] - (repairResources[r] ?? 0);
  let craftResources: Partial<Cargo> = {};
  let craftCredits = 0;
  let buyCredits = 0;

  for (const key of ALL_PART_KEYS) {
    const rem = removed[key] ?? 0;
    const need = needed[key] ?? 0;
    const cancel = Math.min(rem, need);
    addCount(toStorage, key, rem - cancel);
    const stillNeeded = need - cancel;
    if (stillNeeded <= 0) continue;
    const stock = Math.min(stillNeeded, base.inventory[key] ?? 0);
    addCount(fromStorage, key, stock);
    const m = stillNeeded - stock;
    if (m <= 0) continue;

    const recipe = scaleResources(RECIPES[key].resources, m);
    const locked = ctx.locked?.has(key) ?? false;
    const buyPrice = ctx.services.partsMarket && !locked ? partBuyPrice(key, ctx.ring) : null;
    const canCraft = ctx.services.crafting && !locked;
    const fits = RESOURCE_IDS.every((r) => (recipe[r] ?? 0) <= pool[r] + RES_EPS);
    const choice = input.acquire[key];
    let mode: AcquireResolution;
    if (choice === 'craft') mode = canCraft ? 'craft' : 'unavailable';
    else if (choice === 'buy') mode = buyPrice !== null ? 'buy' : 'unavailable';
    else if (canCraft && fits) mode = 'craft';
    else if (buyPrice !== null) mode = 'buy';
    else mode = 'unavailable';
    acquired[key] = mode;

    if (mode === 'craft') {
      addCount(craft, key, m);
      craftCredits += RECIPES[key].credits * m;
      craftResources = addResources(craftResources, recipe);
      for (const r of RESOURCE_IDS) pool[r] -= recipe[r] ?? 0;
    } else if (mode === 'buy') {
      addCount(buy, key, m);
      buyCredits += buyPrice! * m;
    } else {
      addCount(missing, key, m);
    }
  }

  const resources = addResources(craftResources, repairResources);
  const repairCredits = repairs.reduce((s, r) => s + r.credits, 0);
  const installCredits = installCount * INSTALL_FEE;
  const credits = installCredits + craftCredits + buyCredits + repairCredits;

  // --- cargo and fuel after the rebuild ---
  const fromCargo = takenFromCargo(resources, ctx.storage, ctx.cargo);
  const cargoAfter = emptyCargo();
  for (const r of RESOURCE_IDS) cargoAfter[r] = ctx.cargo[r] - fromCargo[r];
  const cargoAmount = RESOURCE_IDS.reduce((s, r) => s + cargoAfter[r], 0);
  const cargoCapacity = props?.cargoCapacity ?? 0;
  const cargoMoves = cargoOverflowMoves(cargoAfter, cargoCapacity);
  const cargoToStorage = RESOURCE_IDS.reduce((s, r) => s + (cargoMoves[r] ?? 0), 0);
  const fuelCapacity = props?.fuelCapacity ?? 0;
  const fuelLost = Math.max(0, ctx.fuel - fuelCapacity);

  // --- economic errors ---
  if (Object.keys(missing).length > 0) errors.push({ code: 'missingParts', parts: missing });
  const short = missingResources(resources, available);
  if (Object.keys(short).length > 0) errors.push({ code: 'missingResources', resources: short });
  if (credits > ctx.credits) errors.push({ code: 'unaffordable', needed: credits, available: ctx.credits });

  // --- warnings ---
  const warnings: DesignWarning[] = [];
  if (budget.warning) warnings.push(budget.warning);
  if (scrapReason && Object.keys(scrapped).length > 0) {
    warnings.push({ code: 'damagedScrapped', parts: scrapped, resources: scrap, reason: scrapReason });
  }
  if (props) {
    if (props.thrust.backward <= 0) warnings.push({ code: 'noBackwardEngine' });
    if (props.thrust.left <= 0) warnings.push({ code: 'noLeftEngine' });
    if (props.thrust.right <= 0) warnings.push({ code: 'noRightEngine' });
    if (props.lasers.length === 0) warnings.push({ code: 'noMiningLaser' });
    const draw = energyDraw(props);
    const activity = draw.combat > draw.mining ? 'combat' : 'mining';
    const balance = props.energyGen - draw[activity];
    if (balance < -RES_EPS) warnings.push({ code: 'energyDeficit', balance, activity });
    if (cargoToStorage > RES_EPS) {
      warnings.push({ code: 'cargoOverflow', cargo: cargoAmount, capacity: cargoCapacity, toStorage: cargoToStorage });
    }
    if (fuelLost > RES_EPS) warnings.push({ code: 'fuelOverflow', fuel: ctx.fuel, capacity: fuelCapacity, lost: fuelLost });
    warnings.push(...blockedOutputs(grid));
    warnings.push(...looseShapes(grid));
    warnings.push(...explosivesNearCockpit(grid));
    const loans = grid.parts.filter((p) => p.loan);
    if (loans.length > 0) {
      const parts: PartInventory = {};
      for (const p of loans) addCount(parts, keyOf(p), 1);
      warnings.push({ code: 'loanParts', partIds: loans.map((p) => p.id), parts });
    }
    const accel = props.inertia > 0 ? props.torque / props.inertia : 0;
    if (accel < WEAK_TURNING) warnings.push({ code: 'weakTurning', accel });
  }

  return {
    errors,
    warnings,
    props,
    disconnected,
    hull,
    canCommit: errors.length === 0,
    cost: {
      credits,
      installCount,
      installCredits,
      craftCredits,
      buyCredits,
      repairCredits,
      resources,
      fromStorage,
      toStorage,
      returned,
      scrapped,
      scrap,
      craft,
      buy,
      missing,
      acquired,
      repairs,
      cargoToStorage: props ? cargoToStorage : 0,
      cargoMoves: props ? cargoMoves : {},
      fuelLost: props ? fuelLost : 0,
    },
  };
}
