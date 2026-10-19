import { describe, expect, it } from 'vitest';
import { COCKPIT_HULL_BUDGET } from '../../data/parts';
import { SHAPES, SHAPE_IDS } from '../../data/shapes';
import { createGrid } from './grid';
import { hullBudgetOf, hullPoints, partHullPoints, sizeHullPoints } from './budget';
import { createStarterShip } from './presets';
import { shapeHullPoints } from './shape';
import { halapartnaE2, kosaE2, mulaE2 } from './specShips.testing';

describe('hull points (spec 3.4.1)', () => {
  it('scores footprints: 1x1 = 1, 2x1 = 2, 3x1 = 3, 2x2 = 3', () => {
    expect(sizeHullPoints({ w: 1, h: 1 })).toBe(1);
    expect(sizeHullPoints({ w: 2, h: 1 })).toBe(2);
    expect(sizeHullPoints({ w: 1, h: 2 })).toBe(2);
    expect(sizeHullPoints({ w: 3, h: 1 })).toBe(3);
    expect(sizeHullPoints({ w: 2, h: 2 })).toBe(3);
  });

  it('scores placed parts by their size, not rotation', () => {
    const grid = createGrid([['cockpit', 0, 0], ['heavyLaser', 1, 0, 1], ['largeCargo', -2, 0], ['battery', 0, 1]]);
    expect(grid.parts.map(partHullPoints)).toEqual([1, 2, 3, 1]);
    expect(hullPoints(grid)).toBe(7);
  });

  it('the starter ship uses 14 of the 28 points of a T1 cockpit', () => {
    expect(hullBudgetOf(createStarterShip())).toEqual({ used: 14, budget: 28, cockpitTier: 1, over: false });
  });

  it('a T2 cockpit carries 48 points; T3 80 and T4 140 exist as data', () => {
    expect(COCKPIT_HULL_BUDGET).toEqual({ 1: 28, 2: 48, 3: 80, 4: 140 });
    const grid = createGrid([['cockpit', 0, 0, 0, 2], ['largeCargo', 1, 0]]);
    expect(hullBudgetOf(grid)).toEqual({ used: 4, budget: 48, cockpitTier: 2, over: false });
  });

  it('is over budget above the limit and has no budget without exactly one cockpit', () => {
    const parts: [('armor'), number, number][] = [];
    for (let i = 1; i <= 28; i++) parts.push(['armor', i, 0]);
    const grid = createGrid([['cockpit', 0, 0], ...parts]);
    expect(hullBudgetOf(grid)).toMatchObject({ used: 29, budget: 28, over: true });
    expect(hullBudgetOf(createGrid([['armor', 0, 0]]))).toEqual({ used: 1, budget: null, cockpitTier: null, over: false });
  });
});

describe('hull points of shaped armour (SL2 E2, spec §2.7)', () => {
  it('scores each shape by its table points (½ steps), whatever the rotation or tier', () => {
    for (const shape of SHAPE_IDS) {
      for (const rot of [0, 1, 2, 3] as const) {
        for (const tier of [1, 2] as const) {
          const [part] = createGrid([['armor', 0, 0, rot, tier, shape]]).parts;
          expect(partHullPoints(part!)).toBe(SHAPES[shape].points);
          expect(partHullPoints(part!)).toBe(shapeHullPoints(part!));
        }
      }
    }
  });

  it('half points add up: Scythe A 18½ pts, Mule B 36 pts, Halberd C 63½ pts', () => {
    expect(hullPoints(kosaE2())).toBe(18.5);
    expect(hullPoints(mulaE2())).toBe(36);
    expect(hullPoints(halapartnaE2())).toBe(63.5);
  });

  it('is over budget only above the limit, also by half a point', () => {
    const armour = (n: number): [('armor'), number, number][] => Array.from({ length: n }, (_, i) => ['armor', i + 1, 0]);
    // 1 cockpit + 26 full plates + a wedge = 27½ of 28
    const under = createGrid([['cockpit', 0, 0], ...armour(26), ['armor', 0, 1, 0, 1, 'wedge']]);
    expect(hullBudgetOf(under)).toEqual({ used: 27.5, budget: 28, cockpitTier: 1, over: false });
    // 1 cockpit + 27 full plates + a wedge = 28½ of 28
    const over = createGrid([['cockpit', 0, 0], ...armour(27), ['armor', 0, 1, 0, 1, 'wedge']]);
    expect(hullBudgetOf(over)).toEqual({ used: 28.5, budget: 28, cockpitTier: 1, over: true });
    // two wedges = exactly 28
    const exact = createGrid([['cockpit', 0, 0], ...armour(26), ['armor', 0, 1, 0, 1, 'wedge'], ['armor', 0, -1, 0, 1, 'half']]);
    expect(hullBudgetOf(exact)).toMatchObject({ used: 28, over: false });
  });

  it('an unknown shape value scores like the full part (validators report it)', () => {
    const [part] = createGrid([['armor', 0, 0]]).parts;
    expect(partHullPoints({ ...part!, shape: 'blob' as never })).toBe(1);
  });
});
