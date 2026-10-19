// Part variants (long-term design 3.3 "Varianty"): they change 1–3 stats with an obvious trade-off.
// A plan (3 fragments from wrecks and caches, 3.2.3) or an Archive node (3.2.4) unlocks them. M4c adds
// five plan variants (plan 2026-10-20 §2.5); new ids are always appended (ids are save and template keys).
import type { PartId } from './parts';

export type VariantId =
  | 'overdrive' | 'eco' | 'rapid' | 'armored' | 'survey' | 'combat' | 'scout' | 'extended' | 'quick'
  | 'focused' | 'light' | 'flywheel' | 'buffer' | 'longBarrel';
export const VARIANT_IDS: readonly VariantId[] = [
  'overdrive', 'eco', 'rapid', 'armored', 'survey', 'combat', 'scout', 'extended', 'quick',
  'focused', 'light', 'flywheel', 'buffer', 'longBarrel',
];

/** Multipliers (for the hull budget an increment) against the base part of the same tier. */
export interface VariantMods {
  /** Part mass (light armour ×0.5, flywheel gyroscope ×1.75). */
  mass?: number;
  thrust?: number;
  /** Gyroscope torque. */
  torque?: number;
  /** Mining laser: units per second and energy per second while mining. */
  miningRate?: number;
  miningEnergy?: number;
  /** Reactor: energy per second and battery capacity. */
  energyGen?: number;
  battery?: number;
  /** Cannon: projectile range. */
  range?: number;
  /** Fuel use of the engine (multiplier). */
  fuelUse?: number;
  fireRate?: number;
  damage?: number;
  cargo?: number;
  hp?: number;
  radarRange?: number;
  /** Cockpit hull budget – increment in points (combat cockpit −4 pts). */
  hullBudget?: number;
  /** Scanner pulse charge (multiplier, scout cockpit −30 %). */
  pulseCooldown?: number;
  fuel?: number;
  shieldRegen?: number;
  shieldCapacity?: number;
}

export type VariantSource = { kind: 'plan' } | { kind: 'archive'; node: string };

export interface VariantDef {
  id: VariantId;
  base: PartId;
  mods: VariantMods;
  source: VariantSource;
}

const plan: VariantSource = { kind: 'plan' };

export const VARIANTS: Record<VariantId, VariantDef> = {
  overdrive: { id: 'overdrive', base: 'engine', mods: { thrust: 1.4, fuelUse: 1.8 }, source: plan },
  eco: { id: 'eco', base: 'engine', mods: { thrust: 0.8, fuelUse: 0.6 }, source: plan },
  rapid: { id: 'rapid', base: 'cannon', mods: { fireRate: 2.5, damage: 0.45 }, source: { kind: 'archive', node: 'cannonRapid' } },
  armored: { id: 'armored', base: 'cargo', mods: { cargo: 0.7, hp: 2 }, source: plan },
  survey: { id: 'survey', base: 'radar', mods: { radarRange: 1.5, hp: 0.6 }, source: plan },
  combat: { id: 'combat', base: 'cockpit', mods: { hp: 1.6, hullBudget: -4 }, source: plan },
  scout: { id: 'scout', base: 'cockpit', mods: { radarRange: 1.6, pulseCooldown: 0.7, hp: 0.8 }, source: plan },
  extended: { id: 'extended', base: 'fuelTank', mods: { fuel: 1.5, hp: 0.7 }, source: { kind: 'archive', node: 'fuelTankPlus' } },
  quick: { id: 'quick', base: 'shield', mods: { shieldRegen: 1.8, shieldCapacity: 0.7 }, source: { kind: 'archive', node: 'shieldQuick' } },
  // M4c (plan 2026-10-20 §2.5)
  focused: { id: 'focused', base: 'miningLaser', mods: { miningRate: 1.35, miningEnergy: 1.5 }, source: plan },
  light: { id: 'light', base: 'armor', mods: { hp: 0.6, mass: 0.5 }, source: plan },
  flywheel: { id: 'flywheel', base: 'gyro', mods: { torque: 1.6, mass: 1.75 }, source: plan },
  buffer: { id: 'buffer', base: 'reactor', mods: { energyGen: 0.6, battery: 3 }, source: plan },
  longBarrel: { id: 'longBarrel', base: 'cannon', mods: { range: 1.4, fireRate: 0.5, damage: 1.5 }, source: plan },
};

/** Variant crafting: resources as the base part, the fee × this (rounded to 50 cr). */
export const VARIANT_FEE_MULT = 1.3;

/** Variants unlocked by a blueprint from fragments. */
export const PLAN_VARIANTS: readonly VariantId[] = VARIANT_IDS.filter((v) => VARIANTS[v].source.kind === 'plan');
