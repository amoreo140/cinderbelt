import { describe, expect, it } from 'vitest';
import { MIN_REFERENCE_INCOME } from '../../data/contracts';
import { createGrid } from '../ship/grid';
import { createStarterShip } from '../ship/presets';
import { computeProperties } from '../ship/properties';
import { averageSellPrice, bestUnitsPerHour, contractRep, contractReward, miningIncome, miningUnitsPerHour, referenceIncome } from './reward';

const starter = computeProperties(createStarterShip());
const miner = computeProperties(
  createGrid([
    ['cockpit', 1, 0],
    ['gyro', 0, 0],
    ['miningLaser', 2, 0, 0],
    ['miningLaser', 2, 1, 0],
    ['miningLaser', 2, -1, 0],
    ['reactor', -1, 0],
    ['largeCargo', -1, 1],
    ['largeCargo', -1, -3],
    ['fuelTank', 1, 1],
    ['radar', 1, -1],
    ['engine', -2, 0, 0],
    ['engine', 1, 2, 3],
    ['engine', 1, -2, 1],
  ]),
);

describe('mining income model', () => {
  it('prices the ring 1 mix like the econ model (3.28 cr/u)', () => {
    expect(averageSellPrice(1)).toBeCloseTo(3.28, 2);
    expect(averageSellPrice(2)).toBeGreaterThan(averageSellPrice(1));
  });

  it('gives the starter ship about 9–10 k cr/h in ring 1', () => {
    const income = miningIncome(starter, 1);
    expect(income).toBeGreaterThan(8000);
    expect(income).toBeLessThan(11000);
    expect(miningIncome(starter, 1, 2)).toBeGreaterThan(income);
  });

  it('a ship without lasers earns nothing but still gets a duration estimate', () => {
    const none = { lasers: [], cargoCapacity: 100 };
    expect(miningUnitsPerHour(none, 1)).toBe(0);
    expect(bestUnitsPerHour([none], 1)).toBe(1000);
  });

  it('the reference income is the best ship, at least the ring minimum', () => {
    expect(referenceIncome([starter], 1)).toBe(MIN_REFERENCE_INCOME[1]);
    expect(miningIncome(miner, 1)).toBeGreaterThan(MIN_REFERENCE_INCOME[1]);
    expect(referenceIncome([starter, miner], 1)).toBe(miningIncome(miner, 1));
    // P2 minimum (M3.5b: 22k) – the starter ship gets the minimum, a fully equipped miner more
    expect(referenceIncome([starter], 2)).toBe(MIN_REFERENCE_INCOME[2]);
    expect(referenceIncome([miner], 2)).toBe(Math.max(MIN_REFERENCE_INCOME[2], miningIncome(miner, 2)));
  });
});

describe('contractReward', () => {
  it('follows the spec formula and rounds to 5 cr', () => {
    // 10 min × 12 000 × 0,8 = 1 600
    expect(contractReward({ type: 'delivery', seconds: 600, risk: 0, bonus: 0, refIncome: 12_000 })).toBe(1600);
    // + risk 0.25, + sector 0.3, + goods 128
    expect(contractReward({ type: 'delivery', seconds: 600, risk: 0.25, bonus: 0.3, refIncome: 12_000, extra: 128 })).toBe(2730);
    expect(contractReward({ type: 'hunt', seconds: 600, risk: 0, bonus: 0, refIncome: 12_000 })).toBe(2200);
    expect(contractReward({ type: 'survey', seconds: 333, risk: 0, bonus: 0, refIncome: 12_000 }) % 5).toBe(0);
  });

  it('pays reputation by duration', () => {
    expect(contractRep(0)).toBe(12);
    expect(contractRep(600)).toBe(32);
  });
});
