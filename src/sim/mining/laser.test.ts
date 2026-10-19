import { describe, expect, it } from 'vitest';
import { aimDirection, raycastCircles } from './laser';

const right = { x: 1, y: 0 };

describe('raycastCircles', () => {
  it('hits the nearest circle', () => {
    const hit = raycastCircles({ x: 0, y: 0 }, right, 100, [
      { pos: { x: 20, y: 0 }, radius: 2 },
      { pos: { x: 10, y: 0 }, radius: 1 },
    ]);
    expect(hit).toEqual({ index: 1, distance: 9 });
  });

  it('misses circles off the ray, behind it or out of range', () => {
    expect(raycastCircles({ x: 0, y: 0 }, right, 100, [{ pos: { x: 10, y: 5 }, radius: 1 }])).toBeNull();
    expect(raycastCircles({ x: 0, y: 0 }, right, 100, [{ pos: { x: -10, y: 0 }, radius: 1 }])).toBeNull();
    expect(raycastCircles({ x: 0, y: 0 }, right, 5, [{ pos: { x: 10, y: 0 }, radius: 1 }])).toBeNull();
  });

  it('hits at distance 0 when starting inside', () => {
    expect(raycastCircles({ x: 0, y: 0 }, right, 10, [{ pos: { x: 0.5, y: 0 }, radius: 1 }])).toEqual({ index: 0, distance: 0 });
  });

  it('skips zero-radius circles', () => {
    expect(raycastCircles({ x: 0, y: 0 }, right, 100, [{ pos: { x: 5, y: 0 }, radius: 0 }])).toBeNull();
  });
});

describe('aimDirection', () => {
  it('points at targets inside the arc', () => {
    const dir = aimDirection({ x: 0, y: 0 }, right, { x: 10, y: 5 })!;
    expect(dir.x).toBeCloseTo(10 / Math.hypot(10, 5));
    expect(dir.y).toBeCloseTo(5 / Math.hypot(10, 5));
  });

  it('refuses targets outside ±60°', () => {
    expect(aimDirection({ x: 0, y: 0 }, right, { x: 1, y: 5 })).toBeNull();
    expect(aimDirection({ x: 0, y: 0 }, right, { x: -10, y: 0 })).toBeNull();
  });

  it('uses the facing when the target is on the laser', () => {
    expect(aimDirection({ x: 3, y: 3 }, right, { x: 3, y: 3 })).toEqual(right);
  });
});
