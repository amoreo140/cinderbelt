import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { openSaveStorage } from './open';

describe('openSaveStorage', () => {
  it('opens IndexedDB and asks for persistent storage', async () => {
    let asked = false;
    const nav = { storage: { persist: async () => ((asked = true), true) } } as unknown as Navigator;
    const handle = await openSaveStorage({ factory: new IDBFactory(), navigator: nav });
    expect(handle).toMatchObject({ available: true, persistent: true });
    expect(handle.storage.kind).toBe('indexedDB');
    expect(asked).toBe(true);
  });

  it('can defer the persistence request to the first save and only report the current state', async () => {
    let asked = false;
    const nav = {
      storage: { persist: async () => ((asked = true), true), persisted: async () => false },
    } as unknown as Navigator;
    const handle = await openSaveStorage({ factory: new IDBFactory(), navigator: nav, requestPersist: false });
    expect(handle).toMatchObject({ available: true, persistent: false });
    expect(asked).toBe(false);
  });

  it('falls back to memory when IndexedDB is missing', async () => {
    const handle = await openSaveStorage({ factory: null, navigator: undefined });
    expect(handle).toMatchObject({ available: false, persistent: false });
    expect(handle.storage.kind).toBe('memory');
    expect(handle.error).toBeTruthy();
  });

  it('falls back to memory when opening fails', async () => {
    const broken = { open: () => { throw new Error('SecurityError'); } } as unknown as IDBFactory;
    const handle = await openSaveStorage({ factory: broken, navigator: undefined });
    expect(handle).toMatchObject({ available: false });
    expect(handle.error).toContain('SecurityError');
  });
});
