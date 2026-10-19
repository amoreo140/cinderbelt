// View models of the convoy trade (M4d) – the "Convoy trade" window, open while
// the ship is linked to a convoy trader. Built by T9 (src/game/convoys/tradeView.ts) from `SimState`
// (`convoyOffer`), drawn by T11 (src/ui/convoys/ConvoyTrade.tsx). Every text is ready to show (i18n done).
//
// User decision 2026-10-16: no friendly fire – a pass's trade is never closed by a shot (no `closed`).
import type { RingIndex } from '../../data/economy';
import type { PartKey } from '../../data/parts';
import type { ResourceId } from '../../data/resources';

/** buyable; sold = bought this pass already; noCredits = not enough credits; holdFull = the part hold is full. */
export type ConvoyItemState = 'buyable' | 'sold' | 'noCredits' | 'holdFull';

/** A rare item of the pass (slot 0 plan fragment, 1 variant part, 2 T2 part in ring 1 / a second variant). */
export interface ConvoyTradeItem {
  slot: number;
  /** "Blueprint fragment: Heavy laser", "Engine T1 · Enduring". */
  title: string;
  /** Why / what it does ("2 / 3 fragmenty", the part's effect). */
  detail: string;
  /** Price (kr). */
  price: number;
  state: ConvoyItemState;
  /** The reason line of a state other than buyable ("Short 300 cr", "Parts hold full"), or null. */
  reason: string | null;
  /** A part item: its key (the window shows the part icon in its tier brackets); absent = a plan fragment. */
  part?: PartKey;
}

/** A resource the convoy buys from the ship's cargo. */
export interface ConvoySellRow {
  resource: ResourceId;
  /** Unit price for raw ore (kr; refined units sell through `shipSaleValue` with the bonus). */
  unit: number;
  /** Units the player can sell now (cargo, capped by what the convoy still takes). */
  max: number;
  /** Refined units among `max` (sold first). */
  refined: number;
}

export interface ConvoyTradeData {
  /** The pass id `cv:<lane>@<n>`. */
  pass: string;
  /** The trader's display name. */
  trader: string;
  /** Ring at the trader (prices). */
  ring: RingIndex;
  items: ConvoyTradeItem[];
  sell: ConvoySellRow[];
  /** Cargo units the convoy still buys this pass (≤ CONVOY.buyCap). */
  capLeft: number;
  /**
   * Tanker fuel: unit price, units the player can buy now and why none when `max` < 1 ("The tank is full",
   * "Short 12 cr", "The tanker will sell no more" – `cech.trade.reasons`); null = no tanker.
   */
  fuel: { unit: number; max: number; reason: string | null } | null;
  /** The player's credits (the header; prices are checked against them by the view model). */
  credits: number;
}

export interface ConvoyTradeHandlers {
  buy(slot: number): void;
  sell(resource: ResourceId, qty: number | 'all'): void;
  fuel(amount: number | 'full'): void;
  /** "Unlink" – leave the link. */
  unlink(): void;
}
