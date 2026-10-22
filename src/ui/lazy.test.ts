import { describe, expect, it, vi } from 'vitest';
import { lazyModule, startLoad, type LazyStatus } from './lazy';

describe('lazy screens', () => {
  it('downloads a module once and keeps it', async () => {
    let calls = 0;
    const m = lazyModule(async () => {
      calls++;
      return { name: 'yard' };
    });
    expect(m.loaded).toBeNull();
    const [a, b] = await Promise.all([m.load(), m.load()]);
    expect(a).toBe(b);
    expect(m.loaded).toBe(a);
    await m.load();
    expect(calls).toBe(1);
  });

  it('tries again after a failed download', async () => {
    let calls = 0;
    const m = lazyModule(async () => {
      if (++calls === 1) throw new Error('offline');
      return 42;
    });
    await expect(m.load()).rejects.toThrow('offline');
    expect(m.loaded).toBeNull();
    expect(await m.load()).toBe(42);
    expect(calls).toBe(2);
  });

  it('reports a failed download and loads again on the next start', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const m = lazyModule(async () => {
      if (++calls === 1) throw new Error('chunk 404');
      return 'ok';
    });
    const seen: LazyStatus[] = [];
    startLoad(m, (s) => seen.push(s));
    await vi.waitFor(() => expect(seen).toEqual(['failed']));
    startLoad(m, (s) => seen.push(s));
    await vi.waitFor(() => expect(seen).toEqual(['failed', 'ready']));
    expect(m.loaded).toBe('ok');
    warn.mockRestore();
  });

  it('stays silent once stopped', async () => {
    const m = lazyModule(async () => 1);
    const seen: LazyStatus[] = [];
    startLoad(m, (s) => seen.push(s))();
    await m.load();
    await Promise.resolve();
    expect(seen).toEqual([]);
  });
});
