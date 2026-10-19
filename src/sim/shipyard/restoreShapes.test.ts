// SL2 E2 S6b: "Restore to design" with shaped armour.
import { describe, expect, it } from 'vitest';
import { partKey } from '../../data/parts';
import { createGrid } from '../ship/grid';
import { shaped } from '../ship/testing';
import type { ShipGrid } from '../ship/types';
import { replayOps } from './editor';
import { restoreOps } from './restore';

const without = (grid: ShipGrid, ...ids: number[]): ShipGrid => ({ nextId: grid.nextId, parts: grid.parts.filter((p) => !ids.includes(p.id)) });
/** Layout without ids, shapes included. */
const layout = (grid: ShipGrid) =>
  grid.parts.map((p) => `${partKey(p.partId, p.tier, p.variant)}@${p.x},${p.y},${p.rot}${p.shape ? `/${p.shape}` : ''}`).sort();
function replayed(grid: ShipGrid, ops: Parameters<typeof replayOps>[1]): ShipGrid {
  const r = replayOps(grid, ops);
  if (!r.ok) throw new Error(`op ${r.index} failed: ${r.error}`);
  return r.grid;
}

/** Cockpit, engine, a port wing (id 3, two cells) in front and a wedge (id 4) beside the cockpit. */
const blueprint = (): ShipGrid =>
  createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ['armor', 1, 0, 0, 1, 'wingL'], ['armor', 0, 1, 3, 2, 'wedge']]);

describe('restoreOps with shapes', () => {
  it('an intact shaped ship needs nothing', () => {
    const grid = blueprint();
    expect(restoreOps(grid, new Map(), grid)).toEqual({ ops: [], missing: 0, repaired: 0, unplaced: 0 });
  });

  it('puts a lost wing back in its shape', () => {
    const bp = blueprint();
    const r = restoreOps(without(bp, 3), new Map(), bp);
    expect(r).toMatchObject({ missing: 1, repaired: 0, unplaced: 0 });
    expect(r.ops).toEqual([{ op: 'place', key: 'armor:1', x: 1, y: 0, rot: 0, shape: 'wingL' }]);
    expect(layout(replayed(without(bp, 3), r.ops))).toEqual(layout(bp));
  });

  it('a part in another shape than the blueprint is taken off and laid again', () => {
    const bp = blueprint();
    const ship = shaped(bp, 4, null);
    const r = restoreOps(ship, new Map(), bp);
    expect(r.ops).toEqual([{ op: 'remove', id: 4 }, { op: 'place', key: 'armor:2', x: 0, y: 1, rot: 3, shape: 'wedge' }]);
    expect(layout(replayed(ship, r.ops))).toEqual(layout(bp));
  });

  it('a damaged shaped part is swapped for a new one in the same shape', () => {
    const bp = blueprint();
    const r = restoreOps(bp, new Map([[4, 5]]), bp);
    expect(r).toMatchObject({ missing: 0, repaired: 1, unplaced: 0 });
    expect(r.ops).toEqual([{ op: 'remove', id: 4 }, { op: 'place', key: 'armor:2', x: 0, y: 1, rot: 3, shape: 'wedge' }]);
    // a T2 wedge's full HP is 70 × 0.5 = 35 – an entry at that value is no damage
    expect(restoreOps(bp, new Map([[4, 35]]), bp).ops).toEqual([]);
  });
});
