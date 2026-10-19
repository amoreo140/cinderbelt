import { describe, expect, it } from 'vitest';
import { createBody } from './body';
import { CELL_RADIUS, resolveCollisions } from './collide';

const single = [{ x: 0, y: 0 }];

describe('resolveCollisions', () => {
  it('returns the same body when nothing overlaps', () => {
    const body = createBody();
    const result = resolveCollisions(body, single, Math.SQRT1_2, [{ pos: { x: 10, y: 0 }, radius: 1 }]);
    expect(result.body).toBe(body);
    expect(result.impactSpeed).toBe(0);
  });

  it('pushes the ship out and bounces with restitution', () => {
    const body = { ...createBody(), vel: { x: 5, y: 0 } };
    const result = resolveCollisions(body, single, Math.SQRT1_2, [{ pos: { x: 0.8, y: 0 }, radius: 0.5 }]);
    expect(result.body.pos.x).toBeCloseTo(0.8 - 0.5 - CELL_RADIUS);
    expect(result.body.vel.x).toBeCloseTo(-1.5);
    expect(result.impactSpeed).toBeCloseTo(5);
  });

  it('a moving obstacle hits a parked ship with its own speed (relative velocity, M4b comet)', () => {
    const body = createBody();
    const result = resolveCollisions(body, single, Math.SQRT1_2, [{ pos: { x: 0.8, y: 0 }, radius: 0.5, vel: { x: -50, y: 0 } }]);
    expect(result.impactSpeed).toBeCloseTo(50);
    expect(result.hardImpact).toBeCloseTo(50);
    // the ship bounces off at the obstacle's velocity plus restitution: -50 - 0.3 · 50
    expect(result.body.vel.x).toBeCloseTo(-65);
  });

  it('flying alongside a moving obstacle at its speed is no impact', () => {
    const body = { ...createBody(), vel: { x: 50, y: 3 } };
    const result = resolveCollisions(body, single, Math.SQRT1_2, [{ pos: { x: 0.8, y: 0 }, radius: 0.5, vel: { x: 50, y: 3 } }]);
    expect(result.impactSpeed).toBe(0);
    expect(result.hardImpact).toBe(0);
    expect(result.body.vel).toEqual({ x: 50, y: 3 });
  });

  it('does not bounce when already moving away', () => {
    const body = { ...createBody(), vel: { x: -2, y: 0 } };
    const result = resolveCollisions(body, single, Math.SQRT1_2, [{ pos: { x: 0.8, y: 0 }, radius: 0.5 }]);
    expect(result.body.vel.x).toBe(-2);
    expect(result.impactSpeed).toBe(0);
  });

  it('uses rotated cell offsets', () => {
    // a cell 2 units "forward", the ship turned by 90° → the cell is at (0, 2)
    const body = { ...createBody(), angle: Math.PI / 2 };
    const result = resolveCollisions(body, [{ x: 2, y: 0 }], 2 + Math.SQRT1_2, [{ pos: { x: 0, y: 2.5 }, radius: 0.5 }]);
    expect(result.body.pos.y).toBeLessThan(0);
  });

  it('ignores obstacles with zero radius', () => {
    const body = createBody();
    expect(resolveCollisions(body, single, 1, [{ pos: { x: 0, y: 0 }, radius: 0 }]).body).toBe(body);
  });
});

describe('resolveCollisions – contact point (M3.8)', () => {
  it('reports where on the obstacle the strongest impact landed', () => {
    const body = { ...createBody(), vel: { x: 5, y: 0 } };
    const result = resolveCollisions(body, single, Math.SQRT1_2, [{ pos: { x: 0.8, y: 0 }, radius: 0.5 }]);
    expect(result.contact!.x).toBeCloseTo(0.3);
    expect(result.contact!.y).toBeCloseTo(0);
    expect(resolveCollisions(createBody(), single, 1, [{ pos: { x: 10, y: 0 }, radius: 1 }]).contact).toBeNull();
  });
});
