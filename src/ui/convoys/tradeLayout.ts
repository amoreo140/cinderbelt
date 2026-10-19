// Pure layout helpers of the convoy trade window (M4d plan T11, §2.6): the quantity a sell button sells,
// what it pays (the same `shipSaleValue` the simulation pays with – refined first, never the demand
// bonus), the fuel buttons and the sheet's keyboard order. The view model (`ConvoyTradeData`) comes
// from the game layer (T9); this file only lays it out.
import { purchaseCost } from '../../data/economy';
import type { ConvoySellRow, ConvoyTradeData, ConvoyTradeItem } from '../../game/convoys/types';
import { sellQuote } from '../station/trade';

/** The sell quantity choice of the window (one for every row, like the station market). */
export type TradeQty = 10 | 50 | 'max';
export const TRADE_QTY: readonly TradeQty[] = [10, 50, 'max'];

const EPS = 1e-9;

/** Units a sell click sells: `'all'` = everything the row offers (`max`), null = nothing to sell. */
export function sellAmount(mode: TradeQty, row: Pick<ConvoySellRow, 'max'>): number | 'all' | null {
  if (row.max < 1 - EPS) return null;
  if (mode === 'max' || mode >= row.max - EPS) return 'all';
  return mode;
}

/** Credits a sale of `qty` pays (refined units first with their bonus; a convoy never pays the demand bonus). */
export function sellValue(row: ConvoySellRow, qty: number | 'all'): number {
  const n = qty === 'all' ? row.max : Math.min(qty, row.max);
  return sellQuote({ resource: row.resource, qty: n, refined: Math.min(row.refined, n), demandLeft: 0, unitSell: row.unit });
}

/** The fuel buttons: a 10-unit top-up while more than 10 can be bought, and "fill the tank" (= max). */
export function fuelButtons(fuel: NonNullable<ConvoyTradeData['fuel']>): { step: number | null; full: number | null } {
  const max = Math.floor(fuel.max + EPS);
  if (max < 1) return { step: null, full: null };
  return { step: max > 10 ? 10 : null, full: max };
}

/** The price of `units` of tanker fuel (the simulation charges `purchaseCost` too). */
export const fuelPrice = (unit: number, units: number): number => purchaseCost(units, unit);

/** Items in slot order; a sold item keeps its row (it reads "Sold"). */
export const itemRows = (items: readonly ConvoyTradeItem[]): ConvoyTradeItem[] => [...items].sort((a, b) => a.slot - b.slot);

/** The next element for an arrow key in `list` (wraps around); -1 = none focusable. */
export function arrowStep(count: number, current: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0) return dir > 0 ? 0 : count - 1;
  return (current + dir + count) % count;
}
