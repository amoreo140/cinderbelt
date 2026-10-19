import { describe, expect, it } from 'vitest';
import { fogSignature } from './MapView';

describe('fogSignature (map fog cache)', () => {
  const view = { center: { x: 10, y: -20 }, half: 800 };

  it('stays the same while nothing the fog shows changes', () => {
    expect(fogSignature(['0,0', '1,0'], view)).toBe(fogSignature(['0,0', '1,0'], { center: { x: 10, y: -20 }, half: 800 }));
  });

  it('changes with a new explored chunk, a pan, a zoom or another game', () => {
    const base = fogSignature(['0,0', '1,0'], view);
    expect(fogSignature(['0,0', '1,0', '2,0'], view)).not.toBe(base);
    expect(fogSignature(['0,0', '1,0'], { ...view, center: { x: 11, y: -20 } })).not.toBe(base);
    expect(fogSignature(['0,0', '1,0'], { ...view, half: 400 })).not.toBe(base);
    expect(fogSignature(['5,5', '1,0'], view)).not.toBe(base);
    expect(fogSignature(['0,0', '4,4'], view)).not.toBe(base);
  });
});
