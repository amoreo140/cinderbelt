import { describe, expect, it } from 'vitest';
import { makeProps } from '../sim/ship/testing';
import { groupThrottle } from './throttle';

const props = makeProps({ thrust: { forward: 100, backward: 50, left: 20, right: 0 }, torque: 1 });

describe('groupThrottle', () => {
  it('returns the fraction of group thrust in use', () => {
    expect(groupThrottle('forward', { x: 50, y: 0 }, props)).toBeCloseTo(0.5);
    expect(groupThrottle('backward', { x: 50, y: 0 }, props)).toBe(0);
    expect(groupThrottle('backward', { x: -50, y: 0 }, props)).toBeCloseTo(1);
    expect(groupThrottle('left', { x: 0, y: 10 }, props)).toBeCloseTo(0.5);
  });

  it('is zero for a group without thrust', () => {
    expect(groupThrottle('right', { x: 0, y: -10 }, props)).toBe(0);
  });

  it('is clamped to 1', () => {
    expect(groupThrottle('forward', { x: 500, y: 0 }, props)).toBe(1);
  });
});
