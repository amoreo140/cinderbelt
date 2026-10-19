// M4d T5: the convoy trade (plan §2.6) – the rare items of a pass (each once, exact credits, the fragment
// never of a completed plan, the variant part not unlocking its plan, the part hold), the cargo sale
// (≤ 200 u per pass over all resources, refined units first through `shipSaleValue`, never the demand
// bonus, below the station sale), tanker fuel (only with a tanker, capped), pruning and the no-arbitrage
// bounds the oracle relies on.
import { describe, expect, it } from 'vitest';
import { CONVOY } from '../../data/convoys';
import {
  fuelUnitPrice,
  partBuyPrice,
  partValue,
  PART_BUY_MARKUP,
  PRICE_JITTER_MIN,
  purchaseCost,
  resourcePrice,
  RING_INDICES,
  RING_PART_MULT,
  round5,
  saleValue,
} from '../../data/economy';
import { parsePartKey } from '../../data/parts';
import { PLAN_IDS } from '../../data/plans';
import { RESOURCE_IDS } from '../../data/resources';
import { DERELICT } from '../../data/sites';
import { PART_REWARD_POOL } from '../contracts/generate';
import { partUnlocked } from '../discovery/archive';
import { flyingAt, ofType, run } from '../discovery/testing';
import { shipSaleValue } from '../ship/workshop';
import type { Simulation } from '../Simulation';
import { partHoldFree } from '../sites/terminal';
import { act } from '../station/testHarness';
import { linkedTo } from './convoyTesting';
import { convoyComposition, convoyPassWindow } from './schedule';
import { convoyFuelUnit, convoyOffer, convoySellUnit } from './trade';

const SEED = 3;
const T = 60;

const passWith = (tanker: boolean): number => {
  let n = 1;
  while (convoyComposition(SEED, 'A', n).tanker !== tanker) n++;
  return n;
};
const N_TANKER = passWith(true);
const N_PLAIN = passWith(false);

const result = (events: ReturnType<typeof act>) => events.find((e) => e.type === 'actionResult');

const linked = (n = N_TANKER, seconds = 60): Simulation => {
  const sim = linkedTo(SEED, 'A', n, seconds);
  sim.state.credits = 50_000;
  return sim;
};

const offerOf = (sim: Simulation) => convoyOffer(sim.state, sim.state.convoys.link!.pass)!;

describe('the offer of a pass', () => {
  it('ring 1: a plan fragment, a T1 variant part, a T2 part at the ring-2 price × 1.2', () => {
    const sim = linked();
    const offer = offerOf(sim);
    expect(offer.ring).toBe(1);
    expect(offer.items.map((i) => [i.slot, i.kind])).toEqual([
      [0, 'fragment'],
      [1, 'part'],
      [2, 'part'],
    ]);
    const [frag, variant, t2] = offer.items;
    expect(frag!.price).toBe(CONVOY.fragmentPrice[1]);
    if (variant!.kind !== 'part' || t2!.kind !== 'part') throw new Error('parts expected');
    expect(parsePartKey(variant!.key)).toMatchObject({ tier: 1 });
    expect(parsePartKey(variant!.key).variant).toBeDefined();
    expect(variant!.price).toBe(round5(partValue(variant!.key) * PART_BUY_MARKUP * RING_PART_MULT[1] * CONVOY.rareMarkup));
    expect(PART_REWARD_POOL).toContain(t2!.key);
    expect(t2!.price).toBe(round5(partBuyPrice(t2!.key, 2)! * CONVOY.rareMarkup));
    // bound 3: parts at a convoy cost ≥ 1.2 × the market price
    expect(variant!.price).toBeGreaterThanOrEqual(round5(partValue(variant!.key) * PART_BUY_MARKUP) * 1.2 - 5);
  });

  it('ring 2: two different T2 variant parts and the ring-2 fragment price', () => {
    const w = convoyPassWindow(SEED, `cv:A@${N_TANKER}`)!;
    // far out on the lane (ring 2), still on the outbound leg
    const sim = linked(N_TANKER, Math.floor((w.turn - w.depart) / T) - 60);
    const offer = offerOf(sim);
    expect(offer.ring).toBeGreaterThanOrEqual(2);
    expect(offer.items[0]).toMatchObject({ slot: 0, kind: 'fragment', price: CONVOY.fragmentPrice[offer.ring as 2 | 3] });
    const [a, b] = [offer.items[1]!, offer.items[2]!];
    if (a.kind !== 'part' || b.kind !== 'part') throw new Error('parts expected');
    expect(a.key).not.toBe(b.key);
    for (const p of [a, b]) {
      expect(parsePartKey(p.key)).toMatchObject({ tier: 2 });
      expect(parsePartKey(p.key).variant).toBeDefined();
    }
  });

  it('is deterministic per pass and the same for the same state', () => {
    expect(offerOf(linked())).toEqual(offerOf(linked()));
  });

  it('the fragment is of a started plan first, never of a completed one', () => {
    const sim = linked();
    const d = sim.state.discovery;
    d.fragments.set(PLAN_IDS[3]!, 2);
    d.fragments.set(PLAN_IDS[5]!, 1);
    expect(offerOf(sim).items[0]).toMatchObject({ kind: 'fragment', plan: PLAN_IDS[3] });
    d.fragments.clear();
    for (const p of PLAN_IDS.slice(1)) d.plans.add(p);
    expect(offerOf(sim).items[0]).toMatchObject({ kind: 'fragment', plan: PLAN_IDS[0] });
    d.plans.add(PLAN_IDS[0]!);
    expect(offerOf(sim).items.map((i) => i.slot)).toEqual([1, 2]);
  });

  it('cargo sale prices: 0.9 × the station sale at jitter 1.0, below the worst station anywhere in the ring', () => {
    for (const ring of RING_INDICES) {
      for (const r of RESOURCE_IDS) {
        const unit = convoySellUnit(r, ring);
        expect(unit).toBeLessThanOrEqual(CONVOY.sellMult * resourcePrice(r, ring, 1).sell + 1e-9);
        expect(unit).toBeGreaterThan(CONVOY.sellMult * resourcePrice(r, ring, 1).sell - 0.01);
        // bound 2: the convoy never pays more than the cheapest station of the ring for the same unit
        expect(unit).toBeLessThan(resourcePrice(r, ring, PRICE_JITTER_MIN).sell + 1e-9);
        // bound 1: never above any buy price (a buy → convoy-sell loop loses)
        for (const other of RING_INDICES) expect(unit).toBeLessThan(resourcePrice(r, other, PRICE_JITTER_MIN).buy);
      }
      expect(convoyFuelUnit(ring)).toBeCloseTo(CONVOY.fuelMult * fuelUnitPrice(ring), 9);
    }
  });
});

describe('buying rare items', () => {
  it('each slot once per pass, the credits exact', () => {
    const sim = linked();
    const before = sim.state.credits;
    const item = offerOf(sim).items[1]!;
    const events = act(sim, { type: 'convoyBuy', slot: 1 });
    expect(result(events)).toMatchObject({ ok: true });
    expect(sim.state.credits).toBe(before - item.price);
    expect(ofType(events, 'creditsChanged')).toEqual([{ type: 'creditsChanged', delta: -item.price, reason: 'buy' }]);
    expect(ofType(events, 'convoyTraded')).toEqual([{ type: 'convoyTraded', pass: sim.state.convoys.link!.pass, what: 'part', credits: -item.price }]);
    expect(result(act(sim, { type: 'convoyBuy', slot: 1 }))).toMatchObject({ ok: false, reason: 'slotSold' });
    expect(sim.state.credits).toBe(before - item.price);
    expect(result(act(sim, { type: 'convoyBuy', slot: 7 }))).toMatchObject({ ok: false, reason: 'invalidQuantity' });
  });

  it('the variant part goes to the part hold and does not unlock its plan', () => {
    const sim = linked();
    const item = offerOf(sim).items[1]!;
    if (item.kind !== 'part') throw new Error('part expected');
    expect(partUnlocked(sim.state, item.key)).toBe(false);
    act(sim, { type: 'convoyBuy', slot: 1 });
    expect(sim.state.player.salvage[item.key]).toBe(1);
    expect(partUnlocked(sim.state, item.key)).toBe(false);
  });

  it('a full part hold refuses a part (nothing paid)', () => {
    const sim = linked();
    const p = sim.state.player;
    p.cargo.iron = p.props.cargoCapacity - DERELICT.itemCargo + 1;
    expect(partHoldFree(sim.state)).toBeLessThan(DERELICT.itemCargo);
    const before = sim.state.credits;
    expect(result(act(sim, { type: 'convoyBuy', slot: 2 }))).toMatchObject({ ok: false, reason: 'holdFull' });
    expect(sim.state.credits).toBe(before);
    // a fragment needs no room
    expect(result(act(sim, { type: 'convoyBuy', slot: 0 }))).toMatchObject({ ok: true });
  });

  it('a fragment through awardFragment, the pity counters untouched', () => {
    const sim = linked();
    sim.state.discovery.pity.set('cache', 3);
    const item = offerOf(sim).items[0]!;
    if (item.kind !== 'fragment') throw new Error('fragment expected');
    const events = act(sim, { type: 'convoyBuy', slot: 0 });
    expect(ofType(events, 'fragmentFound')).toEqual([expect.objectContaining({ plan: item.plan, count: 1, complete: false })]);
    expect(sim.state.discovery.fragments.get(item.plan)).toBe(1);
    expect(sim.state.discovery.pity.get('cache')).toBe(3);
  });

  it('not enough credits', () => {
    const sim = linked();
    sim.state.credits = 10;
    expect(result(act(sim, { type: 'convoyBuy', slot: 0 }))).toMatchObject({ ok: false, reason: 'notEnoughCredits' });
    expect(sim.state.credits).toBe(10);
  });
});

describe('selling cargo', () => {
  it('at most 200 u per pass over all resources', () => {
    const sim = linked();
    const p = sim.state.player;
    p.cargo.iron = 150;
    p.cargo.copper = 100;
    expect(result(act(sim, { type: 'convoySell', resource: 'iron', qty: 'all' }))).toMatchObject({ ok: true });
    expect(p.cargo.iron).toBe(0);
    const before = sim.state.credits;
    const events = act(sim, { type: 'convoySell', resource: 'copper', qty: 'all' });
    expect(result(events)).toMatchObject({ ok: true });
    expect(p.cargo.copper).toBe(50);
    expect(sim.state.credits - before).toBe(saleValue(50, convoySellUnit('copper', 1)));
    expect(offerOf(sim).sellLeft).toBe(0);
    expect(result(act(sim, { type: 'convoySell', resource: 'copper', qty: 10 }))).toMatchObject({ ok: false, reason: 'convoyCapReached' });
  });

  it('refined units first through shipSaleValue, never the demand bonus', () => {
    const sim = linked();
    const p = sim.state.player;
    p.cargo.iron = 50;
    p.refined.iron = 20;
    const unit = convoySellUnit('iron', 1);
    const before = sim.state.credits;
    const events = act(sim, { type: 'convoySell', resource: 'iron', qty: 30 });
    expect(result(events)).toMatchObject({ ok: true });
    expect(sim.state.credits - before).toBe(shipSaleValue('iron', 30, 20, 0, unit));
    expect(sim.state.credits - before).toBeGreaterThan(saleValue(30, unit));
    expect(p.refined.iron).toBe(0);
    expect(p.cargo.iron).toBe(20);
    expect(ofType(events, 'convoyTraded')).toEqual([expect.objectContaining({ what: 'sell', credits: sim.state.credits - before })]);
    // the rest is raw ore at the plain unit price
    const mid = sim.state.credits;
    act(sim, { type: 'convoySell', resource: 'iron', qty: 'all' });
    expect(sim.state.credits - mid).toBe(saleValue(20, unit));
  });

  it('refuses invalid quantities and an empty hold', () => {
    const sim = linked();
    sim.state.player.cargo.ice = 5;
    expect(result(act(sim, { type: 'convoySell', resource: 'ice', qty: 6 }))).toMatchObject({ ok: false, reason: 'invalidQuantity' });
    expect(result(act(sim, { type: 'convoySell', resource: 'ice', qty: -1 }))).toMatchObject({ ok: false, reason: 'invalidQuantity' });
    expect(result(act(sim, { type: 'convoySell', resource: 'titanium', qty: 'all' }))).toMatchObject({ ok: false, reason: 'invalidQuantity' });
  });
});

describe('tanker fuel', () => {
  it('only with a tanker, at 1.5 × the ring price, at most 60 per pass', () => {
    const sim = linked(N_TANKER);
    const p = sim.state.player;
    p.fuel = 0;
    const cap = p.props.fuelCapacity;
    const want = Math.min(cap, CONVOY.fuelCap);
    const before = sim.state.credits;
    const events = act(sim, { type: 'convoyFuel', amount: 'full' });
    expect(result(events)).toMatchObject({ ok: true });
    expect(p.fuel).toBeCloseTo(want, 9);
    expect(before - sim.state.credits).toBe(purchaseCost(want, CONVOY.fuelMult * fuelUnitPrice(1)));
    if (cap > CONVOY.fuelCap) {
      expect(result(act(sim, { type: 'convoyFuel', amount: 1 }))).toMatchObject({ ok: false, reason: 'convoyCapReached' });
    } else {
      expect(result(act(sim, { type: 'convoyFuel', amount: 1 }))).toMatchObject({ ok: false, reason: 'tankFull' });
    }
    const plain = linked(N_PLAIN);
    plain.state.player.fuel = 0;
    expect(offerOf(plain).fuel).toBeNull();
    expect(result(act(plain, { type: 'convoyFuel', amount: 'full' }))).toMatchObject({ ok: false, reason: 'noTanker' });
  });

  it('the cap counts across purchases', () => {
    const sim = linked(N_TANKER);
    sim.state.player.fuel = 0;
    act(sim, { type: 'convoyFuel', amount: 25 });
    expect(offerOf(sim).fuel!.left).toBe(CONVOY.fuelCap - 25);
  });
});

describe('trades of a pass', () => {
  it('need the link', () => {
    const sim = flyingAt(SEED, { x: 600, y: 0 });
    for (const a of [{ type: 'convoyBuy', slot: 0 }, { type: 'convoySell', resource: 'iron', qty: 1 }, { type: 'convoyFuel', amount: 'full' }, { type: 'convoyUnlink' }] as const) {
      expect(result(act(sim, a))).toMatchObject({ ok: false, reason: 'notLinked' });
    }
  });

  it('survive an unlink and a new link to the same pass, and are pruned when the pass is over', () => {
    const sim = linked();
    const pass = sim.state.convoys.link!.pass;
    act(sim, { type: 'convoyBuy', slot: 1 });
    act(sim, { type: 'convoyUnlink' });
    expect(sim.state.convoys.trades.get(pass)).toEqual({ bought: 2, sold: 0, fuel: 0 });
    run(sim, 1);
    expect(sim.state.convoys.trades.has(pass)).toBe(true);
    sim.state.tick = Math.ceil(convoyPassWindow(SEED, pass)!.end);
    run(sim, 1);
    expect(sim.state.convoys.trades.size).toBe(0);
  });
});
