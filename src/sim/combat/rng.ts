// Deterministic combat RNG with a savable state (mulberry32 like sim/math/rng, but the state lives in the data).

/** The next number in [0, 1); advances `holder.rng`. */
export function rngNext(holder: { rng: number }): number {
  const s = (holder.rng + 0x6d2b79f5) >>> 0;
  holder.rng = s;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const rngRange = (holder: { rng: number }, min: number, max: number): number => min + (max - min) * rngNext(holder);
