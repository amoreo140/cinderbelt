// The ship log (M4a plan §2): deltas of the global stats go to the active record only; deaths come
// from applyDeath; stored ships are never touched by a death.
import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND } from '../commands';
import { applyDeath } from '../death/death';
import { act } from '../station/testHarness';
import { emptyStats } from '../Simulation';
import { advanceShipLog, logMark } from './log';
import { emptyShipLog } from './state';
import { parkForNewShip, richSim } from './testing';

const FLY = { ...IDLE_COMMAND, flight: { forward: 1, strafe: 0, turn: 0 } };

describe('advanceShipLog', () => {
  it('adds the growth since the mark and moves the mark', () => {
    const stats = emptyStats();
    const mark = logMark(stats);
    const log = emptyShipLog();
    stats.distanceFlown = 10;
    stats.kills = 2;
    stats.mined.iron = 3;
    stats.mined.ice = 1.5;
    advanceShipLog(log, mark, stats);
    expect(log).toEqual({ distance: 10, kills: 2, mined: 4.5, deaths: 0, built: 0 });
    expect(mark).toEqual({ distance: 10, kills: 2, mined: 4.5 });
    advanceShipLog(log, mark, stats);
    expect(log).toEqual({ distance: 10, kills: 2, mined: 4.5, deaths: 0, built: 0 });
  });

  it('never subtracts (stats only grow; a lower value is a foreign edit)', () => {
    const stats = emptyStats();
    stats.kills = 5;
    const mark = logMark(stats);
    const log = emptyShipLog();
    stats.kills = 3;
    advanceShipLog(log, mark, stats);
    expect(log.kills).toBe(0);
    stats.kills = 4;
    advanceShipLog(log, mark, stats);
    expect(log.kills).toBe(1);
  });
});

describe('ship log in the simulation', () => {
  it('distance, kills and mined go to the active ship only', () => {
    const sim = richSim();
    parkForNewShip(sim);
    act(sim, { type: 'hangarSwitch', shipId: 1 });
    const stored = structuredClone(sim.state.fleet.stored);
    act(sim, { type: 'undock' });
    for (let i = 0; i < 90; i++) sim.step(FLY);
    const { stats, fleet } = sim.state;
    expect(stats.distanceFlown).toBeGreaterThan(1);
    expect(fleet.active.log.distance).toBeCloseTo(stats.distanceFlown, 6);
    stats.kills += 2;
    stats.mined.copper += 4;
    sim.step(IDLE_COMMAND);
    expect(fleet.active.log).toMatchObject({ kills: 2, mined: 4 });
    expect(fleet.stored).toEqual(stored);
  });

  it('a death counts on the active record and keeps its identity; stored ships are untouched', () => {
    const sim = richSim();
    parkForNewShip(sim);
    act(sim, { type: 'hangarSwitch', shipId: 1 });
    sim.state.fleet.active.name = 'Lyra';
    const stored = structuredClone(sim.state.fleet.stored);
    act(sim, { type: 'undock' });
    sim.step(FLY);
    sim.state.player.destroyed = true;
    applyDeath(sim);
    sim.step(IDLE_COMMAND);
    expect(sim.state.fleet.active).toMatchObject({ id: 1, name: 'Lyra', log: { deaths: 1 } });
    expect(sim.state.stats.deaths).toBe(1);
    expect(sim.state.fleet.stored).toEqual(stored);
  });
});
