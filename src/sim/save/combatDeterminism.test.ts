// Combat determinism through save and load: A runs N + M steps, B runs N,
// is saved, loaded and catches up M – events and state must be identical.
import { describe, expect, it } from 'vitest';
import { applyRam } from '../combat/combat';
import { IDLE_COMMAND, type PlayerCommand } from '../commands';
import { createGrid } from '../ship/grid';
import { Simulation, type SimEvent } from '../Simulation';
import { loadSave } from './load';
import { restoreSimulation, toEnvelope, toSave } from './serialize';
import { testContext } from './testing';

const ctx = testContext();

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

/** A game with a combat ship in ring 2 near pirates (seed 77, found deterministically). */
function atPirates(): Simulation {
  const sim = new Simulation({ seed: 77, grid: fighter(), startDocked: false, settings: { enemyDensity: 'high' } });
  for (let r = 1700; r < 3800; r += 150) {
    for (let a = 0; a < 80; a++) {
      const pos = { x: Math.cos(a / 12) * r, y: Math.sin(a / 12) * r };
      const body = { pos, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
      sim.state.player.body = body;
      sim.state.player.prevBody = body;
      sim.state.tick = 0;
      sim.step(IDLE_COMMAND);
      const e = sim.state.combat.enemies[0];
      if (e) {
        // straight into the pirates' range
        const near = { pos: { x: e.body.pos.x + 60, y: e.body.pos.y + 20 }, vel: { x: 0, y: 0 }, angle: Math.PI, angVel: 0 };
        sim.state.player.body = near;
        sim.state.player.prevBody = near;
        return sim;
      }
    }
  }
  throw new Error('no pirates found');
}

/** A scripted pilot: flies to the nearest pirate, shoots it and presses F at the wreck. */
function script(sim: Simulation, step: number): PlayerCommand {
  const { player, combat } = sim.state;
  const pos = player.body.pos;
  let target = combat.wrecks[0]?.body.pos ?? { x: pos.x + 10, y: pos.y };
  let best = Infinity;
  for (const e of combat.enemies) {
    const d = Math.hypot(e.body.pos.x - pos.x, e.body.pos.y - pos.y);
    if (d < best) {
      best = d;
      target = e.body.pos;
    }
  }
  const angleTo = Math.atan2(target.y - pos.y, target.x - pos.x);
  const diff = Math.atan2(Math.sin(angleTo - player.body.angle), Math.cos(angleTo - player.body.angle));
  return {
    ...IDLE_COMMAND,
    flight: { forward: best > 30 ? 0.8 : best < 15 ? -0.5 : 0, strafe: Math.sin(step / 30) * 0.5, turn: Math.max(-1, Math.min(1, diff * 2)) },
    aim: target,
    fire: best < 90,
    dock: step % 45 === 0,
  };
}

function run(sim: Simulation, from: number, to: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let step = from; step < to; step++) events.push(...sim.step(script(sim, step)));
  return events;
}

function roundTrip(sim: Simulation): Simulation {
  const result = loadSave(toEnvelope(toSave(sim, ctx)));
  if (!result.ok) throw new Error(`load failed: ${result.error} ${result.details.join('; ')}`);
  return restoreSimulation(result.save);
}

describe('combat determinism across save and load', () => {
  it.each([
    [120, 600],
    [400, 900],
  ])('N=%i, M=%i: identical events and state', (n, m) => {
    const a = atPirates();
    const b = atPirates();
    run(a, 0, n);
    run(b, 0, n);
    const loaded = roundTrip(b);
    const eventsA = run(a, n, n + m);
    const eventsB = run(loaded, n, n + m);
    expect(eventsB).toEqual(eventsA);
    expect(JSON.stringify(toSave(loaded, ctx))).toBe(JSON.stringify(toSave(a, ctx)));
    // the combat really took place
    const all = [...eventsA];
    expect(all.some((e) => e.type === 'shotFired' && e.owner === 'player')).toBe(true);
    expect(all.some((e) => e.type === 'projectileHit')).toBe(true);
  });

  it('a long fight ends with kills, wrecks or a destroyed player – and still saves and loads', () => {
    const sim = atPirates();
    const events = run(sim, 0, 3600);
    const types = new Set(events.map((e) => e.type));
    expect(types.has('enemyAlert')).toBe(true);
    expect(types.has('partDestroyed')).toBe(true);
    const restored = roundTrip(sim);
    expect(JSON.stringify(toSave(restored, ctx))).toBe(JSON.stringify(toSave(sim, ctx)));
  });

  it('C1: a pirate that loses a fuel tank keeps only what the other tanks hold – the game still saves', () => {
    const sim = atPirates();
    const e = sim.state.combat.enemies.find((x) => x.grid.parts.some((p) => p.partId === 'fuelTank'))!;
    e.fuel = e.props.fuelCapacity;
    const tank = e.grid.parts.find((p) => p.partId === 'fuelTank')!;
    applyRam(sim.state, e.id, e, tank.id, 10_000, [], 'hazard');
    expect(e.grid.parts.some((p) => p.id === tank.id)).toBe(false);
    expect(e.fuel).toBeLessThanOrEqual(e.props.fuelCapacity);
    const result = loadSave(toEnvelope(toSave(sim, ctx)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });
});
