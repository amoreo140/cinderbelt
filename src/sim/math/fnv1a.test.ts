import { describe, expect, it } from 'vitest';
import { fnv1a32, fnv1aHex } from './fnv1a';

describe('fnv1a', () => {
  it('matches the reference FNV-1a 32-bit values', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('formats as 8 lowercase hex digits', () => {
    expect(fnv1aHex('')).toBe('811c9dc5');
    expect(fnv1aHex('a')).toBe('e40c292c');
    expect(fnv1aHex('x')).toMatch(/^[0-9a-f]{8}$/);
  });
});
