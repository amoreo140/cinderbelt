// Space ambience by ring (1..4): a quiet, NON-TONAL bed under the music – a slowly wandering band of
// "wind" (brown noise) and a faint breath of high "air". No pitched voices: the pre-rendered music
// carries the harmony, a drone in another key would clash with it.

import { clamp } from './math';

export type Ring = 1 | 2 | 3 | 4;

export interface AmbientParams {
  ring: Ring;
  /** Centre of the wind band (Hz). */
  windHz: number;
  /** How far the band wanders around the centre (Hz). */
  windDrift: number;
  /** Speed of the wandering (Hz). */
  windRate: number;
  /** 0..1 – level of the wind band. */
  wind: number;
  /** 0..1 – level of the high air hiss. */
  air: number;
  /** Overall level of the bed. */
  level: number;
}

export const AMBIENT_RINGS: Record<Ring, AmbientParams> = {
  // home belt – soft and warm
  1: { ring: 1, windHz: 320, windDrift: 120, windRate: 0.03, wind: 0.5, air: 0.12, level: 0.16 },
  // outer belts – more open
  2: { ring: 2, windHz: 420, windDrift: 170, windRate: 0.035, wind: 0.6, air: 0.2, level: 0.17 },
  // crystal nebulae – airy
  3: { ring: 3, windHz: 560, windDrift: 220, windRate: 0.045, wind: 0.45, air: 0.35, level: 0.16 },
  // dead zones – low and windy, still soft
  4: { ring: 4, windHz: 230, windDrift: 90, windRate: 0.022, wind: 0.75, air: 0.08, level: 0.18 },
};

export function normalizeRing(ring: number): Ring {
  return clamp(Math.round(Number.isFinite(ring) ? ring : 1), 1, 4) as Ring;
}

export function ambientParamsForRing(ring: number): AmbientParams {
  return AMBIENT_RINGS[normalizeRing(ring)];
}

/** How long the change between rings takes (s). */
export const RING_CROSSFADE_SECONDS = 8;
