import { describe, expect, it } from 'vitest';
import { releaseOnThrow, SlotLocks, type LockManagerLike } from './slotLock';

/** Locks like navigator.locks between tabs of one browser (a shared map = another "tab" with the same object). */
class FakeLockManager implements LockManagerLike {
  readonly held = new Set<string>();
  async request(name: string, options: { ifAvailable: true }, callback: (lock: { name: string } | null) => unknown): Promise<unknown> {
    expect(options.ifAvailable).toBe(true);
    if (this.held.has(name)) return callback(null);
    this.held.add(name);
    try {
      return await callback({ name });
    } finally {
      this.held.delete(name);
    }
  }
}

const slot = { difficulty: 'mild' as const, index: 1 };

describe('SlotLocks', () => {
  it('locks a slot for one tab; a second tab is refused until the first one releases it', async () => {
    const manager = new FakeLockManager();
    const tabA = new SlotLocks(manager);
    const tabB = new SlotLocks(manager);
    const a = await tabA.lock(slot);
    expect(a).not.toBeNull();
    expect(await tabB.lock(slot)).toBeNull();
    expect(await tabB.lock({ difficulty: 'mild', index: 2 })).not.toBeNull();
    a!.release();
    await Promise.resolve();
    const b = await tabB.lock(slot);
    expect(b).not.toBeNull();
    b!.release();
  });

  it('releasing twice is harmless and frees the lock', async () => {
    const manager = new FakeLockManager();
    const tab = new SlotLocks(manager);
    const lock = (await tab.lock(slot))!;
    lock.release();
    lock.release();
    await Promise.resolve();
    expect(manager.held.size).toBe(0);
  });

  it('without the Web Locks API every lock is granted (no protection, no errors)', async () => {
    const tab = new SlotLocks(null);
    const a = await tab.lock(slot);
    const b = await tab.lock(slot);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    a!.release();
  });

  it('treats a failing lock manager as unavailable', async () => {
    const broken: LockManagerLike = { request: () => Promise.reject(new Error('SecurityError')) };
    expect(await new SlotLocks(broken).lock(slot)).not.toBeNull();
  });
});

describe('releaseOnThrow', () => {
  it('releases a lock that was not adopted when the job throws', async () => {
    const manager = new FakeLockManager();
    const lock = (await new SlotLocks(manager).lock(slot))!;
    await expect(
      releaseOnThrow(lock, () => false, async () => {
        throw new Error('launch failed');
      }),
    ).rejects.toThrow('launch failed');
    expect(manager.held.size).toBe(0);
    expect(await new SlotLocks(manager).lock(slot)).not.toBeNull();
  });

  it('keeps an adopted lock and a lock of a job that finished', async () => {
    const manager = new FakeLockManager();
    const lock = (await new SlotLocks(manager).lock(slot))!;
    await expect(releaseOnThrow(lock, () => true, async () => Promise.reject(new Error('late')))).rejects.toThrow('late');
    expect(manager.held.size).toBe(1);
    expect(await releaseOnThrow(lock, () => false, async () => 7)).toBe(7);
    expect(manager.held.size).toBe(1);
  });
});
