import { describe, expect, it } from 'vitest';
import { TapeMemo, ViewMemo } from './viewMemo';

describe('ViewMemo', () => {
  it('keeps the value while every key element is the same, makes a new one when any changes', () => {
    const memo = new ViewMemo<{ n: number }>();
    const state = {};
    let made = 0;
    const make = () => ({ n: ++made });
    const a = memo.get([state, 1, 'sk'], make);
    expect(memo.get([state, 1, 'sk'], make)).toBe(a);
    expect(made).toBe(1);
    // an element changed, one more or one fewer, another object of the same shape
    const b = memo.get([state, 2, 'sk'], make);
    expect(b).not.toBe(a);
    expect(memo.get([state, 2, 'sk', 0], make)).not.toBe(b);
    expect(memo.get([{}, 2, 'sk', 0], make).n).toBe(4);
    // NaN equals itself (Object.is)
    const c = memo.get([NaN], make);
    expect(memo.get([NaN], make)).toBe(c);
    memo.clear();
    expect(memo.get([NaN], make)).not.toBe(c);
  });
});

describe('TapeMemo', () => {
  it('keeps the value while the pushed values are the same, in order and number', () => {
    const memo = new TapeMemo<{ n: number }>();
    let made = 0;
    const make = () => ({ n: ++made });
    const cargo = new Map<string, number>([['iron', 2], ['ice', 0]]);
    const write = (push: (v: unknown) => void) => {
      for (const [k, v] of cargo) {
        push(k);
        push(v);
      }
    };
    const a = memo.get(write, make);
    expect(memo.get(write, make)).toBe(a);
    // a value changed in place
    cargo.set('iron', 2.5);
    const b = memo.get(write, make);
    expect(b).not.toBe(a);
    expect(memo.get(write, make)).toBe(b);
    // one more entry, then one fewer (back to the first shape but other values)
    cargo.set('gold', 1);
    const c = memo.get(write, make);
    expect(c).not.toBe(b);
    cargo.delete('gold');
    expect(memo.get(write, make)).not.toBe(c);
    expect(made).toBe(4);
    // nothing pushed is a key too; clear forgets
    const e = memo.get(() => {}, make);
    expect(memo.get(() => {}, make)).toBe(e);
    memo.clear();
    expect(memo.get(() => {}, make)).not.toBe(e);
  });
});
