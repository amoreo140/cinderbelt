// The cockpit's manoeuvring thrusters (RCS): every ship can slowly stop on a point with the dampers,
// even without side or reverse engines; side engines stay far stronger.
import { describe, expect, it } from 'vitest';
import { COCKPIT_RCS_THRUST, type PartId } from '../data/parts';
import { IDLE_COMMAND, type PlayerCommand } from './commands';
import { length } from './math/vec2';
import { FUEL_PER_FORCE_SECOND } from './ship/fuel';
import { createGrid } from './ship/grid';
import type { Rotation, ShipGrid } from './ship/types';
import { Simulation } from './Simulation';
import { createTrainingHull } from './training/sites';
import type { ChunkGenerator } from './world/generate';

/** Empty space without stations and asteroids. */
const emptySpace: ChunkGenerator = (_s, cx, cy) => ({ cx, cy, asteroids: [] });

const flying = (grid: ShipGrid): Simulation => new Simulation({ seed: 5, startDocked: false, generator: emptySpace, grid });

/** Seconds (game time) until the ship stands still, or Infinity within `max` seconds. */
function secondsToStop(sim: Simulation, max = 30): number {
  for (let i = 0; i < max * 60; i++) {
    if (length(sim.state.player.body.vel) === 0) return i / 60;
    sim.step(IDLE_COMMAND);
  }
  return Infinity;
}

/** The training hull with a side engine on each flank (the Guild's step 4). */
const withSideEngines = (): ShipGrid => {
  const g = createTrainingHull();
  return createGrid([
    ...g.parts.map((p): [PartId, number, number, Rotation] => [p.partId, p.x, p.y, p.rot]),
    ['engine', 1, 1, 3],
    ['engine', 1, -1, 1],
  ]);
};

describe('cockpit RCS – the dampers stop any ship', () => {
  it('the training hull (no side engines) stops a 2 u/s sideways drift within 2.5 s', () => {
    const sim = flying(createTrainingHull());
    const p = sim.state.player;
    expect(p.props.thrust.left).toBe(0);
    expect(p.props.thrust.right).toBe(0);
    p.body = { ...p.body, vel: { x: 0, y: 2 } };
    const t = secondsToStop(sim);
    expect(t).toBeGreaterThan(1);
    expect(t).toBeLessThan(2.5);
  });

  it('side engines brake the same drift several times faster', () => {
    const rcs = flying(createTrainingHull());
    rcs.state.player.body = { ...rcs.state.player.body, vel: { x: 0, y: 4 } };
    const side = flying(withSideEngines());
    expect(side.state.player.props.thrust.left).toBeGreaterThan(0);
    side.state.player.body = { ...side.state.player.body, vel: { x: 0, y: 4 } };
    expect(secondsToStop(side) * 4).toBeLessThan(secondsToStop(rcs));
  });

  it('the training hull ends at rest after a turn while moving (no endless sideways slide)', () => {
    const sim = flying(createTrainingHull());
    const fwd: PlayerCommand = { ...IDLE_COMMAND, flight: { forward: 1, strafe: 0, turn: 0 } };
    const turn: PlayerCommand = { ...IDLE_COMMAND, flight: { forward: 0, strafe: 0, turn: 1 } };
    for (let i = 0; i < 90; i++) sim.step(fwd);
    for (let i = 0; i < 40; i++) sim.step(turn);
    expect(secondsToStop(sim)).toBeLessThan(15);
  });

  it('the RCS burns fuel at the base rate per force, and needs fuel', () => {
    const sim = flying(createTrainingHull());
    const p = sim.state.player;
    p.body = { ...p.body, vel: { x: 0, y: 2 } };
    const before = p.fuel;
    sim.step(IDLE_COMMAND);
    expect(Math.abs(p.lastLocalForce.y)).toBeCloseTo(COCKPIT_RCS_THRUST[1]);
    expect(before - p.fuel).toBeCloseTo((COCKPIT_RCS_THRUST[1] * FUEL_PER_FORCE_SECOND) / 60, 8);

    const dry = flying(createTrainingHull());
    dry.state.player.fuel = 0;
    dry.state.player.body = { ...dry.state.player.body, vel: { x: 0, y: 2 } };
    for (let i = 0; i < 60; i++) dry.step(IDLE_COMMAND);
    expect(dry.state.player.body.vel.y).toBeCloseTo(2);
  });

  it('Q/E strafe at RCS strength on a ship without side engines', () => {
    const sim = flying(createTrainingHull());
    const p = sim.state.player;
    const strafe: PlayerCommand = { ...IDLE_COMMAND, flight: { forward: 0, strafe: 1, turn: 0 } };
    for (let i = 0; i < 60; i++) sim.step(strafe);
    const accel = p.body.vel.y;
    expect(accel).toBeCloseTo(COCKPIT_RCS_THRUST[1] / p.props.mass, 2);
    expect(accel).toBeGreaterThan(1);
    expect(accel).toBeLessThan(1.5);
  });
});
