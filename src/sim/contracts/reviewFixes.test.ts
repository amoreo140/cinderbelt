// Second code review (M3.5a fairness): contract edge cases (I7, I8, M12, M19).
import { describe, expect, it } from 'vitest';
import type { Contract, ContractOffer } from '../career/types';
import { IDLE_COMMAND } from '../commands';
import { distressReward } from '../discovery/interact';
import { distressNear } from '../discovery/events';
import { fortressSites } from '../pirates/sites';
import { freshFortress } from '../pirates/fortress';
import type { Simulation, SimEvent } from '../Simulation';
import { act, dockedSim, expectFailure, expectOk } from '../station/testHarness';
import { boardEpoch, quoteRefIncome } from './board';
import { contractReward } from './reward';
import { DISTRESS } from '../../data/events';

const step = (sim: Simulation, n = 1): SimEvent[] => {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...sim.step(IDLE_COMMAND));
  return out;
};

function boardSim(): Simulation {
  const sim = dockedSim();
  step(sim);
  return sim;
}

const board = (sim: Simulation) => sim.state.career.boards.get('home')!;

function offerOf(sim: Simulation, target: ContractOffer['target'], type: ContractOffer['type']): ContractOffer {
  const offer: ContractOffer = {
    id: `home@${boardEpoch(sim.state.tick)}.90${board(sim).offers.length}`,
    type,
    faction: 'guild',
    station: 'home',
    ring: 1,
    risk: 0,
    target,
    modifiers: [],
    bonus: 0,
    part: null,
  };
  board(sim).offers.push(offer);
  return offer;
}

function accept(sim: Simulation, offer: ContractOffer): Contract {
  expectOk(act(sim, { type: 'acceptContract', offerId: offer.id }));
  return sim.state.career.contracts.at(-1)!;
}

describe('I7: mining contracts on one resource share no ore', () => {
  it('mined units go to the contracts in accept order – the same ore never completes two', () => {
    const sim = boardSim();
    sim.state.stats.mined.iron = 100;
    const a = accept(sim, offerOf(sim, { kind: 'mining', resource: 'iron', amount: 20 }, 'mining'));
    const b = accept(sim, offerOf(sim, { kind: 'mining', resource: 'iron', amount: 20 }, 'mining'));
    const copper = accept(sim, offerOf(sim, { kind: 'mining', resource: 'copper', amount: 5 }, 'mining'));
    sim.state.stats.mined.iron = 120;
    sim.state.stats.mined.copper = 5;
    step(sim);
    expect(a.ready).toBe(true);
    expect(b.ready).toBe(false);
    expect(b.progress).toBe(0);
    expect(copper.ready).toBe(true);
    // turning the first one in keeps its claim – the second still needs ore of its own
    expectOk(act(sim, { type: 'turnInContract', contractId: a.serial }));
    step(sim);
    expect(b.ready).toBe(false);
    sim.state.stats.mined.iron = 135;
    step(sim);
    expect(b.progress).toBe(15);
    sim.state.stats.mined.iron = 140;
    step(sim);
    expect(b.ready).toBe(true);
  });
});

describe('I8: fortress contracts', () => {
  it('one fortress pays one contract; a stale offer is refused after the fortress fell', () => {
    const sim = boardSim();
    const f = fortressSites(sim.state.seed)[0]!;
    const target = { kind: 'fortress' as const, fortress: f.id, pos: f.pos };
    accept(sim, offerOf(sim, target, 'fortress'));
    // a second board's offer on the same fortress
    const second = offerOf(sim, target, 'fortress');
    expectFailure(sim, { type: 'acceptContract', offerId: second.id }, 'contractUnavailable');
    // the fortress fell: an old offer for it is stale
    const other = fortressSites(sim.state.seed)[1]!;
    sim.state.pirates.fortresses.set(other.id, { ...freshFortress(), destroyed: sim.state.tick, kills: 1 });
    const stale = offerOf(sim, { kind: 'fortress', fortress: other.id, pos: other.pos }, 'fortress');
    expectFailure(sim, { type: 'acceptContract', offerId: stale.id }, 'contractUnavailable');
  });
});

describe('M12: a hunt cannot be farmed by accept → kill → cancel → accept', () => {
  it('a cancelled hunt with kills does not go back on the board (its group would respawn for its loot); an untouched one does', () => {
    const sim = boardSim();
    const slots = ['pr:9,2:0', 'pr:9,2:1'];
    const hunt = { kind: 'hunt' as const, cx: 9, cy: 2, slots, pos: { x: 1900, y: 500 } };
    const offer = offerOf(sim, hunt, 'hunt');
    const c = accept(sim, offer);
    // one pirate of the group killed, then the contract cancelled within the free period
    c.progress = 1;
    sim.state.combat.defeated.set(slots[0]!, sim.state.tick);
    expectOk(act(sim, { type: 'abandonContract', contractId: c.serial }));
    expect(board(sim).offers.some((o) => o.id === offer.id)).toBe(false);
    expect(sim.state.combat.defeated.has(slots[0]!)).toBe(true);
    // a hunt cancelled before any fight returns to the board as before
    const other = offerOf(sim, { ...hunt, cx: 9, cy: 3, slots: ['pr:9,3:0'] }, 'hunt');
    const d = accept(sim, other);
    expectOk(act(sim, { type: 'abandonContract', contractId: d.serial }));
    expect(board(sim).offers.some((o) => o.id === other.id)).toBe(true);
  });
});

describe('M19: the distress reward', () => {
  it('uses the reference income of a contract quote – the high-water mark of the best ship counts', () => {
    const sim = boardSim();
    const ds = distressNear(sim.state.seed, { x: 0, y: 0 }, 6000, 0)[0]!;
    const near = { ...ds, pos: { x: 100, y: 0 } };
    const before = distressReward(sim.state, near);
    // the player once had a far better miner (now crippled or sold)
    sim.state.stats.bestUnitsPerHour = [5000, 5000, 5000, 5000];
    const after = distressReward(sim.state, near);
    expect(after).toBeGreaterThan(before);
    expect(after).toBe(contractReward({ type: 'rescue', seconds: DISTRESS.rewardSeconds, risk: 0, bonus: 0, refIncome: quoteRefIncome(sim.state, 1) }));
  });
});
