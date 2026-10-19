// Part explanations for the UI (crafting, market, shipyard): the plain-language description, the
// "Na tvojej lodi" rows with formatted before → after values and the one-line advice. The numbers
// come from partEffect.ts; every text comes from the i18n module skParts.ts.
import { COCKPIT_HULL_BUDGET, parsePartKey, partKey, type PartKey } from '../data/parts';
import type { ShapeId } from '../data/shapes';
import { tx } from '../i18n';
import { type EffectMetric, type GlossaryId, type PartDescription } from '../i18n/skParts';
import type { ShipGrid } from '../sim/ship/types';
import { formatAmount, formatInt, formatNumber, formatPercent } from '../ui/format';
import { partAdvice, partEffect, type Advice, type EffectRow, type MetricId, type PartEffect, type ShipMetrics, type Trend } from './partEffect';
import { partStats, type PartStatId } from './shipyardView';

const t = () => tx().partInfo.effect;
const u = () => t().units;
/** Non-breaking space: a number never wraps away from its unit. */
const NB = '\u00a0';
/** Energy has no unit of its own in the game (the battery holds "120"); its rates are just "/s". */
const ENERGY_RATE = '/s';

/** Whole numbers without decimals, otherwise one decimal with a comma. */
const qty = (v: number): string => (Math.abs(v - Math.round(v)) < 1e-9 ? formatInt(v) : formatAmount(v));
/** "−2" / "+4" with a typographic minus. */
const signedQty = (v: number): string => (v > 1e-9 ? `+${qty(v)}` : v < -1e-9 ? `−${qty(-v)}` : '0');
/** Workshop rates (0,75 j/s): up to two decimals, no trailing zeros. */
const rate = (v: number): string => formatNumber(v, 2, true);
/** Signed workshop rate. */
const signedRate = (v: number): string => (v > 1e-9 ? `+${rate(v)}` : v < -1e-9 ? `−${rate(-v)}` : '0');
/** Seconds: one decimal below 10 s, whole seconds above. */
const secs = (v: number): string => (v < 10 ? formatAmount(v) : formatInt(v));

/** One metric value in human units (null = the metric's "none" text). */
export function formatMetric(id: MetricId, v: number | null, budget?: number | null): string {
  if (v === null) return t().none[id] ?? '–';
  switch (id) {
    case 'turn180':
    case 'topSpeedTime':
    case 'brakeTime':
    case 'miningEndurance':
      return `${secs(v)}${NB}${u().s}`;
    case 'accel':
      return `${formatAmount(v)}${NB}${u().accel}`;
    case 'fuelRange':
      return `${formatInt(Math.round(v / 100) * 100)}${NB}${u().dist}`;
    case 'energyMining':
    case 'energyCombat':
    case 'energyWorkshop':
      return `${signedQty(v)}${ENERGY_RATE}`;
    case 'miningRate':
      return `${qty(v)}${NB}${u().perSecond}`;
    case 'refineIce':
    case 'refineOre':
      return `${rate(v)}${NB}${u().perSecond}`;
    case 'repairRate':
      return `${rate(v)}${NB}${u().hpPerSecond}`;
    case 'blast':
      return `${formatInt(v)}${NB}${u().hp}`;
    case 'dps':
    case 'shieldRegen':
      return `${qty(v)}${NB}${u().hpPerSecond}`;
    case 'cannonArc':
      return `${formatInt(v)}${u().deg}`;
    case 'shieldCapacity':
    case 'hp':
      return `${formatInt(v)}${NB}${u().hp}`;
    case 'tractorParts':
      return `${formatInt(v)}${NB}${u().parts}`;
    case 'hull':
      return budget === null || budget === undefined ? `${formatInt(v)}${NB}${u().points}` : `${t().hullValue(formatInt(v), formatInt(budget))}${NB}${u().points}`;
    case 'mass':
      return `${qty(v)}${NB}${u().tons}`;
    case 'battery':
      return formatInt(v);
    case 'cargo':
    case 'radar':
    case 'tractorRange':
      return `${formatInt(v)}${NB}${u().units}`;
  }
}

/** Absolute change in the metric's unit ("+60 j", "−6 j/s"). */
function formatChange(id: MetricId, d: number): string {
  switch (id) {
    case 'energyMining':
    case 'energyCombat':
    case 'energyWorkshop':
      return `${signedQty(d)}${ENERGY_RATE}`;
    case 'miningRate':
      return `${signedQty(d)}${NB}${u().perSecond}`;
    case 'refineIce':
    case 'refineOre':
      return `${signedRate(d)}${NB}${u().perSecond}`;
    case 'repairRate':
      return `${signedRate(d)}${NB}${u().hpPerSecond}`;
    case 'blast':
      return `${signedQty(Math.round(d))}${NB}${u().hp}`;
    case 'dps':
    case 'shieldRegen':
      return `${signedQty(d)}${NB}${u().hpPerSecond}`;
    case 'shieldCapacity':
    case 'hp':
      return `${signedQty(Math.round(d))}${NB}${u().hp}`;
    case 'cannonArc':
      return `${signedQty(Math.round(d))}${u().deg}`;
    case 'hull':
      return `${signedQty(d)}${NB}${u().points}`;
    case 'mass':
      return `${signedQty(d)}${NB}${u().tons}`;
    case 'miningEndurance':
      return `${signedQty(Math.round(d))}${NB}${u().s}`;
    case 'tractorParts':
      return signedQty(d);
    case 'battery':
      return signedQty(Math.round(d));
    default:
      return `${signedQty(Math.round(d))}${NB}${u().units}`;
  }
}

/** "−30 %" / "−30%" (one decimal below 10 %). */
function formatPct(p: number): string {
  return formatPercent(p, Math.abs(p) < 10 ? 1 : 0, true);
}

/** Glossary entry behind each effect label. */
const METRIC_TIP: Record<EffectMetric, GlossaryId> = {
  turn180: 'turn180', accel: 'accel', topSpeedTime: 'topSpeedTime', brakeTime: 'brakeTime', fuelRange: 'fuelRange',
  cargo: 'cargo', energyMining: 'energyMining', energyCombat: 'energyCombat', battery: 'battery',
  miningEndurance: 'miningEndurance', miningRate: 'miningRate', dps: 'dps', cannonArc: 'cannonArc',
  shieldCapacity: 'shieldCapacity', shieldRegen: 'shieldRegen', tractorRange: 'tractorRange', tractorParts: 'tractorParts',
  radar: 'radar', hp: 'hpTotal', hull: 'hull', mass: 'mass',
  blast: 'blast', repairRate: 'repairRate', refineIce: 'refineIce', refineOre: 'refineOre', energyWorkshop: 'energyWorkshop',
};

export interface PartInfoRow {
  id: MetricId;
  label: string;
  /** Glossary text for the label's tooltip. */
  tip: string;
  before: string;
  after: string;
  /** "−30 %", "+60 j"; null = no change or no comparable number. */
  delta: string | null;
  trend: Trend;
  role: EffectRow['role'];
}

/** One stat of a variant against the base part of the same tier ("Mass −50 %"). */
export interface VariantVsRow {
  id: PartStatId;
  label: string;
  tip: string;
  /** "−50 %", "+35 %". */
  delta: string;
  /** Better or worse for the player (lower mass and energy use are better). */
  trend: Exclude<Trend, 'same'>;
}

export interface PartInfoAdvice {
  tone: 'ok' | 'warn' | 'info';
  text: string;
}

export interface PartInfoView {
  key: PartKey;
  description: PartDescription;
  /** The variant's catch, or null for a base part. */
  variant: string | null;
  /** A variant's stats against the base part (null = a base part, or nothing comparable changes). */
  variantVs?: VariantVsRow[] | null;
  /** "On your ship" / "On your design". */
  title: string;
  rows: PartInfoRow[];
  /** Short notes on what the estimate assumes (engine direction, cannon arc, cockpit swap). */
  notes: string[];
  advice: PartInfoAdvice | null;
}

function infoRow(r: EffectRow): PartInfoRow {
  const hull = r.id === 'hull';
  const before = formatMetric(r.id, r.before, hull ? r.budgetBefore : undefined);
  const after = formatMetric(r.id, r.after, hull ? r.budgetAfter : undefined);
  let delta: string | null = null;
  if (r.trend !== 'same' || (hull && r.after !== r.before)) {
    if (hull && r.budgetBefore !== r.budgetAfter && r.budgetBefore != null && r.budgetAfter != null) delta = formatChange('hull', r.budgetAfter - r.budgetBefore);
    else if (r.pct !== null) delta = formatPct(r.pct);
    else if (r.before !== null && r.after !== null) delta = formatChange(r.id, r.after - r.before);
    // the first explosive part: "none → 40 HP" shows its blast as a red "+40 HP"
    else if (r.id === 'blast' && r.after !== null) delta = formatChange('blast', r.after);
  }
  // a change too small to show in the rounded values ("3,5 s → 3,5 s") is no change for the player
  const shown = hull || before !== after;
  return {
    id: r.id, label: t().labels[r.id], tip: tx().partInfo.glossary[METRIC_TIP[r.id]], before, after,
    delta: shown ? delta : null, trend: shown ? r.trend : 'same', role: r.role,
  };
}

/** Part stats where less is better (energy and fuel use, mass, the blast, the shield's wait). */
const LOWER_BETTER: ReadonlySet<PartStatId> = new Set<PartStatId>([
  'mass', 'miningEnergy', 'shotEnergy', 'shieldDelay', 'tractorEnergy', 'blast', 'repairEnergy', 'refineEnergy',
]);

/** A variant's part stats against the base part of the same tier, in percent (null = a base part). */
export function variantVs(key: PartKey): VariantVsRow[] | null {
  const { partId, tier, variant } = parsePartKey(key);
  if (!variant) return null;
  const base = new Map(partStats(partKey(partId, tier)).map((s) => [s.id, s.value]));
  const out: VariantVsRow[] = [];
  for (const s of partStats(key)) {
    const b = base.get(s.id);
    if (b === undefined || Math.abs(b) < 1e-9 || Math.abs(s.value - b) < 1e-9) continue;
    const pct = ((s.value - b) / Math.abs(b)) * 100;
    const up = s.value > b;
    out.push({ id: s.id, label: s.label, tip: s.tip, delta: formatPercent(Math.round(pct), 0, true), trend: up !== LOWER_BETTER.has(s.id) ? 'better' : 'worse' });
  }
  return out.length > 0 ? out : null;
}

/** The advice as one line of text (null = nothing worth saying). */
export function adviceText(a: Advice | null, e: PartEffect): PartInfoAdvice | null {
  if (!a) return null;
  const adv = tx().partInfo.advice;
  const m = (id: MetricId, v: number | null): string => formatMetric(id, v);
  const after: ShipMetrics = e.metricsAfter;
  switch (a.kind) {
    case 'noRoom':
      return { tone: 'warn', text: adv.noRoom(a.used, a.budget, a.need, a.cockpitTier === 1 ? COCKPIT_HULL_BUDGET[2] : null) };
    case 'noEffect':
      return { tone: 'info', text: a.partId === 'radar' ? adv.noEffectRadar(m('radar', a.value)) : adv.noEffectCockpit };
    case 'fixes': {
      const f = adv.fixes;
      switch (a.weakness) {
        case 'slowTurn': return { tone: 'ok', text: f.slowTurn(m('turn180', a.before), m('turn180', a.after)) };
        case 'miningEnergy':
          return parsePartKey(e.key).partId === 'battery'
            ? { tone: 'ok', text: f.miningEnergyBattery(m('energyMining', a.before), m('miningEndurance', after.miningEndurance)) }
            : { tone: 'ok', text: f.miningEnergy(m('energyMining', a.before), m('energyMining', a.after)) };
        case 'combatEnergy': return { tone: 'ok', text: f.combatEnergy(m('energyCombat', a.before), m('energyCombat', a.after)) };
        case 'slowAccel': return { tone: 'ok', text: f.slowAccel(m('topSpeedTime', a.before), m('topSpeedTime', a.after)) };
        case 'shortRange': return { tone: 'ok', text: f.shortRange(m('fuelRange', a.before), m('fuelRange', a.after)) };
        case 'noBrake': return { tone: 'ok', text: f.noBrake };
        case 'noStrafe': return { tone: 'ok', text: f.noStrafe };
        case 'noLaser': return { tone: 'ok', text: f.noLaser };
      }
      return null;
    }
    case 'causes': {
      const c = adv.causes;
      if (a.weakness === 'miningEnergy') return { tone: 'warn', text: c.miningEnergy(m('energyMining', a.after)) };
      if (a.weakness === 'combatEnergy') return { tone: 'warn', text: c.combatEnergy(m('energyCombat', a.after)) };
      if (a.weakness === 'slowTurn') return { tone: 'warn', text: c.slowTurn(m('turn180', a.after)) };
      return null;
    }
    case 'general': {
      const g = adv.general;
      if (a.weakness === 'miningEnergy') return { tone: 'warn', text: g.miningEnergy(m('energyMining', a.value)) };
      if (a.weakness === 'noBrake') return { tone: 'warn', text: g.noBrake };
      if (a.weakness === 'slowTurn') return { tone: 'warn', text: g.slowTurn(m('turn180', a.value)) };
      return null;
    }
  }
}

/** The plain-language description of a part (and its variant's catch). */
export function partDescription(key: PartKey): { description: PartDescription; variant: string | null } {
  const { partId, variant } = parsePartKey(key);
  return { description: tx().partInfo.parts[partId], variant: variant ? tx().partInfo.variants[variant] : null };
}

/**
 * Everything the UI shows about one part on the player's ship (`draft` = the shipyard draft):
 * description, the effect rows and at most one line of advice. `shape` = the armour shape in hand
 * (SL2 E2; a wedge adds half a plate's HP, not a full plate's).
 */
export function partInfo(grid: ShipGrid, key: PartKey, opts: { draft?: boolean; shape?: ShapeId | null } = {}): PartInfoView {
  const { partId } = parsePartKey(key);
  const effect = partEffect(grid, key, opts.shape);
  const notes: string[] = [];
  if (partId === 'cockpit' && effect.before.cockpit) notes.push(t().replaces);
  if (effect.placement) notes.push(t().placement[effect.placement]);
  // several lasers mine independently – each its own beam, arc and heat (Mining 2.0)
  if (partId === 'miningLaser' || partId === 'heavyLaser') notes.push(tx().mining.laserNote);
  // M4c workshop: what the repair module spends, what the refinery does first and what refining is worth
  if (partId === 'repairModule') {
    // the material follows the tiers of the ship's parts (Fe for T1, Ti for T2 – station repair rules)
    const tiers = ([1, 2] as const).filter((tier) => grid.parts.some((p) => p.tier === tier));
    notes.push(t().repairMaterial((tiers.length > 0 ? tiers : [1 as const]).map((tier) => t().repairBy[tier]).join(t().and)));
  }
  if (partId === 'refinery') notes.push(t().refinery);
  return {
    key,
    ...partDescription(key),
    variantVs: variantVs(key),
    title: opts.draft ? t().titleDraft : t().title,
    rows: effect.rows.map(infoRow),
    notes,
    advice: adviceText(partAdvice(effect, partId), effect),
  };
}
