import { describe, expect, it } from 'vitest';
import { CAPTAIN_NAMES } from '../data/captains';
import { enGoals } from './enGoals';
import { skGoals } from './skGoals';

describe('captain names are localised', () => {
  it('both languages list one unique name per sim index', () => {
    for (const goals of [skGoals, enGoals]) {
      expect(goals.captains.names).toHaveLength(CAPTAIN_NAMES.length);
      expect(new Set(goals.captains.names).size).toBe(CAPTAIN_NAMES.length);
    }
    expect(skGoals.captains.names).toEqual(CAPTAIN_NAMES);
  });

  it('English names are plain ASCII', () => {
    for (const name of enGoals.captains.names) expect(name).toMatch(/^[A-Za-z]+$/);
  });
});
