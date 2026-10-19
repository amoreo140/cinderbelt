// Asteroid dust maths (AsteroidDust): the chips orbiting a rock and the motes drifting around it.
// Everything that depends only on the rock id is hashed once into a typed array per rock; a frame
// then costs a few sin/cos per chip and mote and writes the chip matrix straight into the batch's
// matrix texture (audit 2026-10-17 P5: the old per-frame code hashed 12+ Math.sin per chip and went
// through Euler → quaternion → compose for every chip).

const frac = (x: number) => x - Math.floor(x);
/** Deterministic 0..1 from a seed and an index. */
export const dustRand = (seed: number, i: number) => frac(Math.sin(seed * 0.000123 + i * 12.9898) * 43758.5453);

/** Per chip: orbit factor, angular speed, start angle, tilt / 2, size factor, x-spin rate, cos / sin of the fixed y angle, y / z scale, rubble pick, shade. */
export const CHIP_STRIDE = 12;
/** Per mote: radius factor, start angle, angular rate, bob frequency, height factor, twinkle frequency. */
export const MOTE_STRIDE = 6;

/** The constants of chips 0..count−1 of the rock with `seed`. */
export function chipConstants(seed: number, count: number): Float64Array {
  const c = new Float64Array(count * CHIP_STRIDE);
  for (let i = 0; i < count; i++) {
    const o = i * CHIP_STRIDE;
    c[o] = 1.3 + dustRand(seed, i) * 1.1;
    c[o + 1] = (0.04 + dustRand(seed, i + 50) * 0.1) * (dustRand(seed, i + 7) < 0.5 ? -1 : 1);
    c[o + 2] = dustRand(seed, i + 13) * Math.PI * 2;
    c[o + 3] = (dustRand(seed, i + 29) - 0.5) * 0.9 * 0.5;
    c[o + 4] = dustRand(seed, i + 3) * 0.16;
    c[o + 5] = 0.3 + dustRand(seed, i + 41);
    const yaw = dustRand(seed, i + 43) * 6;
    c[o + 6] = Math.cos(yaw);
    c[o + 7] = Math.sin(yaw);
    c[o + 8] = 0.6 + dustRand(seed, i + 5) * 0.6;
    c[o + 9] = 0.7 + dustRand(seed, i + 9) * 0.5;
    c[o + 10] = dustRand(seed, i + 77);
    c[o + 11] = 0.75 + dustRand(seed, i + 61) * 0.4;
  }
  return c;
}

/** The constants of motes 0..count−1 of the rock with `seed`. */
export function moteConstants(seed: number, count: number): Float64Array {
  const c = new Float64Array(count * MOTE_STRIDE);
  for (let i = 0; i < count; i++) {
    const o = i * MOTE_STRIDE;
    const k = i + 100;
    c[o] = 1.1 + dustRand(seed, k) * 2.2;
    c[o + 1] = dustRand(seed, k + 1) * Math.PI * 2;
    c[o + 2] = dustRand(seed, k + 2) - 0.5;
    c[o + 3] = 0.2 + dustRand(seed, k + 3) * 0.3;
    c[o + 4] = (dustRand(seed, k + 4) - 0.5) * 1.2;
    c[o + 5] = 0.6 + dustRand(seed, k + 5);
  }
  return c;
}

/**
 * Chip `i` of a rock at (x, ·, z) with radius `r` at time `t`: its instance matrix (the Matrix4
 * element order – position, Euler XYZ rotation (t·spin, fixed yaw, t·0.2), scale) into `out` at `at`.
 * `cosZ` / `sinZ` = cos / sin of t·0.2 (the same for every chip of the frame).
 */
export function writeChipMatrix(out: Float32Array, at: number, c: Float64Array, i: number, x: number, z: number, r: number, t: number, cosZ: number, sinZ: number): void {
  const o = i * CHIP_STRIDE;
  const orbit = r * c[o]!;
  const ang = c[o + 2]! + t * c[o + 1]!;
  const size = Math.min(0.7, 0.09 + c[o + 4]! * Math.max(1, r * 0.4));
  const sy = size * c[o + 8]!;
  const sz = size * c[o + 9]!;
  const rx = t * c[o + 5]!;
  const a = Math.cos(rx);
  const b = Math.sin(rx);
  const cy = c[o + 6]!;
  const dy = c[o + 7]!;
  const ae = a * cosZ;
  const af = a * sinZ;
  const be = b * cosZ;
  const bf = b * sinZ;
  // three's makeRotationFromEuler (order XYZ), columns scaled like Matrix4.compose
  out[at] = cy * cosZ * size;
  out[at + 1] = (af + be * dy) * size;
  out[at + 2] = (bf - ae * dy) * size;
  out[at + 3] = 0;
  out[at + 4] = -cy * sinZ * sy;
  out[at + 5] = (ae - bf * dy) * sy;
  out[at + 6] = (be + af * dy) * sy;
  out[at + 7] = 0;
  out[at + 8] = dy * sz;
  out[at + 9] = -b * cy * sz;
  out[at + 10] = a * cy * sz;
  out[at + 11] = 0;
  out[at + 12] = x + Math.cos(ang) * orbit;
  out[at + 13] = Math.sin(ang * 1.3 + i) * orbit * c[o + 3]!;
  out[at + 14] = z + Math.sin(ang) * orbit;
  out[at + 15] = 1;
}

/**
 * Mote `i` of a rock at (x, ·, z) with radius `r` at time `t`: its position into `out` at `at`;
 * returns its twinkle 0..1.
 */
export function writeMote(out: Float32Array, at: number, c: Float64Array, i: number, x: number, z: number, r: number, t: number): number {
  const o = i * MOTE_STRIDE;
  const rad = r * c[o]!;
  const ang = c[o + 1]! + t * 0.03 * c[o + 2]!;
  const bob = Math.sin(t * c[o + 3]! + i) * 0.6;
  out[at] = x + Math.cos(ang) * rad;
  out[at + 1] = c[o + 4]! * r + bob;
  out[at + 2] = z + Math.sin(ang) * rad;
  return 0.5 + 0.5 * Math.sin(t * c[o + 5]! + i * 1.7);
}
