import { describe, expect, it } from 'vitest';
import { partKey } from '../../data/parts';
import { createGrid } from '../ship/grid';
import { createStarterShip } from '../ship/presets';
import type { ShipGrid } from '../ship/types';
import { replayOps } from './editor';
import { restoreOps } from './restore';

const without = (grid: ShipGrid, ...ids: number[]): ShipGrid => ({ nextId: grid.nextId, parts: grid.parts.filter((p) => !ids.includes(p.id)) });
const idAt = (grid: ShipGrid, x: number, y: number) => grid.parts.find((p) => p.x === x && p.y === y)!.id;
/** Layout without ids – what the restored ship looks like. */
const layout = (grid: ShipGrid) =>
  grid.parts.map((p) => `${partKey(p.partId, p.tier, p.variant)}@${p.x},${p.y},${p.rot}`).sort();

describe('restoreOps', () => {
  it('does nothing for an intact ship', () => {
    const grid = createStarterShip();
    expect(restoreOps(grid, new Map(), grid)).toEqual({ ops: [], missing: 0, repaired: 0, unplaced: 0 });
  });

  it('puts lost parts back where the blueprint has them', () => {
    const blueprint = createStarterShip();
    const ship = without(blueprint, idAt(blueprint, 0, 2), idAt(blueprint, 1, -1));
    const r = restoreOps(ship, new Map(), blueprint);
    expect(r).toMatchObject({ missing: 2, repaired: 0, unplaced: 0 });
    const replay = replayOps(ship, r.ops);
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(layout(replay.grid)).toEqual(layout(blueprint));
  });

  it('places a lost chain of parts from the hull outwards (each one needs a neighbour)', () => {
    // a cockpit with a tail of three armor plates – the outer two are only reachable through the first
    const blueprint = createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ['armor', 1, 0], ['armor', 2, 0], ['armor', 3, 0]]);
    const ship = without(blueprint, idAt(blueprint, 1, 0), idAt(blueprint, 2, 0), idAt(blueprint, 3, 0));
    // blueprint order is inner → outer, so reverse it to prove the order does not matter
    const reversed: ShipGrid = { ...blueprint, parts: [...blueprint.parts].reverse() };
    const r = restoreOps(ship, new Map(), reversed);
    expect(r).toMatchObject({ missing: 3, unplaced: 0 });
    const replay = replayOps(ship, r.ops);
    expect(replay.ok && layout(replay.grid)).toEqual(layout(blueprint));
  });

  it('repairs damaged parts by swapping them for a new one in the same place', () => {
    const blueprint = createStarterShip();
    const gyro = idAt(blueprint, 0, 0);
    const r = restoreOps(blueprint, new Map([[gyro, 5]]), blueprint);
    expect(r).toMatchObject({ missing: 0, repaired: 1 });
    expect(r.ops[0]).toEqual({ op: 'remove', id: gyro });
    expect(r.ops[1]).toEqual({ op: 'place', key: 'gyro:1', x: 0, y: 0, rot: 0 });
    const replay = replayOps(blueprint, r.ops);
    expect(replay.ok && layout(replay.grid)).toEqual(layout(blueprint));
  });

  it('can leave damaged parts alone', () => {
    const blueprint = createStarterShip();
    const ship = without(blueprint, idAt(blueprint, 0, 2));
    const r = restoreOps(ship, new Map([[idAt(blueprint, 0, 0), 5]]), blueprint, { repair: false });
    expect(r).toMatchObject({ missing: 1, repaired: 0 });
    expect(r.ops).toHaveLength(1);
  });

  it('rebuilds the blueprint layout over an unrelated ship', () => {
    const blueprint = createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ['armor', 1, 0]]);
    const other = createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ['cargo', 0, 1]]);
    const r = restoreOps(other, new Map(), blueprint);
    const replay = replayOps(other, r.ops);
    expect(replay.ok && layout(replay.grid)).toEqual(layout(blueprint));
  });
});
