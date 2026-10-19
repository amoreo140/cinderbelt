import { Object3D, Texture, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Effects, MAX_PIECES } from './Effects';
import type { FxModels } from './fxModels';

// effect textures are not loaded in the test (TextureLoader needs the DOM)
vi.mock('./textures', () => ({ vfxTexture: () => new Texture() }));

const models = { debrisTemplate: () => new Object3D(), fragmentTemplate: () => new Object3D() } as unknown as FxModels;

describe('Effects (M30)', () => {
  it('caps the flying pieces – many cracks at once drop the oldest ones', () => {
    const fx = new Effects(models);
    for (let i = 0; i < 60; i++) fx.iceCrack(new Vector3(i, 0, 0), 2);
    const pieces = fx.object.children.filter((c) => !('isMesh' in c && c.isMesh));
    expect(pieces.length).toBe(MAX_PIECES);
    fx.update(10);
    expect(fx.object.children.filter((c) => !('isMesh' in c && c.isMesh))).toHaveLength(0);
    fx.dispose();
  });
});
