import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Line, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Points, Scene, Sprite } from 'three';
import { AoPass } from './AoPass';

/** A deterministic scene of nested groups, meshes (lit, transparent, basic), points, lines, sprites, noAO and hidden parts. */
function buildScene(seed: number): Scene {
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const geo = new BoxGeometry();
  const lit = new MeshStandardMaterial();
  const glass = new MeshStandardMaterial({ transparent: true });
  const basic = new MeshBasicMaterial();
  const scene = new Scene();
  const grow = (parent: Object3D, depth: number): void => {
    const n = 1 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const r = rnd();
      let o: Object3D;
      if (r < 0.3 && depth < 4) o = new Group();
      else if (r < 0.6) o = new Mesh(geo, lit);
      else if (r < 0.7) o = new Mesh(geo, glass);
      else if (r < 0.78) o = new Mesh(geo, basic);
      else if (r < 0.84) o = new Points();
      else if (r < 0.9) o = new Line();
      else o = new Sprite();
      if (rnd() < 0.15) o.visible = false;
      if (rnd() < 0.15) o.userData.noAO = true;
      parent.add(o);
      if (depth < 4 && (o instanceof Group || (o instanceof Mesh && rnd() < 0.3))) grow(o, depth + 1);
    }
  };
  grow(scene, 0);
  return scene;
}

/** What the normal pre-pass draws: every object visible down from the scene, with its material. */
function drawn(scene: Scene): string[] {
  const out: string[] = [];
  const walk = (o: Object3D, path: string): void => {
    if (!o.visible) return;
    out.push(`${path}:${o instanceof Mesh ? (o.material as { type: string }).type : o.type}`);
    o.children.forEach((c, i) => walk(c, `${path}/${i}`));
  };
  walk(scene, '');
  return out;
}

/** The visibility flags and materials of every object (the scene as it must be after the pass). */
function state(scene: Scene): string[] {
  const out: string[] = [];
  scene.traverse((o) => out.push(`${o.id}:${o.visible}:${o instanceof Mesh ? (o.material as { uuid: string }).uuid : ''}`));
  return out;
}

/** The pre-pass filter as it was (scene.traverse over every object), the reference for the pruned walk. */
function referenceDrawn(scene: Scene): string[] {
  const hidden: Object3D[] = [];
  const swapped: [Mesh, Mesh['material']][] = [];
  const normal = new MeshBasicMaterial();
  normal.type = 'MeshNormalMaterial';
  scene.traverse((o) => {
    if (!o.visible) return;
    const mesh = o instanceof Mesh ? o : null;
    const m = mesh?.material as MeshStandardMaterial | undefined;
    const visibleOne = !!m && !m.transparent && m.depthWrite && !m.userData.noAO && 'isMeshStandardMaterial' in m;
    const hide = o.userData.noAO === true || !mesh || !visibleOne;
    if (hide && (mesh || o instanceof Points || o instanceof Line || o instanceof Sprite || o.userData.noAO === true)) {
      o.visible = false;
      hidden.push(o);
      return;
    }
    if (!mesh) return;
    swapped.push([mesh, mesh.material]);
    mesh.material = normal;
  });
  const out = drawn(scene);
  for (const o of hidden) o.visible = true;
  for (const [mesh, material] of swapped) mesh.material = material;
  return out;
}

describe('AoPass visibility override', () => {
  it('draws exactly what the full traversal drew, and restores the scene', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const scene = buildScene(seed);
      const pass = new AoPass(scene, new Object3D() as never, 4, 4);
      const before = state(scene);
      const expected = referenceDrawn(scene);
      expect(state(scene)).toEqual(before);
      pass._overrideVisibility();
      expect(drawn(scene)).toEqual(expected);
      pass._restoreVisibility();
      expect(state(scene)).toEqual(before);
      pass.dispose();
    }
  });

  it('follows a noAO switch on the next frame (ShadowRig far tier)', () => {
    const scene = new Scene();
    const group = new Group();
    const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    group.add(mesh);
    scene.add(group);
    const pass = new AoPass(scene, new Object3D() as never, 4, 4);
    pass._overrideVisibility();
    expect(drawn(scene)).toContain('/0/0:MeshNormalMaterial');
    pass._restoreVisibility();
    group.userData.noAO = true;
    pass._overrideVisibility();
    expect(drawn(scene)).toEqual([':Scene']);
    pass._restoreVisibility();
    expect(group.visible).toBe(true);
    group.userData.noAO = false;
    pass._overrideVisibility();
    expect(drawn(scene)).toContain('/0/0:MeshNormalMaterial');
    pass._restoreVisibility();
    pass.dispose();
  });
});
