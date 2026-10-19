// Look of a mining beam by its state (Mining 2.0, plan 2026-10-17-tazba-2) – pure, no three.js, so
// the colours, widths and the extend / retract animation are unit tested. The beam has a hot white
// core and a coloured glow; on the active vein segment (bonus) it intensifies and warms to gold,
// near overheating it flickers toward red, out of energy it sputters.

export type Rgb = readonly [number, number, number];

export interface BeamState {
  /** Mining multiplier of the beam (> 1 = on the active vein segment). */
  bonus: number;
  /** Heat of the laser 0..1 (1 = overheats). */
  heat: number;
  /** The battery cannot keep the laser running – it fires in bursts. */
  starved: boolean;
  /** Heavy laser: a thicker beam. */
  heavy: boolean;
  /** Seconds since the start (flicker, sputter). */
  time: number;
  /** Per-laser phase so two beams do not pulse in step. */
  phase: number;
}

export interface BeamLook {
  /** HDR colours (linear, > 1 blooms). */
  core: Rgb;
  glow: Rgb;
  /** Overall brightness multiplier (0 = invisible this frame). */
  intensity: number;
  /** Half-widths (u) of the core and of the glow. */
  coreWidth: number;
  glowWidth: number;
  /** Speed of the energy flowing along the beam (u/s). */
  flow: number;
  /** Colour of sparks and the molten spot. */
  spark: Rgb;
}

/** Normal beam: magenta-red, like the laser parts' emitters. */
const GLOW_NORMAL: Rgb = [1.9, 0.26, 0.78];
/** Vein bonus: warm gold. */
const GLOW_BONUS: Rgb = [2.2, 1.05, 0.16];
/** Near overheating: angry red. */
const GLOW_HOT: Rgb = [2.6, 0.16, 0.06];
const CORE: Rgb = [2.3, 1.9, 2.2];
const CORE_BONUS: Rgb = [2.8, 2.3, 1.5];

/** Heat share from which the beam starts to flicker toward red. */
export const HOT_FROM = 0.7;

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];

/** Deterministic hash noise 0..1 of a number (sputter and flicker – no Math.random in the look). */
export function noise1(x: number): number {
  const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export function beamLook(s: BeamState): BeamLook {
  const bonus = s.bonus > 1;
  let glow = bonus ? GLOW_BONUS : GLOW_NORMAL;
  let core = bonus ? CORE_BONUS : CORE;
  let intensity = bonus ? 1.35 : 1;
  let width = (s.heavy ? 1.55 : 1) * (bonus ? 1.22 : 1);
  // a slow breathing of the width
  width *= 1 + 0.07 * Math.sin(s.time * 9 + s.phase * 2.1);
  const hot = Math.max(0, (s.heat - HOT_FROM) / (1 - HOT_FROM));
  if (hot > 0) {
    glow = mix(glow, GLOW_HOT, Math.min(1, hot * 1.1));
    // flicker grows toward overheating (step noise at ~24 Hz)
    const f = noise1(Math.floor(s.time * 24) + s.phase * 31);
    intensity *= 1 - hot * 0.45 * f;
    width *= 1 + hot * 0.25 * (f - 0.5);
  }
  if (s.starved) {
    // sputter: bursts and gaps, a thin dim beam
    const n = noise1(Math.floor(s.time * 18) + s.phase * 17);
    intensity *= n < 0.35 ? 0 : 0.35 + 0.45 * n;
    width *= 0.7;
    core = scale(core, 0.7);
  }
  return {
    core,
    glow,
    intensity,
    coreWidth: 0.035 * width,
    glowWidth: 0.44 * width,
    flow: bonus ? 34 : 24,
    spark: bonus ? [3.4, 2.2, 0.8] : hot > 0.4 ? [3.6, 0.9, 0.4] : [3.2, 1.8, 1.1],
  };
}

/** Extend / retract of one beam: the beam shoots out of the muzzle and pulls back into it. */
export const EXTEND_SECONDS = 0.09;
export const RETRACT_SECONDS = 0.12;

/** Next extension 0..1 (share of the length from the muzzle) for a beam that is on or off. */
export function stepExtend(extend: number, on: boolean, dt: number): number {
  return on ? Math.min(1, extend + dt / EXTEND_SECONDS) : Math.max(0, extend - dt / RETRACT_SECONDS);
}
