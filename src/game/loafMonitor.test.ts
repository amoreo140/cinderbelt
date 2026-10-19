import { describe, expect, it } from 'vitest';
import { createLoafMonitor, LOAF_CAPACITY, toLoafEntry } from './loafMonitor';

type Callback = (list: { getEntries(): readonly unknown[] }) => void;

/** A stand-in PerformanceObserver: `emit` delivers entries to the observing callback. */
function fakeObserver() {
  const state: { callback: Callback | null; options: { type: string; buffered?: boolean } | null } = { callback: null, options: null };
  class Observer {
    constructor(cb: Callback) {
      state.callback = cb;
    }
    observe(options: { type: string; buffered?: boolean }) {
      state.options = options;
    }
  }
  const emit = (...entries: unknown[]) => state.callback!({ getEntries: () => entries });
  return { Observer, state, emit };
}

const frame = (start: number, duration: number) => ({ startTime: start, duration, blockingDuration: Math.max(0, duration - 50), scripts: [] });

describe('loafMonitor', () => {
  it('observes long animation frames (buffered) and lists them', () => {
    const f = fakeObserver();
    const m = createLoafMonitor(f.Observer, ['long-animation-frame']);
    expect(m.supported).toBe(true);
    expect(f.state.options).toEqual({ type: 'long-animation-frame', buffered: true });
    f.emit(frame(100, 60), frame(300, 80));
    expect(m.entries().map((e) => [e.start, e.duration, e.blocking])).toEqual([
      [100, 60, 10],
      [300, 80, 30],
    ]);
    expect(m.since(200).map((e) => e.start)).toEqual([300]);
    m.clear();
    expect(m.entries()).toEqual([]);
  });

  it('keeps the newest entries only', () => {
    const f = fakeObserver();
    const m = createLoafMonitor(f.Observer, ['long-animation-frame']);
    for (let i = 0; i < LOAF_CAPACITY + 10; i++) f.emit(frame(i, 55));
    const list = m.entries();
    expect(list).toHaveLength(LOAF_CAPACITY);
    expect(list[0]!.start).toBe(10);
  });

  it('is an empty monitor without the entry type', () => {
    const f = fakeObserver();
    const m = createLoafMonitor(f.Observer, ['longtask']);
    expect(m.supported).toBe(false);
    expect(f.state.callback).toBeNull();
    expect(createLoafMonitor(undefined, []).entries()).toEqual([]);
  });

  it('keeps the four longest scripts, longest first', () => {
    const e = toLoafEntry({
      startTime: 5,
      duration: 70,
      scripts: [10, 40, 5, 30, 20].map((d, i) => ({ invoker: `inv${i}`, sourceFunctionName: `f${i}`, sourceURL: 'x.js', sourceCharPosition: i, duration: d + 0.4 })),
    });
    expect(e.blocking).toBe(0);
    expect(e.scripts.map((s) => [s.fn, s.duration])).toEqual([
      ['f1', 40],
      ['f3', 30],
      ['f4', 20],
      ['f0', 10],
    ]);
  });
});
