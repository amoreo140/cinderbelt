export const TAU = Math.PI * 2;

/** Normalises an angle into the interval (-PI, PI]. */
export function normalizeAngle(a: number): number {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  return r;
}

/** Interpolation of an angle along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + normalizeAngle(b - a) * t;
}

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;
