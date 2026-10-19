// Fragments and blueprints: a roll with bad-luck protection (+8% for every source without a fragment,
// at the latest every 6th), blueprint choice weighted by source, a duplicate fragment = 30 Data.
// Fragments are key items – they are written to the journal as soon as they are picked up and cannot be lost.
import { FRAGMENT_BASE_CHANCE, FRAGMENTS_PER_PLAN, PITY_MAX_MISSES, PITY_STEP, PLAN_IDS, PLAN_WEIGHTS, type FragmentSource, type PlanId } from '../../data/plans';
import { DATA_REWARDS } from '../../data/poi';
import { fnv1a32 } from '../math/fnv1a';
import type { SimEvent, SimState } from '../Simulation';
import { hash3 } from '../world/hash';
import { fireJournal } from './journal';
import { gainData, logDiscovery } from './state';

const FRAGMENT_SALT = 0xf7a6_3e17;
/** A completed blueprint has a lower weight in the choice (duplicates happen, but less often). */
const COMPLETE_WEIGHT = 0.25;

const unit = (h: number): number => h / 4294967296;

/** Chance of a fragment from a source at the current bad-luck counter. */
export function fragmentChance(state: SimState, source: FragmentSource): number {
  const misses = state.discovery.pity.get(source) ?? 0;
  return misses >= PITY_MAX_MISSES ? 1 : Math.min(1, FRAGMENT_BASE_CHANCE[source] + PITY_STEP * misses);
}

/**
 * Roll for a fragment from a source (wreck, cache) – deterministic from the seed, the source id and the counter.
 * Advances the bad-luck counter. Returns a blueprint, or null.
 */
export function rollFragment(state: SimState, source: FragmentSource, sourceId: string): PlanId | null {
  const d = state.discovery;
  const misses = d.pity.get(source) ?? 0;
  const h = hash3(state.seed ^ FRAGMENT_SALT, fnv1a32(sourceId), misses);
  if (unit(h) >= fragmentChance(state, source)) {
    d.pity.set(source, misses + 1);
    return null;
  }
  d.pity.set(source, 0);
  return pickPlan(state, source, unit(hash3(h, 0x51a7, misses)));
}

/** The plan of a fragment from `source` for a roll `u` in [0, 1) – weighted, completed plans less. */
function pickPlan(state: SimState, source: FragmentSource, u: number): PlanId | null {
  const d = state.discovery;
  const weights = PLAN_IDS.map((p) => (PLAN_WEIGHTS[source][p] ?? 0) * (d.plans.has(p) ? COMPLETE_WEIGHT : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = u * total;
  for (let i = 0; i < PLAN_IDS.length; i++) {
    r -= weights[i]!;
    if (r < 0 && weights[i]! > 0) return PLAN_IDS[i]!;
  }
  return PLAN_IDS.filter((_, i) => weights[i]! > 0).at(-1) ?? null;
}

/**
 * The fragment of a wreck POI (I10): a pure function of the seed and the POI id at the source's base
 * chance, so a wreck that despawns and respawns (flying away and back) holds the same – it cannot be
 * re-rolled. Only the `first` roll of a POI moves the pity counter, like any other source.
 */
export function rollPoiFragment(state: SimState, source: FragmentSource, poiId: string, first: boolean): PlanId | null {
  const d = state.discovery;
  const h = hash3(state.seed ^ FRAGMENT_SALT, fnv1a32(poiId), 0);
  const hit = unit(h) < FRAGMENT_BASE_CHANCE[source];
  if (first) d.pity.set(source, hit ? 0 : (d.pity.get(source) ?? 0) + 1);
  return hit ? pickPlan(state, source, unit(hash3(h, 0x51a7, 0))) : null;
}

/** A picked-up fragment: towards the blueprint, or 30 Data if the blueprint is done. */
export function awardFragment(state: SimState, plan: PlanId, events: SimEvent[]): void {
  const d = state.discovery;
  if (d.plans.has(plan)) {
    events.push({ type: 'fragmentFound', plan, count: FRAGMENTS_PER_PLAN, complete: true, duplicate: true });
    gainData(state, DATA_REWARDS.duplicateFragment, 'fragment', events);
    return;
  }
  const count = (d.fragments.get(plan) ?? 0) + 1;
  const complete = count >= FRAGMENTS_PER_PLAN;
  if (complete) {
    d.fragments.delete(plan);
    d.plans.add(plan);
    logDiscovery(state, { tick: state.tick, kind: 'plan', plan });
  } else {
    d.fragments.set(plan, count);
  }
  events.push({ type: 'fragmentFound', plan, count, complete, duplicate: false });
  fireJournal(state, { on: 'fragmentFound' }, events);
  if (complete) fireJournal(state, { on: 'planComplete' }, events);
}
