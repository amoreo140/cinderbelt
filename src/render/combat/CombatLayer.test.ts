import { Texture } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Wreck } from '../../sim/combat/types';
import { stillWreck } from './CombatLayer';

// effects load their textures through TextureLoader (no DOM in the unit tests)
vi.mock('../fx/textures', () => ({ vfxTexture: () => new Texture() }));

const body = () => ({ pos: { x: 40, y: -12 }, vel: { x: 0, y: 0 }, angle: 1.2, angVel: 0 });
const wreck = (over: Partial<Wreck> = {}): Wreck => {
  const b = body();
  return { id: -7, poi: 'gy:-20,22#3', body: b, prevBody: b, ttl: 1e9, ...over } as Wreck;
};

describe('stillWreck (which wrecks draw from the static batch)', () => {
  it('takes a graveyard wreck lying still', () => {
    expect(stillWreck(wreck(), null)).toBe(true);
    // a fresh copy of the same pose (save / load) is still too
    expect(stillWreck(wreck({ prevBody: body() }), null)).toBe(true);
  });

  it('leaves out other wrecks and graveyard wrecks that move, are cut, held or fading', () => {
    expect(stillWreck(wreck({ poi: 'wreck:-4,-6' }), null)).toBe(false);
    expect(stillWreck(wreck({ poi: undefined }), null)).toBe(false);
    expect(stillWreck(wreck({ body: { ...body(), vel: { x: 0.1, y: 0 } } }), null)).toBe(false);
    expect(stillWreck(wreck({ body: { ...body(), angVel: 0.01 } }), null)).toBe(false);
    expect(stillWreck(wreck({ prevBody: { ...body(), pos: { x: 39.9, y: -12 } } }), null)).toBe(false);
    expect(stillWreck(wreck({ cutting: { partId: 2, progress: 0.3 } }), null)).toBe(false);
    // towed, or a part being ripped off by the tractor beam
    expect(stillWreck(wreck(), -7)).toBe(false);
    expect(stillWreck(wreck(), -8)).toBe(true);
    expect(stillWreck(wreck({ ttl: 60 }), null)).toBe(false);
  });
});
