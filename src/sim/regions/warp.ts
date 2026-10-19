// Border warp (§2.2): the point is displaced by a 2-octave value noise before the power diagram
// decides its cell. Cells stay convex in the warped space (q-space); the warp is the only source of
// organic borders. The amplitude follows the local guaranteed seed distance, so it is a continuous
// function of the distance from home.
import { hash3 } from '../world/hash';
import { REGION_GEN } from './constants';

const WARP_SALT_X = 0x3c1e_a5f1;
const WARP_SALT_Y = 0x7d24_19b3;

/** Lattice value in [−1, 1]. */
const lattice = (salt: number, ix: number, iy: number): number => (hash3(salt, ix, iy) / 4294967296) * 2 - 1;

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Value noise in [−1, 1] with lattice step `cell`. */
function valueNoise(salt: number, x: number, y: number, cell: number): number {
  const fx = x / cell;
  const fy = y / cell;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = smooth(fx - ix);
  const ty = smooth(fy - iy);
  const a = lattice(salt, ix, iy);
  const b = lattice(salt, ix + 1, iy);
  const c = lattice(salt, ix, iy + 1);
  const d = lattice(salt, ix + 1, iy + 1);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

/** Sum of octaves normalised to [−1, 1]. */
function fbm(salt: number, x: number, y: number): number {
  const { cell, octaves } = REGION_GEN.warp;
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let c = cell;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(salt + o * 0x9e37, x, y, c) * amp;
    norm += amp;
    amp *= 0.5;
    c *= 0.5;
  }
  return sum / norm;
}

/** Warp amplitude at distance `r` from home (u), given the variant's guaranteed minimum seed distance there. */
export function warpAmplitude(r: number, minSeedDistance: number): number {
  const fade = Math.min(1, r / REGION_GEN.warp.homeFade);
  return Math.min(REGION_GEN.warp.maxAmp, REGION_GEN.warp.ampFactor * minSeedDistance) * fade;
}

/** Writes the warped point (q-space) of world point (x, y) into `out`. */
export function warpPoint(seed: number, x: number, y: number, amplitude: number, out: { x: number; y: number }): void {
  if (amplitude <= 0) {
    out.x = x;
    out.y = y;
    return;
  }
  out.x = x + amplitude * fbm(seed ^ WARP_SALT_X, x, y);
  out.y = y + amplitude * fbm(seed ^ WARP_SALT_Y, x, y);
}
