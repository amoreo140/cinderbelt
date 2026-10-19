// The look of each zone: the visible sun and the light it casts, the planet far below the gameplay
// plane, the haze of the distant silhouettes, the nebula fog tint, the dust, the sky tint and the
// colour grade. A zone is a sector's depth (1–4, its panorama) plus its environment (sectors design
// §3.2: a tint of the sky, the dust colour and the far debris within the depth's look).
// Matched to the zone skyboxes (art/out/previews/skybox): depth 1 blue-violet home belt, depth 2 the
// red-amber outer belts, depth 3 the teal crystal nebulae, depth 4 the dim purple dead zones.
// Pure data and math (no three.js) – the parallax and mixing are unit tested.
import type { RingIndex } from '../../data/economy';
import type { Vec2 } from '../../sim/math/vec2';
import type { Biome } from '../../sim/regions/sectors';
import type { LandmarkKind } from '../../sim/world/landmarks';

export type Rgb = readonly [number, number, number];

export interface PlanetSpec {
  /** Key in public/assets/planets/planets.json (texture set, atmosphere, clouds). */
  kind: string;
  radius: number;
  /** Depth of the centre below the gameplay plane (world units). */
  depth: number;
  /**
   * Where the planet sits on its depth plane relative to the point the camera looks at there
   * (world x, world z; +x = screen right, −z = screen top).
   */
  offset: Vec2;
  /** Euler tilt of the spin axis (rad): x leans the pole toward the camera, z sideways. */
  tilt: { x: number; z: number };
  /** Spin about its own axis (rad/s). */
  spin: number;
  /** 0 = lit like the gameplay plane (from above), 1 = from the visible sun (backlit crescent). */
  backlight: number;
  /** Gas-giant ring system (models/planets/gas_giant_rings.glb). */
  rings?: boolean;
  /** Brightness multiplier (small dark moons need more light to read). Default 1. */
  light?: number;
  /** A minor body (moon): only with planet detail (Medium and up). */
  minor?: boolean;
  /**
   * World-anchored at the site of this landmark (readability §2: a compass with true parallax)
   * instead of following the camera at `offset`; `offset` stays the fallback until the site is known.
   */
  landmark?: LandmarkKind;
}

export interface Grade {
  /** Added to the shadows (display space). */
  lift: Rgb;
  /** Multiplies the highlights. */
  gain: Rgb;
  saturation: number;
  contrast: number;
  /** Strength of the vignette 0..1. */
  vignette: number;
}

/** Far debris of the depth layers in a zone. */
export interface DebrisLook {
  /** Multiplier of a scenery set's share in the depth mix (`scrap: 2` = twice as much scrap). */
  bias: Readonly<Record<string, number>>;
  /** Instance colour of the neutral rocks (`#RRGGBB`, overrides the manifest's per-ring tint). */
  rockTint: string | null;
  /** Share of the silhouettes shown (0..1). */
  density: number;
}

export interface ZoneLook {
  sun: {
    /** Screen position of the visible sun (NDC, −1..1). */
    ndc: Vec2;
    /** Colour of the disc / glow (sprite). */
    color: number;
    /** Angular size of the glow (world units at the sun distance). */
    size: number;
    /** Directional light: colour, intensity, elevation above the plane (deg). */
    lightColor: number;
    lightIntensity: number;
    elevationDeg: number;
  };
  fill: { color: number; intensity: number };
  hemi: { sky: number; ground: number; intensity: number };
  /** Multiplier of the skybox environment light (lower = deeper shadows). */
  envScale: number;
  planets: readonly PlanetSpec[];
  /** Colour the distant silhouettes fade to and how strongly (at the deepest layer). */
  haze: number;
  hazeStrength: number;
  /** Two tints of the nebula fog layers and their opacity. */
  nebula: readonly [number, number];
  nebulaOpacity: number;
  grade: Grade;
  /** Colour of the SpaceDust grains and of their streak heads. */
  dust: number;
  /** Multiplier of the sky panorama (sRGB hex; 0xffffff = as painted). */
  skyTint: number;
  debris: DebrisLook;
}

const DEBRIS_DEFAULT: DebrisLook = { bias: {}, rockTint: null, density: 1 };

const DEG = Math.PI / 180;

export const ZONE_LOOKS: Readonly<Record<RingIndex, ZoneLook>> = {
  // home belt: a banded gas giant with rings far below, a small barren moon, a warm white sun
  1: {
    sun: { ndc: { x: 0.6, y: 0.8 }, color: 0xfff1dc, size: 120, lightColor: 0xfff0dc, lightIntensity: 2.9, elevationDeg: 40 },
    fill: { color: 0x7f9cff, intensity: 0.45 },
    hemi: { sky: 0x8fa8ff, ground: 0x1a1030, intensity: 0.18 },
    envScale: 0.62,
    // the banded gas giant is a world-anchored landmark (LANDMARK_PLANETS), not tied to the zone
    planets: [
      { kind: 'rocky_barren', radius: 38, depth: 1300, offset: { x: 760, y: -260 }, tilt: { x: -0.9, z: 0.1 }, spin: 0.01, backlight: 0.1, light: 2.2, minor: true },
    ],
    haze: 0x1b2450,
    hazeStrength: 0.8,
    nebula: [0x4a6cff, 0x9a5cff],
    nebulaOpacity: 0.11,
    grade: { lift: [0.006, 0.01, 0.024], gain: [1.03, 1.0, 0.97], saturation: 1.08, contrast: 1.06, vignette: 0.42 },
    dust: 0x9fb4ff,
    skyTint: 0xffffff,
    debris: DEBRIS_DEFAULT,
  },
  // outer belts: a rust-desert world under a hot amber sun
  2: {
    sun: { ndc: { x: -0.3, y: 0.84 }, color: 0xffc890, size: 135, lightColor: 0xffd8b0, lightIntensity: 2.8, elevationDeg: 38 },
    fill: { color: 0xff7a6a, intensity: 0.35 },
    hemi: { sky: 0xffa080, ground: 0x2a0c18, intensity: 0.16 },
    envScale: 0.6,
    planets: [
      { kind: 'rocky_arid', radius: 560, depth: 2400, offset: { x: 1150, y: 480 }, tilt: { x: -1.0, z: -0.25 }, spin: 0.005, backlight: 0.55 },
      { kind: 'ice_glacier', radius: 34, depth: 1250, offset: { x: -780, y: -240 }, tilt: { x: -0.8, z: 0.2 }, spin: 0.012, backlight: 0.1, light: 1.4, minor: true },
    ],
    haze: 0x3a1420,
    hazeStrength: 0.8,
    nebula: [0xff7a4a, 0xc0407a],
    nebulaOpacity: 0.1,
    grade: { lift: [0.02, 0.006, 0.012], gain: [1.05, 0.99, 0.94], saturation: 1.06, contrast: 1.07, vignette: 0.45 },
    dust: 0xe0b4a4,
    skyTint: 0xffffff,
    debris: DEBRIS_DEFAULT,
  },
  // crystal nebulae: a violet storm giant glowing through teal fog
  3: {
    sun: { ndc: { x: 0.45, y: 0.84 }, color: 0xd8fff4, size: 110, lightColor: 0xe0fff6, lightIntensity: 2.7, elevationDeg: 38 },
    fill: { color: 0x40ffc8, intensity: 0.4 },
    hemi: { sky: 0x80ffe0, ground: 0x0a2420, intensity: 0.18 },
    envScale: 0.65,
    planets: [{ kind: 'gas_violet', radius: 600, depth: 2500, offset: { x: -1100, y: 560 }, tilt: { x: -1.1, z: 0.45 }, spin: 0.006, backlight: 0.5 }],
    haze: 0x0c3a34,
    hazeStrength: 0.85,
    nebula: [0x2affc0, 0x8a5cff],
    nebulaOpacity: 0.14,
    grade: { lift: [0.0, 0.018, 0.018], gain: [0.98, 1.03, 1.02], saturation: 1.1, contrast: 1.05, vignette: 0.42 },
    dust: 0xa4ecdc,
    skyTint: 0xffffff,
    debris: DEBRIS_DEFAULT,
  },
  // dead zones: a dark volcanic world with glowing fissures under a dim red dwarf
  4: {
    sun: { ndc: { x: -0.4, y: 0.82 }, color: 0xff8a6a, size: 95, lightColor: 0xffb090, lightIntensity: 2.4, elevationDeg: 40 },
    fill: { color: 0xa050ff, intensity: 0.3 },
    hemi: { sky: 0xb080ff, ground: 0x140818, intensity: 0.14 },
    envScale: 0.55,
    planets: [{ kind: 'volcanic_lava_sea', radius: 560, depth: 2400, offset: { x: 1100, y: 520 }, tilt: { x: -1.0, z: -0.3 }, spin: 0.003, backlight: 0.6 }],
    haze: 0x24102c,
    hazeStrength: 0.85,
    nebula: [0xa04aff, 0xff5a5a],
    nebulaOpacity: 0.09,
    grade: { lift: [0.016, 0.0, 0.022], gain: [1.02, 0.97, 1.02], saturation: 0.92, contrast: 1.1, vignette: 0.5 },
    dust: 0xbca4e4,
    skyTint: 0xffffff,
    debris: DEBRIS_DEFAULT,
  },
};

export const zoneLook = (ring: RingIndex): ZoneLook => ZONE_LOOKS[ring];

/**
 * Planets anchored at a landmark site (readability §2: a compass with true parallax). They do not
 * belong to a zone: they show while the camera is within sight of the anchor (`landmarkPlanetFade`),
 * whatever the sector – the gas giant's anchor lies past the depth-1 border, so a zone-bound planet
 * used to vanish just as the player flew toward it.
 */
export const LANDMARK_PLANETS: readonly PlanetSpec[] = [
  // world-anchored at home + (−1150, +2270) (landmarkSites): from home it sits where `offset` put it
  { kind: 'gas_giant', radius: 520, depth: 2500, offset: { x: -1150, y: 520 }, tilt: { x: -0.75, z: 0.42 }, spin: 0.004, backlight: 0.55, rings: true, landmark: 'gas_giant' },
];

/** A landmark planet is in full view up to this distance of the camera target from its anchor (u)… */
export const LANDMARK_PLANET_SIGHT = 4300;
/** …and fades out over this distance beyond it. */
export const LANDMARK_PLANET_FADE = 1000;

/** Opacity of a landmark planet by the planar distance of the camera target from its anchor. */
export function landmarkPlanetFade(distance: number): number {
  const t = Math.min(1, Math.max(0, (distance - LANDMARK_PLANET_SIGHT) / LANDMARK_PLANET_FADE));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * How far a landmark planet in view pushes the zone's major planet out (1 = hidden): the gas giant
 * near home and the big planet of a depth-2 zone at once look busy. Minor bodies (moons) stay.
 */
export const ZONE_MAJOR_YIELD = 1;

/** Opacity of a zone planet at zone fade `level` while landmark planets show at `landmark` (both 0..1). */
export function zonePlanetOpacity(level: number, landmark: number, minor: boolean): number {
  if (minor) return level;
  return level * (1 - ZONE_MAJOR_YIELD * Math.min(1, Math.max(0, landmark)));
}

/** How an environment shifts its depth's look (§3.2) – only tints, the panorama stays the depth's. */
interface EnvironmentTweak {
  dust?: number;
  skyTint?: number;
  nebula?: readonly [number, number];
  /** Multiplier of the nebula fog opacity. */
  nebulaOpacity?: number;
  haze?: number;
  /** Multiplier of the haze strength. */
  hazeStrength?: number;
  fill?: number;
  /** Added to the grade lift. */
  lift?: Rgb;
  /** Multiplier of the grade saturation. */
  saturation?: number;
  debris?: Partial<DebrisLook>;
}

/** The environments' tints; the first environment of a depth is its signature look (no tweak). */
export const ENVIRONMENT_TWEAKS: Readonly<Record<Biome, EnvironmentTweak>> = {
  asteroidField: {},
  // cold blue-white dust and fog, icy rocks
  iceField: {
    dust: 0xd4eeff,
    skyTint: 0xe4f0ff,
    nebula: [0x58b4ff, 0xa8e4ff],
    haze: 0x1a3252,
    lift: [0, 0.004, 0.01],
    debris: { rockTint: '#DCEBFF' },
  },
  // empty and dim: sparse silhouettes, faint fog, a quieter sky
  quietSpace: {
    dust: 0x8a94c4,
    skyTint: 0xd8dae8,
    nebulaOpacity: 0.4,
    hazeStrength: 0.9,
    saturation: 0.93,
    debris: { density: 0.45 },
  },
  rustField: {},
  // electric blue in the amber: the fog's second tint and the fill turn violet-blue
  ionFringe: {
    dust: 0xa8d0ff,
    skyTint: 0xece6ff,
    nebula: [0xff7a4a, 0x5a74ff],
    fill: 0x9a80ff,
    lift: [0, 0, 0.012],
  },
  // a graveyard: much more scrap below, smoky warm dust, muted colours
  wreckField: {
    dust: 0xd4bca4,
    skyTint: 0xf8ece0,
    nebulaOpacity: 0.75,
    saturation: 0.92,
    debris: { bias: { scrap: 2.6 } },
  },
  // metallic: grey-white dust, pale rocks, a cooler second fog tint
  titanPlateau: {
    dust: 0xd8dee8,
    skyTint: 0xf2f2f8,
    nebula: [0xffa070, 0xb4acd0],
    saturation: 0.9,
    debris: { rockTint: '#E6E6EE' },
  },
  // the signature crystal look, a bit denser
  crystalNebula: { nebulaOpacity: 1.25, debris: { bias: { crystal: 1.6 } } },
  // icy trail: white-cyan dust, few crystals, frosted rocks
  cometPath: {
    dust: 0xeaf8ff,
    skyTint: 0xecf8ff,
    nebula: [0x80ffe8, 0xc8e4ff],
    nebulaOpacity: 0.85,
    debris: { bias: { crystal: 0.35 }, rockTint: '#D8E8F4' },
  },
  deepDark: {},
};

const lookCache = new Map<string, ZoneLook>();

/** The look of a zone: the depth's look shifted by the environment's tweak (cached). */
export function zoneLookFor(depth: RingIndex, environment: Biome): ZoneLook {
  const key = `${depth}:${environment}`;
  const hit = lookCache.get(key);
  if (hit) return hit;
  const base = ZONE_LOOKS[depth];
  const tw = ENVIRONMENT_TWEAKS[environment];
  const lift = tw.lift ?? [0, 0, 0];
  const look: ZoneLook = {
    ...base,
    fill: { ...base.fill, color: tw.fill ?? base.fill.color },
    haze: tw.haze ?? base.haze,
    hazeStrength: base.hazeStrength * (tw.hazeStrength ?? 1),
    nebula: tw.nebula ?? base.nebula,
    nebulaOpacity: base.nebulaOpacity * (tw.nebulaOpacity ?? 1),
    grade: {
      ...base.grade,
      lift: [base.grade.lift[0] + lift[0], base.grade.lift[1] + lift[1], base.grade.lift[2] + lift[2]],
      saturation: base.grade.saturation * (tw.saturation ?? 1),
    },
    dust: tw.dust ?? base.dust,
    skyTint: tw.skyTint ?? base.skyTint,
    debris: { ...base.debris, ...tw.debris, bias: { ...base.debris.bias, ...tw.debris?.bias } },
  };
  lookCache.set(key, look);
  return look;
}

/** The blendable part of a zone look, mutable – mixed in place every frame (no allocation). */
export interface MixedLook {
  sunNdcX: number;
  sunNdcY: number;
  sunColor: number;
  sunSize: number;
  sunLightColor: number;
  sunLightIntensity: number;
  sunElevationDeg: number;
  fillColor: number;
  fillIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  envScale: number;
  haze: number;
  hazeStrength: number;
  nebula: [number, number];
  nebulaOpacity: number;
  grade: { lift: [number, number, number]; gain: [number, number, number]; saturation: number; contrast: number; vignette: number };
  dust: number;
  skyTint: number;
}

/** A mixed look set to a zone look. */
export function createMixedLook(look: ZoneLook): MixedLook {
  const out: MixedLook = {
    sunNdcX: 0,
    sunNdcY: 0,
    sunColor: 0,
    sunSize: 0,
    sunLightColor: 0,
    sunLightIntensity: 0,
    sunElevationDeg: 0,
    fillColor: 0,
    fillIntensity: 0,
    hemiSky: 0,
    hemiGround: 0,
    hemiIntensity: 0,
    envScale: 0,
    haze: 0,
    hazeStrength: 0,
    nebula: [0, 0],
    nebulaOpacity: 0,
    grade: { lift: [0, 0, 0], gain: [0, 0, 0], saturation: 0, contrast: 0, vignette: 0 },
    dust: 0,
    skyTint: 0,
  };
  mixLookInto(out, null, look, 1);
  return out;
}

/** Copies one mixed look into another (the snapshot a new cross-fade starts from). */
export function copyMixedLook(out: MixedLook, from: MixedLook): void {
  const { nebula, grade, ...flat } = from;
  Object.assign(out, flat);
  out.nebula[0] = nebula[0];
  out.nebula[1] = nebula[1];
  for (let i = 0; i < 3; i++) {
    out.grade.lift[i] = grade.lift[i]!;
    out.grade.gain[i] = grade.gain[i]!;
  }
  out.grade.saturation = grade.saturation;
  out.grade.contrast = grade.contrast;
  out.grade.vignette = grade.vignette;
}

/**
 * `out` = the mix of `snapshot` (null = take `b` as it is) and the zone look `b` at `t` (0..1),
 * written in place. `out` may be `snapshot`.
 */
export function mixLookInto(out: MixedLook, snapshot: MixedLook | null, b: ZoneLook, t: number): void {
  const a = t >= 1 ? null : snapshot;
  const A = a ?? out;
  const n = (x: number, y: number) => (a ? mixNumber(x, y, t) : y);
  const h = (x: number, y: number) => (a ? mixHex(x, y, t) : y);
  out.sunNdcX = n(A.sunNdcX, b.sun.ndc.x);
  out.sunNdcY = n(A.sunNdcY, b.sun.ndc.y);
  out.sunColor = h(A.sunColor, b.sun.color);
  out.sunSize = n(A.sunSize, b.sun.size);
  out.sunLightColor = h(A.sunLightColor, b.sun.lightColor);
  out.sunLightIntensity = n(A.sunLightIntensity, b.sun.lightIntensity);
  out.sunElevationDeg = n(A.sunElevationDeg, b.sun.elevationDeg);
  out.fillColor = h(A.fillColor, b.fill.color);
  out.fillIntensity = n(A.fillIntensity, b.fill.intensity);
  out.hemiSky = h(A.hemiSky, b.hemi.sky);
  out.hemiGround = h(A.hemiGround, b.hemi.ground);
  out.hemiIntensity = n(A.hemiIntensity, b.hemi.intensity);
  out.envScale = n(A.envScale, b.envScale);
  out.haze = h(A.haze, b.haze);
  out.hazeStrength = n(A.hazeStrength, b.hazeStrength);
  out.nebula[0] = h(A.nebula[0], b.nebula[0]);
  out.nebula[1] = h(A.nebula[1], b.nebula[1]);
  out.nebulaOpacity = n(A.nebulaOpacity, b.nebulaOpacity);
  for (let i = 0; i < 3; i++) {
    out.grade.lift[i] = n(A.grade.lift[i]!, b.grade.lift[i]!);
    out.grade.gain[i] = n(A.grade.gain[i]!, b.grade.gain[i]!);
  }
  out.grade.saturation = n(A.grade.saturation, b.grade.saturation);
  out.grade.contrast = n(A.grade.contrast, b.grade.contrast);
  out.grade.vignette = n(A.grade.vignette, b.grade.vignette);
  out.dust = h(A.dust, b.dust);
  out.skyTint = h(A.skyTint, b.skyTint);
}

/**
 * Mirror reflection of the sun off a level hull vs. the camera direction (deg): near 0 the whole
 * flat top of every ship flares into bloom, so a look keeps it well away (unit tested).
 */
export function glareAngle(sunX: number, sunZ: number, elevationDeg: number, pitchDeg: number): number {
  const l = lightDirection(sunX, sunZ, elevationDeg);
  // the light reflected off a horizontal surface leaves along (−lx, ly, −lz); the camera sits at
  // (0, sin pitch, cos pitch) from what it looks at
  const p = pitchDeg * DEG;
  const dot = l.y * Math.sin(p) - l.z * Math.cos(p);
  return Math.acos(Math.min(1, Math.max(-1, dot))) / DEG;
}

/**
 * Direction the sun light comes FROM (unit, three.js axes): the azimuth of the visible sun on the
 * plane (its x/z) lifted to `elevationDeg` above the plane, so shadows fall away from the sun on
 * screen while the light still comes from above.
 */
export function lightDirection(sunX: number, sunZ: number, elevationDeg: number): { x: number; y: number; z: number } {
  const len = Math.hypot(sunX, sunZ);
  const ax = len > 1e-6 ? sunX / len : 0;
  const az = len > 1e-6 ? sunZ / len : -1;
  const e = elevationDeg * DEG;
  return { x: ax * Math.cos(e), y: Math.sin(e), z: az * Math.cos(e) };
}

/**
 * How far a distant object lags behind the camera after the player travelled `travel` (world units)
 * from the zone anchor: `k` × the travel at first, saturating smoothly at `k` × `limit` so the
 * planet drifts slowly but never leaves the sky.
 */
export function parallaxLag(travel: Vec2, k: number, limit: number): Vec2 {
  const d = Math.hypot(travel.x, travel.y);
  if (d < 1e-9 || limit <= 0) return { x: 0, y: 0 };
  const m = (k * limit * Math.tanh(d / limit)) / d;
  return { x: travel.x * m, y: travel.y * m };
}

/**
 * Keeps a planet off the middle of the screen (where the player's ship is): `d` = its offset from
 * the view centre on its depth plane, `half` = the half extent of the view there. Inside the ellipse
 * of size `min` (1 = the screen edge) it is pushed out radially – it slides around the edge instead
 * of crossing behind the ship. `fallback` gives the direction when `d` is exactly the centre.
 */
export function keepOffCenter(d: Vec2, half: Vec2, min: number, fallback: Vec2): Vec2 {
  const ex = d.x / half.x;
  const ey = d.y / half.y;
  const e = Math.hypot(ex, ey);
  if (e >= min) return d;
  if (e < 1e-6) {
    const f = Math.hypot(fallback.x / half.x, fallback.y / half.y) || 1;
    return { x: (fallback.x / f) * min, y: (fallback.y / f) * min };
  }
  return { x: (d.x * min) / e, y: (d.y * min) / e };
}

/** Point on the plane `depth` below the gameplay plane that the camera (pitch in deg) looks at (offset along −z). */
export const lookAheadAtDepth = (depth: number, pitchDeg: number): number => depth / Math.tan(pitchDeg * DEG);

export const mixNumber = (a: number, b: number, t: number): number => a + (b - a) * t;

/** sRGB hex colours mixed per channel. */
export function mixHex(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const m = (s: number) => Math.round(mixNumber(ch(a, s), ch(b, s), t)) << s;
  return m(16) | m(8) | m(0);
}

const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [mixNumber(a[0], b[0], t), mixNumber(a[1], b[1], t), mixNumber(a[2], b[2], t)];

export function mixGrade(a: Grade, b: Grade, t: number): Grade {
  return {
    lift: mixRgb(a.lift, b.lift, t),
    gain: mixRgb(a.gain, b.gain, t),
    saturation: mixNumber(a.saturation, b.saturation, t),
    contrast: mixNumber(a.contrast, b.contrast, t),
    vignette: mixNumber(a.vignette, b.vignette, t),
  };
}
