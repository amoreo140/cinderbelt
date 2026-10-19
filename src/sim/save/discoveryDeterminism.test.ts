// Discovery determinism through save and load (M3.5b): pulses, analyses, signals, triangulation,
// POI wrecks, anomalies and Data – A runs N + M steps, B N, is saved, loaded and catches up M.
import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND, type PlayerCommand } from '../commands';
import { findPoi, flyingAt } from '../discovery/testing';
import { poisNear } from '../discovery/poi';
import type { Simulation, SimEvent } from '../Simulation';
import { loadSave } from './load';
import { restoreSimulation, toEnvelope, toSave } from './serialize';
import { testContext } from './testing';

const ctx = testContext();
const SEED = 4242;

function setup(): Simulation {
  const anomaly = findPoi(SEED, 'anomaly');
  const sim = flyingAt(SEED, { x: anomaly.pos.x + 140, y: anomaly.pos.y + 30 });
  sim.state.discovery.archive.add('echoDecoder');
  sim.state.player.dampers = false;
  return sim;
}

/** The pilot circles, mines, taps Tab (pulses) and holds Tab on the nearest place (analysis). */
function script(sim: Simulation, step: number): PlayerCommand {
  const pos = sim.state.player.body.pos;
  const near = poisNear(SEED, pos, 400)[0];
  const rock = sim.state.world.asteroids()[step % 5];
  const tap = step % 260 < 3;
  const hold = step % 520 >= 300 && step % 520 < 440;
  return {
    ...IDLE_COMMAND,
    flight: { forward: Math.sin(step / 50) * 0.7, strafe: Math.cos(step / 70) * 0.4, turn: Math.sin(step / 33) * 0.6 },
    aim: hold && near ? near.pos : rock ? rock.pos : { x: pos.x + 10, y: pos.y },
    mining: step % 4 === 1,
    scan: tap || hold,
    dock: step % 90 === 0,
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

describe('discovery determinism across save and load', () => {
  it.each([
    [100, 900],
    [370, 1200],
  ])('N=%i, M=%i: identical events and state', (n, m) => {
    const a = setup();
    const b = setup();
    run(a, 0, n);
    run(b, 0, n);
    const loaded = roundTrip(b);
    expect(JSON.stringify(toSave(loaded, ctx))).toBe(JSON.stringify(toSave(b, ctx)));
    const eventsA = run(a, n, n + m);
    const eventsB = run(loaded, n, n + m);
    expect(eventsB).toEqual(eventsA);
    expect(JSON.stringify(toSave(loaded, ctx))).toBe(JSON.stringify(toSave(a, ctx)));
    // the script really scanned
    expect(eventsA.some((e) => e.type === 'scanPulse')).toBe(true);
    expect(a.state.discovery.dataTotal).toBeGreaterThan(0);
  });
});
