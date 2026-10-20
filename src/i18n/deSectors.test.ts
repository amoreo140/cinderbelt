// German sector names: every adjective × noun pair agrees in gender (strong nominative -er / -e / -es),
// nouns are capitalised, the 144 generated names are unique; the hand-made names cover every landmark kind.
import { describe, expect, it } from 'vitest';
import { SECTOR_NAME_WORDS } from '../sim/regions/sectors';
import { LANDMARK_KINDS } from '../sim/world/landmarks';
import { DE_ADJECTIVES, DE_NOUNS, deSectors, type DeGender } from './deSectors';

/** Strong nominative singular endings of a German adjective. */
const ENDINGS: Record<DeGender, RegExp> = { m: /er$/, f: /e$/, n: /es$/ };

/** The stem of an adjective form (without its gender ending). */
const stem = (form: string, gender: DeGender): string => form.replace(ENDINGS[gender], '');

describe('German sector names', () => {
  it('has 12 × 12 words, as the simulation expects', () => {
    expect(DE_ADJECTIVES).toHaveLength(SECTOR_NAME_WORDS.adjectives);
    expect(DE_NOUNS).toHaveLength(SECTOR_NAME_WORDS.nouns);
  });

  it('every adjective has -er / -e / -es forms of one stem', () => {
    for (const a of DE_ADJECTIVES) {
      for (const g of ['m', 'f', 'n'] as const) expect(a[g], `${a.m} (${g})`).toMatch(ENDINGS[g]);
      expect(stem(a.f, 'f'), a.m).toBe(stem(a.m, 'm'));
      expect(stem(a.n, 'n'), a.m).toBe(stem(a.m, 'm'));
      expect(a.m[0], a.m).toBe(a.m[0]!.toUpperCase());
    }
  });

  it('nouns are capitalised and every gender is used', () => {
    for (const n of DE_NOUNS) expect(n.word, n.word).toMatch(/^\p{Lu}\p{Ll}+$/u);
    for (const g of ['m', 'f', 'n'] as const) expect(DE_NOUNS.filter((n) => n.gender === g).length, g).toBeGreaterThanOrEqual(3);
  });

  it('every pair agrees in gender and the 144 names are unique', () => {
    const names = new Set<string>();
    for (let a = 0; a < SECTOR_NAME_WORDS.adjectives; a++) {
      for (let n = 0; n < SECTOR_NAME_WORDS.nouns; n++) {
        const name = deSectors.generated(a, n);
        const noun = DE_NOUNS[n]!;
        expect(name).toBe(`${DE_ADJECTIVES[a]![noun.gender]} ${noun.word}`);
        expect(name.split(' ')[0], name).toMatch(ENDINGS[noun.gender]);
        expect(name).toMatch(/^\p{Lu}\p{Ll}+ \p{Lu}\p{Ll}+$/u);
        names.add(name);
      }
    }
    expect(names.size).toBe(144);
  });

  it('wraps indexes like the Slovak names and agrees in gender', () => {
    expect(deSectors.generated(1, 0)).toBe('Rostige Schwelle');
    expect(deSectors.generated(1, 1)).toBe('Rostiger Pass');
    expect(deSectors.generated(10, 8)).toBe('Wildes Tal');
    expect(deSectors.generated(-1, 12)).toBe('Alte Schwelle');
  });

  it('hand-made names exist for every landmark kind and do not repeat', () => {
    const all = [deSectors.origin, deSectors.corner1, deSectors.corner2, ...LANDMARK_KINDS.flatMap((k) => deSectors.landmarks[k])];
    for (const k of LANDMARK_KINDS) expect(deSectors.landmarks[k].length, k).toBeGreaterThan(0);
    for (const name of all) expect(name.trim(), name).toBe(name);
    expect(new Set(all).size).toBe(all.length);
  });
});
