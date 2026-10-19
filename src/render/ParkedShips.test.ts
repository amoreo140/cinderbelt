import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Object3D, Texture } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createGrid } from '../sim/ship/grid';
import { createStarterShip } from '../sim/ship/presets';
import type { ShipGrid } from '../sim/ship/types';
import type { StoredShip } from '../sim/fleet/types';
import type { ModelLibrary } from './assets/ModelLibrary';
import { BAY_DECK, PARKING_SPOTS } from './hangarParking';
import { ParkedShips } from './ParkedShips';
import { patchRim } from './rimLight';
import { bakeStatic } from './shipBatch';

// decals and paint liveries load their atlases through TextureLoader (no DOM in the unit tests)
vi.mock('./fx/textures', () => ({ vfxTexture: () => new Texture() }));
vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  class TextureLoader {
    load(): Texture {
      return new three.Texture();
    }
  }
  return { ...three, TextureLoader };
});

const atlas = new Texture();
const palette = new MeshStandardMaterial({ map: atlas, emissiveMap: atlas, roughness: 0.6 });
palette.emissive.setRGB(1, 1, 1);
palette.name = 'AF_Palette';
patchRim(palette);

/** Part models like the GLBs: a static body with a turret (moving) on top, all on the palette. */
function fakeLibrary(): ModelLibrary {
  const template = new Group();
  const body = new Mesh(new BoxGeometry(0.9, 0.5, 0.9), palette);
  body.name = 'Body';
  const turret = new Mesh(new BoxGeometry(0.3, 0.3, 0.3), palette);
  turret.name = 'Cannon_Turret';
  turret.position.y = 0.4;
  body.add(turret);
  template.add(body);
  const connector = new Group();
  connector.add(new Mesh(new BoxGeometry(0.2, 0.2, 0.2), palette));
  const none = () => null;
  return { part: () => template, connector: () => connector, clans: { part: none, connector: none } } as unknown as ModelLibrary;
}

const HOME = 'home' as StoredShip['stationId'];

const stored = (id: number, stationId: string, grid: ShipGrid = createStarterShip()): StoredShip => ({
  record: { id, name: null, nameIdx: 0, log: { distance: 0, kills: 0, mined: 0, deaths: 0, built: 0 } },
  stationId: stationId as StoredShip['stationId'],
  grid,
  blueprint: grid,
  hp: new Map(),
  fuel: 0,
  cargo: {} as StoredShip['cargo'],
});

const meshesOf = (root: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o);
  });
  return out;
};

describe('ParkedShips', () => {
  it('parks the ships of this station only, at most four, in id order on their spots', () => {
    const parked = new ParkedShips(fakeLibrary());
    const fleet = [stored(2, 'home'), stored(3, 'other'), stored(4, 'home'), stored(5, 'home'), stored(6, 'home'), stored(7, 'home')];
    parked.sync(fleet, HOME);
    expect(parked.stats().ids).toEqual([2, 4, 5, 6]);
    parked.holders().forEach((h, i) => {
      // world z = −(yard y): every ship stands out on its spot's side, beyond the arm rails, on the deck
      const spot = PARKING_SPOTS[i]!;
      expect(Math.sign(-h.position.z)).toBe(Math.sign(spot.y));
      expect(Math.abs(h.position.z)).toBeGreaterThan(13.6);
      expect(h.position.y).toBeGreaterThan(BAY_DECK);
    });
    parked.sync(fleet, null);
    expect(parked.stats().ships).toBe(0);
    parked.dispose();
  });

  it('rebuilds only when the stored list changes, not every frame', () => {
    const parked = new ParkedShips(fakeLibrary());
    const a = stored(2, 'home');
    const b = stored(3, 'home');
    parked.sync([a, b], HOME);
    expect(parked.stats().builds).toBe(2);
    for (let i = 0; i < 10; i++) parked.sync([a, b], HOME);
    // a new list with the same ships (an immutable update elsewhere) builds nothing either
    parked.sync([{ ...a }, { ...b }], HOME);
    expect(parked.stats().builds).toBe(2);
    // a ship leaves: the other one keeps its model and moves to the first spot
    const kept = parked.holders()[1];
    parked.sync([b], HOME);
    expect(parked.stats().builds).toBe(2);
    expect(parked.holders()[0]).toBe(kept);
    // a different hull under the same id (switched away and back) is built again
    parked.sync([{ ...b, grid: createGrid([['cockpit', 0, 0]]) }], HOME);
    expect(parked.stats().builds).toBe(3);
    parked.dispose();
  });

  it('freezes each ship into one dimmed mesh per material, turrets and connectors included', () => {
    const parked = new ParkedShips(fakeLibrary());
    const grid = createGrid([['cockpit', 1, 0], ['cannon', 0, 0], ['cannon', 0, 1], ['armor', -1, 0]]);
    parked.sync([stored(2, 'home', grid)], HOME);
    expect(parked.stats().meshes).toBe(1);
    const meshes = meshesOf(parked.object);
    expect(meshes).toHaveLength(1);
    const m = meshes[0]!;
    expect(m.matrixAutoUpdate).toBe(false);
    const dimmed = m.material as MeshStandardMaterial;
    expect(dimmed).not.toBe(palette);
    expect(dimmed.color.r).toBeLessThan(palette.color.r);
    expect(dimmed.emissiveIntensity).toBeLessThan(palette.emissiveIntensity);
    // the same shader program as the part material: only uniforms differ
    expect(dimmed.type).toBe(palette.type);
    expect(dimmed.customProgramCacheKey()).toBe(palette.customProgramCacheKey());
    expect(dimmed.map).toBe(palette.map);
    parked.dispose();
  });

  it("wears the record's paint and rebuilds a ship that was repainted in place", () => {
    const parked = new ParkedShips(fakeLibrary());
    const a = stored(2, 'home');
    parked.sync([a], HOME);
    expect(parked.stats().builds).toBe(1);
    expect((meshesOf(parked.object)[0]!.material as MeshStandardMaterial).map).toBe(atlas);
    // the sim paints the record in place (no new StoredShip object)
    a.record.paint = 'navy';
    parked.sync([a], HOME);
    expect(parked.stats().builds).toBe(2);
    expect(parked.stats().meshes).toBe(1);
    const worn = meshesOf(parked.object)[0]!.material as MeshStandardMaterial;
    expect(worn.map).not.toBe(atlas);
    expect(worn.map?.flipY).toBe(false);
    parked.sync([a], HOME);
    expect(parked.stats().builds).toBe(2);
    parked.dispose();
  });

  it('frees what a parked ship owned when it leaves, never the shared part materials', () => {
    const parked = new ParkedShips(fakeLibrary());
    parked.sync([stored(2, 'home')], HOME);
    const m = meshesOf(parked.object)[0]!;
    const geometry = vi.spyOn(m.geometry, 'dispose');
    const material = vi.spyOn(m.material as MeshStandardMaterial, 'dispose');
    const shared = vi.spyOn(palette, 'dispose');
    parked.sync([], HOME);
    expect(geometry).toHaveBeenCalled();
    expect(material).toHaveBeenCalled();
    expect(shared).not.toHaveBeenCalled();
    expect(parked.object.children).toHaveLength(0);
    parked.dispose();
  });
});

describe('bakeStatic', () => {
  it('merges every visible mesh below the root, moving nodes and connector instances too, without hidden ones', () => {
    const root = new Group();
    root.position.set(5, 0, 0);
    const body = new Mesh(new BoxGeometry(1, 1, 1), palette);
    const turret = new Mesh(new BoxGeometry(0.3, 0.3, 0.3), palette);
    turret.name = 'Laser_Head';
    turret.position.y = 1;
    body.add(turret);
    const hidden = new Mesh(new BoxGeometry(1, 1, 1), palette);
    hidden.visible = false;
    const connectors = new InstancedMesh(new BoxGeometry(0.2, 0.2, 0.2), palette, 2);
    connectors.setMatrixAt(0, new Matrix4().makeTranslation(1, 0, 0));
    connectors.setMatrixAt(1, new Matrix4().makeTranslation(-1, 0, 0));
    const glass = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshStandardMaterial({ transparent: true, opacity: 0.5 }));
    root.add(body, hidden, connectors, glass);
    const baked = bakeStatic(root);
    expect(baked.batches).toHaveLength(1);
    // body + turret + 2 connector instances, 24 box vertices each; the hidden box is left out
    expect(baked.batches[0]!.geometry.getAttribute('position').count).toBe(96);
    // in the root's own frame (its position is not baked in)
    const box = baked.batches[0]!.geometry.boundingBox!;
    expect(box.min.x).toBeCloseTo(-1.1);
    expect(box.max.y).toBeCloseTo(1.15);
    expect(baked.loose).toHaveLength(1);
    expect(baked.loose[0]!.geometry).toBe(glass.geometry);
  });
});
