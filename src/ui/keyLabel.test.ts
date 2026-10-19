import { describe, expect, it } from 'vitest';
import { splitKeyLabel, splitKeyList, splitShortKeyLabel } from './keyLabel';

describe('key labels', () => {
  it('splits a key prefix from its description', () => {
    expect(splitKeyLabel('F – pristáť na stanici Kotva')).toEqual({ keys: ['F'], text: 'pristáť na stanici Kotva' });
    expect(splitKeyLabel('W / S – ťah dopredu / dozadu')).toEqual({ keys: ['W', 'S'], text: 'ťah dopredu / dozadu' });
    expect(splitKeyLabel('Spomaľ na 8 j/s')).toBeNull();
  });

  it('accepts only short key tokens in the strict variant', () => {
    expect(splitShortKeyLabel('M – zavrieť')).toEqual({ keys: ['M'], text: 'zavrieť' });
    expect(splitShortKeyLabel('Myš + pravé tlačidlo – ťažobný laser')).toBeNull();
    expect(splitShortKeyLabel('Bez paliva – H: odtiahnutie')).toBeNull();
  });

  it('splits a footer key list', () => {
    expect(splitKeyList('1–5 záložky · F odlet · Esc späť na prehľad')).toEqual([
      { keys: ['1–5'], text: 'záložky' },
      { keys: ['F'], text: 'odlet' },
      { keys: ['Esc'], text: 'späť na prehľad' },
    ]);
  });
});
