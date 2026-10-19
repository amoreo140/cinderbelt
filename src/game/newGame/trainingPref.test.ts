import { describe, expect, it } from 'vitest';
import { loadSkipTraining, saveSkipTraining, SKIP_TRAINING_KEY } from './trainingPref';

function memory(): Storage {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) } as Storage;
}

describe('skip training preference', () => {
  it('is off for the first game and remembers the last choice', () => {
    const store = memory();
    expect(loadSkipTraining(store)).toBe(false);
    saveSkipTraining(store, true);
    expect(store.getItem(SKIP_TRAINING_KEY)).toBe('1');
    expect(loadSkipTraining(store)).toBe(true);
    saveSkipTraining(store, false);
    expect(loadSkipTraining(store)).toBe(false);
  });

  it('takes over the pre-rename astra-forge.skipTraining value', () => {
    const store = memory();
    store.setItem('astra-forge.skipTraining', '1');
    expect(loadSkipTraining(store)).toBe(true);
    expect(store.getItem(SKIP_TRAINING_KEY)).toBe('1');
  });

  it('survives a missing or throwing storage', () => {
    expect(loadSkipTraining(null)).toBe(false);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(loadSkipTraining(broken)).toBe(false);
    expect(() => saveSkipTraining(broken, true)).not.toThrow();
  });
});
