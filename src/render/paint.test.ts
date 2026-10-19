// M4c T6: ship paints – a texture swap on cloned palette materials, reversible, cached per paint,
// never on clan parts or pirate / derelict liveries, batch-neutral and kept over shell rebuilds.
import { BoxGeometry, Group, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial, Texture, type Material, type Object3D } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { partDef, type PartId } from '../data/parts';
import { createStarterShip } from '../sim/ship/presets';
import { computeProperties } from '../sim/ship/properties';
import type { ShipGrid } from '../sim/ship/types';
import type { ModelLibrary } from './assets/ModelLibrary';
import { applyLivery } from './combat/livery';
import { setHullShellEnabled } from './hull/setting';
import { applyPaint, paintedMaterial, paintOfMaterial } from './paint';
import { ShipView } from './ShipView';

// the livery atlases and the decal textures load through TextureLoader (no DOM in the unit tests)
vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  class TextureLoader {
    load(url: string): Texture {
      const t = new three.Texture();
      t.name = url;
      return t;
    }
  }
  return { ...three, TextureLoader };
});
vi.mock('./fx/textures', () => ({ vfxTexture: () => new Texture() }));

const atlas = new Texture();
const palette = (): MeshStandardMaterial => {
  const m = new MeshStandardMaterial({ map: atlas, roughnessMap: atlas, metalnessMap: atlas, emissiveMap: atlas });
  m.name = 'AF_Palette';
  return m;
};

const box = (material: Material): Group => {
  const g = new Group();
  g.add(new Mesh(new BoxGeometry(1, 1, 1), material));
  return g;
};
const materialOf = (root: Object3D): Material => (root.children[0] as Mesh).material as Material;

describe('applyPaint', () => {
  it('swaps all three palette maps for the paint livery on a clone; the template stays untouched', () => {
    const mat = palette();
    const node = box(mat);
    applyPaint(node, 'navy');
    const worn = materialOf(node) as MeshStandardMaterial;
    expect(worn).not.toBe(mat);
    expect(mat.map).toBe(atlas);
    expect(worn.map?.name).toContain('palette_paint_navy_basecolor.png');
    expect(worn.roughnessMap?.name).toContain('palette_paint_navy_orm.png');
    expect(worn.metalnessMap).toBe(worn.roughnessMap);
    expect(worn.emissiveMap?.name).toContain('palette_paint_navy_emissive.png');
    expect(worn.map?.flipY).toBe(false);
    expect(paintOfMaterial(worn)).toBe('navy');
  });

  it('is cached per paint and source, repaints and returns to the factory material', () => {
    const mat = palette();
    const a = box(mat);
    const b = box(mat);
    applyPaint(a, 'sand');
    applyPaint(b, 'sand');
    expect(materialOf(a)).toBe(materialOf(b));
    applyPaint(a, 'racing');
    expect(materialOf(a)).toBe(paintedMaterial(mat, 'racing'));
    applyPaint(a, 'sand');
    expect(materialOf(a)).toBe(materialOf(b));
    applyPaint(a, 'factory');
    expect(materialOf(a)).toBe(mat);
    expect(paintOfMaterial(mat)).toBe('factory');
  });

  it('never paints clan parts, pirate or derelict liveries, or non-palette materials', () => {
    const clan = palette();
    clan.userData.afClan = 'rust';
    const glass = new MeshStandardMaterial({ map: atlas });
    glass.name = 'Glass';
    const flame = new MeshBasicMaterial();
    const plain = palette();
    plain.map = null;
    for (const m of [clan, glass, flame, plain]) {
      const node = box(m);
      applyPaint(node, 'graphite');
      expect(materialOf(node)).toBe(m);
    }
    const pirate = box(palette());
    applyLivery(pirate, 'pirate');
    const worn = materialOf(pirate);
    applyPaint(pirate, 'graphite');
    expect(materialOf(pirate)).toBe(worn);
  });
});

// ShipView with fake part templates (like hull/shipViewShell.test.ts)
function fakeLibrary(): ModelLibrary {
  const parts = new Map<PartId, Object3D>();
  const ids: PartId[] = ['cockpit', 'armor', 'engine', 'gyro', 'miningLaser', 'cargo', 'fuelTank', 'reactor', 'radar', 'cannon', 'shield', 'battery'];
  for (const id of ids) {
    const size = partDef(id, 1).size;
    const root = new Group();
    const body = new Mesh(new BoxGeometry(size.w * 0.94, 0.4, size.h * 0.94), palette());
    body.name = 'Body';
    root.add(body);
    parts.set(id, root);
  }
  const conn = box(palette());
  return {
    part: (id: PartId) => parts.get(id) ?? null,
    connector: () => conn,
    clans: { part: () => null, connector: () => null },
    swatchUv: (key: string) => [0.25 + (key.length % 7) / 20, 0.5] as const,
    hasSwatches: true,
  } as unknown as ModelLibrary;
}

const settle = (view: ShipView, g: ShipGrid) => view.update(1 / 60, { x: 0, y: 0 }, computeProperties(g), null);

/** Rendered meshes of the view's hull (batches + loose), with their materials. */
function drawn(view: ShipView): Mesh[] {
  const out: Mesh[] = [];
  view.group.traverse((o) => {
    if (o instanceof Mesh && o.visible && !(o instanceof InstancedMesh && o.count === 0)) out.push(o);
  });
  return out;
}

describe('paints on a ShipView', () => {
  afterEach(() => setHullShellEnabled(true));

  it('a painted ship draws as many meshes as an unpainted one, before or after the bake', () => {
    const grid = createStarterShip();
    const plain = new ShipView(grid, computeProperties(grid), fakeLibrary(), null, { mode: 'flight' });
    settle(plain, grid);
    const painted = new ShipView(grid, computeProperties(grid), fakeLibrary(), null, { mode: 'flight' });
    applyPaint(painted.group, 'racing');
    settle(painted, grid);
    expect(painted.batchCount).toBe(plain.batchCount);
    expect(drawn(painted).length).toBe(drawn(plain).length);
    // every batch wears the paint
    const palettes = drawn(painted).filter((m) => (m.material as Material).name === 'AF_Palette');
    expect(palettes.length).toBeGreaterThan(0);
    for (const m of palettes) expect(paintOfMaterial(m.material as Material)).toBe('racing');
    // repaint after the bake: same meshes, new paint
    applyPaint(painted.group, 'navy');
    expect(drawn(painted).length).toBe(drawn(plain).length);
    for (const m of palettes) expect(paintOfMaterial(m.material as Material)).toBe('navy');
  });

  it('keeps the paint over its own shell rebuild (the ShipView dress)', () => {
    const grid = createStarterShip();
    const view = new ShipView(grid, computeProperties(grid), fakeLibrary(), null, { mode: 'flight' });
    applyPaint(view.group, 'sand');
    settle(view, grid);
    const count = drawn(view).length;
    setHullShellEnabled(false);
    settle(view, grid);
    setHullShellEnabled(true);
    settle(view, grid);
    expect(drawn(view).length).toBe(count);
    const palettes = drawn(view).filter((m) => (m.material as Material).name === 'AF_Palette');
    expect(palettes.length).toBeGreaterThan(0);
    for (const m of palettes) expect(paintOfMaterial(m.material as Material)).toBe('sand');
  });
});
