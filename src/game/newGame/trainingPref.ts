// "Skip training" on the New Game screen (M3.7): off until the player chooses otherwise; the last
// choice is remembered, and a finished training turns it on (the player knows the basics now).
// Kept in the browser like the user settings, not in a save.

import { LEGACY_SKIP_TRAINING_KEY, readMigrated } from '../storage/legacyKeys';

export const SKIP_TRAINING_KEY = 'cinderbelt.skipTraining';

export type PrefStore = Pick<Storage, 'getItem' | 'setItem'>;

export function loadSkipTraining(store: PrefStore | null): boolean {
  try {
    return (store ? readMigrated(store, SKIP_TRAINING_KEY, LEGACY_SKIP_TRAINING_KEY) : null) === '1';
  } catch {
    return false;
  }
}

export function saveSkipTraining(store: PrefStore | null, skip: boolean): void {
  try {
    store?.setItem(SKIP_TRAINING_KEY, skip ? '1' : '0');
  } catch {
    // a blocked storage only forgets the choice
  }
}
