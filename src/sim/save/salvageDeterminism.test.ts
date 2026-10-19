// Salvage determinism through save and load (M3.6): tractor beam, ripping off parts, cutting
// joints with a laser, containers and a salvageable POI wreck – A runs N + M steps, B N, is saved, loaded
// and catches up M.
import { describe, expect, it } from 'vitest';
import { SCANNER } from '../../data/scanner';
import { IDLE_COMMAND, type PlayerCommand } from '../commands';
import { gridToWorld } from '../combat/geometry';
import { findPoi, flyingAt, run as runIdle } from '../discovery/testing';
import { jointParts } from '../salvage/dismantle';
import { createGrid, partCenter } from '../ship/grid';
import type { Simulation, SimEvent } from '../Simulation';
import { loadSave } from './load';
import { restoreSimulation, toEnvelope, toSave } from './serialize';
import { testContext } from './testing';

const ctx = testContext();
const SEED = 4242;

const salvager = () =>
  createGrid([
    ['cockpit', 0, 0],
    ['miningLaser', 1, 0],
    ['miningLaser', 1, 1],
    ['tractorBeam', 0, 1],
    ['reactor', -1, 0],
    ['reactor', -1, 1],
    ['cargo', 0, -1],
    ['engine', -2, 0],
  ]);

function setup(): Simulation {
  const poi = findPoi(SEED, 'wreck', (p) => p.size === 2 && p.cls === 'freighter');
  const sim = flyingAt(SEED, { x: poi.pos.x - 12, y: poi.pos.y }, salvager());
  runIdle(sim, SCANNER.discoverInterval + 1);
  return sim;
}

/** The pilot holds the ship at the wreck, cuts joints, alternates T (beam) and F (load). */
function script(sim: Simulation, step: number): PlayerCommand {
  const { player, combat } = sim.state;
  const pos = player.body.pos;
  const hulk = combat.wrecks.find((w) => w.dismantle && w.poi);
  let aim = { x: pos.x + 10, y: pos.y };
  if (hulk) {
    // the joint nearest to the ship (the beam hits it first)
    const joints = jointParts(hulk.grid);
    let best = Infinity;
    for (const p of hulk.grid.parts) {
      if (!joints.has(p.id)) continue;
      const w = gridToWorld(hulk.body, hulk.props.centerOfMass, partCenter(p));
      const d = Math.hypot(w.x - pos.x, w.y - pos.y);
      if (d < best) {
        best = d;
        aim = w;
      }
    }
  }
  const c = combat.containers[0];
  const towing = step % 400 >= 200;
  return {
    ...IDLE_COMMAND,
    flight: { forward: Math.sin(step / 60) * 0.3, strafe: Math.cos(step / 80) * 0.3, turn: Math.sin(step / 45) * 0.3 },
    aim: towing && c ? c.body.pos : aim,
    mining: !towing,
    tractor: step % 200 === 199 || step % 200 === 120,
    dock: step % 97 === 0,
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

describe('salvage determinism across save and load', () => {
  it.each([
    [150, 900],
    [230, 1300],
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
    // the script really cut and towed
    const all = [...before, ...eventsA];
    expect(all.some((e) => e.type === 'wreckCut')).toBe(true);
    expect(all.some((e) => e.type === 'tractorLocked')).toBe(true);
  });
});
