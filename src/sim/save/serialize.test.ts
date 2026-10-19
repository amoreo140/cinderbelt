import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND, type GameAction, type GameActionInput, type PlayerCommand } from '../commands';
import { Simulation, type SimEvent } from '../Simulation';
import { createStarterShip } from '../ship/presets';
import { dockedSim, homeOnly } from '../station/testHarness';
import type { ChunkGenerator } from '../world/generate';
import { HOME_STATION_ID } from '../world/stations';
import { fnv1aHex } from '../math/fnv1a';
import { loadSave } from './load';
import { restoreSimulation, toEnvelope, toSave } from './serialize';
import { testContext } from './testing';

const ctx = testContext();

const action = (a: GameActionInput, reqId = 1): PlayerCommand => ({ ...IDLE_COMMAND, actions: [{ ...a, reqId } as GameAction] });

/** Save → envelope (JSON) → load → restore, as with a real save. */
function roundTrip(sim: Simulation, generator?: ChunkGenerator): Simulation {
  const result = loadSave(toEnvelope(toSave(sim, ctx)));
  if (!result.ok) throw new Error(`load failed: ${result.error} ${result.details.join('; ')}`);
  return restoreSimulation(result.save, generator ? { generator } : {});
}

describe('toSave', () => {
  it('saves a new game docked at home', () => {
    const sim = new Simulation({ seed: 42, generator: homeOnly, settings: { seedText: 'abc', deathPenalty: 'hard' } });
    const save = toSave(sim, ctx);
    expect(save).toMatchObject({
      version: 20,
      worldGen: 2,
      gameId: 'game-1',
      name: 'Testovacia hra',
      saveReason: 'manual',
      seed: 42,
      tick: 0,
      credits: sim.state.credits,
      settings: { seedText: 'abc', deathPenalty: 'hard', enemyDensity: 'normal', miningYield: 1, fallenFromHardcore: false },
    });
    expect(save.player.dockedAt).toBe(HOME_STATION_ID);
    expect(save.player.hp).toEqual([]);
    expect(save.player.grid.parts).toHaveLength(createStarterShip().parts.length);
    expect(save.respawn).toEqual({ stationId: HOME_STATION_ID, grid: save.player.grid });
    expect(save.stations).toEqual({ [HOME_STATION_ID]: { resources: { iron: 0, copper: 0, ice: 0, titanium: 0 }, parts: { 'armor:1': 2, 'cannon:1': 1 } } });
    expect(save.world.discoveredStations).toEqual([HOME_STATION_ID]);
    expect(save.world.explored).toContain('0,0');
    expect(save.world.center).toEqual([0, 0]);
  });

  it('is plain JSON data independent of the simulation', () => {
    const sim = dockedSim();
    const save = toSave(sim, ctx);
    expect(JSON.parse(JSON.stringify(save))).toEqual(save);
    save.player.cargo.iron = 99;
    save.player.grid.parts[0]!.x = 99;
    expect(sim.state.player.cargo.iron).toBe(0);
    expect(sim.state.player.grid.parts[0]!.x).not.toBe(99);
  });

  it('stores only damaged parts, sorted by id', () => {
    const sim = dockedSim();
    sim.state.player.hp.set(5, 3);
    sim.state.player.hp.set(2, 10);
    expect(toSave(sim, ctx).player.hp).toEqual([
      [2, 10],
      [5, 3],
    ]);
  });

  it('omits empty station storages and zero part counts', () => {
    const sim = dockedSim();
    sim.state.stations.set('st:3,4', { resources: { iron: 0, copper: 0, ice: 0, titanium: 0 }, parts: { 'engine:1': 0 } });
    sim.state.stations.set('st:1,1', { resources: { iron: 0, copper: 2.5, ice: 0, titanium: 0 }, parts: { 'engine:1': 0, 'gyro:2': 1 } });
    const save = toSave(sim, ctx);
    expect(Object.keys(save.stations)).toEqual([HOME_STATION_ID, 'st:1,1']);
    expect(save.stations['st:1,1']!.parts).toEqual({ 'gyro:2': 1 });
  });

  it('saves a docking approach as the docked target state', () => {
    const sim = dockedSim();
    sim.step(action({ type: 'undock' }));
    // the undock pose faces away from the station: turn the bow back to the clamp
    sim.state.player.body = { ...sim.state.player.body, angle: Math.PI };
    sim.step({ ...IDLE_COMMAND, dock: true });
    const dock = sim.state.player.dock;
    expect(dock.mode).toBe('docking');
    const save = toSave(sim, ctx);
    expect(save.player.dockedAt).toBe(HOME_STATION_ID);
    if (dock.mode === 'docking') expect(save.player.body).toEqual(dock.to);
  });
});

describe('toEnvelope', () => {
  it('wraps the JSON with its FNV-1a checksum and version', () => {
    const save = toSave(dockedSim(), ctx);
    const env = toEnvelope(save);
    expect(env.format).toBe('cinderbelt-save');
    expect(env.version).toBe(20);
    expect(env.data).toBe(JSON.stringify(save));
    expect(env.checksum).toBe(fnv1aHex(env.data));
  });
});

describe('restoreSimulation', () => {
  it('restores exactly the saved state', () => {
    const sim = dockedSim();
    sim.state.player.hp.set(3, 7);
    sim.state.player.cargo.ice = 12.25;
    sim.state.credits = 1234;
    sim.state.stats.deaths = 2;
    sim.state.settings.fallenFromHardcore = true;
    sim.step(action({ type: 'undock' }));
    for (let i = 0; i < 30; i++) sim.step({ ...IDLE_COMMAND, flight: { forward: 1, strafe: 0.3, turn: 0.5 } });
    const restored = roundTrip(sim, homeOnly);
    expect(toSave(restored, ctx)).toEqual(toSave(sim, ctx));
    const p = restored.state.player;
    expect(p.prevBody).toEqual(p.body);
    expect(p.beams).toEqual([]);
    expect(p.lastLocalForce).toEqual({ x: 0, y: 0 });
    expect(p.props).toEqual(sim.state.player.props);
    expect(p.dock).toEqual({ mode: 'flying' });
  });

  it('restores a docked ship at its station', () => {
    const restored = roundTrip(dockedSim(), homeOnly);
    expect(restored.state.player.dock).toEqual({ mode: 'docked', stationId: HOME_STATION_ID });
  });

  it('restores the same active chunks around the saved center', () => {
    const sim = new Simulation({ seed: 9 });
    sim.step(action({ type: 'undock' }));
    sim.state.player.body = { ...sim.state.player.body, pos: { x: 390, y: 10 } };
    sim.step(IDLE_COMMAND);
    // the ship moves within its chunk – the centre of the active area stays
    sim.state.player.body = { ...sim.state.player.body, pos: { x: 395, y: 15 } };
    const restored = roundTrip(sim);
    expect(restored.state.world.center()).toEqual(sim.state.world.center());
    const ids = (s: Simulation) => s.state.world.asteroids().map((a) => a.id).sort();
    expect(ids(restored)).toEqual(ids(sim));
  });
});

// ---- determinism (spec 9.4): A runs N + M steps; B runs N, is saved, loaded and runs M more ----

/** Scripted player: undocks, flies to the nearest asteroid, mines, toggles the dampers now and then, returns and docks. */
function scriptedCommand(sim: Simulation, step: number): PlayerCommand {
  const { player, world } = sim.state;
  if (player.dock.mode === 'docked') {
    if (step % 37 === 0) return action({ type: 'sellResource', resource: 'copper', qty: 'all', from: 'ship' }, step);
    if (step % 41 === 0) return action({ type: 'sellResource', resource: 'iron', qty: 'all', from: 'ship' }, step);
    if (step % 50 === 0) return action({ type: 'undock' }, step);
    return IDLE_COMMAND;
  }
  const pos = player.body.pos;
  const goHome = step % 1000 >= 650;
  let target = { x: 0, y: 0 };
  let best = Infinity;
  if (goHome) {
    best = Math.hypot(pos.x, pos.y);
  } else {
    for (const a of world.asteroids()) {
      const d = Math.hypot(a.pos.x - pos.x, a.pos.y - pos.y);
      if (d < best) {
        best = d;
        target = a.pos;
      }
    }
  }
  const angleTo = Math.atan2(target.y - pos.y, target.x - pos.x);
  let diff = angleTo - player.body.angle;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const turn = Math.max(-1, Math.min(1, diff * 2));
  if (goHome) {
    return {
      ...IDLE_COMMAND,
      flight: { forward: best > 24 && Math.abs(diff) < 0.5 && Math.hypot(player.body.vel.x, player.body.vel.y) < 6 ? 0.8 : 0, strafe: 0, turn },
      toggleDampers: !player.dampers,
      dock: step % 10 === 0,
    };
  }
  return {
    ...IDLE_COMMAND,
    flight: { forward: best > 12 ? 0.7 : 0, strafe: Math.sin(step / 40) * 0.3, turn },
    aim: target,
    mining: best < 20,
    toggleDampers: step % 173 === 0,
  };
}

function runScript(sim: Simulation, from: number, to: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let step = from; step < to; step++) events.push(...sim.step(scriptedCommand(sim, step)));
  return events;
}

function fingerprint(sim: Simulation) {
  const { player, world } = sim.state;
  return {
    save: JSON.stringify(toSave(sim, ctx)),
    body: player.body,
    prevBody: player.prevBody,
    beams: player.beams,
    lastLocalForce: player.lastLocalForce,
    dock: player.dock,
    // the order of the active chunks depends on the movement history – the simulation does not depend on it
    asteroids: world
      .asteroids()
      .map((a) => [a.id, world.remaining(a), world.radiusOf(a)] as const)
      .sort((x, y) => (x[0] < y[0] ? -1 : 1)),
    stations: world.stations().map((s) => s.id).sort(),
  };
}

describe('determinism across save and load', () => {
  it.each([
    [1, 300, 700],
    [7, 1100, 900],
    [1337, 2000, 1500],
  ])('seed %i: N=%i, M=%i gives identical states', (seed, n, m) => {
    const a = new Simulation({ seed, settings: { miningYield: 2 } });
    const b = new Simulation({ seed, settings: { miningYield: 2 } });
    runScript(a, 0, n);
    runScript(b, 0, n);
    const loaded = roundTrip(b);
    const eventsA = runScript(a, n, n + m);
    const eventsB = runScript(loaded, n, n + m);
    expect(eventsB).toEqual(eventsA);
    expect(fingerprint(loaded)).toEqual(fingerprint(a));
    // the script really did something
    expect(a.state.stats.distanceFlown).toBeGreaterThan(10);
  });

  it('covers docking, station actions and undocking after the load', () => {
    const script = (sim: Simulation, step: number): PlayerCommand => {
      if (step === 0) return action({ type: 'undock' }, 1);
      // turn in place by the clamp until the bow points at the station, then dock (after the load)
      if (step < 220 && sim.state.player.dock.mode === 'flying') return { ...IDLE_COMMAND, flight: { forward: 0, strafe: 0, turn: 1 }, dock: step >= 70 };
      if (step === 220) return action({ type: 'craft', key: 'armor:1', count: 1 }, 2);
      if (step === 221) return action({ type: 'sellResource', resource: 'iron', qty: 'all', from: 'ship' }, 3);
      if (step === 222) return action({ type: 'undock' }, 4);
      if (step > 222) return { ...IDLE_COMMAND, flight: { forward: 1, strafe: 0, turn: -0.3 } };
      return IDLE_COMMAND;
    };
    const run = (sim: Simulation, from: number, to: number): SimEvent[] => {
      const events: SimEvent[] = [];
      for (let step = from; step < to; step++) events.push(...sim.step(script(sim, step)));
      return events;
    };
    const make = () => {
      const sim = new Simulation({ seed: 3 });
      sim.state.player.cargo.iron = 40;
      return sim;
    };
    const a = make();
    const b = make();
    run(a, 0, 60);
    run(b, 0, 60);
    const loaded = roundTrip(b);
    const eventsA = run(a, 60, 340);
    expect(run(loaded, 60, 340)).toEqual(eventsA);
    expect(fingerprint(loaded)).toEqual(fingerprint(a));
    const types = eventsA.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['dockingStarted', 'docked', 'creditsChanged', 'undocked']));
    expect(a.state.stats.partsCrafted).toBe(1);
  });

  it('mined something along the way (the script exercises mining)', () => {
    const a = new Simulation({ seed: 1337, settings: { miningYield: 2 } });
    runScript(a, 0, 3500);
    const mined = Object.values(a.state.stats.mined).reduce((s, v) => s + v, 0);
    expect(mined).toBeGreaterThan(0);
    expect(a.state.world.remainingById.size).toBeGreaterThan(0);
  });
});
