// Wreck parts on docking, towing and loading (C1, I2, M10) and a stranded ship without engines (C2).
import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND, type PlayerCommand } from './commands';
import { createBody } from './physics/body';
import { restoreSimulation, toSave } from './save/serialize';
import { testContext } from './save/testing';
import { validateSave } from './save/validate';
import { createGrid } from './ship/grid';
import { Simulation, type SimEvent } from './Simulation';
import { DOCKING_TICKS } from './station/dock';
import { towAvailable } from './station/tow';
import type { ChunkGenerator } from './world/generate';
import { HOME_STATION_ID, homeStation, type StationDef } from './world/stations';

const outpost: StationDef = { ...homeStation(), id: 'st:1,0', pos: { x: 300, y: 100 }, chunk: { cx: 1, cy: 0 } };

/** Home and one untouched station, no asteroids. */
const twoStations: ChunkGenerator = (_s, cx, cy) => ({
  cx,
  cy,
  asteroids: [],
  ...(cx === 0 && cy === 0 ? { station: homeStation() } : cx === 1 && cy === 0 ? { station: outpost } : {}),
});

const dock: PlayerCommand = { ...IDLE_COMMAND, dock: true };

function run(sim: Simulation, cmd: PlayerCommand, steps: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < steps; i++) events.push(...sim.step(cmd));
  return events;
}

/** A ship in flight by the dock clamp of `station` (in docking reach) with wreck parts on board. */
function nearStation(station: StationDef, sim = new Simulation({ seed: 1, generator: twoStations, startDocked: false })): Simulation {
  const p = sim.state.player;
  p.dock = { mode: 'flying' };
  // 2 u out from the docking point by the clamp (port angle 0), the bow at the station
  const body = createBody({ x: station.pos.x + station.radius + p.props.boundingRadius + 1 + 2, y: station.pos.y }, Math.PI);
  p.body = body;
  p.prevBody = body;
  p.salvage = { 'armor:2': 2, 'cannon:1': 1 };
  sim.step(IDLE_COMMAND);
  return sim;
}

describe('C1 – salvage reaches the station storage', () => {
  it('stores salvage at an untouched station without a storage entry', () => {
    const sim = nearStation(outpost);
    expect(sim.state.stations.has(outpost.id)).toBe(false);
    sim.step(dock);
    const events = run(sim, IDLE_COMMAND, DOCKING_TICKS);
    expect(events).toContainEqual({ type: 'salvageStored', stationId: outpost.id, parts: { 'armor:2': 2, 'cannon:1': 1 } });
    expect(sim.state.stations.get(outpost.id)?.parts).toEqual({ 'armor:2': 2, 'cannon:1': 1 });
    expect(sim.state.player.salvage).toEqual({});
  });

  it('stores salvage at home after a save and load dropped its empty storage entry', () => {
    const sim = new Simulation({ seed: 1, generator: twoStations });
    sim.state.stations.set(HOME_STATION_ID, { resources: sim.state.stations.get(HOME_STATION_ID)!.resources, parts: {} });
    const valid = validateSave(JSON.parse(JSON.stringify(toSave(sim, testContext()))));
    if (!valid.ok) throw new Error(valid.errors.join('\n'));
    expect(valid.save.stations[HOME_STATION_ID]).toBeUndefined();
    const loaded = nearStation(homeStation(), restoreSimulation(valid.save, { generator: twoStations }));
    expect(loaded.state.stations.has(HOME_STATION_ID)).toBe(false);
    loaded.step(dock);
    const events = run(loaded, IDLE_COMMAND, DOCKING_TICKS);
    expect(events.some((e) => e.type === 'salvageStored')).toBe(true);
    expect(loaded.state.stations.get(HOME_STATION_ID)?.parts).toEqual({ 'armor:2': 2, 'cannon:1': 1 });
  });

  it('stores salvage and reports it after a paid tow to a station without a storage entry', () => {
    const sim = nearStation(outpost);
    sim.state.world.discovered.delete(HOME_STATION_ID);
    sim.state.world.discovered.add(outpost.id);
    sim.state.player.fuel = 0;
    sim.state.credits = 10_000;
    const events = sim.step({ ...IDLE_COMMAND, emergency: true });
    expect(events).toContainEqual(expect.objectContaining({ type: 'towed', stationId: outpost.id, cargoLost: false }));
    expect(events).toContainEqual({ type: 'salvageStored', stationId: outpost.id, parts: { 'armor:2': 2, 'cannon:1': 1 } });
    expect(sim.state.stations.get(outpost.id)?.parts).toEqual({ 'armor:2': 2, 'cannon:1': 1 });
  });
});

describe('M10 – a free tow loses the salvage together with the cargo', () => {
  it('clears salvage aboard and reports cargoLost even with an empty cargo hold', () => {
    const sim = nearStation(outpost);
    sim.state.player.fuel = 0;
    sim.state.credits = 0;
    const events = sim.step({ ...IDLE_COMMAND, emergency: true });
    expect(events).toContainEqual(expect.objectContaining({ type: 'towed', cost: 0, cargoLost: true }));
    expect(events.some((e) => e.type === 'salvageStored')).toBe(false);
    expect(sim.state.player.salvage).toEqual({});
    const stored = [...sim.state.stations.values()].flatMap((s) => Object.keys(s.parts));
    expect(stored).not.toContain('armor:2');
  });
});

describe('I2 – a save during the docking animation loads into the docked state', () => {
  it('loads the same state the game reaches by continuing the animation', () => {
    const sim = nearStation(outpost);
    const p = sim.state.player;
    p.energy = 1;
    p.shield = 0;
    sim.step(dock);
    run(sim, IDLE_COMMAND, 29);
    expect(p.dock.mode).toBe('docking');
    const save = JSON.parse(JSON.stringify(toSave(sim, testContext())));
    const valid = validateSave(save);
    if (!valid.ok) throw new Error(valid.errors.join('\n'));
    const loaded = restoreSimulation(valid.save, { generator: twoStations });

    run(sim, IDLE_COMMAND, DOCKING_TICKS);
    expect(p.dock).toEqual({ mode: 'docked', stationId: outpost.id });
    const view = (s: Simulation) => ({
      dock: s.state.player.dock,
      body: s.state.player.body,
      energy: s.state.player.energy,
      shield: s.state.player.shield,
      salvage: s.state.player.salvage,
      stations: [...s.state.stations],
    });
    expect(view(loaded)).toEqual(view(sim));
    expect(loaded.state.player.salvage).toEqual({});
    expect(loaded.state.stations.get(outpost.id)?.parts).toEqual({ 'armor:2': 2, 'cannon:1': 1 });
  });

  it('keeps a truly docked save unchanged by the load normalisation', () => {
    const sim = new Simulation({ seed: 1, generator: twoStations });
    const save = toSave(sim, testContext());
    const loaded = restoreSimulation(structuredClone(save), { generator: twoStations });
    expect(toSave(loaded, testContext())).toEqual(save);
  });
});

/** A ship without forward engines (destroyed) – only the cockpit and a reverse engine. */
const noForwardEngine = () =>
  createGrid([
    ['cockpit', 0, 0],
    ['engine', 1, 0, 2],
  ]);

describe('C2 – a ship without engines is not stuck', () => {
  it('offers a tow when the tank is empty or the ship has no forward thrust', () => {
    const sim = new Simulation({ seed: 1, generator: twoStations, startDocked: false });
    expect(towAvailable(sim.state.player)).toBe(false);
    sim.state.player.fuel = 0;
    expect(towAvailable(sim.state.player)).toBe(true);
    const crippled = new Simulation({ seed: 1, generator: twoStations, startDocked: false, grid: noForwardEngine() });
    expect(crippled.state.player.fuel).toBeGreaterThan(0);
    expect(towAvailable(crippled.state.player)).toBe(true);
  });

  it('tows a ship with fuel but without forward thrust', () => {
    const sim = new Simulation({ seed: 1, generator: twoStations, startDocked: false, grid: noForwardEngine() });
    const events = sim.step({ ...IDLE_COMMAND, emergency: true });
    expect(events).toContainEqual(expect.objectContaining({ type: 'towed', stationId: HOME_STATION_ID }));
    expect(sim.state.player.dock).toEqual({ mode: 'docked', stationId: HOME_STATION_ID });
  });

  it('ignores the tow request of a ship that can still fly', () => {
    const sim = new Simulation({ seed: 1, generator: twoStations, startDocked: false });
    const events = sim.step({ ...IDLE_COMMAND, emergency: true });
    expect(events.some((e) => e.type === 'towed')).toBe(false);
    expect(sim.state.player.dock.mode).toBe('flying');
  });

  it('scuttles the ship in flight: the cockpit is destroyed and the death flow starts', () => {
    const sim = new Simulation({ seed: 1, generator: twoStations, startDocked: false });
    const events = sim.step({ ...IDLE_COMMAND, scuttle: true });
    const i = events.findIndex((e) => e.type === 'shipScuttled');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(events.findIndex((e) => e.type === 'playerDestroyed')).toBeGreaterThan(i);
    expect(events).toContainEqual(expect.objectContaining({ type: 'partDestroyed', ref: 'player', key: 'cockpit:1' }));
    expect(sim.state.player.destroyed).toBe(true);
    // a further command does nothing
    expect(sim.step({ ...IDLE_COMMAND, scuttle: true }).some((e) => e.type === 'playerDestroyed')).toBe(false);
  });

  it('ignores scuttle while docked or docking', () => {
    const sim = new Simulation({ seed: 1, generator: twoStations });
    expect(sim.step({ ...IDLE_COMMAND, scuttle: true }).some((e) => e.type === 'shipScuttled')).toBe(false);
    expect(sim.state.player.destroyed).toBe(false);
    const docking = nearStation(outpost);
    docking.step(dock);
    expect(docking.step({ ...IDLE_COMMAND, scuttle: true }).some((e) => e.type === 'shipScuttled')).toBe(false);
    expect(docking.state.player.destroyed).toBe(false);
  });
});
