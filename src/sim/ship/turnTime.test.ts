import { describe, expect, it } from 'vitest';
import { MAX_ANG_VEL } from '../physics/body';
import { createGrid } from './grid';
import { createStarterShip } from './presets';
import { computeProperties } from './properties';
import { leverArms, turnTime180 } from './turnTime';

describe('turnTime180', () => {
  it('accelerates and brakes symmetrically when the spin cap is not reached', () => {
    // alpha = 1 rad/s², peak spin sqrt(pi) ≈ 1.77 < 2.5 rad/s → 2·sqrt(pi/alpha)
    expect(turnTime180(1, 1)).toBeCloseTo(2 * Math.sqrt(Math.PI), 6);
    // alpha = 0.5: 2·sqrt(2·pi) ≈ 5.013 s by hand
    expect(turnTime180(2, 4)).toBeCloseTo(5.0133, 3);
  });

  it('cruises at the spin cap when the gyros are strong', () => {
    // alpha = 10: peak sqrt(10·pi) ≈ 5.6 > 2.5 → pi/2.5 + 2.5/10 ≈ 1.507 s
    expect(turnTime180(10, 1)).toBeCloseTo(Math.PI / MAX_ANG_VEL + MAX_ANG_VEL / 10, 6);
    expect(turnTime180(10, 1)).toBeCloseTo(1.5066, 3);
  });

  it('is continuous where the cap starts to bite', () => {
    const alpha = (MAX_ANG_VEL * MAX_ANG_VEL) / Math.PI;
    const below = turnTime180(alpha * (1 - 1e-9), 1)!;
    const above = turnTime180(alpha * (1 + 1e-9), 1)!;
    expect(below).toBeCloseTo(above, 6);
  });

  it('is null when the ship cannot turn', () => {
    expect(turnTime180(0, 5)).toBeNull();
    expect(turnTime180(5, 0)).toBeNull();
  });

  it('gives the starter ship a sane value (a few seconds)', () => {
    // the starter (1 gyro + cockpit, 14 parts) needs ≈ 3.5 s – a gyroscope or a tighter layout shortens it
    const props = computeProperties(createStarterShip());
    const t = turnTime180(props.torque, props.inertia)!;
    expect(t).toBeGreaterThan(2);
    expect(t).toBeLessThan(4.5);
  });
});

describe('leverArms', () => {
  it('picks the parts with the largest m·r², heaviest first', () => {
    // cockpit (4) at the origin, armour (2) three cells to port, an engine (1.5) right behind the cockpit
    const grid = createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ['armor', 0, 3], ['armor', 0, -1]]);
    const props = computeProperties(grid);
    const arms = leverArms(grid, props.centerOfMass);
    expect(arms).toHaveLength(2);
    expect(arms[0]!.partId).toBe(grid.parts[2]!.id);
    expect(arms[0]!.moment).toBeGreaterThan(arms[1]!.moment);
    // the moment is the point-mass term around the centre of mass
    const dx = 0 - props.centerOfMass.x;
    const dy = 3 - props.centerOfMass.y;
    expect(arms[0]!.moment).toBeCloseTo(2 * (dx * dx + dy * dy), 6);
    expect(arms[0]!.at).toEqual({ x: 0, y: 3 });
  });

  it('leaves out a part sitting on the centre of mass and honours the count', () => {
    const grid = createGrid([['cockpit', 0, 0]]);
    expect(leverArms(grid, { x: 0, y: 0 })).toEqual([]);
    const ship = createStarterShip();
    expect(leverArms(ship, computeProperties(ship).centerOfMass, 1)).toHaveLength(1);
  });

  it('breaks ties by part id (deterministic)', () => {
    const grid = createGrid([['cockpit', 0, 0], ['armor', 0, 2], ['armor', 0, -2]]);
    const arms = leverArms(grid, { x: 0, y: 0 });
    expect(arms.map((a) => a.partId)).toEqual([grid.parts[1]!.id, grid.parts[2]!.id]);
  });
});
