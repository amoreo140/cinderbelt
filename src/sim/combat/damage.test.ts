import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../Simulation';
import { createGrid } from '../ship/grid';
import { damageShip, rebuildShip, regenShield, splitGrid } from './damage';
import { cellOwners, raycastGrid } from './geometry';
import { combatShip } from './testing';

describe('damageShip', () => {
  it('drains the shield first, the overflow hits the part and the regen delay restarts', () => {
    const ship = combatShip(createGrid([['cockpit', 0, 0], ['shield', -1, 0], ['armor', 1, 0]]));
    ship.shield = 5;
    const r = damageShip(ship, 3, 8);
    expect(r).toEqual({ absorbed: 5, toHull: 3, destroyed: false });
    expect(ship.shield).toBe(0);
    expect(ship.hp.get(3)).toBe(37);
    expect(ship.shieldDelay).toBe(Math.round(3 / SIM_DT));
  });

  it('marks a part destroyed at zero HP', () => {
    const ship = combatShip(createGrid([['cockpit', 0, 0], ['armor', 1, 0]]));
    ship.hp.set(2, 4);
    expect(damageShip(ship, 2, 6)).toEqual({ absorbed: 0, toHull: 4, destroyed: true });
    expect(ship.hp.get(2)).toBe(0);
    // another hit on the destroyed part does nothing
    expect(damageShip(ship, 2, 6)).toEqual({ absorbed: 0, toHull: 0, destroyed: false });
  });

  it('only hits the shield when no part is given', () => {
    const ship = combatShip(createGrid([['cockpit', 0, 0], ['shield', 1, 0]]));
    expect(damageShip(ship, null, 10)).toEqual({ absorbed: 10, toHull: 0, destroyed: false });
    expect(ship.shield).toBe(50);
  });
});

describe('splitGrid', () => {
  //   y=1            A(4)
  //   y=0  E(2) C(1) A(3) W(5)
  const grid = createGrid([['cockpit', 0, 0], ['engine', -1, 0], ['armor', 1, 0], ['armor', 1, 1], ['cannon', 2, 0]]);

  it('removes destroyed parts and detaches what lost the connection to the cockpit', () => {
    const r = splitGrid(grid, new Set([3]));
    expect(r.cockpitLost).toBe(false);
    expect(r.removed.map((p) => p.id)).toEqual([3]);
    expect(r.remaining!.parts.map((p) => p.id)).toEqual([1, 2]);
    expect(r.remaining!.nextId).toBe(grid.nextId);
    // A(4) and W(5) no longer touch → two separate wrecks
    expect(r.detached.map((c) => c.map((p) => p.id).sort())).toEqual([[4], [5]]);
  });

  it('turns everything into wreck pieces when the cockpit is destroyed', () => {
    const r = splitGrid(grid, new Set([1]));
    expect(r.cockpitLost).toBe(true);
    expect(r.remaining).toBeNull();
    expect(r.detached.map((c) => c.map((p) => p.id).sort())).toEqual([[2], [3, 4, 5]]);
  });
});

describe('rebuildShip', () => {
  it('keeps the remaining parts in place in the world and drops state of removed parts', () => {
    const grid = createGrid([['cockpit', 0, 0], ['armor', 1, 0], ['cannon', 2, 0]]);
    const ship = combatShip(grid, { x: 100, y: 50 }, Math.PI / 2);
    ship.hp.set(3, 10);
    ship.cooldowns.set(3, 5);
    ship.energy = 15;
    // the cockpit lies −CoM.x ahead of the centre of mass; the ship points along +y
    const cockpitWorld = { x: ship.body.pos.x, y: ship.body.pos.y - ship.props.centerOfMass.x };
    const r = splitGrid(grid, new Set([2]));
    rebuildShip(ship, r.remaining!);
    expect(ship.grid.parts.map((p) => p.id)).toEqual([1]);
    expect(ship.gridVersion).toBe(1);
    expect(ship.props.centerOfMass).toEqual({ x: 0, y: 0 });
    expect(ship.body.pos.x).toBeCloseTo(cockpitWorld.x);
    expect(ship.body.pos.y).toBeCloseTo(cockpitWorld.y);
    expect(ship.prevBody.pos).toEqual(ship.body.pos);
    expect(ship.hp.has(3)).toBe(false);
    expect(ship.cooldowns.has(3)).toBe(false);
    expect(ship.energy).toBe(15);
  });

  it('never refills a drained shield or battery when the ship loses a part', () => {
    const grid = createGrid([['cockpit', 0, 0], ['shield', 0, 1], ['shield', 0, -1], ['armor', 1, 0]]);
    const ship = combatShip(grid);
    ship.shield = 7;
    ship.energy = 3;
    ship.shieldDelay = 42;
    rebuildShip(ship, splitGrid(grid, new Set([4])).remaining!);
    expect(ship.props.shield.capacity).toBe(120);
    expect(ship.shield).toBe(7);
    expect(ship.energy).toBe(3);
    expect(ship.shieldDelay).toBe(42);
  });

  it('clamps energy and shield to the new capacities', () => {
    const grid = createGrid([['cockpit', 0, 0], ['reactor', 1, 0], ['shield', 0, 1]]);
    const ship = combatShip(grid);
    rebuildShip(ship, splitGrid(grid, new Set([2, 3])).remaining!);
    expect(ship.energy).toBe(20);
    expect(ship.shield).toBe(0);
  });
});

describe('regenShield', () => {
  it('waits for the delay, then recharges for energy', () => {
    const ship = combatShip(createGrid([['cockpit', 0, 0], ['shield', 1, 0]]));
    ship.shield = 0;
    ship.shieldDelay = 2;
    regenShield(ship, SIM_DT);
    regenShield(ship, SIM_DT);
    expect(ship.shield).toBe(0);
    const energy = ship.energy;
    regenShield(ship, SIM_DT);
    expect(ship.shield).toBeCloseTo(10 * SIM_DT);
    expect(ship.energy).toBeCloseTo(energy - 10 * SIM_DT * 0.5);
  });

  it('recharges only as much as the battery allows and never above capacity', () => {
    const ship = combatShip(createGrid([['cockpit', 0, 0], ['shield', 1, 0]]));
    ship.shield = 59.99;
    regenShield(ship, SIM_DT);
    expect(ship.shield).toBe(60);
    ship.shield = 0;
    ship.energy = 0.01;
    regenShield(ship, SIM_DT);
    expect(ship.shield).toBeCloseTo(0.02);
    expect(ship.energy).toBeCloseTo(0);
  });
});

describe('multi-cell parts in combat', () => {
  it('the DDA hit returns the multi-cell part for any of its cells', () => {
    const grid = createGrid([['cockpit', 0, 0], ['largeCargo', 1, 0], ['heavyLaser', -1, 1, 1]]);
    const owners = cellOwners(grid);
    // shot from above into the top right corner of the cargo (2, 1)
    expect(raycastGrid(owners, { x: 2, y: 5 }, { x: 2, y: -5 })?.partId).toBe(2);
    // from the left into the top cell of the heavy laser (−1, 2)
    expect(raycastGrid(owners, { x: -5, y: 2 }, { x: 5, y: 2 })?.partId).toBe(3);
  });

  it('a destroyed 2x2 part detaches everything that hung only on it', () => {
    // cockpit (0,0) – cargo (1..2, 0..1) – armour (3, 1) – engine (3, 2)
    const grid = createGrid([['cockpit', 0, 0], ['largeCargo', 1, 0], ['armor', 3, 1], ['engine', 3, 2]]);
    const r = splitGrid(grid, new Set([2]));
    expect(r.removed.map((p) => p.id)).toEqual([2]);
    expect(r.detached.map((piece) => piece.map((p) => p.id))).toEqual([[3, 4]]);
    expect(r.remaining!.parts.map((p) => p.id)).toEqual([1]);
  });

  it('a rotated heavy laser keeps a part attached through its far cell', () => {
    const grid = createGrid([['cockpit', 0, 0], ['heavyLaser', 0, 1, 1], ['armor', 1, 2]]);
    const r = splitGrid(grid, new Set());
    expect(r.detached).toEqual([]);
    const lost = splitGrid(grid, new Set([2]));
    expect(lost.detached.map((piece) => piece.map((p) => p.id))).toEqual([[3]]);
  });
});
