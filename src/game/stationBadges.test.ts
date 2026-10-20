import { describe, expect, it } from 'vitest';
import { boardEpoch } from '../sim/contracts/board';
import { act, dockedSim, expectOk } from '../sim/station/testHarness';
import { IDLE_COMMAND } from '../sim/commands';
import { homeStation } from '../sim/world/stations';
import type { ContractOffer } from '../sim/career/types';
import { hubBadges, NO_TURN_IN, turnInReady } from './stationBadges';

function boardSim() {
  const sim = dockedSim();
  sim.step(IDLE_COMMAND);
  return sim;
}

/** Accepts a forged delivery slip to the home station. */
function acceptDelivery(sim: ReturnType<typeof boardSim>, amount: number) {
  const board = sim.state.career.boards.get('home')!;
  const offer: ContractOffer = {
    id: `home@${boardEpoch(sim.state.tick)}.9${board.offers.length}`,
    type: 'delivery',
    faction: 'guild',
    station: 'home',
    ring: 1,
    risk: 0,
    target: { kind: 'delivery', resource: 'copper', amount, to: 'home' },
    modifiers: [],
    bonus: 0,
    part: null,
  };
  board.offers.push(offer);
  expectOk(act(sim, { type: 'acceptContract', offerId: offer.id }));
  return sim.state.career.contracts.at(-1)!;
}

describe('turnInReady', () => {
  it('is empty without contracts', () => {
    const sim = boardSim();
    expect(turnInReady(sim.state, homeStation())).toBe(NO_TURN_IN);
  });

  it('counts contracts that can be handed in here and sums their rewards', () => {
    const sim = boardSim();
    const c = acceptDelivery(sim, 20);
    expect(turnInReady(sim.state, homeStation()).ids).toEqual([]);
    sim.state.stations.get('home')!.resources.copper = 25;
    const r = turnInReady(sim.state, homeStation());
    expect(r.ids).toEqual([c.serial]);
    expect(r.reward).toBe(c.reward);
  });
});

describe('hubBadges', () => {
  it('the Jobs badge is the number of contracts to hand in', () => {
    const sim = boardSim();
    acceptDelivery(sim, 20);
    sim.state.stations.get('home')!.resources.copper = 25;
    const station = homeStation();
    expect(hubBadges(sim.state, station, turnInReady(sim.state, station)).jobs).toBe(1);
    expect(hubBadges(sim.state, station, NO_TURN_IN).jobs).toBe(0);
  });

  it('the Market dot shows with cargo aboard, the Shipyard dot with parts in storage', () => {
    const sim = boardSim();
    const station = homeStation();
    for (const id of Object.keys(sim.state.player.cargo) as (keyof typeof sim.state.player.cargo)[]) sim.state.player.cargo[id] = 0;
    sim.state.stations.get('home')!.parts = {};
    let b = hubBadges(sim.state, station, NO_TURN_IN);
    expect(b.market).toBe(false);
    expect(b.shipyard).toBe(false);
    sim.state.player.cargo.iron = 5;
    sim.state.stations.get('home')!.parts = { 'engine:1': 1 } as never;
    b = hubBadges(sim.state, station, NO_TURN_IN);
    expect(b.market).toBe(true);
    expect(b.shipyard).toBe(true);
  });
});
