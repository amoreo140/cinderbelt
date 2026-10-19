import { describe, expect, it } from 'vitest';
import { emptyCargo } from '../data/resources';
import { makeProps } from '../sim/ship/testing';
import { CollectTracker, impactIntensity, laserInput, thrustInput } from './audioMapping';

const props = makeProps({ thrust: { forward: 180, backward: 90, left: 45, right: 60 } });

describe('thrustInput', () => {
  it('maps the local force to engine groups', () => {
    expect(thrustInput({ x: 90, y: 0 }, props)).toEqual({ main: 0.5, reverse: 0, side: 0 });
    expect(thrustInput({ x: -90, y: 0 }, props)).toEqual({ main: 0, reverse: 1, side: 0 });
    expect(thrustInput({ x: 0, y: 45 }, props)).toEqual({ main: 0, reverse: 0, side: 1 });
    expect(thrustInput({ x: 0, y: -30 }, props)).toEqual({ main: 0, reverse: 0, side: -0.5 });
  });

  it('is silent without engines in a direction', () => {
    const none = makeProps();
    expect(thrustInput({ x: 10, y: -10 }, none)).toEqual({ main: 0, reverse: 0, side: 0 });
  });

  it('hisses softly with the cockpit RCS on a flank without engines', () => {
    const rcs = makeProps({ thrust: { forward: 90, backward: 90, left: 0, right: 0 }, rcsThrust: 14 });
    expect(thrustInput({ x: 0, y: 14 }, rcs).side).toBeCloseTo(0.4);
    expect(thrustInput({ x: 0, y: -7 }, rcs).side).toBeCloseTo(-0.2);
  });
});

describe('laserInput', () => {
  const beam = (asteroidId: string | null, resource: 'iron' | 'ice' | null) => ({
    laser: 0, from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, asteroidId, resource, bonus: 1, vein: null,
  });

  it('is off without beams', () => {
    expect(laserInput([])).toEqual({ active: false, hitting: false, resource: null, intensity: 1 });
  });

  it('reports the hit resource', () => {
    expect(laserInput([beam(null, null), beam('a', 'ice')])).toEqual({ active: true, hitting: true, resource: 'ice', intensity: 1 });
    expect(laserInput([beam(null, null)])).toEqual({ active: true, hitting: false, resource: null, intensity: 1 });
  });

  it('bites harder on the vein bonus and near overheating (Mining 2.0)', () => {
    const vein = { ...beam('a', 'iron'), bonus: 1.5 };
    expect(laserInput([vein]).intensity).toBeCloseTo(1.3);
    expect(laserInput([vein], 0.95).intensity).toBeCloseTo(1.5);
    expect(laserInput([beam('a', 'iron')], 0.5).intensity).toBe(1);
  });
});

describe('impactIntensity', () => {
  it('grows with the impact speed and saturates', () => {
    expect(impactIntensity(0)).toBe(0);
    expect(impactIntensity(6)).toBeCloseTo(0.4);
    expect(impactIntensity(100)).toBe(1);
  });
});

describe('CollectTracker', () => {
  it('reports a blip for every whole unit mined', () => {
    const tracker = new CollectTracker();
    const cargo = emptyCargo();
    expect(tracker.update(cargo, true)).toEqual([]);
    cargo.iron = 0.6;
    expect(tracker.update(cargo, true)).toEqual([]);
    cargo.iron = 1.1;
    expect(tracker.update(cargo, true)).toEqual(['iron']);
    cargo.iron = 1.9;
    cargo.ice = 1.2;
    expect(tracker.update(cargo, true)).toEqual(['ice']);
  });

  it('ignores cargo changes that do not come from mining', () => {
    const tracker = new CollectTracker();
    const cargo = emptyCargo();
    tracker.update(cargo, true);
    cargo.copper = 30;
    expect(tracker.update(cargo, false)).toEqual([]);
    cargo.copper = 31.2;
    expect(tracker.update(cargo, true)).toEqual(['copper']);
    cargo.copper = 0;
    expect(tracker.update(cargo, true)).toEqual([]);
    cargo.copper = 1.5;
    expect(tracker.update(cargo, true)).toEqual(['copper']);
  });
});
