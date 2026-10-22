import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, Object3D, ShaderChunk, Texture, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { fadedMaterial, nozzleMean, vehicleBatch, vehicleMaterial, type BelowFade } from './vehicleBatch';

function model(): Group {
  const palette = new MeshStandardMaterial({ map: new Texture(), emissiveIntensity: 6 });
  const root = new Group();
  const hull = new Mesh(new BoxGeometry(2, 1, 1), palette);
  hull.name = 'Trader';
  for (let i = 0; i < 2; i++) {
    const lamp = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), palette);
    lamp.name = `beacon_${i}`;
    lamp.position.set(i, 0.6, 0);
    hull.add(lamp);
  }
  const thruster = new Object3D();
  thruster.name = 'thruster_0';
  hull.add(thruster);
  const drill = new Mesh(new BoxGeometry(0.3, 0.3, 0.3), palette);
  drill.name = 'Drill_0';
  hull.add(drill);
  root.add(hull);
  return root;
}

describe('vehicleBatch', () => {
  it('merges the hull and its lamps into one part, leaving live nodes out', () => {
    const template = model();
    const batch = vehicleBatch(template, (o) => o.name === 'Drill_0');
    expect(batch.parts).toHaveLength(1);
    const part = batch.parts[0]!;
    expect(part.lamps).toBe(true);
    expect(part.geometry.getAttribute('position').count).toBe(3 * 24);
    const lamp = part.geometry.getAttribute('beaconIndex');
    expect(new Set(Array.from(lamp.array))).toEqual(new Set([-1, 0, 1]));
    // hull + two lamps by traverse order (root 0, hull 1, lamps 2–3, thruster 4, drill 5)
    expect([...batch.merged].sort()).toEqual([1, 2, 3]);
    // cached per template
    expect(vehicleBatch(template, () => false)).toBe(batch);
  });

  it('gives every vehicle its own lamp material on one shared program', () => {
    const template = model();
    const { material } = vehicleBatch(template, () => false).parts[0]!;
    const clock = { value: 3 };
    const fade: BelowFade = { below: { value: 0 }, haze: { value: new Color() } };
    const a = vehicleMaterial(material, clock, 0, fade) as MeshStandardMaterial;
    const b = vehicleMaterial(material, clock, 5, fade) as MeshStandardMaterial;
    expect(a).not.toBe(b);
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: ShaderChunk.meshphysical_vert, fragmentShader: ShaderChunk.meshphysical_frag, defines: {} };
    b.onBeforeCompile(shader as never, null as never);
    expect(shader.uniforms.uLampClock).toBe(clock);
    expect(shader.uniforms.uLampSlot!.value).toBe(5);
    expect(shader.uniforms.uLampGain!.value).toBeCloseTo(1.6);
    expect(shader.vertexShader).toContain('attribute float beaconIndex');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance *= vLamp');
    // the lamp blink and the fade live in one program
    expect(shader.uniforms.uBelow).toBe(fade.below);
    expect(shader.fragmentShader).toContain('uBelow');
  });

  it('fades a part without lamps on one shared program, a vehicle at a time', () => {
    const template = model();
    const { material } = vehicleBatch(template, () => false).parts[0]!;
    const haze = { value: new Color(0.2, 0.3, 0.4) };
    const near: BelowFade = { below: { value: 0 }, haze };
    const far: BelowFade = { below: { value: 1 }, haze };
    const a = fadedMaterial(material, near) as MeshStandardMaterial;
    const b = fadedMaterial(material, far) as MeshStandardMaterial;
    expect(a).not.toBe(b);
    expect(a.transparent).toBe(false);
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    expect(a.customProgramCacheKey()).not.toBe((vehicleMaterial(material, { value: 0 }, 0, near) as MeshStandardMaterial).customProgramCacheKey());
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: ShaderChunk.meshphysical_vert, fragmentShader: ShaderChunk.meshphysical_frag, defines: {} };
    b.onBeforeCompile(shader as never, null as never);
    expect(shader.uniforms.uBelow).toBe(far.below);
    expect(shader.uniforms.uBelowHaze).toBe(haze);
    expect(shader.fragmentShader).toContain('belowGrey');
  });
});

describe('nozzleMean', () => {
  it('places the trail start where the nozzles are in the world, for any vehicle pose', () => {
    const root = new Group();
    const hull = new Object3D();
    hull.position.set(0.5, 0.2, -1);
    hull.rotation.set(0.1, 0.4, -0.2);
    hull.scale.setScalar(1.3);
    root.add(hull);
    const nozzles = [new Object3D(), new Object3D()];
    nozzles[0]!.position.set(-2, 0.3, 0.7);
    nozzles[1]!.position.set(-2, -0.3, -0.7);
    for (const n of nozzles) hull.add(n);
    const station = new Group();
    station.position.set(30, 0, -12);
    station.rotation.y = 1.1;
    station.add(root);
    const local = nozzleMean(root, nozzles, () => false)!;
    root.position.set(4, -2, 9);
    root.rotation.set(0, 2.3, 0);
    root.scale.setScalar(0.7);
    station.updateMatrixWorld(true);
    const expected = new Vector3();
    for (const n of nozzles) expected.add(n.getWorldPosition(new Vector3()));
    expected.divideScalar(nozzles.length);
    const got = local.clone().applyMatrix4(root.matrix).applyMatrix4(station.matrixWorld);
    expect(got.distanceTo(expected)).toBeLessThan(1e-9);
  });

  it('the origin without nozzles, null under a moving node', () => {
    const root = new Group();
    expect(nozzleMean(root, [], () => false)!.length()).toBe(0);
    const dish = new Object3D();
    dish.name = 'Survey_Dish';
    const nozzle = new Object3D();
    dish.add(nozzle);
    root.add(dish);
    expect(nozzleMean(root, [nozzle], (o) => o.name === 'Survey_Dish')).toBeNull();
  });
});
