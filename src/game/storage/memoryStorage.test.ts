import { describe, expect, it } from 'vitest';
import { MemorySaveStorage } from './memoryStorage';
import { describeSaveStorage, fakeSave } from './storageContract';

describeSaveStorage('MemorySaveStorage', async () => new MemorySaveStorage());

describe('MemorySaveStorage – simulated failures', () => {
  it('rejects writes and keeps the old state when writes fail', async () => {
    const storage = new MemorySaveStorage();
    const slot = { difficulty: 'none' as const, index: 0 };
    const a = fakeSave('g1', 1);
    await storage.write(slot, a.envelope, a.meta);
    storage.failWrites = true;
    await expect(storage.write(slot, fakeSave('g1', 2).envelope, a.meta)).rejects.toThrow();
    expect((await storage.read(slot)).current).toEqual(a.envelope);
  });
});
