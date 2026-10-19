import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { SlotMeta } from '../../sim/save/meta';
import { DB_NAME, DB_VERSION, IndexedDbSaveStorage, LEGACY_DB_NAME, requestPersistentStorage } from './indexedDbStorage';
import { describeSaveStorage, fakeSave } from './storageContract';

describeSaveStorage('IndexedDbSaveStorage', () => IndexedDbSaveStorage.open(new IDBFactory()));

describe('IndexedDbSaveStorage', () => {
  const slot = { difficulty: 'hard' as const, index: 0 };

  it('persists across connections to the same database', async () => {
    const factory = new IDBFactory();
    const first = await IndexedDbSaveStorage.open(factory);
    const a = fakeSave('g1', 42);
    await first.write(slot, a.envelope, a.meta);
    first.close();
    const second = await IndexedDbSaveStorage.open(factory, DB_NAME);
    expect((await second.read(slot)).current).toEqual(a.envelope);
  });

  it('writes atomically: a failing meta write leaves the old save and backup untouched', async () => {
    const storage = await IndexedDbSaveStorage.open(new IDBFactory());
    const a = fakeSave('g1', 1);
    const b = fakeSave('g1', 2);
    await storage.write(slot, a.envelope, a.meta);
    await storage.write(slot, b.envelope, b.meta);
    const before = await storage.read(slot);
    // a function cannot be stored (DataCloneError) – only the last put of the transaction fails
    const broken = { ...fakeSave('g1', 3).meta, name: (() => 'x') as unknown as string } as SlotMeta;
    await expect(storage.write(slot, fakeSave('g1', 3).envelope, broken)).rejects.toBeDefined();
    expect(await storage.read(slot)).toEqual(before);
  });

  it('closes when another tab upgrades the database, tells the app and then fails with a clear error', async () => {
    const factory = new IDBFactory();
    const storage = await IndexedDbSaveStorage.open(factory);
    let notified = 0;
    storage.onClosed(() => notified++);
    // another tab (a newer game version) opens the database with a higher version – the upgrade must not wait for us
    await new Promise<void>((resolve, reject) => {
      const req = factory.open(DB_NAME, DB_VERSION + 1);
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    expect(notified).toBe(1);
    expect(storage.closed).toBe(true);
    await expect(storage.list()).rejects.toThrow(/another tab/);
  });

  it('fails to open without IndexedDB', async () => {
    await expect(IndexedDbSaveStorage.open(undefined as unknown as IDBFactory)).rejects.toThrow();
  });
});

describe('requestPersistentStorage', () => {
  it('is false without the Storage API', async () => {
    expect(await requestPersistentStorage(undefined)).toBe(false);
    expect(await requestPersistentStorage({} as Navigator)).toBe(false);
  });

  it('asks for persistence unless already persisted', async () => {
    let asked = 0;
    const nav = (persisted: boolean, grant: boolean) =>
      ({ storage: { persisted: async () => persisted, persist: async () => (asked++, grant) } }) as unknown as Navigator;
    expect(await requestPersistentStorage(nav(true, false))).toBe(true);
    expect(asked).toBe(0);
    expect(await requestPersistentStorage(nav(false, true))).toBe(true);
    expect(await requestPersistentStorage(nav(false, false))).toBe(false);
    expect(asked).toBe(2);
  });

  it('treats a throwing API as not persistent', async () => {
    const nav = { storage: { persist: async () => { throw new Error('nope'); } } } as unknown as Navigator;
    expect(await requestPersistentStorage(nav)).toBe(false);
  });
});

/** A browser without `indexedDB.databases()`. */
const withoutDatabases = (factory: IDBFactory): IDBFactory =>
  new Proxy(factory, {
    get(target, key) {
      if (key === 'databases') return undefined;
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });

describe('IndexedDbSaveStorage – move from the pre-rename database', () => {
  const slot = { difficulty: 'hard' as const, index: 0 };

  /** A pre-rename database with one save in it (created by hand, as the old game did). */
  async function legacyWithSave(factory: IDBFactory): Promise<ReturnType<typeof fakeSave>> {
    const a = fakeSave('g-legacy', 7);
    const old = await IndexedDbSaveStorage.open(factory, LEGACY_DB_NAME);
    await old.write(slot, a.envelope, a.meta);
    old.close();
    return a;
  }

  const databaseNames = async (factory: IDBFactory): Promise<string[]> => (await factory.databases()).map((d) => d.name ?? '').sort();

  it('copies the saves of the astra-forge database when the new one is created, and leaves the old one', async () => {
    const factory = new IDBFactory();
    const a = await legacyWithSave(factory);
    const storage = await IndexedDbSaveStorage.open(factory);
    expect((await storage.read(slot)).current).toEqual(a.envelope);
    expect(await storage.list()).toHaveLength(1);
    storage.close();
    expect(await databaseNames(factory)).toEqual([LEGACY_DB_NAME, DB_NAME].sort());
  });

  it('works without indexedDB.databases() (probe by an aborted open)', async () => {
    const real = new IDBFactory();
    const a = await legacyWithSave(real);
    const noList = withoutDatabases(real);
    const storage = await IndexedDbSaveStorage.open(noList);
    expect((await storage.read(slot)).current).toEqual(a.envelope);
    storage.close();
    // a factory without any legacy database: nothing is left behind by the probe
    const fresh = new IDBFactory();
    const freshNoList = withoutDatabases(fresh);
    (await IndexedDbSaveStorage.open(freshNoList)).close();
    expect(await databaseNames(fresh)).toEqual([DB_NAME]);
  });

  it('creates no legacy database when there is none', async () => {
    const factory = new IDBFactory();
    const storage = await IndexedDbSaveStorage.open(factory);
    expect(await storage.list()).toEqual([]);
    storage.close();
    expect(await databaseNames(factory)).toEqual([DB_NAME]);
  });

  it('copies only once: a later open does not bring back a deleted save', async () => {
    const factory = new IDBFactory();
    await legacyWithSave(factory);
    const first = await IndexedDbSaveStorage.open(factory);
    await first.delete(slot);
    first.close();
    const second = await IndexedDbSaveStorage.open(factory);
    expect(await second.list()).toEqual([]);
  });
});
