// Templates modal texts (M4a T6): a clear, translated text for every import error code.
import { describe, expect, it } from 'vitest';
import type { TemplateDecodeError } from '../sim/templates/types';
import { LOCALES, textsFor } from './index';

const CODES: Record<TemplateDecodeError, true> = {
  tooLong: true,
  prefix: true,
  checksum: true,
  format: true,
  version: true,
  name: true,
  unknownPart: true,
  noCockpit: true,
  manyCockpits: true,
  overlap: true,
  outOfBounds: true,
  invalidDesign: true,
  unknownShape: true,
  shapeNotAllowed: true,
};

describe('fleet.templates.errors', () => {
  it('every decode error has its own sentence in every language', () => {
    for (const l of LOCALES) {
      const errors = textsFor(l).fleet.templates.errors;
      expect(Object.keys(errors).sort(), l).toEqual(Object.keys(CODES).sort());
      const texts = Object.values(errors);
      for (const text of texts) expect(text.trim().length, `${l}: ${text}`).toBeGreaterThan(10);
      expect(new Set(texts).size, l).toBe(texts.length);
    }
  });

  it('English is a translation, not the Slovak text', () => {
    const sk = textsFor('sk').fleet.templates.errors;
    const en = textsFor('en').fleet.templates.errors;
    for (const code of Object.keys(CODES) as TemplateDecodeError[]) expect(en[code], code).not.toBe(sk[code]);
  });

  it('plural forms of the row facts', () => {
    const sk = textsFor('sk').fleet.templates;
    expect([1, 3, 5].map(sk.parts)).toEqual(['1 diel', '3 diely', '5 dielov']);
    expect(sk.locked(2)).toBe('2 zamknuté diely');
    const en = textsFor('en').fleet.templates;
    expect([1, 3].map(en.parts)).toEqual(['1 part', '3 parts']);
    expect(en.locked(1)).toBe('1 locked part');
  });
});
