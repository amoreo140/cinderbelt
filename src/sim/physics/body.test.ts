import { describe, expect, it } from 'vitest';
import { MAX_ANG_VEL, MAX_SPEED, createBody, integrate } from './body';

describe('integrate', () => {
  it('applies force with semi-implicit Euler', () => {
    const b = integrate(createBody(), { x: 10, y: 0 }, 0, 2, 1, 1);
    expect(b.vel).toEqual({ x: 5, y: 0 });
    expect(b.pos).toEqual({ x: 5, y: 0 });
  });

  it('clamps speed to MAX_SPEED', () => {
    const start = { ...createBody(), vel: { x: MAX_SPEED - 1, y: 0 } };
    const b = integrate(start, { x: 1000, y: 1000 }, 0, 1, 1, 1);
    expect(Math.hypot(b.vel.x, b.vel.y)).toBeCloseTo(MAX_SPEED);
  });

  it('applies torque and clamps angular velocity', () => {
    const b = integrate(createBody(), { x: 0, y: 0 }, 2, 1, 4, 0.5);
    expect(b.angVel).toBeCloseTo(0.25);
    expect(b.angle).toBeCloseTo(0.125);
    const fast = integrate(createBody(), { x: 0, y: 0 }, 1000, 1, 1, 1);
    expect(fast.angVel).toBe(MAX_ANG_VEL);
  });

  it('normalizes angle', () => {
    const start = { ...createBody(), angle: 3.1, angVel: 2 };
    const b = integrate(start, { x: 0, y: 0 }, 0, 1, 1, 0.1);
    expect(b.angle).toBeCloseTo(3.3 - 2 * Math.PI);
  });

  it('does not mutate the input body', () => {
    const start = createBody();
    integrate(start, { x: 10, y: 0 }, 1, 1, 1, 1);
    expect(start).toEqual(createBody());
  });
});
