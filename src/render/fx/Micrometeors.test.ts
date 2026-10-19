import { Texture } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { MICROMETEORS } from '../../data/events';
import type { ActiveEvent } from '../../sim/events/types';
import { MAX_STREAKS, MIN_STREAKS, Micrometeors, showerEnvelope, showerOf, streakBudget, wrapCentered } from './Micrometeors';
import type { FxModels } from './fxModels';

vi.mock('./textures', () => ({ vfxTexture: () => new Texture() }));

const T = 60;
const shower = (start: number, end: number, dir = 1): ActiveEvent => ({ key: 'ev:micrometeors:s@1', kind: 'micrometeors', start, end, dir });

describe('micrometeor shower FX (M4b T14)', () => {
  it('the envelope: a warning that builds over the lead, a fade-in, full strength, a fade-out', () => {
    const lead = MICROMETEORS.leadSeconds * T;
    const start = 1000;
    const end = start + 30 * T;
    expect(showerEnvelope(start - lead - 10, start, end)).toEqual({ warn: 0, strength: 0 });
    const early = showerEnvelope(start - lead + 1, start, end);
    const late = showerEnvelope(start - 30, start, end);
    expect(early.warn).toBeGreaterThan(0);
    expect(late.warn).toBeGreaterThan(early.warn);
    expect(late.strength).toBe(0);
    expect(showerEnvelope(start + 10, start, end).strength).toBeLessThan(0.5);
    expect(showerEnvelope(start + 10 * T, start, end).strength).toBe(1);
    expect(showerEnvelope(end - 30, start, end).strength).toBeLessThan(1);
    expect(showerEnvelope(end, start, end)).toEqual({ warn: 0, strength: 0 });
  });

  it('picks the micrometeor shower out of the listed events', () => {
    const storm: ActiveEvent = { key: 'ev:ionStorm:1,1@2', kind: 'ionStorm', start: 0, end: 99999 };
    expect(showerOf([storm])).toBeNull();
    expect(showerOf([storm, shower(10, 20, 2)])).toMatchObject({ start: 10, end: 20, dir: 2 });
  });

  it('streak budget: quality scales it, reduced motion thins it, never below a readable minimum', () => {
    expect(streakBudget(1, false)).toBe(MAX_STREAKS);
    expect(streakBudget(0.35, false)).toBeLessThan(streakBudget(0.65, false));
    expect(streakBudget(1, true)).toBeLessThan(streakBudget(1, false));
    expect(streakBudget(0, false)).toBe(MIN_STREAKS);
  });

  it('wraps a coordinate into the band centred on the ship', () => {
    expect(wrapCentered(0, 10)).toBe(0);
    expect(wrapCentered(12, 10)).toBeCloseTo(-8);
    expect(wrapCentered(-12, 10)).toBeCloseTo(8);
    expect(wrapCentered(31, 10)).toBeCloseTo(-9);
  });

  it('streaks are one batch (one draw call) with room for the full budget, empty without a shower', () => {
    const fx = new Micrometeors({} as FxModels);
    expect(fx.object.children.filter((c) => c.name === 'micrometeor-streaks')).toHaveLength(1);
    expect(fx.stats().streaks).toBe(0);
    fx.dispose();
  });
});
