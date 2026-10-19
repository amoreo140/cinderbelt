import { describe, expect, it } from 'vitest';
import { createBody } from '../physics/body';
import { collidePair, type Collider } from './collide';

const cell = (x: number, y: number, vx = 0, mass = 1): Collider => ({
  body: { ...createBody({ x, y }), vel: { x: vx, y: 0 } },
  cellOffsets: [{ x: 0, y: 0 }],
  boundingRadius: Math.SQRT1_2,
  mass,
});

describe('collidePair', () => {
  it('returns null when the bodies do not touch', () => {
    expect(collidePair(cell(0, 0), cell(1.2, 0))).toBeNull();
    expect(collidePair(cell(0, 0), cell(30, 0))).toBeNull();
  });

  it('separates overlapping bodies by their masses', () => {
    const r = collidePair(cell(0, 0, 0, 3), cell(0.6, 0, 0, 1))!;
    // overlap 0.4: the heavier body moves by a quarter
    expect(r.a.pos.x).toBeCloseTo(-0.1);
    expect(r.b.pos.x).toBeCloseTo(0.9);
    expect(r.impactSpeed).toBe(0);
  });

  it('exchanges momentum along the normal on impact', () => {
    const r = collidePair(cell(0, 0, 10, 1), cell(0.9, 0, 0, 1), 0)!;
    expect(r.impactSpeed).toBeCloseTo(10);
    // inelastic collision of equal masses – both continue at half speed
    expect(r.a.vel.x).toBeCloseTo(5);
    expect(r.b.vel.x).toBeCloseTo(5);
  });

  it('does not pull apart bodies that already separate', () => {
    const r = collidePair(cell(0, 0, -5), cell(0.9, 0, 5))!;
    expect(r.impactSpeed).toBe(0);
    expect(r.a.vel.x).toBe(-5);
  });
});
