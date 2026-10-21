import { describe, expect, it } from 'vitest';
import { RESOURCE_IDS } from '../data/resources';
import {
  ENGINE_RAMP,
  engineMainParams,
  engineReverseParams,
  engineSideParams,
  LASER_LEVELS,
  LASER_TONES,
  laserTargets,
  laserTone,
  normalizeThrust,
} from './loopParams';

describe('normalizeThrust', () => {
  it('accepts a plain throttle number', () => {
    expect(normalizeThrust(0.4)).toEqual({ main: 0.4, reverse: 0, side: 0 });
    expect(normalizeThrust(2)).toEqual({ main: 1, reverse: 0, side: 0 });
  });

  it('clamps groups and defaults missing ones to zero', () => {
    expect(normalizeThrust({ reverse: -1, side: -3 })).toEqual({ main: 0, reverse: 0, side: -1 });
    expect(normalizeThrust({})).toEqual({ main: 0, reverse: 0, side: 0 });
  });
});

describe('engineMainParams', () => {
  it('is silent at zero throttle', () => {
    const p = engineMainParams(0);
    expect(p.rumbleGain).toBe(0);
    expect(p.humGain).toBe(0);
    expect(p.airGain).toBe(0);
  });

  it('gets louder, brighter and higher with throttle', () => {
    let prev = engineMainParams(0);
    for (let i = 1; i <= 10; i++) {
      const p = engineMainParams(i / 10);
      expect(p.rumbleGain).toBeGreaterThan(prev.rumbleGain);
      expect(p.rumbleCutoff).toBeGreaterThan(prev.rumbleCutoff);
      expect(p.humHz).toBeGreaterThan(prev.humHz);
      expect(p.airGain).toBeGreaterThan(prev.airGain);
      prev = p;
    }
  });

  it('low throttle is already clearly audible (front-loaded curve)', () => {
    expect(engineMainParams(0.2).rumbleGain).toBeGreaterThan(0.2 * engineMainParams(1).rumbleGain);
  });

  it('keeps gains in a safe range and clamps input', () => {
    const p = engineMainParams(5);
    expect(p).toEqual(engineMainParams(1));
    expect(p.rumbleGain + p.humGain + p.airGain).toBeLessThan(1);
  });
});

describe('engine calmness', () => {
  it('stays soft: gentle cutoff sweep, noise below the tonal hum character, soft attack', () => {
    const full = engineMainParams(1);
    expect(full.rumbleCutoff).toBeLessThanOrEqual(600);
    expect(full.airHz).toBeLessThanOrEqual(1400);
    expect(full.rumbleGain).toBeLessThanOrEqual(0.3);
    expect(full.rumbleGain + full.humGain + full.airGain).toBeLessThan(0.45);
    expect(engineReverseParams(1).noiseGain).toBeLessThanOrEqual(0.2);
    expect(engineSideParams(1).gain).toBeLessThanOrEqual(0.12);
    expect(ENGINE_RAMP.up).toBeGreaterThanOrEqual(0.2);
    expect(ENGINE_RAMP.up).toBeLessThanOrEqual(0.3);
  });
});

describe('engineReverseParams', () => {
  it('is silent at zero and rises with throttle', () => {
    expect(engineReverseParams(0).noiseGain).toBe(0);
    expect(engineReverseParams(1).noiseGain).toBeGreaterThan(engineReverseParams(0.5).noiseGain);
    expect(engineReverseParams(1).noiseHz).toBeGreaterThan(engineMainParams(1).rumbleCutoff * 0.5);
  });
});

describe('engineSideParams', () => {
  it('pans to the side of the sign and uses magnitude for gain', () => {
    const left = engineSideParams(-1);
    const right = engineSideParams(1);
    expect(left.pan).toBeLessThan(0);
    expect(right.pan).toBeGreaterThan(0);
    expect(left.gain).toBeCloseTo(right.gain);
    expect(engineSideParams(0).gain).toBe(0);
    expect(engineSideParams(0).pan).toBe(0);
  });
});

describe('laser tones', () => {
  it('defines a tone for every resource with distinct pitches', () => {
    const pitches = new Set(RESOURCE_IDS.map((id) => LASER_TONES[id].baseHz));
    expect(pitches.size).toBe(RESOURCE_IDS.length);
  });

  it('falls back to iron for unknown or missing resource', () => {
    expect(laserTone(null)).toBe(LASER_TONES.iron);
    expect(laserTone(undefined)).toBe(LASER_TONES.iron);
  });

  it('ice is the brightest, most glassy crackle', () => {
    const maxCrackle = Math.max(...RESOURCE_IDS.map((id) => LASER_TONES[id].crackleHz));
    expect(LASER_TONES.ice.crackleHz).toBe(maxCrackle);
  });
});

describe('laserTargets', () => {
  it('is silent when inactive, even if hitting', () => {
    const t = laserTargets({ active: false, hitting: true, resource: 'copper' });
    expect(t.humGain).toBe(0);
    expect(t.crackleGain).toBe(0);
    expect(t.bodyGain).toBe(0);
  });

  it('hums when active and crackles only while hitting', () => {
    expect(laserTargets({ active: true }).crackleGain).toBe(0);
    const t = laserTargets({ active: true, hitting: true, resource: 'ice' });
    expect(t.humGain).toBe(LASER_LEVELS.hum);
    expect(t.crackleGain).toBe(LASER_LEVELS.crackle);
    expect(t.tone).toBe(LASER_TONES.ice);
  });
});
