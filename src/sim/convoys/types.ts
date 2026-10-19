// Convoys of the Free Traders in the simulation (M4d plan §2.5–§2.7, §3): the published lane schedule
// (pure – nothing about a scheduled pass is saved except its trades), the link (a moving berth at the
// trader's trade port), the convoy trade and the escort contract's convoys. Pure data – the logic is in
// the other files of this folder (see index.ts). Saved from V20 (T15): `trades`, `link`, `escorts`.
//
// User decision 2026-10-16: NO friendly fire – player shots never hit a convoy, so a pass's trade is
// never closed by a shot (no `closed` set, no `hostile` / `closed` link rejections).
import type { ConvoyShipKind } from '../../data/convoys';
import type { PartKey } from '../../data/parts';
import type { PlanId } from '../../data/plans';
import type { RingIndex } from '../../data/economy';
import type { Vec2 } from '../math/vec2';
import type { LaneId } from '../regions/lanes';

export type { ConvoyShipKind } from '../../data/convoys';

/** Out along the lane, the turn-around at its end, back home. */
export type ConvoyLeg = 'out' | 'turn' | 'back';

/** A scheduled convoy pass (`cv:<lane>@<n>`, n = departure index) at a tick (`convoyAt`). */
export interface ConvoyPose {
  pass: string;
  lane: LaneId;
  /** Trader first, then the tanker and the cosmetic cutter when the pass has them. */
  ships: { kind: ConvoyShipKind; pos: Vec2; heading: number }[];
  /** The convoy's velocity (all ships fly together). */
  vel: Vec2;
  leg: ConvoyLeg;
}

/** What the player traded with a pass (pruned when the pass is over). */
export interface ConvoyTrade {
  /** Bit mask of the rare item slots bought. */
  bought: number;
  /** Cargo units sold (all resources together, ≤ CONVOY.buyCap). */
  sold: number;
  /** Fuel units bought (≤ CONVOY.fuelCap). */
  fuel: number;
}

/** The ship is linked to a pass's trader (pinned beside the trade port). */
export interface ConvoyLink {
  pass: string;
  /** Tick the link started. */
  since: number;
}

/** An escort contract's convoy (by contract serial). */
export interface EscortState {
  /** Arc length flown along the stretch (u from `from`). */
  progress: number;
  state: 'waiting' | 'moving' | 'stopped' | 'done';
  /** Tick it departed (null while waiting at the meeting point). */
  departed: number | null;
  /** Seconds the player has been farther than `ESCORT.awayRadius` (failure `abandoned` at `awaySeconds`). */
  away: number;
  /** Tick a stopped convoy may resume. */
  stopUntil: number;
  /** Bit mask of the ambush points that fired. */
  fired: number;
  /** Hull of each convoy ship (trader first, then the tanker when there is one). */
  hulls: number[];
  /** Credits taken as the deposit on acceptance (paid back on a free cancel or on arrival; 0 / missing = none held). */
  deposit?: number;
}

export interface ConvoysState {
  trades: Map<string, ConvoyTrade>;
  link: ConvoyLink | null;
  escorts: Map<number, EscortState>;
}

/** A rare item of a pass (slot 0 a plan fragment, slot 1 a variant part, slot 2 a T2 part in ring 1 / a second variant). */
export type ConvoyOfferItem =
  | { slot: number; kind: 'fragment'; plan: PlanId; price: number }
  | { slot: number; kind: 'part'; key: PartKey; price: number };

/** The trade of a linked pass (`convoyOffer`). */
export interface ConvoyOffer {
  pass: string;
  /** Ring at the trader's position (prices). */
  ring: RingIndex;
  items: ConvoyOfferItem[];
  /** The unit price the convoy pays for each resource (raw; refined units through `shipSaleValue`). */
  sell: Partial<Record<'iron' | 'copper' | 'titanium' | 'ice', number>>;
  /** Cargo units the convoy still buys this pass. */
  sellLeft: number;
  /** Tanker fuel (null without a tanker): unit price and units left this pass. */
  fuel: { unit: number; left: number } | null;
}

export type LinkRejectReason = 'tooFar' | 'tooFast' | 'pirates';
export type ConvoyUnlinkReason = 'player' | 'turnaround' | 'pirates' | 'passOver' | 'blocked';
/** What was traded (`convoyTraded`). */
export type ConvoyTradeWhat = 'fragment' | 'part' | 'sell' | 'fuel';

/** Sim events of convoys (part of SimEvent). */
export type ConvoyEvent =
  | { type: 'convoyLinked'; pass: string }
  | { type: 'convoyUnlinked'; pass: string; reason: ConvoyUnlinkReason }
  /** F at a trader refused: the values at the request (distance to the port gap, relative speed). */
  | { type: 'linkRejected'; reason: LinkRejectReason; distance: number; speed: number }
  /** `credits` = paid (negative) or received (positive). */
  | { type: 'convoyTraded'; pass: string; what: ConvoyTradeWhat; credits: number }
  | { type: 'escortDeparted'; serial: number }
  | { type: 'escortStopped'; serial: number }
  | { type: 'escortAmbush'; serial: number; pos: Vec2 };
