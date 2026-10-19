// Fixed pirate places derived from the seed (design 5.3 / 6.5): Rust fortresses in ring 2 and one
// clan beacon (clan challenge, 6.3) in front of each. Pure functions of the seed, cached per seed.
import { FORTRESS } from '../../data/pirates';
import layouts from '../../data/fortress_layouts.json';
import { TAU } from '../math/angle';
import { createRng } from '../math/rng';
import { add, length, rotate, scale, type Vec2 } from '../math/vec2';
import type { Circle } from '../physics/collide';
import { poisNear, echoSites } from '../discovery/poi';
import { CHUNK_SIZE, chunkCoord } from '../world/chunks';
import { generateChunk } from '../world/generate';
import { hash3 } from '../world/hash';
import { stationsInArea } from '../world/stations';

export interface FortressLayout {
  circles: { x: number; y: number; r: number }[];
  spawn: { x: number; y: number };
  turrets: { x: number; y: number; z: number; yawDeg: number }[];
  shieldGens: { x: number; y: number }[];
  core: { x: number; y: number; z: number };
  clearRadius: number;
}

/** Copy of art/blender/data/fortress_layouts.json (the model must fit it). */
export const FORTRESS_LAYOUT: FortressLayout = layouts.hrdzava_pevnost;

export interface FortressSite {
  /** `fort:<i>` */
  id: string;
  index: number;
  pos: Vec2;
  /** Front (+X of the model, spawn bay) faces home. */
  angle: number;
  /** Clan beacon in front of the fortress. */
  beacon: { id: string; pos: Vec2 };
}

const SITE_SALT = 0xf047_0e55;

/** A point in the fortress frame → world. */
export const fortressToWorld = (site: Pick<FortressSite, 'pos' | 'angle'>, local: { x: number; y: number }): Vec2 =>
  add(site.pos, rotate(local, site.angle));

function clear(seed: number, p: Vec2, radius: number): boolean {
  const c0 = chunkCoord(p.x - radius);
  const c1 = chunkCoord(p.x + radius);
  const r0 = chunkCoord(p.y - radius);
  const r1 = chunkCoord(p.y + radius);
  for (let cx = c0; cx <= c1; cx++) {
    for (let cy = r0; cy <= r1; cy++) {
      for (const a of generateChunk(seed, cx, cy).asteroids) {
        if (Math.hypot(a.pos.x - p.x, a.pos.y - p.y) < radius + a.baseRadius) return false;
      }
    }
  }
  const s = stationsInArea(seed, chunkCoord(p.x) - 3, chunkCoord(p.x) + 3, chunkCoord(p.y) - 3, chunkCoord(p.y) + 3);
  if (s.some((st) => Math.hypot(st.pos.x - p.x, st.pos.y - p.y) < st.clearRadius + radius + 250)) return false;
  if (poisNear(seed, p, radius + 80).length > 0) return false;
  return echoSites(seed).every((e) => Math.hypot(e.pos.x - p.x, e.pos.y - p.y) > 400);
}

/** First clear spot on a spiral around `p` (or `p` itself when nothing is clear). */
function clearSpot(seed: number, p: Vec2, radius: number, step: number, tries: number): Vec2 {
  for (let i = 0; i < tries; i++) {
    const a = i * 2.39996;
    const r = step * Math.sqrt(i);
    const q = { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r };
    if (clear(seed, q, radius)) return q;
  }
  return p;
}

const cache = new Map<number, FortressSite[]>();

/** Fortresses of the seed (always `FORTRESS.count`, evenly around ring 2). */
export function fortressSites(seed: number): FortressSite[] {
  const hit = cache.get(seed);
  if (hit) return hit;
  const rng = createRng(hash3(seed ^ SITE_SALT, 0, 0));
  const base = rng() * TAU;
  const out: FortressSite[] = [];
  for (let i = 0; i < FORTRESS.count; i++) {
    const a = base + (i * TAU) / FORTRESS.count + (rng() - 0.5) * 0.6;
    const [lo, hi] = FORTRESS.distance;
    const d = lo + rng() * (hi - lo);
    const pos = clearSpot(seed, { x: Math.cos(a) * d, y: Math.sin(a) * d }, FORTRESS_LAYOUT.clearRadius, 60, 120);
    const angle = Math.atan2(-pos.y, -pos.x);
    const dir = scale(pos, -1 / Math.max(1, length(pos)));
    const beacon = clearSpot(seed, add(pos, scale(dir, 260)), 12, 25, 60);
    out.push({ id: `fort:${i}`, index: i, pos, angle, beacon: { id: `beacon:${i}`, pos: beacon } });
  }
  if (cache.size > 16) cache.clear();
  cache.set(seed, out);
  return out;
}

export const fortressById = (seed: number, id: string): FortressSite | null => fortressSites(seed).find((f) => f.id === id) ?? null;

/** Fortress sites near a point. */
export const fortressesNear = (seed: number, pos: Vec2, radius: number): FortressSite[] =>
  fortressSites(seed).filter((f) => Math.hypot(f.pos.x - pos.x, f.pos.y - pos.y) <= radius + FORTRESS_LAYOUT.clearRadius);

/** World collision circles of a fortress (the rock, bay, generators and turret brackets). */
export function fortressCircles(site: FortressSite): Circle[] {
  return FORTRESS_LAYOUT.circles.map((c) => ({ pos: fortressToWorld(site, c), radius: c.r }));
}

/** Chunk of the fortress (for the map and contracts). */
export const fortressChunk = (site: FortressSite): { cx: number; cy: number } => ({ cx: Math.floor(site.pos.x / CHUNK_SIZE), cy: Math.floor(site.pos.y / CHUNK_SIZE) });
