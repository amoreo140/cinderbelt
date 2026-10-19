import { describe, expect, it } from 'vitest';
import { partSellPrice, STARTING_CREDITS, STARTING_HOME_PARTS } from '../../data/economy';
import { partKey, type PartInventory, type PartKey } from '../../data/parts';
import { TRAINING_STEPS } from '../../data/training';
import { restoreSimulation, toSave } from '../save/serialize';
import { testContext } from '../save/testing';
import { Simulation, type SimEvent } from '../Simulation';
import { hullBudgetOf } from '../ship/budget';
import { blockedExhausts } from '../ship/exhaust';
import { validateGrid } from '../ship/grid';
import { createStarterShip } from '../ship/presets';
import { computeProperties } from '../ship/properties';
import type { ShipGrid } from '../ship/types';
import { blockedOutputs } from '../shipyard/design';
import { stationStorage } from '../station/storage';
import { HOME_STATION_ID } from '../world/stations';
import { createTrainingHull } from './sites';
import { act, commit, dockHome, mineAtRock, okOf, place, playTraining, step, stepId, teleport, trainingSim, undock } from './testing';
import { remainingRewardParts, trainingProgress } from './training';

/** The parts of a grid as a sorted multiset of keys. */
const composition = (grid: ShipGrid): string[] => grid.parts.map((p) => partKey(p.partId, p.tier, p.variant)).sort();
const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) => events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
const home = (sim: Simulation) => stationStorage(sim.state, HOME_STATION_ID);
const sumCredits = (events: readonly SimEvent[], reason: string) => ofType(events, 'creditsChanged').filter((e) => e.reason === reason).reduce((s, e) => s + e.delta, 0);

describe('Guild Training – start', () => {
  it('a new Simulation has no training (skip): the starter ship and the starting storage', () => {
    const sim = new Simulation({ seed: 3 });
    expect(sim.state.career.training.status).toBe('skipped');
    expect(composition(sim.state.player.grid)).toEqual(composition(createStarterShip()));
    expect(home(sim).parts).toEqual(STARTING_HOME_PARTS);
  });

  it('starts docked at home with the training hull, an empty storage and the sites near home', () => {
    const sim = trainingSim(1337);
    const { state } = sim;
    expect(state.career.training).toMatchObject({ status: 'active', step: 0, flags: 0, rewardAt: HOME_STATION_ID });
    expect(composition(state.player.grid)).toEqual(composition(createTrainingHull()));
    // a forward and a reverse engine: the dampers brake along the bow from the first second
    expect(state.player.props.thrust).toEqual({ forward: 90, backward: 90, left: 0, right: 0 });
    expect(state.player.blueprint).toBe(state.player.grid);
    expect(state.respawn.grid).toBe(state.player.grid);
    expect(state.player.dock).toEqual({ mode: 'docked', stationId: HOME_STATION_ID });
    expect(state.credits).toBe(STARTING_CREDITS);
    expect(home(sim).parts).toEqual({});
    const sites = state.career.training.sites!;
    for (const p of [sites.buoyA, sites.buoyB, sites.rockPos]) expect(Math.hypot(p.x, p.y)).toBeLessThan(250);
    const rock = state.world.findAsteroid(sites.rock)!;
    expect(rock.resource).toBe('iron');
    expect(rock.initialAmount).toBeGreaterThanOrEqual(60);
    // buoys in open space
    for (const b of [sites.buoyA, sites.buoyB]) {
      for (const a of state.world.asteroids()) expect(Math.hypot(a.pos.x - b.x, a.pos.y - b.y) - state.world.radiusOf(a)).toBeGreaterThanOrEqual(20);
    }
  });

  it('the training hull is a valid T1 hull: connected, within the 28-point budget, no covered nozzle', () => {
    const grid = createTrainingHull();
    expect(validateGrid(grid)).toEqual([]);
    expect(hullBudgetOf(grid)).toMatchObject({ used: 6, budget: 28, over: false });
    expect(blockedExhausts(grid)).toEqual([]);
    expect(blockedOutputs(grid)).toEqual([]);
    expect(computeProperties(grid).exhaustBurns).toEqual([]);
    expect(composition(grid)).toEqual(['cargo:1', 'cockpit:1', 'engine:1', 'engine:1', 'fuelTank:1', 'miningLaser:1']);
  });

  it('flying in a straight line with the dampers on, releasing the thrust stops the ship', () => {
    const sim = trainingSim(1337);
    undock(sim);
    expect(sim.state.player.dampers).toBe(true);
    teleport(sim, { x: 60, y: -40 });
    step(sim, { flight: { forward: 1, strafe: 0, turn: 0 } }, 120);
    expect(Math.hypot(sim.state.player.body.vel.x, sim.state.player.body.vel.y)).toBeGreaterThan(5);
    step(sim, {}, 360);
    expect(Math.hypot(sim.state.player.body.vel.x, sim.state.player.body.vel.y)).toBeLessThan(0.1);
  });

  it('picks the same sites for the same seed and other sites for another seed', () => {
    expect(trainingSim(42).state.career.training.sites).toEqual(trainingSim(42).state.career.training.sites);
    expect(trainingSim(42).state.career.training.sites).not.toEqual(trainingSim(1337).state.career.training.sites);
  });
});

describe('Guild Training – the whole training', () => {
  it('ends with the starter ship built by the player, the starting storage and 900 cr + the crafting fee', () => {
    const sim = trainingSim(1337);
    const events = playTraining(sim);
    const steps = ofType(events, 'trainingStep');
    expect(steps.map((e) => e.step)).toEqual(TRAINING_STEPS.map((s) => s.id));
    expect(steps.at(-1)!.done).toBe(true);
    expect(sim.state.career.training.status).toBe('done');
    // the ship the player built has the parts of the starter ship (placed his own way), all owned
    expect(composition(sim.state.player.grid)).toEqual(composition(createStarterShip()));
    expect(sim.state.player.grid.parts.some((p) => p.loan)).toBe(false);
    expect(home(sim).parts).toEqual(STARTING_HOME_PARTS);
    // 900 cr for the steps, 900 cr crafting fee (spent on the cargo hold)
    expect(sumCredits(events, 'contract')).toBe(900 + 900);
    expect(sim.state.career.rep.guild.points).toBe(TRAINING_STEPS.reduce((s, x) => s + x.reward.rep, 0));
    expect(ofType(events, 'guildLoan')).toEqual([]);
    expect(sim.state.career.log.some((l) => l.kind === 'trainingStep')).toBe(true);
  });

  it('never pays a step twice: after the end nothing more comes', () => {
    const sim = trainingSim(1337);
    playTraining(sim);
    const credits = sim.state.credits;
    const parts = structuredClone(home(sim).parts);
    const events = [...dockHome(sim), ...act(sim, { type: 'trainingSkip' }), ...step(sim, {}, 30)];
    expect(ofType(events, 'trainingStep')).toEqual([]);
    expect(okOf(events.filter((e) => e.type === 'actionResult'))).toBe(false);
    expect(sim.state.credits).toBe(credits);
    expect(home(sim).parts).toEqual(parts);
  });

  it('counts mined iron from the start of the step and a sale finishes the dock step', () => {
    const sim = trainingSim(1337);
    undock(sim);
    teleport(sim, sim.state.career.training.sites!.buoyA);
    step(sim);
    expect(stepId(sim)).toBe('mineIron');
    mineAtRock(sim, 8);
    expect(trainingProgress(sim.state)).toBeGreaterThanOrEqual(8);
    expect(trainingProgress(sim.state)).toBeLessThan(20);
    mineAtRock(sim, 13);
    expect(stepId(sim)).toBe('dockSell');
    dockHome(sim);
    expect(stepId(sim)).toBe('dockSell');
    const sold = act(sim, { type: 'sellResource', resource: 'iron', qty: 'all', from: 'ship' });
    expect(ofType(sold, 'trainingStep')[0]).toMatchObject({ step: 'dockSell', parts: { 'engine:1': 2 }, stationId: HOME_STATION_ID });
    expect(home(sim).parts['engine:1']).toBe(2);
  });

  it('stopping at the second buoy needs a slow ship – flying through does not count', () => {
    const sim = trainingSim(1337);
    sim.state.career.training.step = TRAINING_STEPS.findIndex((s) => s.id === 'brakeBuoy');
    undock(sim);
    const b = sim.state.career.training.sites!.buoyB;
    teleport(sim, b);
    sim.state.player.body = { ...sim.state.player.body, vel: { x: 6, y: 0 } };
    step(sim);
    expect(stepId(sim)).toBe('brakeBuoy');
    teleport(sim, b);
    const events = step(sim);
    expect(ofType(events, 'trainingStep')[0]).toMatchObject({ step: 'brakeBuoy', parts: { 'engine:1': 1 } });
  });

  it('the checklist needs the refuel, the map and the objectives', () => {
    const sim = trainingSim(1337);
    sim.state.career.training.step = TRAINING_STEPS.findIndex((s) => s.id === 'checklist');
    undock(sim);
    teleport(sim, { x: 60, y: -40 });
    step(sim, { flight: { forward: 1, strafe: 0, turn: 0 } }, 60);
    expect(act(sim, { type: 'trainingSeen', what: 'map' }).some((e) => e.type === 'actionResult' && e.ok)).toBe(true);
    expect(trainingProgress(sim.state)).toBe(1);
    act(sim, { type: 'trainingSeen', what: 'objectives' });
    expect(trainingProgress(sim.state)).toBe(2);
    dockHome(sim);
    expect(stepId(sim)).toBe('checklist');
    const events = act(sim, { type: 'refuel', source: 'credits', amount: 'full' });
    expect(ofType(events, 'trainingStep')[0]?.step).toBe('checklist');
    expect(home(sim).parts).toMatchObject({ 'reactor:1': 1, 'radar:1': 1, 'gyro:1': 1, 'engine:1': 1, 'armor:1': 2, 'cannon:1': 1 });
  });

  it('"seen" outside the checklist step is refused and changes nothing', () => {
    const sim = trainingSim(1337);
    const events = act(sim, { type: 'trainingSeen', what: 'map' });
    expect(events.find((e) => e.type === 'actionResult')).toMatchObject({ ok: false });
    expect(sim.state.career.training.flags).toBe(0);
  });

  it('survives save and load mid-training and plays on identically', () => {
    const a = trainingSim(1337);
    undock(a);
    teleport(a, a.state.career.training.sites!.buoyA);
    step(a);
    mineAtRock(a, 5);
    const b = restoreSimulation(structuredClone(toSave(a, testContext())));
    expect(b.state.career.training).toEqual(a.state.career.training);
    const cmd = { mining: true, aim: a.state.career.training.sites!.rockPos };
    for (let i = 0; i < 600; i++) {
      a.step({ ...cmd, flight: { forward: 0, strafe: 0, turn: 0 }, toggleDampers: false, emergency: false, fire: false, dock: false, actions: [] });
      b.step({ ...cmd, flight: { forward: 0, strafe: 0, turn: 0 }, toggleDampers: false, emergency: false, fire: false, dock: false, actions: [] });
    }
    expect(b.state.career.training).toEqual(a.state.career.training);
    expect(b.state.stats.mined).toEqual(a.state.stats.mined);
    expect(b.state.player.body).toEqual(a.state.player.body);
  });
});

describe('Guild Training – rewards cannot be farmed', () => {
  /** Training at the side-engine step, docked at home with the reward in the storage. */
  function atInstallSide(): Simulation {
    const sim = trainingSim(1337);
    undock(sim);
    teleport(sim, sim.state.career.training.sites!.buoyA);
    step(sim);
    mineAtRock(sim, 21);
    dockHome(sim);
    act(sim, { type: 'sellResource', resource: 'iron', qty: 'all', from: 'ship' });
    expect(stepId(sim)).toBe('installSide');
    return sim;
  }

  it('sold reward engines come back only as Guild loans – no value, never again', () => {
    const sim = atInstallSide();
    const before = sim.state.credits;
    const sold = act(sim, { type: 'sellPart', key: 'engine:1', count: 2 });
    expect(okOf(sold)).toBe(true);
    // the same step: the Guild mounts loan engines (left + right) and the step is paid once
    expect(ofType(sold, 'guildLoan')[0]?.parts).toEqual({ 'engine:1': 2 });
    expect(ofType(sold, 'trainingStep')[0]?.step).toBe('installSide');
    expect(sim.state.credits - before).toBe(2 * partSellPrice('engine:1') + TRAINING_STEPS[3]!.reward.credits);
    const lent = sim.state.player.grid.parts.filter((p) => p.loan);
    expect(lent).toHaveLength(2);
    expect(sim.state.player.props.thrust.left).toBeGreaterThan(0);
    expect(sim.state.player.props.thrust.right).toBeGreaterThan(0);
    step(sim);
    expect(stepId(sim)).toBe('brakeBuoy');
    // a loan never reaches the storage: removing it returns it to the Guild
    commit(sim, lent.map((p) => ({ op: 'remove' as const, id: p.id })));
    expect(home(sim).parts['engine:1'] ?? 0).toBe(0);
    expect(sim.state.player.grid.parts.some((p) => p.loan)).toBe(false);
    // the step does not go back and nothing is lent again
    const later = step(sim, {}, 30);
    expect(ofType(later, 'guildLoan')).toEqual([]);
    expect(stepId(sim)).toBe('brakeBuoy');
  });

  it('a spare engine anywhere means no loan (the player installs his own)', () => {
    const sim = atInstallSide();
    act(sim, { type: 'sellPart', key: 'engine:1', count: 1 });
    const events = step(sim, {}, 10);
    expect(ofType(events, 'guildLoan')).toEqual([]);
    expect(stepId(sim)).toBe('installSide');
  });

  it('skipping mid-training gives only the parts not paid yet and fits the starter ship when docked', () => {
    const sim = atInstallSide();
    const credits = sim.state.credits;
    const remaining = remainingRewardParts(sim.state.career.training);
    const events = act(sim, { type: 'trainingSkip' });
    expect(ofType(events, 'trainingSkipped')[0]).toMatchObject({ assembled: true, parts: remaining });
    expect(sim.state.career.training.status).toBe('skipped');
    expect(sim.state.credits).toBe(credits);
    expect(composition(sim.state.player.grid)).toEqual(composition(createStarterShip()));
    expect(sim.state.player.blueprint).toBe(sim.state.player.grid);
    expect(home(sim).parts).toEqual(STARTING_HOME_PARTS);
    // a second skip does nothing
    expect(okOf(act(sim, { type: 'trainingSkip' }))).toBe(false);
  });

  it('skipping after selling the rewards does not replace them: the ship is not fitted, the rest waits in the storage', () => {
    const sim = atInstallSide();
    act(sim, { type: 'sellPart', key: 'engine:1', count: 1 });
    step(sim, {}, 2);
    const remaining = remainingRewardParts(sim.state.career.training);
    const events = act(sim, { type: 'trainingSkip' });
    expect(ofType(events, 'trainingSkipped')[0]?.assembled).toBe(false);
    const total: PartInventory = { 'engine:1': 1 };
    for (const [k, n] of Object.entries(remaining) as [PartKey, number][]) total[k] = (total[k] ?? 0) + n;
    expect(home(sim).parts).toEqual(total);
  });

  it('skipping in flight puts the parts into the reward station storage', () => {
    const sim = trainingSim(1337);
    undock(sim);
    const events = act(sim, { type: 'trainingSkip' });
    expect(ofType(events, 'trainingSkipped')[0]).toMatchObject({ assembled: false, stationId: HOME_STATION_ID });
    const parts = home(sim).parts;
    // the whole reward: 4 engines, a cargo hold, reactor, radar, gyroscope, 2 armor plates, cannon
    expect(parts).toEqual({ 'engine:1': 4, 'cargo:1': 1, 'reactor:1': 1, 'radar:1': 1, 'gyro:1': 1, 'armor:1': 2, 'cannon:1': 1 });
    // docking afterwards: the player builds it himself (the shipyard has everything for the starter ship)
    dockHome(sim);
    const starter = createStarterShip();
    const hull = composition(sim.state.player.grid);
    const all = [...hull, ...Object.entries(parts).flatMap(([k, n]) => Array<string>(n ?? 0).fill(k))].sort();
    for (const k of composition(starter)) expect(all).toContain(k);
  });

  it('the total value a training can hand out equals what a skipped game starts with plus the step credits', () => {
    // skip at the start: the parts of the whole reward = starter ship − training hull + starting storage
    const parts = remainingRewardParts(trainingSim(1337).state.career.training);
    const fromTraining = [...composition(createTrainingHull()), ...Object.entries(parts).flatMap(([k, n]) => Array<string>(n ?? 0).fill(k))].sort();
    const skipped = [...composition(createStarterShip()), ...Object.entries(STARTING_HOME_PARTS).flatMap(([k, n]) => Array<string>(n ?? 0).fill(k))].sort();
    expect(fromTraining).toEqual(skipped);
    expect(TRAINING_STEPS.reduce((s, x) => s + x.reward.credits, 0)).toBe(900);
  });
});

describe('Guild Training – install steps accept any valid placement', () => {
  it('side engines anywhere on the hull count, one per side', () => {
    const sim = trainingSim(1337);
    sim.state.career.training.step = TRAINING_STEPS.findIndex((s) => s.id === 'installSide');
    sim.state.stations.get(HOME_STATION_ID)!.parts = { 'engine:1': 2 };
    commit(sim, [place('engine:1', -1, -1, 1)]);
    step(sim);
    expect(trainingProgress(sim.state)).toBe(1);
    expect(stepId(sim)).toBe('installSide');
    const events = commit(sim, [place('engine:1', 2, 2, 3)]);
    expect(ofType(events, 'trainingStep')[0]?.step).toBe('installSide');
  });

  it("the reverse step counts the hull's own reverse engine: the reward engine is the second one", () => {
    const sim = trainingSim(1337);
    sim.state.career.training.step = TRAINING_STEPS.findIndex((s) => s.id === 'installReverse');
    sim.state.stations.get(HOME_STATION_ID)!.parts = { 'engine:1': 1 };
    step(sim);
    expect(trainingProgress(sim.state)).toBe(1);
    expect(stepId(sim)).toBe('installReverse');
    const events = commit(sim, [place('engine:1', 2, -1, 2)]);
    expect(ofType(events, 'trainingStep')[0]?.step).toBe('installReverse');
    expect(sim.state.player.props.thrust.backward).toBe(180);
  });

  it("the reverse step after the hull's reverse engine was moved still needs two (one is not enough)", () => {
    const sim = trainingSim(1337);
    sim.state.career.training.step = TRAINING_STEPS.findIndex((s) => s.id === 'installReverse');
    sim.state.stations.get(HOME_STATION_ID)!.parts = { 'engine:1': 1 };
    const own = sim.state.player.grid.parts.find((p) => p.partId === 'engine' && p.rot === 2)!;
    commit(sim, [{ op: 'remove', id: own.id }]);
    step(sim);
    expect(trainingProgress(sim.state)).toBe(0);
    commit(sim, [place('engine:1', 2, 1, 2)]);
    step(sim);
    expect(trainingProgress(sim.state)).toBe(1);
    expect(stepId(sim)).toBe('installReverse');
    const events = commit(sim, [place('engine:1', 2, -1, 2)]);
    expect(ofType(events, 'trainingStep')[0]?.step).toBe('installReverse');
  });
});
