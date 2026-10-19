// Shaped armour determinism across save and load (SL2 E2, save V18): the `shapes-fight` fixture (the
// shaped fighter by a Jackal pair) – A runs N + M steps, B runs N, is saved, loaded and runs M more with
// the same scripted pilot; the events and the saved state (its hash) must match.
import { describe, expect, it } from 'vitest';
import FIGHT from '../../../tests/fixtures/saves/shapes-fight.json?raw';
import { IDLE_COMMAND, type PlayerCommand } from '../commands';
import { fnv1aHex } from '../math/fnv1a';
import { maxHp } from '../ship/hp';
import type { Simulation, SimEvent } from '../Simulation';
import { loadSave } from './load';
import { restoreSimulation, toEnvelope, toSave } from './serialize';
import { testContext } from './testing';

const ctx = testContext();

function fight(): Simulation {
  const result = loadSave(JSON.parse(FIGHT));
  if (!result.ok) throw new Error(`shapes-fight does not load: ${result.error} ${result.details.join('; ')}`);
  return restoreSimulation(result.save);
}

/** Scripted pilot: turns to the nearest Jackal, closes to about 60 u, strafes and fires. */
function script(sim: Simulation, step: number): PlayerCommand {
  const { player, combat } = sim.state;
  const pos = player.body.pos;
  let target = { x: pos.x + 10, y: pos.y };
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
    flight: { forward: best > 60 ? 0.7 : 0, strafe: Math.sin(step / 40) * 0.6, turn: Math.max(-1, Math.min(1, diff * 2)) },
    aim: target,
    fire: best < 120,
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

const hash = (sim: Simulation): string => fnv1aHex(JSON.stringify(toSave(sim, ctx)));

describe('shaped armour determinism across save and load (shapes-fight)', () => {
  it.each([
    [90, 600],
    [400, 900],
  ])('N=%i, M=%i: identical events and saved state', (n, m) => {
    const a = fight();
    const b = fight();
    const first = run(a, 0, n);
    run(b, 0, n);
    const loaded = roundTrip(b);
    const eventsA = run(a, n, n + m);
    const eventsB = run(loaded, n, n + m);
    expect(eventsB).toEqual(eventsA);
    expect(hash(loaded)).toBe(hash(a));
    // the fight really happened: both sides fired and something was hit
    const all = [...first, ...eventsA];
    expect(all.some((e) => e.type === 'shotFired' && e.owner === 'player')).toBe(true);
    expect(all.some((e) => e.type === 'shotFired' && e.owner !== 'player')).toBe(true);
    expect(all.some((e) => e.type === 'projectileHit')).toBe(true);
  });

  it('the shaped ship takes hits and still saves and loads to the same state', () => {
    const sim = fight();
    const hpOf = (id: number): number => {
      const part = sim.state.player.grid.parts.find((p) => p.id === id);
      return part ? (sim.state.player.hp.get(id) ?? maxHp(part)) : 0;
    };
    const shaped = sim.state.player.grid.parts.filter((p) => p.shape).map((p) => p.id);
    const before = new Map(shaped.map((id) => [id, hpOf(id)]));
    // the fixture ship has a full shield that soaks the whole fight: switch it off so the plates take the hits
    sim.state.player.props.shield.capacity = 0;
    sim.state.player.shield = 0;
    run(sim, 0, 1800);
    // at least one shaped plate lost HP (or was shot off)
    expect(shaped.some((id) => hpOf(id) < before.get(id)!)).toBe(true);
    expect(hash(roundTrip(sim))).toBe(hash(sim));
  });
});
