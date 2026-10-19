// SL2 E2 S6b: "Build from template" with shaped armour.
import { describe, expect, it } from 'vitest';
import { emptyCargo } from '../../data/resources';
import { createGrid } from '../ship/grid';
import type { ShipGrid } from '../ship/types';
import { normalizeTemplate } from '../templates/normalize';
import type { ShipTemplate } from '../templates/types';
import { evaluateDesign } from './design';
import { replayOps } from './editor';
import { templateOps } from './template';

const tpl = (grid: ShipGrid): ShipTemplate => ({ name: 'T', parts: normalizeTemplate(grid)! });
function apply(grid: ShipGrid, ops: Parameters<typeof replayOps>[1]): ShipGrid {
  const r = replayOps(grid, ops);
  if (!r.ok) throw new Error(`op ${r.index} failed: ${r.error}`);
  return r.grid;
}

describe('templateOps with shapes', () => {
  it('the same layout with full plates → remove + place in the shapes (no reshape ops), the cost is the installations only', () => {
    const ship = createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ['armor', 1, 0], ['armor', 0, 1]]);
    const shapedShip = createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ['armor', 1, 0, 3, 1, 'wedge'], ['armor', 0, 1, 3, 1, 'wedge']]);
    const plan = templateOps(ship, new Map(), tpl(shapedShip));
    expect(plan.ops).toEqual([
      { op: 'remove', id: 3 },
      { op: 'remove', id: 4 },
      { op: 'place', key: 'armor:1', x: 0, y: 1, rot: 3, shape: 'wedge' },
      { op: 'place', key: 'armor:1', x: 1, y: 0, rot: 3, shape: 'wedge' },
    ]);
    expect(plan).toMatchObject({ kept: 2, moved: 0, removed: { 'armor:1': 2 }, placed: { 'armor:1': 2 }, unplaced: 0 });
    const result = apply(ship, plan.ops);
    expect(normalizeTemplate(result)).toEqual(tpl(shapedShip).parts);
    // the plates taken off are the plates laid again: two installations, nothing bought or stored
    const report = evaluateDesign(
      { base: { grid: ship, hp: new Map(), inventory: {} }, grid: result, acquire: {} },
      { ring: 1, services: { crafting: true, partsMarket: true }, credits: 1000, storage: emptyCargo(), cargo: emptyCargo(), fuel: 0 },
    );
    expect(report.cost).toMatchObject({ credits: 20, installCount: 2, toStorage: {}, fromStorage: {}, craft: {}, buy: {} });
  });

  it('keeps a part in the same shape and place, and moves only parts with the same shape', () => {
    // same cells and rotations, only the shapes differ: a match by key and place alone would keep both
    const ship = createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ['armor', 1, 0], ['armor', 0, 1, 0, 1, 'wedge'], ['armor', 0, -1, 0, 1, 'chamfer']]);
    const template = createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ['armor', 1, 0, 0, 1, 'wedge'], ['armor', 0, 1], ['armor', 0, -1, 0, 1, 'chamfer']]);
    const plan = templateOps(ship, new Map(), tpl(template));
    // the chamfer stays, the plate and the wedge trade places in one group move (shapes untouched)
    expect(plan.ops).toEqual([{ op: 'moveGroup', moves: [{ id: 3, x: 0, y: 1, rot: 0 }, { id: 4, x: 1, y: 0, rot: 0 }] }]);
    expect(plan).toMatchObject({ kept: 3, moved: 2, removed: {}, placed: {}, unplaced: 0 });
    expect(normalizeTemplate(apply(ship, plan.ops))).toEqual(tpl(template).parts);
  });

  it('a part of the right key but another shape is not moved into a shaped place', () => {
    const ship = createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ['armor', 0, 1]]);
    const template = createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ['armor', 1, 0, 3, 1, 'wingR']]);
    const plan = templateOps(ship, new Map(), tpl(template));
    expect(plan.ops).toEqual([{ op: 'remove', id: 3 }, { op: 'place', key: 'armor:1', x: 1, y: 0, rot: 3, shape: 'wingR' }]);
    expect(plan.moved).toBe(0);
    expect(normalizeTemplate(apply(ship, plan.ops))).toEqual(tpl(template).parts);
  });
});
