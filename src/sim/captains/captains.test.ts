import { describe, expect, it } from 'vitest';
import { CAPTAIN_COUNT, CAPTAIN_MAX_LEVEL, CAPTAIN_NAMES, CAPTAIN_NICKNAME_COUNT, TRAITS, CAPTAIN_TRAITS } from '../../data/captains';
import { FACTIONS } from '../../data/factions';
import { hullBudgetOf } from '../ship/budget';
import { validateGrid } from '../ship/grid';
import { computeProperties } from '../ship/properties';
import { captainBounty, captainDefs, captainEnemyId, captainGrid, captainIndexOf, captainLevel, createCaptainEnemy } from './captains';

describe('captain data', () => {
  it('has enough distinct names and valid traits', () => {
    // the nicknames themselves are texts: src/i18n/i18n.test.ts checks their count and uniqueness
    expect(CAPTAIN_NAMES.length * CAPTAIN_NICKNAME_COUNT).toBeGreaterThanOrEqual(CAPTAIN_COUNT);
    expect(new Set(CAPTAIN_NAMES).size).toBe(CAPTAIN_NAMES.length);
    for (const t of CAPTAIN_TRAITS) {
      expect(TRAITS[t].escapeHull).toBeGreaterThan(0);
      expect(TRAITS[t].escapeHull).toBeLessThan(1);
      expect(TRAITS[t].replicas).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('captainDefs', () => {
  it('generates 30 captains per seed, deterministic, with unique name pairs', () => {
    const a = captainDefs(42);
    expect(a).toHaveLength(CAPTAIN_COUNT);
    expect(captainDefs(42)).toEqual(a);
    expect(captainDefs(43)).not.toEqual(a);
    const pairs = new Set(a.map((c) => `${c.name}/${c.nickname}`));
    expect(pairs.size).toBe(CAPTAIN_COUNT);
    for (const c of a) {
      expect(FACTIONS[c.clan].clan).toBe(true);
      expect(c.baseLevel).toBeGreaterThanOrEqual(1);
      expect(c.baseLevel).toBeLessThanOrEqual(3);
      expect(c.ring).toBeGreaterThanOrEqual(2);
    }
  });

  it('levels up with promotions and caps the level', () => {
    const def = captainDefs(1)[0]!;
    expect(captainLevel(def, undefined)).toBe(def.baseLevel);
    expect(captainLevel(def, { promotions: 1, defeated: false, trophies: [], kills: 0 })).toBe(def.baseLevel + 1);
    expect(captainLevel(def, { promotions: 9, defeated: false, trophies: [], kills: 0 })).toBe(CAPTAIN_MAX_LEVEL);
  });

  it('pays 0,1 h + 0,075 h × level of the ring minimum income (times the trait)', () => {
    const def = { ...captainDefs(1)[0]!, trait: 'cautious' as const, ring: 2 as const };
    expect(captainBounty(def, 1)).toBe(3850);
    expect(captainBounty(def, 3)).toBe(7150);
    expect(captainBounty({ ...def, trait: 'greedy' }, 1)).toBe(4810);
    // P3 pays proportionally more
    expect(captainBounty({ ...def, ring: 3 }, 3)).toBe(27625);
  });
});

describe('captain ships', () => {
  it('every level is a valid ship, +6 hull points per promotion, T2 from level 3', () => {
    let prev = 0;
    for (let level = 1; level <= CAPTAIN_MAX_LEVEL; level++) {
      const grid = captainGrid(level);
      expect(validateGrid(grid)).toEqual([]);
      const used = hullBudgetOf(grid).used;
      if (level > 1) expect(used - prev).toBe(6);
      prev = used;
      expect(grid.parts.every((p) => p.tier === (level >= 3 ? 2 : 1))).toBe(true);
      const props = computeProperties(grid);
      expect(props.weapons.length).toBeGreaterThanOrEqual(2);
      expect(props.thrust.forward).toBeGreaterThan(0);
    }
  });

  it('spawns as a hammer enemy with a captain id', () => {
    const e = createCaptainEnemy(7, 2, { x: 10, y: 20 }, 0);
    expect(e.id).toBe(captainEnemyId(7));
    expect(captainIndexOf(e.id)).toBe(7);
    expect(captainIndexOf('pr:1,2:0')).toBeNull();
    expect(captainIndexOf('cap:99')).toBeNull();
    expect(e.kind).toBe('hammer');
    expect(e.maxHull).toBeGreaterThan(0);
    expect(e.shield).toBe(e.props.shield.capacity);
  });
});
