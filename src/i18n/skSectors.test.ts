// Sector names (§2.7): every adjective × noun pair agrees in gender in Slovak, has a valid shape in both
// languages and is unique; the hand-made names cover every landmark kind.
import { describe, expect, it } from 'vitest';
import { SECTOR_NAME_WORDS } from '../sim/regions/sectors';
import { LANDMARK_KINDS } from '../sim/world/landmarks';
import { EN_ADJECTIVES, EN_NOUNS, enSectors } from './enSectors';
import { SK_ADJECTIVES, SK_NOUNS, skSectors, type SkGender } from './skSectors';

/** Nominative singular endings of a Slovak adjective: hard (-y / -a / -e, long or short vowel) or soft (-i / -ia / -ie). */
const ENDINGS: Record<SkGender, RegExp> = { m: /(ý|y|í)$/, f: /(á|a|ia)$/, n: /(é|e|ie)$/ };

/** The stem of an adjective form (without its gender ending). */
const stem = (form: string, gender: SkGender): string => form.replace(ENDINGS[gender], '');

describe('sector names', () => {
  it('has 12 × 12 words in both languages, as the simulation expects', () => {
    expect(SK_ADJECTIVES).toHaveLength(SECTOR_NAME_WORDS.adjectives);
    expect(SK_NOUNS).toHaveLength(SECTOR_NAME_WORDS.nouns);
    expect(EN_ADJECTIVES).toHaveLength(SECTOR_NAME_WORDS.adjectives);
    expect(EN_NOUNS).toHaveLength(SECTOR_NAME_WORDS.nouns);
  });

  it('every Slovak adjective has a masculine, feminine and neuter form of one stem', () => {
    for (const a of SK_ADJECTIVES) {
      for (const g of ['m', 'f', 'n'] as const) expect(a[g], `${a.m} (${g})`).toMatch(ENDINGS[g]);
      const soft = a.m.endsWith('í');
      // soft adjectives keep -i- in every form (-i / -ia / -ie), hard ones do not
      expect(a.f.endsWith('ia'), a.m).toBe(soft);
      expect(a.n.endsWith('ie'), a.m).toBe(soft);
      expect(stem(a.f, 'f'), a.m).toBe(stem(a.m, 'm'));
      expect(stem(a.n, 'n'), a.m).toBe(stem(a.m, 'm'));
      expect(a.m[0], a.m).toBe(a.m[0]!.toUpperCase());
    }
  });

  it('nouns are lower case and every gender is used', () => {
    for (const n of SK_NOUNS) expect(n.word).toBe(n.word.toLowerCase());
    for (const g of ['m', 'f', 'n'] as const) expect(SK_NOUNS.filter((n) => n.gender === g).length).toBeGreaterThanOrEqual(3);
    // a cheap check of the declared gender: feminine nouns end in -a, neuter in -o / -e, masculine in a consonant
    for (const n of SK_NOUNS) {
      if (n.gender === 'f') expect(n.word, n.word).toMatch(/a$/);
      if (n.gender === 'n') expect(n.word, n.word).toMatch(/(o|e)$/);
      if (n.gender === 'm') expect(n.word, n.word).toMatch(/[^aeiouyáéíóúýäô]$/);
    }
  });

  it('every pair agrees in gender and the 144 names are unique in each language', () => {
    const sk = new Set<string>();
    const en = new Set<string>();
    for (let a = 0; a < SECTOR_NAME_WORDS.adjectives; a++) {
      for (let n = 0; n < SECTOR_NAME_WORDS.nouns; n++) {
        const name = skSectors.generated(a, n);
        const noun = SK_NOUNS[n]!;
        expect(name).toBe(`${SK_ADJECTIVES[a]![noun.gender]} ${noun.word}`);
        expect(name.split(' ')[0], name).toMatch(ENDINGS[noun.gender]);
        expect(name).toMatch(/^\p{Lu}\p{Ll}+ \p{Ll}+$/u);
        sk.add(name);
        const e = enSectors.generated(a, n);
        expect(e).toMatch(/^\p{Lu}\p{Ll}+ \p{Lu}\p{Ll}+$/u);
        en.add(e);
      }
    }
    expect(sk.size).toBe(144);
    expect(en.size).toBe(144);
  });

  it('example from the design: Slovak "Rusty Threshold" / English "Rust Threshold"', () => {
    expect(skSectors.generated(1, 0)).toBe('Hrdzavý prah');
    expect(enSectors.generated(1, 0)).toBe('Rust Threshold');
    expect(skSectors.generated(1, 4)).toBe('Hrdzavá zátoka');
    expect(skSectors.generated(10, 8)).toBe('Vlčie údolie');
  });

  it('hand-made names exist for every landmark kind and do not repeat', () => {
    for (const t of [skSectors, enSectors]) {
      const all = [t.origin, t.corner1, t.corner2, ...LANDMARK_KINDS.flatMap((k) => t.landmarks[k])];
      for (const k of LANDMARK_KINDS) expect(t.landmarks[k].length, k).toBeGreaterThan(0);
      expect(new Set(all).size).toBe(all.length);
    }
    for (const k of LANDMARK_KINDS) expect(enSectors.landmarks[k].length, k).toBe(skSectors.landmarks[k].length);
  });
});
