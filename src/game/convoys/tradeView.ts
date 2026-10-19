// The convoy trade window's view model (M4d T9): `ConvoyTradeData` from the state while the
// ship is linked to a convoy trader – the pass's rare items with their state and reason (the same checks
// in the same order as the simulation: sold, hold full, credits), the cargo the convoy buys (capped by
// what it still takes this pass, refined units first) and the tanker's fuel. Pure; the handlers turn
// the window's clicks into the `convoy*` commands.
import { purchaseCost } from '../../data/economy';
import { parsePartKey, partKey } from '../../data/parts';
import { FRAGMENTS_PER_PLAN, type PlanId } from '../../data/plans';
import { RESOURCE_IDS } from '../../data/resources';
import { DERELICT } from '../../data/sites';
import { VARIANTS } from '../../data/variants';
import { tx } from '../../i18n';
import type { GameActionInput } from '../../sim/commands';
import { convoyOffer } from '../../sim/convoys';
import { slotBought } from '../../sim/convoys/trade';
import type { ConvoyOfferItem } from '../../sim/convoys/types';
import { partHoldFree } from '../../sim/sites/terminal';
import type { SimState } from '../../sim/Simulation';
import { RES_EPS } from '../../sim/station/storage';
import { formatCredits } from '../../ui/format';
import { partLabel } from '../board/names';
import { partBaseName } from '../discovery/names';
import { traderName as radioTraderName } from '../comms/speakers';
import type { ConvoySellRow, ConvoyTradeData, ConvoyTradeHandlers, ConvoyTradeItem } from './types';

/** The trader's display name of a pass ("Free Traders 'Green Wave'") – the same ship name the radio uses. */
export function traderName(pass: string): string {
  const c = tx().guild.convoy;
  return c.trader(radioTraderName(pass, c.traders));
}

/** The plan's display name ("Mining laser – Focused"). */
const planName = (plan: PlanId): string => partBaseName(partKey(VARIANTS[plan].base, 1, plan));

function itemView(state: SimState, pass: string, item: ConvoyOfferItem, holdFree: number): ConvoyTradeItem {
  const tt = tx().guild.trade;
  const credits = state.credits;
  // the simulation's order of checks (convoyAction 'convoyBuy'): sold, hold full, credits
  let st: ConvoyTradeItem['state'] = 'buyable';
  let reason: string | null = null;
  if (slotBought(state, pass, item.slot)) {
    st = 'sold';
    reason = tt.reasons.sold;
  } else if (item.kind === 'part' && holdFree + 1e-9 < DERELICT.itemCargo) {
    st = 'holdFull';
    reason = tt.reasons.holdFull;
  } else if (item.price > credits) {
    st = 'noCredits';
    reason = tt.reasons.noCredits(formatCredits(item.price - credits));
  }
  if (item.kind === 'fragment') {
    const have = state.discovery.fragments.get(item.plan) ?? 0;
    return { slot: item.slot, title: tt.items.fragment(planName(item.plan)), detail: tt.items.fragments(have, FRAGMENTS_PER_PLAN), price: item.price, state: st, reason };
  }
  const detail = parsePartKey(item.key).variant ? tt.items.variant : tt.items.t2;
  return { slot: item.slot, title: partLabel(item.key), detail, price: item.price, state: st, reason, part: item.key };
}

/** The trade window while linked (null when not linked or the pass is no longer in flight). */
export function convoyTradeView(state: SimState): ConvoyTradeData | null {
  const link = state.convoys.link;
  const { player } = state;
  if (!link || player.destroyed || player.dock.mode !== 'flying') return null;
  const offer = convoyOffer(state, link.pass);
  if (!offer) return null;
  const holdFree = partHoldFree(state);
  const items = offer.items.map((item) => itemView(state, link.pass, item, holdFree));
  const capLeft = Math.max(0, offer.sellLeft);
  const sell: ConvoySellRow[] = [];
  for (const r of RESOURCE_IDS) {
    const unit = offer.sell[r];
    const have = player.cargo[r];
    if (unit === undefined || have <= RES_EPS) continue;
    const max = Math.min(have, capLeft);
    sell.push({ resource: r, unit, max, refined: Math.min(player.refined[r], max) });
  }
  let fuel: ConvoyTradeData['fuel'] = null;
  if (offer.fuel) {
    const tr = tx().guild.trade.reasons;
    const missing = Math.max(0, player.props.fuelCapacity - player.fuel);
    const left = Math.max(0, offer.fuel.left);
    const affordable = offer.fuel.unit > 0 ? state.credits / offer.fuel.unit : Infinity;
    const max = Math.max(0, Math.min(missing, left, affordable));
    const reason =
      max >= 1 ? null
      : left < 1 ? tr.fuelCap
      : missing < 1 ? tr.tankFull
      : tr.noCredits(formatCredits(Math.max(1, purchaseCost(1, offer.fuel.unit) - state.credits)));
    fuel = { unit: offer.fuel.unit, max, reason };
  }
  return { pass: link.pass, trader: traderName(link.pass), ring: offer.ring, items, sell, capLeft, fuel, credits: state.credits };
}

/** Fuel a "fill the tank" click buys: 'full', or the affordable whole units when the credits do not reach the full tank. */
export function fullTankAmount(state: SimState): number | 'full' {
  const link = state.convoys.link;
  const offer = link ? convoyOffer(state, link.pass) : null;
  if (!offer?.fuel || offer.fuel.unit <= 0) return 'full';
  const want = Math.min(Math.max(0, state.player.props.fuelCapacity - state.player.fuel), Math.max(0, offer.fuel.left));
  if (purchaseCost(want, offer.fuel.unit) <= state.credits) return 'full';
  // the most whole units the credits pay for (the simulation refuses a 'full' it cannot pay)
  let n = Math.floor(state.credits / offer.fuel.unit + 1e-9);
  while (n > 1 && purchaseCost(n, offer.fuel.unit) > state.credits) n--;
  return Math.max(1, n);
}

/** The window's buttons as commands. */
export function convoyTradeHandlers(send: (a: GameActionInput) => unknown, state: () => SimState): ConvoyTradeHandlers {
  return {
    buy: (slot) => void send({ type: 'convoyBuy', slot }),
    sell: (resource, qty) => void send({ type: 'convoySell', resource, qty }),
    fuel: (amount) => void send({ type: 'convoyFuel', amount: amount === 'full' ? fullTankAmount(state()) : amount }),
    unlink: () => void send({ type: 'convoyUnlink' }),
  };
}
