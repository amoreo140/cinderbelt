// SL2 E1 T6: CombatLayer routes enemy and wreck rebuilds through the rebuild queue (one per frame,
// nearest first, the old view until its turn), builds them with torn-edge memory, and feeds the
// enemies' nav lights to the renderer.
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Texture } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { partDef, type PartId } from '../../data/parts';
import { makeDormant } from '../../sim/combat/ai';
import { createEnemy } from '../../sim/combat/enemies';
import { createWreck, emptyLoot } from '../../sim/combat/wrecks';
import type { Enemy, Wreck } from '../../sim/combat/types';
import { createStarterShip } from '../../sim/ship/presets';
import { computeProperties } from '../../sim/ship/properties';
import type { SimState } from '../../sim/Simulation';
import type { ModelLibrary } from '../assets/ModelLibrary';
import { SETTLE_FRAMES } from '../sites/wreckBatch';
import { CombatLayer } from './CombatLayer';

// effects load their textures through TextureLoader, liveries their atlases (no DOM in the unit tests)
vi.mock('../fx/textures', () => ({ vfxTexture: () => new Texture() }));
vi.mock('./livery', () => ({
  applyLivery: () => {},
  applyDerelict: () => {},
  preloadDerelictLivery: () => {},
  disposeLiveries: () => {},
}));

// the effect models (debris GLBs) cannot load without a server – their warnings are noise here
vi.spyOn(console, 'warn').mockImplementation(() => {});

const atlas = new Texture();
function palette(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ map: atlas, emissiveMap: atlas });
  m.name = 'AF_Palette';
  return m;
}

/** A model library like the GLBs: one palette box per part, a swatch table, every clan set ready. */
function fakeLibrary(): ModelLibrary {
  const parts = new Map<PartId, Object3D>();
  const part = (id: PartId): Object3D => {
    let t = parts.get(id);
    if (!t) {
      const size = partDef(id, 1).size;
      t = new Group();
      t.add(new Mesh(new BoxGeometry(size.w * 0.94, 0.4, size.h * 0.94), palette()));
      parts.set(id, t);
    }
    return t;
  };
  const connector = new Group().add(new Mesh(new BoxGeometry(0.12, 0.3, 0.12), palette()));
  return {
    part,
    connector: () => connector,
    clans: { part: () => null, connector: () => null, ready: () => true, ensure: () => Promise.resolve() },
    swatchUv: (key: string) => [0.25 + (key.length % 7) / 20, 0.5] as const,
    hasSwatches: true,
  } as unknown as ModelLibrary;
}

function state(enemies: Enemy[], wrecks: Wreck[] = []): SimState {
  return {
    seed: 7,
    tick: 1,
    player: { destroyed: false, tractor: null, props: { shield: { capacity: 0 } } },
    combat: { enemies, wrecks, projectiles: [] },
    guild: { watch: [] },
    convoys: { escorts: new Map() },
  } as unknown as SimState;
}

const pirate = (id: string, x: number): Enemy => createEnemy({ id, kind: 'jackal', tier: 1, pos: { x, y: 0 }, angle: 0, home: { x, y: 0 }, orbit: 1 });

/** Shoots off the pirate's last part that is not the cockpit (what the sim's damage does to the render state). */
function shootOff(e: Enemy): void {
  const victim = [...e.grid.parts].reverse().find((p) => p.partId !== 'cockpit')!;
  e.grid = { parts: e.grid.parts.filter((p) => p !== victim), nextId: e.grid.nextId };
  e.props = computeProperties(e.grid);
  e.gridVersion++;
}

const frame = (layer: CombatLayer, s: SimState) => layer.update(s, 1, 1 / 60, { pos: { x: 0, y: 0 }, angle: 0 });
const ship = (layer: CombatLayer, id: string) => layer.stats().ships.find((s) => s.id === id)!;

describe('CombatLayer rebuilds through the queue (hull shell, T6)', () => {
  it('rebuilds at most one enemy per frame, nearest first, keeping the old view until then', () => {
    const layer = new CombatLayer(fakeLibrary());
    const far = pirate('pr:far', 60);
    const near = pirate('pr:near', 15);
    const mid = pirate('pr:mid', 30);
    const s = state([far, near, mid]);
    frame(layer, s);
    expect(layer.stats().enemies).toBe(3);
    for (const id of ['pr:far', 'pr:near', 'pr:mid']) expect(ship(layer, id).shell.tornEdges).toBe(0);

    const done0 = layer.stats().rebuildsDone;
    for (const e of [far, near, mid]) shootOff(e);
    frame(layer, s);
    // one rebuild this frame (the nearest); the others keep their old hulls
    expect(layer.stats().rebuildsDone - done0).toBe(1);
    expect(layer.stats().rebuildsPending).toBe(2);
    const torn = () => ['pr:near', 'pr:mid', 'pr:far'].map((id) => ship(layer, id).shell.tornEdges > 0);
    expect(torn()).toEqual([true, false, false]);
    frame(layer, s);
    expect(torn()).toEqual([true, true, false]);
    frame(layer, s);
    expect(torn()).toEqual([true, true, true]);
    expect(layer.stats().rebuildsPending).toBe(0);
    layer.dispose();
  });

  it('coalesces a second hit on a waiting pirate into its one rebuild with the latest grid', () => {
    const layer = new CombatLayer(fakeLibrary());
    const near = pirate('pr:near', 10);
    const far = pirate('pr:far', 40);
    const s = state([near, far]);
    frame(layer, s);
    const done0 = layer.stats().rebuildsDone;
    shootOff(near);
    shootOff(far);
    frame(layer, s);
    // the near one goes first; the far one is hit again while it waits
    expect(layer.stats().rebuildsDone - done0).toBe(1);
    shootOff(far);
    frame(layer, s);
    expect(layer.stats().rebuildsDone - done0).toBe(2);
    expect(layer.stats().rebuildsPending).toBe(0);
    frame(layer, s);
    expect(layer.stats().rebuildsDone - done0).toBe(2);
    // built from the latest grid: two parts gone
    const torn = ship(layer, 'pr:far').shell.tornEdges;
    const once = ship(layer, 'pr:near').shell.tornEdges;
    expect(torn).toBeGreaterThan(once);
    layer.dispose();
  });

  it('feeds the enemies nav lights (none for wrecks) and drops them with the ship', () => {
    const layer = new CombatLayer(fakeLibrary());
    const a = pirate('pr:a', 10);
    const b = pirate('pr:b', 20);
    const s = state([a, b]);
    frame(layer, s);
    expect(layer.navShips).toHaveLength(2);
    for (const n of layer.navShips) {
      expect(n.pirate).toBe(true);
      expect(n.visible).toBe(true);
      expect(n.points.length).toBeGreaterThan(0);
    }
    // b dies: a wreck of it appears (torn where it parted) and its lights go
    const parts = b.grid.parts.slice(0, 3);
    const w = createWreck(-1, parts, b, { vel: { x: 0, y: 0 }, angVel: 0 }, emptyLoot(), 'pirate');
    s.combat.enemies = [a];
    s.combat.wrecks = [w];
    frame(layer, s);
    expect(layer.navShips).toHaveLength(1);
    expect(layer.navShips[0]!.object).not.toBeUndefined();
    const wreck = layer.stats().ships.find((x) => x.wreck)!;
    expect(wreck.navPoints).toBe(0);
    expect(wreck.shell.tornEdges).toBeGreaterThan(0);
    // a wreck that lay there already (a graveyard next to a sleeper) is not torn by its neighbour
    const other = createStarterShip();
    const lying = createWreck(-3, other.parts.slice(0, 4), { body: a.body, props: computeProperties(other) }, { vel: { x: 0, y: 0 }, angVel: 0 }, emptyLoot(), 'pirate');
    s.combat.wrecks = [w, lying];
    frame(layer, s);
    expect(ship(layer, 'wreck#-3').shell.tornEdges).toBe(0);
    layer.dispose();
    expect(layer.navShips).toHaveLength(0);
  });

  it('queues a wreck cut like an enemy hit', () => {
    const layer = new CombatLayer(fakeLibrary());
    const src = pirate('pr:src', 10);
    const w = createWreck(-2, src.grid.parts, src, { vel: { x: 0, y: 0 }, angVel: 0 }, emptyLoot(), 'pirate');
    const s = state([], [w]);
    frame(layer, s);
    expect(ship(layer, 'wreck#-2').shell.tornEdges).toBe(0);
    const cut = { ...w, grid: { parts: w.grid.parts.slice(0, -1), nextId: w.grid.nextId } };
    cut.props = computeProperties(cut.grid);
    s.combat.wrecks = [cut];
    frame(layer, s);
    expect(layer.stats().rebuildsPending).toBe(0);
    expect(ship(layer, 'wreck#-2').shell.tornEdges).toBeGreaterThan(0);
    layer.dispose();
  });

  it('bakes a dormant sleeper lying still into the static batch and takes it out the frame it wakes', () => {
    const layer = new CombatLayer(fakeLibrary());
    const sleeper = makeDormant(pirate('gs:-1,2:0', 30));
    const s = state([sleeper]);
    frame(layer, s);
    const view = layer.object.children.find((o) => o.position.x === 30)!;
    expect(view).toBeDefined();
    for (let i = 0; i < SETTLE_FRAMES; i++) frame(layer, s);
    expect(layer.stats().batchedWrecks).toBe(1);
    expect(view.parent).toBeNull();
    // woken: out of the batch, the live view back in the layer (rebuilt in its pirate dress)
    sleeper.ai.mode = 'attack';
    frame(layer, s);
    expect(layer.stats().batchedWrecks).toBe(0);
    expect(view.parent).toBe(layer.object);
    expect(view.visible).toBe(true);
    // an awake ship is never baked in, however still it lies
    for (let i = 0; i < SETTLE_FRAMES + 2; i++) frame(layer, s);
    expect(layer.stats().batchedWrecks).toBe(0);
    layer.dispose();
  });

  it('drops a batched sleeper that leaves the sim', () => {
    const layer = new CombatLayer(fakeLibrary());
    const s = state([makeDormant(pirate('gs:-1,2:1', 30))]);
    for (let i = 0; i < SETTLE_FRAMES + 1; i++) frame(layer, s);
    expect(layer.stats().batchedWrecks).toBe(1);
    s.combat.enemies = [];
    frame(layer, s);
    expect(layer.stats().batchedWrecks).toBe(0);
    expect(layer.stats().enemies).toBe(0);
    layer.dispose();
  });
});
