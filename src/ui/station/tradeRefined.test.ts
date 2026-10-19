// M4c T10: trade quotes with refined ore on the ship (M4c home and workshop): refined
// units sell first with +15 %, never stacked with the sector demand; moving refined ore to storage warns.
import { describe, expect, it } from 'vitest';
import { PRICE_JITTER_MAX, priceList, resourcePrice, saleValue } from '../../data/economy';
import { emptyCargo } from '../../data/resources';
import { DEMAND_BONUS } from '../../data/sector';
import { REFINED_BONUS, REFINED_CEILING } from '../../data/workshop';
import { refinedSaleValue, shipSaleValue } from '../../sim/ship/workshop';
import { refinedLost, sellAllValue, sellQuote } from './trade';

const prices = priceList({ ring: 1, priceJitter: { iron: 1, copper: 1, ice: 1, titanium: 1 } }).resources;

describe('sellQuote', () => {
  it('without refined units and demand it is the plain sale', () => {
    expect(sellQuote({ resource: 'copper', qty: 10, refined: 0, demandLeft: 0, unitSell: 4 })).toBe(saleValue(10, 4));
  });
  it('refined units sell first with the bonus', () => {
    expect(sellQuote({ resource: 'copper', qty: 10, refined: 4, demandLeft: 0, unitSell: 4 })).toBe(Math.floor(4 * 4 * (1 + REFINED_BONUS) + 6 * 4));
    expect(sellQuote({ resource: 'copper', qty: 10, refined: 84, demandLeft: 0, unitSell: 4 })).toBe(refinedSaleValue('copper', 10, 84, 4));
  });
  it('quotes exactly what the simulation pays (demand and refined never stack)', () => {
    expect(sellQuote({ resource: 'copper', qty: 10, refined: 10, demandLeft: 6, unitSell: 4 })).toBe(shipSaleValue('copper', 10, 10, 6, 4));
    expect(sellQuote({ resource: 'copper', qty: 5, refined: 5, demandLeft: 20, unitSell: 4 })).toBe(saleValue(5, 4 * (1 + DEMAND_BONUS)));
  });
  it('quotes the W1 refined price ceiling where it bites (ring 4 iron)', () => {
    const unitSell = resourcePrice('iron', 4, PRICE_JITTER_MAX).sell;
    expect(sellQuote({ resource: 'iron', qty: 10, refined: 10, demandLeft: 0, unitSell })).toBe(Math.floor(10 * REFINED_CEILING.iron + 1e-9));
    expect(sellQuote({ resource: 'iron', qty: 10, refined: 10, demandLeft: 0, unitSell })).toBeLessThan(Math.floor(10 * unitSell * (1 + REFINED_BONUS)));
  });
});

describe('sellAllValue with refined ore', () => {
  it('adds the refined bonus of the ship cargo', () => {
    const cargo = { ...emptyCargo(), iron: 50, copper: 10 };
    const refined = { ...emptyCargo(), iron: 20 };
    const plain = sellAllValue(cargo, prices);
    const withRefined = sellAllValue(cargo, prices, refined);
    expect(withRefined).toBe(refinedSaleValue('iron', 50, 20, prices.iron.sell) + saleValue(10, prices.copper.sell));
    expect(withRefined).toBeGreaterThan(plain);
  });
  it('and the demand of the station', () => {
    const cargo = { ...emptyCargo(), iron: 50 };
    const refined = { ...emptyCargo(), iron: 20 };
    expect(sellAllValue(cargo, prices, refined, { resource: 'iron', left: 30 })).toBe(shipSaleValue('iron', 50, 20, 30, prices.iron.sell));
  });
});

describe('refinedLost (transfer warning)', () => {
  it('warns when the transfer reaches into the refined units: refined > cargo − qty', () => {
    // 100 iron, 30 refined: the first 70 moved are raw
    expect(refinedLost(100, 30, 70)).toBe(0);
    expect(refinedLost(100, 30, 80)).toBe(10);
    expect(refinedLost(100, 30, 'all')).toBe(30);
    expect(refinedLost(100, 0, 'all')).toBe(0);
    expect(refinedLost(100, 30, null)).toBe(0);
  });
});
