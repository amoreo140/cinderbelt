// SL2 E1 T4: the hull shell wired into ShipView – batch neutrality, hubs instead of the dot grid,
// shell pieces inside their part nodes (decal probes), torn edges from the first build, the shell-off
// path unchanged, self-rebuild on a setting change (keeping the owner's livery), clipped armour.
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Object3D, Texture, Vector3, type BufferGeometry, type Material } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { partDef, type PartId } from '../../data/parts';
import { createGrid, rotatedSize } from '../../sim/ship/grid';
import { gridCellKeys, hullOutline } from '../../sim/ship/outline';
import { partSize } from '../../sim/ship/shape';
import { createStarterShip } from '../../sim/ship/presets';
import { computeProperties } from '../../sim/ship/properties';
import type { Rotation, ShipGrid } from '../../sim/ship/types';
import type { ModelLibrary } from '../assets/ModelLibrary';
import { connectorPlacements } from '../connectors';
import type { DecalPart } from '../decals/HullDecals';
import { decalSpecs, WRECK_LEVEL } from '../decals/decalPlan';
import { ShipView, type ShipViewOptions } from '../ShipView';
import { perfDevHooks } from './perfHook';
import { hullShellVersion, hullTerraceEnabled, setHullShellEnabled, setHullShellQuality, setHullTerraceOverride } from './setting';
import { DECK_TOP, TERRACE_CLIP_Z } from './shellConstants';
import { plateStyle, shapePlateGeometry } from './shapePlate';
import { shellLayoutOf } from './shellGeometry';

// flames and decals load their textures through TextureLoader (no DOM in the unit tests)
vi.mock('../fx/textures', () => ({ vfxTexture: () => new Texture() }));

const atlas = new Texture();
const palette = (): MeshStandardMaterial => {
  const m = new MeshStandardMaterial({ map: atlas, emissiveMap: atlas, roughness: 0.6 });
  m.name = 'AF_Palette';
  return m;
};

/** Part templates like the GLBs: a root group with one palette body per part (each its own material copy). */
function templates(): Map<PartId, Object3D> {
  const out = new Map<PartId, Object3D>();
  const ids: PartId[] = ['cockpit', 'armor', 'engine', 'gyro', 'miningLaser', 'cargo', 'fuelTank', 'reactor', 'radar', 'cannon', 'shield', 'heavyLaser', 'largeCargo', 'battery', 'tractorBeam'];
  for (const id of ids) {
    const size = partDef(id, 1).size;
    const root = new Group();
    const body = new Mesh(new BoxGeometry(size.w * 0.94, 0.4, size.h * 0.94), palette());
    body.name = 'Body';
    root.add(body);
    out.set(id, root);
  }
  return out;
}

function connector(): Object3D {
  const root = new Group();
  root.add(new Mesh(new BoxGeometry(0.12, 0.3, 0.12), palette()));
  return root;
}

interface FakeOptions {
  swatches?: boolean;
  clanParts?: boolean;
}

function fakeLibrary(o: FakeOptions = {}): ModelLibrary {
  const parts = templates();
  const conn = { edge: connector(), corner: connector() };
  const clanParts = templates();
  return {
    part: (id: PartId) => parts.get(id) ?? null,
    connector: (kind: 'edge' | 'corner') => conn[kind],
    clans: {
      part: (_clan: string, id: PartId) => (o.clanParts ? (clanParts.get(id) ?? null) : null),
      connector: () => null,
    },
    swatchUv: (key: string) => (o.swatches === false ? null : ([0.25 + (key.length % 7) / 20, 0.5] as const)),
    hasSwatches: o.swatches !== false,
  } as unknown as ModelLibrary;
}

const props = (g: ShipGrid) => computeProperties(g);
const settle = (view: ShipView, g: ShipGrid) => view.update(1 / 60, { x: 0, y: 0 }, props(g), null);

function shellMeshes(view: ShipView): Mesh[] {
  const out: Mesh[] = [];
  view.group.traverse((o) => {
    if (o instanceof Mesh && o.userData.afShell === true) out.push(o);
  });
  return out;
}

const batches = (view: ShipView): Mesh[] => {
  const out: Mesh[] = [];
  view.group.traverse((o) => {
    if (o instanceof Mesh && o.name === 'ship-batch') out.push(o);
  });
  return out;
};

/** Visible draw calls of a view: plain meshes (batches, loose meshes) and instanced meshes. */
function drawables(view: ShipView): number {
  let n = 0;
  view.group.traverse((o) => {
    if (o instanceof Mesh && o.visible && o.name !== 'hull-decals') n++;
  });
  return n;
}

/** A wide armoured ship: armour blocks (terrace), armour corners (bevels), a T and an L seam junction. */
function armouredShip(): ShipGrid {
  return createGrid([
    ['cockpit', 1, 0],
    ['gyro', 0, 0],
    ['reactor', -1, 0],
    ['engine', -2, 0, 0],
    ['armor', 2, 0],
    ['armor', 2, 1],
    ['armor', 1, 1],
    ['armor', 0, 1],
    ['armor', -1, 1],
    ['armor', 2, -1],
    ['armor', 1, -1],
    ['armor', 0, -1],
    ['armor', -1, -1],
    ['cannon', 3, 0],
    ['engine', -2, 1, 0],
    ['engine', -2, -1, 0],
  ]);
}

/** Terrace v2: a 6 × 5 hull; its inner armour gives two 4-cell rails (y = ±1) beside the 3-cell middle row. */
function spineShip(): ShipGrid {
  const list: [PartId, number, number, Rotation?][] = [['cockpit', 3, 0], ['reactor', -1, 0]];
  for (let y = -2; y <= 2; y++) list.push(['engine', -2, y, 0]);
  for (let x = -1; x <= 3; x++) {
    for (let y = -2; y <= 2; y++) if (y !== 0 || (x >= 0 && x <= 2)) list.push(['armor', x, y]);
  }
  return createGrid(list);
}

const views: ShipView[] = [];
const make = (g: ShipGrid, lib: ModelLibrary, clan: ShipView['clan'] = null, options: ShipViewOptions = {}) => {
  const v = new ShipView(g, props(g), lib, clan, options);
  views.push(v);
  return v;
};

afterEach(() => {
  for (const v of views.splice(0)) v.dispose();
  setHullShellEnabled(true);
  setHullShellQuality('high');
});

describe('ShipView hull shell (T4)', () => {
  it('adds no draw call: batches and drawables are the same with the shell on and off', () => {
    for (const grid of [createStarterShip(), armouredShip()]) {
      const lib = fakeLibrary();
      const on = make(grid, lib);
      const off = make(grid, lib, null, { shell: false });
      settle(on, grid);
      settle(off, grid);
      expect(on.shellInfo.on).toBe(true);
      expect(on.shellInfo.pieces).toBeGreaterThan(0);
      expect(off.shellInfo.on).toBe(false);
      expect(on.batchCount).toBe(off.batchCount);
      expect(drawables(on)).toBe(drawables(off));
      // every shell piece left the graph: merged into a batch
      expect(shellMeshes(on)).toHaveLength(0);
    }
  });

  it('places corner hubs only at the T / L junctions and drops the edge connectors', () => {
    // a 2×2 hold beside 1×1 parts: T junctions (the armour block's + crossings get none)
    const grid = createGrid([['cockpit', 1, 0], ['gyro', 0, 0], ['largeCargo', -1, 1], ['reactor', -1, 0], ['armor', 0, 1], ['engine', -2, 0]]);
    const lib = fakeLibrary();
    const on = make(grid, lib);
    const outline = hullOutline(grid, { tornFrom: null, bevelArmour: true });
    expect(outline.hubs.length).toBeGreaterThan(0);
    expect(on.connectorCount).toBe(outline.hubs.length);
    const off = make(grid, lib, null, { shell: false });
    expect(off.connectorCount).toBe(connectorPlacements(grid).length);
    expect(off.connectorCount).toBeGreaterThan(on.connectorCount);
  });

  it('puts every shell piece under its owner part node, landing in the hull frame', () => {
    const grid = armouredShip();
    const view = make(grid, fakeLibrary());
    const pieces = shellMeshes(view);
    expect(pieces.length).toBe(view.shellInfo.pieces);
    const ids = new Set(grid.parts.map((p) => p.id));
    for (const m of pieces) {
      const owner = m.parent!;
      expect(ids.has(owner.userData.afPart as number)).toBe(true);
      // node matrix × piece matrix = identity: the geometry is in the hull frame
      owner.updateMatrix();
      m.updateMatrix();
      const product = new Matrix4().multiplyMatrices(owner.matrix, m.matrix);
      const id = new Matrix4();
      product.elements.forEach((e, i) => expect(e).toBeCloseTo(id.elements[i]!, 6));
      // the piece draws with its part's own palette material
      const body = owner.children.find((c) => c.name === 'Body') as Mesh;
      expect(m.material).toBe(body.material);
    }
  });

  it('shows torn edges after a rebuild with fewer cells only with tornFrom', () => {
    const full = createStarterShip();
    const lost = { ...full, parts: full.parts.filter((p) => p.partId !== 'cargo') };
    const lib = fakeLibrary();
    const first = make(full, lib, null, { tornFrom: 'firstBuild' });
    expect(first.shellInfo.tornEdges).toBe(0);
    first.rebuild(lost, props(lost));
    expect(first.shellInfo.tornEdges).toBeGreaterThan(0);
    const plain = make(full, lib);
    plain.rebuild(lost, props(lost));
    expect(plain.shellInfo.tornEdges).toBe(0);
    // the player: a blueprint's cells
    const player = make(lost, lib, null, { tornFrom: new Set(['0,1', '0,-1']) });
    expect(player.shellInfo.tornEdges).toBeGreaterThan(0);
  });

  it('shell off builds exactly what the shell-less view builds (connectors, batches)', () => {
    const grid = armouredShip();
    const snapshot = (view: ShipView) => {
      const list = batches(view).map((b) => ({
        key: b.userData.batchKey as string,
        pos: Array.from(b.geometry.getAttribute('position').array as Float32Array),
        index: Array.from(b.geometry.index!.array),
      }));
      list.sort((a, b) => a.key.localeCompare(b.key) || a.pos.length - b.pos.length);
      return { connectors: view.connectorCount, batches: list, nav: view.navPoints().length };
    };
    // reference: no swatch table at all = the pre-shell build path
    const reference = make(grid, fakeLibrary({ swatches: false }));
    const viaOption = make(grid, fakeLibrary(), null, { shell: false });
    setHullShellEnabled(false);
    const viaSetting = make(grid, fakeLibrary());
    for (const v of [reference, viaOption, viaSetting]) settle(v, grid);
    const ref = snapshot(reference);
    expect(ref.connectors).toBe(connectorPlacements(grid).length);
    expect(ref.nav).toBe(0);
    expect(snapshot(viaOption)).toEqual(ref);
    expect(snapshot(viaSetting)).toEqual(ref);
  });

  it('rebuilds itself when the setting flips and keeps the owner\'s dress', () => {
    const grid = armouredShip();
    const view = make(grid, fakeLibrary());
    // a livery right after the build (CombatLayer: applyLivery / applyDerelict) – one shared worn material
    const worn = palette();
    worn.color.setRGB(0.5, 0.2, 0.2);
    view.group.traverse((o) => {
      if (o instanceof Mesh && !(o instanceof InstancedMesh)) o.material = worn;
    });
    settle(view, grid);
    expect(view.shellInfo.on).toBe(true);
    const wornBatches = () => batches(view).filter((b) => b.material === worn).length;
    expect(wornBatches()).toBe(1);
    const v0 = hullShellVersion();
    setHullShellEnabled(false);
    expect(hullShellVersion()).toBe(v0 + 1);
    settle(view, grid);
    expect(view.shellInfo.on).toBe(false);
    expect(view.navPoints()).toHaveLength(0);
    expect(wornBatches()).toBe(1);
    setHullShellEnabled(true);
    settle(view, grid);
    expect(view.shellInfo.on).toBe(true);
    expect(view.navPoints().length).toBeGreaterThan(0);
    expect(wornBatches()).toBe(1);
    // nothing else drew with the template materials
    const plain = batches(view).filter((b) => (b.material as Material) !== worn);
    expect(plain).toHaveLength(0);
  });

  it('wrecks (setDamage only) follow the setting too; a quality change that does not alter the shell does not rebuild', () => {
    const grid = armouredShip();
    const view = make(grid, fakeLibrary(), null, { mode: 'flight' });
    view.setDamage('wreck', 0, 1);
    const before = view.batchCount;
    const geometry = batches(view)[0]!.geometry;
    setHullShellQuality('medium');
    view.setDamage('wreck', 0, 1);
    // flight on medium = flight on high: same shell, no rebuild
    expect(batches(view)[0]!.geometry).toBe(geometry);
    setHullShellEnabled(false);
    view.setDamage('wreck', 0, 1);
    expect(view.shellInfo.on).toBe(false);
    expect(view.batchCount).toBe(before);
  });

  it('shaves the player armour corners with a clipped variant, never on clan ships', () => {
    const grid = armouredShip();
    const player = make(grid, fakeLibrary());
    expect(player.shellInfo.bevelled).toBeGreaterThan(0);
    const clipped: Mesh[] = [];
    player.group.traverse((o) => {
      if (o instanceof Mesh && o.geometry.userData.afArmourClip) clipped.push(o);
    });
    expect(clipped.length).toBe(player.shellInfo.bevelled);
    const pirate = make(grid, fakeLibrary({ clanParts: true }), 'rust');
    expect(pirate.clanPartCount).toBeGreaterThan(0);
    expect(pirate.shellInfo.on).toBe(true);
    expect(pirate.shellInfo.bevelled).toBe(0);
  });

  it('serves nav points in the group frame (centre of mass at the origin)', () => {
    const grid = createStarterShip();
    const view = make(grid, fakeLibrary());
    const nav = view.navPoints();
    expect(nav.map((p) => p.kind)).toContain('bow');
    const com = props(grid).centerOfMass;
    const bow = nav.find((p) => p.kind === 'bow')!;
    const raw = hullOutline(grid, { tornFrom: null, bevelArmour: true }).nav.find((p) => p.kind === 'bow')!;
    // pulled 0.075 towards the hull centroid, then shifted by the centre of mass
    expect(Math.hypot(bow.at.x + com.x - raw.at.x, bow.at.y + com.y - raw.at.y)).toBeCloseTo(0.075, 6);
    expect(view.navPoints()).toBe(nav);
  });

  it('gives placeholder parts (no model) no shell', () => {
    const grid = createStarterShip();
    const empty = { part: () => null, connector: () => null, clans: { part: () => null, connector: () => null }, swatchUv: () => [0.5, 0.5], hasSwatches: true } as unknown as ModelLibrary;
    const view = make(grid, empty);
    expect(view.shellInfo.on).toBe(false);
    expect(view.connectorCount).toBe(connectorPlacements(grid).length);
  });
});

/** armouredShip with shapes on the same cells: two bow wedges, a wing L over (0,1)-(1,1), a half plate, a T2 chamfer. */
function shapedArmouredShip(): ShipGrid {
  return createGrid([
    ['cockpit', 1, 0],
    ['gyro', 0, 0],
    ['reactor', -1, 0],
    ['engine', -2, 0, 0],
    ['armor', 2, 0],
    ['armor', 2, 1, 0, 1, 'wedge'],
    ['armor', 0, 1, 0, 1, 'wingL'],
    ['armor', -1, 1, 0, 1, 'half'],
    ['armor', 2, -1, 3, 1, 'wedge'],
    ['armor', 1, -1],
    ['armor', 0, -1, 0, 2, 'chamfer'],
    ['armor', -1, -1],
    ['cannon', 3, 0],
    ['engine', -2, 1, 0],
    ['engine', -2, -1, 0],
  ]);
}

/** The same cells without shapes (the wing's two cells as two plates, the chamfer's tier kept). */
function unshapedTwin(): ShipGrid {
  return createGrid([
    ['cockpit', 1, 0],
    ['gyro', 0, 0],
    ['reactor', -1, 0],
    ['engine', -2, 0, 0],
    ['armor', 2, 0],
    ['armor', 2, 1],
    ['armor', 0, 1],
    ['armor', 1, 1],
    ['armor', -1, 1],
    ['armor', 2, -1],
    ['armor', 1, -1],
    ['armor', 0, -1, 0, 2],
    ['armor', -1, -1],
    ['cannon', 3, 0],
    ['engine', -2, 1, 0],
    ['engine', -2, -1, 0],
  ]);
}

const keysOf = (view: ShipView): string[] => batches(view).map((b) => b.userData.batchKey as string).sort();

/** The node of a grid part (before the bake). */
function nodeOf(view: ShipView, id: number): Object3D {
  let node: Object3D | null = null;
  view.group.traverse((o) => {
    if (!node && o.userData.afPart === id) node = o;
  });
  if (!node) throw new Error(`no node for part ${id}`);
  return node;
}

describe('ShipView terrace v2 (R5)', () => {
  afterEach(() => setHullTerraceOverride(null));

  /** Local heights of a part node's own meshes (not its shell piece). */
  const partHeights = (node: Object3D): number[] => {
    node.updateMatrixWorld(true);
    const inv = new Matrix4().copy(node.matrixWorld).invert();
    const out: number[] = [];
    node.traverse((o) => {
      if (!(o instanceof Mesh) || o.userData.afShell === true) return;
      const m = new Matrix4().multiplyMatrices(inv, o.matrixWorld);
      const p = o.geometry.getAttribute('position');
      const v = new Vector3();
      for (let i = 0; i < p.count; i++) out.push(v.fromBufferAttribute(p, i).applyMatrix4(m).y);
    });
    return out;
  };
  /** The fake library with a raised pad (deck + 0.03 … 0.05) on the armour template. */
  const paddedLibrary = (): ModelLibrary => {
    const lib = fakeLibrary();
    const armour = lib.part('armor')!;
    const body = armour.children[0] as Mesh;
    const pad = new Mesh(new BoxGeometry(0.5, 0.02, 0.5), body.material);
    pad.position.y = DECK_TOP + 0.04;
    armour.add(pad);
    return lib;
  };
  const nodesOf = (view: ShipView): DecalPart[] => (view as unknown as { decalParts: DecalPart[] }).decalParts;

  /** Armour tops of a view: covered cells are deck-clipped, the rest keep the pad (deck + 0.05). */
  const expectArmour = (view: ShipView, covered: Set<string>): void => {
    for (const { part, node } of nodesOf(view)) {
      if (part.partId !== 'armor') continue;
      const top = Math.max(...partHeights(node));
      if (covered.has(`${part.x},${part.y}`)) expect(top).toBeLessThanOrEqual(TERRACE_CLIP_Z + 1e-6);
      else expect(top).toBeCloseTo(DECK_TOP + 0.05, 6);
    }
  };

  it('is on by default: deck-clips the covered armour, no draw call; override false removes it and restores the armour', () => {
    const grid = spineShip();
    const outline = hullOutline(grid, { tornFrom: null, bevelArmour: true });
    expect(outline.terraces.map((t) => t.cells.length)).toEqual([4, 4]);
    const covered = new Set(outline.terraces.flatMap((t) => t.cells.map((c) => `${c.x},${c.y}`)));
    expect(covered.size).toBe(8);
    const lib = paddedLibrary();
    expect(hullTerraceEnabled()).toBe(true);
    const on = make(grid, lib);
    expectArmour(on, covered);
    settle(on, grid);
    const onBatches = batches(on).length;
    const onTris = on.shellInfo.triangles;

    setHullTerraceOverride(false);
    expect(hullTerraceEnabled()).toBe(false);
    const off = make(grid, lib);
    expect(off.shellInfo.triangles).toBeLessThan(onTris);
    expectArmour(off, new Set()); // every armour cell keeps its full pad again
    settle(off, grid);
    expect(batches(off)).toHaveLength(onBatches);
  });

  it('a view rebuilds itself when the effective value changes (and back), not on a no-op override', () => {
    const grid = spineShip();
    const view = make(grid, paddedLibrary());
    settle(view, grid);
    const t0 = view.shellInfo.triangles;
    const v0 = hullShellVersion();
    // Forcing the default value changes nothing: no version bump.
    expect(perfDevHooks().shell.terrace(true)).toBe(true);
    expect(hullShellVersion()).toBe(v0);
    expect(perfDevHooks().shell.terrace(false)).toBe(false);
    expect(hullShellVersion()).toBe(v0 + 1);
    settle(view, grid);
    expect(view.shellInfo.triangles).toBeLessThan(t0);
    expect(perfDevHooks().shell.terrace(false)).toBe(false);
    expect(hullShellVersion()).toBe(v0 + 1);
    expect(perfDevHooks().shell.terrace(null)).toBe(true);
    expect(hullShellVersion()).toBe(v0 + 2);
    settle(view, grid);
    expect(view.shellInfo.triangles).toBe(t0);
  });

  it('keeps the shell in the part decal probes, the terrace also in the covered parts', () => {
    setHullTerraceOverride(true);
    const grid = spineShip();
    const view = make(grid, fakeLibrary());
    const outline = hullOutline(grid, { tornFrom: null, bevelArmour: true });
    view.setDamage('wreck', 0, 3);
    const parts = (view as unknown as { decals: { parts: { entry: DecalPart }[] } }).decals.parts;
    const geometryOf = (id: number): Set<BufferGeometry> => {
      const s = new Set<BufferGeometry>();
      parts.find((p) => p.entry.part.id === id)!.entry.node.traverse((o) => {
        if (o instanceof Mesh) s.add(o.geometry);
      });
      return s;
    };
    const terrace = outline.terraces[0]!;
    const ownerProbe = geometryOf(terrace.owner);
    const covered = grid.parts.filter((p) => p.id !== terrace.owner && terrace.cells.some((c) => c.x === p.x && c.y === p.y));
    expect(covered).toHaveLength(terrace.cells.length - 1);
    for (const p of covered) {
      const probe = geometryOf(p.id);
      const shared = [...probe].filter((g) => ownerProbe.has(g) && g.getAttribute('position').count > 24);
      expect(shared.length).toBeGreaterThan(0);
    }
    expect(view.decalCount).toBeGreaterThan(0);
  });
});

describe('ShipView shaped armour (SL2 E2 R4)', () => {
  it('adds no draw call: a shaped ship batches like the unshaped ship with the same cells, shell on and off', () => {
    expect([...gridCellKeys(shapedArmouredShip())].sort()).toEqual([...gridCellKeys(unshapedTwin())].sort());
    for (const shell of [true, false]) {
      const lib = fakeLibrary();
      const a = make(shapedArmouredShip(), lib, null, { shell });
      const b = make(unshapedTwin(), lib, null, { shell });
      settle(a, shapedArmouredShip());
      settle(b, unshapedTwin());
      expect(a.shellInfo.on).toBe(shell);
      expect(a.batchCount).toBe(b.batchCount);
      expect(drawables(a)).toBe(drawables(b));
      expect(keysOf(a)).toEqual(keysOf(b));
    }
  });

  it('builds a shaped armour as its runtime plate on the armour template material, turned by rot, never clipped', () => {
    const grid = shapedArmouredShip();
    const lib = fakeLibrary();
    const view = make(grid, lib);
    const armour = (lib.part('armor', 'iron') as Object3D).children[0] as Mesh;
    for (const p of grid.parts.filter((q) => q.shape)) {
      const node = nodeOf(view, p.id);
      expect(node.userData.afModel).toBe(true);
      expect(node.rotation.y).toBeCloseTo((p.rot * Math.PI) / 2, 9);
      const plate = node.children.find((c) => c instanceof Mesh && c.userData.afShell !== true) as Mesh;
      // the shared, cached plate geometry of the shape (R2) on the template's palette material
      expect(plate.geometry).toBe(shapePlateGeometry(p.shape!, plateStyle(p.tier, null), shellLayoutOf(armour.geometry), lib.swatchUv, p.rot));
      expect(plate.material).toBe(armour.material);
      expect(plate.geometry.userData.afArmourClip).toBeUndefined();
    }
    // the bevelled armour corners are unshaped plates only
    const clipped: Mesh[] = [];
    view.group.traverse((o) => {
      if (o instanceof Mesh && o.geometry.userData.afArmourClip) clipped.push(o);
    });
    expect(clipped.length).toBe(view.shellInfo.bevelled);
    // the outline at render detail: shell pieces land on the shaped parts too
    const owners = new Set(shellMeshes(view).map((m) => m.parent!.userData.afPart as number));
    expect(grid.parts.filter((p) => p.shape).some((p) => owners.has(p.id))).toBe(true);
  });

  it('never disposes the shared plate geometry with a view', () => {
    const grid = shapedArmouredShip();
    const lib = fakeLibrary();
    const view = make(grid, lib);
    const geometry = (nodeOf(view, 6).children[0] as Mesh).geometry;
    const disposed = vi.fn();
    geometry.addEventListener('dispose', disposed);
    settle(view, grid);
    view.rebuild(grid, props(grid));
    view.dispose();
    expect(disposed).not.toHaveBeenCalled();
    geometry.removeEventListener('dispose', disposed);
  });

  it('with the shell off shows the plates and only the connectors of the solid overlaps', () => {
    const grid = shapedArmouredShip();
    const off = make(grid, fakeLibrary(), null, { shell: false });
    expect(off.shellInfo.on).toBe(false);
    expect(off.connectorCount).toBe(connectorPlacements(grid).length);
    expect(off.connectorCount).toBeLessThan(connectorPlacements(unshapedTwin()).length);
    for (const p of grid.parts.filter((q) => q.shape)) expect(nodeOf(off, p.id).children.some((c) => c instanceof Mesh)).toBe(true);
  });

  it('lets the decal probes hit the plate, one probe per part, decals over the shape footprint', () => {
    const grid = shapedArmouredShip();
    const view = make(grid, fakeLibrary());
    view.setDamage('wreck', 0, 5);
    const parts = (view as unknown as { decals: { parts: { entry: DecalPart; decals: { matrix: Matrix4 | null }[] }[] } }).decals.parts;
    expect(parts.map((s) => s.entry.part.id)).toEqual(grid.parts.map((p) => p.id));
    for (const s of parts.filter((q) => q.entry.part.shape)) {
      const p = s.entry.part;
      expect(s.decals.length).toBe(decalSpecs(5, p.id, WRECK_LEVEL, rotatedSize(partSize(p), p.rot)).length);
      // the probe holds the plate: some ray from above lands on it
      expect(s.decals.some((d) => d.matrix !== null)).toBe(true);
    }
    expect(view.decalCount).toBeGreaterThan(0);
  });

  it('keeps the dress on the plates when the view rebuilds itself', () => {
    const grid = shapedArmouredShip();
    const view = make(grid, fakeLibrary());
    const worn = palette();
    worn.color.setRGB(0.2, 0.5, 0.2);
    view.group.traverse((o) => {
      if (o instanceof Mesh && !(o instanceof InstancedMesh)) o.material = worn;
    });
    settle(view, grid);
    const wornBatches = () => batches(view).filter((b) => b.material === worn).length;
    expect(wornBatches()).toBe(1);
    // every mesh of every part (the plates included) wears the dress: the decal probes copy them
    const probeMaterials = (): Set<Material> => {
      const out = new Set<Material>();
      const parts = (view as unknown as { decals: { parts: { entry: DecalPart }[] } }).decals.parts;
      for (const s of parts) {
        s.entry.node.traverse((o) => {
          if (o instanceof Mesh) out.add(o.material as Material);
        });
      }
      return out;
    };
    expect([...probeMaterials()]).toEqual([worn]);
    for (const enabled of [false, true]) {
      setHullShellEnabled(enabled);
      settle(view, grid);
      expect(view.shellInfo.on).toBe(enabled);
      expect(wornBatches()).toBe(1);
      expect([...probeMaterials()]).toEqual([worn]);
    }
    // nothing else drew with the template materials (with the shell the connectors give way to hubs)
    expect(batches(view).filter((b) => (b.material as Material) !== worn).length).toBe(view.connectorCount > 0 ? 1 : 0);
  });
});
