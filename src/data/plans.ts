// Blueprints from fragments (long-term design 3.2.3): 3 fragments = a part-variant blueprint. A fragment drops
// from wrecks and caches, the table is weighted by source (pirate wrecks give weapons and combat parts,
// cargo wrecks logistics). Bad-luck protection: every wreck without a fragment raises the next one's chance by 8 %,
// at the latest every 6th wreck of a type gives a fragment.
import type { WreckClass } from './poi';
import { PLAN_VARIANTS, type VariantId } from './variants';

/** Blueprint = the part variant it unlocks. */
export type PlanId = VariantId;
export const PLAN_IDS: readonly PlanId[] = PLAN_VARIANTS;

export const FRAGMENTS_PER_PLAN = 3;

/**
 * Source of a fragment (wreck class or cache) – each has its own pity counter. M4b: 'derelict' = the plan
 * service of a derelict station's terminal (sim/sites/terminal.ts) – its fragments are guaranteed (base
 * chance 1, so its pity counter never moves); only its plan weights matter.
 */
export type FragmentSource = WreckClass | 'cache' | 'derelict';
export const FRAGMENT_SOURCES: readonly FragmentSource[] = ['miner', 'freighter', 'pirate', 'cache', 'derelict'];

export const FRAGMENT_BASE_CHANCE: Record<FragmentSource, number> = { miner: 0.2, freighter: 0.2, pirate: 0.25, cache: 0.5, derelict: 1 };
/** Every source without a fragment raises the next one's chance by this much. */
export const PITY_STEP = 0.08;
/** After this many sources without a fragment the next one surely gives one (the 6th wreck). */
export const PITY_MAX_MISSES = 5;

/** Blueprint weights by source (a missing blueprint = 0). */
export const PLAN_WEIGHTS: Record<FragmentSource, Partial<Record<PlanId, number>>> = {
  pirate: { combat: 3, overdrive: 3, survey: 1, flywheel: 1, longBarrel: 2 },
  freighter: { armored: 3, eco: 3, overdrive: 1, light: 1, buffer: 2 },
  miner: { survey: 3, scout: 3, eco: 1, focused: 3 },
  cache: { overdrive: 1, eco: 1, armored: 1, survey: 1, combat: 1, scout: 1, focused: 1, light: 1, flywheel: 1, buffer: 1, longBarrel: 1 },
  // a station's archive: logistics and survey kit more than weapons
  derelict: { eco: 2, armored: 2, survey: 2, scout: 2, overdrive: 1, combat: 1, focused: 1, light: 1, flywheel: 1, buffer: 1 },
};
