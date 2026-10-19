import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Texture, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { computeProperties } from '../../sim/ship/properties';
import { createStarterShip } from '../../sim/ship/presets';
import type { ModelLibrary } from '../assets/ModelLibrary';
import { ShipView } from '../ShipView';
import { BAKES_PER_FRAME, SETTLE_FRAMES, SHADE_SCALE, WRECK_CELL, WreckBatch, WreckBatcher, shadedMaterial } from './wreckBatch';
import type { LodProvider } from './wreckLod';
import { LOD1_ERROR, simplifyLod } from './wreckLodCore';

// decals load their atlas through TextureLoader (no DOM in the unit tests)
vi.mock('../fx/textures', () => ({ vfxTexture: () => new Texture() }));

/** No models: ShipView draws a placeholder box per part. */
const placeholders = { part: () => null, connector: () => null, clans: { part: () => null, connector: () => null } } as unknown as ModelLibrary;

const shadeA = new MeshStandardMaterial({ color: 0x888888 });
const shadeB = new MeshStandardMaterial({ color: 0x666666 });

/** A frozen "wreck": two parts in shade A, one in shade B. */
function baked(): Mesh[] {
  const part = (m: MeshStandardMaterial, x: number) => {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), m);
    mesh.matrix.makeTranslation(x, 0, 0);
    return mesh;
  };
  return [part(shadeA, 0), part(shadeA, 1), part(shadeB, 2)];
}

describe('graveyard wreck batch', () => {
  it('merges any number of wrecks into one mesh per base material, the shades per vertex', () => {
    const batch = new WreckBatch(null);
    for (let i = 0; i < 20; i++) batch.set(i, baked(), new Matrix4().makeTranslation(i * 10, 0, 0));
    batch.flush();
    expect(batch.size).toBe(20);
    // shade A and shade B differ only in colour: one mesh, drawn with the shared vertex-coloured twin
    expect(batch.meshes).toHaveLength(1);
    expect(batch.object.children).toHaveLength(1);
    const a = batch.meshes[0]!;
    const twin = a.material as MeshStandardMaterial;
    expect(twin).toBe(shadedMaterial(shadeA));
    expect(twin).toBe(shadedMaterial(shadeB));
    expect(twin.vertexColors).toBe(true);
    expect(twin.color.r).toBe(SHADE_SCALE);
    // every box (24 vertices) of every wreck is in, at its world place
    expect(a.geometry.getAttribute('position').count).toBe(20 * 3 * 24);
    a.geometry.computeBoundingBox();
    expect(a.geometry.boundingBox!.max.x).toBeCloseTo(19 * 10 + 2.5);
    // each box carries its own material's colour (times SHADE_SCALE = the colour drawn)
    const color = a.geometry.getAttribute('color');
    expect(color.getX(0) * SHADE_SCALE).toBeCloseTo(shadeA.color.r, 2);
    expect(color.getX(2 * 24) * SHADE_SCALE).toBeCloseTo(shadeB.color.r, 2);
  });

  it('keeps materials that do not shade-merge apart', () => {
    const batch = new WreckBatch(null);
    const glow = new MeshBasicMaterial({ color: 0xff0000 });
    const odd = new Mesh(new BoxGeometry(1, 1, 1), glow);
    batch.set(1, [...baked(), odd], new Matrix4());
    batch.flush();
    expect(batch.meshes).toHaveLength(2);
    expect(batch.meshes.some((m) => m.material === glow)).toBe(true);
    batch.dispose();
  });

  it('rebuilds only when the set changed; delete frees the wreck', () => {
    const batch = new WreckBatch(null);
    batch.set('a', baked(), new Matrix4());
    batch.set('b', baked(), new Matrix4().makeTranslation(5, 0, 0));
    batch.flush();
    const first = batch.meshes;
    batch.flush();
    expect(batch.meshes).toBe(first);
    expect(batch.delete('a')).toBe(true);
    expect(batch.delete('a')).toBe(false);
    batch.flush();
    expect(batch.meshes).not.toBe(first);
    expect(batch.has('b')).toBe(true);
    const b = batch.meshes[0]!;
    b.geometry.computeBoundingBox();
    expect(b.geometry.boundingBox!.getCenter(new Vector3()).x).toBeCloseTo(6);
    batch.delete('b');
    batch.flush();
    expect(batch.meshes).toHaveLength(0);
    batch.dispose();
  });
});

// ---------------------------------------------------------------------------
// far band LOD1

/** A finely tessellated flat plate (the simplifier folds it down to a few triangles). */
function plate(material: MeshStandardMaterial): Mesh {
  return new Mesh(new PlaneGeometry(4, 4, 16, 16), material);
}

/** LOD1 in the test thread (the game simplifies in a worker). */
const inline: LodProvider = (jobs) => simplifyLod(jobs);

describe('graveyard wreck batch LOD1', () => {
  it('simplifies within the error and keeps a mesh that would not shrink', async () => {
    const flat = new PlaneGeometry(4, 4, 16, 16);
    const job = { index: Uint32Array.from(flat.index!.array), positions: Float32Array.from(flat.getAttribute('position').array) };
    const [lod] = await simplifyLod([job]);
    expect(lod).not.toBeNull();
    expect(lod!.length).toBeLessThan(job.index.length / 4);
    // a box has nothing to give at this error: no LOD1 range for it
    const box = new BoxGeometry(1, 1, 1);
    const [none] = await simplifyLod([{ index: Uint32Array.from(box.index!.array), positions: Float32Array.from(box.getAttribute('position').array) }]);
    expect(none).toBeNull();
    expect(LOD1_ERROR).toBeLessThan(0.05);
  });

  it('draws the LOD1 range in the far band once it arrived, LOD0 near (no new vertices)', async () => {
    const batch = new WreckBatch(inline);
    batch.set(1, [plate(shadeA), plate(shadeB)], new Matrix4());
    batch.set(2, [plate(shadeA)], new Matrix4().makeTranslation(10, 0, 0));
    batch.flush();
    const mesh = batch.meshes[0]!;
    const g = mesh.geometry;
    const vertices = g.getAttribute('position').count;
    const lod0 = g.index!.count;
    // until the LOD1 lands, both bands draw LOD0
    batch.setFar(true);
    expect(g.drawRange).toEqual({ start: 0, count: lod0 });
    await new Promise((r) => setTimeout(r, 0));
    batch.flush();
    expect(batch.meshes[0]).toBe(mesh);
    expect(g.getAttribute('position').count).toBe(vertices);
    expect(g.drawRange.start).toBe(lod0);
    expect(g.drawRange.count).toBeLessThan(lod0 / 4);
    const { near, far } = batch.triangles;
    expect(near).toBe(lod0 / 3);
    expect(far).toBe(g.drawRange.count / 3);
    // every LOD1 triangle uses the merged vertices
    const index = g.index!.array;
    for (let i = lod0; i < lod0 + g.drawRange.count; i++) expect(index[i]).toBeLessThan(vertices);
    batch.setFar(false);
    expect(g.drawRange).toEqual({ start: 0, count: lod0 });
    // a rebuild (a wreck leaves) keeps the LOD1 of the others
    batch.delete(2);
    batch.flush();
    batch.setFar(true);
    const h = batch.meshes[0]!.geometry;
    expect(h.drawRange.start).toBe(h.index!.count / 2);
    expect(h.drawRange.count).toBeLessThan(h.index!.count / 8);
    batch.dispose();
  });

  it('switches by the far tier with hysteresis (in past 105, out below 95)', () => {
    const batcher = new WreckBatcher(WRECK_CELL, null);
    batcher.setViewDistance(100);
    expect(batcher.farBand).toBe(false);
    batcher.setViewDistance(106);
    expect(batcher.farBand).toBe(true);
    batcher.setViewDistance(100);
    expect(batcher.farBand).toBe(true);
    batcher.setViewDistance(94);
    expect(batcher.farBand).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// the set / delete lifecycle (WreckBatcher)

/** A wreck view as CombatLayer has it: placed in the layer, decals drawn ('wreck' – always some). */
const layer = new Group();

function wreckView(x: number, z: number): ShipView {
  const grid = createStarterShip();
  const view = new ShipView(grid, computeProperties(grid), placeholders);
  layer.add(view.group);
  view.group.position.set(x, 0, z);
  view.group.rotation.y = 0.7;
  view.setDamage('wreck', 0, 3);
  return view;
}

/** Runs `n` frames of one still wreck through the batcher the way CombatLayer does. */
function frames(batcher: WreckBatcher, id: number, view: ShipView, n: number, still = true, version = 0): void {
  for (let i = 0; i < n; i++) {
    if (!batcher.batched(id, view.group, still, version)) {
      view.setDamage('wreck', 0, 3);
      batcher.settle(id, view.group, still, version);
    }
    batcher.flush();
  }
}

const decalPositions = (mesh: InstancedMesh, world: Matrix4): number[][] =>
  Array.from({ length: mesh.count }, (_, i) => {
    const m = new Matrix4();
    mesh.getMatrixAt(i, m);
    return new Vector3().setFromMatrixPosition(m.premultiply(world)).toArray().map((v) => Math.round(v * 1e3) / 1e3);
  });

describe('graveyard wreck batcher', () => {
  it('bakes a wreck in once it has lain still for a while and takes its live view out of the scene', () => {
    const batcher = new WreckBatcher();
    const view = wreckView(10, -20);
    frames(batcher, 1, view, SETTLE_FRAMES - 1);
    expect(batcher.has(1)).toBe(false);
    expect(view.group.visible).toBe(true);
    frames(batcher, 1, view, 1);
    expect(batcher.has(1)).toBe(true);
    expect(view.group.visible).toBe(false);
    expect(view.group.parent).toBeNull();
    const [batch] = batcher.batches;
    expect(batch!.meshes.length).toBeGreaterThan(0);
    // the decals come along: the same quads at the same world places, in one InstancedMesh
    const live = view.group.getObjectByName('hull-decals') as InstancedMesh;
    expect(batch!.decals!.count).toBe(view.decalCount);
    view.group.updateMatrixWorld(true);
    expect(decalPositions(batch!.decals!, new Matrix4())).toEqual(decalPositions(live, live.matrixWorld));
    batcher.dispose();
    view.dispose();
  });

  it('takes a wreck out when it moves (towed, nudged) and bakes it in again once it settles', () => {
    const batcher = new WreckBatcher();
    const view = wreckView(0, 0);
    frames(batcher, 1, view, SETTLE_FRAMES);
    expect(batcher.batched(1, view.group, true, 0)).toBe(true);
    // the tractor beam takes it: out of the batch, the live view shows
    expect(batcher.batched(1, view.group, false, 0)).toBe(false);
    expect(batcher.has(1)).toBe(false);
    expect(view.group.visible).toBe(true);
    expect(view.group.parent).toBe(layer);
    batcher.flush();
    expect(batcher.batches).toHaveLength(0);
    // lying still again: back in after the settle time
    frames(batcher, 1, view, SETTLE_FRAMES - 1);
    expect(batcher.has(1)).toBe(false);
    frames(batcher, 1, view, 1);
    expect(batcher.has(1)).toBe(true);
    batcher.dispose();
    view.dispose();
  });

  it('takes a wreck out when its look version moves (hull shell setting) and on release (cut, despawn)', () => {
    const batcher = new WreckBatcher();
    const view = wreckView(0, 0);
    frames(batcher, 1, view, SETTLE_FRAMES);
    // the shell setting flipped: the live view rebuilds and is baked in again right away (it lies still)
    expect(batcher.batched(1, view.group, true, 1)).toBe(false);
    expect(view.group.visible).toBe(true);
    batcher.settle(1, view.group, true, 1);
    expect(batcher.has(1)).toBe(true);
    batcher.flush();
    // cut: the view is rebuilt from a smaller grid, so the old copy goes
    batcher.release(1, view.group);
    expect(batcher.has(1)).toBe(false);
    expect(view.group.visible).toBe(true);
    expect(view.group.parent).toBe(layer);
    batcher.flush();
    expect(batcher.batches).toHaveLength(0);
    expect(batcher.object.children).toHaveLength(0);
    batcher.dispose();
    view.dispose();
  });

  it('batches by cell and bakes at most one wreck per frame', () => {
    const batcher = new WreckBatcher();
    const near = [wreckView(10, 10), wreckView(30, 20)];
    const far = wreckView(10 + WRECK_CELL * 2, 10);
    const views = [...near, far];
    for (let i = 0; i < SETTLE_FRAMES - 1; i++) {
      views.forEach((v, k) => batcher.settle(k, v.group, true, 0));
      batcher.flush();
    }
    // all three settle in the same frame: one is baked now, the others on the next frames
    views.forEach((v, k) => batcher.settle(k, v.group, true, 0));
    batcher.flush();
    expect(batcher.size).toBe(BAKES_PER_FRAME);
    for (let i = 0; i < 3; i++) {
      views.forEach((v, k) => {
        if (!batcher.batched(k, v.group, true, 0)) batcher.settle(k, v.group, true, 0);
      });
      batcher.flush();
    }
    expect(batcher.size).toBe(3);
    // the two near wrecks share a cell, the far one has its own
    expect(batcher.batches.map((b) => b.size).sort()).toEqual([1, 2]);
    batcher.dispose();
    for (const v of views) v.dispose();
  });
});
