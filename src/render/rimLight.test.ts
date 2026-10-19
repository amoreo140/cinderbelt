import { Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, BoxGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { RIM_FAR, RIM_NEAR, RimLight, cloneWithRim, hasRim, rimStrength } from './rimLight';

describe('rim light', () => {
  it('is subtle up close and stronger zoomed out, flat outside the range', () => {
    expect(rimStrength(10)).toBeCloseTo(RIM_NEAR.strength);
    expect(rimStrength(RIM_NEAR.distance)).toBeCloseTo(RIM_NEAR.strength);
    expect(rimStrength(RIM_FAR.distance)).toBeCloseTo(RIM_FAR.strength);
    expect(rimStrength(400)).toBeCloseTo(RIM_FAR.strength);
    let last = 0;
    for (let d = 20; d <= 160; d += 10) {
      expect(rimStrength(d)).toBeGreaterThanOrEqual(last);
      last = rimStrength(d);
    }
    expect(RIM_FAR.strength).toBeGreaterThan(RIM_NEAR.strength);
  });

  it('patches standard materials of watched objects once, chaining their own shader patch', () => {
    const rim = new RimLight();
    const root = new Group();
    const standard = new MeshStandardMaterial();
    let ownPatch = 0;
    standard.onBeforeCompile = () => {
      ownPatch++;
    };
    standard.customProgramCacheKey = () => 'own-v1';
    const basic = new MeshBasicMaterial();
    const geometry = new BoxGeometry();
    root.add(new Mesh(geometry, standard), new Mesh(geometry, basic));
    rim.watch(root);
    rim.update(0.016, 140, new Color(0x7f9cff));
    expect(rim.has(standard)).toBe(true);
    expect(rim.has(basic)).toBe(false);
    expect(standard.customProgramCacheKey()).toBe('own-v1|rim1');

    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      fragmentShader: '#include <common>\nvoid main() {\n#include <lights_fragment_end>\n}',
      vertexShader: '',
    };
    standard.onBeforeCompile(shader as never, undefined as never);
    expect(ownPatch).toBe(1);
    expect(shader.fragmentShader).toContain('uRimStrength');
    expect(shader.uniforms.uRimStrength!.value).toBeCloseTo(RIM_FAR.strength);

    // a second scan does not wrap the material again
    rim.update(1, 140, new Color(0x7f9cff));
    expect(standard.customProgramCacheKey()).toBe('own-v1|rim1');
    // the hangar turns it off for all patched materials at once
    rim.off();
    expect(shader.uniforms.uRimStrength!.value).toBe(0);
  });

  it('patches objects the moment they are added under a watched root, before any frame', () => {
    const rim = new RimLight();
    const root = new Group();
    const inner = new Group();
    root.add(inner);
    rim.watch(root);
    const geometry = new BoxGeometry();
    // added deep inside the watched tree, no update() in between
    const late = new Mesh(geometry, new MeshStandardMaterial());
    const group = new Group();
    group.add(late);
    inner.add(group);
    expect(hasRim(late.material)).toBe(true);
    // and below that group later on
    const later = new Mesh(geometry, new MeshStandardMaterial());
    group.add(later);
    expect(hasRim(later.material)).toBe(true);
  });

  it('keeps the rim on clones and honours the opt-out flag', () => {
    const rim = new RimLight();
    const root = new Group();
    const source = new MeshStandardMaterial();
    const decal = new MeshStandardMaterial();
    decal.userData.noRim = true;
    const geometry = new BoxGeometry();
    root.add(new Mesh(geometry, source), new Mesh(geometry, decal));
    rim.watch(root);
    expect(hasRim(source)).toBe(true);
    expect(hasRim(decal)).toBe(false);
    const copy = cloneWithRim(source);
    expect(hasRim(copy)).toBe(true);
    expect(copy.customProgramCacheKey()).toBe(source.customProgramCacheKey());
    // a plain three.js clone loses the patch – the scan restores it (material swaps)
    const plain = source.clone();
    expect(hasRim(plain)).toBe(false);
    root.add(new Mesh(geometry, plain));
    expect(hasRim(plain)).toBe(true);
  });
});
