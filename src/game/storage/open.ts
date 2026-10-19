// Opening the storage at game start. With IndexedDB unavailable (a private window, blocked) the game
// runs with the in-memory storage and the UI shows the "Saving is not available" bar + export (12.4).
import { IndexedDbSaveStorage, requestPersistentStorage } from './indexedDbStorage';
import { MemorySaveStorage } from './memoryStorage';
import type { SaveStorage } from './SaveStorage';

export interface StorageHandle {
  storage: SaveStorage;
  /** false = saves survive only until the tab closes (memory). */
  available: boolean;
  /** The browser promised not to delete the storage when space runs low. */
  persistent: boolean;
  /** The reason it is unavailable (for the console). */
  error?: string;
}

export interface OpenOptions {
  /** null = IndexedDB is missing. Defaults to globalThis.indexedDB. */
  factory?: IDBFactory | null;
  navigator?: Navigator;
  /** false = the game asks for persistent storage only on the first save (long-term design 9.9); for now it only checks the state. */
  requestPersist?: boolean;
}

/** Is the storage already persistent (without asking)? */
export async function isPersisted(nav: Navigator | undefined): Promise<boolean> {
  try {
    return (await nav?.storage?.persisted?.()) === true;
  } catch {
    return false;
  }
}

export async function openSaveStorage(options: OpenOptions = {}): Promise<StorageHandle> {
  const factory = 'factory' in options ? options.factory : globalThis.indexedDB;
  const nav = 'navigator' in options ? options.navigator : globalThis.navigator;
  if (!factory) return { storage: new MemorySaveStorage(), available: false, persistent: false, error: 'IndexedDB is not available' };
  try {
    const storage = await IndexedDbSaveStorage.open(factory);
    const persistent = options.requestPersist === false ? await isPersisted(nav) : await requestPersistentStorage(nav);
    return { storage, available: true, persistent };
  } catch (e) {
    return { storage: new MemorySaveStorage(), available: false, persistent: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}
