import { describe, expect, it } from 'vitest';
import { purchaseCost } from '../../data/economy';
import type { ConvoySellRow, ConvoyTradeItem } from '../../game/convoys/types';
import { shipSaleValue } from '../../sim/ship/workshop';
import { arrowStep, fuelButtons, fuelPrice, itemRows, sellAmount, sellValue } from './tradeLayout';

const row = (max: number, refined = 0, unit = 2.6): ConvoySellRow => ({ resource: 'iron', unit, max, refined });

describe('sellAmount', () => {
  it('sells the chosen step, everything the row offers at Max or when the step is larger', () => {
    expect(sellAmount(10, row(120))).toBe(10);
    expect(sellAmount(50, row(120))).toBe(50);
    expect(sellAmount('max', row(120))).toBe('all');
    expect(sellAmount(50, row(30))).toBe('all');
  });

  it('nothing below one unit', () => {
    expect(sellAmount('max', row(0.4))).toBeNull();
    expect(sellAmount(10, row(0))).toBeNull();
  });
});

describe('sellValue', () => {
  it('pays through shipSaleValue: refined units first, never the demand bonus', () => {
    const r = row(120, 40);
    expect(sellValue(r, 'all')).toBe(shipSaleValue('iron', 120, 40, 0, 2.6));
    expect(sellValue(r, 10)).toBe(shipSaleValue('iron', 10, 10, 0, 2.6));
    expect(sellValue(row(30), 50)).toBe(shipSaleValue('iron', 30, 0, 0, 2.6));
  });
});

describe('fuelButtons', () => {
  it('a 10-unit top-up only while more than 10 can be bought', () => {
    expect(fuelButtons({ unit: 3.3, max: 60, reason: null })).toEqual({ step: 10, full: 60 });
    expect(fuelButtons({ unit: 3.3, max: 8.6, reason: null })).toEqual({ step: null, full: 8 });
    expect(fuelButtons({ unit: 3.3, max: 0.5, reason: 'full' })).toEqual({ step: null, full: null });
  });

  it('prices fuel like the simulation', () => {
    expect(fuelPrice(3.3, 10)).toBe(purchaseCost(10, 3.3));
  });
});

describe('itemRows and arrowStep', () => {
  it('orders the items by slot', () => {
    const item = (slot: number): ConvoyTradeItem => ({ slot, title: `s${slot}`, detail: '', price: 1, state: 'buyable', reason: null });
    expect(itemRows([item(2), item(0), item(1)]).map((i) => i.slot)).toEqual([0, 1, 2]);
  });

  it('wraps around and starts at the ends', () => {
    expect(arrowStep(4, 3, 1)).toBe(0);
    expect(arrowStep(4, 0, -1)).toBe(3);
    expect(arrowStep(4, -1, 1)).toBe(0);
    expect(arrowStep(4, -1, -1)).toBe(3);
    expect(arrowStep(0, -1, 1)).toBe(-1);
  });
});
