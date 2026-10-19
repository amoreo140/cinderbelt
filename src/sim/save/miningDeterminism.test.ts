// Mining 2.0 determinism across save and load: nuggets in flight (drift, magnet, tractor beam,
// expiry), new nuggets from mining and the assayed chunks – A runs N + M steps, B runs N, is saved,
// loaded and runs M more; events and the saved state must match.
import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND, type PlayerCommand } from '../commands';
import { createBody } from '../physics/body';
import { createGrid } from '../ship/grid';
import { Simulation, type SimEvent } from '../Simulation';
import type { ChunkGenerator } from '../world/generate';
import { loadSave } from './load';
import { restoreSimulation, toEnvelope, toSave } from './serialize';
import { testContext } from './testing';

const ctx = testContext();

const rocks: ChunkGenerator = (_s, cx, cy) => ({
  cx,
  cy,
  asteroids:
    cx === 0 && cy === 0
      ? [
          { id: '0,0:0', pos: { x: 12, y: 0 }, baseRadius: 3, resource: 'iron', initialAmount: 5000, variant: 0.1 },
          { id: '0,0:1', pos: { x: -6, y: 16 }, baseRadius: 2, resource: 'copper', initialAmount: 900, variant: 0.6 },
        ]
      : [],
});

function setup(): Simulation {
  const grid = createGrid([
    ['cockpit', 0, 0],
    ['miningLaser', 1, 0],
    ['miningLaser', 1, 1],
    ['tractorBeam', 0, 1],
    ['reactor', -1, 0],
    ['reactor', -1, 1],
    ['cargo', 0, -1],
    ['engine', -2, 0],
  ]);
  const sim = new Simulation({ seed: 77, generator: rocks, startDocked: false, grid });
  // nuggets in flight from the start: one drifting past, one far away, one for the tractor
  const add = (x: number, y: number, vx: number, vy: number, ttl: number) => {
    const body = { ...createBody({ x, y }), vel: { x: vx, y: vy }, angVel: 1.3 };
    sim.state.mining.nuggets.push({ id: sim.state.mining.nextId++, resource: 'iron', amount: 11.5, grade: 1.3, source: '0,0:0', body, prevBody: body, ttl });
  };
  add(6, -6, -0.6, 0.9, 2000);
  add(-30, 25, -0.4, 0, 260);
  add(0, -13, 0.2, -0.3, 1500);
  return sim;
}

function script(sim: Simulation, step: number): PlayerCommand {
  const target = sim.state.mining.nuggets.find((n) => n.id === 3);
  const towing = step >= 100 && step < 400;
  return {
    ...IDLE_COMMAND,
    flight: { forward: 0, strafe: 0, turn: Math.sin(step / 70) * 0.15 },
    aim: towing && target ? target.body.pos : { x: 10, y: Math.sin(step / 50) },
    mining: !towing,
    tractor: step === 120,
    scan: step % 900 >= 880 && step % 900 < 883,
  };
}

function run(sim: Simulation, from: number, to: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = from; i < to; i++) {
    // an empty hold every 20 s – the test never flies home
    if (i % 1200 === 0) sim.state.player.cargo.iron = 0;
    out.push(...sim.step(script(sim, i)));
  }
  return out;
}

function roundTrip(sim: Simulation): Simulation {
  const result = loadSave(toEnvelope(toSave(sim, ctx)));
  if (!result.ok) throw new Error(`load failed: ${result.error} ${result.details.join('; ')}`);
  return restoreSimulation(result.save, { generator: rocks });
}

describe('mining 2.0 determinism across save and load', () => {
  it.each([
    [90, 1200],
    [200, 2400],
    [1500, 6000],
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
    expect(all.some((e) => e.type === 'nuggetCollected' || e.type === 'nuggetLost')).toBe(true);
  });

  it('saves nuggets in flight and the tractor holding one', () => {
    const sim = setup();
    run(sim, 0, 200);
    expect(sim.state.player.tractor?.target.kind).toBe('nugget');
    const save = toSave(sim, ctx);
    expect(save.mining.nuggets.length).toBeGreaterThan(0);
    const loaded = roundTrip(sim);
    expect(loaded.state.mining.nuggets.map((x) => x.id)).toEqual(sim.state.mining.nuggets.map((x) => x.id));
    expect(loaded.state.player.tractor).toEqual(sim.state.player.tractor);
  });
});
