// Lamp rhythms of the border scenery and the Guild Watch (borders.json `lamps`, npc_ships.json
// `anim`): the halo sprite of a lamp is drawn at this brightness. Pure – unit tested.
//   guarded    steady slow pulse 0.5 Hz (both ends of a pylon in phase)
//   quiet      very slow breathing 0.25 Hz, low (the calmest marker)
//   contested  irregular flicker: on/off pieces of 80 ms by hash, mostly on
//   pirate     slow menacing pulse 0.7 Hz
//   buoy       chase blink along the lane: period 2 s, on 0.35 s, phase = index × 0.25 s
//   strobe     Guild Watch patrol strobe: double flash 60 ms on, 80 off, 60 on, period 1.2 s
//   nav        navigation lamps (red / green / white), steady
// With reduced motion every lamp holds a steady mid level (no flashing).
export type LampRhythm = 'guarded' | 'quiet' | 'contested' | 'pirate' | 'buoy' | 'strobe' | 'nav';

const TAU = Math.PI * 2;
const STEADY: Readonly<Record<LampRhythm, number>> = { guarded: 0.8, quiet: 0.35, contested: 0.75, pirate: 0.7, buoy: 0.55, strobe: 0.5, nav: 0.75 };
export const BUOY_PERIOD = 2;
export const BUOY_ON = 0.35;
export const BUOY_STEP = 0.25;
export const STROBE_PERIOD = 1.2;

const mod = (a: number, m: number): number => ((a % m) + m) % m;

/** Small integer hash → 0..1 (the contested flicker). */
function flickerHash(n: number): number {
  let h = Math.imul(n | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * Brightness 0..1 at time `t` (s). `phase`: 0..1 of a period for the pulses, the flicker and the
 * strobe; for `buoy` the buoy's index along its lane.
 */
export function lampLevel(rhythm: LampRhythm, t: number, phase: number, reducedMotion = false): number {
  if (reducedMotion) return STEADY[rhythm];
  switch (rhythm) {
    case 'guarded':
      return 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(TAU * (0.5 * t + phase)));
    case 'quiet':
      return 0.2 + 0.25 * (0.5 + 0.5 * Math.sin(TAU * (0.25 * t + phase)));
    case 'contested': {
      const piece = Math.floor((t + phase * 13) / 0.08);
      return flickerHash(piece) < 0.2 ? 0.08 : 0.85;
    }
    case 'pirate': {
      const s = 0.5 + 0.5 * Math.sin(TAU * (0.7 * t + phase));
      return 0.45 + 0.55 * s * s;
    }
    case 'buoy':
      return mod(t - phase * BUOY_STEP, BUOY_PERIOD) < BUOY_ON ? 1 : 0.12;
    case 'strobe': {
      const c = mod(t + phase * STROBE_PERIOD, STROBE_PERIOD);
      return c < 0.06 || (c >= 0.14 && c < 0.2) ? 1 : 0;
    }
    case 'nav':
    default:
      return 0.75;
  }
}
