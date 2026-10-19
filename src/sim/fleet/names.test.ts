// Ship names (M4a): sanitising custom names and the generated-name index.
import { describe, expect, it } from 'vitest';
import { SHIP_NAME_COUNT, SHIP_NAME_MAX } from '../../data/fleet';
import { generatedNameIndex, isSanitizedName, sanitizeName, shipDisplayName } from './names';

describe('sanitizeName', () => {
  it('trims and keeps an ordinary name', () => {
    expect(sanitizeName('  Stíhač  ')).toBe('Stíhač');
    expect(sanitizeName('Lyra 2')).toBe('Lyra 2');
  });

  it('collapses runs of white space and removes control and invisible format characters', () => {
    expect(sanitizeName('Ťažná\t\n  loď')).toBe('Ťažná loď');
    expect(sanitizeName('Sok\u0000ol\u0007')).toBe('Sokol');
    expect(sanitizeName('Zero​width‮')).toBe('Zerowidth');
  });

  it('normalises to NFC (a decomposed accent counts as one character)', () => {
    expect(sanitizeName('Pútnik')).toBe('Pútnik');
  });

  it('rejects empty, too long and non-string names', () => {
    expect(sanitizeName('')).toBeNull();
    expect(sanitizeName('   \t ')).toBeNull();
    expect(sanitizeName('\u0000\u0001')).toBeNull();
    expect(sanitizeName('x'.repeat(SHIP_NAME_MAX))).toBe('x'.repeat(SHIP_NAME_MAX));
    expect(sanitizeName('x'.repeat(SHIP_NAME_MAX + 1))).toBeNull();
    expect(sanitizeName('x'.repeat(1000))).toBeNull();
    expect(sanitizeName(null)).toBeNull();
    expect(sanitizeName(42)).toBeNull();
    expect(sanitizeName({ name: 'x' })).toBeNull();
  });

  it('counts characters, not UTF-16 units (an emoji is one character)', () => {
    const name = '\u{1F680}'.repeat(SHIP_NAME_MAX);
    expect(sanitizeName(name)).toBe(name);
    expect(sanitizeName(name + '\u{1F680}')).toBeNull();
  });

  it('isSanitizedName accepts only the stored form', () => {
    expect(isSanitizedName('Sokol')).toBe(true);
    expect(isSanitizedName(' Sokol')).toBe(false);
    expect(isSanitizedName('')).toBe(false);
    expect(isSanitizedName(null)).toBe(false);
  });
});

describe('generated names', () => {
  it('the index is deterministic and in range', () => {
    for (const seed of [1, 77, 1337, 2 ** 31 - 1])
      for (let id = 1; id < 50; id++) {
        const idx = generatedNameIndex(seed, id);
        expect(idx).toBe(generatedNameIndex(seed, id));
        expect(Number.isInteger(idx) && idx >= 0 && idx < SHIP_NAME_COUNT).toBe(true);
      }
  });

  it('different seeds spread over the list', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 200; seed++) seen.add(generatedNameIndex(seed, 1));
    expect(seen.size).toBeGreaterThan(SHIP_NAME_COUNT * 0.75);
  });

  it('with taken indices it picks the next free one (deterministically)', () => {
    const first = generatedNameIndex(5, 3);
    expect(generatedNameIndex(5, 3, new Set([first]))).toBe((first + 1) % SHIP_NAME_COUNT);
    expect(generatedNameIndex(5, 3, new Set())).toBe(first);
    // everything taken: the hashed index
    const all = new Set(Array.from({ length: SHIP_NAME_COUNT }, (_, i) => i));
    expect(generatedNameIndex(5, 3, all)).toBe(first);
  });

  it('display name: the custom one, otherwise the generated one from the given list', () => {
    const names = ['Iskra', 'Kométa'];
    expect(shipDisplayName({ name: 'Moja', nameIdx: 1 }, names)).toBe('Moja');
    expect(shipDisplayName({ name: null, nameIdx: 1 }, names)).toBe('Kométa');
  });
});
