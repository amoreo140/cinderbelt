import { describe, expect, it } from 'vitest';
import {
  centsToRatio,
  clamp,
  clamp01,
  dbToGain,
  gainToDb,
  lerp,
  masterGain,
  mulberry32,
  randomPick,
  randomRange,
  semitonesToRatio,
  smoothstep,
  volumeToGain,
} from './math';

describe('audio math', () => {
  it('clamps values and treats NaN as min', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.3, 0, 1)).toBe(0.3);
    expect(clamp01(Number.NaN)).toBe(0);
  });

  it('lerps and smoothsteps', () => {
    expect(lerp(10, 20, 0.5)).toBe(15);
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBeCloseTo(0.5);
    expect(smoothstep(2)).toBe(1);
  });

  it('converts semitones and cents to ratios', () => {
    expect(semitonesToRatio(12)).toBeCloseTo(2);
    expect(semitonesToRatio(7)).toBeCloseTo(1.4983, 3);
    expect(centsToRatio(1200)).toBeCloseTo(2);
    expect(centsToRatio(0)).toBe(1);
  });

  it('converts decibels both ways', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-20)).toBeCloseTo(0.1);
    expect(gainToDb(0.1)).toBeCloseTo(-20);
    expect(gainToDb(0)).toBe(-Infinity);
  });

  it('maps volume slider to a perceptual gain curve', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBeCloseTo(0.25);
    expect(volumeToGain(3)).toBe(1);
  });

  it('master gain respects mute', () => {
    expect(masterGain(1, true)).toBe(0);
    expect(masterGain(1, false)).toBe(1);
  });

  it('mulberry32 is deterministic and in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('random helpers stay in range', () => {
    const rand = mulberry32(1);
    for (let i = 0; i < 50; i++) {
      const v = randomRange(rand, 2, 3);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThan(3);
    }
    expect(randomPick(() => 0.9999999, ['a', 'b', 'c'])).toBe('c');
    expect(randomPick(() => 0, ['a', 'b', 'c'])).toBe('a');
    expect(() => randomPick(() => 0, [])).toThrow();
  });
});
