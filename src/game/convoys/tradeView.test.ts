// M4d T9: the convoy trade window's view model – item states and reasons in the simulation's order, the
// sale rows capped by what the convoy still takes, the tanker fuel and its reasons, the trader's name, and
// the handlers as commands ("fill the tank" capped by the credits).
import { describe, expect, it } from 'vitest';
import { CONVOY } from '../../data/convoys';
import { purchaseCost } from '../../data/economy';
import { DERELICT } from '../../data/sites';
import { setLocale } from '../../i18n/locale';
import { tx } from '../../i18n';
import type { GameActionInput } from '../../sim/commands';
import { linkedTo } from '../../sim/convoys/convoyTesting';
import { convoyComposition } from '../../sim/convoys/schedule';
import { convoyOffer } from '../../sim/convoys/trade';
import type { Simulation } from '../../sim/Simulation';
import { formatCredits } from '../../ui/format';
import { traderName as radioTraderName } from '../comms/speakers';
import { convoyTradeHandlers, convoyTradeView, fullTankAmount, traderName } from './tradeView';

const SEED = 3;
const passWith = (tanker: boolean): number => {
  let n = 1;
  while (convoyComposition(SEED, 'A', n).tanker !== tanker) n++;
  return n;
};

const linked = (tanker = true): Simulation => {
  const sim = linkedTo(SEED, 'A', passWith(tanker), 60);
  sim.state.credits = 50_000;
  return sim;
};

describe('convoyTradeView', () => {
  setLocale('sk');

  it('is null without a link', () => {
    const sim = linked();
    sim.state.convoys.link = null;
    expect(convoyTradeView(sim.state)).toBeNull();
  });

  it('lists the pass items as buyable with their titles, the trader and the ring', () => {
    const sim = linked();
    const d = convoyTradeView(sim.state)!;
    const offer = convoyOffer(sim.state, sim.state.convoys.link!.pass)!;
    expect(d.pass).toBe(sim.state.convoys.link!.pass);
    expect(d.ring).toBe(offer.ring);
    expect(d.trader).toBe(traderName(d.pass));
    expect(d.trader).toMatch(/^Voľní obchodníci „.+“$/);
    expect(d.items.map((i) => [i.slot, i.state, i.reason, i.price])).toEqual(offer.items.map((i) => [i.slot, 'buyable', null, i.price]));
    expect(d.items[0]!.part).toBeUndefined();
    expect(d.items[0]!.title).toMatch(/^Fragment plánu/);
    expect(d.items[0]!.detail).toBe(tx().guild.trade.items.fragments(0, 3));
    expect(d.items[1]!.part).toBeDefined();
    expect(d.credits).toBe(50_000);
  });

  it('item states: sold first, then a full part hold, then the credits with the missing amount', () => {
    const sim = linked();
    const pass = sim.state.convoys.link!.pass;
    const offer = convoyOffer(sim.state, pass)!;
    sim.state.convoys.trades.set(pass, { bought: 1, sold: 0, fuel: 0 });
    sim.state.credits = 10;
    // a full hold: the cargo takes everything but less than one part
    const cap = sim.state.player.props.cargoCapacity;
    sim.state.player.cargo.iron = cap - DERELICT.itemCargo + 1;
    const d = convoyTradeView(sim.state)!;
    expect(d.items[0]).toMatchObject({ state: 'sold', reason: tx().guild.trade.reasons.sold });
    expect(d.items[1]).toMatchObject({ state: 'holdFull', reason: tx().guild.trade.reasons.holdFull });
    sim.state.player.cargo.iron = 0;
    const d2 = convoyTradeView(sim.state)!;
    expect(d2.items[1]).toMatchObject({ state: 'noCredits', reason: tx().guild.trade.reasons.noCredits(formatCredits(offer.items[1]!.price - 10)) });
  });

  it('sale rows: cargo only, capped by what the convoy still takes, refined units within the cap', () => {
    const sim = linked();
    const pass = sim.state.convoys.link!.pass;
    sim.state.player.cargo.iron = 50;
    sim.state.player.refined.iron = 20;
    sim.state.player.cargo.copper = 5;
    sim.state.convoys.trades.set(pass, { bought: 0, sold: CONVOY.buyCap - 10, fuel: 0 });
    const d = convoyTradeView(sim.state)!;
    expect(d.capLeft).toBe(10);
    const iron = d.sell.find((r) => r.resource === 'iron')!;
    expect(iron).toMatchObject({ max: 10, refined: 10 });
    expect(iron.unit).toBe(convoyOffer(sim.state, pass)!.sell.iron);
    expect(d.sell.find((r) => r.resource === 'copper')).toMatchObject({ max: 5, refined: 0 });
    expect(d.sell.find((r) => r.resource === 'titanium')).toBeUndefined();
  });

  it('fuel: null without a tanker; with one the reason when none can be bought', () => {
    expect(convoyTradeView(linked(false).state)!.fuel).toBeNull();
    const sim = linked(true);
    const p = sim.state.player;
    p.fuel = p.props.fuelCapacity - 30;
    const d = convoyTradeView(sim.state)!;
    expect(d.fuel!.max).toBeCloseTo(30, 6);
    expect(d.fuel!.reason).toBeNull();
    p.fuel = p.props.fuelCapacity;
    expect(convoyTradeView(sim.state)!.fuel).toMatchObject({ max: 0, reason: tx().guild.trade.reasons.tankFull });
    p.fuel = 0;
    sim.state.convoys.trades.set(sim.state.convoys.link!.pass, { bought: 0, sold: 0, fuel: CONVOY.fuelCap });
    expect(convoyTradeView(sim.state)!.fuel!.reason).toBe(tx().guild.trade.reasons.fuelCap);
    sim.state.convoys.trades.delete(sim.state.convoys.link!.pass);
    sim.state.credits = 0;
    expect(convoyTradeView(sim.state)!.fuel!.reason).toMatch(/^Chýba/);
  });

  it('the trader name is the radio ship name of the pass and follows the language', () => {
    expect(traderName('cv:A@4')).toBe(tx().guild.convoy.trader(radioTraderName('cv:A@4')));
    setLocale('en');
    expect(traderName('cv:A@4')).toMatch(/^Free Traders/);
    setLocale('sk');
  });
});

describe('convoyTradeHandlers', () => {
  it('send the convoy commands; a full tank the credits cannot pay becomes the affordable units', () => {
    const sim = linked(true);
    const sent: GameActionInput[] = [];
    const on = convoyTradeHandlers((a) => sent.push(a), () => sim.state);
    on.buy(1);
    on.sell('iron', 'all');
    on.fuel(10);
    on.unlink();
    const p = sim.state.player;
    p.fuel = 0;
    on.fuel('full');
    expect(sent.slice(0, 5)).toEqual([
      { type: 'convoyBuy', slot: 1 },
      { type: 'convoySell', resource: 'iron', qty: 'all' },
      { type: 'convoyFuel', amount: 10 },
      { type: 'convoyUnlink' },
      { type: 'convoyFuel', amount: 'full' },
    ]);
    const unit = convoyOffer(sim.state, sim.state.convoys.link!.pass)!.fuel!.unit;
    sim.state.credits = Math.floor(unit * 7.5);
    const n = fullTankAmount(sim.state);
    expect(n).toBe(7);
    expect(purchaseCost(n as number, unit)).toBeLessThanOrEqual(sim.state.credits);
  });
});
