import { describe, expect, it } from 'vitest';
import { kindLootMult } from './combat';
import { scrapResources } from '../../data/economy';
import type { ShapeId } from '../../data/shapes';
import type { PlacedPart } from '../ship/types';
import { ENEMY_KINDS } from './types';
import { addPartLoot, emptyLoot, type LootOwner } from './wrecks';

describe('pirate cargo loot by kind (M4b)', () => {
  it('the Gunner carries twice the cargo like the Hammer, every other kind the base amount', () => {
    expect(kindLootMult('hammer')).toBe(2);
    expect(kindLootMult('gunner')).toBe(kindLootMult('hammer'));
    for (const kind of ENEMY_KINDS) if (kind !== 'hammer' && kind !== 'gunner') expect(kindLootMult(kind), kind).toBe(1);
  });
});

describe('loot of shaped armour (SL2 E2 §2.4)', () => {
  const plate = (shape?: ShapeId, extra: Partial<PlacedPart> = {}): PlacedPart => ({
    id: 7, partId: 'armor', tier: 1, x: 0, y: 0, rot: 0, ...(shape ? { shape } : {}), ...extra,
  });
  const lootOf = (part: PlacedPart, hp: number | null, owner: LootOwner) => {
    const loot = emptyLoot();
    addPartLoot(loot, part, new Map(hp === null ? [] : [[part.id, hp]]), owner);
    return { parts: loot.parts, cargo: Object.fromEntries(Object.entries(loot.cargo).filter(([, n]) => n > 0)) };
  };

  it('a full part drops exactly as before for both owners (intact → part, damaged → scrap of its HP)', () => {
    for (const owner of ['player', 'other'] as const) {
      expect(lootOf(plate(), null, owner)).toEqual({ parts: { 'armor:1': 1 }, cargo: {} });
      // scrapResources('armor:1', 10, 40): floor(15 × 0.5 × 0.25) = 1 Fe
      expect(lootOf(plate(), 10, owner)).toEqual({ parts: {}, cargo: scrapResources('armor:1', 10, 40) });
      expect(lootOf(plate(), 10, owner).cargo).toEqual({ iron: 1 });
    }
  });

  it('player wreck: an intact wedge drops as the full plate (one item folded)', () => {
    expect(lootOf(plate('wedge'), null, 'player')).toEqual({ parts: { 'armor:1': 1 }, cargo: {} });
  });

  it('player wreck: a damaged wedge scraps from its full-equivalent HP', () => {
    // 10 / 20 → 10 HP missing → 30 / 40 of a full plate: floor(15 × 0.5 × 0.75) = 5 Fe (not 3 from 10 / 20)
    expect(lootOf(plate('wedge'), 10, 'player')).toEqual({ parts: {}, cargo: { iron: 5 } });
    expect(lootOf(plate('wedge'), 10, 'player').cargo).toEqual(scrapResources('armor:1', 30, 40));
  });

  it('other wreck: an intact chamfer (area 0.875 ≥ 0.75) drops as the part, an intact wedge as scrap ∝ area', () => {
    expect(lootOf(plate('chamfer'), null, 'other')).toEqual({ parts: { 'armor:1': 1 }, cargo: {} });
    // wedge area 0.5: scrapResources('armor:1', 0.5 × 40, 40) = floor(15 × 0.5 × 0.5) = 3 Fe
    expect(lootOf(plate('wedge'), null, 'other')).toEqual({ parts: {}, cargo: { iron: 3 } });
    expect(lootOf(plate('arc'), null, 'other').parts).toEqual({ 'armor:1': 1 });
    expect(lootOf(plate('half'), null, 'other').parts).toEqual({});
  });

  it('other wreck: a damaged shaped part scraps from area × full HP × its HP share', () => {
    // chamfer 20 / 35: 0.875 × 40 × 20 / 35 = 20 of 40 → floor(15 × 0.5 × 0.5) = 3 Fe
    expect(lootOf(plate('chamfer'), 20, 'other')).toEqual({ parts: {}, cargo: { iron: 3 } });
    // wedge T2 28 / 35: 0.5 × 70 × 28 / 35 = 28 of 70 → share 0.2: floor(12 × 0.2) = 2 Ti, floor(5 × 0.2) = 1 Fe;
    // the player's own one scraps from 63 of 70 (7 HP missing) → share 0.45: 5 Ti, 2 Fe
    expect(lootOf(plate('wedge', { tier: 2 }), 28, 'other')).toEqual({ parts: {}, cargo: { titanium: 2, iron: 1 } });
    expect(lootOf(plate('wedge', { tier: 2 }), 28, 'player')).toEqual({ parts: {}, cargo: { titanium: 5, iron: 2 } });
  });

  it('a Guild loan part drops nothing, shaped or not', () => {
    for (const owner of ['player', 'other'] as const) {
      for (const shape of [undefined, 'wedge', 'chamfer'] as const) {
        expect(lootOf(plate(shape, { loan: true }), null, owner)).toEqual({ parts: {}, cargo: {} });
        expect(lootOf(plate(shape, { loan: true }), 5, owner)).toEqual({ parts: {}, cargo: {} });
      }
    }
  });
});
