import { describe, expect, it } from 'vitest';
import { partBuyPrice, partValue, RECIPES } from '../../data/economy';
import { ALL_PART_KEYS, isPartKey, parsePartKey, partDef, partKey, PART_DEFS } from '../../data/parts';
import { VARIANTS, VARIANT_IDS } from '../../data/variants';
import { applyEditorOp } from '../shipyard/editor';
import { hullBudgetOf } from './budget';
import { createGrid } from './grid';
import { maxHp } from './hp';
import { computeProperties } from './properties';
import type { ShipGrid } from './types';

describe('part variants (3.3)', () => {
  it('variant keys are valid part keys and round-trip through parsePartKey', () => {
    for (const v of VARIANT_IDS) {
      for (const tier of [1, 2] as const) {
        const key = partKey(VARIANTS[v].base, tier, v);
        expect(isPartKey(key)).toBe(true);
        expect(parsePartKey(key)).toEqual({ partId: VARIANTS[v].base, tier, variant: v });
      }
    }
    // a variant on the wrong part type is not a valid key
    expect(isPartKey('armor:1:overdrive')).toBe(false);
    expect(parsePartKey('engine:2')).toEqual({ partId: 'engine', tier: 2 });
    expect(ALL_PART_KEYS.slice(0, 28).every((k) => !parsePartKey(k).variant)).toBe(true);
  });

  it('applies the trade-offs and keeps size and mass', () => {
    const base = PART_DEFS.engine[2];
    const od = partDef('engine', 2, 'overdrive');
    expect(od.thrust).toBeCloseTo(base.thrust! * 1.4, 6);
    expect(od.fuelUse).toBe(1.8);
    expect(od.mass).toBe(base.mass);
    expect(od.size).toEqual(base.size);
    expect(od.variant).toBe('overdrive');
    const rapid = partDef('cannon', 1, 'rapid');
    expect(rapid.weapon!.fireRate).toBeCloseTo(PART_DEFS.cannon[1].weapon!.fireRate * 2.5, 6);
    expect(rapid.weapon!.damage).toBeCloseTo(PART_DEFS.cannon[1].weapon!.damage * 0.45, 6);
    expect(partDef('cargo', 1, 'armored').hp).toBe(60);
    expect(partDef('cargo', 1, 'armored').cargo).toBe(42);
    expect(partDef('cockpit', 2, 'combat').hullBudget).toBe(44);
    expect(partDef('shield', 1, 'quick').shield!.capacity).toBe(42);
    // a variant of another part is ignored
    expect(partDef('armor', 1, 'overdrive')).toBe(PART_DEFS.armor[1]);
  });

  it('ship properties average fuel use by thrust and take the scout cockpit pulse bonus', () => {
    const grid = createGrid([
      ['cockpit', 0, 0],
      ['engine', -1, 0, 0],
      ['engine', 0, 1, 0],
    ]);
    grid.parts[1]!.variant = 'overdrive';
    const props = computeProperties(grid);
    const t = PART_DEFS.engine[1].thrust!;
    expect(props.fuelUseMult).toBeCloseTo((t * 1.4 * 1.8 + t) / (t * 1.4 + t), 6);
    expect(props.pulseCooldownMult).toBe(1);
    grid.parts[0]!.variant = 'scout';
    const scout = computeProperties(grid);
    expect(scout.pulseCooldownMult).toBe(0.7);
    expect(scout.radarRange).toBe(Math.round(PART_DEFS.cockpit[1].radarRange! * 1.6));
    expect(maxHp(grid.parts[0]!)).toBe(48);
  });

  it('a combat cockpit lowers the hull budget by 4 points', () => {
    const grid: ShipGrid = createGrid([['cockpit', 0, 0]]);
    expect(hullBudgetOf(grid).budget).toBe(28);
    grid.parts[0]!.variant = 'combat';
    expect(hullBudgetOf(grid).budget).toBe(24);
  });

  it('the editor places the variant from the key', () => {
    const grid = createGrid([['cockpit', 0, 0]]);
    const r = applyEditorOp(grid, { op: 'place', key: 'engine:1:eco', x: -1, y: 0, rot: 0 });
    expect(r.ok && r.grid.parts[1]).toMatchObject({ partId: 'engine', tier: 1, variant: 'eco' });
  });

  it('variants are crafted for a higher fee and never sold on the market', () => {
    expect(RECIPES['engine:1:overdrive'].resources).toEqual(RECIPES['engine:1'].resources);
    expect(RECIPES['engine:1:overdrive'].credits).toBe(1050);
    expect(partValue('engine:1:overdrive')).toBeGreaterThan(partValue('engine:1'));
    expect(partBuyPrice('engine:1:overdrive', 2)).toBeNull();
    expect(partBuyPrice('engine:1', 2)).not.toBeNull();
  });
});
