import { describe, expect, it } from 'vitest';
import { ALL_FEATURES, revealedFeatures } from '../game/onboarding/reveal';
import { createTraining } from '../sim/training/training';
import { hudParts } from './hudParts';
import { ASSISTED_SPEED } from '../sim/ship/control';
import { atAssistedCap, consoleRules, STOP_TARGET_RANGE, stopTargetNear, type ConsoleRulesInput } from './consoleRules';

const quiet: ConsoleRulesInput = {
  parts: hudParts(ALL_FEATURES),
  mining: false,
  cargoUsed: 0,
  combat: false,
  damaged: false,
  dockApproach: false,
  stopTarget: false,
  dampersOn: true,
  tractor: false,
};
const rules = (over: Partial<ConsoleRulesInput> = {}) => consoleRules({ ...quiet, ...over });

describe('consoleRules', () => {
  it('shows nothing extra in quiet flight', () => {
    expect(rules()).toEqual({ cargo: false, speed: false, silhouette: false, dampers: false, tractor: false, cap: false });
  });

  it('cargo: while mining or with anything in the hold', () => {
    expect(rules({ mining: true }).cargo).toBe(true);
    expect(rules({ cargoUsed: 0.5 }).cargo).toBe(true);
    expect(rules({ cargoUsed: 0 }).cargo).toBe(false);
  });

  it('speed: near a dock clamp or at a stop target', () => {
    expect(rules({ dockApproach: true }).speed).toBe(true);
    expect(rules({ stopTarget: true }).speed).toBe(true);
  });

  it('silhouette (and the shield bar): in combat or when anything is damaged', () => {
    expect(rules({ combat: true }).silhouette).toBe(true);
    expect(rules({ damaged: true }).silhouette).toBe(true);
  });

  it('speed: shown while the dampers are off (the ship drifts)', () => {
    expect(rules({ dampersOn: false }).speed).toBe(true);
    expect(rules({ dampersOn: true }).speed).toBe(false);
  });

  it('dampers: only as a warning while they are off', () => {
    expect(rules({ dampersOn: false }).dampers).toBe(true);
    expect(rules({ dampersOn: true }).dampers).toBe(false);
  });

  it('tractor: while it is active', () => {
    expect(rules({ tractor: true }).tractor).toBe(true);
  });

  it('the reveal still applies on top (cargo, speed, dampers)', () => {
    const early = hudParts(revealedFeatures({ ...createTraining(), status: 'active', step: 0, sites: { buoyA: { x: 0, y: 0 }, buoyB: { x: 1, y: 1 }, rock: 'r', rockPos: { x: 2, y: 2 } } }));
    const hidden = rules({ parts: early, mining: true, cargoUsed: 5, dockApproach: true, dampersOn: false });
    expect(hidden.cargo).toBe(false);
    expect(hidden.speed).toBe(false);
    expect(hidden.dampers).toBe(false);
    // combat parts are never gated
    expect(rules({ parts: early, combat: true, tractor: true })).toMatchObject({ silhouette: true, tractor: true });
  });

  it('returns shared frozen objects (no allocation per frame)', () => {
    const a = rules({ mining: true, dampersOn: false });
    expect(rules({ mining: true, dampersOn: false })).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
    expect(rules()).not.toBe(a);
  });
});

describe('stopTargetNear', () => {
  it('is true for a goal within the stop range only', () => {
    expect(stopTargetNear(null)).toBe(false);
    expect(stopTargetNear(STOP_TARGET_RANGE)).toBe(true);
    expect(stopTargetNear(STOP_TARGET_RANGE + 1)).toBe(false);
  });
});

describe('assisted flight note', () => {
  it('shows only at the cap with the dampers on and forward thrust held', () => {
    expect(atAssistedCap(ASSISTED_SPEED, true, true)).toBe(true);
    expect(atAssistedCap(ASSISTED_SPEED - 0.4, true, true)).toBe(true);
    expect(atAssistedCap(ASSISTED_SPEED - 1, true, true)).toBe(false);
    expect(atAssistedCap(ASSISTED_SPEED, false, true)).toBe(false);
    expect(atAssistedCap(ASSISTED_SPEED, true, false)).toBe(false);
  });

  it('follows the speed reveal', () => {
    expect(rules({ atCap: true }).cap).toBe(true);
    expect(rules({ atCap: false }).cap).toBe(false);
    const locked = hudParts(revealedFeatures(createTraining()));
    expect(consoleRules({ ...quiet, parts: locked, atCap: true }).cap).toBe(locked.speed);
  });
});
