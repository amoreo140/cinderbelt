import { describe, expect, it } from 'vitest';
import { FixedLoop } from './fixedLoop';

const DT = 1 / 60;

function make() {
  let steps = 0;
  const loop = new FixedLoop(DT, () => steps++);
  return { loop, steps: () => steps };
}

describe('FixedLoop', () => {
  it('runs one step per dt', () => {
    const { loop, steps } = make();
    loop.advance(DT);
    expect(steps()).toBe(1);
  });

  it('accumulates partial frames and returns alpha', () => {
    const { loop, steps } = make();
    const a1 = loop.advance(DT / 2);
    expect(steps()).toBe(0);
    expect(a1).toBeCloseTo(0.5);
    loop.advance(DT / 2);
    expect(steps()).toBe(1);
  });

  it('caps steps per frame and drops the backlog', () => {
    const { loop, steps } = make();
    const alpha = loop.advance(1);
    expect(steps()).toBe(5);
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThan(1);
  });
});

describe('FixedLoop remainder', () => {
  it('keeps the remainder as alpha', () => {
    const { loop, steps } = make();
    const alpha = loop.advance(2.5 * DT);
    expect(steps()).toBe(2);
    expect(alpha).toBeCloseTo(0.5);
  });
});
