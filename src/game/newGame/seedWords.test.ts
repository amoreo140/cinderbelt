import { describe, expect, it } from 'vitest';
import { seedFromText } from '../../sim/settings';
import { mulberry32Like, randomSeedText, SEED_ADJECTIVES, SEED_NOUNS } from './seedWords';

describe('random seed text', () => {
  it('is an adjective-noun-number triple without diacritics', () => {
    const rand = mulberry32Like(7);
    for (let i = 0; i < 200; i++) {
      const text = randomSeedText(rand);
      expect(text).toMatch(/^[a-z]+-[a-z]+-\d{2}$/);
      const [adj, noun, n] = text.split('-');
      expect(SEED_ADJECTIVES).toContain(adj);
      expect(SEED_NOUNS).toContain(noun);
      expect(Number(n)).toBeGreaterThanOrEqual(10);
      expect(Number(n)).toBeLessThanOrEqual(99);
    }
  });

  it('is deterministic for the same random source and varied across calls', () => {
    const a = mulberry32Like(42);
    const b = mulberry32Like(42);
    const seqA = Array.from({ length: 20 }, () => randomSeedText(a));
    const seqB = Array.from({ length: 20 }, () => randomSeedText(b));
    expect(seqA).toEqual(seqB);
    expect(new Set(seqA).size).toBeGreaterThan(15);
  });

  it('covers the edges of the random range', () => {
    expect(randomSeedText(() => 0)).toBe(`${SEED_ADJECTIVES[0]}-${SEED_NOUNS[0]}-10`);
    expect(randomSeedText(() => 0.999999)).toBe(`${SEED_ADJECTIVES.at(-1)}-${SEED_NOUNS.at(-1)}-99`);
  });

  it('word lists are clean, unique and produce distinct world seeds', () => {
    for (const list of [SEED_ADJECTIVES, SEED_NOUNS]) {
      expect(new Set(list).size).toBe(list.length);
      for (const w of list) expect(w).toMatch(/^[a-z]{3,10}$/);
    }
    expect(seedFromText('tichy-prach-73')).not.toBe(seedFromText('tichy-prach-74'));
  });
});
