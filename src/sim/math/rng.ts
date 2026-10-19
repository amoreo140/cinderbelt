/** A random number generator in [0, 1). */
export type Rng = () => number;

/** mulberry32 – a fast deterministic RNG from a seed. */
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randRange = (rng: Rng, min: number, max: number): number =>
  min + (max - min) * rng();
