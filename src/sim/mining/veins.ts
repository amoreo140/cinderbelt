// Veins on asteroids (long-term design). A vein is a crack on the model surface (veins.json);
// an active section ~1.5 u long moves along it. A beam that aims near the active section mines
// with a bonus. The asteroid pose (model, rotation, scale) is a pure function – the renderer uses the same one,
// so a vein in the simulation lies exactly where the player sees it.
import {
  ASTEROID_MODEL_BOUNDS,
  ASTEROID_MODEL_VARIANTS,
  ASTEROID_VEINS,
  asteroidModelName,
  type VeinType,
} from '../../data/asteroids';
import { TAU } from '../math/angle';
import { fnv1a32 } from '../math/fnv1a';
import type { Vec2 } from '../math/vec2';
import type { Asteroid } from '../world/generate';

/** Length of the active section (u). */
export const VEIN_SEGMENT_LENGTH = 1.5;
/** Speed of the active section's movement while mining (u/s) – Fe and Cu. */
export const VEIN_DRIFT_SPEED = 0.3;
/** A hit point closer than this to the active section (u, in the game plane) = the beam is on the vein. */
export const VEIN_HIT_RADIUS = 0.5;
/** Mining bonus on a vein: Fe/Cu ×1.5; Ti (deep vein) ×1.2 with a normal laser, ×1.8 with a heavy one. */
export const VEIN_BONUS = { drift: 1.5, deep: 1.2, deepHeavy: 1.8 } as const;
/** Veined rocks are "upright" (veins on the top side), tilted by at most ±0.25 rad. */
export const VEIN_ROCK_TILT = 0.5;
/** The part of a vein whose surface faces down (normal below this value) is not visible to the player – it cannot be hit. */
export const VEIN_VISIBLE_UP = -0.05;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Model rotation as Euler XYZ (the same order as three.js Object3D.rotation). */
export interface EulerXYZ {
  x: number;
  y: number;
  z: number;
}

/** Vein state of an asteroid: the centre of the active section (u ∈ 0 … 1) and the movement direction of each vein. */
export interface VeinState {
  centers: number[];
  dirs: number[];
}

/** A model vein precomputed for the simulation: points centred and scaled to unit radius. */
export interface VeinModel {
  index: number;
  type: VeinType;
  /** Length at asteroid radius 1 (u). */
  length: number;
  points: Vec3[];
  /** Outward surface normal at each point. */
  normals: Vec3[];
  u: number[];
}

const frac = (x: number): number => x - Math.floor(x);

const MODEL_CACHE = new Map<string, VeinModel[]>();

function modelVeins(name: string): VeinModel[] {
  let veins = MODEL_CACHE.get(name);
  if (veins) return veins;
  const source = ASTEROID_VEINS[name] ?? [];
  const bounds = ASTEROID_MODEL_BOUNDS[name];
  if (!bounds || source.length === 0) {
    veins = [];
  } else {
    const [cx, cy, cz] = bounds.center;
    const k = 1 / bounds.radius;
    veins = source.map((v, index) => ({
      index,
      type: v.type,
      length: v.length * k,
      points: v.points.map(([x, y, z]) => ({ x: (x - cx) * k, y: (y - cy) * k, z: (z - cz) * k })),
      normals: v.normals.map(([x, y, z]) => ({ x, y, z })),
      u: [...v.u],
    }));
  }
  MODEL_CACHE.set(name, veins);
  return veins;
}

/** Index of the model variant (a, b, c) by the asteroid's `variant`. */
export const asteroidModelIndex = (a: Pick<Asteroid, 'variant'>): number =>
  Math.min(ASTEROID_MODEL_VARIANTS.length - 1, Math.max(0, Math.floor(a.variant * ASTEROID_MODEL_VARIANTS.length)));

export const modelNameOf = (a: Pick<Asteroid, 'resource' | 'variant'>): string =>
  asteroidModelName(a.resource, asteroidModelIndex(a));

/** Veins of an asteroid (empty for ice and fragments without veins). */
export const veinsOf = (a: Pick<Asteroid, 'resource' | 'variant'>): readonly VeinModel[] => modelVeins(modelNameOf(a));

const FACING_CACHE = new Map<string, number>();

/**
 * The direction the model's veins face in the horizontal plane: angle α = atan2(x, z) of the average normal
 * at the centre of the veins (glTF; α = 0 points at +z, towards the game camera).
 */
export function veinFacing(a: Pick<Asteroid, 'resource' | 'variant'>): number {
  const name = modelNameOf(a);
  let alpha = FACING_CACHE.get(name);
  if (alpha === undefined) {
    let x = 0;
    let z = 0;
    for (const vein of veinsOf(a)) {
      const n = vein.normals[Math.floor(vein.normals.length / 2)]!;
      x += n.x;
      z += n.z;
    }
    alpha = Math.atan2(x, z);
    FACING_CACHE.set(name, alpha);
  }
  return alpha;
}

/** A veined rock turns its veins towards the camera (±0.6 rad) and sways slowly (±0.35 rad). */
const VEIN_YAW_SPREAD = 1.2;
const VEIN_WOBBLE = 0.35;

/**
 * Asteroid rotation at time `time` (simulation s). Rocks with veins are upright and turned with their veins
 * towards the camera (which is "south" above the plane) so the player sees the veins, and only sway slowly;
 * the others (ice) are rotated arbitrarily and spin.
 */
export function asteroidOrientation(a: Pick<Asteroid, 'resource' | 'variant'>, time: number): EulerXYZ {
  const v = a.variant;
  if (veinsOf(a).length > 0) {
    const yaw = -veinFacing(a) + (frac(v * 29) - 0.5) * VEIN_YAW_SPREAD;
    const wobble = VEIN_WOBBLE * Math.sin(time * (0.12 + 0.18 * frac(v * 53)) + frac(v * 71) * TAU);
    return { x: (frac(v * 17) - 0.5) * VEIN_ROCK_TILT, y: yaw + wobble, z: (frac(v * 41) - 0.5) * VEIN_ROCK_TILT };
  }
  const spin = time * (0.03 + 0.05 * frac(v * 53)) * (frac(v * 71) > 0.5 ? 1 : -1);
  return { x: frac(v * 17) * TAU, y: frac(v * 29) * TAU + spin, z: frac(v * 41) * TAU };
}

/** v' = Rx · Ry · Rz · v (Euler XYZ like three.js Matrix4.makeRotationFromEuler). */
export function rotateXYZ(e: EulerXYZ, v: Vec3): Vec3 {
  const a = Math.cos(e.x);
  const b = Math.sin(e.x);
  const c = Math.cos(e.y);
  const d = Math.sin(e.y);
  const ec = Math.cos(e.z);
  const f = Math.sin(e.z);
  const ae = a * ec;
  const af = a * f;
  const be = b * ec;
  const bf = b * f;
  return {
    x: c * ec * v.x - c * f * v.y + d * v.z,
    y: (af + be * d) * v.x + (ae - bf * d) * v.y - b * c * v.z,
    z: (bf - ae * d) * v.x + (be + af * d) * v.y + a * c * v.z,
  };
}

/** A vein point in the world: position in the game plane, height above it (+ up, Three.js y) and the vertical component of the normal. */
export interface VeinPoint {
  pos: Vec2;
  height: number;
  /** y of the surface normal (1 = faces up towards the camera, < 0 = underside). */
  up: number;
}

/** Centre line of a vein in the world for an asteroid of radius `radius` at time `time`. */
export function veinPolyline(a: Asteroid, vein: VeinModel, radius: number, time: number): VeinPoint[] {
  const e = asteroidOrientation(a, time);
  return vein.points.map((p, i) => {
    const w = rotateXYZ(e, p);
    const n = rotateXYZ(e, vein.normals[i]!);
    return { pos: { x: a.pos.x + w.x * radius, y: a.pos.y - w.z * radius }, height: w.y * radius, up: n.y };
  });
}

/** Length of a vein in the world (u) at asteroid radius `radius`. */
export const veinWorldLength = (vein: VeinModel, radius: number): number => vein.length * radius;

/** Initial vein state – deterministic from the asteroid id. */
export function initialVeinState(a: Pick<Asteroid, 'id' | 'resource' | 'variant'>): VeinState {
  const centers: number[] = [];
  const dirs: number[] = [];
  for (const vein of veinsOf(a)) {
    const h = fnv1a32(`${a.id}|vein${vein.index}`);
    centers.push(0.2 + 0.6 * ((h & 0xffff) / 0xffff));
    dirs.push((h >>> 16) & 1 ? 1 : -1);
  }
  return { centers, dirs };
}

/** Active section of a vein in units of u: centre and half length (deep vein = whole). */
export function activeSegment(vein: VeinModel, radius: number, state: VeinState): { center: number; half: number } {
  if (vein.type === 'deep') return { center: 0.5, half: 0.5 };
  const half = Math.min(0.5, VEIN_SEGMENT_LENGTH / 2 / Math.max(1e-6, veinWorldLength(vein, radius)));
  const c = state.centers[vein.index] ?? 0.5;
  return { center: Math.min(1 - half, Math.max(half, c)), half };
}

/** The section moves while mining (Fe and Cu); a deep vein stands still. */
export const veinDrifts = (vein: VeinModel): boolean => vein.type !== 'deep';

/** Moves the active section of a vein by `du` (u) in its direction; bounces at the end of the vein. Mutates `state`. */
export function advanceVein(vein: VeinModel, radius: number, state: VeinState, du: number): void {
  const i = vein.index;
  const { center, half } = activeSegment(vein, radius, state);
  if (half >= 0.5) {
    state.centers[i] = 0.5;
    return;
  }
  let dir = state.dirs[i] ?? 1;
  let c = center + dir * du;
  const lo = half;
  const hi = 1 - half;
  if (c > hi) {
    c = Math.max(lo, hi - (c - hi));
    dir = -1;
  } else if (c < lo) {
    c = Math.min(hi, lo + (lo - c));
    dir = 1;
  }
  state.centers[i] = c;
  state.dirs[i] = dir;
}

export interface VeinHit {
  /** Vein index (Vein_<i>). */
  vein: number;
  /** u of the vein point nearest to the hit location. */
  u: number;
  type: VeinType;
  /** Distance from the active section in the game plane (u). */
  distance: number;
}

/** A point of the vein polyline at u (linear between points k and k + 1). */
function lerpPoint(line: readonly VeinPoint[], us: readonly number[], k: number, u: number): VeinPoint {
  const ua = us[k]!;
  const ub = us[k + 1]!;
  const t = ub > ua ? Math.min(1, Math.max(0, (u - ua) / (ub - ua))) : 0;
  const p = line[k]!;
  const q = line[k + 1]!;
  return {
    pos: { x: p.pos.x + (q.pos.x - p.pos.x) * t, y: p.pos.y + (q.pos.y - p.pos.y) * t },
    height: p.height + (q.height - p.height) * t,
    up: p.up + (q.up - p.up) * t,
  };
}

/**
 * Is the hit point `target` (game plane) near the active section of any vein? Parts of a vein on the underside
 * of the rock (surface facing down) do not count – the player cannot see them.
 */
export function findVeinHit(a: Asteroid, radius: number, time: number, state: VeinState, target: Vec2): VeinHit | null {
  let best: VeinHit | null = null;
  for (const vein of veinsOf(a)) {
    const { center, half } = activeSegment(vein, radius, state);
    const u0 = center - half;
    const u1 = center + half;
    const line = veinPolyline(a, vein, radius, time);
    for (let k = 0; k + 1 < line.length; k++) {
      const lo = Math.max(vein.u[k]!, u0);
      const hi = Math.min(vein.u[k + 1]!, u1);
      if (hi < lo || vein.u[k + 1]! <= vein.u[k]!) continue;
      const A = lerpPoint(line, vein.u, k, lo);
      const B = lerpPoint(line, vein.u, k, hi);
      const dx = B.pos.x - A.pos.x;
      const dy = B.pos.y - A.pos.y;
      const len2 = dx * dx + dy * dy;
      const s = len2 > 1e-12 ? Math.min(1, Math.max(0, ((target.x - A.pos.x) * dx + (target.y - A.pos.y) * dy) / len2)) : 0;
      if (A.up + (B.up - A.up) * s < VEIN_VISIBLE_UP) continue;
      const distance = Math.hypot(A.pos.x + dx * s - target.x, A.pos.y + dy * s - target.y);
      if (distance > VEIN_HIT_RADIUS || (best && distance >= best.distance)) continue;
      best = { vein: vein.index, u: lo + (hi - lo) * s, type: vein.type, distance };
    }
  }
  return best;
}

/** Mining multiplier for a vein hit. */
export function veinBonus(type: VeinType, heavyLaser: boolean): number {
  if (type === 'deep') return heavyLaser ? VEIN_BONUS.deepHeavy : VEIN_BONUS.deep;
  return VEIN_BONUS.drift;
}

/** A vein point at u in the world (render: the beam end on the vein, sparks). */
export function veinPointAt(a: Asteroid, vein: VeinModel, radius: number, time: number, u: number): VeinPoint {
  const line = veinPolyline(a, vein, radius, time);
  let k = 0;
  while (k + 2 < vein.u.length && vein.u[k + 1]! < u) k++;
  return lerpPoint(line, vein.u, k, u);
}
