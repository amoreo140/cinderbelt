// On-board workshop (M4c, home and workshop plan §2.4): the refinery and the repair
// module work in flight from the ship's own cargo and energy. The numbers live here, the logic in
// src/sim/ship/workshop.ts.
import { PRICE_JITTER_MIN, resourcePrice, RING_INDICES, round1 } from './economy';
import type { ResourceId } from './resources';

/**
 * Refined ore sells for `price × (1 + REFINED_BONUS)` from the ship's cargo (rounded like any sale), at most
 * `REFINED_CEILING` per unit. No arbitrage at the same ring multiplier: 0.8 × 1.15 = 0.92 × base < buy
 * price 1.25 × base; across rings the ceiling closes it (saboteur W1, M4d plan §2.6).
 */
export const REFINED_BONUS = 0.15;

/** Ore the refinery refines (ice is never refined). */
export type RefinedId = Exclude<ResourceId, 'ice'>;

/**
 * The cheapest price any station sells `r` for: the lowest ring multiplier at the lowest price jitter,
 * through the station price formula itself (same rounding).
 */
export const cheapestBuy = (r: ResourceId): number => Math.min(...RING_INDICES.map((ring) => resourcePrice(r, ring, PRICE_JITTER_MIN).buy));

/**
 * W1 – the refined price ceiling (M4d plan §2.6): a refined unit never sells above the cheapest buy price of
 * its resource anywhere (one 0.1 kr price step below it), so buying ore, refining it in flight and selling
 * it in another ring never gains (iron 4.2, copper 5.8, titanium 11.2 – derived, not hard-coded). It bites
 * only iron and copper in rings 3–4; ring 1–2 refining and every titanium sale keep the full bonus.
 */
export const REFINED_CEILING: Readonly<Record<RefinedId, number>> = {
  iron: round1(cheapestBuy('iron') - 0.1),
  copper: round1(cheapestBuy('copper') - 0.1),
  titanium: round1(cheapestBuy('titanium') - 0.1),
};

/**
 * Repair modules and refineries are the lowest-priority consumers: they only work while the battery is
 * above this share of its capacity after lasers, shields, tractor and cannons took theirs (refineries
 * stop before repair modules).
 */
export const WORKSHOP_MIN_BATTERY = 0.2;
