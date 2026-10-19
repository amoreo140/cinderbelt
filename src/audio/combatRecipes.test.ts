import { describe, expect, it } from 'vitest';
import { RESOURCE_IDS } from '../data/resources';
import { COMBAT_MIN_INTERVAL, COMBAT_SOUNDS, combatRecipe, explosionRecipe, hitRecipe, shotRecipe } from './combatRecipes';
import { recipeDuration, type SfxEvent } from './recipes';

function expectSane(events: readonly SfxEvent[], maxDuration: number) {
  expect(events.length).toBeGreaterThan(0);
  for (const e of events) {
    expect(e.at).toBeGreaterThanOrEqual(0);
    expect(e.gain).toBeGreaterThan(0);
    expect(e.gain).toBeLessThanOrEqual(1);
    expect(e.attack).toBeGreaterThan(0);
    expect(e.release).toBeGreaterThan(0);
    expect(e.freq).toBeGreaterThan(20);
    expect(e.freq).toBeLessThan(20000);
    if (e.send !== undefined) expect(e.send).toBeLessThanOrEqual(1);
  }
  expect(recipeDuration(events)).toBeLessThanOrEqual(maxDuration);
}

describe('combat recipes', () => {
  it('every combat sound is a sane, short recipe with a rate limit', () => {
    for (const kind of COMBAT_SOUNDS) {
      expectSane(combatRecipe(kind, { intensity: 0.7, resource: 'iron' }), 2.5);
      expect(COMBAT_MIN_INTERVAL[kind]).toBeGreaterThan(0);
    }
    for (const r of RESOURCE_IDS) expectSane(combatRecipe('breakup', { resource: r }), 1.5);
  });

  it('cannon shots are very short; the pirate gun sounds lower', () => {
    expect(recipeDuration(shotRecipe(false))).toBeLessThan(0.2);
    expect(shotRecipe(true)[0]!.freq).toBeLessThan(shotRecipe(false)[0]!.freq);
  });

  it('heavier hits are louder and a large explosion is longer and deeper than a small one', () => {
    const sum = (e: SfxEvent[]) => e.reduce((s, x) => s + x.gain, 0);
    expect(sum(hitRecipe(1))).toBeGreaterThan(sum(hitRecipe(0)));
    expect(recipeDuration(explosionRecipe(true))).toBeGreaterThan(recipeDuration(explosionRecipe(false)));
    expect(explosionRecipe(true)[0]!.freq).toBeLessThan(explosionRecipe(false)[0]!.freq);
  });
});

describe('M3.8 recipes', () => {
  it('the collision beep rises with urgency', () => {
    const calm = combatRecipe('collisionWarning', { intensity: 0 })[0]!;
    const urgent = combatRecipe('collisionWarning', { intensity: 1 })[0]!;
    expect(urgent.freq).toBeGreaterThan(calm.freq);
    expect(urgent.gain).toBeGreaterThan(calm.gain);
  });

  it('the lost-part cue is distinct from the pirate alert', () => {
    expect(combatRecipe('partLost')).not.toEqual(combatRecipe('alert'));
    expect(COMBAT_MIN_INTERVAL.partLost).toBeLessThan(COMBAT_MIN_INTERVAL.alert);
  });
});
