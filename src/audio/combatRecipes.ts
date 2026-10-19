// Combat sounds (M3a) as pure data in the spirit of recipes.ts: cannon shot, hull hit,
// shield hit, explosions, asteroid break-up, loot pickup and the pirate attack alert.
import type { ResourceId } from '../data/resources';
import { clamp01 } from './math';
import type { SfxEvent } from './recipes';

export type CombatSound =
  | 'shot'
  | 'pirateShot'
  | 'hit'
  | 'shieldHit'
  | 'explosionSmall'
  | 'explosionLarge'
  | 'breakup'
  | 'salvage'
  | 'alert'
  /** The player's ship lost a part (M3.8). */
  | 'partLost'
  /** Collision ahead (M3.8): a short beep, urgency 0..1 raises the pitch. */
  | 'collisionWarning';

export const COMBAT_SOUNDS: readonly CombatSound[] = [
  'shot', 'pirateShot', 'hit', 'shieldHit', 'explosionSmall', 'explosionLarge', 'breakup', 'salvage', 'alert', 'partLost', 'collisionWarning',
];

/** Minimum gap between identical sounds (s) - fire from several cannons does not blur into noise. */
export const COMBAT_MIN_INTERVAL: Record<CombatSound, number> = {
  shot: 0.05,
  pirateShot: 0.06,
  hit: 0.05,
  shieldHit: 0.07,
  explosionSmall: 0.08,
  explosionLarge: 0.15,
  breakup: 0.12,
  salvage: 0.25,
  alert: 2.5,
  partLost: 0.4,
  collisionWarning: 0.18,
};

/** "Pew" - a fast pitch drop with a short muzzle noise and a light thump; the pirate one lower and harsher. */
export function shotRecipe(pirate: boolean): SfxEvent[] {
  const k = pirate ? 0.78 : 1;
  return [
    {
      type: 'tone', at: 0, wave: pirate ? 'sawtooth' : 'square', freq: 980 * k, freqEnd: 240 * k, glide: 0.1,
      cutoff: pirate ? 1800 : 2600, gain: 0.06, attack: 0.002, hold: 0.015, release: 0.09, send: 0.12,
    },
    { type: 'noise', at: 0, color: 'white', filter: 'highpass', freq: 2200, q: 0.7, gain: 0.05, attack: 0.001, release: 0.04 },
    { type: 'tone', at: 0, wave: 'sine', freq: 150 * k, freqEnd: 60, glide: 0.08, gain: 0.07, attack: 0.002, release: 0.08 },
  ];
}

/** Hull hit - a metallic clink with a crunch; `intensity` 0..1 by damage. */
export function hitRecipe(intensity: number): SfxEvent[] {
  const i = clamp01(intensity);
  return [
    { type: 'noise', at: 0, color: 'pink', filter: 'bandpass', freq: 2600, freqEnd: 800, q: 1.2, gain: 0.08 + 0.1 * i, attack: 0.001, release: 0.1 + 0.08 * i, send: 0.15 },
    { type: 'tone', at: 0, wave: 'sine', freq: 640, freqEnd: 600, gain: 0.05 + 0.04 * i, attack: 0.002, release: 0.16, send: 0.25 },
    { type: 'tone', at: 0, wave: 'sine', freq: 1730, gain: 0.025 + 0.02 * i, attack: 0.002, release: 0.1, send: 0.25 },
    { type: 'tone', at: 0, wave: 'sine', freq: 110, freqEnd: 55, gain: 0.06 + 0.08 * i, attack: 0.002, release: 0.12 },
  ];
}

/** Shield hit - an electric "zzap" with a shimmering tail. */
export function shieldHitRecipe(): SfxEvent[] {
  return [
    { type: 'tone', at: 0, wave: 'triangle', freq: 1500, freqEnd: 520, glide: 0.14, gain: 0.07, attack: 0.002, hold: 0.02, release: 0.14, send: 0.35 },
    { type: 'tone', at: 0.01, wave: 'sine', freq: 2300, freqEnd: 2150, detuneCents: 12, gain: 0.03, attack: 0.004, release: 0.25, send: 0.5 },
    { type: 'noise', at: 0, color: 'white', filter: 'bandpass', freq: 4200, freqEnd: 1800, q: 2.5, gain: 0.05, attack: 0.001, release: 0.12, send: 0.3 },
  ];
}

/** Explosion - a deep thump, rumble and crackle of debris; a big one is longer and deeper. */
export function explosionRecipe(large: boolean): SfxEvent[] {
  const s = large ? 1 : 0.55;
  const events: SfxEvent[] = [
    { type: 'tone', at: 0, wave: 'sine', freq: large ? 85 : 120, freqEnd: 28, glide: 0.5 * s + 0.2, gain: 0.3 + 0.2 * s, attack: 0.004, hold: 0.03, release: 0.5 + 0.8 * s, send: 0.3 },
    { type: 'noise', at: 0, color: 'brown', filter: 'lowpass', freq: 1600, freqEnd: 110, q: 0.7, gain: 0.3 + 0.25 * s, attack: 0.003, hold: 0.05 * s, release: 0.6 + 1.0 * s, send: 0.35 },
    { type: 'noise', at: 0, color: 'white', filter: 'highpass', freq: 3000, freqEnd: 1200, q: 0.6, gain: 0.06, attack: 0.001, release: 0.12 },
  ];
  // praskanie trosiek
  const crackles = large ? [0.08, 0.17, 0.29, 0.41, 0.6] : [0.06, 0.15, 0.27];
  crackles.forEach((at, n) => {
    events.push({ type: 'noise', at, color: 'pink', filter: 'bandpass', freq: 1400 + 500 * (n % 3), q: 3, gain: 0.04 + 0.02 * s, attack: 0.002, release: 0.05, send: 0.25 });
  });
  return events;
}

/** Mined asteroid break-up - scattering fragments; ice rings like glass. */
export function breakupRecipe(resource: ResourceId | null): SfxEvent[] {
  const events: SfxEvent[] = [
    { type: 'tone', at: 0, wave: 'sine', freq: 90, freqEnd: 40, glide: 0.25, gain: 0.18, attack: 0.004, release: 0.35, send: 0.2 },
    { type: 'noise', at: 0, color: 'brown', filter: 'lowpass', freq: 1300, freqEnd: 200, q: 0.8, gain: 0.18, attack: 0.003, release: 0.45, send: 0.25 },
  ];
  [0.04, 0.09, 0.15, 0.22, 0.3].forEach((at, n) => {
    events.push({ type: 'noise', at, color: 'pink', filter: 'bandpass', freq: 900 + 350 * n, q: 2.2, gain: 0.07 - 0.008 * n, attack: 0.002, release: 0.07, send: 0.2 });
  });
  if (resource === 'ice') {
    for (const [at, freq] of [[0.02, 2637], [0.08, 3136], [0.15, 3951]] as const) {
      events.push({ type: 'tone', at, wave: 'sine', freq, gain: 0.03, attack: 0.002, release: 0.35, send: 0.5 });
    }
  }
  return events;
}

/** Loot picked up - a soft "whoosh" and a rising pair of tones. */
export function salvageRecipe(): SfxEvent[] {
  return [
    { type: 'noise', at: 0, color: 'pink', filter: 'bandpass', freq: 600, freqEnd: 2400, q: 1.1, gain: 0.07, attack: 0.05, release: 0.25, send: 0.3 },
    { type: 'tone', at: 0.08, wave: 'triangle', freq: 783.99, gain: 0.07, attack: 0.006, hold: 0.04, release: 0.3, send: 0.35 },
    { type: 'tone', at: 0.2, wave: 'triangle', freq: 1174.66, gain: 0.07, attack: 0.006, hold: 0.04, release: 0.45, send: 0.4 },
  ];
}

/** Pirates attack - a two-tone warning signal (low, unobtrusive). */
export function combatAlertRecipe(): SfxEvent[] {
  return [0, 0.22].flatMap((at): SfxEvent[] => [
    { type: 'tone', at, wave: 'square', freq: 660, freqEnd: 520, glide: 0.16, cutoff: 1400, gain: 0.05, attack: 0.008, hold: 0.06, release: 0.1, send: 0.2 },
  ]);
}

/**
 * A part torn off the hull – metal shearing (a falling band of noise and a bent, detuned clang) and
 * a falling two-note chirp that is unlike any other cue: you hear that something is gone.
 */
export function partLostRecipe(): SfxEvent[] {
  return [
    { type: 'noise', at: 0, color: 'pink', filter: 'bandpass', freq: 3400, freqEnd: 600, q: 4, gain: 0.12, attack: 0.002, hold: 0.04, release: 0.22, send: 0.25 },
    { type: 'tone', at: 0, wave: 'sawtooth', freq: 410, freqEnd: 290, glide: 0.2, detuneCents: 18, cutoff: 1600, gain: 0.05, attack: 0.003, hold: 0.03, release: 0.25, send: 0.3 },
    { type: 'tone', at: 0.16, wave: 'triangle', freq: 1046.5, freqEnd: 987.77, gain: 0.07, attack: 0.004, hold: 0.05, release: 0.12, send: 0.3 },
    { type: 'tone', at: 0.3, wave: 'triangle', freq: 698.46, freqEnd: 659.25, gain: 0.07, attack: 0.004, hold: 0.07, release: 0.3, send: 0.35 },
  ];
}

/** Collision ahead – one short clean beep; `urgency` 0..1 (time to impact) raises pitch and level. */
export function collisionWarningRecipe(urgency: number): SfxEvent[] {
  const u = clamp01(urgency);
  const f = 1200 + 700 * u;
  return [{ type: 'tone', at: 0, wave: 'sine', freq: f, gain: 0.035 + 0.04 * u, attack: 0.003, hold: 0.035, release: 0.04, send: 0.08 }];
}

export function combatRecipe(kind: CombatSound, options: { intensity?: number; resource?: ResourceId | null } = {}): SfxEvent[] {
  switch (kind) {
    case 'shot':
      return shotRecipe(false);
    case 'pirateShot':
      return shotRecipe(true);
    case 'hit':
      return hitRecipe(options.intensity ?? 0.5);
    case 'shieldHit':
      return shieldHitRecipe();
    case 'explosionSmall':
      return explosionRecipe(false);
    case 'explosionLarge':
      return explosionRecipe(true);
    case 'breakup':
      return breakupRecipe(options.resource ?? null);
    case 'salvage':
      return salvageRecipe();
    case 'alert':
      return combatAlertRecipe();
    case 'partLost':
      return partLostRecipe();
    case 'collisionWarning':
      return collisionWarningRecipe(options.intensity ?? 0.5);
  }
}
