import { describe, expect, it } from 'vitest';
import { lazyModule } from './lazy';

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
});
