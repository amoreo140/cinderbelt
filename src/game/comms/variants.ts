// Deterministic line variants: the same tick and event always pick the same line (no Math.random).
import { hash3 } from '../../sim/world/hash';

/** 32-bit FNV-1a hash of a string (event keys like `toll:pr:3,4`). */
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Index of the variant for an event at a tick (`count` > 0). */
export function variantIndex(count: number, tick: number, key: string): number {
  return hash3(tick, hashText(key), 0xc0aa5) % Math.max(1, count);
}

/** One of the variants, picked by a hash of tick + event key. */
export function pickLine<T>(variants: readonly T[], tick: number, key: string): T {
  if (variants.length === 0) throw new Error('pickLine: no variants');
  return variants[variantIndex(variants.length, tick, key)]!;
}
