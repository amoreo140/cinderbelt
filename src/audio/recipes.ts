// "Recipes" for one-shot sounds as pure data. They are played by sfxPlayer.ts,
// so everything here can be tested without the Web Audio API.

import type { ResourceId } from '../data/resources';
import { clamp, clamp01, semitonesToRatio } from './math';

export type Wave = 'sine' | 'triangle' | 'sawtooth' | 'square';
export type NoiseColor = 'white' | 'pink' | 'brown';
export type FilterKind = 'lowpass' | 'highpass' | 'bandpass';

interface EventBase {
  /** Offset from the start of the sound in seconds. */
  at: number;
  /** Peak gain. */
  gain: number;
  attack: number;
  hold?: number;
  release: number;
  /** Share of the signal sent to the reverb (0..1). */
  send?: number;
}

export interface ToneEvent extends EventBase {
  type: 'tone';
  wave: Wave;
  freq: number;
  /** Target frequency for the glissando (exponential). */
  freqEnd?: number;
  /** Glissando duration; the whole sound duration by default. */
  glide?: number;
  detuneCents?: number;
  /** Optional low-pass (softens sharp waves). */
  cutoff?: number;
}

export interface NoiseEvent extends EventBase {
  type: 'noise';
  color: NoiseColor;
  filter: FilterKind;
  freq: number;
  freqEnd?: number;
  q: number;
}

export type SfxEvent = ToneEvent | NoiseEvent;

export function eventDuration(e: SfxEvent): number {
  return e.at + e.attack + (e.hold ?? 0) + e.release;
}

export function recipeDuration(events: readonly SfxEvent[]): number {
  return events.reduce((max, e) => Math.max(max, eventDuration(e)), 0);
}

// ---------- Impact ----------

/** A soft "thud" - a deep pitch drop, damped noise and, on a strong impact, a metallic tail. */
export function impactRecipe(intensity: number): SfxEvent[] {
  const i = clamp01(intensity);
  const events: SfxEvent[] = [
    {
      type: 'tone', at: 0, wave: 'sine',
      freq: 70 + 70 * i, freqEnd: 36, glide: 0.25 + 0.2 * i,
      gain: 0.22 + 0.5 * i, attack: 0.004, hold: 0.02, release: 0.2 + 0.4 * i, send: 0.12 + 0.2 * i,
    },
    {
      type: 'noise', at: 0, color: 'brown', filter: 'lowpass',
      freq: 300 + 2400 * Math.pow(i, 1.5), freqEnd: 120, q: 0.7,
      gain: 0.15 + 0.45 * i, attack: 0.003, release: 0.08 + 0.3 * i, send: 0.15 + 0.2 * i,
    },
  ];
  if (i > 0.35) {
    // gentle non-resonant partials - the "metal" of the hull, not a sharp clink
    const ring = (i - 0.35) / 0.65;
    for (const [ratio, level] of [[1, 1], [2.76, 0.55], [5.4, 0.25]] as const) {
      events.push({
        type: 'tone', at: 0.005, wave: 'sine', freq: 180 * ratio, freqEnd: 180 * ratio * 0.97,
        gain: 0.05 * ring * level, attack: 0.006, release: 0.5 + 0.6 * ring, send: 0.45,
      });
    }
  }
  return events;
}

// ---------- Zber suroviny ----------

/** Base tones of the "blip" by resource. */
export const BLIP_BASE_HZ: Record<ResourceId, number> = {
  iron: 783.99, // G5
  copper: 880.0, // A5
  titanium: 1046.5, // C6
  ice: 1174.66, // D6
};

/** Pentatonic scale for a "streak" of pickups. */
export const BLIP_STEPS = [0, 2, 4, 7, 9] as const;
/** If the next pickup comes within this time, the streak goes up one step. */
export const BLIP_STREAK_WINDOW = 0.7;
/** Minimum gap between blips (rate limit). */
export const BLIP_MIN_INTERVAL = 0.12;

export function nextBlipStep(previousStep: number, secondsSincePrevious: number): number {
  if (secondsSincePrevious > BLIP_STREAK_WINDOW) return 0;
  return Math.min(BLIP_STEPS.length - 1, previousStep + 1);
}

export function blipFrequency(resource: ResourceId, step: number): number {
  const index = clamp(Math.round(step), 0, BLIP_STEPS.length - 1);
  return (BLIP_BASE_HZ[resource] ?? BLIP_BASE_HZ.iron) * semitonesToRatio(BLIP_STEPS[index]!);
}

export function resourceBlipRecipe(resource: ResourceId, step: number): SfxEvent[] {
  const f = blipFrequency(resource, step);
  return [
    { type: 'tone', at: 0, wave: 'sine', freq: f * 0.94, freqEnd: f, glide: 0.03, gain: 0.09, attack: 0.004, release: 0.12, send: 0.25 },
    { type: 'tone', at: 0, wave: 'sine', freq: f * 2, gain: 0.02, attack: 0.004, release: 0.06, send: 0.3 },
  ];
}

// ---------- Upozornenia ----------

export type AlertKind = 'cargoFull' | 'outOfFuel';

export const ALERT_COOLDOWN: Record<AlertKind, number> = { cargoFull: 2.5, outOfFuel: 3 };

export function alertRecipe(kind: AlertKind): SfxEvent[] {
  if (kind === 'cargoFull') {
    // a two-tone chime going down (C6 -> G5), repeated quieter
    const notes: Array<[number, number, number]> = [
      [0, 1046.5, 0.12],
      [0.14, 783.99, 0.12],
      [0.42, 1046.5, 0.06],
      [0.56, 783.99, 0.06],
    ];
    return notes.flatMap(([at, freq, gain]): SfxEvent[] => [
      { type: 'tone', at, wave: 'triangle', freq, gain, attack: 0.006, hold: 0.04, release: 0.32, send: 0.3 },
      { type: 'tone', at, wave: 'sine', freq: freq * 2, gain: gain * 0.25, attack: 0.006, release: 0.18, send: 0.3 },
    ]);
  }
  // out of fuel: three low "bwoop" pulses with a pitch drop
  return [0, 0.24, 0.48].map(
    (at): SfxEvent => ({
      type: 'tone', at, wave: 'square', freq: 440, freqEnd: 300, glide: 0.18, cutoff: 1100,
      gain: 0.08, attack: 0.01, hold: 0.06, release: 0.12, send: 0.2,
    }),
  );
}

// ---------- Dampers ----------

export function dampersRecipe(on: boolean): SfxEvent[] {
  const [from, to] = on ? [180, 340] : [340, 170];
  const clicks = on ? [1250, 1870] : [1870, 1250];
  return [
    { type: 'tone', at: 0, wave: 'triangle', freq: from, freqEnd: to, glide: 0.16, cutoff: 900, gain: 0.08, attack: 0.01, hold: 0.05, release: 0.14, send: 0.2 },
    ...clicks.map(
      (freq, n): SfxEvent => ({ type: 'tone', at: 0.02 + n * 0.07, wave: 'sine', freq, gain: 0.07, attack: 0.002, release: 0.05, send: 0.15 }),
    ),
    { type: 'noise', at: 0, color: 'white', filter: 'bandpass', freq: 3000, q: 1.5, gain: 0.05, attack: 0.002, release: 0.03 },
  ];
}

// ---------- UI ----------

export type UiSound = 'hover' | 'click';
export const UI_MIN_INTERVAL: Record<UiSound, number> = { hover: 0.035, click: 0.02 };

export function uiRecipe(kind: UiSound): SfxEvent[] {
  if (kind === 'hover') {
    return [{ type: 'tone', at: 0, wave: 'sine', freq: 2200, freqEnd: 2350, gain: 0.045, attack: 0.003, release: 0.03 }];
  }
  return [
    { type: 'tone', at: 0, wave: 'triangle', freq: 1400, freqEnd: 1100, glide: 0.04, gain: 0.08, attack: 0.002, release: 0.06, send: 0.1 },
    { type: 'noise', at: 0, color: 'white', filter: 'highpass', freq: 4000, q: 0.7, gain: 0.03, attack: 0.001, release: 0.015 },
  ];
}

// ---------- Communicator (radio) ----------

/** How a radio message opens: plain radio, a harsher danger burst, the Echo's glitch. */
export type CommsSoundKind = 'radio' | 'danger' | 'echo';
/** Shortest gap between two radio openings (s). */
export const COMMS_MIN_INTERVAL = 0.25;

/**
 * A radio message opens: a short burst of band-passed static (the squelch) and a soft two-tone bleep.
 * Danger is lower and rougher, the Echo a detuned falling glide under the static.
 */
export function commsRecipe(kind: CommsSoundKind): SfxEvent[] {
  const squelch: SfxEvent = { type: 'noise', at: 0, color: 'white', filter: 'bandpass', freq: 2600, freqEnd: 1400, q: 1.4, gain: 0.07, attack: 0.004, hold: 0.05, release: 0.09, send: 0.05 };
  if (kind === 'echo') {
    return [
      { ...squelch, freq: 1800, freqEnd: 600, gain: 0.06, hold: 0.12, release: 0.25 },
      { type: 'tone', at: 0.05, wave: 'triangle', freq: 880, freqEnd: 440, glide: 0.4, detuneCents: 18, gain: 0.05, attack: 0.02, hold: 0.08, release: 0.35, send: 0.5 },
      { type: 'tone', at: 0.09, wave: 'sine', freq: 1318.5, freqEnd: 659.25, glide: 0.4, detuneCents: -22, gain: 0.035, attack: 0.02, hold: 0.06, release: 0.35, send: 0.55 },
    ];
  }
  if (kind === 'danger') {
    return [
      { ...squelch, freq: 1700, freqEnd: 900, gain: 0.09, hold: 0.07 },
      { type: 'tone', at: 0.07, wave: 'square', freq: 740, cutoff: 1800, gain: 0.035, attack: 0.003, hold: 0.05, release: 0.04 },
      { type: 'tone', at: 0.15, wave: 'square', freq: 587.33, cutoff: 1800, gain: 0.035, attack: 0.003, hold: 0.07, release: 0.06, send: 0.1 },
    ];
  }
  return [
    squelch,
    { type: 'tone', at: 0.07, wave: 'sine', freq: 1568, gain: 0.05, attack: 0.003, hold: 0.035, release: 0.05, send: 0.15 },
    { type: 'tone', at: 0.13, wave: 'sine', freq: 2093, gain: 0.04, attack: 0.003, hold: 0.03, release: 0.08, send: 0.2 },
  ];
}

// ---------- Entering a sector ----------

/** Security of the sector the ship entered (mirrors `Security` of the sectors design, §3.1). */
export type SectorTone = 'quiet' | 'guarded' | 'contested' | 'pirate';
/** Shortest gap between two sector entry tones (s). */
export const SECTOR_TONE_MIN_INTERVAL = 0.4;

/**
 * Entering a sector (sectors §5.2): a short navigation chime – no radio static, it is the ship's own
 * console. Quiet is a single soft ping, Guarded a warm rising third, Contested a falling fourth on a
 * duller voice, Pirate a low tritone with a dark pulse under it. `notice` = the full chime of a first
 * visit; otherwise (a sector seen before) only its first note, softer.
 */
export function sectorEntryRecipe(security: SectorTone, notice: boolean): SfxEvent[] {
  let chime: SfxEvent[];
  switch (security) {
    case 'quiet':
      chime = [{ type: 'tone', at: 0, wave: 'sine', freq: 880, gain: 0.05, attack: 0.006, hold: 0.04, release: 0.32, send: 0.35 }];
      break;
    case 'guarded':
      chime = [
        { type: 'tone', at: 0, wave: 'triangle', freq: 659.25, cutoff: 2400, gain: 0.055, attack: 0.006, hold: 0.05, release: 0.22, send: 0.3 },
        { type: 'tone', at: 0.11, wave: 'sine', freq: 830.61, gain: 0.05, attack: 0.006, hold: 0.06, release: 0.38, send: 0.4 },
      ];
      break;
    case 'contested':
      chime = [
        { type: 'tone', at: 0, wave: 'triangle', freq: 783.99, cutoff: 1600, gain: 0.055, attack: 0.005, hold: 0.05, release: 0.18, send: 0.25 },
        { type: 'tone', at: 0.12, wave: 'triangle', freq: 587.33, cutoff: 1400, gain: 0.05, attack: 0.005, hold: 0.07, release: 0.3, send: 0.3 },
      ];
      break;
    case 'pirate':
      chime = [
        { type: 'tone', at: 0, wave: 'square', freq: 329.63, cutoff: 1100, gain: 0.04, attack: 0.004, hold: 0.06, release: 0.16, send: 0.2 },
        { type: 'tone', at: 0, wave: 'sine', freq: 82.41, freqEnd: 65.41, glide: 0.3, gain: 0.09, attack: 0.01, hold: 0.05, release: 0.3 },
        { type: 'tone', at: 0.13, wave: 'square', freq: 466.16, cutoff: 1100, gain: 0.04, attack: 0.004, hold: 0.08, release: 0.26, send: 0.25 },
      ];
      break;
  }
  if (notice) return chime;
  // a known sector: the first note only (and the pirate pulse), quieter
  return chime.filter((e) => e.at === 0).map((e) => ({ ...e, gain: e.gain * 0.6, release: e.release * 0.8 }));
}

// ---------- Dokovanie ----------

export function dockRecipe(docking: boolean): SfxEvent[] {
  if (docking) {
    return [
      // approach servo
      { type: 'tone', at: 0, wave: 'sawtooth', freq: 260, freqEnd: 520, glide: 0.45, cutoff: 900, gain: 0.04, attack: 0.05, hold: 0.3, release: 0.15, send: 0.2 },
      // dosadnutie svoriek
      { type: 'tone', at: 0.5, wave: 'sine', freq: 95, freqEnd: 48, glide: 0.25, gain: 0.35, attack: 0.004, release: 0.35, send: 0.25 },
      { type: 'noise', at: 0.5, color: 'brown', filter: 'lowpass', freq: 900, freqEnd: 150, q: 0.8, gain: 0.25, attack: 0.003, release: 0.25, send: 0.25 },
      // latches
      { type: 'tone', at: 0.62, wave: 'sine', freq: 1500, gain: 0.05, attack: 0.002, release: 0.05 },
      { type: 'tone', at: 0.7, wave: 'sine', freq: 1700, gain: 0.05, attack: 0.002, release: 0.05 },
      // confirmation - a rising fourth/fifth
      { type: 'tone', at: 0.85, wave: 'sine', freq: 659.25, gain: 0.08, attack: 0.01, hold: 0.05, release: 0.5, send: 0.4 },
      { type: 'tone', at: 0.98, wave: 'sine', freq: 987.77, gain: 0.07, attack: 0.01, hold: 0.05, release: 0.7, send: 0.45 },
    ];
  }
  return [
    // pressure release
    { type: 'noise', at: 0, color: 'pink', filter: 'highpass', freq: 2500, freqEnd: 900, q: 0.7, gain: 0.12, attack: 0.01, release: 0.6, send: 0.3 },
    // odomknutie svoriek
    { type: 'tone', at: 0.02, wave: 'sine', freq: 80, freqEnd: 50, glide: 0.2, gain: 0.2, attack: 0.004, release: 0.25, send: 0.2 },
    // retreat servo
    { type: 'tone', at: 0.15, wave: 'sawtooth', freq: 520, freqEnd: 260, glide: 0.4, cutoff: 800, gain: 0.035, attack: 0.04, hold: 0.25, release: 0.15, send: 0.2 },
    // falling confirmation
    { type: 'tone', at: 0.55, wave: 'sine', freq: 987.77, gain: 0.07, attack: 0.01, hold: 0.04, release: 0.45, send: 0.4 },
    { type: 'tone', at: 0.68, wave: 'sine', freq: 659.25, gain: 0.07, attack: 0.01, hold: 0.04, release: 0.6, send: 0.45 },
  ];
}
