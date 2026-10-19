import { describe, expect, it } from 'vitest';
import { formatAmount, formatCredits, formatPrice } from '../format';
import { buyQuantity, maxAffordableUnits, refuelQuote, sellAllValue, sellQuantity, transferQuantity } from './trade';
import { priceList } from '../../data/economy';

const prices = priceList({ ring: 1, priceJitter: { iron: 1, copper: 1, ice: 1, titanium: 1 } }).resources;

describe('formatting', () => {
  it('formats credits with spaces as thousands separators', () => {
    expect(formatCredits(0)).toBe('0 kr');
    expect(formatCredits(250)).toBe('250 kr');
    expect(formatCredits(1240)).toBe('1 240 kr');
    expect(formatCredits(1234567)).toBe('1 234 567 kr');
    expect(formatCredits(-300)).toBe('−300 kr');
  });

  it('formats amounts and prices with a decimal comma', () => {
    expect(formatAmount(52.34)).toBe('52,3');
    expect(formatAmount(0)).toBe('0,0');
    expect(formatPrice(5)).toBe('5,0');
    expect(formatPrice(29.25)).toBe('29,3');
  });
});

describe('sellQuantity', () => {
  it('sells everything with Max or when the chosen amount covers the stock', () => {
    expect(sellQuantity('max', 52.3)).toBe('all');
    expect(sellQuantity(100, 52.3)).toBe('all');
    expect(sellQuantity(10, 52.3)).toBe(10);
    expect(sellQuantity(10, 10)).toBe('all');
  });

  it('returns null with nothing to sell', () => {
    expect(sellQuantity(1, 0)).toBeNull();
    expect(sellQuantity('max', 1e-12)).toBeNull();
  });
});

describe('buying', () => {
  it('computes the largest affordable amount', () => {
    expect(maxAffordableUnits(250, 5)).toBe(50);
    expect(maxAffordableUnits(26, 8.8)).toBe(2);
    expect(maxAffordableUnits(27, 8.8)).toBe(3);
    expect(maxAffordableUnits(0, 3)).toBe(0);
  });

  it('chooses the purchase amount or explains why not', () => {
    expect(buyQuantity('max', 250, 5)).toEqual({ qty: 50 });
    expect(buyQuantity(10, 250, 5)).toEqual({ qty: 10 });
    expect(buyQuantity(100, 250, 5)).toEqual({ qty: null, reason: 'notEnoughCredits' });
    expect(buyQuantity('max', 4, 5)).toEqual({ qty: null, reason: 'notEnoughCredits' });
  });
});

describe('transferQuantity', () => {
  it('limits loading by free cargo space', () => {
    expect(transferQuantity('max', 100, 30)).toBe(30);
    expect(transferQuantity(10, 100, 30)).toBe(10);
    expect(transferQuantity(100, 50, Infinity)).toBe('all');
    expect(transferQuantity(1, 0, 30)).toBeNull();
    expect(transferQuantity(1, 5, 0)).toBeNull();
  });
});

describe('sellAllValue', () => {
  it('sums the floored sale value of every resource', () => {
    expect(sellAllValue({ iron: 52.3, copper: 31, ice: 12.9, titanium: 0 }, prices)).toBe(167 + 124 + 30);
  });
});

describe('refuelQuote', () => {
  it('quotes ice and credit refuelling', () => {
    const q = refuelQuote({ fuel: 74, capacity: 120, ice: 12.9, credits: 1240, ring: 1 });
    expect(q.missing).toBe(46);
    expect(q.iceUsed).toBeCloseTo(12.9);
    expect(q.iceFuel).toBeCloseTo(25.8);
    expect(q.fullCost).toBe(92);
    expect(q.tenCost).toBe(20);
    expect(q.affordableFull).toBe(true);
  });

  it('caps ice use at the missing fuel and reports unaffordable fills', () => {
    const q = refuelQuote({ fuel: 110, capacity: 120, ice: 30, credits: 5, ring: 1 });
    expect(q.iceUsed).toBe(5);
    expect(q.iceFuel).toBe(10);
    expect(q.affordableFull).toBe(false);
    expect(q.affordableUnits).toBeCloseTo(2.5);
  });
});
