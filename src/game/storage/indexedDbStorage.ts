// IndexedDB save storage (M2, 9.1): database `cinderbelt`, stores `saves` and `meta`.
// The first time the new database is created, the records of the pre-rename `astra-forge` database are copied
// into it (that database is left in place).
// Every write runs in one `readwrite` transaction across both stores – on a browser crash
// either the old or the new state remains.
import type { SlotMeta } from '../../sim/save/meta';
import type { SaveEnvelope, SlotRef } from '../../sim/save/types';
import type { DeathPenalty } from '../../sim/settings';
import { rotatedBackup, type SaveStorage, type SlotRecord } from './SaveStorage';
import { compareSlots, nextFreeSlot, parseSlotKey, slotKey } from './slots';

export const DB_NAME = 'cinderbelt';
/** The database name before the rename to Cinderbelt. */
export const LEGACY_DB_NAME = 'astra-forge';
export const DB_VERSION = 1;
const SAVES = 'saves';
const META = 'meta';

const currentKey = (slot: SlotRef): string => `${slotKey(slot)}/current`;
const backupKey = (slot: SlotRef): string => `${slotKey(slot)}/backup`;

/** All records of every object store of a database: `[store name, [key, value][]]`. */
type Snapshot = [string, [IDBValidKey, unknown][]][];

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });

/**
 * Whether a database exists, without creating it. `indexedDB.databases()` when the browser has it; otherwise
 * the database is opened and the upgrade (which only runs for a database that did not exist) is aborted.
 */
async function databaseExists(factory: IDBFactory, name: string): Promise<boolean> {
  if (typeof factory.databases === 'function') {
    try {
      return (await factory.databases()).some((d) => d.name === name);
    } catch {
      // fall through to the probe
    }
  }
  return new Promise<boolean>((resolve) => {
    let created = false;
    const req = factory.open(name);
    req.onupgradeneeded = () => {
      created = true; // the database did not exist: undo the creation
      req.transaction?.abort();
    };
    req.onsuccess = () => {
      req.result.close();
      resolve(!created);
    };
    req.onerror = () => {
      resolve(!created);
      if (created) {
        try {
          factory.deleteDatabase(name); // only the empty database this probe just created
        } catch {
          // nothing to clean up
        }
      }
    };
    req.onblocked = () => resolve(true);
  });
}

/** Reads every record of the legacy database; null when it does not exist or cannot be read. */
async function readLegacySnapshot(factory: IDBFactory): Promise<Snapshot | null> {
  try {
    if (!(await databaseExists(factory, LEGACY_DB_NAME))) return null;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(LEGACY_DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
    try {
      const names = [...db.objectStoreNames].filter((n) => n === SAVES || n === META);
      if (names.length === 0) return [];
      const tx = db.transaction(names, 'readonly');
      const out: Snapshot = [];
      for (const name of names) {
        const store = tx.objectStore(name);
        const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
        out.push([name, keys.map((k, i) => [k, values[i]] as [IDBValidKey, unknown])]);
      }
      return out;
    } finally {
      db.close();
    }
  } catch {
    return null; // an unreadable legacy database must not stop the new game database from opening
  }
}

async function openDb(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  // Copy the pre-rename saves only into a database that is about to be created, inside its upgrade transaction.
  let legacy: Snapshot | null = null;
  if (name === DB_NAME && !(await databaseExists(factory, name))) legacy = await readLegacySnapshot(factory);
  return new Promise((resolve, reject) => {
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SAVES)) db.createObjectStore(SAVES);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      if (legacy && req.transaction) {
        for (const [store, records] of legacy) {
          const target = req.transaction.objectStore(store);
          for (const [key, value] of records) target.put(value, key);
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
  });
}

type Stores = { saves: IDBObjectStore; meta: IDBObjectStore };
/** Runs code in a request callback; an exception aborts the transaction. */
type Guard = (fn: () => void) => void;

export class IndexedDbSaveStorage implements SaveStorage {
  readonly kind = 'indexedDB';

  private closedListeners: (() => void)[] = [];
  /** The connection was closed because of a newer database version in another tab – further operations fail. */
  closed = false;

  private constructor(private readonly db: IDBDatabase) {
    // another tab with a newer DB version – release the connection so its upgrade does not wait, and tell the game
    db.onversionchange = () => {
      db.close();
      this.closed = true;
      for (const listener of this.closedListeners) listener();
    };
  }

  onClosed(listener: () => void): void {
    this.closedListeners.push(listener);
  }

  static async open(factory: IDBFactory = globalThis.indexedDB, name = DB_NAME): Promise<IndexedDbSaveStorage> {
    if (!factory) throw new Error('IndexedDB is not available');
    return new IndexedDbSaveStorage(await openDb(factory, name));
  }

  close(): void {
    this.db.close();
  }

  /**
   * Runs `body` in one transaction; the result is returned only after `complete` (the data is written).
   * An exception in `body` aborts the transaction – nothing is written.
   */
  private run<T>(mode: IDBTransactionMode, body: (stores: Stores, set: (value: T) => void, guard: Guard) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.closed) {
        reject(new Error('Saves are closed: the game was updated in another tab – reload the page'));
        return;
      }
      let tx: IDBTransaction;
      try {
        tx = this.db.transaction([SAVES, META], mode);
      } catch (e) {
        reject(e);
        return;
      }
      let result: T | undefined;
      let failure: unknown = null;
      tx.oncomplete = () => resolve(result as T);
      tx.onerror = () => reject(failure ?? tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('IndexedDB transaction aborted'));
      const guard: Guard = (fn) => {
        try {
          fn();
        } catch (e) {
          failure = e;
          try {
            tx.abort();
          } catch {
            // already finished
          }
        }
      };
      guard(() => body({ saves: tx.objectStore(SAVES), meta: tx.objectStore(META) }, (v) => (result = v), guard));
    });
  }

  /** Reads several keys within a transaction and calls `then` with the results. */
  private static getAll(requests: IDBRequest[], then: (values: unknown[]) => void): void {
    const values: unknown[] = new Array(requests.length);
    let left = requests.length;
    requests.forEach((req, i) => {
      req.onsuccess = () => {
        values[i] = req.result;
        if (--left === 0) then(values);
      };
    });
  }

  async list(): Promise<SlotMeta[]> {
    const metas = await this.run<SlotMeta[]>('readonly', ({ meta }, set) => {
      const req = meta.getAll();
      req.onsuccess = () => set(req.result as SlotMeta[]);
    });
    return metas.sort((a, b) => compareSlots(a.slot, b.slot));
  }

  read(slot: SlotRef): Promise<SlotRecord> {
    return this.run<SlotRecord>('readonly', ({ saves, meta }, set) => {
      IndexedDbSaveStorage.getAll([saves.get(currentKey(slot)), saves.get(backupKey(slot)), meta.get(slotKey(slot))], ([c, b, m]) =>
        set({
          current: (c as SaveEnvelope | undefined) ?? null,
          backup: (b as SaveEnvelope | undefined) ?? null,
          meta: (m as SlotMeta | undefined) ?? null,
        }),
      );
    });
  }

  write(slot: SlotRef, envelope: SaveEnvelope, meta: SlotMeta): Promise<SlotMeta> {
    return this.run<SlotMeta>('readwrite', (stores, set, guard) => {
      const reads = [stores.saves.get(currentKey(slot)), stores.saves.get(backupKey(slot)), stores.meta.get(slotKey(slot))];
      IndexedDbSaveStorage.getAll(reads, ([c, b, m]) =>
        guard(() => {
          const old = {
            current: (c as SaveEnvelope | undefined) ?? null,
            backup: (b as SaveEnvelope | undefined) ?? null,
            meta: (m as SlotMeta | undefined) ?? null,
          };
          const backup = rotatedBackup(old, meta.gameId);
          const stored: SlotMeta = { ...meta, slot: { ...slot }, hasBackup: backup !== null };
          if (backup) stores.saves.put(backup, backupKey(slot));
          else stores.saves.delete(backupKey(slot));
          stores.saves.put(envelope, currentKey(slot));
          stores.meta.put(stored, slotKey(slot));
          set(stored);
        }),
      );
    });
  }

  moveToFree(from: SlotRef, difficulty: DeathPenalty, envelope: SaveEnvelope, meta: SlotMeta): Promise<SlotMeta> {
    return this.run<SlotMeta>('readwrite', ({ saves, meta: metaStore }, set, guard) => {
      // the target is chosen in the same transaction – no read before the write that closing the tab could interrupt
      const keys = metaStore.getAllKeys();
      keys.onsuccess = () =>
        guard(() => {
          const used = (keys.result as IDBValidKey[]).flatMap((k) => {
            const slot = typeof k === 'string' ? parseSlotKey(k) : null;
            return slot ? [slot] : [];
          });
          const to = nextFreeSlot(used, difficulty, { ignoreLimit: true })!;
          const stored: SlotMeta = { ...meta, slot: { ...to }, hasBackup: false };
          saves.delete(currentKey(from));
          saves.delete(backupKey(from));
          metaStore.delete(slotKey(from));
          saves.delete(backupKey(to));
          saves.put(envelope, currentKey(to));
          metaStore.put(stored, slotKey(to));
          set(stored);
        });
    });
  }

  replace(slot: SlotRef, record: { current: SaveEnvelope; backup: SaveEnvelope | null; meta: SlotMeta }): Promise<SlotMeta> {
    return this.run<SlotMeta>('readwrite', ({ saves, meta }, set) => {
      const stored: SlotMeta = { ...record.meta, slot: { ...slot }, hasBackup: record.backup !== null };
      saves.put(record.current, currentKey(slot));
      if (record.backup) saves.put(record.backup, backupKey(slot));
      else saves.delete(backupKey(slot));
      meta.put(stored, slotKey(slot));
      set(stored);
    });
  }

  delete(slot: SlotRef): Promise<void> {
    return this.run<void>('readwrite', ({ saves, meta }) => {
      saves.delete(currentKey(slot));
      saves.delete(backupKey(slot));
      meta.delete(slotKey(slot));
    });
  }
}

/**
 * Asks the browser for persistent storage (saves are not deleted when space runs low).
 * Returns true if the storage is persistent; errors and a missing API → false.
 */
export async function requestPersistentStorage(nav: Navigator | undefined = globalThis.navigator): Promise<boolean> {
  const storage = nav?.storage;
  if (!storage || typeof storage.persist !== 'function') return false;
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
