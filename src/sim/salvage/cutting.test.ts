import { describe, expect, it } from 'vitest';
import { gridToWorld } from '../combat/geometry';
import { createWreck, emptyLoot } from '../combat/wrecks';
import type { MiningBeam } from '../mining/mining';
import { createGrid } from '../ship/grid';
import type { LaserMount } from '../ship/properties';
import { makeProps, shaped } from '../ship/testing';
import type { ShipGrid } from '../ship/types';
import type { SimState } from '../Simulation';
import { applyCutting } from './cutting';

/** A dismantlable wreck at (10, 0), angle 0, made of `grid`. */
function hulk(grid: ShipGrid) {
  const source = { body: { pos: { x: 10, y: 0 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 }, props: { centerOfMass: { x: 0, y: 0 } } };
  const w = createWreck(1, grid.parts, source, { vel: { x: 0, y: 0 }, angVel: 0 }, emptyLoot(), 'default');
  w.dismantle = { intact: [] };
  return w;
}

/** One beam along the wreck's +x at grid height `gridY`, from 3 u behind cell (0,0); the laser reaches 30 u. */
function cut(grid: ShipGrid, gridY: number): { beam: MiningBeam; at: (x: number) => number } {
  const w = hulk(grid);
  const state = { combat: { wrecks: [w] } } as unknown as SimState;
  const start = gridToWorld(w.body, w.props.centerOfMass, { x: -3, y: gridY });
  const beam: MiningBeam = { laser: 0, from: start, to: { x: start.x + 1, y: start.y }, asteroidId: null, resource: null, bonus: 1, vein: null };
  applyCutting(state, [beam], makeProps({ lasers: [{ range: 30, rate: 1 } as LaserMount] }), 1 / 60, []);
  return { beam, at: (x) => gridToWorld(w.body, w.props.centerOfMass, { x, y: gridY }).x };
}

describe('cutting beams on shaped wreck cells', () => {
  // half plate at (0,0) facing the beam (solid for y ∈ [−½, 0]), a full armour behind it at (1,0)
  const grid = () => shaped(createGrid([['armor', 0, 0], ['armor', 1, 0]]), 1, 'half');

  it('passes the empty half of a plate and stops on the part behind it', () => {
    const { beam, at } = cut(grid(), 0.3);
    expect(beam.wreck).toBe(1);
    expect(beam.to.x).toBeCloseTo(at(0.5));
  });

  it('stops on the solid half', () => {
    const { beam, at } = cut(grid(), -0.3);
    expect(beam.wreck).toBe(1);
    expect(beam.to.x).toBeCloseTo(at(-0.5));
  });

  it('a wedge: the beam stops on the hypotenuse, deeper where the corner is empty', () => {
    // wedge rot 2 at (0,0): solid where x + y ≥ 0 (the hypotenuse faces the beam coming from −x)
    const wedge = shaped(createGrid([['armor', 0, 0, 2]]), 1, 'wedge');
    const on = cut(wedge, 0.3);
    expect(on.beam.to.x).toBeCloseTo(on.at(-0.3));
    // at y = −0.45 the solid part starts at x = 0.45
    const corner = cut(wedge, -0.45);
    expect(corner.beam.to.x).toBeCloseTo(corner.at(0.45));
  });
});
