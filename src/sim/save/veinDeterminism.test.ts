// Determinism of veins, laser heat and ice cracking through save and load (M2d): A runs N + M
// steps, B runs N, is saved (a JSON envelope), loaded and catches up M – events and the save must be identical.
import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND, type PlayerCommand } from '../commands';
import { activeSegment, veinPointAt, veinsOf } from '../mining/veins';
import { createGrid } from '../ship/grid';
import { SIM_DT, Simulation, type SimEvent } from '../Simulation';
import type { ChunkGenerator } from '../world/generate';
import { loadSave } from './load';
import { restoreSimulation, toEnvelope, toSave } from './serialize';
import { testContext } from './testing';

const ctx = testContext();

/** In front of the ship iron, ice (small – cracks quickly) and titanium. */
const field: ChunkGenerator = (_s, cx, cy) => ({
  cx,
  cy,
  asteroids:
    cx === 0 && cy === 0
      ? [
          { id: '0,0:0', pos: { x: 9, y: 3.5 }, baseRadius: 2.2, resource: 'iron', initialAmount: 121, variant: 0.1 },
          { id: '0,0:1', pos: { x: 9, y: -4.5 }, baseRadius: 1.1, resource: 'ice', initialAmount: 30, variant: 0.4 },
          { id: '0,0:2', pos: { x: 13, y: -0.5 }, baseRadius: 1.8, resource: 'titanium', initialAmount: 81, variant: 0.7 },
        ]
      : [],
});

/** A mining ship: mining laser (1, 1), heavy laser (1..2, −1), two reactors and a big cargo bay. */
const miner = () =>
  createGrid([
    ['cockpit', 0, 0],
    ['gyro', 1, 0],
    ['miningLaser', 1, 1, 0],
    ['heavyLaser', 1, -1, 0],
    ['reactor', 0, 1],
    ['reactor', 0, -1],
    ['cargo', -1, 0],
    ['engine', -2, 0, 0],
    ['largeCargo', -3, -2, 0],
  ]);

function make(): Simulation {
  return new Simulation({ seed: 5, grid: miner(), startDocked: false, generator: field });
}

/** Aims at the centre of the active section of the rock's first vein (the player follows the section with the mouse). */
function segmentAim(sim: Simulation, id: string): { x: number; y: number } | null {
  const { world } = sim.state;
  const rock = world.findAsteroid(id);
  if (!rock || world.remaining(rock) <= 0) return null;
  const vein = veinsOf(rock)[0];
  if (!vein) return rock.pos;
  const r = world.radiusOf(rock);
  const seg = activeSegment(vein, r, world.veinState(rock));
  return veinPointAt(rock, vein, r, sim.state.tick * SIM_DT, seg.center).pos;
}

function script(sim: Simulation, step: number): PlayerCommand {
  const { world } = sim.state;
  let aim: { x: number; y: number } | null = null;
  if (step < 320) aim = segmentAim(sim, '0,0:0');
  else if (step < 620) aim = world.asteroids().find((a) => a.resource === 'ice')?.pos ?? null;
  else aim = segmentAim(sim, '0,0:2');
  return { ...IDLE_COMMAND, aim: aim ?? { x: 20, y: 0 }, mining: aim !== null };
}

function run(sim: Simulation, from: number, to: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let step = from; step < to; step++) events.push(...sim.step(script(sim, step)));
  return events;
}

function roundTrip(sim: Simulation): Simulation {
  const result = loadSave(toEnvelope(toSave(sim, ctx)));
  if (!result.ok) throw new Error(`load failed: ${result.error} ${result.details.join('; ')}`);
  return restoreSimulation(result.save, { generator: field });
}

describe('vein, heat and ice-crack determinism across save and load', () => {
  it.each([
    [250, 700],
    [450, 500],
  ])('N=%i, M=%i: identical events and save', (n, m) => {
    const a = make();
    const b = make();
    run(a, 0, n);
    run(b, 0, n);
    const saved = toSave(b, ctx);
    const loaded = roundTrip(b);
    const eventsA = run(a, n, n + m);
    const eventsB = run(loaded, n, n + m);
    expect(eventsB).toEqual(eventsA);
    expect(JSON.stringify(toSave(loaded, ctx))).toBe(JSON.stringify(toSave(a, ctx)));
    // the vein state was in the save
    expect(saved.world.veins.length).toBeGreaterThan(0);
  });

  it('exercises vein bonuses, overheating, the ice crack and the deep titanium vein', () => {
    const sim = make();
    const events: SimEvent[] = [];
    const bonuses = new Set<number>();
    let savedHeat = false;
    for (let step = 0; step < 1000; step++) {
      events.push(...sim.step(script(sim, step)));
      for (const beam of sim.state.player.beams) bonuses.add(beam.bonus);
      if (step === 250) savedHeat = toSave(sim, ctx).player.heat.length > 0;
    }
    expect(savedHeat).toBe(true);
    expect(events.some((e) => e.type === 'laserOverheated')).toBe(true);
    expect(events.filter((e) => e.type === 'asteroidCracked')).toHaveLength(1);
    expect(sim.state.world.cracked.has('0,0:1')).toBe(true);
    expect(bonuses.has(1.5)).toBe(true);
    expect(bonuses.has(1.8)).toBe(true);
    expect(bonuses.has(1.2)).toBe(true);
  });
});
