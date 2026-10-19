// Fleet determinism across save and load (M4a, save V16): a game with stored ships – A runs N + M
// steps, B runs N, is saved, loaded and runs M more with the same commands (a hangar switch, undock,
// flight, a rename and a template); events and the saved state must match. Also a switch before the
// save, so the save holds a ship that left the hangar and one that entered it.
import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND, type GameAction, type GameActionInput, type PlayerCommand } from '../commands';
import { richSim, stock } from '../fleet/testing';
import { createStarterShip } from '../ship/presets';
import { homeOnly } from '../station/testHarness';
import { gridTemplateParts } from '../templates/normalize';
import type { Simulation, SimEvent } from '../Simulation';
import { loadSave } from './load';
import { restoreSimulation, toEnvelope, toSave } from './serialize';
import { testContext } from './testing';

const ctx = testContext();

/** Ship 1 (the starter, damaged and loaded) and two cockpit-only ships stored at home; ship 4 active. */
function setup(): Simulation {
  const sim = richSim(200_000);
  const s = sim.state;
  s.discovery.archive.add('hangarPlus');
  s.discovery.archive.add('templates');
  s.player.hp.set(2, 5);
  s.player.cargo.copper = 3;
  stock(sim, { 'cockpit:1': 3 });
  let req = 0;
  for (let i = 0; i < 3; i++) {
    sim.step({ ...IDLE_COMMAND, actions: [{ type: 'hangarBuySlot', reqId: ++req }] });
    sim.step({ ...IDLE_COMMAND, actions: [{ type: 'hangarNewShip', cockpit: 'cockpit:1', reqId: ++req }] });
  }
  expect(s.fleet.stored.map((x) => x.record.id)).toEqual([1, 2, 3]);
  return sim;
}

const action = (step: number, a: GameActionInput): GameAction => ({ ...a, reqId: 1000 + step } as GameAction);

/** The scripted commands: switch to ship `ship` at `switchAt`, undock, fly a curve; a rename and a template on the way. */
function script(step: number, switchAt: number): PlayerCommand {
  if (step === switchAt) return { ...IDLE_COMMAND, actions: [action(step, { type: 'hangarSwitch', shipId: 1 })] };
  if (step === switchAt + 10) return { ...IDLE_COMMAND, actions: [action(step, { type: 'undock' })] };
  if (step === switchAt + 200) return { ...IDLE_COMMAND, actions: [action(step, { type: 'hangarRename', shipId: 2, name: 'Iskra II' })] };
  if (step === switchAt + 300) return { ...IDLE_COMMAND, actions: [action(step, { type: 'templateSave', name: 'Štarter', parts: gridTemplateParts(createStarterShip()) })] };
  if (step <= switchAt + 10) return IDLE_COMMAND;
  return { ...IDLE_COMMAND, flight: { forward: step % 400 < 250 ? 1 : 0, strafe: 0, turn: Math.sin(step / 60) * 0.4 } };
}

function run(sim: Simulation, from: number, to: number, switchAt: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = from; i < to; i++) out.push(...sim.step(script(i, switchAt)));
  return out;
}

function roundTrip(sim: Simulation): Simulation {
  const result = loadSave(toEnvelope(toSave(sim, ctx)));
  if (!result.ok) throw new Error(`load failed: ${result.error} ${result.details.join('; ')}`);
  return restoreSimulation(result.save, { generator: homeOnly });
}

describe('fleet determinism across save and load', () => {
  it.each([
    // saved docked with 3 stored ships, the switch comes after the load
    [60, 1500, 100],
    // saved in flight after the switch (ship 4 parked, ship 1 flying)
    [400, 1500, 30],
    // saved right on the switch step
    [30, 900, 30],
  ])('N=%i, M=%i, switch at %i: identical events and state', (n, m, switchAt) => {
    const a = setup();
    const b = setup();
    run(a, 0, n, switchAt);
    run(b, 0, n, switchAt);
    const loaded = roundTrip(b);
    expect(JSON.stringify(toSave(loaded, ctx))).toBe(JSON.stringify(toSave(b, ctx)));
    const eventsA = run(a, n, n + m, switchAt);
    const eventsB = run(loaded, n, n + m, switchAt);
    expect(eventsB).toEqual(eventsA);
    expect(JSON.stringify(toSave(loaded, ctx))).toBe(JSON.stringify(toSave(a, ctx)));
    // the script really switched, flew and logged the distance on ship 1
    const { fleet, player } = loaded.state;
    expect(fleet.active.id).toBe(1);
    expect(fleet.stored.map((x) => x.record.id)).toEqual([2, 3, 4]);
    expect(player.dock.mode).toBe('flying');
    expect(fleet.active.log.distance).toBeGreaterThan(0);
    expect(fleet.stored[0]!.record.name).toBe('Iskra II');
    expect(loaded.state.templates.map((t) => t.name)).toEqual(['Štarter']);
  });
});
