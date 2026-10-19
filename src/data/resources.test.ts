import { describe, expect, it } from 'vitest';
import { RESOURCE_IDS, cargoMass, cargoUsed, emptyCargo } from './resources';

describe('resources', () => {
  it('lists all resources', () => {
    expect(RESOURCE_IDS).toEqual(['iron', 'copper', 'ice', 'titanium']);
  });

  it('creates an empty cargo', () => {
    expect(emptyCargo()).toEqual({ iron: 0, copper: 0, ice: 0, titanium: 0 });
  });

  it('sums cargo volume and mass', () => {
    const cargo = { ...emptyCargo(), iron: 10, ice: 5 };
    expect(cargoUsed(cargo)).toBe(15);
    expect(cargoMass(cargo)).toBeCloseTo(10 * 0.05 + 5 * 0.03);
  });
});
