import { describe, expect, it } from 'vitest';
import { ALL_FEATURES, revealedFeatures } from '../game/onboarding/reveal';
import type { TrainingState } from '../sim/training/types';
import { hudParts, newAttr } from './hudParts';

const training = (step: number): TrainingState => ({ status: 'active', step, sites: {} } as unknown as TrainingState);

describe('hudParts', () => {
  it('shows everything without a training', () => {
    const p = hudParts(ALL_FEATURES);
    expect(Object.values(p).every(Boolean)).toBe(true);
    expect(hudParts()).toBe(p);
  });
  it('hides the unlocked-later parts at step 1', () => {
    const p = hudParts(revealedFeatures(training(0)));
    expect(p.helpChip).toBe(true);
    expect(p.radar).toBe(false);
    expect(p.credits).toBe(false);
    expect(p.speed).toBe(false);
    expect(p.worldMarks).toBe(false);
  });
  it('grows with the steps and shares one object per set', () => {
    const set = revealedFeatures(training(1));
    expect(hudParts(set)).toBe(hudParts(set));
    expect(hudParts(set).radar).toBe(true);
    expect(hudParts(set).dampers).toBe(false);
    expect(hudParts(revealedFeatures(training(4))).dampers).toBe(true);
  });
  it('newAttr joins features or is absent', () => {
    expect(newAttr([])).toBeUndefined();
    expect(newAttr(['radar', 'energy'])).toBe('radar energy');
  });
});
