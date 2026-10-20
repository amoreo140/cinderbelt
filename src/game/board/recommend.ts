// Jobs board: which offer to put on top. A pure function over the offer slips.
import type { SlipData } from './slipView';

type Candidate = Pick<SlipData, 'offerId' | 'risk' | 'short' | 'reward' | 'minutes' | 'accept'>;

/** Reward per estimated minute (the plain reward when the duration is unknown). */
export const payPerMinute = (o: Pick<SlipData, 'reward' | 'minutes'>): number => (o.minutes > 0 ? o.reward / o.minutes : o.reward);

function better(a: Candidate, b: Candidate): boolean {
  if (a.risk !== b.risk) return a.risk < b.risk;
  if (a.short !== b.short) return a.short;
  const pa = payPerMinute(a);
  const pb = payPerMinute(b);
  if (pa !== pb) return pa > pb;
  return a.offerId < b.offerId;
}

/**
 * The recommended offer: only offers that can be accepted now; the lowest risk first, then short
 * contracts, then the highest reward per minute; ties go to the smaller offer id. Null when none qualifies.
 */
export function recommendOffer<T extends Candidate>(offers: readonly T[]): T | null {
  let best: T | null = null;
  for (const o of offers) {
    if (o.accept?.enabled !== true) continue;
    if (best === null || better(o, best)) best = o;
  }
  return best;
}

export interface RecommendReason {
  noRisk: boolean;
  short: boolean;
  /** The pick pays the most per minute among the acceptable offers. */
  bestPay: boolean;
}

/** Why the offer was picked (facts for the one-line reason). */
export function recommendReason(pick: Candidate, offers: readonly Candidate[]): RecommendReason {
  const pay = payPerMinute(pick);
  const bestPay = offers.every((o) => o.accept?.enabled !== true || payPerMinute(o) <= pay);
  return { noRisk: pick.risk === 0, short: pick.short, bestPay };
}
