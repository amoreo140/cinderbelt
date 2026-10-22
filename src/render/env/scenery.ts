// Batch A scenery (art/README §2.7.22): the manifest `models/scenery/scenery.json` and the pure
// selection / placement rules built on it – which far silhouette a depth-layer instance shows per
// ring. No three.js here, so the rules are unit tested; the views (DepthLayers, AsteroidDust) only
// apply them.
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
  rubble: { scale: readonly [number, number] };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number');

/** Validates the manifest (null = unusable: the layers fall back to nothing rather than crash). */
export function parseSceneryManifest(json: unknown): SceneryManifest | null {
  if (!isObject(json) || !isObject(json.sets) || !isObject(json.depth) || !isObject(json.rubble)) return null;
  const sets: Record<string, ScenerySetDef> = {};
  for (const [id, raw] of Object.entries(json.sets)) {
    if (id === 'bed') continue; // the retired belt-bed set (bed_rocks.glb is no longer loaded)
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
  const rubble = json.rubble;
  return {
    sets,
    depth: { mix, setScale, rockTint },
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

/** The four depth-layer GLBs (every set except the rubble). */
export function depthSetIds(manifest: SceneryManifest): string[] {
  const ids = new Set<string>();
  for (const layers of Object.values(manifest.depth.mix)) for (const l of layers) for (const set of Object.keys(l)) ids.add(set);
  return [...ids];
}

/** Rubble chip mesh of an asteroid's `i`-th chip (art/README: `rand(seed, i + 77)`). */
export const rubbleIndex = (u: number, meshes: number): number => Math.min(meshes - 1, Math.floor(u * meshes));
