// Far landmarks (readability plan §2): the pure parts of their rendering – the landmark manifest
// (public/assets/models/landmarks/landmarks.json, art/README §2.7.20), whether a landmark deep below
// the plane is in the camera's view, and the Echo light column's fade and Starsmiths rhythm.
// No three.js – unit tested in landmarkView.test.ts.
import type { LandmarkKind } from '../../sim/world/landmarks';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** A glow sprite at a `glow_<i>` empty. */
export interface LandmarkGlow {
  node: string;
  color: string;
  /** Sprite size in world units. */
  size: number;
  opacity: number;
  /** "2.5 s" / "4-6 s" – a breathing period range in seconds, or none (steady). */
  pulse?: string;
}

/** One model entry of the manifest (the gas giant is rendered by PlanetView and has no file). */
export interface LandmarkModelDef {
  id: Exclude<LandmarkKind, 'gas_giant'>;
  file: string;
  scale: number;
  /** World units of the model origin below the gameplay plane. */
  depth: number;
  /** Scaled model size (x, y, z). */
  worldSize: readonly [number, number, number];
  haze: { albedo: number; emissive: number };
  glows: readonly LandmarkGlow[];
}

export interface EchoColumnDef {
  file: string;
  scale: { width: number; height: number };
  tiltDeg: { vertical: number; compass: number };
}

export interface LandmarkManifest {
  models: Partial<Record<LandmarkKind, LandmarkModelDef>>;
  echoColumn: EchoColumnDef | null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The manifest JSON → typed defs; malformed entries are skipped (the game must run without them). */
export function parseLandmarkManifest(json: unknown): LandmarkManifest {
  const out: LandmarkManifest = { models: {}, echoColumn: null };
  const root = (json ?? {}) as { landmarks?: unknown[]; echoColumn?: Record<string, unknown> };
  for (const raw of Array.isArray(root.landmarks) ? root.landmarks : []) {
    const e = raw as Record<string, unknown>;
    if (typeof e.id !== 'string' || typeof e.file !== 'string' || !isNum(e.scale) || !isNum(e.depth)) continue;
    const ws = Array.isArray(e.worldSize) && e.worldSize.length === 3 && e.worldSize.every(isNum) ? (e.worldSize as [number, number, number]) : null;
    if (!ws) continue;
    const haze = (e.haze ?? {}) as Record<string, unknown>;
    const glows = (Array.isArray(e.glows) ? e.glows : []).filter(
      (g): g is LandmarkGlow => !!g && typeof (g as LandmarkGlow).node === 'string' && typeof (g as LandmarkGlow).color === 'string' && isNum((g as LandmarkGlow).size) && isNum((g as LandmarkGlow).opacity),
    );
    out.models[e.id as LandmarkModelDef['id']] = {
      id: e.id as LandmarkModelDef['id'],
      file: e.file,
      scale: e.scale,
      depth: e.depth,
      worldSize: ws,
      haze: { albedo: isNum(haze.albedo) ? haze.albedo : 0.5, emissive: isNum(haze.emissive) ? haze.emissive : 0.15 },
      glows,
    };
  }
  const ec = root.echoColumn;
  if (ec && typeof ec.file === 'string') {
    const scale = (ec.scale ?? {}) as Record<string, unknown>;
    const tilt = (ec.tiltDeg ?? {}) as Record<string, unknown>;
    out.echoColumn = {
      file: ec.file,
      scale: { width: isNum(scale.width) ? scale.width : 14, height: isNum(scale.height) ? scale.height : 700 },
      tiltDeg: { vertical: isNum(tilt.vertical) ? tilt.vertical : 0, compass: isNum(tilt.compass) ? tilt.compass : 35 },
    };
  }
  return out;
}

/** Breathing period (s) from the manifest's "2.5 s" / "4-6 s": a value inside the range by `t` (0..1). */
export function pulsePeriod(pulse: string | undefined, t: number): number | null {
  if (!pulse) return null;
  const m = /([\d.]+)(?:\s*-\s*([\d.]+))?/.exec(pulse);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] !== undefined ? Number(m[2]) : a;
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

/** Radius of the bounding sphere of a scaled model (half its diagonal). */
export const boundingRadius = (worldSize: readonly [number, number, number]): number => Math.hypot(worldSize[0], worldSize[1], worldSize[2]) / 2;

/**
 * Is a sphere (centre, radius) inside the view of a camera at `eye` looking at `target`
 * (three.js axes, +y up; vertical FOV in degrees, aspect = width / height, far plane)?
 * The camera has no roll (its right vector stays horizontal), like the game's rig.
 */
export function sphereInView(eye: Vec3Like, target: Vec3Like, vfovDeg: number, aspect: number, far: number, center: Vec3Like, radius: number): boolean {
  // camera basis: forward f, right r = f × up (horizontal), up u = r × f
  let fx = target.x - eye.x;
  let fy = target.y - eye.y;
  let fz = target.z - eye.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  const px = center.x - eye.x;
  const py = center.y - eye.y;
  const pz = center.z - eye.z;
  const z = px * fx + py * fy + pz * fz;
  const x = px * rx + pz * rz;
  const y = px * ux + py * uy + pz * uz;
  if (z < -radius || z > far + radius) return false;
  const a = ((vfovDeg / 2) * Math.PI) / 180;
  const h = Math.atan(Math.tan(a) * aspect);
  // signed distances to the four side planes (positive = inside)
  if (z * Math.sin(a) - y * Math.cos(a) < -radius) return false;
  if (z * Math.sin(a) + y * Math.cos(a) < -radius) return false;
  if (z * Math.sin(h) - x * Math.cos(h) < -radius) return false;
  if (z * Math.sin(h) + x * Math.cos(h) < -radius) return false;
  return true;
}

/** The Echo light column fades out when the ship is this close to the beacon (start, end of the fade). */
export const ECHO_FADE_NEAR = 45;
export const ECHO_FADE_FAR = 110;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Opacity of an Echo column by the ship's distance from its beacon on the plane (0 = hidden). */
export const echoColumnFade = (distance: number): number => smoothstep(ECHO_FADE_NEAR, ECHO_FADE_FAR, distance);

/** Starsmiths rhythm (long-short-short over 1.6 s, like the beacons' pulse). */
export const FORGESMITHS_PERIOD = 1.6;

/**
 * Brightness of the Echo column at time `t` (s): a base glow plus the long-short-short beat
 * (0.65..1). Reduced motion keeps a steady 0.85.
 */
export function echoRhythm(t: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0.85;
  const p = (((t % FORGESMITHS_PERIOD) + FORGESMITHS_PERIOD) % FORGESMITHS_PERIOD) / FORGESMITHS_PERIOD;
  const bump = (from: number, to: number) => smoothstep(from, from + 0.03, p) * (1 - smoothstep(to - 0.04, to, p));
  const beat = Math.max(bump(0, 0.36), bump(0.48, 0.6), bump(0.7, 0.82));
  return 0.65 + 0.35 * beat;
}
