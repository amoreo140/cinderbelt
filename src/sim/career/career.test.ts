import { describe, expect, it } from 'vitest';
import { BOARD_REFRESH_TICKS, FREE_CANCEL_TICKS, MAX_ACTIVE_CONTRACTS } from '../../data/contracts';
import { IDLE_COMMAND } from '../commands';
import { boardEpoch, currentBoard, quoteOffer } from '../contracts/board';
import { partSellPrice } from '../../data/economy';
import { computeProperties } from '../ship/properties';
import { act, dockedSim, expectFailure, expectOk, resultOf } from '../station/testHarness';
import { homeStation } from '../world/stations';
import type { Simulation, SimEvent } from '../Simulation';
import type { Contract, ContractOffer } from './types';
import { careerInteraction, interact, stepCareer } from './career';

const step = (sim: Simulation, n = 1): SimEvent[] => {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...sim.step(IDLE_COMMAND));
  return out;
};

/** A docked game with a saved home board. */
function boardSim(): Simulation {
  const sim = dockedSim();
  step(sim);
  return sim;
}

const board = (sim: Simulation) => sim.state.career.boards.get('home')!;

/** A slip of the given type (forged onto the board if it is not there). */
function offerOf(sim: Simulation, target: ContractOffer['target'], type: ContractOffer['type']): ContractOffer {
  const offer: ContractOffer = {
    id: `home@${boardEpoch(sim.state.tick)}.90${board(sim).offers.length}`,
    type,
    faction: type === 'survey' ? 'institute' : 'guild',
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
  const events = act(sim, { type: 'acceptContract', offerId: offer.id });
  expectOk(events);
  return sim.state.career.contracts.at(-1)!;
}

describe('board', () => {
  it('stores the board of the docked station after the first step', () => {
    const sim = dockedSim();
    expect(sim.state.career.boards.size).toBe(0);
    step(sim);
    const b = board(sim);
    expect(b.epoch).toBe(0);
    expect(b.offers.length).toBeGreaterThanOrEqual(3);
    expect(currentBoard(sim.state, homeStation())).toBe(b);
  });

  it('refreshes every 20 game minutes while docked', () => {
    const sim = boardSim();
    const first = board(sim);
    sim.state.tick = BOARD_REFRESH_TICKS - 1;
    step(sim, 2);
    expect(board(sim).epoch).toBe(1);
    expect(board(sim)).not.toEqual(first);
  });
});

describe('accepting and abandoning', () => {
  it('freezes the reward when accepted', () => {
    const sim = boardSim();
    const offer = board(sim).offers[0]!;
    const quote = quoteOffer(sim.state, offer);
    const events = act(sim, { type: 'acceptContract', offerId: offer.id });
    expectOk(events);
    expect(events).toContainEqual({ type: 'contractAccepted', contractId: 1 });
    const c = sim.state.career.contracts[0]!;
    expect(c).toMatchObject({ id: offer.id, serial: 1, reward: quote.reward, rep: quote.rep, seconds: quote.seconds, ready: false });
    expect(board(sim).offers.some((o) => o.id === offer.id)).toBe(false);
    // a better ship does not change the reward later
    sim.state.player.props = { ...sim.state.player.props, cargoCapacity: 5000 };
    expect(sim.state.career.contracts[0]!.reward).toBe(quote.reward);
  });

  it('quotes from the best ship the player has had, never from a ship stripped just before accepting (saboteur report X2)', () => {
    const sim = boardSim();
    const offer = offerOf(sim, { kind: 'mining', resource: 'iron', amount: 65 }, 'mining');
    const honest = quoteOffer(sim.state, offer).reward;
    // strip the lasers and the holds in the shipyard (they go to storage), then ask again
    const p = sim.state.player;
    const grid = p.grid;
    p.grid = { ...grid, parts: grid.parts.filter((x) => x.partId !== 'miningLaser' && x.partId !== 'cargo' && x.partId !== 'gyro') };
    p.props = computeProperties(p.grid);
    p.blueprint = p.grid;
    step(sim);
    expect(sim.state.respawn.grid).toBe(p.grid);
    expect(quoteOffer(sim.state, offer).reward).toBeLessThanOrEqual(honest);
    // the duration estimate never assumes a ship slower than the ring's reference (the starter hull)
    sim.state.stats.bestUnitsPerHour = [0, 0, 0, 0];
    expect(quoteOffer(sim.state, offer).reward).toBeLessThanOrEqual(honest);
  });

  it('an exclusive part replaces credits down to nothing, and is not offered when worth more than the reward (X6)', () => {
    const sim = boardSim();
    const plain = offerOf(sim, { kind: 'mining', resource: 'iron', amount: 65 }, 'mining');
    const creditOnly = quoteOffer(sim.state, plain).reward;
    const cheap = quoteOffer(sim.state, { ...plain, part: 'armor:2' });
    expect(cheap.part).toBe('armor:2');
    expect(cheap.reward + partSellPrice('armor:2')).toBeLessThanOrEqual(creditOnly + 5);
    const tiny = offerOf(sim, { kind: 'mining', resource: 'iron', amount: 5 }, 'mining');
    const tinyCredit = quoteOffer(sim.state, tiny).reward;
    expect(partSellPrice('reactor:2')).toBeGreaterThan(tinyCredit);
    const pricey = quoteOffer(sim.state, { ...tiny, part: 'reactor:2' });
    expect(pricey).toMatchObject({ part: null, reward: tinyCredit });
    // the accepted contract pays what was quoted: no part
    board(sim).offers.push({ ...tiny, id: `${tiny.id}9`, part: 'reactor:2' });
    expect(accept(sim, board(sim).offers.at(-1)!).part).toBeNull();
  });

  it('allows at most three active contracts', () => {
    const sim = boardSim();
    for (let i = 0; i < MAX_ACTIVE_CONTRACTS; i++) accept(sim, offerOf(sim, { kind: 'mining', resource: 'iron', amount: 10 }, 'mining'));
    expectFailure(sim, { type: 'acceptContract', offerId: offerOf(sim, { kind: 'mining', resource: 'iron', amount: 10 }, 'mining').id }, 'tooManyContracts');
  });

  it('rejects an unknown offer and needs docking', () => {
    const sim = boardSim();
    expectFailure(sim, { type: 'acceptContract', offerId: 'home@0.99' }, 'contractUnavailable');
    act(sim, { type: 'undock' });
    expect(resultOf(act(sim, { type: 'acceptContract', offerId: board(sim).offers[0]!.id }))).toMatchObject({ ok: false, reason: 'notDocked' });
  });

  it('cancels for free within 2 minutes (the slip returns), later it is just dropped', () => {
    const sim = boardSim();
    const a = accept(sim, offerOf(sim, { kind: 'mining', resource: 'iron', amount: 10 }, 'mining'));
    const before = board(sim).offers.length;
    const events = act(sim, { type: 'abandonContract', contractId: a.serial });
    expect(events).toContainEqual({ type: 'contractAbandoned', contractId: a.serial, refunded: true });
    expect(board(sim).offers.length).toBe(before + 1);
    const b = accept(sim, offerOf(sim, { kind: 'mining', resource: 'iron', amount: 10 }, 'mining'));
    sim.state.tick += FREE_CANCEL_TICKS + 1;
    const n = board(sim).offers.length;
    expect(act(sim, { type: 'abandonContract', contractId: b.serial })).toContainEqual({ type: 'contractAbandoned', contractId: b.serial, refunded: false });
    expect(board(sim).offers.length).toBe(n);
    expect(sim.state.career.contracts).toEqual([]);
  });
});

describe('progress and turn-in', () => {
  it('mining: counts what was mined since accepting, then pays on turn-in', () => {
    const sim = boardSim();
    sim.state.stats.mined.iron = 50;
    const c = accept(sim, offerOf(sim, { kind: 'mining', resource: 'iron', amount: 20 }, 'mining'));
    expect(c.base).toBe(50);
    expectFailure(sim, { type: 'turnInContract', contractId: c.serial }, 'contractNotReady');
    sim.state.stats.mined.iron = 65;
    step(sim);
    expect(c.progress).toBe(15);
    sim.state.stats.mined.iron = 70;
    const ready = step(sim);
    expect(ready).toContainEqual({ type: 'contractReady', contractId: c.serial });
    const credits = sim.state.credits;
    const events = act(sim, { type: 'turnInContract', contractId: c.serial });
    expectOk(events);
    expect(sim.state.credits).toBe(credits + c.reward);
    expect(events).toContainEqual({ type: 'contractCompleted', contractId: c.serial, reward: c.reward, rep: c.rep, part: null });
    expect(sim.state.career.rep.guild.points).toBe(c.rep);
    expect(sim.state.career.completed.mining).toBe(1);
    expect(sim.state.career.log.at(-1)).toMatchObject({ kind: 'contractCompleted', type: 'mining' });
  });

  it('delivery: hands over the goods only at the destination', () => {
    const sim = boardSim();
    const c = accept(sim, offerOf(sim, { kind: 'delivery', resource: 'copper', amount: 20, to: 'home' }, 'delivery'));
    expectFailure(sim, { type: 'turnInContract', contractId: c.serial }, 'notEnoughResources');
    sim.state.player.cargo.copper = 12;
    sim.state.stations.get('home')!.resources.copper = 10;
    expectOk(act(sim, { type: 'turnInContract', contractId: c.serial }));
    expect(sim.state.stations.get('home')!.resources.copper).toBe(0);
    expect(sim.state.player.cargo.copper).toBe(2);
    const other = accept(sim, offerOf(sim, { kind: 'delivery', resource: 'copper', amount: 1, to: 'st:4,4' }, 'delivery'));
    sim.state.player.cargo.copper = 5;
    expectFailure(sim, { type: 'turnInContract', contractId: other.serial }, 'notAtDestination');
  });

  it('survey: F at each point deploys a buoy, in order', () => {
    const sim = boardSim();
    const points = [{ x: 100, y: 0 }, { x: 160, y: 0 }, { x: 130, y: 60 }];
    const c = accept(sim, offerOf(sim, { kind: 'survey', points }, 'survey'));
    act(sim, { type: 'undock' });
    sim.state.player.body = { pos: { x: 160, y: 0 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    expect(careerInteraction(sim.state)).toBeNull();
    for (const [i, p] of points.entries()) {
      sim.state.player.body = { pos: { x: p.x + 3, y: p.y }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
      const it = careerInteraction(sim.state);
      expect(it).toMatchObject({ kind: 'buoy', contract: c.serial, index: i });
      const events = interact(sim.state, it!);
      expect(events[0]).toMatchObject({ type: 'buoyDeployed', index: i });
    }
    expect(c.ready).toBe(true);
    expect(careerInteraction(sim.state)).toBeNull();
  });

  it('survey via the F key in flight', () => {
    const sim = boardSim();
    const c = accept(sim, offerOf(sim, { kind: 'survey', points: [{ x: 300, y: 300 }] }, 'survey'));
    act(sim, { type: 'undock' });
    sim.state.player.body = { pos: { x: 302, y: 300 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    sim.state.world.update(sim.state.player.body.pos);
    const events = sim.step({ ...IDLE_COMMAND, dock: true });
    expect(events.some((e) => e.type === 'buoyDeployed')).toBe(true);
    expect(c.ready).toBe(true);
  });

  it('rescue: gives fuel to the stranded ship (not without enough fuel)', () => {
    const sim = boardSim();
    const c = accept(sim, offerOf(sim, { kind: 'rescue', pos: { x: 200, y: 0 }, angle: 0, fuel: 15 }, 'rescue'));
    act(sim, { type: 'undock' });
    sim.state.player.body = { pos: { x: 185, y: 0 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    const it = careerInteraction(sim.state)!;
    expect(it).toMatchObject({ kind: 'rescue', fuel: 15 });
    sim.state.player.fuel = 10;
    expect(interact(sim.state, it)).toEqual([{ type: 'interactFailed', contractId: c.serial, reason: 'notEnoughFuel' }]);
    sim.state.player.fuel = 40;
    interact(sim.state, it);
    expect(sim.state.player.fuel).toBe(25);
    expect(c.ready).toBe(true);
  });

  it('hunt: destroying every pirate of the group completes it', () => {
    const sim = boardSim();
    const c = accept(sim, offerOf(sim, { kind: 'hunt', cx: 9, cy: 2, slots: ['pr:9,2:0', 'pr:9,2:1'], pos: { x: 1900, y: 500 } }, 'hunt'));
    const destroyed = (ref: string): SimEvent => ({ type: 'shipDestroyed', ref, kind: 'jackal', pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, radius: 2 });
    stepCareer(sim.state, [destroyed('pr:9,2:0'), destroyed('pr:1,1:0')]);
    expect(c.progress).toBe(1);
    expect(stepCareer(sim.state, [destroyed('pr:9,2:1')])).toContainEqual({ type: 'contractReady', contractId: c.serial });
  });
});

describe('assignments', () => {
  it('deliver-type assignments take resources from the storage and cargo', () => {
    const sim = boardSim();
    const rep = sim.state.career.rep.guild;
    rep.level = 2;
    rep.points = 700;
    sim.state.player.cargo.titanium = 100;
    sim.state.stations.get('home')!.resources.titanium = 250;
    const events = act(sim, { type: 'deliverAssignment', faction: 'guild' });
    expectOk(events);
    expect(events).toContainEqual({ type: 'repLevelUp', faction: 'guild', level: 3 });
    expect(sim.state.stations.get('home')!.resources.titanium + sim.state.player.cargo.titanium).toBe(50);
    expectFailure(sim, { type: 'deliverAssignment', faction: 'guild' }, 'contractUnavailable');
  });
});
