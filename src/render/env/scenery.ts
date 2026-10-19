// Batch A scenery (art/README §2.7.22): the manifest `models/scenery/scenery.json` and the pure
// selection / placement rules built on it – which far silhouette a depth-layer instance shows per
// ring, and where the render-only belt-bed rocks lie under an asteroid field. No three.js here, so
// the rules are unit tested; the views (DepthLayers, AsteroidDust, BeltBed) only apply them.
import { createRng } from '../../sim/math/rng';
import { hashString } from '../traffic/schedule';

export interface SceneryMeshDef {
  name: string;
  kind: string;
  tris: number;
  /** glTF extents at unit radius. */
  size: readonly [number, number, number];
  resource?: string;
}

export interface ScenerySetDef {
  file: string;
  root: string;
  ring: number | 'all';
  meshes: readonly SceneryMeshDef[];
}

export interface BedDef {
  radius: readonly [number, number];
  count: readonly [number, number];
  depthBelowPlane: readonly [number, number];
  haze: number;
  northShiftPerDepth: number;
  meshesByResource: Readonly<Record<string, readonly string[]>>;
}

export interface SceneryManifest {
  sets: Readonly<Record<string, ScenerySetDef>>;
  depth: {
    /** mix[ring][layer] = share of each set (sums to 1). */
    mix: Readonly<Record<string, readonly Readonly<Record<string, number>>[]>>;
    /** Per-set multiplier of the layer scale (a unit-radius mesh has less area than the old lumpy sphere). */
    setScale: Readonly<Record<string, number>>;
    /** Optional per-ring instance colour of the neutral rocks (`#RRGGBB`). */
    rockTint: Readonly<Record<string, string>>;
  };
  bed: BedDef;
  rubble: { scale: readonly [number, number] };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number');

/** Validates the manifest (null = unusable: the layers fall back to nothing rather than crash). */
export function parseSceneryManifest(json: unknown): SceneryManifest | null {
  if (!isObject(json) || !isObject(json.sets) || !isObject(json.depth) || !isObject(json.bed) || !isObject(json.rubble)) return null;
  const sets: Record<string, ScenerySetDef> = {};
  for (const [id, raw] of Object.entries(json.sets)) {
    if (!isObject(raw) || typeof raw.file !== 'string' || !Array.isArray(raw.meshes)) return null;
    const meshes = raw.meshes.filter((m): m is SceneryMeshDef => isObject(m) && typeof m.name === 'string');
    if (meshes.length === 0) return null;
    sets[id] = { file: raw.file, root: typeof raw.root === 'string' ? raw.root : '', ring: raw.ring === 'all' ? 'all' : Number(raw.ring), meshes };
  }
  const depth = json.depth;
  if (!isObject(depth.mix) || !isObject(depth.setScale)) return null;
  const mix: Record<string, Record<string, number>[]> = {};
  for (const [ring, layers] of Object.entries(depth.mix)) {
    if (!Array.isArray(layers)) return null;
    mix[ring] = layers.map((l) => {
      const out: Record<string, number> = {};
      if (isObject(l)) for (const [set, share] of Object.entries(l)) if (typeof share === 'number' && share > 0 && sets[set]) out[set] = share;
      return out;
    });
  }
  const setScale: Record<string, number> = {};
  for (const [set, s] of Object.entries(depth.setScale)) if (typeof s === 'number') setScale[set] = s;
  const rockTint: Record<string, string> = {};
  if (isObject(depth.rockTint)) for (const [ring, c] of Object.entries(depth.rockTint)) if (typeof c === 'string') rockTint[ring] = c;
  const bed = json.bed;
  if (!isPair(bed.radius) || !isPair(bed.count) || !isPair(bed.depthBelowPlane) || !isObject(bed.meshesByResource)) return null;
  const meshesByResource: Record<string, string[]> = {};
  for (const [res, names] of Object.entries(bed.meshesByResource)) if (Array.isArray(names)) meshesByResource[res] = names.filter((n): n is string => typeof n === 'string');
  const rubble = json.rubble;
  return {
    sets,
    depth: { mix, setScale, rockTint },
    bed: {
      radius: bed.radius,
      count: bed.count,
      depthBelowPlane: bed.depthBelowPlane,
      haze: typeof bed.haze === 'number' ? bed.haze : 0.3,
      northShiftPerDepth: typeof bed.northShiftPerDepth === 'number' ? bed.northShiftPerDepth : 0.7,
      meshesByResource,
    },
    rubble: { scale: isPair(rubble.scale) ? rubble.scale : [0.09, 0.7] },
  };
}

/** The key of a share table at `u` (0..1) – cumulative over the shares in their manifest order. */
export function pickShare(shares: Readonly<Record<string, number>>, u: number): string | null {
  const keys = Object.keys(shares);
  if (keys.length === 0) return null;
  let total = 0;
  for (const k of keys) total += shares[k]!;
  let r = u * total;
  for (const k of keys) {
    r -= shares[k]!;
    if (r < 0) return k;
  }
  return keys[keys.length - 1]!;
}

export interface DepthPick {
  set: string;
  mesh: string;
}

/**
 * The silhouette of one depth-layer instance in a ring: the set by `mix[ring][layer]` at `uSet`,
 * then a mesh of that set at `uMesh` (both 0..1, fixed per instance – so the same instance shows
 * the same rock every time the player is back in that ring). `bias` multiplies the share of a set
 * (a sector environment: more scrap in a wreck yard, fewer crystals on a comet trail).
 */
export function depthPick(
  manifest: SceneryManifest,
  ring: number,
  layer: number,
  uSet: number,
  uMesh: number,
  bias?: Readonly<Record<string, number>>,
): DepthPick | null {
  const layers = manifest.depth.mix[String(ring)] ?? manifest.depth.mix['1'];
  let shares = layers?.[Math.min(layer, layers.length - 1)];
  if (shares && bias && Object.keys(bias).length > 0) {
    const biased: Record<string, number> = {};
    for (const [k, v] of Object.entries(shares)) biased[k] = v * (bias[k] ?? 1);
    shares = biased;
  }
  const set = shares ? pickShare(shares, uSet) : null;
  const def = set ? manifest.sets[set] : undefined;
  if (!set || !def) return null;
  const mesh = def.meshes[Math.min(def.meshes.length - 1, Math.floor(uMesh * def.meshes.length))]!;
  return { set, mesh: mesh.name };
}

/** The four depth-layer GLBs (every set except the bed and the rubble). */
export function depthSetIds(manifest: SceneryManifest): string[] {
  const ids = new Set<string>();
  for (const layers of Object.values(manifest.depth.mix)) for (const l of layers) for (const set of Object.keys(l)) ids.add(set);
  return [...ids];
}

// ---------------------------------------------------------------------------------------------
// Belt beds: non-minable rocks deep under each asteroid field.

/** The asteroid data a field is derived from (a subset of the sim's Asteroid). */
export interface FieldRock {
  id: string;
  pos: { x: number; y: number };
  baseRadius: number;
  resource: string;
}

export interface BeltField {
  /** Stable id: the chunk and the lowest asteroid index of the field. */
  id: string;
  /** Centre on the game plane (sim coordinates). */
  center: { x: number; y: number };
  /** Footprint radius (rock centres + their radius). */
  radius: number;
  /** The field's resource: the one with the most rock (radius²). */
  resource: string;
  rocks: number;
  /** The field's asteroids (sim position, radius) – bed rocks keep out from under them. */
  members?: readonly { x: number; y: number; r: number }[];
}

/** Two asteroids of one chunk this close (centre to centre) belong to the same field. */
export const FIELD_LINK = 26;
/** A field needs this many asteroids to get a bed. */
export const FIELD_MIN_ROCKS = 4;

const chunkOf = (id: string): string => {
  const i = id.indexOf(':');
  return i < 0 ? id : id.slice(0, i);
};
const indexOf = (id: string): number => {
  const i = id.indexOf(':');
  return i < 0 ? 0 : Number.parseInt(id.slice(i + 1), 10) || 0;
};

/**
 * Asteroid fields: the asteroids of each chunk joined by single-link distance (`link`). The world
 * generator places each cluster inside its chunk and ids carry the chunk (`cx,cy:index`), so a field
 * never spans chunks. Deterministic: the result depends only on the rocks given (order-independent).
 */
export function beltFields(rocks: readonly FieldRock[], link = FIELD_LINK): BeltField[] {
  const byChunk = new Map<string, FieldRock[]>();
  for (const r of rocks) {
    const k = chunkOf(r.id);
    let list = byChunk.get(k);
    if (!list) byChunk.set(k, (list = []));
    list.push(r);
  }
  const fields: BeltField[] = [];
  for (const [chunk, unsorted] of [...byChunk].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const list = [...unsorted].sort((a, b) => indexOf(a.id) - indexOf(b.id) || (a.id < b.id ? -1 : 1));
    // union–find over the pairs closer than `link`
    const parent = list.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
      return i;
    };
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const dx = list[i]!.pos.x - list[j]!.pos.x;
        const dy = list[i]!.pos.y - list[j]!.pos.y;
        if (dx * dx + dy * dy <= link * link) {
          const a = find(i);
          const b = find(j);
          if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
        }
      }
    }
    const groups = new Map<number, FieldRock[]>();
    for (let i = 0; i < list.length; i++) {
      const root = find(i);
      let g = groups.get(root);
      if (!g) groups.set(root, (g = []));
      g.push(list[i]!);
    }
    for (const g of groups.values()) {
      let cx = 0;
      let cy = 0;
      const mass = new Map<string, number>();
      for (const r of g) {
        cx += r.pos.x;
        cy += r.pos.y;
        mass.set(r.resource, (mass.get(r.resource) ?? 0) + r.baseRadius * r.baseRadius);
      }
      cx /= g.length;
      cy /= g.length;
      let radius = 0;
      for (const r of g) radius = Math.max(radius, Math.hypot(r.pos.x - cx, r.pos.y - cy) + r.baseRadius);
      let resource = g[0]!.resource;
      for (const [res, m] of [...mass].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (m > (mass.get(resource) ?? 0)) resource = res;
      fields.push({ id: `${chunk}:${indexOf(g[0]!.id)}`, center: { x: cx, y: cy }, radius, resource, rocks: g.length, members: g.map((r) => ({ x: r.pos.x, y: r.pos.y, r: r.baseRadius })) });
    }
  }
  return fields;
}

export interface BedRock {
  mesh: string;
  /** World position (three.js: x, y = height below the plane (negative), z = −sim y). */
  x: number;
  y: number;
  z: number;
  /** Instance scale = world radius (the meshes are unit radius). */
  scale: number;
  yaw: number;
  tiltX: number;
  tiltZ: number;
}

/** Tops of the bed rocks stay at least this far below the gameplay plane. */
export const BED_TOP_CLEARANCE = 3;
/**
 * A bed rock keeps its (unshifted) centre this share of its radius plus the asteroid's radius away
 * from every asteroid of the field: the north shift puts it on screen where its unshifted centre is,
 * and one right under a minable rock read as a part of it (a giant rock).
 */
export const BED_KEEP_OUT = 0.7;
/** Largest tilt of a bed rock (rad) – the lit top (glTF +Y) side stays up. */
export const BED_MAX_TILT = (25 * Math.PI) / 180;

/**
 * The bed rocks of one field: `count` 3–8 by the field's size (× `density` of the graphics
 * quality), radius 4–10, 4–30 below the plane with the top ≥ 3 below and bigger rocks deeper,
 * spread over the footprint (+30 %) and shifted north by 0.7 × depth so they sit under the field
 * from the default camera; free yaw, tilt ≤ 25°. Deterministic from the field id.
 */
export function bedRocks(field: BeltField, bed: BedDef, density = 1): BedRock[] {
  if (field.rocks < FIELD_MIN_ROCKS || density <= 0) return [];
  const names = bed.meshesByResource[field.resource] ?? bed.meshesByResource.iron ?? [];
  if (names.length === 0) return [];
  const rng = createRng(hashString(`bed:${field.id}`));
  const [cMin, cMax] = bed.count;
  const size = Math.min(1, Math.max(0, (field.radius - 12) / 36));
  const full = Math.round(cMin + (cMax - cMin) * size + (rng() - 0.5) * 2);
  const count = Math.max(0, Math.min(cMax, Math.round(Math.max(cMin, full) * density)));
  const [rMin, rMax] = bed.radius;
  const [dMin, dMax] = bed.depthBelowPlane;
  const spread = field.radius * 1.3;
  const out: BedRock[] = [];
  for (let i = 0; i < count; i++) {
    // every value is drawn for each rock (a rejected spot does not shift the rest)
    const uR = rng();
    const uD = rng();
    const uMesh = rng();
    const yaw = rng() * Math.PI * 2;
    const tiltAng = rng() * Math.PI * 2;
    const tilt = rng() * BED_MAX_TILT;
    const radius = rMin + (rMax - rMin) * Math.pow(uR, 1.4);
    // bigger rocks deeper: the floor of the band rises with the radius
    const lo = Math.max(dMin, radius + BED_TOP_CLEARANCE);
    // biased deep: a shallow bed rock under a minable one reads as a part of it
    const depth = Math.min(dMax, lo + (dMax - lo) * (0.25 * (radius - rMin) / (rMax - rMin) + 0.75 * Math.pow(uD, 0.6)));
    let px = 0;
    let py = 0;
    let placed = false;
    for (let attempt = 0; attempt < 10 && !placed; attempt++) {
      const ang = rng() * Math.PI * 2;
      const dist = Math.sqrt(rng()) * spread;
      px = field.center.x + Math.cos(ang) * dist;
      py = field.center.y + Math.sin(ang) * dist;
      placed = out.every((o) => {
        const dx = o.x - px;
        // compared before the north shift (o.y = −depth): the unshifted z of `o` is o.z − shift·o.y
        const dz = o.z - bed.northShiftPerDepth * o.y + py;
        const dy = o.y + depth;
        return Math.hypot(dx, dy, dz) > (o.scale + radius) * 0.85;
      });
      if (placed && field.members) placed = field.members.every((m) => Math.hypot(m.x - px, m.y - py) > m.r + radius * BED_KEEP_OUT);
    }
    if (!placed) continue;
    out.push({
      mesh: names[Math.min(names.length - 1, Math.floor(uMesh * names.length))]!,
      x: px,
      y: -depth,
      z: -py - bed.northShiftPerDepth * depth,
      scale: radius,
      yaw,
      tiltX: Math.cos(tiltAng) * tilt,
      tiltZ: Math.sin(tiltAng) * tilt,
    });
  }
  return out;
}

/**
 * Is a bed rock clear of every given asteroid (its unshifted centre ≥ asteroid radius + BED_KEEP_OUT ×
 * its radius away)? The views drop bed rocks that sit under a rock of a neighbouring field or chunk.
 */
export function bedRockClear(rock: BedRock, northShiftPerDepth: number, asteroids: readonly { pos: { x: number; y: number }; baseRadius: number }[]): boolean {
  const x = rock.x;
  const y = -(rock.z - northShiftPerDepth * rock.y);
  for (const a of asteroids) {
    const reach = a.baseRadius + rock.scale * BED_KEEP_OUT;
    const dx = a.pos.x - x;
    const dy = a.pos.y - y;
    if (dx * dx + dy * dy <= reach * reach) return false;
  }
  return true;
}

/** Rubble chip mesh of an asteroid's `i`-th chip (art/README: `rand(seed, i + 77)`). */
export const rubbleIndex = (u: number, meshes: number): number => Math.min(meshes - 1, Math.floor(u * meshes));
