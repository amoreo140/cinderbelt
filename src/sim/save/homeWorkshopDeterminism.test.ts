// On-board workshop determinism across save and load (M4c, save V19): A runs N + M steps, B runs N, is
// saved, loaded and runs M more; the saved state (its hash) must match. The `workshopIdle` events are left
// out of the comparison: they are edge-triggered from transient memory and on purpose not reported on the
// first step after a load (sim/ship/workshop.ts), everything else must match too.
//
// - the `workshop` fixture with half its ore refined: the refinery keeps refining, the repair module heals
//   the damaged armour and engine from a partly used material bank;
// - a reactor ship in empty space: refining and repairing while a pirate shot is in flight towards a large
//   reactor at 1 HP – the blast happens after the load.
import { describe, expect, it } from 'vitest';
import WORKSHOP from '../../../tests/fixtures/saves/workshop.json?raw';
import { emptyCargo } from '../../data/resources';
import { gridToWorld } from '../combat/geometry';
import { IDLE_COMMAND } from '../commands';
import { fnv1aHex } from '../math/fnv1a';
import { add, rotate } from '../math/vec2';
import { createGrid } from '../ship/grid';
import { repairMaterialPerHp } from '../ship/workshop';
import { Simulation, type SimEvent } from '../Simulation';
import type { ChunkGenerator } from '../world/generate';
import { loadSave } from './load';
import { restoreSimulation, toEnvelope, toSave, type RestoreOptions } from './serialize';
import { testContext } from './testing';

const ctx = testContext();

const run = (sim: Simulation, steps: number): SimEvent[] => {
  const out: SimEvent[] = [];
  for (let i = 0; i < steps; i++) out.push(...sim.step(IDLE_COMMAND));
  return out;
};

const comparable = (events: readonly SimEvent[]): SimEvent[] => events.filter((e) => e.type !== 'workshopIdle');

function roundTrip(sim: Simulation, options: RestoreOptions = {}): Simulation {
  const result = loadSave(toEnvelope(toSave(sim, ctx)));
  if (!result.ok) throw new Error(`load failed: ${result.error} ${result.details.join('; ')}`);
  expect(result.warnings).toEqual([]);
  return restoreSimulation(result.save, options);
}

const hash = (sim: Simulation): string => fnv1aHex(JSON.stringify(toSave(sim, ctx)));

/** The bank's worth in units of its part's material (0 = none). */
function bankWorth(sim: Simulation): number {
  const bank = sim.state.player.repair;
  if (!bank) return 0;
  return bank.bank * repairMaterialPerHp(sim.state.player.grid.parts.find((p) => p.id === bank.part)!).perHp;
}

/** The `workshop` fixture with the fuel topped up and half its ore refined (all titanium, a third of the iron). */
function workshopGame(): Simulation {
  const result = loadSave(JSON.parse(WORKSHOP));
  if (!result.ok) throw new Error(`workshop does not load: ${result.error} ${result.details.join('; ')}`);
  const sim = restoreSimulation(result.save);
  const p = sim.state.player;
  p.fuel = p.props.fuelCapacity - 0.5;
  p.refined = { ...emptyCargo(), titanium: 40, iron: 40 };
  return sim;
}

describe('workshop determinism across save and load', () => {
  it.each([
    [30, 600],
    [700, 900],
  ])('the workshop fixture, N=%i, M=%i: refining and repairing go on identically', (n, m) => {
    const a = workshopGame();
    const b = workshopGame();
    run(a, n);
    run(b, n);
    // in the middle of the work: ore half refined, a partly used bank
    const p = b.state.player;
    expect(p.refined.iron).toBeGreaterThan(40);
    expect(p.refined.iron).toBeLessThan(p.cargo.iron);
    expect(bankWorth(b)).toBeGreaterThan(0);
    expect(bankWorth(b)).toBeLessThan(1);
    const loaded = roundTrip(b);
    expect(hash(loaded)).toBe(hash(b));
    const eventsA = run(a, m);
    const eventsB = run(loaded, m);
    expect(comparable(eventsB)).toEqual(comparable(eventsA));
    expect(hash(loaded)).toBe(hash(a));
    expect(loaded.state.player.refined).toEqual(a.state.player.refined);
    expect(loaded.state.player.repair).toEqual(a.state.player.repair);
  });
});

/** Empty space without stations and asteroids. */
const emptySpace: ChunkGenerator = (_s, cx, cy) => ({ cx, cy, asteroids: [] });

/**
 * A large reactor (2) at (0,0)–(1,1), its upper row open to the stern; a refinery, a repair module between
 * an armour plate and a side engine, a cargo hold. Bow +x.
 *
 *   y= 1   .   R   R   F   F
 *   y= 0   E   R   R   C   M   A
 *   y=-1               H   E
 *       x=-1   0   1   2   3   4
 */
const reactorShip = () =>
  createGrid([
    ['cockpit', 2, 0],
    ['largeReactor', 0, 0],
    ['engine', -1, 0],
    ['refinery', 2, 1],
    ['repairModule', 3, 0],
    ['armor', 4, 0],
    ['engine', 3, -1, 1],
    ['cargo', 2, -1],
  ]);
const REACTOR = 2;
const ARMOR = 6;
const SIDE_ENGINE = 7;

function blastGame(): Simulation {
  const sim = new Simulation({ seed: 5, grid: reactorShip(), startDocked: false, generator: emptySpace });
  const p = sim.state.player;
  const body = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0.3, angVel: 0 };
  p.body = body;
  p.prevBody = body;
  p.fuel = p.props.fuelCapacity;
  p.cargo = { ...emptyCargo(), iron: 30, titanium: 10, ice: 5 };
  p.hp.set(REACTOR, 1);
  p.hp.set(ARMOR, 10);
  p.hp.set(SIDE_ENGINE, 8);
  // a pirate shot from far behind along the reactor's upper row (nothing in front of it), at 60 u/s:
  // it hits after about two seconds
  const lane = gridToWorld(p.body, p.props.centerOfMass, { x: -1, y: 1 });
  const from = add(lane, rotate({ x: -125, y: 0 }, p.body.angle));
  sim.state.combat.projectiles.push({ id: 999_001, owner: 'pr:x', pos: from, vel: rotate({ x: 60, y: 0 }, p.body.angle), ttl: 600, damage: 5, tier: 1, origin: from });
  return sim;
}

describe('a reactor blast after the load', () => {
  it.each([
    [60, 600],
    [100, 300],
  ])('N=%i, M=%i: the shot in flight sets the reactor off in both games; the workshop works on', (n, m) => {
    const a = blastGame();
    const b = blastGame();
    const before = [...run(a, n), ...run(b, n)];
    expect(before.some((e) => e.type === 'partBlast')).toBe(false);
    // at the save: the shot is in flight, the workshop is refining and repairing from a bank
    expect(b.state.combat.projectiles.some((x) => x.id === 999_001)).toBe(true);
    expect(b.state.player.refined.titanium).toBeGreaterThan(0);
    expect(bankWorth(b)).toBeGreaterThan(0);
    const loaded = roundTrip(b, { generator: emptySpace });
    const eventsA = run(a, m);
    const eventsB = run(loaded, m);
    expect(comparable(eventsB)).toEqual(comparable(eventsA));
    expect(eventsB.filter((e) => e.type === 'partBlast').map((e) => (e as { partId: number }).partId)).toEqual([REACTOR]);
    expect(hash(loaded)).toBe(hash(a));
    expect(loaded.state.player.grid.parts.some((p) => p.id === REACTOR)).toBe(false);
  });
});
