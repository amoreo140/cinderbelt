import { oreGrade } from './mining/grade';
import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND, type PlayerCommand } from './commands';
import { createStarterShip } from './ship/presets';
import { Simulation } from './Simulation';
import { act, dockedAt, dockedSim, homeOnly } from './station/testHarness';
import type { ChunkGenerator } from './world/generate';
import { HOME_STATION_ID, homeStation } from './world/stations';
import { DEFAULT_SETTINGS } from './settings';

const forward: PlayerCommand = { ...IDLE_COMMAND, flight: { forward: 1, strafe: 0, turn: 0 } };

const rockAt =
  (x: number, y: number): ChunkGenerator =>
  (_s, cx, cy) => ({
    cx,
    cy,
    asteroids: cx === 0 && cy === 0 ? [{ id: 'rock', pos: { x, y }, baseRadius: 2, resource: 'iron', initialAmount: 100, variant: 0 }] : [],
  });

describe('Simulation – settings', () => {
  it('uses the default settings when none are given', () => {
    const sim = new Simulation({ seed: 7, generator: homeOnly });
    expect(sim.state.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('merges the given settings', () => {
    const sim = new Simulation({ seed: 7, generator: homeOnly, settings: { deathPenalty: 'hardcore', seedText: 'abc' } });
    expect(sim.state.settings).toEqual({ ...DEFAULT_SETTINGS, deathPenalty: 'hardcore', seedText: 'abc' });
  });

  it('mines with the mining yield of the settings', () => {
    const sim = new Simulation({ seed: 1, generator: rockAt(9, 0), settings: { miningYield: 0.5 }, startDocked: false });
    for (let i = 0; i < 60; i++) sim.step({ ...IDLE_COMMAND, mining: true, aim: { x: 9, y: 0 } });
    const grade = oreGrade(1, sim.state.world.asteroids()[0]!);
    expect(sim.state.player.cargo.iron).toBeCloseTo(0.5 * sim.state.player.props.lasers[0]!.rate * grade, 5);
  });
});

describe('Simulation – respawn point', () => {
  it('starts at the home station with the starting ship layout', () => {
    const sim = dockedSim();
    expect(sim.state.respawn.stationId).toBe(HOME_STATION_ID);
    expect(sim.state.respawn.grid).toEqual(createStarterShip());
  });

  it('moves to the last station the ship docked at', () => {
    const station = { ...homeStation(), id: 'st:0,0' };
    const sim = dockedAt(station);
    sim.step(IDLE_COMMAND);
    expect(sim.state.respawn.stationId).toBe('st:0,0');
  });

  it('follows a rebuilt ship while docked but not changes in flight', () => {
    const sim = dockedSim();
    const rebuilt = { ...sim.state.player.grid, nextId: 99 };
    sim.state.player.grid = rebuilt;
    sim.step(IDLE_COMMAND);
    expect(sim.state.respawn.grid).toBe(rebuilt);
    act(sim, { type: 'undock' });
    sim.state.player.grid = { ...rebuilt, nextId: 100 };
    sim.step(IDLE_COMMAND);
    expect(sim.state.respawn.grid).toBe(rebuilt);
  });
});

describe('Simulation – statistics', () => {
  it('starts with zero statistics', () => {
    expect(dockedSim().state.stats).toEqual({
      mined: { iron: 0, copper: 0, ice: 0, titanium: 0 },
      creditsEarned: 0,
      partsCrafted: 0,
      distanceFlown: 0,
      deaths: 0,
      kills: 0,
      lastEmergencyKit: -1,
      bestUnitsPerHour: [0, 0, 0, 0],
    });
  });

  it('counts mined resources', () => {
    const sim = new Simulation({ seed: 1, generator: rockAt(9, 0), startDocked: false });
    for (let i = 0; i < 60; i++) sim.step({ ...IDLE_COMMAND, mining: true, aim: { x: 9, y: 0 } });
    expect(sim.state.stats.mined.iron).toBeCloseTo(sim.state.player.cargo.iron, 9);
  });

  it('counts earned credits but not spent ones', () => {
    const sim = dockedSim();
    sim.state.player.cargo.iron = 10;
    const before = sim.state.credits;
    act(sim, { type: 'sellResource', resource: 'iron', qty: 'all', from: 'ship' });
    const earned = sim.state.credits - before;
    expect(earned).toBeGreaterThan(0);
    act(sim, { type: 'buyResource', resource: 'iron', qty: 1 });
    expect(sim.state.stats.creditsEarned).toBe(earned);
  });

  it('counts crafted parts', () => {
    const sim = dockedSim();
    sim.state.credits = 10_000;
    sim.state.player.cargo.iron = 100;
    sim.state.player.cargo.copper = 100;
    const events = act(sim, { type: 'craft', key: 'armor:1', count: 2 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'actionResult', ok: true }));
    expect(sim.state.stats.partsCrafted).toBe(2);
  });

  it('counts the distance flown', () => {
    const sim = new Simulation({ seed: 1, generator: () => ({ cx: 0, cy: 0, asteroids: [] }), startDocked: false });
    for (let i = 0; i < 60; i++) sim.step(forward);
    expect(sim.state.stats.distanceFlown).toBeCloseTo(sim.state.player.body.pos.x, 6);
  });
});

describe('World – active center', () => {
  it('reports the chunk the active area is centred on', () => {
    const sim = new Simulation({ seed: 1, generator: homeOnly, startDocked: false });
    expect(sim.state.world.center()).toEqual({ cx: 0, cy: 0 });
    sim.state.player.body = { ...sim.state.player.body, pos: { x: 450, y: -10 } };
    sim.step(IDLE_COMMAND);
    expect(sim.state.world.center()).toEqual({ cx: 2, cy: -1 });
  });
});
