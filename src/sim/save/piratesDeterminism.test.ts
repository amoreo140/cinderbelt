// Pirate determinism across save and load (M3.6): attention, hunting party, a challenge raid,
// fortress turrets, reinforcements and damage – A runs N + M steps, B runs N, saves, loads, runs M.
import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND, type PlayerCommand } from '../commands';
import { flyingAt } from '../discovery/testing';
import { fortressSites, fortressToWorld, FORTRESS_LAYOUT } from '../pirates/sites';
import { createGrid } from '../ship/grid';
import type { Simulation, SimEvent } from '../Simulation';
import { loadSave } from './load';
import { restoreSimulation, toEnvelope, toSave } from './serialize';
import { testContext } from './testing';

const ctx = testContext();
const SEED = 4242;

const fighter = () =>
  createGrid([
    ['cockpit', 0, 0],
    ['gyro', 0, 2],
    ['cannon', 1, 1, 0],
    ['cannon', 1, -1, 0],
    ['armor', 1, 0, 0],
    ['reactor', -1, 0],
    ['shield', 0, 1],
    ['cargo', 0, -1],
    ['engine', -2, 0, 0],
    ['engine', 2, 0, 2],
    ['engine', -1, 1, 1],
    ['engine', -1, -1, 3],
  ]);

function setup(): Simulation {
  const f = fortressSites(SEED)[0]!;
  const sim = flyingAt(SEED, fortressToWorld(f, { x: -45, y: 20 }), fighter());
  sim.state.pirates.attention = 62;
  sim.state.player.dampers = false;
  return sim;
}

/** Pilot circles behind the fortress shooting the generators, presses F now and then. */
function script(sim: Simulation, step: number): PlayerCommand {
  const f = fortressSites(SEED)[0]!;
  const gen = fortressToWorld(f, FORTRESS_LAYOUT.shieldGens[step % 400 < 200 ? 0 : 1]!);
  return {
    ...IDLE_COMMAND,
    flight: { forward: Math.sin(step / 70) * 0.4, strafe: Math.cos(step / 50) * 0.5, turn: Math.sin(step / 40) * 0.5 },
    aim: gen,
    fire: step % 3 !== 0,
    dock: step % 150 === 0,
  };
}

function run(sim: Simulation, from: number, to: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = from; i < to; i++) out.push(...sim.step(script(sim, i)));
  return out;
}

function roundTrip(sim: Simulation): Simulation {
  const result = loadSave(toEnvelope(toSave(sim, ctx)));
  if (!result.ok) throw new Error(`load failed: ${result.error} ${result.details.join('; ')}`);
  return restoreSimulation(result.save);
}

describe('pirate determinism across save and load', () => {
  it.each([
    [120, 1500],
    [777, 1200],
  ])('N=%i, M=%i: identical events and state', (n, m) => {
    const a = setup();
    const b = setup();
    const before = run(a, 0, n);
    run(b, 0, n);
    const loaded = roundTrip(b);
    expect(JSON.stringify(toSave(loaded, ctx))).toBe(JSON.stringify(toSave(b, ctx)));
    const eventsA = run(a, n, n + m);
    const eventsB = run(loaded, n, n + m);
    expect(eventsB).toEqual(eventsA);
    expect(JSON.stringify(toSave(loaded, ctx))).toBe(JSON.stringify(toSave(a, ctx)));
    const all = [...before, ...eventsA];
    expect(all.some((e) => e.type === 'huntingParty')).toBe(true);
    expect(all.some((e) => e.type === 'shotFired' && e.owner.startsWith('fort:'))).toBe(true);
  }, 30_000);
});
