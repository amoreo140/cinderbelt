// Institute contracts with the scanner (M3.5b): Survey and Pickup.
import { describe, expect, it } from 'vitest';
import { INSTITUTE_DATA_RATE } from '../../data/poi';
import { SCANNER } from '../../data/scanner';
import type { ContractOffer } from '../career/types';
import { boardEpoch, quoteOffer } from '../contracts/board';
import { dockPose } from '../station/dock';
import { act, expectOk } from '../station/testHarness';
import { homeStation } from '../world/stations';
import type { Simulation } from '../Simulation';
import { findPoi, flyingAt, holdScan, ofType, run, teleport } from './testing';

const SEED = 4242;

function dockHome(sim: Simulation): void {
  const home = homeStation();
  sim.enterDocked(home.id, dockPose(home, sim.state.player.props.boundingRadius));
  run(sim, 1);
}

function accept(sim: Simulation, target: ContractOffer['target'], type: ContractOffer['type']) {
  dockHome(sim);
  const board = sim.state.career.boards.get('home')!;
  const offer: ContractOffer = {
    id: `home@${boardEpoch(sim.state.tick)}.95`,
    type,
    faction: 'institute',
    station: 'home',
    ring: 1,
    risk: 0,
    target,
    modifiers: [],
    bonus: 0,
    part: null,
  };
  board.offers.push(offer);
  const quote = quoteOffer(sim.state, offer);
  expectOk(act(sim, { type: 'acceptContract', offerId: offer.id }));
  act(sim, { type: 'undock' });
  return { contract: sim.state.career.contracts.at(-1)!, quote };
}

describe('Prieskum (scan) contract', () => {
  it('is ready after analysing the target and pays credits and a Data batch', () => {
    const anomaly = findPoi(SEED, 'anomaly');
    const sim = flyingAt(SEED, { x: 0, y: 0 });
    const { contract, quote } = accept(sim, { kind: 'scan', poi: anomaly.id, what: 'anomaly', pos: anomaly.pos }, 'scan');
    expect(quote.data).toBe(Math.round((INSTITUTE_DATA_RATE[1] * quote.seconds) / 3600));
    expect(contract.data).toBe(quote.data);
    teleport(sim, { x: anomaly.pos.x + 60, y: anomaly.pos.y });
    const events = holdScan(sim, anomaly.pos);
    expect(ofType(events, 'contractReady').map((e) => e.contractId)).toEqual([contract.serial]);
    const fund = sim.state.discovery.dataFund;
    dockHome(sim);
    const credits = sim.state.credits;
    const done = act(sim, { type: 'turnInContract', contractId: contract.serial });
    expectOk(done);
    expect(sim.state.credits).toBe(credits + contract.reward);
    expect(sim.state.discovery.dataFund).toBe(fund + contract.data!);
  });
});

describe('Vyzdvihnutie (retrieve) contract', () => {
  it('a wreck with the part appears, salvaging it readies the contract and turning in gives a plan fragment', () => {
    const sim = flyingAt(SEED, { x: 0, y: 0 });
    const pos = { x: 520, y: 260 };
    const { contract } = accept(sim, { kind: 'retrieve', pos, angle: 0.5, part: 'reactor:1', plan: 'scout' }, 'retrieve');
    teleport(sim, { x: pos.x + 200, y: pos.y });
    run(sim, SCANNER.discoverInterval + 1);
    const wreck = sim.state.combat.wrecks.find((w) => w.poi === `rt:${contract.serial}`)!;
    expect(wreck).toBeDefined();
    expect(wreck.loot.parts['reactor:1']).toBe(1);
    teleport(sim, { x: wreck.body.pos.x - wreck.props.boundingRadius - 4, y: wreck.body.pos.y });
    const events = run(sim, 1, { dock: true });
    expect(ofType(events, 'contractReady')).toHaveLength(1);
    expect(sim.state.player.salvage['reactor:1']).toBe(1);
    // at the station the part goes to storage and is handed over
    dockHome(sim);
    expect(sim.state.stations.get('home')!.parts['reactor:1']).toBe(1);
    const done = act(sim, { type: 'turnInContract', contractId: contract.serial });
    expectOk(done);
    expect(sim.state.stations.get('home')!.parts['reactor:1'] ?? 0).toBe(0);
    expect(sim.state.discovery.fragments.get('scout')).toBe(1);
    expect(ofType(done, 'fragmentFound')).toHaveLength(1);
  });
});
