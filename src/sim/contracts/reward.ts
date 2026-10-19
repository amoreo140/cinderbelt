// Contract reward (long-term design): estimated duration × reference income × k_type × (1 + risk)
// × sector modifier. Reference income = mining income of the player's best ship in the ring
// (per the economic model), at least the ring minimum; frozen on acceptance.
import { CONTRACT_DEFS, MIN_REFERENCE_INCOME, REP_BASE, REP_PER_MINUTE, MAX_CONTRACT_SECONDS, MIN_CONTRACT_SECONDS, type ContractRisk, type ContractType } from '../../data/contracts';
import { resourcePrice, round5, type RingIndex } from '../../data/economy';
import { HUMAN_EFFICIENCY, RING_TRIP, TRIP_OVERHEAD, VEIN_SKILL } from '../../data/incomeModel';
import { RESOURCE_IDS } from '../../data/resources';
import { createStarterShip } from '../ship/presets';
import { computeProperties, type ShipProperties } from '../ship/properties';
import { RINGS } from '../world/rings';

/** Average buy-back price of the mined mix in the ring (cr/u, without the station deviation). */
export function averageSellPrice(ring: RingIndex): number {
  const weights = RINGS[ring - 1]!.weights;
  let total = 0;
  let sum = 0;
  for (const r of RESOURCE_IDS) {
    const w = weights[r] ?? 0;
    total += w;
    sum += w * resourcePrice(r, ring, 1).sell;
  }
  return total > 0 ? sum / total : 0;
}

/** Units mined per hour (trip model: flight, mining, overhead, human efficiency). */
export function miningUnitsPerHour(props: Pick<ShipProperties, 'lasers' | 'cargoCapacity'>, ring: RingIndex, yieldMult = 1): number {
  const trip = RING_TRIP[ring];
  const rate = props.lasers.reduce((s, l) => s + l.rate, 0) * VEIN_SKILL * trip.search * yieldMult;
  if (rate <= 0 || props.cargoCapacity <= 0) return 0;
  const secs = (trip.travel + props.cargoCapacity / rate + TRIP_OVERHEAD) * trip.hazard;
  return ((props.cargoCapacity * 3600) / secs) * HUMAN_EFFICIENCY;
}

/** Mining income of a ship that mines `unitsPerHour` in the ring (cr/h, after operating costs). */
export const incomeOfUnits = (unitsPerHour: number, ring: RingIndex): number => unitsPerHour * averageSellPrice(ring) * (1 - RING_TRIP[ring].opcost);

/** Mining income of a ship in the ring (cr/h). */
export function miningIncome(props: Pick<ShipProperties, 'lasers' | 'cargoCapacity'>, ring: RingIndex, yieldMult = 1): number {
  return incomeOfUnits(miningUnitsPerHour(props, ring, yieldMult), ring);
}

const referenceUnits = new Map<string, number>();

/**
 * Units/h of the ring's reference ship – the starter hull every player has (or is lent by the Guild).
 * A contract's duration estimate never assumes a slower ship (saboteur report X2: a ship stripped
 * before accepting must not inflate the frozen reward).
 */
export function referenceUnitsPerHour(ring: RingIndex, yieldMult = 1): number {
  const key = `${ring}:${yieldMult}`;
  let v = referenceUnits.get(key);
  if (v === undefined) {
    v = miningUnitsPerHour(computeProperties(createStarterShip()), ring, yieldMult);
    referenceUnits.set(key, v);
  }
  return v;
}

/** Reference income: the best of the player's ships, at least the ring minimum. */
export function referenceIncome(ships: readonly Pick<ShipProperties, 'lasers' | 'cargoCapacity'>[], ring: RingIndex, yieldMult = 1): number {
  let best = MIN_REFERENCE_INCOME[ring];
  for (const s of ships) best = Math.max(best, miningIncome(s, ring, yieldMult));
  return best;
}

/** Best mining rate of the player's ships (u/h) – for the duration estimate; a modest estimate without lasers. */
export function bestUnitsPerHour(ships: readonly Pick<ShipProperties, 'lasers' | 'cargoCapacity'>[], ring: RingIndex, yieldMult = 1): number {
  let best = 0;
  for (const s of ships) best = Math.max(best, miningUnitsPerHour(s, ring, yieldMult));
  return best > 0 ? best : 1000;
}

export const clampSeconds = (s: number): number => Math.min(MAX_CONTRACT_SECONDS, Math.max(MIN_CONTRACT_SECONDS, s));

export interface RewardInput {
  type: ContractType;
  seconds: number;
  risk: ContractRisk;
  /** Sector surcharge (sum of warning bonuses). */
  bonus: number;
  refIncome: number;
  /** Value of goods (Delivery) and other fixed sums (reward for the captain). */
  extra?: number;
}

/** Reward in credits, rounded to 5 cr. */
export function contractReward(i: RewardInput): number {
  const k = CONTRACT_DEFS[i.type].k;
  return round5((i.seconds / 3600) * i.refIncome * k * (1 + i.risk) * (1 + i.bonus) + (i.extra ?? 0));
}

/** Reputation points for a contract (by estimated duration). */
export const contractRep = (seconds: number): number => Math.round(REP_BASE + (REP_PER_MINUTE * seconds) / 60);
