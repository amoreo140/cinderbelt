// Data for the shipyard screen (palette, properties panel, checks, cost of changes) – pure functions
// over the simulation. The UI only draws them; numbers and texts are computed (and tested) here.
import { arcsWidth, CANNON_HALF_ARC, effectiveArcs } from '../sim/combat/arcs';
import { SHAPE_IDS, SHAPEABLE_PARTS, type ShapeId } from '../data/shapes';
import { partBuyPrice, RECIPES, INSTALL_FEE } from '../data/economy';
import { PART_IDS, parsePartKey, partDef, partKey, type PartId, type PartInventory, type PartKey, type Tier } from '../data/parts';
import { RESOURCE_IDS, type Cargo } from '../data/resources';
import { tx } from '../i18n';
import type { CoreTexts } from '../i18n/sk';
import { type GlossaryId, type WorkshopStatId } from '../i18n/skParts';
import { VARIANTS, VARIANT_IDS, type VariantId } from '../data/variants';
import { partIconPath } from '../render/assets/catalog';
import type { GameActionInput } from '../sim/commands';
import { partCells } from '../sim/ship/grid';
import { hullHp, maxHp } from '../sim/ship/hp';
import { computeProperties, type ShipProperties } from '../sim/ship/properties';
import { turnTime180 } from '../sim/ship/turnTime';
import { shapeHullPoints } from '../sim/ship/shape';
import type { PlacedPart, Rotation, ShipGrid } from '../sim/ship/types';
import { draftBaseHash } from '../sim/shipyard/commit';
import {
  evaluateDesign,
  type DesignCost,
  type DesignError,
  type DesignErrorCode,
  type DesignInput,
  type DesignReport,
  type DesignWarning,
  type DesignWarningCode,
  type ShipyardContext,
} from '../sim/shipyard/design';
import { canRedo, canUndo, draftOps, isDraftDirty, type ShipyardDraft } from '../sim/shipyard/draft';
import { checkPlacement, type PlacementError } from '../sim/shipyard/editor';
import { addResources, scaleResources } from '../sim/station/storage';
import { formatAmount, formatCredits, formatInt } from '../ui/format';

// ---------------------------------------------------------------------------
// formatting

/** "Cargo hold T1". */
export const partName = (key: PartKey): string => {
  const { partId, tier, variant } = parsePartKey(key);
  return variant ? `${tx().parts[partId]} – ${tx().discovery.variants[variant]} T${tier}` : `${tx().parts[partId]} T${tier}`;
};

/** Whole numbers without decimals, otherwise one decimal place (decimal separator per language). */
const formatQty = (v: number): string => (Math.abs(v - Math.round(v)) < 1e-9 ? formatInt(v) : formatAmount(v));

/** "25 Fe, 15 Cu" (in resource order, positive entries only). */
export function formatResources(res: Partial<Cargo>): string {
  return RESOURCE_IDS.filter((r) => (res[r] ?? 0) > 0)
    .map((r) => `${formatQty(res[r]!)} ${tx().resourceSymbols[r]}`)
    .join(', ');
}

/** "2× Armor T1, 1× Engine T2". */
export function formatParts(inv: PartInventory): string {
  return (Object.entries(inv) as [PartKey, number][])
    .filter(([, n]) => n > 0)
    .map(([key, n]) => `${n}× ${partName(key)}`)
    .join(', ');
}

/** A placement error (or an older placement code a commit failure may still carry) as text. */
export const placementMessage = (error: PlacementError | keyof CoreTexts['shipyard']['placement']): string => tx().shipyard.placement[error];

// ---------------------------------------------------------------------------
// part parameters

export type PartStatId =
  | 'mass' | 'hp' | 'thrust' | 'torque' | 'cargo' | 'fuel' | 'battery' | 'energyGen' | 'radar'
  | 'miningRate' | 'miningRange' | 'miningEnergy'
  | 'damage' | 'fireRate' | 'weaponRange' | 'shotEnergy' | 'shieldCapacity' | 'shieldRegen' | 'shieldDelay'
  | 'tractorRange' | 'tractorParts' | 'tractorEnergy' | 'arc'
  // M4c: the large reactor's blast, the repair module and the refinery (labels in skParts `stats`)
  | WorkshopStatId;

export interface PartStat {
  id: PartStatId;
  label: string;
  /** Plain-language explanation of the label (glossary tooltip). */
  tip: string;
  value: number;
}

/** The shipyard stat label of each part parameter (read at render time – the language can change). */
const STAT_KEY: Record<Exclude<PartStatId, WorkshopStatId>, keyof CoreTexts['shipyard']['stats']> = {
  mass: 'mass',
  hp: 'partHp',
  thrust: 'thrust',
  torque: 'torque',
  cargo: 'cargo',
  fuel: 'fuel',
  battery: 'battery',
  energyGen: 'energyGen',
  radar: 'radar',
  miningRate: 'miningRate',
  miningRange: 'miningRange',
  miningEnergy: 'miningEnergy',
  damage: 'damage',
  fireRate: 'fireRate',
  weaponRange: 'weaponRange',
  shotEnergy: 'shotEnergy',
  shieldCapacity: 'shieldCapacity',
  shieldRegen: 'shieldRegen',
  shieldDelay: 'shieldDelay',
  tractorRange: 'tractorRange',
  tractorParts: 'tractorParts',
  tractorEnergy: 'tractorEnergy',
  arc: 'arc',
};

const isWorkshopStat = (id: PartStatId): id is WorkshopStatId => !(id in STAT_KEY);
const statLabel = (id: PartStatId): string => (isWorkshopStat(id) ? tx().partInfo.stats[id] : tx().shipyard.stats[STAT_KEY[id]]);

function statValues(partId: PartId, tier: Tier, variant?: VariantId): [PartStatId, number][] {
  const d = partDef(partId, tier, variant);
  const out: [PartStatId, number][] = [['mass', d.mass], ['hp', d.hp]];
  if (d.thrust) out.push(['thrust', d.thrust]);
  if (d.torque) out.push(['torque', d.torque]);
  if (d.cargo) out.push(['cargo', d.cargo]);
  if (d.fuel) out.push(['fuel', d.fuel]);
  if (d.battery) out.push(['battery', d.battery]);
  if (d.energyGen) out.push(['energyGen', d.energyGen]);
  if (d.radarRange) out.push(['radar', d.radarRange]);
  if (d.mining) {
    out.push(['miningRate', d.mining.rate], ['miningRange', d.mining.range], ['miningEnergy', d.mining.energyPerSecond]);
  }
  if (d.weapon) {
    const w = d.weapon;
    out.push(['damage', w.damage], ['fireRate', w.fireRate], ['weaponRange', w.range], ['shotEnergy', w.energyPerShot], ['arc', Math.round((2 * CANNON_HALF_ARC * 180) / Math.PI)]);
  }
  if (d.shield) {
    out.push(['shieldCapacity', d.shield.capacity], ['shieldRegen', d.shield.regen], ['shieldDelay', d.shield.regenDelay]);
  }
  if (d.tractor) {
    out.push(['tractorRange', d.tractor.range], ['tractorParts', d.tractor.maxParts], ['tractorEnergy', d.tractor.energyPerSecond]);
  }
  if (d.repair) out.push(['repairRate', d.repair.hpPerSecond], ['repairEnergy', d.repair.energyPerSecond]);
  if (d.refinery) out.push(['refineOre', d.refinery.orePerSecond], ['refineIce', d.refinery.icePerSecond], ['refineEnergy', d.refinery.energyPerSecond]);
  if (d.blast) out.push(['blast', d.blast]);
  return out;
}

/** Parameters of one part (crafting, market, tooltip). */
export function partStats(key: PartKey): PartStat[] {
  const { partId, tier, variant } = parsePartKey(key);
  return statValues(partId, tier, variant).map(([id, value]) => ({ id, label: statLabel(id), tip: tx().partInfo.glossary[id], value }));
}

export interface PartStatCompare {
  id: PartStatId;
  label: string;
  tip: string;
  t1: number;
  t2: number;
}

/** T1 and T2 side by side (palette tooltip). */
export function partStatCompare(partId: PartId, variant?: VariantId): PartStatCompare[] {
  const t2 = new Map(statValues(partId, 2, variant));
  return statValues(partId, 1, variant).map(([id, v]) => ({ id, label: statLabel(id), tip: tx().partInfo.glossary[id], t1: v, t2: t2.get(id) ?? 0 }));
}

// ---------------------------------------------------------------------------
// palette

export type PaletteSource = 'storage' | 'craft' | 'buy' | 'unavailable';

export interface PaletteEntry {
  key: PartKey;
  partId: PartId;
  tier: Tier;
  /** Part variant from a blueprint or the Archive (M3.5b). */
  variant?: VariantId;
  /** Key 1–9. */
  hotkey: number;
  name: string;
  /** Icon relative to BASE_URL (use assetUrl). */
  icon: string;
  /** Pieces available in the draft: storage + removed from the ship − newly placed (can be negative). */
  available: number;
  /** Pieces in station storage when the editor was opened. */
  inStorage: number;
  /** Cockpit – max. 1 per ship (◆). */
  unique: boolean;
  /** Where the next placed piece would come from (`$` = not from storage). */
  source: PaletteSource;
  /** Recipe, if the station has crafting. */
  craft: { resources: Partial<Cargo>; credits: number } | null;
  /** Price of the finished part on the market (null = not sold here). */
  buyPrice: number | null;
  /** "Craft: 25 Fe, 15 Cu, 650 cr" / "Buy: 1,285 cr" / "Cannot be obtained…"; empty when in storage. */
  tooltip: string;
  /** What the part does in plain words (hover tooltip of the palette row). */
  about: string;
  /** Parameters T1 vs T2. */
  compare: PartStatCompare[];
}

/** Part counts in the draft compared to the original ship (by id). */
function diffCounts(input: DesignInput): { removed: PartInventory; added: PartInventory } {
  const baseIds = new Set(input.base.grid.parts.map((p) => p.id));
  const draftIds = new Set(input.grid.parts.map((p) => p.id));
  const removed: PartInventory = {};
  const added: PartInventory = {};
  for (const p of input.base.grid.parts) {
    if (!draftIds.has(p.id)) removed[partKey(p.partId, p.tier, p.variant)] = (removed[partKey(p.partId, p.tier, p.variant)] ?? 0) + 1;
  }
  for (const p of input.grid.parts) {
    if (!baseIds.has(p.id)) added[partKey(p.partId, p.tier, p.variant)] = (added[partKey(p.partId, p.tier, p.variant)] ?? 0) + 1;
  }
  return { removed, added };
}

/** Part palette of the selected tier. `report` can be passed in if it is already computed. */
export function buildPalette(input: DesignInput, ctx: ShipyardContext, tier: Tier, report?: DesignReport): PaletteEntry[] {
  const { removed, added } = diffCounts(input);
  const cost = (report ?? evaluateDesign(input, ctx)).cost;
  // resources still left after the crafting and repairs already included in the draft
  const left: Cargo = { iron: 0, copper: 0, ice: 0, titanium: 0 };
  for (const r of RESOURCE_IDS) left[r] = ctx.storage[r] + ctx.cargo[r] - (cost.resources[r] ?? 0);

  // base parts, followed by the variants the player has unlocked or in storage (M3.5b)
  const keys: { partId: PartId; variant?: VariantId }[] = PART_IDS.map((partId) => ({ partId }));
  for (const v of VARIANT_IDS) {
    const key = partKey(VARIANTS[v].base, tier, v);
    const have = (input.base.inventory[key] ?? 0) + (removed[key] ?? 0) - (added[key] ?? 0);
    if (!ctx.locked?.has(key) || have > 0 || (added[key] ?? 0) > 0) keys.push({ partId: VARIANTS[v].base, variant: v });
  }
  return keys.map(({ partId, variant }, i) => {
    const key = partKey(partId, tier, variant);
    const inStorage = input.base.inventory[key] ?? 0;
    const available = inStorage + (removed[key] ?? 0) - (added[key] ?? 0);
    const recipe = RECIPES[key];
    const locked = ctx.locked?.has(key) ?? false;
    const craft = ctx.services.crafting && !locked ? { resources: { ...recipe.resources }, credits: recipe.credits } : null;
    const buyPrice = ctx.services.partsMarket && !locked ? partBuyPrice(key, ctx.ring) : null;
    const fits = RESOURCE_IDS.every((r) => (recipe.resources[r] ?? 0) <= left[r] + 1e-9);
    const choice = input.acquire[key];
    let source: PaletteSource;
    if (available > 0) source = 'storage';
    else if (choice === 'buy' && buyPrice !== null) source = 'buy';
    else if (choice === 'craft' && craft) source = 'craft';
    else if (craft && fits) source = 'craft';
    else if (buyPrice !== null) source = 'buy';
    else source = 'unavailable';
    const tooltip =
      source === 'storage' ? ''
      : source === 'craft' ? tx().shipyard.palette.craft(formatResources(recipe.resources), formatCredits(recipe.credits))
      : source === 'buy' ? tx().shipyard.palette.buy(formatCredits(buyPrice!))
      : locked ? (ctx.lockReasons?.get(key) ?? tx().shipyard.palette.unavailable)
      : tx().shipyard.palette.unavailable;
    const name = variant ? `${tx().parts[partId]} – ${tx().discovery.variants[variant]}` : tx().parts[partId];
    return {
      key, partId, tier, hotkey: i + 1, name, icon: partIconPath(partId, tier),
      available, inStorage, unique: partId === 'cockpit', source, craft, buyPrice, tooltip,
      about: variant ? [tx().partInfo.parts[partId].what, tx().partInfo.variants[variant]].join('\n') : tx().partInfo.parts[partId].what,
      compare: partStatCompare(partId, variant),
      ...(variant ? { variant } : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// properties panel

export type StatId =
  | 'mass' | 'parts' | 'thrustForward' | 'thrustBackward' | 'thrustLeft' | 'thrustRight' | 'turning' | 'turn180'
  | 'cargo' | 'fuel' | 'battery' | 'energyGen' | 'energyUse' | 'energyBalance' | 'radar' | 'hp' | 'cannonArc';

export type StatGroup = 'general' | 'thrust' | 'capacity' | 'energy';
export type Trend = 'better' | 'worse' | 'same';

export interface StatRow {
  id: StatId;
  group: StatGroup;
  label: string;
  value: number;
  /** Difference from the ship as it was when the editor was opened. */
  delta: number;
  /** Green / red for Δ (for thrust and turning based on acceleration). */
  trend: Trend;
  /** Thrust: acceleration thrust / mass (u/s², empty cargo); turning: torque / inertia (rad/s²). */
  secondary?: { value: number; delta: number };
  /** Red highlight (negative energy balance). */
  alert?: boolean;
  /** The value does not exist (turn180: the ship cannot turn) – value and delta are 0, show "none". */
  none?: boolean;
  /** Plain-language explanation of the label (glossary tooltip). */
  tip: string;
}

/** Glossary entry behind each label of the properties panel. */
const STAT_TIP: Record<StatId, GlossaryId> = {
  mass: 'mass', parts: 'parts', thrustForward: 'thrust', thrustBackward: 'thrust', thrustLeft: 'thrust', thrustRight: 'thrust',
  turning: 'turning', turn180: 'turn180', cargo: 'cargo', fuel: 'fuel', battery: 'battery', energyGen: 'energyGen', energyUse: 'energyUse',
  energyBalance: 'energyMining', radar: 'radar', hp: 'hpTotal', cannonArc: 'cannonArc',
};

const EPS = 1e-9;
const trendOf = (delta: number, higherIsBetter: boolean | null): Trend =>
  higherIsBetter === null || Math.abs(delta) < EPS ? 'same' : (delta > 0) === higherIsBetter ? 'better' : 'worse';

interface Summary {
  mass: number;
  parts: number;
  thrust: Record<'forward' | 'backward' | 'left' | 'right', number>;
  torque: number;
  inertia: number;
  cargo: number;
  fuel: number;
  battery: number;
  energyGen: number;
  energyUse: number;
  radar: number;
  hp: number;
  /** Sum of the effective cannon arcs (degrees) – what the cannons really cover with this layout. */
  cannonArc: number;
}

function summarize(grid: ShipGrid): Summary {
  const props: ShipProperties | null = grid.parts.length > 0 ? computeProperties(grid) : null;
  return {
    mass: props?.mass ?? 0,
    parts: grid.parts.length,
    thrust: props ? { ...props.thrust } : { forward: 0, backward: 0, left: 0, right: 0 },
    torque: props?.torque ?? 0,
    inertia: props?.inertia ?? 0,
    cargo: props?.cargoCapacity ?? 0,
    fuel: props?.fuelCapacity ?? 0,
    battery: props?.batteryCapacity ?? 0,
    energyGen: props?.energyGen ?? 0,
    energyUse: props ? props.lasers.reduce((s, l) => s + l.energyPerSecond, 0) : 0,
    radar: props?.radarRange ?? 0,
    hp: hullHp(grid, new Map()).max,
    cannonArc: props ? Math.round((props.weapons.reduce((s, w) => s + arcsWidth(w.arcs), 0) * 180) / Math.PI) : 0,
  };
}

const ratio = (a: number, b: number): number => (b > 0 ? a / b : 0);

/** Row label: the panel's own labels; the turn time (SL2 E1) has its text in the shipyard texts. */
const statRowLabel = (id: StatId): string => (id === 'turn180' ? tx().shipyardV2.turn180.label : tx().shipyard.stats[id]);

/** Rows of the live properties panel (draft vs. original ship). */
export function buildStatsPanel(grid: ShipGrid, baseGrid: ShipGrid): StatRow[] {
  const now = summarize(grid);
  const was = summarize(baseGrid);
  const row = (id: StatId, group: StatGroup, value: number, base: number, higherIsBetter: boolean | null): StatRow => ({
    id, group, label: statRowLabel(id), value, delta: value - base, trend: trendOf(value - base, higherIsBetter),
    tip: tx().partInfo.glossary[STAT_TIP[id]],
  });
  const withAccel = (id: StatId, group: StatGroup, value: number, base: number, accel: number, baseAccel: number): StatRow => ({
    ...row(id, group, value, base, true),
    trend: trendOf(accel - baseAccel, true),
    secondary: { value: accel, delta: accel - baseAccel },
  });
  const thrust = (id: StatId, dir: keyof Summary['thrust']): StatRow =>
    withAccel(id, 'thrust', now.thrust[dir], was.thrust[dir], ratio(now.thrust[dir], now.mass), ratio(was.thrust[dir], was.mass));
  const balance = now.energyGen - now.energyUse;
  // seconds for a 180° turn (lower is better); a ship without torque cannot turn at all
  const turnNow = turnTime180(now.torque, now.inertia);
  const turnWas = turnTime180(was.torque, was.inertia);
  const turn180: StatRow =
    turnNow !== null && turnWas !== null
      ? row('turn180', 'thrust', turnNow, turnWas, false)
      : {
          ...row('turn180', 'thrust', turnNow ?? 0, turnNow ?? 0, false),
          trend: turnNow === turnWas ? 'same' : turnNow === null ? 'worse' : 'better',
          ...(turnNow === null ? { none: true } : {}),
        };
  return [
    row('mass', 'general', now.mass, was.mass, false),
    row('parts', 'general', now.parts, was.parts, null),
    thrust('thrustForward', 'forward'),
    thrust('thrustBackward', 'backward'),
    thrust('thrustLeft', 'left'),
    thrust('thrustRight', 'right'),
    withAccel('turning', 'thrust', now.torque, was.torque, ratio(now.torque, now.inertia), ratio(was.torque, was.inertia)),
    turn180,
    row('cargo', 'capacity', now.cargo, was.cargo, true),
    row('fuel', 'capacity', now.fuel, was.fuel, true),
    row('battery', 'capacity', now.battery, was.battery, true),
    row('energyGen', 'energy', now.energyGen, was.energyGen, true),
    row('energyUse', 'energy', now.energyUse, was.energyUse, false),
    { ...row('energyBalance', 'energy', balance, was.energyGen - was.energyUse, true), alert: balance < 0 },
    row('radar', 'capacity', now.radar, was.radar, true),
    row('hp', 'general', now.hp, was.hp, true),
    row('cannonArc', 'general', now.cannonArc, was.cannonArc, true),
  ];
}

// ---------------------------------------------------------------------------
// checks (errors and warnings)

export interface DesignMessage {
  severity: 'error' | 'warning';
  code: DesignErrorCode | DesignWarningCode;
  /** Path to the key in sk.ts, e.g. 'shipyard.errors.noCockpit'. */
  i18nKey: string;
  text: string;
  /** Parts the editor should highlight. */
  partIds: number[];
}

function errorText(e: DesignError): string {
  const t = tx().shipyard.errors;
  switch (e.code) {
    case 'noCockpit':
    case 'noForwardEngine':
    case 'overlap':
    case 'tooLarge':
    case 'multipleCockpits':
      return t[e.code];
    case 'disconnected':
      return t.disconnected(e.partIds.length);
    case 'hullBudget':
      return t.hullBudget(e.cockpitTier, e.budget, e.used);
    case 'unaffordable':
      return t.unaffordable(formatCredits(e.needed), formatCredits(e.available));
    case 'missingParts':
      return t.missingParts(formatParts(e.parts));
    case 'missingResources':
      return t.missingResources(formatResources(e.resources));
    case 'reshapeDamaged':
      return tx().shipyardV2.shapes.reshapeDamaged;
  }
}

function warningText(w: DesignWarning): string {
  const t = tx().shipyard.warnings;
  switch (w.code) {
    case 'noBackwardEngine':
    case 'noLeftEngine':
    case 'noRightEngine':
    case 'noMiningLaser':
    case 'weakTurning':
      return t[w.code];
    case 'energyDeficit':
      return (w.activity === 'combat' ? t.energyDeficitCombat : t.energyDeficit)(`−${formatQty(-w.balance)}`);
    case 'damagedScrapped':
      return t.damagedScrapped(formatParts(w.parts), formatResources(w.resources), w.reason === 'noRepairService');
    case 'cargoOverflow':
      return t.cargoOverflow(formatQty(w.cargo), formatQty(w.capacity), formatQty(w.toStorage));
    case 'fuelOverflow':
      return t.fuelOverflow(formatQty(w.fuel), formatQty(w.capacity), formatQty(w.lost));
    case 'blockedExhaust':
      return t.blockedExhaust(w.partId);
    case 'blockedLaser':
      return t.blockedLaser(w.partId);
    case 'overBudgetLegacy':
      return t.overBudgetLegacy(w.cockpitTier, w.budget, w.used);
    case 'loanParts':
      return t.loanParts(formatParts(w.parts));
    case 'shapeLooseContact': {
      const shapes = tx().shipyardV2.shapes;
      return shapes.looseContact(shapes.names[w.shape]);
    }
    case 'explosiveNearCockpit':
      return tx().shipyardV2.explosiveNearCockpit(partName(w.key), w.damage);
  }
}

/** Messages of the Checks panel ("Kontrola"): errors first, then warnings. */
export function designMessages(report: DesignReport): DesignMessage[] {
  const errors = report.errors.map<DesignMessage>((e) => ({
    severity: 'error',
    code: e.code,
    i18nKey: `shipyard.errors.${e.code}`,
    text: errorText(e),
    partIds: e.code === 'disconnected' ? [...e.partIds] : e.code === 'reshapeDamaged' ? [e.partId] : [],
  }));
  const warnings = report.warnings.map<DesignMessage>((w) => ({
    severity: 'warning',
    code: w.code,
    i18nKey: `shipyard.warnings.${w.code}`,
    text: warningText(w),
    partIds:
      w.code === 'blockedExhaust' || w.code === 'blockedLaser' || w.code === 'shapeLooseContact' || w.code === 'explosiveNearCockpit'
        ? [w.partId]
        : w.code === 'loanParts'
          ? [...w.partIds]
          : [],
  }));
  return [...errors, ...warnings];
}

// ---------------------------------------------------------------------------
// cost of changes

export type CostLineId = 'fromStorage' | 'craft' | 'buy' | 'install' | 'toStorage' | 'returned' | 'repairs';

export interface CostLine {
  id: CostLineId;
  label: string;
  /** Parts in the line (empty for installation and repairs). */
  parts: PartInventory;
  credits: number;
  resources: Partial<Cargo>;
  /** Finished line text ("1× Cargo hold T1", "2 × 10 cr = 20 cr", "–"). */
  text: string;
}

export interface CostBreakdown {
  lines: CostLine[];
  /** Total credits. */
  total: number;
  /** Total resources (crafting + repairs). */
  resources: Partial<Cargo>;
  /** "720 cr + 30 Fe, 10 Cu". */
  totalText: string;
  /** The player's credits and what remains after confirming. */
  credits: number;
  remaining: number;
  affordable: boolean;
  cargoToStorage: number;
  fuelLost: number;
}

export function buildCostBreakdown(cost: DesignCost, ctx: ShipyardContext): CostBreakdown {
  const none = tx().shipyard.cost.none;
  const partsLine = (id: CostLineId, parts: PartInventory, credits: number, resources: Partial<Cargo>): CostLine => ({
    id, label: tx().shipyard.cost[id], parts, credits, resources, text: formatParts(parts) || none,
  });
  let craftResources: Partial<Cargo> = {};
  for (const [key, n] of Object.entries(cost.craft) as [PartKey, number][]) {
    craftResources = addResources(craftResources, scaleResources(RECIPES[key].resources, n));
  }
  const repairResources = cost.repairs.reduce<Partial<Cargo>>((acc, r) => addResources(acc, { [r.material]: r.amount }), {});
  const repairText = cost.repairs.length > 0
    ? [formatCredits(cost.repairCredits), formatResources(repairResources)].filter(Boolean).join(' + ')
    : none;
  const lines: CostLine[] = [
    partsLine('fromStorage', cost.fromStorage, 0, {}),
    partsLine('craft', cost.craft, cost.craftCredits, craftResources),
    partsLine('buy', cost.buy, cost.buyCredits, {}),
    {
      id: 'install', label: tx().shipyard.cost.install, parts: {}, credits: cost.installCredits, resources: {},
      text: cost.installCount > 0
        ? tx().shipyard.cost.installLine(cost.installCount, formatCredits(INSTALL_FEE), formatCredits(cost.installCredits))
        : none,
    },
    partsLine('toStorage', cost.toStorage, 0, {}),
    // Guild loan parts taken off go back to the Guild (shown only when there are some)
    ...(Object.keys(cost.returned).length > 0 ? [partsLine('returned', cost.returned, 0, {})] : []),
    { id: 'repairs', label: tx().shipyard.cost.repairs, parts: {}, credits: cost.repairCredits, resources: repairResources, text: repairText },
  ];
  const res = formatResources(cost.resources);
  return {
    lines,
    total: cost.credits,
    resources: cost.resources,
    totalText: res ? `${formatCredits(cost.credits)} + ${res}` : formatCredits(cost.credits),
    credits: ctx.credits,
    remaining: ctx.credits - cost.credits,
    affordable: cost.credits <= ctx.credits,
    cargoToStorage: cost.cargoToStorage,
    fuelLost: cost.fuelLost,
  };
}

// ---------------------------------------------------------------------------
// shaped armour (SL2 E2): the shape strip under the palette and the ghost tooltip

/** One tile of the shape strip: "full" first, then the shapes in the Tab cycle order (`SHAPE_IDS`). */
export interface ShapeStripItem {
  /** null = the full part (no shape). */
  shape: ShapeId | null;
  name: string;
  /** Hull points of the part in this shape (½ steps). */
  points: number;
  /** Max HP of the part in this shape. */
  hp: number;
  /** "½ b · 20 HP". */
  facts: string;
  /** The shape in hand. */
  active: boolean;
}

export interface ShapeStripView {
  key: PartKey;
  tier: Tier;
  /** Strip label ("Tvar") and its tooltip (what a shape is, Tab, the installation fee). */
  label: string;
  hint: string;
  /** The cycling key ("Tab"). */
  keys: string;
  /** Full + 9 shapes (10 tiles). */
  items: ShapeStripItem[];
  /** Index of the active tile. */
  activeIndex: number;
}

/** The order of the strip and of Tab / Shift+Tab: full, then `SHAPE_IDS`. */
export const SHAPE_CYCLE: readonly (ShapeId | null)[] = [null, ...SHAPE_IDS];

/** A part of type `key` laid in `shape` at (x, y, rot) with the given id. */
function shapedPart(key: PartKey, shape: ShapeId | null, x = 0, y = 0, rot: Rotation = 0, id = -1): PlacedPart {
  const { partId, tier, variant } = parsePartKey(key);
  return { id, partId, tier, x, y, rot, ...(variant ? { variant } : {}), ...(shape ? { shape } : {}) };
}

/** "½ b · 20 HP" – the facts of one shape. */
const shapeFacts = (points: number, hp: number): string => {
  const t = tx().shipyardV2.shapes;
  return `${t.tipPoints(points)} · ${t.tipHp(hp)}`;
};

/** Does the part of type `key` have shapes (armour, every tier)? */
export const hasShapes = (key: PartKey | null): key is PartKey => key !== null && SHAPEABLE_PARTS.has(parsePartKey(key).partId);

/**
 * The shape strip for the part in hand (`null` when the part has no shapes – only armour has). `active`
 * = the shape in hand (null = full). The strip is pure data; the editor (SL2 E2 U1) owns the shape in hand.
 */
export function shapeStrip(key: PartKey | null, active: ShapeId | null): ShapeStripView | null {
  if (!hasShapes(key)) return null;
  const t = tx().shipyardV2.shapes;
  const items = SHAPE_CYCLE.map<ShapeStripItem>((shape) => {
    const part = shapedPart(key, shape);
    const points = shapeHullPoints(part);
    const hp = maxHp(part);
    return { shape, name: t.names[shape ?? 'full'], points, hp, facts: shapeFacts(points, hp), active: shape === active };
  });
  const activeIndex = Math.max(0, items.findIndex((i) => i.active));
  items[activeIndex]!.active = true;
  return {
    key,
    tier: parsePartKey(key).tier,
    label: t.strip,
    hint: t.stripHint(formatCredits(INSTALL_FEE)),
    keys: t.keys,
    items,
    activeIndex,
  };
}

/** The shape `steps` places after `current` in the strip / Tab order (negative = before), wrapping around. */
export function nextShape(current: ShapeId | null, steps: number): ShapeId | null {
  const i = Math.max(0, SHAPE_CYCLE.indexOf(current));
  const n = SHAPE_CYCLE.length;
  return SHAPE_CYCLE[(((i + steps) % n) + n) % n]!;
}

/** Where the ghost would lay an armour part (place) or what it would reshape (`replaceId`). */
export interface ShapeGhost {
  key: PartKey;
  x: number;
  y: number;
  rot: Rotation;
  shape: ShapeId | null;
  /** Reshape in place: the placed part the ghost replaces (its id is kept). */
  replaceId?: number;
}

export interface ShapeArcChange {
  /** The cannon's part id and its grid position. */
  partId: number;
  x: number;
  y: number;
  /** Change of its effective arc (whole degrees, signed). */
  deg: number;
}

export interface ShapeTip {
  points: number;
  hp: number;
  /** Cannons within `ARC_TIP_RANGE` cells whose arc the ghost changes (largest change first). */
  arcs: ShapeArcChange[];
  /** "½ pt · 20 HP · +18° arc for the cannon (3,1)". */
  text: string;
}

/** Cannons this close to the ghost (cells, Chebyshev) get an arc line in the tooltip. */
export const ARC_TIP_RANGE = 2;
/** At most this many arc lines in the tooltip. */
const ARC_TIP_MAX = 2;

const RAD_TO_DEG = 180 / Math.PI;

function arcChanges(before: ShipGrid, after: ShipGrid, ghost: PlacedPart): ShapeArcChange[] {
  const ghostCells = partCells(ghost);
  const near = (p: PlacedPart): boolean =>
    partCells(p).some((c) => ghostCells.some((g) => Math.max(Math.abs(c.x - g.x), Math.abs(c.y - g.y)) <= ARC_TIP_RANGE));
  const out: ShapeArcChange[] = [];
  for (const cannon of after.parts) {
    if (cannon.id === ghost.id || !partDef(cannon.partId, cannon.tier, cannon.variant).weapon || !near(cannon)) continue;
    const was = before.parts.find((p) => p.id === cannon.id);
    if (!was) continue;
    const deg = Math.round((arcsWidth(effectiveArcs(after, cannon)) - arcsWidth(effectiveArcs(before, was))) * RAD_TO_DEG);
    if (deg !== 0) out.push({ partId: cannon.id, x: cannon.x, y: cannon.y, deg });
  }
  return out.sort((a, b) => Math.abs(b.deg) - Math.abs(a.deg) || a.partId - b.partId).slice(0, ARC_TIP_MAX);
}

let tipCache: { grid: ShipGrid; key: string; texts: unknown; tip: ShapeTip } | null = null;

/**
 * Ghost tooltip of armour in hand (or of a reshape): hull points, max HP and the arc change of nearby
 * cannons ("½ pt · 20 HP · +18° arc for the cannon (3,1)"). null for a part without shapes. Cached per
 * ghost (the arcs are ray casts – the pointer moving within a cell must not redo them).
 */
export function shapeTip(grid: ShipGrid, ghost: ShapeGhost): ShapeTip | null {
  if (!hasShapes(ghost.key)) return null;
  const cacheKey = `${ghost.key}:${ghost.x}:${ghost.y}:${ghost.rot}:${ghost.shape ?? ''}:${ghost.replaceId ?? ''}`;
  if (tipCache && tipCache.grid === grid && tipCache.key === cacheKey && tipCache.texts === tx()) return tipCache.tip;
  const id = ghost.replaceId ?? grid.nextId;
  const part = shapedPart(ghost.key, ghost.shape, ghost.x, ghost.y, ghost.rot, id);
  const replaced = ghost.replaceId !== undefined && grid.parts.some((p) => p.id === ghost.replaceId);
  const after: ShipGrid = replaced
    ? { parts: grid.parts.map((p) => (p.id === ghost.replaceId ? part : p)), nextId: grid.nextId }
    : { parts: [...grid.parts, part], nextId: grid.nextId + 1 };
  const points = shapeHullPoints(part);
  const hp = maxHp(part);
  const arcs = arcChanges(grid, after, part);
  const t = tx().shipyardV2.shapes;
  const text = [shapeFacts(points, hp), ...arcs.map((a) => t.tipArc(a.deg, a.x, a.y))].join(' · ');
  const tip: ShapeTip = { points, hp, arcs, text };
  tipCache = { grid, key: cacheKey, texts: tx(), tip };
  return tip;
}

/**
 * The shape Tab (`dir` 1) / Shift+Tab (−1) lays a placed armour part in: the next shape in the strip
 * order whose footprint fits its place (null when no other shape fits). Same rule as the editor's reshape.
 */
export function nextFittingShape(grid: ShipGrid, part: PlacedPart, dir: 1 | -1 = 1): { shape: ShapeId | null } | null {
  const current = part.shape ?? null;
  for (let i = 1; i < SHAPE_CYCLE.length; i++) {
    const next = nextShape(current, dir * i);
    if (checkPlacement(grid, part.partId, part.tier, part.x, part.y, part.rot, part.id, next) === null) return { shape: next };
  }
  return null;
}

/** The card of a placed armour plate under an empty hand: what Tab would reshape it to. */
export interface ReshapePreview {
  /** The placed part's id, key, tier and rotation. */
  id: number;
  key: PartKey;
  tier: Tier;
  rot: Rotation;
  from: ShapeId | null;
  to: ShapeId | null;
  /** "Armor T1 · Wedge → Chamfer". */
  name: string;
  /** The new shape's facts (`shapeTip` with `replaceId`): "½ pt · 20 HP · +18° arc for the cannon (3,1)". */
  tip: string;
}

let reshapeCache: { grid: ShipGrid; id: number; texts: unknown; preview: ReshapePreview | null } | null = null;

/**
 * SL2 E2: the reshape preview of the placed part `id` (hovered with an empty hand) – null when it has
 * no shapes or no other shape fits its place. Cached per grid and part.
 */
export function reshapePreview(grid: ShipGrid, id: number): ReshapePreview | null {
  const c = reshapeCache;
  if (c && c.grid === grid && c.id === id && c.texts === tx()) return c.preview;
  const preview = computeReshapePreview(grid, id);
  reshapeCache = { grid, id, texts: tx(), preview };
  return preview;
}

function computeReshapePreview(grid: ShipGrid, id: number): ReshapePreview | null {
  const part = grid.parts.find((p) => p.id === id);
  if (!part || !SHAPEABLE_PARTS.has(part.partId)) return null;
  const next = nextFittingShape(grid, part);
  if (!next) return null;
  const key = partKey(part.partId, part.tier, part.variant);
  const tip = shapeTip(grid, { key, x: part.x, y: part.y, rot: part.rot, shape: next.shape, replaceId: part.id });
  if (!tip) return null;
  const names = tx().shipyardV2.shapes.names;
  const from = part.shape ?? null;
  return {
    id,
    key,
    tier: part.tier,
    rot: part.rot,
    from,
    to: next.shape,
    name: `${partName(key)} · ${names[from ?? 'full']} → ${names[next.shape ?? 'full']}`,
    tip: tip.text,
  };
}

// ---------------------------------------------------------------------------
// everything for the screen at once

/** Header of the Properties panel: "HULL 31 / 48 pts · cockpit T2" (spec 3.4.1). */
export interface HullView {
  label: string;
  /** "31 / 48 pts" (without a cockpit just "31 pts"). */
  points: string;
  /** "cockpit T2" / "no cockpit". */
  cockpit: string;
  used: number;
  budget: number | null;
  over: boolean;
}

export function buildHullView(report: DesignReport): HullView {
  const { used, budget, cockpitTier, over } = report.hull;
  const t = tx().shipyard.ui;
  return {
    label: t.hull,
    points: budget === null ? t.hullNoBudget(used) : t.hullPoints(used, budget),
    cockpit: cockpitTier === null ? t.hullNoCockpit : t.hullCockpit(cockpitTier),
    used,
    budget,
    over,
  };
}

export interface ShipyardView {
  report: DesignReport;
  /** Hull budget of the draft. */
  hull: HullView;
  palette: PaletteEntry[];
  stats: StatRow[];
  messages: DesignMessage[];
  cost: CostBreakdown;
  /** Parts disconnected from the cockpit (red). */
  disconnected: number[];
  canCommit: boolean;
  /** The draft differs from the ship (cancelling / undocking needs a dialog). */
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Action to send through Game.sendAction on confirm, as is. */
  commit: GameActionInput;
}

export function buildShipyardView(draft: ShipyardDraft, ctx: ShipyardContext, tier: Tier): ShipyardView {
  const report = evaluateDesign(draft, ctx);
  return {
    report,
    hull: buildHullView(report),
    palette: buildPalette(draft, ctx, tier, report),
    stats: buildStatsPanel(draft.grid, draft.base.grid),
    messages: designMessages(report),
    cost: buildCostBreakdown(report.cost, ctx),
    disconnected: report.disconnected,
    canCommit: report.canCommit,
    dirty: isDraftDirty(draft),
    canUndo: canUndo(draft),
    canRedo: canRedo(draft),
    commit: { type: 'shipyardCommit', baseHash: draftBaseHash(draft), ops: draftOps(draft), acquire: { ...draft.acquire } },
  };
}
