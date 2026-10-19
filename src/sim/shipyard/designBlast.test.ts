// M4c T10: the CHECK warning "explosive part next to the cockpit" (M4c plan
// §2.4, design guidance: keep explosive parts away from the cockpit). Non-blocking; adjacency = the blast's own
// 8-neighbourhood (`blastNeighbours`).
import { describe, expect, it } from 'vitest';
import type { PartId, Tier } from '../../data/parts';
import { emptyCargo } from '../../data/resources';
import { createGrid } from '../ship/grid';
import type { Rotation, ShipGrid } from '../ship/types';
import { evaluateDesign, explosivesNearCockpit, type DesignInput, type ShipyardContext } from './design';

const ctx: ShipyardContext = {
  ring: 1,
  services: { crafting: true, partsMarket: true },
  credits: 1_000_000,
  storage: emptyCargo(),
  cargo: emptyCargo(),
  fuel: 0,
};
const asIs = (grid: ShipGrid): DesignInput => ({ base: { grid, hp: new Map(), inventory: {} }, grid, acquire: {} });
type Entry = [PartId, number, number, Rotation?, Tier?];

/** Cockpit at (0,0), a forward engine behind it, plus `extra`. */
const ship = (...extra: Entry[]): ShipGrid => createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ...extra]);
const warnings = (grid: ShipGrid) => evaluateDesign(asIs(grid), ctx).warnings.filter((w) => w.code === 'explosiveNearCockpit');

describe('explosiveNearCockpit', () => {
  it('a large reactor sharing an edge with the cockpit warns, naming the reactor', () => {
    // reactor cells (1,0) (2,0) (1,1) (2,1) – (1,0) touches the cockpit
    const grid = ship(['largeReactor', 1, 0]);
    expect(warnings(grid)).toEqual([{ code: 'explosiveNearCockpit', partId: 3, key: 'largeReactor:1', damage: 40 }]);
  });

  it('diagonal contact counts (the blast reaches 8-adjacent cells)', () => {
    // reactor cells (1,1) (2,1) (1,2) (2,2) – only (1,1) is diagonal to the cockpit; an armour links it
    const grid = ship(['armor', 0, 1], ['largeReactor', 1, 1]);
    expect(explosivesNearCockpit(grid)).toEqual([{ code: 'explosiveNearCockpit', partId: 4, key: 'largeReactor:1', damage: 40 }]);
  });

  it('one cell of space clears the warning', () => {
    const grid = ship(['armor', 1, 0], ['largeReactor', 2, 0]);
    expect(warnings(grid)).toEqual([]);
  });

  it('moving the reactor next to the cockpit brings it back, moving it away removes it', () => {
    // (0,2)…(1,3) is two cells from the cockpit, behind an armour plate
    const far = ship(['armor', 0, 1], ['largeReactor', 0, 2]);
    expect(warnings(far)).toEqual([]);
    // the same reactor one cell closer (the plate moved behind it)
    const moved = ship(['armor', 0, 3], ['largeReactor', 0, 1]);
    expect(warnings(moved)).toEqual([{ code: 'explosiveNearCockpit', partId: 4, key: 'largeReactor:1', damage: 40 }]);
  });

  it('rotation follows the footprint: a 2×2 reactor keeps its cells, so the warning stays', () => {
    for (const rot of [0, 1, 2, 3] as const) {
      expect(warnings(ship(['largeReactor', 1, 0, rot])).length, `rot ${rot}`).toBe(1);
      expect(warnings(ship(['armor', 1, 0], ['largeReactor', 2, 0, rot])).length, `rot ${rot}`).toBe(0);
    }
  });

  it('small reactors and other parts never warn; each explosive part warns once', () => {
    expect(warnings(ship(['reactor', 1, 0], ['fuelTank', 0, 1], ['refinery', 0, -1]))).toEqual([]);
    // the second one sits diagonally behind the cockpit, beside the engine
    const two = ship(['largeReactor', 1, 0], ['largeReactor', -2, -2]);
    expect(warnings(two).map((w) => w.partId)).toEqual([3, 4]);
  });

  it('names the blast damage of the tier', () => {
    expect(warnings(ship(['largeReactor', 1, 0, 0, 2]))).toEqual([{ code: 'explosiveNearCockpit', partId: 3, key: 'largeReactor:2', damage: 50 }]);
  });

  it('does not block the commit', () => {
    const r = evaluateDesign(asIs(ship(['largeReactor', 1, 0])), ctx);
    expect(r.errors.map((e) => e.code)).not.toContain('explosiveNearCockpit');
    expect(r.warnings.map((w) => w.code)).toContain('explosiveNearCockpit');
  });

  it('a grid without a cockpit has no warning (the noCockpit error says enough)', () => {
    expect(explosivesNearCockpit(createGrid([['largeReactor', 0, 0], ['armor', 2, 0]]))).toEqual([]);
  });
});
