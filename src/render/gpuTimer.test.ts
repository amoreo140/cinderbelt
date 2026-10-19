import { describe, expect, it } from 'vitest';
import { GPU_TIMER_QUERIES, GpuTimer, type TimerGl, type TimerQueryExt } from './gpuTimer';

const EXT: TimerQueryExt = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };

/** A fake WebGL2 timer: queries finish when `finish()` is called, with the given nanoseconds. */
function fakeGl() {
  let next = 1;
  const queries = new Map<number, { ns: number; done: boolean }>();
  let active: number | null = null;
  const state = { disjoint: false, created: 0, deleted: 0, began: 0 };
  const gl = {
    QUERY_RESULT: 0x8866,
    QUERY_RESULT_AVAILABLE: 0x8867,
    createQuery: () => {
      state.created++;
      const id = next++;
      queries.set(id, { ns: 0, done: false });
      return id as unknown as WebGLQuery;
    },
    deleteQuery: () => {
      state.deleted++;
    },
    beginQuery: (_t: number, q: WebGLQuery) => {
      if (active !== null) throw new Error('nested query');
      active = q as unknown as number;
      queries.set(active, { ns: 0, done: false });
      state.began++;
    },
    endQuery: () => {
      active = null;
    },
    getQueryParameter: (q: WebGLQuery, p: number) => {
      const r = queries.get(q as unknown as number)!;
      return p === 0x8867 ? r.done : r.ns;
    },
    getParameter: () => {
      const d = state.disjoint;
      state.disjoint = false;
      return d;
    },
  } as unknown as TimerGl;
  /** Finishes the oldest unfinished query with `ms`. */
  const finish = (ms: number) => {
    for (const r of queries.values()) {
      if (!r.done && r !== undefined) {
        r.ns = ms * 1e6;
        r.done = true;
        return;
      }
    }
  };
  return { gl, state, finish };
}

describe('GpuTimer', () => {
  it('reports finished frames in milliseconds, later and without waiting', () => {
    const { gl, finish } = fakeGl();
    const timer = new GpuTimer(gl, EXT);
    timer.begin();
    timer.end();
    expect(timer.poll()).toBeNull();
    finish(4.5);
    expect(timer.poll()).toBeCloseTo(4.5);
    expect(timer.poll()).toBeNull();
  });

  it('averages the frames that finished since the last poll', () => {
    const { gl, finish } = fakeGl();
    const timer = new GpuTimer(gl, EXT);
    for (let i = 0; i < 3; i++) {
      timer.begin();
      timer.end();
    }
    finish(2);
    finish(4);
    expect(timer.poll()).toBeCloseTo(3);
    finish(6);
    expect(timer.poll()).toBeCloseTo(6);
  });

  it('keeps a bounded pool: frames are skipped while every query is in flight, queries are reused', () => {
    const { gl, state, finish } = fakeGl();
    const timer = new GpuTimer(gl, EXT);
    for (let i = 0; i < GPU_TIMER_QUERIES + 3; i++) {
      timer.begin();
      timer.end();
    }
    expect(state.created).toBe(GPU_TIMER_QUERIES);
    expect(state.began).toBe(GPU_TIMER_QUERIES);
    for (let i = 0; i < GPU_TIMER_QUERIES; i++) finish(1);
    expect(timer.poll()).toBeCloseTo(1);
    timer.begin();
    timer.end();
    expect(state.created).toBe(GPU_TIMER_QUERIES);
  });

  it('drops the open results after a disjoint event', () => {
    const { gl, state, finish } = fakeGl();
    const timer = new GpuTimer(gl, EXT);
    timer.begin();
    timer.end();
    finish(50);
    state.disjoint = true;
    expect(timer.poll()).toBeNull();
    timer.begin();
    timer.end();
    finish(3);
    expect(timer.poll()).toBeCloseTo(3);
  });

  it('a second begin while measuring is ignored (no nested queries); dispose deletes every query', () => {
    const { gl, state } = fakeGl();
    const timer = new GpuTimer(gl, EXT);
    timer.begin();
    timer.begin();
    timer.end();
    timer.begin();
    timer.dispose();
    expect(state.deleted).toBe(state.created);
    timer.begin();
    expect(state.began).toBe(2);
  });

  it('is null without the extension', () => {
    const gl = { getExtension: () => null } as unknown as WebGL2RenderingContext;
    expect(GpuTimer.create(gl)).toBeNull();
  });
});
