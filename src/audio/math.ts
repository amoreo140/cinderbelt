// Small pure helper functions for the audio module (no Web Audio API).

export type Rng = () => number;

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth 0..1 transition (Hermite), good for "soft" curves. */
export function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/** Frequency ratio for the given number of semitones. */
export function semitonesToRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

export function centsToRatio(cents: number): number {
  return Math.pow(2, cents / 1200);
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}

/**
 * Volume from a 0..1 slider to a linear gain. A quadratic curve feels
 * more natural than a linear one (the ear perceives loudness logarithmically).
 */
export function volumeToGain(volume: number): number {
  const v = clamp01(volume);
  return v * v;
}

/** Resulting master output gain, taking mute into account. */
export function masterGain(volume: number, muted: boolean): number {
  return muted ? 0 : volumeToGain(volume);
}

/** Deterministic PRNG (mulberry32) - tests and the generative ambient. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomRange(rand: Rng, min: number, max: number): number {
  return min + (max - min) * rand();
}

export function randomPick<T>(rand: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('randomPick: empty array');
  const index = Math.min(items.length - 1, Math.floor(rand() * items.length));
  return items[index] as T;
}
