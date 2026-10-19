// Background vs. playfield (readability pass, R4): the sky panorama, the code stars, the nebula fog,
// the distant silhouettes, the planets and the sun are one "backdrop" that must stay a step darker and
// calmer than the gameplay objects. One player setting ("Background brightness",
// 0..1) drives all of them; 1 = the original look, the default sits about a third lower.
// Pure math (no three.js) – unit tested.

/** Default of the background brightness setting (0..1; 1 = the original, brighter backdrop). */
export const BACKGROUND_BRIGHTNESS_DEFAULT = 0.6;

export interface BackdropLook {
  /** Multiplier of the sky panorama brightness. */
  sky: number;
  /** Saturation of the sky panorama (1 = as painted). */
  skySaturation: number;
  /**
   * Highlight compression of the sky panorama: luminance above `skyKnee` (linear) grows only by
   * `skyHighlight` per unit – the painted stars and glow stars lose more than the dim nebula.
   */
  skyKnee: number;
  skyHighlight: number;
  /** Multiplier of the code starfield opacity. */
  stars: number;
  /** Multiplier of the nebula fog layers' opacity. */
  fog: number;
  /** Multiplier of the haze over the distant silhouettes (≥ 1: flatter, further away). */
  haze: number;
  /** Multiplier of the distant silhouettes' colour (they must not read like gameplay rocks). */
  debris: number;
  /** Multiplier of the planet light. */
  planets: number;
  /** Multiplier of the sun sprite brightness. */
  sun: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** The backdrop at background brightness `level` (0..1, clamped). */
export function backdropLook(level: number): BackdropLook {
  const s = clamp01(Number.isFinite(level) ? level : BACKGROUND_BRIGHTNESS_DEFAULT);
  return {
    sky: mix(0.12, 1, s),
    skySaturation: mix(0.45, 1, s),
    skyKnee: 0.06,
    skyHighlight: mix(0.1, 1, s),
    stars: mix(0.15, 1, s),
    fog: mix(0.15, 1, s),
    haze: mix(1.3, 1, s),
    debris: mix(0.3, 1, s),
    planets: mix(0.45, 1, s),
    sun: mix(0.3, 1, s),
  };
}
