import { afterEach, describe, expect, it, vi } from 'vitest';
import { deepEqual, pure, shallowEqual } from './pure';

describe('deepEqual', () => {
  it('compares primitives by value, NaN equal to NaN', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual('a', 'a')).toBe(true);
    expect(deepEqual(NaN, NaN)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual(0, '0')).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
  });

  it('compares arrays and plain objects by content', () => {
    expect(deepEqual({ a: [1, { b: 'x' }], c: null }, { a: [1, { b: 'x' }], c: null })).toBe(true);
    expect(deepEqual({ a: [1, { b: 'x' }] }, { a: [1, { b: 'y' }] })).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual([], {})).toBe(false);
  });

  it('sees a missing or an extra key, also one holding undefined', () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(false);
    expect(deepEqual({ a: 1, b: undefined }, { b: undefined, a: 1 })).toBe(true);
  });

  it('compares functions, maps and class instances by identity', () => {
    const f = () => 1;
    expect(deepEqual({ on: f }, { on: f })).toBe(true);
    expect(deepEqual({ on: f }, { on: () => 1 })).toBe(false);
    const m = new Map([[1, 2]]);
    expect(deepEqual(m, m)).toBe(true);
    expect(deepEqual(new Map([[1, 2]]), new Map([[1, 2]]))).toBe(false);
    class P {
      x = 1;
    }
    expect(deepEqual(new P(), new P())).toBe(false);
    expect(deepEqual(new P(), { x: 1 })).toBe(false);
  });
});

describe('shallowEqual', () => {
  it('compares one level by identity', () => {
    const items = [1];
    expect(shallowEqual({ items }, { items })).toBe(true);
    expect(shallowEqual({ items }, { items: [1] })).toBe(false);
  });
});

describe('pure: settleAt', () => {
  afterEach(() => vi.restoreAllMocks());

  it('draws again once on the first parent render past each deadline after a change, not in between', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const Part = pure((p: { v: number }) => p.v, (a, b) => a.v === b.v, { settleAt: [450, 1100] });
    const part = new Part({ v: 1 });
    part.props = { v: 1 };
    // a change draws and arms the deadlines
    expect(part.shouldComponentUpdate({ v: 2 })).toBe(true);
    part.props = { v: 2 };
    now = 1300;
    expect(part.shouldComponentUpdate({ v: 2 })).toBe(false);
    now = 1460;
    expect(part.shouldComponentUpdate({ v: 2 })).toBe(true);
    now = 1560;
    expect(part.shouldComponentUpdate({ v: 2 })).toBe(false);
    now = 2110;
    expect(part.shouldComponentUpdate({ v: 2 })).toBe(true);
    now = 5000;
    expect(part.shouldComponentUpdate({ v: 2 })).toBe(false);
  });

  it('every change keeps its own deadlines', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const Part = pure((p: { v: number }) => p.v, (a, b) => a.v === b.v, { settleAt: [450] });
    const part = new Part({ v: 1 });
    part.props = { v: 1 };
    expect(part.shouldComponentUpdate({ v: 2 })).toBe(true);
    part.props = { v: 2 };
    now = 300;
    expect(part.shouldComponentUpdate({ v: 3 })).toBe(true);
    part.props = { v: 3 };
    // the first change's pulse ends at 450, the second's at 750
    now = 500;
    expect(part.shouldComponentUpdate({ v: 3 })).toBe(true);
    now = 600;
    expect(part.shouldComponentUpdate({ v: 3 })).toBe(false);
    now = 800;
    expect(part.shouldComponentUpdate({ v: 3 })).toBe(true);
  });
});
