// Ice cracking (long-term design): ice has no veins, but at 30% of its volume it cracks into 3 pieces
// that must be mined further – together they give 20% more than was left. Shards are ordinary asteroids,
// derived only from the parent and the remainder at the time of cracking (the save holds only [parent id, remainder]).
import { TAU } from '../math/angle';
import { fnv1a32 } from '../math/fnv1a';
import type { Asteroid } from './generate';

/** Ice cracks when no more than this much of its original volume is left. */
export const ICE_CRACK_AT = 0.3;
export const ICE_FRAGMENTS = 3;
/** The shards together give this much more than was left in the parent. */
export const ICE_FRAGMENT_BONUS = 0.2;
/** Shard id = parent id + '~' + index. */
export const FRAGMENT_MARK = '~';

export const isFragment = (a: Pick<Asteroid, 'id'>): boolean => a.id.includes(FRAGMENT_MARK);

/** Can the asteroid crack (ice, not a shard)? */
export const canCrack = (a: Pick<Asteroid, 'id' | 'resource'>): boolean => a.resource === 'ice' && !isFragment(a);

/** Does it crack now? (The remainder is positive and dropped to 30% or less.) */
export const shouldCrack = (a: Asteroid, remaining: number): boolean =>
  canCrack(a) && remaining > 0 && remaining <= ICE_CRACK_AT * a.initialAmount + 1e-9;

/** Radius of an asteroid with remainder `amount` (like World.radiusOf). */
const radiusAt = (a: Asteroid, amount: number): number => a.baseRadius * Math.max(0.35, Math.sqrt(amount / a.initialAmount));

/** Shards of a parent that cracked with remainder `amount` – spread 120° apart around it. */
export function crackFragments(parent: Asteroid, amount: number): Asteroid[] {
  const each = (amount * (1 + ICE_FRAGMENT_BONUS)) / ICE_FRAGMENTS;
  const baseRadius = Math.max(0.3, Math.sqrt(each / 25));
  const hash = fnv1a32(parent.id);
  const start = (hash / 0x1_0000_0000) * TAU;
  const distance = radiusAt(parent, amount) * 0.9 + baseRadius * 0.2;
  const out: Asteroid[] = [];
  for (let k = 0; k < ICE_FRAGMENTS; k++) {
    const angle = start + (k * TAU) / ICE_FRAGMENTS;
    const v = parent.variant * 7.31 + k * 0.377;
    out.push({
      id: `${parent.id}${FRAGMENT_MARK}${k}`,
      pos: { x: parent.pos.x + Math.cos(angle) * distance, y: parent.pos.y + Math.sin(angle) * distance },
      baseRadius,
      resource: parent.resource,
      initialAmount: each,
      variant: v - Math.floor(v),
    });
  }
  return out;
}
