// Far landmarks (readability plan §2, art/README §2.7.20): huge scenery objects deep below
// the gameplay plane that work as a compass – no mechanics, no collision. This module only decides
// WHERE they are: a deterministic list of instances per seed (kind, position on the plane, yaw).
// Depth, scale, haze and animation are render data (public/assets/models/landmarks/landmarks.json).
//
// The list is the whole contract: the render and the map read `LandmarkSite[]` and never the rules.
// The planned sectors (the sectors design) will pick one landmark
// per sector instead of the ring rules below – they only have to produce the same `LandmarkSite`
// records (e.g. `site(kind, sectorId, pos, yaw)`), nothing downstream changes.
import { ECHOES } from '../../data/echoes';
import type { RingIndex } from '../../data/economy';
import { TAU } from '../math/angle';
import { createRng, type Rng } from '../math/rng';
import type { Vec2 } from '../math/vec2';
import { hash3 } from './hash';
import { echoSites } from '../discovery/poi';

export type LandmarkKind = 'gas_giant' | 'guild_relay' | 'rust_ring_shard' | 'crystal_spire' | 'dead_forge';
export const LANDMARK_KINDS: readonly LandmarkKind[] = ['gas_giant', 'guild_relay', 'rust_ring_shard', 'crystal_spire', 'dead_forge'];

/** One landmark in the world. */
export interface LandmarkSite {
  /** Stable id (`<kind>:<n>`; a sector-based generator would use `<kind>:<sectorId>`). */
  id: string;
  kind: LandmarkKind;
  /** Position on the gameplay plane (sim x, y; +y = north = screen up) the model hangs below. */
  pos: Vec2;
  /** Turn about the vertical axis (rad, three.js rotation.y; 0 = the modelled front faces the camera). */
  yaw: number;
  /** The ring whose look it belongs to. */
  ring: RingIndex;
}

/**
 * The ring-1 compass: the hero gas giant is world-anchored at home + this offset (manifest
 * `gas_giant.anchor`), so it sits where the old camera-following backdrop put it when seen from home.
 */
export const GAS_GIANT_ANCHOR: Readonly<Vec2> = { x: -1150, y: 2270 };

const LANDMARK_SALT = 0x1a4d_3a2c;
const DEG = Math.PI / 180;

/** Placement rule of one kind (the manifest's `where` suggestions). */
export interface LandmarkRule {
  kind: Exclude<LandmarkKind, 'gas_giant'>;
  ring: RingIndex;
  count: number;
  /** Distance from home (min, max). */
  radius: readonly [number, number];
  /** Yaw range (deg). */
  yawDeg: readonly [number, number];
  /** Bearing of instance i (rad, 0 = east, counter-clockwise) from a seeded base angle. */
  angle: (rng: Rng, i: number, base: number) => number;
}

const jitter = (rng: Rng, deg: number): number => (rng() * 2 - 1) * deg * DEG;

export const LANDMARK_RULES: readonly LandmarkRule[] = [
  // ring 1: one relay mast in the eastern half (−70..+70° from east) – the gas giant sits north-west
  { kind: 'guild_relay', ring: 1, count: 1, radius: [900, 1200], yawDeg: [-30, 30], angle: (rng) => jitter(rng, 70) },
  // ring 2: three shards of one broken ring, 120° apart ± 25°
  { kind: 'rust_ring_shard', ring: 2, count: 3, radius: [2400, 3200], yawDeg: [-180, 180], angle: (rng, i, base) => base + (i * TAU) / 3 + jitter(rng, 25) },
  // ring 3: four crystal walls, 90° apart ± 20°
  { kind: 'crystal_spire', ring: 3, count: 4, radius: [5000, 7200], yawDeg: [-35, 35], angle: (rng, i, base) => base + (i * TAU) / 4 + jitter(rng, 20) },
  // ring 4: two extinguished forges on opposite sides ± 15°
  { kind: 'dead_forge', ring: 4, count: 2, radius: [9000, 11000], yawDeg: [-180, 180], angle: (rng, i, base) => base + i * Math.PI + jitter(rng, 15) },
];

/** A relay mast closer than this (bearing, rad) to Echo-0 is turned away – two beacons in one spot read as one. */
const ECHO_CLEARANCE = 30 * DEG;

const angleDiff = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** The gas giant as a site (fixed: it is the home compass, visible from all of ring 1). */
export const gasGiantSite = (): LandmarkSite => ({ id: 'gas_giant:0', kind: 'gas_giant', pos: { ...GAS_GIANT_ANCHOR }, yaw: 0, ring: 1 });

function placeRule(seed: number, rule: LandmarkRule, ruleIndex: number, out: LandmarkSite[]): void {
  const rng = createRng(hash3(seed ^ LANDMARK_SALT, ruleIndex + 1, 0));
  const base = rng() * TAU;
  const echo0 = echoSites(seed)[0];
  const echoBearing = echo0 ? Math.atan2(echo0.pos.y, echo0.pos.x) : null;
  for (let i = 0; i < rule.count; i++) {
    let angle = rule.angle(rng, i, base);
    // only the ring-1 mast shares a ring with Echo-0 (950 u) – keep their bearings apart
    if (rule.kind === 'guild_relay' && echoBearing !== null && ECHOES[0].ring === rule.ring) {
      for (let k = 0; k < 8 && angleDiff(angle, echoBearing) < ECHO_CLEARANCE; k++) angle = rule.angle(rng, i, base);
      if (angleDiff(angle, echoBearing) < ECHO_CLEARANCE) {
        // still too close after the retries: step away from the echo, staying in the eastern half
        angle = echoBearing + (Math.sin(angle - echoBearing) >= 0 ? 1 : -1) * ECHO_CLEARANCE;
        angle = Math.max(-70 * DEG, Math.min(70 * DEG, Math.atan2(Math.sin(angle), Math.cos(angle))));
      }
    }
    const r = rule.radius[0] + rng() * (rule.radius[1] - rule.radius[0]);
    const yaw = (rule.yawDeg[0] + rng() * (rule.yawDeg[1] - rule.yawDeg[0])) * DEG;
    out.push({ id: `${rule.kind}:${i}`, kind: rule.kind, pos: { x: Math.cos(angle) * r, y: Math.sin(angle) * r }, yaw, ring: rule.ring });
  }
}

const cache = new Map<number, readonly LandmarkSite[]>();

/** Every landmark of the world for this seed (deterministic, cached; do not mutate). */
export function landmarkSites(seed: number): readonly LandmarkSite[] {
  const hit = cache.get(seed);
  if (hit) return hit;
  const out: LandmarkSite[] = [gasGiantSite()];
  LANDMARK_RULES.forEach((rule, i) => placeRule(seed, rule, i, out));
  if (cache.size > 16) cache.clear();
  cache.set(seed, out);
  return out;
}

/** Sites within `radius` of `pos` on the plane. */
export const landmarksNear = (sites: readonly LandmarkSite[], pos: Vec2, radius: number): LandmarkSite[] =>
  sites.filter((s) => Math.hypot(s.pos.x - pos.x, s.pos.y - pos.y) <= radius);
