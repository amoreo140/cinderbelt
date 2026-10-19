import { BoxGeometry, BufferAttribute, BufferGeometry, Group, InterleavedBuffer, InterleavedBufferAttribute, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Raycaster, Texture, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createGrid } from '../sim/ship/grid';
import { computeProperties } from '../sim/ship/properties';
import { createStarterShip } from '../sim/ship/presets';
import type { ModelLibrary } from './assets/ModelLibrary';
import { HullDecals, placementCacheSize, type DecalPart } from './decals/HullDecals';
import { batchKey, materialKey, mergeSources } from './shipBatch';
import { ShipView } from './ShipView';

// decals load their atlas through TextureLoader (no DOM in the unit tests)
vi.mock('./fx/textures', () => ({ vfxTexture: () => new Texture() }));

const atlas = new Texture();
const palette = () => new MeshStandardMaterial({ map: atlas, emissiveMap: atlas, roughness: 0.6 });

describe('materialKey', () => {
  it('matches equal palette materials of different files, not different ones', () => {
    expect(materialKey(palette())).toBe(materialKey(palette()));
    const red = palette();
    red.color.setRGB(1, 0, 0);
    expect(materialKey(red)).not.toBe(materialKey(palette()));
    const other = palette();
    other.map = new Texture();
    expect(materialKey(other)).not.toBe(materialKey(palette()));
  });

  it('leaves transparent materials out and keys other types by identity', () => {
    expect(materialKey(new MeshStandardMaterial({ transparent: true }))).toBeNull();
    const basic = new MeshBasicMaterial();
    expect(materialKey(basic)).toBe(`id:${basic.uuid}`);
    const patched = palette();
    patched.onBeforeCompile = () => {};
    expect(materialKey(patched)).toBe(`id:${patched.uuid}`);
    // the rim light patch (shared uniforms) still batches
    patched.userData.cinderRim = true;
    expect(materialKey(patched)).not.toBe(`id:${patched.uuid}`);
  });

  it('batchKey separates attribute layouts and draw order', () => {
    const a = new Mesh(new BoxGeometry(), palette());
    const b = new Mesh(new BoxGeometry(), palette());
    expect(batchKey(a)).toBe(batchKey(b));
    b.renderOrder = 2;
    expect(batchKey(a)).not.toBe(batchKey(b));
    const noUv = new BoxGeometry();
    noUv.deleteAttribute('uv');
    expect(batchKey(new Mesh(noUv, palette()))).not.toBe(batchKey(a));
  });
});

describe('mergeSources', () => {
  it('transforms positions and normals, offsets indices and keeps 16-bit UVs', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
    g.setAttribute('uv', new BufferAttribute(new Uint16Array([0, 0, 65535, 0, 0, 65535]), 2, true));
    g.setIndex([0, 1, 2]);
    const moved = new Matrix4().makeTranslation(5, 0, 0);
    const turned = new Matrix4().makeRotationX(Math.PI / 2);
    const out = mergeSources([{ geometry: g, matrix: moved }, { geometry: g, matrix: turned }]);
    expect(out.getAttribute('position').count).toBe(6);
    expect(new Vector3().fromBufferAttribute(out.getAttribute('position'), 1).toArray()).toEqual([6, 0, 0]);
    const n = new Vector3().fromBufferAttribute(out.getAttribute('normal'), 3);
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBeCloseTo(0);
    expect(n.z).toBeCloseTo(1);
    expect(out.getAttribute('uv').array).toBeInstanceOf(Uint16Array);
    expect(out.getAttribute('uv').normalized).toBe(true);
    expect([...out.index!.array]).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('decodes interleaved normalised normals (meshopt layout)', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3));
    // int8 normals padded to 4 bytes per vertex
    const packed = new InterleavedBuffer(new Int8Array([0, 127, 0, 0, 0, -128, 0, 0, 127, 0, 0, 0]), 4);
    g.setAttribute('normal', new InterleavedBufferAttribute(packed, 3, 0, true));
    const out = mergeSources([{ geometry: g, matrix: new Matrix4() }]);
    const n = out.getAttribute('normal');
    expect([n.getX(0), n.getY(0), n.getZ(0)]).toEqual([0, 1, 0]);
    expect([n.getX(1), n.getY(1), n.getZ(1)]).toEqual([0, -1, 0]);
    expect([n.getX(2), n.getY(2), n.getZ(2)]).toEqual([1, 0, 0]);
    expect(out.boundingSphere!.radius).toBeCloseTo(Math.sqrt(0.5));
  });

  it('flips the winding of a mirrored source', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3));
    const out = mergeSources([{ geometry: g, matrix: new Matrix4().makeScale(-1, 1, 1) }]);
    expect([...out.index!.array]).toEqual([0, 2, 1]);
  });
});

/** A part model like the GLBs: a static body with a turret (moving) carrying a muzzle node. */
function fakeLibrary(): ModelLibrary {
  const template = new Group();
  const body = new Mesh(new BoxGeometry(0.9, 0.5, 0.9), palette());
  body.name = 'Body';
  const turret = new Mesh(new BoxGeometry(0.3, 0.3, 0.3), palette());
  turret.name = 'Cannon_Turret';
  turret.position.y = 0.4;
  const muzzle = new Object3D();
  muzzle.name = 'Cannon_Muzzle';
  turret.add(muzzle);
  body.add(turret);
  template.add(body);
  const none = () => null;
  return { part: () => template, connector: none, clans: { part: none, connector: none } } as unknown as ModelLibrary;
}

const meshes = (root: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh && o.visible) out.push(o);
  });
  return out;
};

describe('ShipView batching', () => {
  it('merges the static bodies into one mesh and keeps the moving turrets live', () => {
    const grid = createGrid([
      ['cockpit', 1, 0],
      ['cannon', 0, 0],
      ['cannon', 0, 1],
      ['armor', -1, 0],
    ]);
    const view = new ShipView(grid, computeProperties(grid), fakeLibrary());
    expect(meshes(view.group).filter((m) => m.name === 'Body')).toHaveLength(4);
    view.update(1 / 60, { x: 0, y: 0 }, computeProperties(grid), { x: 5, y: 3 });
    const after = meshes(view.group);
    expect(view.batchCount).toBe(1);
    expect(after.filter((m) => m.name === 'Body')).toHaveLength(0);
    expect(after.filter((m) => m.name === 'ship-batch')).toHaveLength(1);
    expect(after.filter((m) => m.name === 'Cannon_Turret')).toHaveLength(4);
    // the cannon muzzles still follow their turrets
    expect(view.cannonMuzzles()).toHaveLength(2);
    expect(view.cannonMuzzleWorld(grid.parts[1]!.id, new Vector3())).not.toBeNull();
    // four bodies in one batch: 4 × 24 box vertices
    expect(after.find((m) => m.name === 'ship-batch')!.geometry.getAttribute('position').count).toBe(96);
    view.dispose();
  });

  it('freezes static matrices but not the moving nodes', () => {
    const grid = createGrid([['cannon', 0, 0], ['armor', 1, 0]]);
    const view = new ShipView(grid, computeProperties(grid), fakeLibrary());
    view.update(1 / 60, { x: 0, y: 0 }, computeProperties(grid), { x: 5, y: 3 });
    const frozen: string[] = [];
    const live: string[] = [];
    view.group.children[0]!.traverse((o) => (o.matrixAutoUpdate ? live : frozen).push(o.name));
    expect(live).toContain('Cannon_Turret');
    expect(frozen).toContain('ship-batch');
    view.dispose();
  });

  it('places the decals of a second view of the same build from the cache, without rays', () => {
    const grid = createGrid([['cannon', 0, 0], ['armor', 1, 0], ['armor', 2, 0]]);
    const props = computeProperties(grid);
    const pose = (view: ShipView) => {
      const decals = view.group.getObjectByName('hull-decals') as Mesh & { count: number; getMatrixAt(i: number, m: Matrix4): void };
      return Array.from({ length: decals.count }, (_, i) => {
        const m = new Matrix4();
        decals.getMatrixAt(i, m);
        return m.elements;
      });
    };
    const first = new ShipView(grid, props, fakeLibrary());
    first.setDamage('wreck', 0, 11);
    expect(first.decalCount).toBeGreaterThan(0);
    const cached = placementCacheSize();
    const rays = vi.spyOn(Raycaster.prototype, 'intersectObject');
    const second = new ShipView(grid, props, fakeLibrary());
    second.setDamage('wreck', 0, 11);
    expect(rays).not.toHaveBeenCalled();
    expect(pose(second)).toEqual(pose(first));
    expect(placementCacheSize()).toBe(cached);
    // another build (a part less) is another signature: its decals are placed by rays
    const cut = createGrid([['cannon', 0, 0], ['armor', 1, 0]]);
    const third = new ShipView(cut, computeProperties(cut), fakeLibrary());
    third.setDamage('wreck', 0, 11);
    expect(rays).toHaveBeenCalled();
    rays.mockRestore();
    for (const v of [first, second, third]) v.dispose();
  });

  it('places the same damage decals on a batched hull as on the per-part nodes', () => {
    const grid = createStarterShip();
    const props = computeProperties(grid);
    const pose = (view: ShipView) => {
      const decals = view.group.getObjectByName('hull-decals') as Mesh & { count: number; getMatrixAt(i: number, m: Matrix4): void };
      return Array.from({ length: decals.count }, (_, i) => {
        const m = new Matrix4();
        decals.getMatrixAt(i, m);
        return m.elements.map((x) => Math.round(x * 1e4) / 1e4);
      });
    };
    // placeholder library (no models): boxes per part
    const empty = { part: () => null, connector: () => null, clans: { part: () => null, connector: () => null } } as unknown as ModelLibrary;
    const batched = new ShipView(grid, props, empty);
    batched.setDamage('wreck', 0, 7);
    expect(batched.batchCount).toBeGreaterThan(0);
    expect(batched.decalCount).toBeGreaterThan(0);
    // reference: the decals of the unbaked hull (rays against the part nodes in the scene graph)
    const plain = new ShipView(grid, props, empty);
    const internals = plain as unknown as { hull: Group; decalParts: DecalPart[] };
    const ref = new HullDecals(internals.hull, internals.decalParts);
    ref.update('wreck', 0, 7);
    expect(ref.count).toBe(batched.decalCount);
    expect(pose(batched)).toEqual(pose(plain));
    batched.dispose();
    plain.dispose();
  });
});
