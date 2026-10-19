import { describe, expect, it } from 'vitest';
import {
  INSTALL_FEE,
  PART_BUY_MARKUP,
  PART_SELL_FACTOR,
  PRICE_JITTER_MAX,
  PRICE_JITTER_MIN,
  RECIPES,
  RING_INDICES,
  RING_PART_MULT,
  partBuyPrice,
  partPrice,
  partSellPrice,
  partValue,
  priceList,
  purchaseCost,
  resourcePrice,
  round5,
} from './economy';
import { ALL_PART_KEYS, parsePartKey, partKey, type PartId, type PartKey } from './parts';
import { RESOURCE_IDS } from './resources';

const NO_JITTER = { iron: 1, copper: 1, ice: 1, titanium: 1 };

/** Tables 6.3: [V, buy, sell] – T1 in ring 1, T2 in ring 2. */
const T1_TABLE: Record<PartId, [number, number, number]> = {
  armor: [260, 390, 105],
  cargo: [1070, 1605, 430],
  fuelTank: [775, 1165, 310],
  engine: [975, 1465, 390],
  gyro: [980, 1470, 390],
  radar: [865, 1300, 345],
  miningLaser: [1380, 2070, 550],
  reactor: [1580, 2370, 630],
  cockpit: [2930, 4395, 1170],
  cannon: [1200, 1800, 480],
  shield: [1675, 2515, 670],
  heavyLaser: [3280, 4920, 1310],
  largeCargo: [4180, 6270, 1670],
  battery: [985, 1480, 395],
  tractorBeam: [1355, 2035, 540],
  // M4c (plan 2026-10-20 §2.4)
  largeReactor: [5700, 8550, 2280],
  repairModule: [1770, 2655, 710],
  refinery: [3520, 5280, 1410],
};
const T2_TABLE: Record<PartId, [number, number, number]> = {
  armor: [540, 890, 215],
  cargo: [2290, 3780, 915],
  fuelTank: [1752, 2890, 700],
  engine: [2240, 3695, 895],
  gyro: [2217, 3660, 885],
  radar: [1920, 3170, 770],
  miningLaser: [3062, 5050, 1225],
  reactor: [3580, 5905, 1430],
  cockpit: [6440, 10625, 2575],
  cannon: [2615, 4315, 1045],
  shield: [3677, 6065, 1470],
  heavyLaser: [6822, 11255, 2730],
  largeCargo: [9160, 15115, 3665],
  battery: [2152, 3550, 860],
  tractorBeam: [2832, 4675, 1135],
  largeReactor: [12540, 20690, 5015],
  repairModule: [3890, 6420, 1555],
  refinery: [7700, 12705, 3080],
};

describe('part economy constants', () => {
  it('match the 6.6 overview', () => {
    expect(PART_BUY_MARKUP).toBe(1.5);
    expect(PART_SELL_FACTOR).toBe(0.4);
    expect(RING_PART_MULT).toEqual({ 1: 1.0, 2: 1.1, 3: 1.2, 4: 1.3 });
    expect(INSTALL_FEE).toBe(10);
  });

  it('rounds to 5 credits', () => {
    expect(round5(1282.5)).toBe(1285);
    expect(round5(342)).toBe(340);
    expect(round5(952.5)).toBe(955);
    expect(round5(884.4)).toBe(885);
  });
});

describe('recipes', () => {
  it('exist for every part key and produce that key', () => {
    for (const key of ALL_PART_KEYS) expect(RECIPES[key].output).toBe(key);
  });

  it('match the T1 and T2 tables', () => {
    expect(RECIPES['cargo:1']).toEqual({ output: 'cargo:1', resources: { iron: 30, copper: 10 }, credits: 900 });
    expect(RECIPES['reactor:1']).toEqual({
      output: 'reactor:1', resources: { iron: 30, copper: 30, ice: 20 }, credits: 1250,
    });
    expect(RECIPES['cockpit:2']).toEqual({
      output: 'cockpit:2', resources: { titanium: 40, iron: 20, copper: 50, ice: 20 }, credits: 5650,
    });
    expect(RECIPES['armor:2']).toEqual({ output: 'armor:2', resources: { titanium: 12, iron: 5 }, credits: 400 });
  });

  it('match the M4c parts table (plan 2026-10-20 §2.4)', () => {
    const r = (key: PartKey) => ({ resources: RECIPES[key].resources, credits: RECIPES[key].credits });
    expect(r('largeReactor:1')).toEqual({ resources: { iron: 110, copper: 110, ice: 70 }, credits: 4500 });
    expect(r('largeReactor:2')).toEqual({ resources: { titanium: 90, iron: 35, copper: 140, ice: 100 }, credits: 10500 });
    expect(r('repairModule:1')).toEqual({ resources: { iron: 30, copper: 30 }, credits: 1500 });
    expect(r('repairModule:2')).toEqual({ resources: { titanium: 25, iron: 10, copper: 40 }, credits: 3400 });
    expect(r('refinery:1')).toEqual({ resources: { iron: 60, copper: 50, ice: 10 }, credits: 3000 });
    expect(r('refinery:2')).toEqual({ resources: { titanium: 45, iron: 20, copper: 65, ice: 15 }, credits: 6800 });
  });

  it('T2 recipes need titanium, T1 recipes do not', () => {
    for (const key of ALL_PART_KEYS) {
      const ti = RECIPES[key].resources.titanium ?? 0;
      if (parsePartKey(key).tier === 2) expect(ti).toBeGreaterThan(0);
      else expect(ti).toBe(0);
    }
  });
});

describe('part prices', () => {
  it('match the T1 table in ring 1', () => {
    for (const [id, [v, buy, sell]] of Object.entries(T1_TABLE) as [PartId, [number, number, number]][]) {
      const key = partKey(id, 1);
      expect(partValue(key)).toBe(v);
      expect(partBuyPrice(key, 1)).toBe(buy);
      expect(partSellPrice(key)).toBe(sell);
    }
  });

  it('match the T2 table in ring 2', () => {
    for (const [id, [v, buy, sell]] of Object.entries(T2_TABLE) as [PartId, [number, number, number]][]) {
      const key = partKey(id, 2);
      expect(partValue(key)).toBe(v);
      expect(partBuyPrice(key, 2)).toBe(buy);
      expect(partSellPrice(key)).toBe(sell);
    }
  });

  it('does not sell T2 parts in ring 1', () => {
    expect(partPrice('engine:2', 1)).toEqual({ buy: null, sell: 895 });
    expect(partPrice('engine:1', 1)).toEqual({ buy: 1465, sell: 390 });
    expect(partPrice('engine:2', 3).buy).toBe(round5(2240 * 1.5 * 1.2));
  });

  it('adds part prices to the station price list', () => {
    const list = priceList({ ring: 1, priceJitter: NO_JITTER });
    expect(list.parts['armor:1']).toEqual({ buy: 390, sell: 105 });
    expect(list.parts['armor:2']).toEqual({ buy: null, sell: 215 });
    expect(Object.keys(list.parts)).toHaveLength(ALL_PART_KEYS.length);
  });
});

describe('crafting is always the cheapest way', () => {
  /** Crafting from resources bought at the station. */
  const craftFromBought = (key: PartKey, ring: 1 | 2 | 3 | 4, jitter: number): number => {
    const r = RECIPES[key];
    let sum = r.credits;
    for (const id of RESOURCE_IDS) sum += purchaseCost(r.resources[id] ?? 0, resourcePrice(id, ring, jitter).buy);
    return sum;
  };

  it('own resources < bought resources < finished part', () => {
    for (const key of ALL_PART_KEYS) {
      for (const ring of RING_INDICES) {
        const buy = partBuyPrice(key, ring);
        for (const jitter of [PRICE_JITTER_MIN, 1, PRICE_JITTER_MAX]) {
          const bought = craftFromBought(key, ring, jitter);
          expect(RECIPES[key].credits).toBeLessThan(bought);
          if (buy !== null) expect(bought).toBeLessThan(buy);
        }
      }
    }
  });

  it('selling a part never returns more than its value', () => {
    for (const key of ALL_PART_KEYS) expect(partSellPrice(key)).toBeLessThan(partValue(key));
  });
});
