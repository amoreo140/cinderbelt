// Generated ship names (M4a): one per sim index, all different, the same count in every language,
// and each a translation (not the same word) of the Slovak one.
import { describe, expect, it } from 'vitest';
import { SHIP_NAME_COUNT } from '../data/fleet';
import { sanitizeName } from '../sim/fleet/names';
import { LOCALES, textsFor } from './index';

describe('fleet.names', () => {
  it('exactly SHIP_NAME_COUNT (≥ 40) names, all different, in every language', () => {
    expect(SHIP_NAME_COUNT).toBeGreaterThanOrEqual(40);
    for (const l of LOCALES) {
      const names = textsFor(l).fleet.names;
      expect(names.length, l).toBe(SHIP_NAME_COUNT);
      expect(new Set(names.map((n) => n.toLowerCase())).size, l).toBe(names.length);
    }
  });

  it('every name is already in the stored form of a custom name (sanitizeName)', () => {
    for (const l of LOCALES) for (const n of textsFor(l).fleet.names) expect(sanitizeName(n), `${l} ${n}`).toBe(n);
  });

  it('English names are translations, not the Slovak words', () => {
    const sk = textsFor('sk').fleet.names;
    const en = textsFor('en').fleet.names;
    for (let i = 0; i < SHIP_NAME_COUNT; i++) expect(en[i], sk[i]).not.toBe(sk[i]);
  });
});
