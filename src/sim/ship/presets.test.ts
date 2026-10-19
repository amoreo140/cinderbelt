import { describe, expect, it } from 'vitest';
import { validateGrid } from './grid';
import { createStarterShip } from './presets';
import { computeProperties } from './properties';

describe('createStarterShip', () => {
  it('is a valid ship', () => {
    expect(validateGrid(createStarterShip())).toEqual([]);
  });

  it('can thrust in all four directions and turn', () => {
    const p = computeProperties(createStarterShip());
    expect(p.thrust.forward).toBeGreaterThan(0);
    expect(p.thrust.backward).toBeGreaterThan(0);
    expect(p.thrust.left).toBeGreaterThan(0);
    expect(p.thrust.right).toBeGreaterThan(0);
    expect(p.torque).toBeGreaterThan(12);
  });

  it('returns a fresh copy each time', () => {
    expect(createStarterShip()).not.toBe(createStarterShip());
  });

  it('has mining, cargo, fuel, energy and radar', () => {
    const p = computeProperties(createStarterShip());
    expect(p.lasers).toHaveLength(1);
    expect(p.lasers[0]!.facing).toEqual({ x: 1, y: 0 });
    expect(p.cargoCapacity).toBeGreaterThan(100);
    expect(p.fuelCapacity).toBeGreaterThan(100);
    expect(p.energyGen).toBeGreaterThan(p.lasers[0]!.energyPerSecond);
    expect(p.radarRange).toBe(180);
  });
});
