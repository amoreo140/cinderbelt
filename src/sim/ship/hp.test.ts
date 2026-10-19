import { describe, expect, it } from 'vitest';
import { SHAPE_IDS, type ShapeId } from '../../data/shapes';
import { createGrid } from './grid';
import { currentHp, damagedParts, fullEquivalentHp, fullMaxHp, hullHp, maxHp } from './hp';
import type { HpMap } from './types';

describe('part HP', () => {
  const grid = createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0, 2], ['armor', 1, 0]]);
  const [cockpit, engine, armor] = grid.parts as [typeof grid.parts[0], typeof grid.parts[0], typeof grid.parts[0]];

  it('reads max HP by tier', () => {
    expect(maxHp(cockpit)).toBe(60);
    expect(maxHp(engine)).toBe(44);
  });

  it('treats a missing entry as full HP', () => {
    const hp: HpMap = new Map([[armor.id, 12]]);
    expect(currentHp(hp, cockpit)).toBe(60);
    expect(currentHp(hp, armor)).toBe(12);
  });

  it('lists damaged parts and sums the hull', () => {
    const hp: HpMap = new Map([[armor.id, 12], [engine.id, 44], [99, 1]]);
    expect(damagedParts(grid, hp).map((p) => p.id)).toEqual([armor.id]);
    expect(hullHp(grid, hp)).toEqual({ current: 60 + 44 + 12, max: 60 + 44 + 40 });
  });
});

describe('HP of shaped armour (SL2 E2, plan §2.2–§2.3)', () => {
  const one = (tier: 1 | 2, shape?: ShapeId) => createGrid([['armor', 0, 0, 0, tier, shape]]).parts[0]!;

  it('max HP = round(full HP × area): wedge T1 20, chamfer T1 35, nose 2×1 T1 67', () => {
    expect(maxHp(one(1, 'wedge'))).toBe(20);
    expect(maxHp(one(1, 'chamfer'))).toBe(35);
    expect(maxHp(one(1, 'nose2x1'))).toBe(67);
    expect(maxHp(one(2, 'nose2x1'))).toBe(117);
    expect(maxHp(one(1, 'round'))).toBe(38);
    expect(maxHp(one(1))).toBe(40);
    for (const shape of SHAPE_IDS) for (const tier of [1, 2] as const) expect(Number.isInteger(maxHp(one(tier, shape)))).toBe(true);
  });

  it('full max HP is the part definition HP, shape or not', () => {
    expect(fullMaxHp(one(1, 'wedge'))).toBe(40);
    expect(fullMaxHp(one(2, 'arc'))).toBe(70);
    expect(fullMaxHp(createGrid([['cockpit', 0, 0]]).parts[0]!)).toBe(60);
  });

  it('full-equivalent HP = full max HP minus the missing HP', () => {
    const wedge = one(1, 'wedge');
    expect(fullEquivalentHp(wedge, 20)).toBe(40);
    expect(fullEquivalentHp(wedge, 5)).toBe(25);
    expect(fullEquivalentHp(wedge, 0)).toBe(20);
    expect(fullEquivalentHp(one(1, 'nose2x1'), 67)).toBe(40);
    expect(fullEquivalentHp(one(1), 12)).toBe(12);
  });

  it('current HP and the hull sum use the shaped max', () => {
    const grid2 = createGrid([['cockpit', 0, 0], ['armor', 1, 0, 0, 1, 'wedge']]);
    const wedge = grid2.parts[1]!;
    expect(currentHp(new Map(), wedge)).toBe(20);
    expect(currentHp(new Map([[wedge.id, 35]]), wedge)).toBe(20);
    expect(hullHp(grid2, new Map([[wedge.id, 8]]))).toEqual({ current: 68, max: 80 });
    expect(damagedParts(grid2, new Map([[wedge.id, 20]]))).toEqual([]);
  });
});
