// "What it changes on your ship" (part explanations): a placement-independent estimate of adding one
// part to the player's current ship (or the shipyard draft), in human units – seconds for a half
// turn, acceleration, range on a full tank, energy while mining or fighting – plus the ship's
// weaknesses and the single most relevant piece of advice. Pure numbers; texts live in partInfo.ts.
import { parsePartKey, partDef, partDefOf, partKey, type PartDef, type PartId, type PartKey, type Tier } from '../data/parts';
import type { VariantId } from '../data/variants';
import { arcsWidth, CANNON_HALF_ARC } from '../sim/combat/arcs';
import { MAX_SPEED } from '../sim/physics/body';
import { ASSISTED_SPEED } from '../sim/ship/control';
import { turnTime180 } from '../sim/ship/turnTime';
import { hullBudgetOf } from '../sim/ship/budget';
import { FUEL_PER_FORCE_SECOND } from '../sim/ship/fuel';
import { maxHp } from '../sim/ship/hp';
import { computeProperties, type ThrustGroup } from '../sim/ship/properties';
import { shapeHullPoints } from '../sim/ship/shape';
import type { PlacedPart, ShipGrid } from '../sim/ship/types';
import type { ShapeId } from '../data/shapes';

/** Everything the estimate needs about a ship (sums, not placement). */
export interface ShipSummary {
  parts: number;
  mass: number;
  /** Moment of inertia around the centre of mass. */
  inertia: number;
  torque: number;
  thrust: Record<ThrustGroup, number>;
  /** The cockpit's manoeuvring thrusters (RCS): they brake where there are no engines. */
  rcs: number;
  fuel: number;
  /** Thrust-weighted fuel use of the engines (1 = base engines). */
  fuelUseMult: number;
  cargo: number;
  battery: number;
  energyGen: number;
  /** Energy per second of all mining lasers firing. */
  miningDraw: number;
  /** Ore per second of all mining lasers. */
  miningRate: number;
  lasers: number;
  /** Energy per second of all cannons firing plus the shield recharging. */
  combatDraw: number;
  /** Damage per second of all cannons. */
  dps: number;
  cannons: number;
  /** Sum of the effective cannon arcs (degrees). */
  cannonArc: number;
  shieldCapacity: number;
  shieldRegen: number;
  tractorRange: number;
  tractorParts: number;
  radar: number;
  /** Best radar range without the cockpit (a new cockpit replaces the old one's radar). */
  radarParts: number;
  /** Sum of the parts' max HP. */
  hp: number;
  /** The biggest blast of an explosive part (large reactor, M4c); 0 = nothing explodes. */
  blast: number;
  /** Repair modules: HP per second together (M4c). */
  repairRate: number;
  /** Refineries: ice per second (into fuel) and raw ore per second (into refined ore) together. */
  refineIce: number;
  refineOre: number;
  /** Energy per second of all refineries and repair modules at work. */
  workshopDraw: number;
  hullUsed: number;
  /** Hull budget of the (single) cockpit; null = no single cockpit. */
  hullBudget: number | null;
  cockpit: { tier: Tier; variant?: VariantId } | null;
}

const NO_THRUST: Record<ThrustGroup, number> = { forward: 0, backward: 0, left: 0, right: 0 };
type WorkshopSums = Pick<ShipSummary, 'blast' | 'repairRate' | 'refineIce' | 'refineOre' | 'workshopDraw'>;
const NO_WORKSHOP: WorkshopSums = { blast: 0, repairRate: 0, refineIce: 0, refineOre: 0, workshopDraw: 0 };

/** The workshop sums of a list of part definitions (M4c: refinery, repair module, blast). */
function workshopSums(defs: readonly PartDef[]): WorkshopSums {
  const out = { ...NO_WORKSHOP };
  for (const d of defs) {
    out.blast = Math.max(out.blast, d.blast ?? 0);
    if (d.repair) {
      out.repairRate += d.repair.hpPerSecond;
      out.workshopDraw += d.repair.energyPerSecond;
    }
    if (d.refinery) {
      out.refineIce += d.refinery.icePerSecond;
      out.refineOre += d.refinery.orePerSecond;
      out.workshopDraw += d.refinery.energyPerSecond;
    }
  }
  return out;
}
const deg = (rad: number): number => Math.round((rad * 180) / Math.PI);
/** Full arc of one unobstructed cannon (degrees). */
export const CANNON_FULL_ARC = deg(2 * CANNON_HALF_ARC);

export function summarizeShip(grid: ShipGrid): ShipSummary {
  const budget = hullBudgetOf(grid);
  const cockpits = grid.parts.filter((p) => p.partId === 'cockpit');
  const cockpit = cockpits.length === 1 ? cockpits[0]! : null;
  const base = {
    hullUsed: budget.used,
    hullBudget: budget.budget,
    cockpit: cockpit ? { tier: cockpit.tier, ...(cockpit.variant ? { variant: cockpit.variant } : {}) } : null,
    // shaped armour (SL2 E2) has its own, smaller max HP
    hp: grid.parts.reduce((s, p) => s + maxHp(p), 0),
    parts: grid.parts.length,
  };
  if (grid.parts.length === 0) {
    return {
      ...base, ...NO_WORKSHOP, mass: 0, inertia: 0, torque: 0, thrust: { ...NO_THRUST }, rcs: 0, fuel: 0, fuelUseMult: 1, cargo: 0, battery: 0, energyGen: 0,
      miningDraw: 0, miningRate: 0, lasers: 0, combatDraw: 0, dps: 0, cannons: 0, cannonArc: 0, shieldCapacity: 0, shieldRegen: 0,
      tractorRange: 0, tractorParts: 0, radar: 0, radarParts: 0,
    };
  }
  const props = computeProperties(grid);
  const cannonDraw = props.weapons.reduce((s, w) => s + w.energyPerShot * w.fireRate, 0);
  return {
    ...base,
    ...workshopSums(grid.parts.map((p) => partDef(p.partId, p.tier, p.variant))),
    mass: props.mass,
    inertia: props.inertia,
    torque: props.torque,
    thrust: { ...props.thrust },
    rcs: props.rcsThrust,
    fuel: props.fuelCapacity,
    fuelUseMult: props.fuelUseMult,
    cargo: props.cargoCapacity,
    battery: props.batteryCapacity,
    energyGen: props.energyGen,
    miningDraw: props.lasers.reduce((s, l) => s + l.energyPerSecond, 0),
    miningRate: props.lasers.reduce((s, l) => s + l.rate, 0),
    lasers: props.lasers.length,
    combatDraw: cannonDraw + props.shield.regen * props.shield.energyPerPoint,
    dps: props.weapons.reduce((s, w) => s + w.damage * w.fireRate, 0),
    cannons: props.weapons.length,
    cannonArc: deg(props.weapons.reduce((s, w) => s + arcsWidth(w.arcs), 0)),
    shieldCapacity: props.shield.capacity,
    shieldRegen: props.shield.regen,
    tractorRange: props.tractors.reduce((m, t) => Math.max(m, t.range), 0),
    tractorParts: props.tractors.reduce((m, t) => Math.max(m, t.maxParts), 0),
    radar: props.radarRange,
    radarParts: grid.parts.reduce((m, p) => (p.partId === 'cockpit' ? m : Math.max(m, partDef(p.partId, p.tier, p.variant).radarRange ?? 0)), 0),
  };
}

/** A part of type `key` laid in `shape` (no position – only what the HP and hull-point rules read). */
function looseOf(key: PartKey, shape?: ShapeId | null): PlacedPart {
  const { partId, tier, variant } = parsePartKey(key);
  return { id: -1, partId, tier, x: 0, y: 0, rot: 0, ...(variant ? { variant } : {}), ...(shape ? { shape } : {}) };
}

/**
 * Adds (sign 1) or removes (sign −1) the sums of one part; max-type values are handled by the caller.
 * `part` carries the shape (SL2 E2): its max HP and hull points follow the shape.
 */
function addSums(s: ShipSummary, d: PartDef, sign: 1 | -1, part: PlacedPart): ShipSummary {
  const mass = s.mass + sign * d.mass;
  // Placement-independent: the part lands at the ship's average distance from the centre of mass,
  // so the inertia grows in proportion to the mass (the simulation scales it the same way for cargo).
  const inertia = s.mass > 0 ? (s.inertia * mass) / s.mass : (d.mass * (d.size.w * d.size.w + d.size.h * d.size.h)) / 12;
  const thrust = { ...s.thrust };
  let fuelUseMult = s.fuelUseMult;
  if (d.thrust) {
    // estimate: an engine pushing the ship forward (the usual place – nozzle at the back)
    const before = s.thrust.forward + s.thrust.backward + s.thrust.left + s.thrust.right;
    thrust.forward += sign * d.thrust;
    const after = before + sign * d.thrust;
    fuelUseMult = after > 0 ? (s.fuelUseMult * before + sign * d.thrust * (d.fuelUse ?? 1)) / after : 1;
  }
  const w = d.weapon;
  const sh = d.shield;
  return {
    ...s,
    parts: s.parts + sign,
    mass,
    inertia,
    torque: s.torque + sign * (d.torque ?? 0),
    thrust,
    fuelUseMult,
    fuel: s.fuel + sign * (d.fuel ?? 0),
    cargo: s.cargo + sign * (d.cargo ?? 0),
    battery: s.battery + sign * (d.battery ?? 0),
    energyGen: s.energyGen + sign * (d.energyGen ?? 0),
    miningDraw: s.miningDraw + sign * (d.mining?.energyPerSecond ?? 0),
    miningRate: s.miningRate + sign * (d.mining?.rate ?? 0),
    lasers: s.lasers + (d.mining ? sign : 0),
    combatDraw: s.combatDraw + sign * ((w ? w.energyPerShot * w.fireRate : 0) + (sh ? sh.regen * sh.energyPerPoint : 0)),
    dps: s.dps + sign * (w ? w.damage * w.fireRate : 0),
    cannons: s.cannons + (w ? sign : 0),
    // an unobstructed cannon covers its full arc; the real arc depends on where it sits
    cannonArc: s.cannonArc + (w ? sign * CANNON_FULL_ARC : 0),
    shieldCapacity: s.shieldCapacity + sign * (sh?.capacity ?? 0),
    shieldRegen: s.shieldRegen + sign * (sh?.regen ?? 0),
    hp: s.hp + sign * maxHp(part),
    hullUsed: s.hullUsed + sign * shapeHullPoints(part),
    // the biggest blast is a max-type value – only ever added (no cockpit explodes)
    blast: sign > 0 ? Math.max(s.blast, d.blast ?? 0) : s.blast,
    repairRate: s.repairRate + sign * (d.repair?.hpPerSecond ?? 0),
    refineIce: s.refineIce + sign * (d.refinery?.icePerSecond ?? 0),
    refineOre: s.refineOre + sign * (d.refinery?.orePerSecond ?? 0),
    workshopDraw: s.workshopDraw + sign * ((d.repair?.energyPerSecond ?? 0) + (d.refinery?.energyPerSecond ?? 0)),
  };
}

/**
 * The ship with one more part of type `key` (laid in `shape` – shaped armour, SL2 E2). A cockpit
 * replaces the current one (a ship has exactly one); every other part is added on top.
 */
export function withPart(s: ShipSummary, key: PartKey, shape?: ShapeId | null): ShipSummary {
  const { partId, tier, variant } = parsePartKey(key);
  const d = partDefOf(key);
  let base = s;
  if (partId === 'cockpit' && s.cockpit) {
    const old = partKey('cockpit', s.cockpit.tier, s.cockpit.variant);
    base = addSums(s, partDef('cockpit', s.cockpit.tier, s.cockpit.variant), -1, looseOf(old));
  }
  const out = addSums(base, d, 1, looseOf(key, shape));
  if (partId === 'cockpit') {
    out.hullBudget = d.hullBudget ?? null;
    out.cockpit = { tier, ...(variant ? { variant } : {}) };
    out.rcs = d.rcsThrust ?? 0;
    // the radar sees as far as the best radar part or the new cockpit
    out.radar = Math.max(s.radarParts, d.radarRange ?? 0);
  } else if (d.radarRange) {
    out.radar = Math.max(s.radar, d.radarRange);
    out.radarParts = Math.max(s.radarParts, d.radarRange);
  }
  if (d.tractor) {
    out.tractorRange = Math.max(s.tractorRange, d.tractor.range);
    out.tractorParts = Math.max(s.tractorParts, d.tractor.maxParts);
  }
  return out;
}

// ---------------------------------------------------------------------------
// human metrics

/**
 * A straight flight from rest holding "forward" (M4d: shared by `fuelRange` and the map's route
 * planner): the run-up to the `cruise` speed (default: the free-flight cap, the worst case for fuel), then cruising with
 * the engines burning (the route planner passes the assisted cap instead and burns only in the run-up). `distance` = how far the ship gets after `seconds` of thrust; `fuel` = what
 * that burns. Null without forward thrust.
 */
export interface ForwardTravel {
  /** Acceleration (u/s²) and fuel burnt per second at full forward thrust. */
  accel: number;
  fuelPerSecond: number;
  /** Seconds of thrust from rest to top speed. */
  runUp: number;
  /** Distance after `seconds` of thrust. */
  distance(seconds: number): number;
  /** Seconds of thrust to cover `distance` (the inverse of `distance`). */
  seconds(distance: number): number;
}

export function travelFuel(thrust: number, mass: number, fuelUseMult: number, cruise = MAX_SPEED): ForwardTravel | null {
  if (thrust <= 0 || mass <= 0) return null;
  const accel = thrust / mass;
  const runUp = cruise / accel;
  const runUpDistance = 0.5 * accel * runUp * runUp;
  return {
    accel,
    fuelPerSecond: thrust * FUEL_PER_FORCE_SECOND * fuelUseMult,
    runUp,
    distance: (t) => (t <= runUp ? 0.5 * accel * t * t : runUpDistance + cruise * (t - runUp)),
    seconds: (d) => (d <= runUpDistance ? Math.sqrt((2 * Math.max(0, d)) / accel) : runUp + (d - runUpDistance) / cruise),
  };
}

/**
 * Distance on a full tank holding "forward" from rest: the run-up to top speed, then cruising at the
 * speed cap while the engines keep burning (as they do in the simulation). Empty cargo, no currents.
 */
export function fuelRange(fuel: number, thrust: number, mass: number, fuelUseMult: number): number | null {
  const travel = travelFuel(thrust, mass, fuelUseMult);
  return travel ? travel.distance(fuel / travel.fuelPerSecond) : null;
}

export type MetricId =
  | 'turn180' | 'accel' | 'topSpeedTime' | 'brakeTime' | 'fuelRange' | 'cargo'
  | 'energyMining' | 'energyCombat' | 'battery' | 'miningEndurance' | 'miningRate'
  | 'dps' | 'cannonArc' | 'shieldCapacity' | 'shieldRegen' | 'tractorRange' | 'tractorParts'
  | 'radar' | 'hp' | 'hull' | 'mass'
  // M4c: the large reactor's blast, the repair modules and refineries (their energy while at work)
  | 'blast' | 'repairRate' | 'refineIce' | 'refineOre' | 'energyWorkshop';

/** Metric values; null = "none" (cannot turn, cannot brake, no limit …). */
export type ShipMetrics = Record<MetricId, number | null>;

export function shipMetrics(s: ShipSummary): ShipMetrics {
  const accel = s.mass > 0 ? s.thrust.forward / s.mass : 0;
  // without reverse engines the dampers brake with the cockpit's weak RCS (control.ts)
  const brake = s.mass > 0 ? (s.thrust.backward > 0 ? s.thrust.backward : s.rcs) / s.mass : 0;
  const energyMining = s.energyGen - s.miningDraw;
  return {
    turn180: turnTime180(s.torque, s.inertia),
    accel,
    topSpeedTime: accel > 0 ? ASSISTED_SPEED / accel : null,
    brakeTime: brake > 0 ? ASSISTED_SPEED / brake : null,
    fuelRange: fuelRange(s.fuel, s.thrust.forward, s.mass, s.fuelUseMult),
    cargo: s.cargo,
    energyMining,
    energyCombat: s.energyGen - s.combatDraw,
    battery: s.battery,
    // how long the lasers keep firing on a full battery (null = forever)
    miningEndurance: s.lasers > 0 && energyMining < 0 ? s.battery / -energyMining : null,
    miningRate: s.miningRate,
    dps: s.dps,
    cannonArc: s.cannonArc,
    shieldCapacity: s.shieldCapacity,
    shieldRegen: s.shieldRegen,
    tractorRange: s.tractorRange,
    tractorParts: s.tractorParts,
    radar: s.radar,
    hp: s.hp,
    hull: s.hullUsed,
    mass: s.mass,
    blast: s.blast > 0 ? s.blast : null,
    repairRate: s.repairRate,
    refineIce: s.refineIce,
    refineOre: s.refineOre,
    // only a ship with a workshop has a workshop energy balance
    energyWorkshop: s.workshopDraw > 0 ? s.energyGen - s.workshopDraw : null,
  };
}

/** true = higher is better, false = lower is better. */
const HIGHER_BETTER: Record<MetricId, boolean> = {
  turn180: false, accel: true, topSpeedTime: false, brakeTime: false, fuelRange: true, cargo: true,
  energyMining: true, energyCombat: true, battery: true, miningEndurance: true, miningRate: true,
  dps: true, cannonArc: true, shieldCapacity: true, shieldRegen: true, tractorRange: true, tractorParts: true,
  radar: true, hp: true, hull: false, mass: false,
  blast: false, repairRate: true, refineIce: true, refineOre: true, energyWorkshop: true,
};

/** Relative changes below this count as "no change". */
const SAME = 0.005;

// ---------------------------------------------------------------------------
// the effect of one part

export type Trend = 'better' | 'worse' | 'same';

export interface EffectRow {
  id: MetricId;
  before: number | null;
  after: number | null;
  trend: Trend;
  /** Relative change in percent (for times, acceleration, range); null where it means little. */
  pct: number | null;
  /** main = what the part is for; side = the price (mass) or a by-effect. */
  role: 'main' | 'side';
  /** Hull row only: the cockpit's budget before and after (a new cockpit changes it). */
  budgetBefore?: number | null;
  budgetAfter?: number | null;
}

/** Where the estimate depends on placement (the UI says so). */
export type PlacementNote = 'engineForward' | 'cannonArc' | null;

export interface PartEffect {
  key: PartKey;
  before: ShipSummary;
  after: ShipSummary;
  metricsBefore: ShipMetrics;
  metricsAfter: ShipMetrics;
  rows: EffectRow[];
  placement: PlacementNote;
}

/** Metrics with a meaningful percentage change. */
const PCT: ReadonlySet<MetricId> = new Set(['turn180', 'accel', 'topSpeedTime', 'brakeTime', 'fuelRange', 'miningRate', 'dps', 'cargo']);

function hullTrend(used: number, budgetBefore: number | null, budgetAfter: number | null): Trend {
  if (budgetAfter !== null && used > budgetAfter) return 'worse';
  if (budgetBefore === null || budgetAfter === null || budgetAfter === budgetBefore) return 'same';
  return budgetAfter > budgetBefore ? 'better' : 'worse';
}

function trendOf(id: MetricId, before: number | null, after: number | null): Trend {
  // null = none: "cannot turn" / "cannot brake" is the worst for times, "forever" the best for endurance
  if (before === null && after === null) return 'same';
  // a first explosive part is a new risk; a first workshop is only bad news when it drains the battery
  if (id === 'blast') return before === null ? 'worse' : after === null ? 'better' : after > before ? 'worse' : after < before ? 'better' : 'same';
  if (id === 'energyWorkshop' && (before === null || after === null)) return (after ?? 0) < -1e-9 ? 'worse' : 'same';
  if (before === null) return id === 'miningEndurance' ? 'worse' : 'better';
  if (after === null) return id === 'miningEndurance' ? 'better' : 'worse';
  const scale = Math.max(Math.abs(before), Math.abs(after), 1e-9);
  if (Math.abs(after - before) / scale < SAME) return 'same';
  return (after > before) === HIGHER_BETTER[id] ? 'better' : 'worse';
}

/** What each part type is for (first = the headline row). */
function mainMetrics(partId: PartId, b: ShipMetrics, a: ShipMetrics): MetricId[] {
  switch (partId) {
    case 'cockpit': return ['hull', 'hp', 'turn180', 'energyMining', 'radar'];
    case 'armor': return ['hp'];
    case 'engine': return ['accel', 'topSpeedTime', 'fuelRange'];
    case 'gyro': return ['turn180'];
    case 'miningLaser':
    case 'heavyLaser': return ['miningRate', 'energyMining', ...(a.miningEndurance !== null ? ['miningEndurance' as const] : [])];
    case 'cargo':
    case 'largeCargo': return ['cargo'];
    case 'fuelTank': return ['fuelRange'];
    case 'reactor':
    case 'largeReactor':
      // the large one explodes when destroyed – second, so the shipyard palette's two rows show it
      return ['energyMining', ...(a.blast !== b.blast ? ['blast' as const] : []),
        ...(b.energyCombat !== b.energyMining ? ['energyCombat' as const] : []), 'battery',
        ...(b.miningEndurance !== null ? ['miningEndurance' as const] : []),
        // a reactor also powers the workshop
        ...(b.energyWorkshop !== null ? ['energyWorkshop' as const] : [])];
    case 'battery': return ['battery', ...(b.miningEndurance !== null ? ['miningEndurance' as const] : [])];
    case 'radar': return ['radar'];
    case 'cannon': return ['dps', 'cannonArc', 'energyCombat'];
    case 'shield': return ['shieldCapacity', 'shieldRegen', 'energyCombat'];
    case 'tractorBeam': return ['tractorRange', 'tractorParts'];
    case 'repairModule': return ['repairRate', 'energyWorkshop'];
    case 'refinery': return ['refineOre', 'refineIce', 'energyWorkshop'];
  }
}

/**
 * The effect of adding one part of type `key` to `grid` (a cockpit replaces the current one); `shape` =
 * the armour shape in hand (SL2 E2: its HP and hull points).
 */
export function partEffect(grid: ShipGrid, key: PartKey, shape?: ShapeId | null): PartEffect {
  const { partId } = parsePartKey(key);
  const before = summarizeShip(grid);
  const after = withPart(before, key, shape);
  const mb = shipMetrics(before);
  const ma = shipMetrics(after);
  const main = mainMetrics(partId, mb, ma);
  // the price of every part is its mass: slower acceleration and turning; plus the hull points
  const side: MetricId[] = ['hull', 'accel', 'turn180'].filter((id) => !main.includes(id as MetricId)) as MetricId[];
  const make = (id: MetricId, role: EffectRow['role']): EffectRow => {
    const b = mb[id];
    const a = ma[id];
    const pct = PCT.has(id) && b !== null && a !== null && Math.abs(b) > 1e-9 ? ((a - b) / Math.abs(b)) * 100 : null;
    if (id === 'hull') {
      return {
        id, before: b, after: a, pct, role,
        trend: hullTrend(after.hullUsed, before.hullBudget, after.hullBudget),
        budgetBefore: before.hullBudget,
        budgetAfter: after.hullBudget,
      };
    }
    return { id, before: b, after: a, trend: trendOf(id, b, a), pct, role };
  };
  // a cockpit lists everything it carries – only what actually changes (the hull budget always)
  const mainRows = main.map((id) => make(id, 'main')).filter((r) => partId !== 'cockpit' || r.id === 'hull' || r.trend !== 'same');
  const rows = [...mainRows, ...side.map((id) => make(id, 'side'))];
  return {
    key,
    before,
    after,
    metricsBefore: mb,
    metricsAfter: ma,
    rows,
    placement: partId === 'engine' ? 'engineForward' : partId === 'cannon' ? 'cannonArc' : null,
  };
}

// ---------------------------------------------------------------------------
// weaknesses and advice

export type WeaknessId = 'miningEnergy' | 'noBrake' | 'slowTurn' | 'noStrafe' | 'slowAccel' | 'combatEnergy' | 'noLaser' | 'shortRange';

export interface Weakness {
  id: WeaknessId;
  severity: 'high' | 'mid';
  /** The number the advice quotes (seconds, j/s, distance), if any. */
  value: number | null;
}

/** A half turn slower than this (s) is sluggish (≈ the editor's weak-turning warning at 0,6 rad/s²). */
export const SLOW_TURN_S = 4.5;
/** … and slower than this is a real problem. */
export const VERY_SLOW_TURN_S = 6;
/** Longer than this (s) to reach top speed is a slow ship. */
export const SLOW_ACCEL_S = 14;
/** Shorter full-throttle range than this (j) – the tank is small for trips. */
export const SHORT_RANGE = 6000;

/** Parts that fix each weakness (first = the one to name). */
export const REMEDIES: Record<WeaknessId, readonly PartId[]> = {
  miningEnergy: ['reactor', 'battery'],
  noBrake: ['engine'],
  slowTurn: ['gyro'],
  noStrafe: ['engine'],
  slowAccel: ['engine'],
  combatEnergy: ['reactor', 'battery'],
  noLaser: ['miningLaser', 'heavyLaser'],
  shortRange: ['fuelTank'],
};

/** The ship's weaknesses, most severe first. */
export function shipWeaknesses(s: ShipSummary): Weakness[] {
  if (s.parts === 0) return [];
  const m = shipMetrics(s);
  const out: Weakness[] = [];
  if (s.lasers > 0 && m.energyMining! < -1e-9) out.push({ id: 'miningEnergy', severity: 'high', value: m.energyMining });
  if (s.thrust.forward > 0 && s.thrust.backward <= 0) out.push({ id: 'noBrake', severity: 'high', value: null });
  if (m.turn180 === null || m.turn180 > SLOW_TURN_S) {
    out.push({ id: 'slowTurn', severity: m.turn180 === null || m.turn180 > VERY_SLOW_TURN_S ? 'high' : 'mid', value: m.turn180 });
  }
  if (s.thrust.left <= 0 || s.thrust.right <= 0) out.push({ id: 'noStrafe', severity: 'mid', value: null });
  if (m.topSpeedTime !== null && m.topSpeedTime > SLOW_ACCEL_S) out.push({ id: 'slowAccel', severity: 'mid', value: m.topSpeedTime });
  if ((s.cannons > 0 || s.shieldCapacity > 0) && m.energyCombat! < -1e-9) out.push({ id: 'combatEnergy', severity: 'mid', value: m.energyCombat });
  if (s.lasers === 0) out.push({ id: 'noLaser', severity: 'mid', value: null });
  if (m.fuelRange !== null && m.fuelRange < SHORT_RANGE) out.push({ id: 'shortRange', severity: 'mid', value: m.fuelRange });
  const rank = (w: Weakness): number => (w.severity === 'high' ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b));
}

export type Advice =
  /** The part does not fit the hull budget. */
  | { kind: 'noRoom'; tone: 'warn'; used: number; budget: number; need: number; cockpitTier: Tier | null }
  /** The part adds nothing to this ship (a radar that does not see further, the same cockpit). */
  | { kind: 'noEffect'; tone: 'info'; partId: PartId; value: number | null }
  /** The part fixes the ship's weakness. */
  | { kind: 'fixes'; tone: 'ok'; weakness: WeaknessId; before: number | null; after: number | null }
  /** The part creates a weakness (a laser that makes mining drain the battery). */
  | { kind: 'causes'; tone: 'warn'; weakness: WeaknessId; after: number | null }
  /** A severe weakness of the ship that another part would fix. */
  | { kind: 'general'; tone: 'warn'; weakness: WeaknessId; value: number | null; remedy: PartId };

const valueOf = (id: WeaknessId, m: ShipMetrics): number | null =>
  id === 'miningEnergy' ? m.energyMining
  : id === 'combatEnergy' ? m.energyCombat
  : id === 'slowTurn' ? m.turn180
  : id === 'slowAccel' ? m.topSpeedTime
  : id === 'shortRange' ? m.fuelRange
  : null;

/** Does the estimate show the weakness getting better with the part? */
function improves(id: WeaknessId, e: PartEffect): boolean {
  const b = e.metricsBefore;
  const a = e.metricsAfter;
  switch (id) {
    case 'miningEnergy': return a.energyMining! > b.energyMining! + 1e-9 || (b.miningEndurance !== null && (a.miningEndurance === null || a.miningEndurance > b.miningEndurance));
    case 'combatEnergy': return a.energyCombat! > b.energyCombat! + 1e-9 || a.battery! > b.battery!;
    case 'slowTurn': return b.turn180 === null ? a.turn180 !== null : a.turn180 !== null && a.turn180 < b.turn180 - 1e-9;
    case 'slowAccel': return a.accel! > b.accel! + 1e-9;
    case 'shortRange': return (a.fuelRange ?? 0) > (b.fuelRange ?? 0);
    // an engine fixes brakes / strafing only when turned that way – the advice tells how
    case 'noBrake':
    case 'noStrafe':
    case 'noLaser': return true;
  }
}

/**
 * At most one line about the selected part on this ship, the most relevant first: it does not fit,
 * it adds nothing, it fixes a weakness, it creates one; otherwise only a severe weakness that
 * another part would fix. null = nothing worth saying (never nag).
 */
export function partAdvice(e: PartEffect, partId: PartId): Advice | null {
  const { before, after } = e;
  if (after.hullBudget !== null && after.hullUsed > after.hullBudget && after.hullUsed > before.hullUsed) {
    return {
      kind: 'noRoom', tone: 'warn', used: before.hullUsed, budget: after.hullBudget, need: after.hullUsed - before.hullUsed,
      cockpitTier: before.cockpit?.tier ?? null,
    };
  }
  if (partId === 'radar' && after.radar <= before.radar) return { kind: 'noEffect', tone: 'info', partId, value: before.radar };
  if (partId === 'cockpit' && e.rows.every((r) => r.trend === 'same')) return { kind: 'noEffect', tone: 'info', partId, value: null };
  const weak = shipWeaknesses(before);
  const fixed = weak.find((w) => REMEDIES[w.id].includes(partId) && improves(w.id, e));
  if (fixed) return { kind: 'fixes', tone: 'ok', weakness: fixed.id, before: fixed.value, after: valueOf(fixed.id, e.metricsAfter) };
  const was = new Set(weak.map((w) => w.id));
  const caused = shipWeaknesses(after).find((w) => !was.has(w.id) && (w.id === 'miningEnergy' || w.id === 'combatEnergy' || w.id === 'slowTurn'));
  if (caused) return { kind: 'causes', tone: 'warn', weakness: caused.id, after: caused.value };
  const severe = weak.find((w) => w.severity === 'high');
  if (severe) return { kind: 'general', tone: 'warn', weakness: severe.id, value: severe.value, remedy: REMEDIES[severe.id][0]! };
  return null;
}
