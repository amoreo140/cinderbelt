// localStorage keys of the game before the rename to Cinderbelt (it was "astra-forge.*").
// A read of a new key falls back to the old one and copies the value under the new key; the old
// key is left in place.

export const LEGACY_SETTINGS_KEY = 'astra-forge.settings';
export const LEGACY_SKIP_TRAINING_KEY = 'astra-forge.skipTraining';
export const LEGACY_MUTED_KEY = 'astra-forge.muted';

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

/** The value under `key`; when absent, the value under `legacyKey` (copied to `key`). Never throws. */
export function readMigrated(store: KeyValueStore, key: string, legacyKey: string): string | null {
  try {
    const current = store.getItem(key);
    if (current !== null) return current;
    const legacy = store.getItem(legacyKey);
    if (legacy === null) return null;
    try {
      store.setItem(key, legacy);
    } catch {
      // read-only storage: the legacy value is still used
    }
    return legacy;
  } catch {
    return null;
  }
}
