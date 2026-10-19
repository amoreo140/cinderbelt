import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Quaternion, Texture } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { PartId } from '../../data/parts';
import { createGrid } from '../../sim/ship/grid';
import { computeProperties } from '../../sim/ship/properties';
import type { ModelLibrary } from '../assets/ModelLibrary';
import { ShipView } from '../ShipView';
import { approach, armYaw, blastShake, CRUSHER_RAMP, CRUSHER_SPIN, plasmaSpeed, PLASMA_IDLE, PLASMA_LOADED, turnToward, workshopLoad } from './workshopAnim';

// sprites and decals load their textures through TextureLoader (no DOM in the unit tests)
vi.mock('../fx/textures', () => ({ vfxTexture: () => new Texture() }));

describe('workshop animation helpers', () => {
  it('approach ramps linearly and lands on the target', () => {
    // spin-up takes CRUSHER_RAMP seconds
    let v = 0;
    for (let i = 0; i < 29; i++) v = approach(v, CRUSHER_SPIN, CRUSHER_SPIN / CRUSHER_RAMP, 1 / 60);
    expect(v).toBeLessThan(CRUSHER_SPIN);
    v = approach(v, CRUSHER_SPIN, CRUSHER_SPIN / CRUSHER_RAMP, 1 / 60);
    expect(v).toBeCloseTo(CRUSHER_SPIN, 9);
    expect(approach(1, 0, 10, 0.05)).toBeCloseTo(0.5, 9);
    expect(approach(0.2, 0, 10, 0.05)).toBe(0);
  });

  it('workshop load: refining half, each repair a quarter, capped at 1', () => {
    expect(workshopLoad(null)).toBe(0);
    expect(workshopLoad({ refining: null, repairing: [] })).toBe(0);
    expect(workshopLoad({ refining: 'fuel', repairing: [] })).toBe(0.5);
    expect(workshopLoad({ refining: null, repairing: [{ module: 1, target: 2 }] })).toBe(0.25);
    expect(workshopLoad({ refining: 'ore', repairing: [{ module: 1, target: 2 }, { module: 3, target: 2 }, { module: 4, target: 2 }] })).toBe(1);
    expect(plasmaSpeed(0)).toBe(PLASMA_IDLE);
    expect(plasmaSpeed(1)).toBe(PLASMA_LOADED);
    expect(plasmaSpeed(5)).toBe(PLASMA_LOADED);
  });

  it('armYaw points the rest direction (+X) at the target in the module frame', () => {
    // hull frame: three.js x = sim x, z = −sim y
    expect(armYaw(0, 0, 0, 1, 0)).toBeCloseTo(0, 9);
    expect(armYaw(0, 0, 0, 0, -1)).toBeCloseTo(Math.PI / 2, 9); // sim +y
    expect(Math.abs(armYaw(0, 0, 0, -1, 0))).toBeCloseTo(Math.PI, 9);
    // a module turned a quarter (rot 1) sees a target at +x on its right
    expect(armYaw(0, 0, Math.PI / 2, 1, 0)).toBeCloseTo(-Math.PI / 2, 9);
    expect(armYaw(2, 3, Math.PI / 2, 2, 2)).toBeCloseTo(0, 9);
    expect(armYaw(1, 1, 0, 1, 1)).toBe(0);
  });

  it('turnToward takes the shorter way at a capped speed', () => {
    expect(turnToward(0, 1, 2, 0.25)).toBeCloseTo(0.5, 9);
    expect(turnToward(0, 0.1, 2, 0.25)).toBe(0.1);
    // 3 → −3 goes over π, not back through 0
    expect(turnToward(3, -3, 1, 0.1)).toBeCloseTo(3.1, 9);
  });

  it('blast shake: hard on board, gone at 60 u', () => {
    expect(blastShake(0)).toBeCloseTo(0.95, 9);
    expect(blastShake(30)).toBeCloseTo(0.475, 9);
    expect(blastShake(60)).toBe(0);
    expect(blastShake(200)).toBe(0);
  });
});

const atlas = new Texture();
const palette = () => new MeshStandardMaterial({ map: atlas, emissiveMap: atlas, roughness: 0.6 });

/** Part models like the GLBs (art/README §2.3): a static body, the workshop parts with their moving node. */
function fakeLibrary(): ModelLibrary {
  const body = (name: string, child?: Object3D) => {
    const root = new Group();
    const mesh = new Mesh(new BoxGeometry(0.9, 0.5, 0.9), palette());
    mesh.name = name;
    if (child) mesh.add(child);
    root.add(mesh);
    return root;
  };
  const moving = (name: string, y: number) => {
    const m = new Mesh(new BoxGeometry(0.3, 0.2, 0.3), palette());
    m.name = name;
    m.position.y = y;
    return m;
  };
  const arm = moving('Repair_Arm', 0.26);
  const tip = new Object3D();
  tip.name = 'Repair_Tip';
  tip.position.set(0.335, 0.11, 0);
  arm.add(tip);
  const crusher = moving('Refinery_Crusher', 0.36);
  crusher.position.x = -0.62;
  const templates: Partial<Record<PartId, Group>> = {
    refinery: body('Refinery_Iron', crusher),
    largeReactor: body('LargeReactor_Iron', moving('Reactor_Plasma', 0.46)),
    repairModule: body('RepairModule_Iron', arm),
  };
  const plain = body('Body');
  const none = () => null;
  return { part: (id: PartId) => templates[id] ?? plain, connector: none, clans: { part: none, connector: none } } as unknown as ModelLibrary;
}

const meshes = (root: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh && o.visible) out.push(o);
  });
  return out;
};

describe('WorkshopRig in a ShipView', () => {
  // cockpit 1, repair module 2 with the armour 3 east of it, refinery 4, large reactor 5
  const grid = createGrid([
    ['cockpit', 0, 0],
    ['repairModule', 0, 1],
    ['armor', 1, 1],
    ['refinery', -2, 0],
    ['largeReactor', 0, 3],
  ]);
  const props = computeProperties(grid);
  const frames = (view: ShipView, n: number) => {
    for (let i = 0; i < n; i++) view.update(1 / 60, { x: 0, y: 0 }, props, null);
  };
  const node = (view: ShipView, name: string) => view.group.getObjectByName(name)!;

  it('keeps exactly the three moving nodes out of the hull batch (+1 mesh each, like a gyro ring)', () => {
    const view = new ShipView(grid, props, fakeLibrary());
    frames(view, 1);
    const names = meshes(view.group).map((m) => m.name).sort();
    expect(view.batchCount).toBe(1);
    expect(names).toEqual(['Reactor_Plasma', 'Refinery_Crusher', 'Repair_Arm', 'ship-batch']);
    // five bodies merged (5 × 24 box vertices) – the moving nodes are not in the batch
    expect(meshes(view.group).find((m) => m.name === 'ship-batch')!.geometry.getAttribute('position').count).toBe(120);
    view.dispose();
  });

  it('idle: the plasma spins, the crusher and the arm rest, nothing is welded', () => {
    const view = new ShipView(grid, props, fakeLibrary());
    frames(view, 1);
    const plasma = node(view, 'Reactor_Plasma').quaternion.clone();
    const crusher = node(view, 'Refinery_Crusher').quaternion.clone();
    const arm = node(view, 'Repair_Arm').quaternion.clone();
    frames(view, 30);
    expect(node(view, 'Reactor_Plasma').quaternion.angleTo(plasma)).toBeGreaterThan(0.5);
    expect(node(view, 'Refinery_Crusher').quaternion.angleTo(crusher)).toBe(0);
    expect(node(view, 'Repair_Arm').quaternion.angleTo(arm)).toBe(0);
    expect(view.group.getObjectByName('workshop-weld')).toBeUndefined();
    view.dispose();
  });

  it('refining spins the crusher up; it spins down after', () => {
    const view = new ShipView(grid, props, fakeLibrary());
    view.setWorkshop({ refining: 'ore', repairing: [] });
    frames(view, 60);
    const q = node(view, 'Refinery_Crusher').quaternion.clone();
    frames(view, 2);
    // full speed: 2 frames × CRUSHER_SPIN / 60
    expect(node(view, 'Refinery_Crusher').quaternion.angleTo(q)).toBeCloseTo((2 * CRUSHER_SPIN) / 60, 3);
    view.setWorkshop(null);
    frames(view, 40);
    const stopped = node(view, 'Refinery_Crusher').quaternion.clone();
    frames(view, 5);
    expect(node(view, 'Refinery_Crusher').quaternion.angleTo(stopped)).toBe(0);
    view.dispose();
  });

  it('repairing swings the arm to the target and welds with one sprite batch', () => {
    const view = new ShipView(grid, props, fakeLibrary());
    frames(view, 1);
    const rest = node(view, 'Repair_Arm').quaternion.clone();
    // the armour (id 3) is at +x of the module (id 2): the arm's rest direction already points there
    view.setWorkshop({ refining: null, repairing: [{ module: 2, target: 3 }] });
    frames(view, 20);
    expect(node(view, 'Repair_Arm').quaternion.angleTo(rest)).toBeLessThan(1e-6);
    const welds = view.group.getObjectByName('workshop-weld') as Mesh | undefined;
    expect(welds).toBeDefined();
    expect(welds!.visible).toBe(true);
    // the cockpit (id 1) is south of the module (sim −y = three.js +z): the arm turns −90°
    view.setWorkshop({ refining: null, repairing: [{ module: 2, target: 1 }] });
    frames(view, 60);
    const want = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 } as never, -Math.PI / 2);
    expect(node(view, 'Repair_Arm').quaternion.angleTo(want)).toBeLessThan(1e-6);
    // one sprite batch for all repair modules of the ship, gone with the view
    expect(meshes(view.group).filter((m) => m.name === 'workshop-weld')).toHaveLength(1);
    view.setWorkshop(null);
    frames(view, 60);
    expect(welds!.visible).toBe(false);
    view.dispose();
    expect(view.group.getObjectByName('workshop-weld')).toBeUndefined();
  });
});
