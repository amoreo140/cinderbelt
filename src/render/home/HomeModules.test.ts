import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { prepareModule } from './HomeModules';

/** A paint-shop-like model: body mesh with lamps, an animated gantry and an empty (glTF layout). */
function paintShopLike(): { scene: Group; material: MeshStandardMaterial } {
  const material = new MeshStandardMaterial({ emissiveIntensity: 1 });
  const scene = new Group();
  const body = new Mesh(new BoxGeometry(5, 1, 4), material);
  body.name = 'HomeModule_PaintShop';
  body.position.set(0.1, 0, 0);
  scene.add(body);
  for (const [i, z] of [-2.2, 2.2].entries()) {
    const lamp = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), material);
    lamp.name = `beacon_${i}`;
    lamp.position.set(6, 0, z);
    body.add(lamp);
  }
  const bay = new Object3D();
  bay.name = 'paint_bay';
  bay.position.set(2.7, 0.6, 0);
  body.add(bay);
  const gantry = new Mesh(new BoxGeometry(0.4, 1.5, 4), material);
  gantry.name = 'Paint_Gantry';
  gantry.position.set(2.7, 0, 0);
  body.add(gantry);
  const rail = new Mesh(new BoxGeometry(0.2, 0.2, 4), material);
  rail.position.set(0, 1, 0);
  gantry.add(rail);
  return { scene, material };
}

const meshes = (root: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o);
  });
  return out;
};

describe('prepareModule', () => {
  it('rebuilds a module into body + lamps + one mesh per animated node (≤ 3 draw calls)', () => {
    const { scene, material } = paintShopLike();
    const vertices = meshes(scene).reduce((n, m) => n + m.geometry.getAttribute('position').count, 0);
    const p = prepareModule(scene);
    const after = meshes(scene);
    expect(after).toHaveLength(3);
    expect(after.reduce((n, m) => n + m.geometry.getAttribute('position').count, 0)).toBe(vertices);
    expect(p.beacons).not.toBeNull();
    // the lamps blink on their own material; the body keeps the model's
    expect(p.beacons!.material).not.toBe(material);
    expect(p.materials).toEqual([p.beacons!.material]);
    expect(p.geometries).toHaveLength(3);
    expect(after.filter((m) => m.material === material)).toHaveLength(2);
  });

  it('keeps the animated node (with its mesh) and the empties at their places', () => {
    const { scene } = paintShopLike();
    const p = prepareModule(scene);
    scene.updateMatrixWorld(true);
    const gantry = p.nodes.get('Paint_Gantry');
    expect(gantry).toBeDefined();
    expect(gantry!.getWorldPosition(new Vector3()).x).toBeCloseTo(2.8, 6);
    // moving the node moves its merged mesh (incl. the rail child)
    const mesh = gantry!.children.find((c) => c instanceof Mesh) as Mesh;
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.max.y).toBeCloseTo(1.1, 5);
    const bay = p.empties.get('paint_bay');
    expect(bay!.getWorldPosition(new Vector3()).x).toBeCloseTo(2.8, 6);
    // lamps merged in the module frame
    p.beacons!.geometry.computeBoundingBox();
    expect(p.beacons!.geometry.boundingBox!.max.z).toBeCloseTo(2.3, 5);
    expect(p.beacons!.geometry.boundingBox!.min.x).toBeCloseTo(6.0, 5);
  });

  it('collects the trophy empties of a hall', () => {
    const scene = new Group();
    const body = new Mesh(new BoxGeometry(5, 1, 5), new MeshStandardMaterial());
    body.name = 'HomeModule_TrophyHall';
    scene.add(body);
    for (let i = 0; i < 6; i++) {
      const t = new Object3D();
      t.name = `trophy_${i}`;
      t.position.set(i, 0.25, 0);
      body.add(t);
    }
    const p = prepareModule(scene);
    expect(meshes(scene)).toHaveLength(1);
    expect(p.beacons).toBeNull();
    for (let i = 0; i < 6; i++) expect(p.empties.get(`trophy_${i}`)?.position.x).toBe(i);
  });
});
