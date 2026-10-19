import { describe, expect, it } from 'vitest';
import { BoxGeometry, DirectionalLight, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from 'three';
import { FAR_TIER_IN, FAR_TIER_OUT, farTier, setFarLite, ShadowRig } from './ShadowRig';

const LIGHT = new Vector3(0.3, 0.8, 0.2).normalize();

function rig(): ShadowRig {
  const renderer = { shadowMap: { enabled: false, type: 0 } } as unknown as WebGLRenderer;
  const r = new ShadowRig(renderer, new DirectionalLight());
  r.setQuality(2048, 2);
  return r;
}

/** A camera `distance` from the origin at the game pitch, looking at it. */
function cameraAt(distance: number): PerspectiveCamera {
  const c = new PerspectiveCamera(40, 16 / 9, 0.5, 2000);
  c.position.set(0, Math.sin(1) * distance, Math.cos(1) * distance);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
}

const box = (): Mesh => new Mesh(new BoxGeometry(), new MeshStandardMaterial());

function scene(): { root: Scene; lite: Group; liteMesh: Mesh; plain: Mesh; aoOff: Group } {
  const root = new Scene();
  const lite = new Group();
  lite.userData.farLite = true;
  const liteMesh = box();
  lite.add(liteMesh);
  // a far-lite root that is never in the AO pass (scatter)
  const aoOff = new Group();
  aoOff.userData.farLite = true;
  aoOff.userData.noAO = true;
  aoOff.add(box());
  const plain = box();
  root.add(lite, aoOff, plain);
  return { root, lite, liteMesh, plain, aoOff };
}

describe('far tier', () => {
  it('switches past FAR_TIER_IN and back below FAR_TIER_OUT (hysteresis)', () => {
    expect(farTier(false, FAR_TIER_IN)).toBe(false);
    expect(farTier(false, FAR_TIER_IN + 0.1)).toBe(true);
    expect(farTier(true, 100)).toBe(true);
    expect(farTier(true, FAR_TIER_OUT)).toBe(true);
    expect(farTier(true, FAR_TIER_OUT - 0.1)).toBe(false);
    expect(farTier(false, 100)).toBe(false);
  });

  it('far out, far-lite subtrees stop casting and leave the AO pass but still receive', () => {
    const r = rig();
    const s = scene();
    r.update(cameraAt(48), LIGHT, s.root);
    expect(r.far).toBe(false);
    expect(s.liteMesh.castShadow).toBe(true);
    expect(s.liteMesh.receiveShadow).toBe(true);
    expect(s.lite.userData.noAO).toBe(false);

    r.update(cameraAt(140), LIGHT, s.root);
    expect(r.far).toBe(true);
    expect(s.liteMesh.castShadow).toBe(false);
    expect(s.liteMesh.receiveShadow).toBe(true);
    expect(s.lite.userData.noAO).toBe(true);
    expect(s.plain.castShadow).toBe(true);

    // between the bands nothing changes; below FAR_TIER_OUT all is back on the same frame
    r.update(cameraAt(100), LIGHT, s.root);
    expect(s.liteMesh.castShadow).toBe(false);
    r.update(cameraAt(90), LIGHT, s.root);
    expect(r.far).toBe(false);
    expect(s.liteMesh.castShadow).toBe(true);
    expect(s.lite.userData.noAO).toBe(false);
    // a root that was never in the AO pass stays out
    expect(s.aoOff.userData.noAO).toBe(true);
  });

  it("farLite 'ao' only leaves the AO pass far out, the shadow stays", () => {
    const r = rig();
    const s = scene();
    s.lite.userData.farLite = 'ao';
    r.update(cameraAt(140), LIGHT, s.root);
    expect(s.liteMesh.castShadow).toBe(true);
    expect(s.lite.userData.noAO).toBe(true);
    r.update(cameraAt(48), LIGHT, s.root);
    expect(s.lite.userData.noAO).toBe(false);
  });

  it('a mesh added to a far-lite subtree in the far tier is tagged far-lite; setFarLite flips a root', () => {
    const r = rig();
    const s = scene();
    r.update(cameraAt(140), LIGHT, s.root);
    const late = box();
    s.lite.add(late);
    for (let i = 0; i < 8; i++) r.update(cameraAt(140), LIGHT, s.root);
    expect(late.castShadow).toBe(false);
    expect(late.receiveShadow).toBe(true);

    setFarLite(s.lite, false);
    expect(s.lite.userData.noAO).toBe(false);
    for (let i = 0; i < 8; i++) r.update(cameraAt(140), LIGHT, s.root);
    expect(late.castShadow).toBe(true);
    expect(s.liteMesh.castShadow).toBe(true);
    expect(s.lite.userData.noAO).toBe(false);

    setFarLite(s.lite, true);
    for (let i = 0; i < 8; i++) r.update(cameraAt(140), LIGHT, s.root);
    expect(s.liteMesh.castShadow).toBe(false);
    expect(s.lite.userData.noAO).toBe(true);
  });
});
