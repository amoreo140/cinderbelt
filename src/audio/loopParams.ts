// Mapping of game inputs (thrust, resource) to the parameters of the continuous loops.

import type { ResourceId } from '../data/resources';
import { clamp, clamp01 } from './math';

/** Engine input. `side` is -1..1 (the sign sets the stereo side). */
export interface ThrustInput {
  main?: number;
  reverse?: number;
  side?: number;
}

export interface NormalizedThrust {
  main: number;
  reverse: number;
  side: number;
}

export function normalizeThrust(input: ThrustInput | number): NormalizedThrust {
  if (typeof input === 'number') return { main: clamp01(input), reverse: 0, side: 0 };
  return {
    main: clamp01(input.main ?? 0),
    reverse: clamp01(input.reverse ?? 0),
    side: clamp(input.side ?? 0, -1, 1),
  };
}

export interface EngineMainParams {
  /** Deep rumble (brown noise through a low-pass). */
  rumbleGain: number;
  rumbleCutoff: number;
  /** Tonal engine hum. */
  humGain: number;
  humHz: number;
  humCutoff: number;
  /** Airy noise at high thrust. */
  airGain: number;
  airHz: number;
}

/** Main engine - the curves are slightly "advanced" so low thrust is audible. */
export function engineMainParams(throttle: number): EngineMainParams {
  const t = clamp01(throttle);
  const shaped = Math.pow(t, 0.6);
  return {
    rumbleGain: 0.5 * shaped,
    rumbleCutoff: 140 + 760 * Math.pow(t, 1.3),
    humGain: 0.09 * shaped,
    humHz: 44 + 14 * t,
    humCutoff: 160 + 360 * t,
    airGain: 0.1 * t * t,
    airHz: 700 + 1300 * t,
  };
}

export interface EngineReverseParams {
  noiseGain: number;
  noiseHz: number;
  toneGain: number;
  toneHz: number;
}

/** Reverse thrust - higher, a "hollower" character than the main engine. */
export function engineReverseParams(throttle: number): EngineReverseParams {
  const t = clamp01(throttle);
  const shaped = Math.pow(t, 0.7);
  return {
    noiseGain: 0.3 * shaped,
    noiseHz: 520 + 500 * t,
    toneGain: 0.04 * shaped,
    toneHz: 88 + 22 * t,
  };
}

export interface EngineSideParams {
  gain: number;
  cutoff: number;
  pan: number;
}

/** Side manoeuvring thrusters - a gentle hiss shifted to the side. */
export function engineSideParams(side: number): EngineSideParams {
  const s = clamp(side, -1, 1);
  const mag = Math.abs(s);
  return {
    gain: 0.2 * Math.pow(mag, 0.7),
    cutoff: 1800 + 1600 * mag,
    pan: 0.35 * Math.sign(s),
  };
}

/** Engine attack and release times in seconds (faster attack, slower release). */
export const ENGINE_RAMP = { up: 0.12, down: 0.35 } as const;

export interface LaserTone {
  /** Base frequency of the laser hum. */
  baseHz: number;
  /** Centre of the band-pass for the rock crackle. */
  crackleHz: number;
  crackleQ: number;
  /** 0..1 - how "shimmering" the laser is (higher harmonics). */
  shimmer: number;
}

/** Laser tuning by resource (pentatonic so it all sounds in tune). */
export const LASER_TONES: Record<ResourceId, LaserTone> = {
  iron: { baseHz: 196.0, crackleHz: 1500, crackleQ: 0.9, shimmer: 0.25 },
  copper: { baseHz: 220.0, crackleHz: 2100, crackleQ: 1.1, shimmer: 0.35 },
  titanium: { baseHz: 261.63, crackleHz: 2900, crackleQ: 1.4, shimmer: 0.45 },
  ice: { baseHz: 293.66, crackleHz: 4600, crackleQ: 2.6, shimmer: 0.7 },
};

export function laserTone(resource: ResourceId | null | undefined): LaserTone {
  return (resource && LASER_TONES[resource]) || LASER_TONES.iron;
}

/** When switched on, the laser "ramps up" from a lower pitch. */
export const LASER_SPIN = { startRatio: 0.82, upSeconds: 0.25, stopRatio: 0.9, downSeconds: 0.12 } as const;
/** Volume of the laser layers. */
export const LASER_LEVELS = { hum: 0.16, beam: 0.05, crackle: 0.32, body: 0.15 } as const;

export interface LaserInput {
  active: boolean;
  /** Does the beam hit an asteroid? (crackle layer) */
  hitting?: boolean;
  resource?: ResourceId | null;
  /**
   * How hard the beam bites (Mining 2.0): 1 = plain rock, more on the vein bonus segment and as the
   * laser nears overheating – the rock crackle and the body get louder, the hum a little.
   */
  intensity?: number;
}

export interface LaserTargets {
  humGain: number;
  crackleGain: number;
  bodyGain: number;
  tone: LaserTone;
}

/** Target volumes of the laser layers; the crackle sounds only while the beam is active. */
export function laserTargets(input: LaserInput): LaserTargets {
  const tone = laserTone(input.resource);
  const active = input.active;
  const hitting = active && (input.hitting ?? false);
  const k = Math.min(1.6, Math.max(0.5, input.intensity ?? 1));
  return {
    humGain: active ? LASER_LEVELS.hum * (0.8 + 0.2 * k) : 0,
    crackleGain: hitting ? LASER_LEVELS.crackle * k : 0,
    bodyGain: hitting ? LASER_LEVELS.body * k : 0,
    tone,
  };
}
