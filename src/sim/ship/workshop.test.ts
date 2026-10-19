// On-board workshop helpers (M4c T7 contracts, T8 rules; plan §2.4). The simulation cases are
// in src/sim/Simulation.workshop.test.ts.
import { describe, expect, it } from 'vitest';
import { PRICE_JITTER_MAX, PRICE_JITTER_MIN, repairCost, resourcePrice, RING_INDICES, saleValue } from '../../data/economy';
import { DEMAND_BONUS } from '../../data/sector';
import { cheapestBuy, REFINED_BONUS, REFINED_CEILING } from '../../data/workshop';
import { emptyCargo } from '../../data/resources';
import { createGrid } from './grid';
import { maxHp } from './hp';
import { hpMultOf } from './shape';
import { clampRefined, idleWorkshop, playerMounts, refinedSaleValue, refinedUnit, repairMaterialPerHp, shipSaleValue, workshopMounts } from './workshop';

describe('clampRefined', () => {
  it('keeps refined ≤ cargo per resource and never refined ice', () => {
    const cargo = { ...emptyCargo(), iron: 10, copper: 3, titanium: 0, ice: 5 };
    const refined = { ...emptyCargo(), iron: 4, copper: 7, titanium: 2, ice: 5 };
    clampRefined(cargo, refined);
    expect(refined).toEqual({ iron: 4, copper: 3, titanium: 0, ice: 0 });
  });

  it('a fractional cargo (mining) clamps to the fraction', () => {
    const refined = { ...emptyCargo(), iron: 4 };
    clampRefined({ ...emptyCargo(), iron: 2.5 }, refined);
    expect(refined.iron).toBe(2.5);
  });
});

describe('refinedSaleValue', () => {
  it('sells refined units first with the bonus, the rest at the plain price, rounded down once', () => {
    expect(refinedSaleValue('copper', 10, 0, 4)).toBe(40);
    expect(refinedSaleValue('copper', 10, 4, 4)).toBe(Math.floor(4 * 4 * (1 + REFINED_BONUS) + 6 * 4));
    // more refined than sold: only the sold units count
    expect(refinedSaleValue('titanium', 3, 8, 8)).toBe(Math.floor(3 * 8 * (1 + REFINED_BONUS)));
    expect(refinedSaleValue('titanium', 0, 5, 8)).toBe(0);
  });

  it('W1: a refined unit never sells above REFINED_CEILING, and never below the raw price', () => {
    // ring 4 iron at jitter 1.05 sells raw for 4.0: refined 4.6 → capped at 4.2 (+5 %)
    const r4 = resourcePrice('iron', 4, PRICE_JITTER_MAX).sell;
    expect(refinedUnit('iron', r4)).toBe(REFINED_CEILING.iron);
    expect(refinedSaleValue('iron', 100, 100, r4)).toBe(Math.floor(100 * REFINED_CEILING.iron + 1e-9));
    expect(refinedSaleValue('iron', 10, 4, r4)).toBe(Math.floor(4 * REFINED_CEILING.iron + 6 * r4 + 1e-9));
    // a raw price above the ceiling (not a station price) keeps the raw price
    expect(refinedUnit('iron', 5)).toBe(5);
    // ice is never refined: no bonus
    expect(refinedUnit('ice', 3)).toBe(3);
  });
});

describe('the W1 refined price ceiling', () => {
  const JITTERS = [PRICE_JITTER_MIN, 1, PRICE_JITTER_MAX];
  const ORES = ['iron', 'copper', 'titanium'] as const;

  it('is derived from the cheapest buy price (iron 4.2, copper 5.8, titanium 11.2)', () => {
    expect(REFINED_CEILING).toEqual({ iron: 4.2, copper: 5.8, titanium: 11.2 });
    for (const r of ORES) expect(REFINED_CEILING[r]).toBeCloseTo(cheapestBuy(r) - 0.1, 9);
  });

  it('for every resource, ring and jitter extreme a refined unit is below the cheapest buy anywhere', () => {
    for (const r of ORES) {
      const cheapest = Math.min(...RING_INDICES.flatMap((ring) => JITTERS.map((j) => resourcePrice(r, ring, j).buy)));
      for (const ring of RING_INDICES) {
        for (const j of JITTERS) {
          const sell = resourcePrice(r, ring, j).sell;
          expect(refinedUnit(r, sell), `${r} P${ring} ×${j}`).toBeLessThan(cheapest);
          expect(refinedUnit(r, sell), `${r} P${ring} ×${j}`).toBeGreaterThanOrEqual(sell);
        }
      }
    }
  });

  it('ring 1–2 refining and every titanium sale keep the full bonus; it bites only iron / copper in rings 3–4', () => {
    for (const r of ORES) {
      for (const ring of RING_INDICES) {
        for (const j of JITTERS) {
          const sell = resourcePrice(r, ring, j).sell;
          const full = sell * (1 + REFINED_BONUS);
          if (ring <= 2 || r === 'titanium') {
            expect(refinedUnit(r, sell), `${r} P${ring} ×${j}`).toBe(full);
            expect(refinedSaleValue(r, 50, 50, sell)).toBe(Math.floor(50 * full + 1e-9));
          }
        }
      }
    }
    // where it bites: ring 4 iron at any jitter, ring 4 copper at the top jitter
    expect(refinedUnit('iron', resourcePrice('iron', 4, 1).sell)).toBeLessThan(resourcePrice('iron', 4, 1).sell * (1 + REFINED_BONUS));
    expect(refinedUnit('copper', resourcePrice('copper', 4, PRICE_JITTER_MAX).sell)).toBe(REFINED_CEILING.copper);
  });
});

describe('workshopMounts', () => {
  it('lists refineries and repair modules with their edge neighbours (not diagonal ones)', () => {
    const grid = createGrid([
      ['cockpit', 0, 0],
      ['repairModule', 1, 0],
      ['armor', 2, 0],
      ['armor', 1, 1],
      // diagonal of the repair module: not a neighbour
      ['engine', 2, 1],
      ['refinery', -2, 0],
    ]);
    const mounts = workshopMounts(grid);
    const id = (x: number, y: number): number => grid.parts.find((p) => p.x === x && p.y === y)!.id;
    expect(mounts.refineries.map((r) => r.partId)).toEqual([id(-2, 0)]);
    expect(mounts.refineries[0]!.spec.orePerSecond).toBe(0.6);
    expect(mounts.repairs).toHaveLength(1);
    expect(mounts.repairs[0]!.partId).toBe(id(1, 0));
    expect(mounts.repairs[0]!.neighbours).toEqual([id(0, 0), id(2, 0), id(1, 1)].sort((a, b) => a - b));
  });

  it('an idle workshop does nothing', () => {
    expect(idleWorkshop()).toEqual({ refining: null, repairing: [] });
  });
});

describe('shipSaleValue', () => {
  it('without demand = refinedSaleValue; without refined units = the demand sale', () => {
    expect(shipSaleValue('copper', 10, 4, 0, 4)).toBe(refinedSaleValue('copper', 10, 4, 4));
    expect(shipSaleValue('copper', 10, 0, 6, 4)).toBe(saleValue(6, 4 * (1 + DEMAND_BONUS)) + saleValue(4, 4));
  });

  it('the bonuses never stack: demand units at the demand price, refined units fill the rest first', () => {
    expect(shipSaleValue('copper', 10, 10, 6, 4)).toBe(saleValue(6, 4 * (1 + DEMAND_BONUS)) + refinedSaleValue('copper', 4, 10, 4));
    expect(shipSaleValue('copper', 10, 2, 6, 4)).toBe(saleValue(6, 4 * (1 + DEMAND_BONUS)) + refinedSaleValue('copper', 4, 2, 4));
    // all of it within the demand: refining adds nothing
    expect(shipSaleValue('copper', 5, 5, 9, 4)).toBe(saleValue(5, 4 * (1 + DEMAND_BONUS)));
  });

  it('the refined units take the ceiling (W1); the demand price is untouched', () => {
    const unit = resourcePrice('iron', 4, PRICE_JITTER_MAX).sell;
    expect(shipSaleValue('iron', 10, 10, 6, unit)).toBe(saleValue(6, unit * (1 + DEMAND_BONUS)) + Math.floor(4 * REFINED_CEILING.iron + 1e-9));
  });
});

describe('repairMaterialPerHp', () => {
  it('matches the station repair: Fe for T1, Ti for T2, a full repair = repairCost before rounding', () => {
    const grid = createGrid([['armor', 0, 0], ['cockpit', 1, 0, 0, 2], ['engine', 2, 0, 0, 1]]);
    for (const p of grid.parts) {
      const { material, perHp } = repairMaterialPerHp(p);
      const cost = repairCost(`${p.partId}:${p.tier}` as const, 0, maxHp(p), 1);
      expect(material).toBe(p.tier === 2 ? 'titanium' : 'iron');
      expect(cost.material).toBe(material);
      expect(cost.amount).toBe(Math.ceil(perHp * maxHp(p) - 1e-9));
    }
  });

  it('a shaped plate pays per missing HP what a full plate pays (hpMultOf parity)', () => {
    const grid = createGrid([['armor', 0, 0], ['armor', 1, 0, 0, 1, 'wedge'], ['armor', 2, 0, 0, 1, 'nose2x1']]);
    const [full, wedge, nose] = grid.parts.map((p) => repairMaterialPerHp(p).perHp) as [number, number, number];
    // HP is rounded per shape, so the rates agree up to that rounding
    expect(wedge).toBeCloseTo(full, 2);
    expect(nose).toBeCloseTo(full, 2);
    for (const p of grid.parts.slice(1)) {
      const max = maxHp(p);
      const cost = repairCost('armor:1', 0, max, 1, hpMultOf(p));
      expect(cost.amount).toBe(Math.ceil(repairMaterialPerHp(p).perHp * max - 1e-9));
    }
  });
});

describe('playerMounts', () => {
  it('is memoised by the grid and its version', () => {
    const grid = createGrid([['cockpit', 0, 0], ['refinery', 1, 0]]);
    const a = playerMounts({ grid, gridVersion: 1 });
    expect(playerMounts({ grid, gridVersion: 1 })).toBe(a);
    const b = playerMounts({ grid, gridVersion: 2 });
    expect(b).not.toBe(a);
    expect(b).toEqual(a);
  });
});
