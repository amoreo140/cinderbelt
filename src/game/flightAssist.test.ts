import { describe, expect, it } from 'vitest';
import { RAM_SAFE_SPEED } from '../sim/combat/ram';
import { createGrid } from '../sim/ship/grid';
import { computeProperties } from '../sim/ship/properties';
import { Simulation } from '../sim/Simulation';
import type { ChunkGenerator } from '../sim/world/generate';
import { COLLISION_HORIZON, firstContact, predictCollision, stoppingPoint } from './flightAssist';

const ship = () => createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ['engine', 1, 0, 2], ['engine', 0, 1, 3], ['engine', 0, -1, 1]]);

/** One rock of radius 5 at (100, 0); nothing else. */
const oneRock: ChunkGenerator = (_s, cx, cy) => ({
  cx,
  cy,
  asteroids: cx === 0 && cy === 0 ? [{ id: 'rock', pos: { x: 100, y: 0 }, baseRadius: 5, resource: 'iron', initialAmount: 100, variant: 0 }] : [],
});

function flying(pos: { x: number; y: number }, vel: { x: number; y: number }): Simulation {
  const sim = new Simulation({ seed: 1, grid: ship(), startDocked: false, generator: oneRock });
  const body = { pos, vel, angle: 0, angVel: 0 };
  sim.state.player.body = body;
  sim.state.player.prevBody = body;
  sim.state.world.update(pos);
  return sim;
}

describe('firstContact', () => {
  it('finds when a moving circle first touches a still one', () => {
    expect(firstContact({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, { x: 50, y: 0 }, 4)).toBeCloseTo(4.5);
    // passing by – never touches
    expect(firstContact({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, { x: 50, y: 20 }, 4)).toBeNull();
    // moving away
    expect(firstContact({ x: 0, y: 0 }, { x: -10, y: 0 }, 1, { x: 50, y: 0 }, 4)).toBeNull();
    // already touching
    expect(firstContact({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, { x: 3, y: 0 }, 4)).toBe(0);
  });
});

describe('predictCollision', () => {
  it('warns when the path hits a rock fast enough to damage the hull', () => {
    const sim = flying({ x: 40, y: 0 }, { x: 25, y: 0 });
    const w = predictCollision(sim.state)!;
    expect(w).not.toBeNull();
    expect(w.id).toBe('rock');
    expect(w.pos).toEqual({ x: 100, y: 0 });
    // gap 60 − 5 − ship radius at 25 j/s
    expect(w.time).toBeGreaterThan(2);
    expect(w.time).toBeLessThan(COLLISION_HORIZON);
    expect(w.speed).toBeCloseTo(25);
    expect(w.urgency).toBeGreaterThan(0);
    expect(w.urgency).toBeLessThan(0.5);
  });

  it('is more urgent closer to the rock', () => {
    const far = predictCollision(flying({ x: 40, y: 0 }, { x: 25, y: 0 }).state)!;
    const near = predictCollision(flying({ x: 80, y: 0 }, { x: 25, y: 0 }).state)!;
    expect(near.urgency).toBeGreaterThan(far.urgency);
  });

  it('stays quiet for slow approaches, misses, rocks beyond the horizon and while docking', () => {
    expect(predictCollision(flying({ x: 80, y: 0 }, { x: RAM_SAFE_SPEED - 1, y: 0 }).state)).toBeNull();
    expect(predictCollision(flying({ x: 40, y: 0 }, { x: 25, y: 25 }).state)).toBeNull();
    expect(predictCollision(flying({ x: -100, y: 0 }, { x: 25, y: 0 }).state)).toBeNull();
    const docking = flying({ x: 80, y: 0 }, { x: 25, y: 0 });
    docking.state.player.dock = { mode: 'docking', stationId: 'home', startTick: 0, from: docking.state.player.body, to: docking.state.player.body };
    expect(predictCollision(docking.state)).toBeNull();
  });

  it('counts only the speed into the rock (a glancing pass at speed is not a crash)', () => {
    // aimed at the rock's edge: most of the speed is sideways at contact
    const sim = flying({ x: 40, y: 0 }, { x: 25, y: 0 });
    const r = sim.state.player.props.boundingRadius;
    const graze = flying({ x: 40, y: 5 + r - 0.2 }, { x: 25, y: 0 });
    expect(predictCollision(sim.state)).not.toBeNull();
    expect(predictCollision(graze.state)).toBeNull();
  });
});

describe('stoppingPoint', () => {
  it('is where the dampers bring the ship to rest (v² / 2a along each axis)', () => {
    const props = computeProperties(ship());
    const body = { pos: { x: 10, y: 0 }, vel: { x: 12, y: 0 }, angle: 0, angVel: 0 };
    const p = stoppingPoint(props, props.mass, body)!;
    const a = props.thrust.backward / props.mass;
    expect(p.x).toBeCloseTo(10 + (12 * 12) / (2 * a));
    expect(p.y).toBeCloseTo(0);
  });

  it('follows the ship frame (sideways drift is braked by the side thrusters)', () => {
    const props = computeProperties(ship());
    const body = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 6 }, angle: Math.PI / 2, angVel: 0 };
    // facing +y: the drift is "forward" in the ship frame – braked by the backward group
    const p = stoppingPoint(props, props.mass, body)!;
    expect(p.y).toBeCloseTo((6 * 6) / (2 * (props.thrust.backward / props.mass)));
    expect(p.x).toBeCloseTo(0);
  });

  it('brakes with the cockpit RCS along an axis without engines', () => {
    const props = computeProperties(createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0]]));
    const p = stoppingPoint(props, props.mass, { pos: { x: 0, y: 0 }, vel: { x: 5, y: 2 }, angle: 0 })!;
    const a = props.rcsThrust / props.mass;
    expect(p.x).toBeCloseTo((5 * 5) / (2 * a));
    expect(p.y).toBeCloseTo((2 * 2) / (2 * a));
  });

  it('is null when the ship cannot brake that way (no engines, no RCS)', () => {
    const props = { ...computeProperties(createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0]])), rcsThrust: 0 };
    expect(stoppingPoint(props, props.mass, { pos: { x: 0, y: 0 }, vel: { x: 5, y: 0 }, angle: 0 })).toBeNull();
  });
});
