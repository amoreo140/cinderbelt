// Random seed for sharing (M2): a word pair + a number, e.g. `tichy-prach-73` (Slovak UI) or
// `quiet-dust-73` (English UI). Without diacritics so it is easy to retype and send; the Slovak
// adjectives are masculine and agree with all the nouns. A seed is just a string: only the
// proposal follows the UI language, any seed typed or shared keeps producing the same universe.
import { getLocale, type Locale } from '../../i18n/locale';

export const SEED_ADJECTIVES = [
  'tichy',
  'hviezdny',
  'zlaty',
  'studeny',
  'temny',
  'modry',
  'zeleny',
  'vzdialeny',
  'ladovy',
  'zelezny',
  'medeny',
  'titanovy',
  'rychly',
  'stary',
  'jasny',
  'polarny',
  'hlboky',
  'tuhy',
  'iskrivy',
  'osamely',
  'karminovy',
  'strieborny',
  'divoky',
  'pokojny',
] as const;

export const SEED_NOUNS = [
  'prach',
  'meteor',
  'pulzar',
  'kvazar',
  'mesiac',
  'prstenec',
  'oblak',
  'vietor',
  'krystal',
  'majak',
  'kotol',
  'pristav',
  'kovac',
  'motor',
  'zenit',
  'horizont',
  'uhol',
  'plat',
  'trup',
  'lem',
  'tien',
  'orbit',
  'sever',
  'kompas',
] as const;

export const SEED_ADJECTIVES_EN = [
  'quiet',
  'starry',
  'golden',
  'cold',
  'dark',
  'blue',
  'green',
  'distant',
  'frozen',
  'iron',
  'copper',
  'titan',
  'swift',
  'old',
  'bright',
  'polar',
  'deep',
  'faint',
  'glowing',
  'lone',
  'crimson',
  'silver',
  'wild',
  'calm',
] as const;

export const SEED_NOUNS_EN = [
  'dust',
  'meteor',
  'pulsar',
  'quasar',
  'moon',
  'ring',
  'cloud',
  'wind',
  'crystal',
  'beacon',
  'kettle',
  'harbor',
  'smith',
  'engine',
  'zenith',
  'horizon',
  'vector',
  'anchor',
  'hull',
  'edge',
  'shadow',
  'orbit',
  'north',
  'compass',
] as const;

/** A uniformly random number 0 ≤ x < 1. */
export type RandomSource = () => number;

const pick = <T>(list: readonly T[], rand: RandomSource): T => list[Math.min(list.length - 1, Math.floor(rand() * list.length))]!;

/** A random seed text with words in the given language (default: the active UI language). */
export function randomSeedText(rand: RandomSource = Math.random, locale: Locale = getLocale()): string {
  const english = locale === 'en';
  const adjective = pick(english ? SEED_ADJECTIVES_EN : SEED_ADJECTIVES, rand);
  const noun = pick(english ? SEED_NOUNS_EN : SEED_NOUNS, rand);
  const number = 10 + Math.min(89, Math.floor(rand() * 90));
  return `${adjective}-${noun}-${number}`;
}

/** A small deterministic generator for tests and samples (mulberry32). */
export function mulberry32Like(seed: number): RandomSource {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
