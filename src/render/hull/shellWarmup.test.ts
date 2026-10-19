// SL2 E1 T11: the hull shell's warm-up samples – a baked flight view with a clipped armour corner and
// torn edges (one more per loaded clan set), released with the zoo.
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Texture } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CAPTAIN_CLANS } from '../../data/captains';
import { partDef, type PartId } from '../../data/parts';
import type { ModelLibrary } from '../assets/ModelLibrary';
import { ShaderZoo } from '../warmup';
import { shellWarmUpSamples } from './shellWarmup';

// flames and decals load their textures through TextureLoader (no DOM in the unit tests)
vi.mock('../fx/textures', () => ({ vfxTexture: () => new Texture() }));

function fakeLibrary(o: { swatches: boolean; clans: boolean }): ModelLibrary {
  const parts = new Map<PartId, Object3D>();
  const part = (id: PartId): Object3D => {
    let t = parts.get(id);
    if (!t) {
      const size = partDef(id, 1).size;
      const m = new MeshStandardMaterial();
      m.name = 'AF_Palette';
      t = new Group().add(new Mesh(new BoxGeometry(size.w * 0.94, 0.4, size.h * 0.94), m));
      parts.set(id, t);
    }
    return t;
  };
  const connector = new Group().add(new Mesh(new BoxGeometry(0.12, 0.3, 0.12), new MeshStandardMaterial()));
  return {
    part,
    connector: () => connector,
    clans: { part: () => null, connector: () => null, ready: () => o.clans },
    swatchUv: (key: string) => [0.25 + (key.length % 7) / 20, 0.5] as const,
    hasSwatches: o.swatches,
  } as unknown as ModelLibrary;
}

describe('hull shell warm-up samples', () => {
  it('adds a baked shelled ship with a clipped armour corner and torn edges, released with the zoo', () => {
    const zoo = new ShaderZoo();
    const views = shellWarmUpSamples(zoo, fakeLibrary({ swatches: true, clans: false }));
    expect(views).toHaveLength(1);
    const [view] = views;
    expect(view!.shellInfo.on).toBe(true);
    expect(view!.shellInfo.bevelled).toBeGreaterThan(0);
    expect(view!.shellInfo.tornEdges).toBeGreaterThan(0);
    expect(view!.batchCount).toBeGreaterThan(0);
    expect(view!.group.parent).toBe(zoo.gameplay);
    const dispose = vi.spyOn(view!, 'dispose');
    zoo.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('adds one per loaded clan set (no bevels on clan hulls) and nothing without the swatch table', () => {
    const zoo = new ShaderZoo();
    const views = shellWarmUpSamples(zoo, fakeLibrary({ swatches: true, clans: true }));
    expect(views).toHaveLength(1 + CAPTAIN_CLANS.length);
    for (const v of views.slice(1)) {
      expect(v.shellInfo.on).toBe(true);
      expect(v.shellInfo.bevelled).toBe(0);
    }
    zoo.dispose();
    expect(shellWarmUpSamples(new ShaderZoo(), fakeLibrary({ swatches: false, clans: true }))).toEqual([]);
  });
});
