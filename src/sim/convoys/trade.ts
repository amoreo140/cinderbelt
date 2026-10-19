// The convoy trade (M4d plan §2.6) – OWNED BY T5 (one helper line T7).
//
// `convoyOffer(state, pass)`: the pass's rare items (deterministic from the pass hash), cargo sale prices
// (`CONVOY.sellMult` × the ring's station sale, through `shipSaleValue` – refined bonus yes, demand
// bonus never, ≤ `CONVOY.buyCap` per pass), tanker fuel. Commands `convoyBuy { slot }`, `convoySell
// { resource; qty }`, `convoyFuel { amount }`, `convoyUnlink` – all need `convoys.link`; errors
// `notLinked`, `slotSold`, `holdFull`, `convoyCapReached`, `noTanker`, `notEnoughCredits`. Trades are
// pruned when the pass is over (`pruneTrades`).
//
// Rules:
// - Prices follow the ring at the trader when the link started (`link.since`; a ring-4 position quotes
//   ring 3 – convoys fly rings 1–3), so the window does not change under the player's cursor while the
//   convoy crosses a ring border. Without a link (a preview) the ring at the trader now.
// - Slot 0 – a plan fragment: the first plan (PLAN_IDS order) the player holds 1–2 fragments of, else one
//   by the `cache` weights from the pass hash; never a completed plan (no slot 0 when every plan is done).
//   `CONVOY.fragmentPrice[ring]`; given through `awardFragment` (the pity counters are untouched).
// - Slot 1 – a variant part (T1 in ring 1, T2 from ring 2) the player has not unlocked (any variant of the
//   tier when all are), `partValue × PART_BUY_MARKUP × RING_PART_MULT[ring] × rareMarkup` (round 5 cr);
//   it goes to the ship's part hold (`player.salvage`, `DERELICT.itemCargo` cargo per part, `holdFull`) –
//   it does not unlock the plan.
// - Slot 2 – ring 1: a T2 part of `PART_REWARD_POOL` at the ring-2 market price × rareMarkup; rings 2–3:
//   a second variant part (another key than slot 1).
// - Cargo sale: `floor2(sellMult × resourcePrice(r, ring, 1.0).sell)` per unit, value through
//   `shipSaleValue(r, qty, refined, 0, unit)` (refined units first with their bonus, never the demand bonus),
//   at most `buyCap` units per pass over all resources (a larger request sells what still fits). Ship
//   cargo only.
// - Fuel (only with a tanker): `fuelMult × fuelUnitPrice(ring)`, at most `fuelCap` units per pass.
// - Each slot once per pass (`trades.bought` mask); `trades.sold` / `trades.fuel` count the units.
import { CONVOY } from '../../data/convoys';
import { fuelUnitPrice, partBuyPrice, partValue, PART_BUY_MARKUP, purchaseCost, resourcePrice, RING_PART_MULT, round5, type RingIndex } from '../../data/economy';
import { parsePartKey, VARIANT_PART_KEYS, type PartKey } from '../../data/parts';
import { FRAGMENTS_PER_PLAN, PLAN_IDS, PLAN_WEIGHTS, type PlanId } from '../../data/plans';
import { RESOURCE_IDS, type ResourceId } from '../../data/resources';
import { DERELICT } from '../../data/sites';
import type { GameAction } from '../commands';
import { PART_REWARD_POOL } from '../contracts/generate';
import { partUnlocked } from '../discovery/archive';
import { awardFragment } from '../discovery/plans';
import { shipSaleValue } from '../ship/workshop';
import { partHoldFree } from '../sites/terminal';
import type { SimEvent, SimState } from '../Simulation';
import type { ActionError } from '../station/actions';
import { RES_EPS, take } from '../station/storage';
import { ringIndexAt } from '../world/rings';
import { hash3 } from '../world/hash';
import { unlink } from './link';
import { convoyAt, convoyPassHash, convoyPassWindow, parseConvoyPass } from './schedule';
import type { ConvoyOffer, ConvoyOfferItem, ConvoyTrade, ConvoyTradeWhat } from './types';

const CONVOY_ACTIONS = new Set<GameAction['type']>(['convoyBuy', 'convoySell', 'convoyFuel', 'convoyUnlink']);

export const isConvoyAction = (a: GameAction): boolean => CONVOY_ACTIONS.has(a.type);

/** Convoys fly rings 1–3: a ring-4 position quotes ring 3. */
const convoyRing = (distance: number): RingIndex => Math.min(3, ringIndexAt(distance)) as RingIndex;

const unit = (h: number): number => h / 4294967296;
/** Rounded down to 0.01 cr – the convoy never pays more than `sellMult` × the station's sale. */
const floor2 = (x: number): number => Math.floor(x * 100 + 1e-9) / 100;

/**
 * Credits for a convoy cargo sale: refined units first with their bonus (under the W1 refined price
 * ceiling), never the demand bonus.
 */
const convoySaleValue = (resource: ResourceId, qty: number, refined: number, unitSell: number): number => shipSaleValue(resource, qty, refined, 0, unitSell);

/** The convoy's unit price for a resource in a ring (raw; refined units through `convoySaleValue`). */
export const convoySellUnit = (resource: ResourceId, ring: RingIndex): number => floor2(CONVOY.sellMult * resourcePrice(resource, ring, 1).sell);

/** The convoy's fuel price per unit in a ring. */
export const convoyFuelUnit = (ring: RingIndex): number => CONVOY.fuelMult * fuelUnitPrice(ring);

/** The price of a variant part at a convoy. */
const variantPrice = (key: PartKey, ring: RingIndex): number => round5(partValue(key) * PART_BUY_MARKUP * RING_PART_MULT[ring] * CONVOY.rareMarkup);

/** The trade record of a pass (zeros when nothing was traded yet). */
export const tradeOf = (state: SimState, pass: string): ConvoyTrade => state.convoys.trades.get(pass) ?? { bought: 0, sold: 0, fuel: 0 };

/** Was the rare item in `slot` of `pass` bought already? */
export const slotBought = (state: SimState, pass: string, slot: number): boolean => (tradeOf(state, pass).bought & (1 << slot)) !== 0;

/** The plan of the fragment slot: the first plan with 1–2 fragments, else by the cache weights; never a completed one. */
function fragmentPlan(state: SimState, h: number): PlanId | null {
  const d = state.discovery;
  const started = PLAN_IDS.find((p) => !d.plans.has(p) && (d.fragments.get(p) ?? 0) > 0 && (d.fragments.get(p) ?? 0) < FRAGMENTS_PER_PLAN);
  if (started) return started;
  const open = PLAN_IDS.filter((p) => !d.plans.has(p) && (PLAN_WEIGHTS.cache[p] ?? 0) > 0);
  const total = open.reduce((a, p) => a + (PLAN_WEIGHTS.cache[p] ?? 0), 0);
  if (total <= 0) return PLAN_IDS.find((p) => !d.plans.has(p)) ?? null;
  let r = unit(hash3(h, 0x0f1a, 0)) * total;
  for (const p of open) {
    r -= PLAN_WEIGHTS.cache[p] ?? 0;
    if (r < 0) return p;
  }
  return open[open.length - 1] ?? null;
}

/** A variant part of the ring's tier the player has not unlocked (any of the tier when all are), other than `not`. */
function variantPart(state: SimState, ring: RingIndex, h: number, salt: number, not: PartKey | null): PartKey | null {
  const tier = ring === 1 ? 1 : 2;
  const ofTier = VARIANT_PART_KEYS.filter((k) => parsePartKey(k).tier === tier && k !== not);
  const locked = ofTier.filter((k) => !partUnlocked(state, k));
  const pool = locked.length > 0 ? locked : ofTier;
  if (pool.length === 0) return null;
  return pool[Math.floor(unit(hash3(h, salt, 0)) * pool.length)] ?? null;
}

/** The ring prices of a pass follow: the trader's position when the link started, else now. */
function offerRing(state: SimState, pass: string): RingIndex | null {
  const link = state.convoys.link;
  const at = link && link.pass === pass ? link.since : state.tick;
  const pose = convoyAt(state.seed, pass, at) ?? convoyAt(state.seed, pass, state.tick);
  if (!pose) return null;
  const t = pose.ships[0]!.pos;
  return convoyRing(Math.hypot(t.x, t.y));
}

/** The trade of a pass for the player now, or null (pass not in flight). */
export function convoyOffer(state: SimState, pass: string): ConvoyOffer | null {
  const id = parseConvoyPass(pass);
  const pose = convoyAt(state.seed, pass, state.tick);
  const ring = offerRing(state, pass);
  if (!id || !pose || ring === null) return null;
  const h = convoyPassHash(state.seed, id.lane, id.n);
  const items: ConvoyOfferItem[] = [];
  const plan = fragmentPlan(state, h);
  if (plan) items.push({ slot: 0, kind: 'fragment', plan, price: CONVOY.fragmentPrice[ring as 1 | 2 | 3] });
  const first = variantPart(state, ring, h, 0x51a1, null);
  if (first) items.push({ slot: 1, kind: 'part', key: first, price: variantPrice(first, ring) });
  if (ring === 1) {
    const key = PART_REWARD_POOL[Math.floor(unit(hash3(h, 0x51a2, 0)) * PART_REWARD_POOL.length)]!;
    items.push({ slot: 2, kind: 'part', key, price: round5((partBuyPrice(key, 2) ?? 0) * CONVOY.rareMarkup) });
  } else {
    const second = variantPart(state, ring, h, 0x51a3, first);
    if (second) items.push({ slot: 2, kind: 'part', key: second, price: variantPrice(second, ring) });
  }
  const trade = tradeOf(state, pass);
  const sell: ConvoyOffer['sell'] = {};
  for (const r of RESOURCE_IDS) sell[r] = convoySellUnit(r, ring);
  const tanker = pose.ships.some((s) => s.kind === 'tanker');
  return {
    pass,
    ring,
    items,
    sell,
    sellLeft: Math.max(0, CONVOY.buyCap - trade.sold),
    fuel: tanker ? { unit: convoyFuelUnit(ring), left: Math.max(0, CONVOY.fuelCap - trade.fuel) } : null,
  };
}

/** Drops the trades of passes that are over (and of ids that are no pass at all). */
export function pruneTrades(state: SimState): void {
  const trades = state.convoys.trades;
  if (trades.size === 0) return;
  for (const pass of [...trades.keys()]) {
    const w = convoyPassWindow(state.seed, pass);
    if (!w || state.tick + 1 >= w.end) trades.delete(pass);
  }
}

const ok = (reqId: number): SimEvent => ({ type: 'actionResult', reqId, ok: true });
const fail = (reqId: number, reason: ActionError): SimEvent[] => [{ type: 'actionResult', reqId, ok: false, reason }];

function record(state: SimState, pass: string, change: (t: ConvoyTrade) => void): void {
  const t = { ...tradeOf(state, pass) };
  change(t);
  state.convoys.trades.set(pass, t);
}

const traded = (pass: string, what: ConvoyTradeWhat, credits: number, reason: 'buy' | 'sell' | 'refuel'): SimEvent[] =>
  credits !== 0
    ? [
        { type: 'creditsChanged', delta: credits, reason },
        { type: 'convoyTraded', pass, what, credits },
      ]
    : [{ type: 'convoyTraded', pass, what, credits }];

/** A convoy command (linked to a trader, in flight). */
export function convoyAction(state: SimState, action: GameAction): SimEvent[] {
  const { reqId } = action;
  const link = state.convoys.link;
  const { player } = state;
  if (!link || player.destroyed || player.dock.mode !== 'flying') return fail(reqId, 'notLinked');
  if (action.type === 'convoyUnlink') {
    const events: SimEvent[] = [ok(reqId)];
    unlink(state, 'player', events);
    return events;
  }
  const offer = convoyOffer(state, link.pass);
  if (!offer) return fail(reqId, 'notLinked');
  const pass = link.pass;
  switch (action.type) {
    case 'convoyBuy': {
      const item = offer.items.find((i) => i.slot === action.slot);
      if (!item) return fail(reqId, 'invalidQuantity');
      if (slotBought(state, pass, item.slot)) return fail(reqId, 'slotSold');
      if (item.kind === 'part' && partHoldFree(state) + 1e-9 < DERELICT.itemCargo) return fail(reqId, 'holdFull');
      if (item.price > state.credits) return fail(reqId, 'notEnoughCredits');
      state.credits -= item.price;
      record(state, pass, (t) => (t.bought |= 1 << item.slot));
      const events: SimEvent[] = [ok(reqId), ...traded(pass, item.kind, -item.price, 'buy')];
      if (item.kind === 'fragment') awardFragment(state, item.plan, events);
      else player.salvage[item.key] = (player.salvage[item.key] ?? 0) + 1;
      return events;
    }
    case 'convoySell': {
      const r = action.resource;
      if (!RESOURCE_IDS.includes(r)) return fail(reqId, 'invalidQuantity');
      const capLeft = offer.sellLeft;
      if (capLeft <= RES_EPS) return fail(reqId, 'convoyCapReached');
      const have = player.cargo[r];
      let amount: number;
      if (action.qty === 'all') {
        if (have <= RES_EPS) return fail(reqId, 'invalidQuantity');
        amount = Math.min(have, capLeft);
      } else {
        if (!Number.isFinite(action.qty) || action.qty <= 0 || action.qty > have + RES_EPS) return fail(reqId, 'invalidQuantity');
        amount = Math.min(action.qty, have, capLeft);
      }
      const value = convoySaleValue(r, amount, player.refined[r], offer.sell[r]!);
      player.refined[r] = Math.max(0, player.refined[r] - amount);
      if (amount >= have - RES_EPS) player.cargo[r] = 0;
      else take(player.cargo, r, amount);
      state.credits += value;
      record(state, pass, (t) => (t.sold += amount));
      return [ok(reqId), ...traded(pass, 'sell', value, 'sell')];
    }
    case 'convoyFuel': {
      if (!offer.fuel) return fail(reqId, 'noTanker');
      if (offer.fuel.left <= RES_EPS) return fail(reqId, 'convoyCapReached');
      const missing = player.props.fuelCapacity - player.fuel;
      if (missing <= RES_EPS) return fail(reqId, 'tankFull');
      if (action.amount !== 'full' && (!Number.isFinite(action.amount) || action.amount <= 0)) return fail(reqId, 'invalidQuantity');
      const amount = Math.min(action.amount === 'full' ? missing : action.amount, missing, offer.fuel.left);
      const cost = purchaseCost(amount, offer.fuel.unit);
      if (cost > state.credits) return fail(reqId, 'notEnoughCredits');
      state.credits -= cost;
      player.fuel = Math.min(player.props.fuelCapacity, player.fuel + amount);
      record(state, pass, (t) => (t.fuel += amount));
      return [ok(reqId), ...traded(pass, 'fuel', -cost, 'refuel')];
    }
    default:
      return fail(reqId, 'serviceUnavailable');
  }
}
