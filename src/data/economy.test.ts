import { describe, expect, it } from 'vitest';
import {
  BUY_SPREAD,
  FUEL_BASE_PRICE,
  PRICE_JITTER_MAX,
  PRICE_JITTER_MIN,
  RING_INDICES,
  RING_RESOURCE_MULT,
  SELL_SPREAD,
  STARTING_CREDITS,
  STARTING_HOME_PARTS,
  fuelCost,
  fuelUnitPrice,
  priceList,
  purchaseCost,
  repairCost,
  resourcePrice,
  round1,
  saleValue,
  towCost,
} from './economy';
import { RESOURCE_IDS } from './resources';

const NO_JITTER = { iron: 1, copper: 1, ice: 1, titanium: 1 };
const JITTERS = [PRICE_JITTER_MIN, 1, PRICE_JITTER_MAX];

describe('resource prices', () => {
  it('match the ring 1 table without jitter', () => {
    expect(resourcePrice('iron', 1, 1)).toEqual({ sell: 3.2, buy: 5 });
    expect(resourcePrice('copper', 1, 1)).toEqual({ sell: 4, buy: 6.3 });
    expect(resourcePrice('ice', 1, 1)).toEqual({ sell: 2.4, buy: 3.8 });
    expect(resourcePrice('titanium', 1, 1)).toEqual({ sell: 8, buy: 12.5 });
  });

  it('applies ring multipliers and station jitter', () => {
    // iron in ring 2: 4 × 0.9 × 1.05 = 3.78 → 3.0 / 4.7
    expect(resourcePrice('iron', 2, 1.05)).toEqual({ sell: 3, buy: 4.7 });
  });

  it('always sells cheaper to the player than it buys from him', () => {
    for (const ring of RING_INDICES) {
      for (const id of RESOURCE_IDS) {
        for (const j of JITTERS) {
          const p = resourcePrice(id, ring, j);
          expect(p.sell).toBeLessThan(p.buy);
        }
      }
    }
  });

  it('allows no arbitrage between any two stations', () => {
    for (const a of RING_INDICES) {
      for (const b of RING_INDICES) {
        for (const id of RESOURCE_IDS) {
          for (const ja of JITTERS) {
            for (const jb of JITTERS) {
              const buyHere = resourcePrice(id, a, ja).buy;
              const sellThere = resourcePrice(id, b, jb).sell;
              expect(buyHere).toBeGreaterThan(sellThere);
              for (const qty of [1, 3, 7, 10, 33, 100, 997]) {
                expect(purchaseCost(qty, buyHere)).toBeGreaterThan(saleValue(qty, sellThere));
              }
            }
          }
        }
      }
    }
  });

  it('keeps the multiplier ratio below the spread ratio', () => {
    const limit = BUY_SPREAD / SELL_SPREAD;
    for (const id of RESOURCE_IDS) {
      const mults = RING_INDICES.map((r) => RING_RESOURCE_MULT[r][id]);
      const ratio = (Math.max(...mults) * PRICE_JITTER_MAX) / (Math.min(...mults) * PRICE_JITTER_MIN);
      expect(ratio).toBeLessThan(limit);
    }
  });

  it('builds a price list for a station', () => {
    const list = priceList({ ring: 1, priceJitter: NO_JITTER });
    expect(list.resources.copper).toEqual({ sell: 4, buy: 6.3 });
    expect(list.fuelPerUnit).toBe(FUEL_BASE_PRICE);
  });
});

describe('rounding of sums', () => {
  it('rounds unit prices to one decimal', () => {
    expect(round1(3.25)).toBe(3.3);
    expect(round1(29.25)).toBe(29.3);
    expect(round1(2.04)).toBe(2);
  });

  it('floors sale values and ceils purchase costs', () => {
    expect(saleValue(52.3, 3.2)).toBe(167); // 167,36
    expect(saleValue(10, 3.2)).toBe(32);
    expect(saleValue(0.2, 3.2)).toBe(0);
    expect(purchaseCost(3, 8.8)).toBe(27); // 26,4
    expect(purchaseCost(10, 5)).toBe(50);
    expect(purchaseCost(5, 5.6)).toBe(28);
  });

  it('is robust against floating point noise on exact sums', () => {
    expect(saleValue(3, 0.1)).toBe(0);
    expect(saleValue(10, 0.7)).toBe(7);
    expect(purchaseCost(3, 1.1)).toBe(4); // 3,3
    expect(purchaseCost(10, 0.7)).toBe(7);
  });
});

describe('services', () => {
  it('prices fuel by ring', () => {
    expect(fuelUnitPrice(1)).toBe(2);
    expect(fuelUnitPrice(2)).toBeCloseTo(2.2);
    expect(fuelUnitPrice(3)).toBeCloseTo(2.5);
    expect(fuelUnitPrice(4)).toBeCloseTo(2.8);
    expect(fuelCost(120, 1)).toBe(240);
    expect(fuelCost(10, 2)).toBe(22);
    expect(fuelCost(0.5, 1)).toBe(1);
  });

  it('prices towing by distance', () => {
    expect(towCost(0)).toBe(100);
    expect(towCost(1000)).toBe(300);
    expect(towCost(1001)).toBe(301);
    expect(towCost(1000.5)).toBe(301);
  });

  it('starts with 250 credits and two T1 armor plates at home', () => {
    expect(STARTING_CREDITS).toBe(250);
    expect(STARTING_HOME_PARTS).toEqual({ 'armor:1': 2, 'cannon:1': 1 });
  });
});

describe('repairCost of shaped armour (SL2 E2 §2.3, open question 1 b)', () => {
  it('without a multiplier (or with 1) the price is the full part price', () => {
    expect(repairCost('armor:1', 30, 40, 1)).toEqual({ credits: 8, material: 'iron', amount: 1 });
    expect(repairCost('armor:1', 30, 40, 1, 1)).toEqual(repairCost('armor:1', 30, 40, 1));
    expect(repairCost('engine:1', 10, 25, 3, 1)).toEqual(repairCost('engine:1', 10, 25, 3));
  });

  it('a wedge T1 at 10 / 20 HP costs exactly what 10 missing HP of a full plate cost', () => {
    // f = (1 − 10/20) × 0.5 = 10/40: ceil(0.25 × 200 × 0.15) = 8 kr, ceil(0.25 × 0.25 × 15) = 1 Fe
    expect(repairCost('armor:1', 10, 20, 1, 0.5)).toEqual({ credits: 8, material: 'iron', amount: 1 });
    expect(repairCost('armor:1', 10, 20, 1, 0.5)).toEqual(repairCost('armor:1', 30, 40, 1));
  });

  it('parity holds for other shapes, tiers and rings (ceil rules applied once to the same fraction)', () => {
    // chamfer T1: max round(40 × 0.875) = 35, 15 HP missing = 15 / 40 of a full plate
    expect(repairCost('armor:1', 20, 35, 2, 0.875)).toEqual(repairCost('armor:1', 25, 40, 2));
    // wedge T2: max 35, 30 HP missing = 30 / 70; ring 3 → 33 kr, 2 Ti
    expect(repairCost('armor:2', 5, 35, 3, 0.5)).toEqual(repairCost('armor:2', 40, 70, 3));
    expect(repairCost('armor:2', 5, 35, 3, 0.5)).toEqual({ credits: 33, material: 'titanium', amount: 2 });
    // nose 2×1 (area 1.67, max round(66.8) = 67): 20 missing HP cost what 20 HP of a full plate cost
    expect(repairCost('armor:1', 47, 67, 1, 1.67).credits).toBe(Math.ceil((20 / 40) * 200 * 0.15 - 1e-9));
    // … and 60 missing HP (more than a whole plate has) cost 1.5 plates' repair: 45 kr, ceil(1.5 × 3.75) = 6 Fe
    expect(repairCost('armor:1', 7, 67, 1, 1.67)).toEqual({ credits: 45, material: 'iron', amount: 6 });
  });

  it('is free at full HP whatever the multiplier', () => {
    expect(repairCost('armor:1', 20, 20, 1, 0.5)).toEqual({ credits: 0, material: 'iron', amount: 0 });
  });
});
