import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { TROPHY_FIT } from '../../data/home';
import { captainDef, captainGrid } from '../../sim/captains/captains';
import type { SimState } from '../../sim/Simulation';
import type { ModelLibrary } from '../assets/ModelLibrary';
import type { HomeModules } from './HomeModules';
import { REPLICA_LIFT, REPLICA_TRIANGLES, soupBounds } from './replica';
import { replicaSoup, TrophyShelf } from './TrophyShelf';

const material = new MeshStandardMaterial();
const swatchUv = (key: string): readonly [number, number] => [(key.length % 16) / 16 + 1 / 32, 0.5];

/** Every part is a box on the shared material; clan sets are "ready" without models. */
function fakeLibrary(withSwatches = true): ModelLibrary {
  const template = new Group();
  template.add(new Mesh(new BoxGeometry(0.9, 0.4, 0.9), material));
  return {
    part: () => template,
    clans: { part: () => null, ready: () => true, ensure: () => Promise.resolve() },
    swatchUv: withSwatches ? swatchUv : () => null,
  } as unknown as ModelLibrary;
}

function fakeState(captains: number[]): SimState {
  return {
    seed: 1337,
    career: { trophies: captains.map((captain) => ({ captain, parts: [] })), captains: new Map() },
    pirates: { fortresses: new Map() },
    home: { modules: new Set(['trophyHall']), trophyPins: [] },
  } as unknown as SimState;
}

describe('replicaSoup', () => {
  it('builds the display model with its post, fitted onto a pedestal within the budget', () => {
    const built = replicaSoup(captainGrid(5), 'slantedStar', swatchUv)!;
    expect(built.soup.indices.length / 3).toBeLessThanOrEqual(REPLICA_TRIANGLES);
    const b = soupBounds(built.soup);
    const { scale, offset } = built.fit;
    // the post stands on the pedestal top, the model's turn circle and height fit the pedestal
    expect(b.min[1] * scale + offset[1]).toBeCloseTo(0, 6);
    expect(b.max[1] * scale + offset[1]).toBeLessThanOrEqual(TROPHY_FIT.maxHeight + 1e-6);
    expect(b.max[1] * scale + offset[1]).toBeGreaterThan(REPLICA_LIFT);
  });

  it('is null without the swatch table', () => {
    expect(replicaSoup(captainGrid(1), 'rust', () => null)).toBeNull();
  });
});

describe('TrophyShelf', () => {
  it('builds a captain replica over a few frames under its pedestal, within the fit and budget', () => {
    const anchors = Array.from({ length: 6 }, (_, i) => Object.assign(new Object3D(), { name: `trophy_${i}` }));
    let shown = false;
    const modules = { trophyAnchors: () => (shown ? anchors : []) } as unknown as HomeModules;
    const shelf = new TrophyShelf(fakeLibrary(), modules);
    const state = fakeState([0, 1]);
    // nothing happens while the hall is not shown
    shelf.update(state, 0, 1 / 60);
    expect(anchors[0]!.children).toHaveLength(0);
    shown = true;
    for (let i = 0; i < 30; i++) shelf.update(state, 0, 1 / 60);
    // the newest captain first
    const holders = anchors.map((a) => a.children[0]!);
    expect(holders.every((h) => h !== undefined)).toBe(true);
    const meshes = holders.map((h) => {
      const list: Mesh[] = [];
      h.traverse((o) => {
        if (o instanceof Mesh) list.push(o);
      });
      return list;
    });
    expect(meshes.map((m) => m.length)).toEqual([1, 1, 0, 0, 0, 0]);
    const newest = captainDef(1337, 1)!.clan;
    expect(meshes[0]![0]!.name).toContain(newest);
    for (const m of [meshes[0]![0]!, meshes[1]![0]!]) {
      const g = m.geometry;
      // one mesh on the parts' shared material, within the budget
      expect(m.material).toBe(material);
      expect(g.index!.count / 3).toBeLessThanOrEqual(REPLICA_TRIANGLES);
      g.computeBoundingBox();
      const box = g.boundingBox!;
      const s = m.scale.x;
      // the top under the height limit, the post on the pedestal top
      expect(box.max.y * s + m.position.y).toBeLessThanOrEqual(TROPHY_FIT.maxHeight + 1e-6);
      expect(box.min.y * s + m.position.y).toBeCloseTo(0, 6);
    }
    // no shadow map, no AO normal pass: one draw call per trophy
    expect(holders.every((h) => h.userData.noShadow === true && h.userData.noAO === true)).toBe(true);
    // turning
    const before = holders[0]!.children[0]!.rotation.y;
    shelf.update(state, 0, 1);
    expect(holders[0]!.children[0]!.rotation.y).not.toBeCloseTo(before, 3);
    // still with reduced motion
    shelf.update(state, 0, 1, true);
    const still = holders[0]!.children[0]!.rotation.y;
    shelf.update(state, 0, 1, true);
    expect(holders[0]!.children[0]!.rotation.y).toBe(still);

    // a shelf change: one captain left
    (state.career as { trophies: unknown[] }).trophies.splice(1, 1);
    for (let i = 0; i < 30; i++) shelf.update(state, 0, 1 / 60);
    expect(holders.map((h) => h.children[0]!.children.length)).toEqual([1, 0, 0, 0, 0, 0]);
    shelf.dispose();
    expect(anchors.every((a) => a.children.length === 0)).toBe(true);
  });
});

describe('TrophyShelf caching', () => {
  it('keeps the geometry of a clan and level cached, and waits for the swatch table', () => {
    const anchors = Array.from({ length: 6 }, () => new Object3D());
    const modules = { trophyAnchors: () => anchors } as unknown as HomeModules;
    const waiting = new TrophyShelf(fakeLibrary(false), modules);
    const state = fakeState([0]);
    for (let i = 0; i < 5; i++) waiting.update(state, 0, 1 / 60);
    expect(waiting.triangles.size).toBe(0);
    waiting.dispose();
    const shelf = new TrophyShelf(fakeLibrary(), modules);
    shelf.update(state, 0, 1 / 60);
    const meshOn = (a: Object3D): Mesh | undefined => a.children[0]?.children[0]?.children[0] as Mesh | undefined;
    const first = meshOn(anchors[0]!)!.geometry;
    // the shelf empties, then the same captain comes back: the cached geometry stands again
    const trophies = (state.career as { trophies: unknown[] }).trophies;
    const saved = trophies.splice(0);
    shelf.update(state, 0, 1);
    expect(meshOn(anchors[0]!)).toBeUndefined();
    trophies.push(...saved);
    shelf.update(state, 0, 1);
    expect(meshOn(anchors[0]!)!.geometry).toBe(first);
    expect(shelf.triangles.size).toBe(1);
    shelf.dispose();
  });
});
