import { describe, expect, it } from 'vitest';
import { RECIPES } from '../../data/economy';
import type { Simulation } from '../Simulation';
import { HOME_STATION_ID, homeStation } from '../world/stations';
import { stationStorage } from './actions';
import { craftQuote, maxCraftable } from './partActions';
import { act, customStation, dockedAt, dockedSim, expectFailure, expectOk } from './testHarness';

const storage = (sim: Simulation) => stationStorage(sim.state, HOME_STATION_ID);
const outpost = () =>
  customStation({
    kind: 'outpost',
    services: { ...homeStation().services, partsMarket: false, crafting: false, shipyard: false },
  });

describe('buying and selling parts', () => {
  it('buys finished parts into the station storage', () => {
    const sim = dockedSim();
    sim.state.credits = 1000;
    const events = act(sim, { type: 'buyPart', key: 'armor:1', count: 2 });
    expectOk(events);
    expect(events).toContainEqual({ type: 'creditsChanged', delta: -780, reason: 'buy' });
    expect(sim.state.credits).toBe(220);
    expect(storage(sim).parts['armor:1']).toBe(4);
  });

  it('sells parts from the storage', () => {
    const sim = dockedSim();
    const events = act(sim, { type: 'sellPart', key: 'armor:1', count: 2 });
    expectOk(events);
    expect(events).toContainEqual({ type: 'creditsChanged', delta: 210, reason: 'sell' });
    expect(sim.state.credits).toBe(250 + 210);
    expect(storage(sim).parts['armor:1'] ?? 0).toBe(0);
  });

  it('rejects unknown part keys instead of throwing (M16)', () => {
    const sim = dockedSim();
    sim.state.credits = 100_000;
    const bogus = 'warpDrive:1' as never;
    expectFailure(sim, { type: 'buyPart', key: bogus, count: 1 }, 'unknownPart');
    expectFailure(sim, { type: 'sellPart', key: bogus, count: 1 }, 'unknownPart');
    expectFailure(sim, { type: 'craft', key: bogus, count: 1 }, 'unknownPart');
    expectFailure(sim, { type: 'buyPart', key: 'armor:3' as never, count: 1 }, 'unknownPart');
  });

  it('rejects invalid trades without changes', () => {
    const sim = dockedSim();
    expectFailure(sim, { type: 'buyPart', key: 'armor:1', count: 0 }, 'invalidQuantity');
    expectFailure(sim, { type: 'buyPart', key: 'armor:1', count: 1.5 }, 'invalidQuantity');
    expectFailure(sim, { type: 'buyPart', key: 'engine:1', count: 1 }, 'notEnoughCredits');
    expectFailure(sim, { type: 'buyPart', key: 'engine:2', count: 1 }, 'notAvailableHere');
    expectFailure(sim, { type: 'sellPart', key: 'armor:1', count: 3 }, 'notEnoughParts');
    expectFailure(sim, { type: 'sellPart', key: 'engine:1', count: 1 }, 'notEnoughParts');
    expectFailure(sim, { type: 'sellPart', key: 'armor:1', count: -1 }, 'invalidQuantity');
  });

  it('sells T2 parts in ring 2', () => {
    const sim = dockedAt(customStation({ ring: 2 }));
    sim.state.credits = 4000;
    expectOk(act(sim, { type: 'buyPart', key: 'engine:2', count: 1 }));
    expect(sim.state.credits).toBe(4000 - 3695);
  });

  it('needs a parts market', () => {
    const sim = dockedAt(outpost());
    sim.state.credits = 1000;
    expectFailure(sim, { type: 'buyPart', key: 'armor:1', count: 1 }, 'serviceUnavailable');
    expectFailure(sim, { type: 'sellPart', key: 'armor:1', count: 1 }, 'serviceUnavailable');
  });
});

describe('crafting', () => {
  it('takes resources from the storage first, then from the cargo, plus the fee', () => {
    const sim = dockedSim();
    const p = sim.state.player;
    sim.state.credits = 1000;
    storage(sim).resources.iron = 12;
    p.cargo.iron = 25.5;
    p.cargo.copper = 10;
    const events = act(sim, { type: 'craft', key: 'cargo:1', count: 1 });
    expectOk(events);
    expect(events).toContainEqual({ type: 'creditsChanged', delta: -900, reason: 'craft' });
    expect(sim.state.credits).toBe(100);
    expect(storage(sim).resources.iron).toBe(0);
    expect(p.cargo.iron).toBeCloseTo(7.5);
    expect(p.cargo.copper).toBe(0);
    expect(storage(sim).parts['cargo:1']).toBe(1);
  });

  it('crafts several pieces at once', () => {
    const sim = dockedSim();
    sim.state.credits = 400;
    storage(sim).resources.iron = 100;
    expectOk(act(sim, { type: 'craft', key: 'armor:1', count: 2 }));
    expect(storage(sim).resources.iron).toBe(70);
    expect(storage(sim).parts['armor:1']).toBe(4);
    expect(sim.state.credits).toBe(0);
  });

  it('crafts titanium parts anywhere with crafting', () => {
    const sim = dockedSim();
    sim.state.credits = 400;
    storage(sim).resources.titanium = 12;
    sim.state.player.cargo.iron = 5;
    expectOk(act(sim, { type: 'craft', key: 'armor:2', count: 1 }));
    expect(storage(sim).parts['armor:2']).toBe(1);
  });

  it('reports every crafting error without changes', () => {
    const sim = dockedSim();
    sim.state.player.cargo.iron = 14.99;
    expectFailure(sim, { type: 'craft', key: 'armor:1', count: 0 }, 'invalidQuantity');
    expectFailure(sim, { type: 'craft', key: 'armor:1', count: Number.NaN }, 'invalidQuantity');
    expectFailure(sim, { type: 'craft', key: 'armor:1', count: 1 }, 'notEnoughResources');
    sim.state.player.cargo.iron = 15;
    sim.state.credits = 199;
    expectFailure(sim, { type: 'craft', key: 'armor:1', count: 1 }, 'notEnoughCredits');
    const op = dockedAt(outpost());
    op.state.player.cargo.iron = 15;
    expectFailure(op, { type: 'craft', key: 'armor:1', count: 1 }, 'serviceUnavailable');
  });
});

describe('craft quote', () => {
  it('lists needs, what is available and what is missing', () => {
    const sim = dockedSim();
    storage(sim).resources.iron = 20;
    sim.state.player.cargo.iron = 5;
    sim.state.player.cargo.copper = 4;
    const q = craftQuote(sim.state, homeStation(), 'cargo:1', 1);
    expect(q.resources).toEqual(RECIPES['cargo:1'].resources);
    expect(q.credits).toBe(900);
    expect(q.available.iron).toBe(25);
    expect(q.missing).toEqual({ iron: 5, copper: 6 });
    expect(q.creditsMissing).toBe(650);
    expect(q.ok).toBe(false);
  });

  it('computes how many pieces can be crafted now', () => {
    const sim = dockedSim();
    storage(sim).resources.iron = 47;
    sim.state.credits = 10_000;
    expect(maxCraftable(sim.state, homeStation(), 'armor:1')).toBe(3);
    sim.state.credits = 299;
    expect(maxCraftable(sim.state, homeStation(), 'armor:1')).toBe(1);
    expect(maxCraftable(sim.state, homeStation(), 'reactor:1')).toBe(0);
  });
});
