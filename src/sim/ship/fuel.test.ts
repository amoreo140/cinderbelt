import { describe, expect, it } from 'vitest';
import { FUEL_PER_FORCE_SECOND, flightFuel, fuelNeeded } from './fuel';

describe('fuelNeeded', () => {
  it('is proportional to the force used on both axes', () => {
    expect(fuelNeeded({ x: 100, y: -50 }, 0.5)).toBeCloseTo(150 * FUEL_PER_FORCE_SECOND * 0.5);
  });

  it('is zero without thrust', () => {
    expect(fuelNeeded({ x: 0, y: 0 }, 1)).toBe(0);
  });
});

describe('flightFuel', () => {
  it('charges the engines at their multiplier and the RCS at the base rate', () => {
    const out = { localForce: { x: 90, y: -14 }, rcs: { x: 0, y: -14 } };
    expect(flightFuel(out, 0.6, 1)).toBeCloseTo((90 * 0.6 + 14) * FUEL_PER_FORCE_SECOND);
    expect(flightFuel(out, 1.8, 1)).toBeCloseTo((90 * 1.8 + 14) * FUEL_PER_FORCE_SECOND);
  });

  it('costs the RCS as much fuel per force as a standard engine (no cheaper way to move)', () => {
    const rcsOnly = { localForce: { x: 0, y: 14 }, rcs: { x: 0, y: 14 } };
    const engine = { localForce: { x: 0, y: 14 }, rcs: { x: 0, y: 0 } };
    expect(flightFuel(rcsOnly, 1, 0.5)).toBeCloseTo(flightFuel(engine, 1, 0.5));
    expect(flightFuel(rcsOnly, 0.6, 0.5)).toBeGreaterThan(flightFuel(engine, 0.6, 0.5));
  });
});
