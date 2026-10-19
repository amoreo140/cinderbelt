import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../i18n';
import { roman, sectorName } from './sectorText';

describe('sector name text', () => {
  afterEach(() => setLocale('sk'));

  it('roman numerals', () => {
    expect([1, 2, 3, 4, 9, 14, 40].map(roman)).toEqual(['I', 'II', 'III', 'IV', 'IX', 'XIV', 'XL']);
  });

  it('formats every name kind in both languages', () => {
    setLocale('sk');
    expect(sectorName({ kind: 'origin' })).toBe('Počiatok');
    expect(sectorName({ kind: 'corner', corner: 1 })).toBe('Šakalí kút');
    expect(sectorName({ kind: 'fortress', fortress: 'fort:1' })).toBe('Hrdzavé hniezdo II');
    expect(sectorName({ kind: 'landmark', landmark: 'crystal_spire:2', landmarkKind: 'crystal_spire' })).toBe('Sklený hrebeň');
    // more landmarks than names: repeats with a numeral
    expect(sectorName({ kind: 'landmark', landmark: 'gas_giant:1', landmarkKind: 'gas_giant' })).toBe('Pri plynnom obrovi II');
    expect(sectorName({ kind: 'generated', adjective: 1, noun: 0, numeral: 0 })).toBe('Hrdzavý prah');
    expect(sectorName({ kind: 'generated', adjective: 1, noun: 4, numeral: 1 })).toBe('Hrdzavá zátoka II');
    setLocale('en');
    expect(sectorName({ kind: 'origin' })).toBe('Origin');
    expect(sectorName({ kind: 'fortress', fortress: 'fort:0' })).toBe('Rust Nest I');
    expect(sectorName({ kind: 'generated', adjective: 1, noun: 4, numeral: 0 })).toBe('Rust Cove');
  });
});
