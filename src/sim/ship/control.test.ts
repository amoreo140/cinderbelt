import { describe, expect, it } from 'vitest';
import { createBody } from '../physics/body';
import { computeFlight, type FlightInput } from './control';
import { makeProps } from './testing';

const DT = 1 / 60;
const props = makeProps({
  mass: 10,
  inertia: 20,
  thrust: { forward: 100, backward: 50, left: 30, right: 40 },
  torque: 60,
});
const idle: FlightInput = { forward: 0, strafe: 0, turn: 0 };

describe('computeFlight – thrust', () => {
  it('pushes forward along the heading', () => {
    const body = { ...createBody(), angle: Math.PI / 2 };
    const out = computeFlight(props, body, { ...idle, forward: 1 }, false, DT);
    expect(out.localForce).toEqual({ x: 100, y: 0 });
    expect(out.force.x).toBeCloseTo(0);
    expect(out.force.y).toBeCloseTo(100);
  });

  it('uses the matching group for each direction', () => {
    const body = createBody();
    expect(computeFlight(props, body, { ...idle, forward: -1 }, false, DT).localForce.x).toBe(-50);
    expect(computeFlight(props, body, { ...idle, strafe: 1 }, false, DT).localForce.y).toBe(30);
    expect(computeFlight(props, body, { ...idle, strafe: -1 }, false, DT).localForce.y).toBe(-40);
  });
});

describe('computeFlight – dampers', () => {
  it('cancel sideways drift while thrusting forward', () => {
    const body = { ...createBody(), vel: { x: 0, y: 5 } };
    const out = computeFlight(props, body, { ...idle, forward: 1 }, true, DT);
    expect(out.localForce.x).toBe(100);
    expect(out.localForce.y).toBe(-40); // brakes with the right group, clipped to its thrust
  });

  it('brake proportionally and stop exactly without overshoot', () => {
    // required force 10 * 0.06 * 60 = 36 < 50 (reverse thrust) → stops exactly
    const body = { ...createBody(), vel: { x: 0.06, y: 0 } };
    expect(computeFlight(props, body, idle, true, DT).localForce.x).toBeCloseTo(-36);
  });

  it('clamp braking to the available thrust', () => {
    const body = { ...createBody(), vel: { x: 0.2, y: 0 } };
    expect(computeFlight(props, body, idle, true, DT).localForce.x).toBe(-50);
  });

  it('snap tiny velocities to zero', () => {
    const body = { ...createBody(), vel: { x: 0.01, y: 0 } };
    const out = computeFlight(props, body, idle, true, DT);
    expect(out.localForce.x).toBeCloseTo(-props.mass * 0.01 / DT);
  });

  it('cannot brake without engines in that direction', () => {
    const noReverse = { ...props, thrust: { ...props.thrust, backward: 0 } };
    const body = { ...createBody(), vel: { x: 5, y: 0 } };
    expect(computeFlight(noReverse, body, idle, true, DT).localForce.x).toBe(0);
    const tiny = { ...createBody(), vel: { x: 0.01, y: 0 } };
    expect(computeFlight(noReverse, tiny, idle, true, DT).localForce.x).toBe(0);
  });

  it('do nothing when turned off', () => {
    const body = { ...createBody(), vel: { x: 5, y: -3 } };
    expect(computeFlight(props, body, idle, false, DT).localForce).toEqual({ x: 0, y: 0 });
  });

  it('work in the ship frame when rotated', () => {
    // ship rotated by 90°: world velocity +y is locally forward
    const body = { ...createBody(), angle: Math.PI / 2, vel: { x: 0, y: 3 } };
    const out = computeFlight(props, body, idle, true, DT);
    expect(out.localForce.x).toBeLessThan(0);
    expect(Math.abs(out.localForce.y)).toBeLessThan(1e-9);
  });
});

describe('computeFlight – rotation', () => {
  it('applies full torque on input', () => {
    expect(computeFlight(props, createBody(), { ...idle, turn: 1 }, true, DT).torque).toBe(60);
    expect(computeFlight(props, createBody(), { ...idle, turn: -1 }, true, DT).torque).toBe(-60);
  });

  it('damps spin without input, clamped to available torque', () => {
    const spinning = { ...createBody(), angVel: 2 };
    expect(computeFlight(props, spinning, idle, false, DT).torque).toBe(-60);
    const slow = { ...createBody(), angVel: 0.01 };
    expect(computeFlight(props, slow, idle, false, DT).torque).toBeCloseTo(-20 * 0.01 / DT);
  });
});

describe('computeFlight – cockpit manoeuvring thrusters (RCS)', () => {
  // the Guild Training hull: a forward and a reverse engine, no side engines
  const hull = makeProps({ mass: 10, inertia: 20, thrust: { forward: 90, backward: 90, left: 0, right: 0 }, torque: 12, rcsThrust: 14 });

  it('let the dampers brake a sideways drift with no side engines', () => {
    const body = { ...createBody(), vel: { x: 0, y: 2 } };
    const out = computeFlight(hull, body, idle, true, DT);
    expect(out.localForce.y).toBe(-14);
    expect(out.rcs).toEqual({ x: 0, y: -14 });
  });

  it('let the dampers brake along an axis without engines while the engines push', () => {
    const forwardOnly = { ...hull, thrust: { ...hull.thrust, backward: 0 } };
    const body = { ...createBody(), vel: { x: 3, y: -1 } };
    const out = computeFlight(forwardOnly, body, idle, true, DT);
    expect(out.localForce).toEqual({ x: -14, y: 14 });
    expect(out.rcs).toEqual({ x: -14, y: 14 });
  });

  it('are not used where engines exist (the engines brake, no RCS share)', () => {
    const body = { ...createBody(), vel: { x: 0.2, y: 0 } };
    const out = computeFlight(hull, body, idle, true, DT);
    expect(out.localForce.x).toBe(-90);
    expect(out.rcs).toEqual({ x: 0, y: 0 });
  });

  it('do nothing with the dampers off', () => {
    const body = { ...createBody(), vel: { x: 0, y: 2 } };
    expect(computeFlight(hull, body, idle, false, DT).localForce).toEqual({ x: 0, y: 0 });
  });

  it('stop a tiny drift exactly', () => {
    const body = { ...createBody(), vel: { x: 0, y: 0.01 } };
    expect(computeFlight(hull, body, idle, true, DT).localForce.y).toBeCloseTo(-10 * 0.01 / DT);
  });

  it('strafe at RCS strength on Q/E when the ship has no side engines', () => {
    const left = computeFlight(hull, createBody(), { ...idle, strafe: 1 }, false, DT);
    expect(left.localForce.y).toBe(14);
    expect(left.rcs.y).toBe(14);
    expect(computeFlight(hull, createBody(), { ...idle, strafe: -0.5 }, false, DT).localForce.y).toBe(-7);
  });

  it('strafe with a side engine where there is one and RCS on the other side', () => {
    const oneSide = { ...hull, thrust: { ...hull.thrust, left: 90 } };
    expect(computeFlight(oneSide, createBody(), { ...idle, strafe: 1 }, false, DT).localForce.y).toBe(90);
    expect(computeFlight(oneSide, createBody(), { ...idle, strafe: 1 }, false, DT).rcs.y).toBe(0);
    expect(computeFlight(oneSide, createBody(), { ...idle, strafe: -1 }, false, DT).localForce.y).toBe(-14);
  });

  it('back up at RCS strength on S when there is no reverse engine', () => {
    const forwardOnly = { ...hull, thrust: { ...hull.thrust, backward: 0 } };
    expect(computeFlight(forwardOnly, createBody(), { ...idle, forward: -1 }, false, DT).localForce.x).toBe(-14);
  });

  it('never replace the main engine: no forward thrust without a forward engine (the ship stays stranded)', () => {
    const noMain = { ...hull, thrust: { forward: 0, backward: 0, left: 0, right: 0 } };
    expect(computeFlight(noMain, createBody(), { ...idle, forward: 1 }, false, DT).localForce).toEqual({ x: 0, y: 0 });
    const keys = computeFlight(noMain, createBody(), { ...idle, forward: -1, strafe: 1 }, false, DT).localForce;
    expect(Math.abs(keys.x) + Math.abs(keys.y)).toBe(0);
    // the dampers still bleed the drift off (they only ever slow the ship down)
    const drifting = { ...createBody(), vel: { x: 2, y: -2 } };
    expect(computeFlight(noMain, drifting, idle, true, DT).localForce).toEqual({ x: -14, y: 14 });
  });

  it('report no RCS share for a ship without RCS', () => {
    const body = { ...createBody(), vel: { x: 0, y: 2 } };
    const out = computeFlight({ ...hull, rcsThrust: 0 }, body, idle, true, DT);
    expect(out.localForce.y).toBe(0);
    expect(out.rcs).toEqual({ x: 0, y: 0 });
  });
});
