// `chart` contracts and "First chart" (sectors §4.3, §4.4), the training's chart (§6.6): the contract
// covers the chart's sale, the sector is marked sold, and neither can be paid twice.
import { describe, expect, it } from 'vitest';
import { stepIndex } from '../../data/training';
import { IDLE_COMMAND, type GameAction, type GameActionInput } from '../commands';
import { currentBoard, quoteOffer } from '../contracts/board';
import { flyingAt, tapScan, teleport } from '../discovery/testing';
import { sectorChunkKeys, sectorInfo, sectorKnowledge, surveyPoints, trainingChartSector } from '../regions';
import { Simulation, type SimEvent } from '../Simulation';
import { stationAt, homeStation } from '../world/stations';
import { regionWorld } from '../regions';
import { dockHome, step, trainingSim, undock, act as trainingAct } from '../training/testing';
import { chartSellPrice, firstChartTarget } from './charts';
import type { Contract } from '../career/types';
import { dockPose } from '../station/dock';

const SEED = 1337;
let req = 0;
const act = (sim: Simulation, a: GameActionInput): SimEvent[] => sim.step({ ...IDLE_COMMAND, actions: [{ ...a, reqId: ++req } as GameAction] });
const result = (events: readonly SimEvent[]) => events.find((e) => e.type === 'actionResult');

/** Chart a sector by its survey points: all but the last are pre-marked, the last is pulsed. */
function surveyLast(sim: Simulation, id: string): SimEvent[] {
  const points = surveyPoints(SEED, id);
  sim.state.regions.points.set(id, (1 << (points.length - 1)) - 1);
  sim.step({ ...IDLE_COMMAND, actions: [{ type: 'undock', reqId: ++req }] });
  teleport(sim, points.at(-1)!.pos);
  sim.state.discovery.scanner.cooldown = 0;
  sim.state.player.energy = sim.state.player.props.batteryCapacity;
  return tapScan(sim);
}

function redock(sim: Simulation): void {
  const home = homeStation();
  sim.enterDocked(home.id, dockPose(home, sim.state.player.props.boundingRadius));
}

/** Accept the home board's "First chart" offer. */
function acceptFirst(sim: Simulation): Contract {
  const offer = currentBoard(sim.state, homeStation()).offers.find((o) => o.target.kind === 'chart' && o.target.first)!;
  expect(offer).toBeDefined();
  expect(result(act(sim, { type: 'acceptContract', offerId: offer.id }))).toMatchObject({ ok: true });
  return sim.state.career.contracts.at(-1)!;
}

describe('"First chart" and chart contracts', () => {
  it('the home board leads with "First chart" after the training: a depth-1 sector to chart and sell', () => {
    const sim = new Simulation({ seed: SEED });
    const target = firstChartTarget(sim.state)!;
    const board = currentBoard(sim.state, homeStation());
    const first = board.offers[0]!;
    expect(first).toMatchObject({ type: 'chart', faction: 'guild', ring: 1, target: { kind: 'chart', sector: target.id, first: true } });
    expect(first.id).toMatch(/^home@\d+\.first$/);
    // the quote covers the chart's sale: never below it
    expect(quoteOffer(sim.state, first).reward).toBeGreaterThanOrEqual(chartSellPrice(SEED, target.id));
    // not during the training
    const t = trainingSim(SEED);
    expect(firstChartTarget(t.state)).toBeNull();
    expect(currentBoard(t.state, homeStation()).offers.some((o) => o.target.kind === 'chart' && o.target.first)).toBe(false);
  });

  it('charting the sector makes the contract ready; turning it in pays once and marks the chart sold', () => {
    const sim = new Simulation({ seed: SEED });
    const c = acceptFirst(sim);
    const id = c.target.kind === 'chart' ? c.target.sector : '';
    // charted but not turned in: the sale goes with the contract
    const events = surveyLast(sim, id);
    expect(events).toContainEqual({ type: 'contractReady', contractId: c.serial });
    redock(sim);
    expect(result(act(sim, { type: 'chartSell', sector: id }))).toMatchObject({ ok: false, reason: 'chartReserved' });
    const credits = sim.state.credits;
    const done = act(sim, { type: 'turnInContract', contractId: c.serial });
    expect(result(done)).toMatchObject({ ok: true });
    expect(sim.state.credits).toBe(credits + c.reward);
    expect(c.reward).toBeGreaterThanOrEqual(chartSellPrice(SEED, id));
    expect(sim.state.regions.sold.has(id)).toBe(true);
    // contract and sale: the chart cannot be sold on top
    expect(result(act(sim, { type: 'chartSell', sector: id }))).toMatchObject({ ok: false, reason: 'chartSold' });
    expect(sim.state.credits).toBe(credits + c.reward);
    // "First chart" is done – no new one
    expect(firstChartTarget(sim.state)).toBeNull();
  });

  it('an offer for a sector charted meanwhile is refused; abandoning releases the chart for a normal sale', () => {
    const sim = new Simulation({ seed: SEED });
    const target = firstChartTarget(sim.state)!;
    for (const k of sectorChunkKeys(SEED, target.id)) sim.state.world.explored.add(k);
    const offer = currentBoard(sim.state, homeStation()).offers.find((o) => o.target.kind === 'chart' && o.target.sector === target.id);
    if (offer) expect(result(act(sim, { type: 'acceptContract', offerId: offer.id }))).toMatchObject({ ok: false, reason: 'contractUnavailable' });

    const other = new Simulation({ seed: SEED });
    const c = acceptFirst(other);
    const id = c.target.kind === 'chart' ? c.target.sector : '';
    for (const k of sectorChunkKeys(SEED, id)) other.state.world.explored.add(k);
    expect(result(act(other, { type: 'chartSell', sector: id }))).toMatchObject({ ok: false, reason: 'chartReserved' });
    expect(result(act(other, { type: 'abandonContract', contractId: c.serial }))).toMatchObject({ ok: true });
    expect(result(act(other, { type: 'chartSell', sector: id }))).toMatchObject({ ok: true });
  });

  it('chart offers only target sectors the player can still chart and sell, one slip per sector', () => {
    for (const seed of [1, 2, 3]) {
      const sim = new Simulation({ seed });
      for (let epoch = 0; epoch < 6; epoch++) {
        sim.state.tick = epoch * 20 * 60 * 60;
        const offers = currentBoard(sim.state, homeStation()).offers.filter((o) => o.target.kind === 'chart');
        const ids = offers.map((o) => (o.target.kind === 'chart' ? o.target.sector : ''));
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) {
          expect(sectorKnowledge(sim.state, id)).not.toBe('charted');
          expect(sectorInfo(seed, id)!.depth).toBeLessThanOrEqual(3);
        }
      }
    }
  });
});

describe('Guild Training step 8 charts lane A\'s first sector (§6.6)', () => {
  it('withheld (Reported) during the training, Charted with the checklist reward, its stations discovered', () => {
    const sim = trainingSim(SEED);
    const lane = trainingChartSector(SEED)!;
    expect(sectorKnowledge(sim.state, lane)).toBe('reported');
    sim.state.career.training.step = stepIndex('checklist');
    undock(sim);
    step(sim, { flight: { forward: 1, strafe: 0, turn: 0 } }, 60);
    trainingAct(sim, { type: 'trainingSeen', what: 'map' });
    trainingAct(sim, { type: 'trainingSeen', what: 'objectives' });
    dockHome(sim);
    const events = trainingAct(sim, { type: 'refuel', source: 'credits', amount: 'full' });
    expect(events.some((e) => e.type === 'trainingStep' && e.step === 'checklist')).toBe(true);
    expect(events).toContainEqual({ type: 'chartGranted', id: lane });
    expect(sectorKnowledge(sim.state, lane)).toBe('charted');
    const field = regionWorld(SEED).field;
    for (const k of sectorChunkKeys(SEED, lane)) {
      const [cx, cy] = k.split(',').map(Number) as [number, number];
      const s = stationAt(SEED, cx, cy, sim.state.world.gen);
      if (s && field.regionAt(s.pos.x, s.pos.y).id === lane) expect(sim.state.world.discovered.has(s.id)).toBe(true);
    }
    // the Guild's own chart: no Data, never sellable
    expect(result(act(sim, { type: 'chartSell', sector: lane }))).toMatchObject({ ok: false, reason: 'chartUnavailable' });
  });

  it('skipping the training charts it too', () => {
    const sim = trainingSim(SEED);
    const lane = trainingChartSector(SEED)!;
    expect(result(trainingAct(sim, { type: 'trainingSkip' }))).toMatchObject({ ok: true });
    expect(sectorKnowledge(sim.state, lane)).toBe('charted');
  });

  it('a pulse in flight marks nothing in the training sector (it has no survey points)', () => {
    const lane = trainingChartSector(SEED)!;
    expect(surveyPoints(SEED, lane)).toEqual([]);
    const sim = flyingAt(SEED, sectorInfo(SEED, lane)!.anchor);
    sim.state.discovery.scanner.cooldown = 0;
    expect(tapScan(sim).some((e) => e.type === 'surveyPointMarked' && e.sector === lane)).toBe(false);
  });
});
