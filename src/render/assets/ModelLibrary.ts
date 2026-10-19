import { BufferAttribute, BufferGeometry, Mesh, type InterleavedBufferAttribute, type Material, type Object3D } from 'three';
import { ASTEROID_MODEL_BOUNDS } from '../../data/asteroids';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PART_IDS, type PartId } from '../../data/parts';
import { RESOURCE_IDS, type ResourceId } from '../../data/resources';
import { STATION_LAYOUTS, type StationModel } from '../../data/stations';
import {
  asteroidModelPaths,
  CONNECTOR_PATHS,
  DOCK_CLAMP_PATH,
  HANGAR_PATH,
  partModelPath,
  PART_TIERS,
  stationModelPath,
  type ConnectorKind,
  type PartTier,
} from './catalog';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ClanParts, CLAN_MANIFEST_PATH, type ClanManifest } from './clanParts';
import { createModelLoader, guardPaletteMaterials, PALETTE_KINDS, restorePaletteBaseColor, sharedPalette } from './gltf';
import { prefetched, responseBytes } from './prefetch';
import { assetUrl } from './url';

/** Merged asteroid model: geometry centred and with unit radius. */
export interface AsteroidModel {
  /** File name without the extension, e.g. `asteroid_iron_a` (the simulation picks the model by it). */
  name: string;
  geometry: BufferGeometry;
  material: Material;
  /** The geometry has vertex colours (AO and facet shading from Blender). */
  vertexColors: boolean;
  /**
   * The model has veins: attributes `veinIndex` (vein index Vein_<i>, −1 = rock) and `veinU`
   * (TEXCOORD_1.u – position along the vein) for the active-segment shader.
   */
  veins: boolean;
}

export type LoadProgress = (loaded: number, total: number) => void;

export { assetUrl };

/** Downloads in flight by path: layers that ask for the same model at once share one download. */
const inFlight = new Map<string, Promise<ArrayBuffer | null>>();

async function download(path: string): Promise<ArrayBuffer | null> {
  const url = assetUrl(path);
  // the boot list downloads ahead of the game (prefetch.ts)
  return prefetched(url) ?? responseBytes(await fetch(url));
}

/**
 * Downloads a file, or null when it does not exist (the Vite dev server answers a missing file with
 * index.html and status 200, so HTML counts as missing). Callers that ask for one path while it is
 * still downloading share the download (several layers load the same traffic and hangar models at the
 * game start – audit 2026-10-17, P10); each gets its own copy of the bytes.
 */
export function fetchAsset(path: string): Promise<ArrayBuffer | null> {
  const shared = inFlight.get(path);
  if (shared) return shared.then((data) => data && data.slice(0));
  const p = download(path).finally(() => inFlight.delete(path));
  inFlight.set(path, p);
  // through a `then` of its own like the sharing callers: their copies exist before this caller's code
  // runs (and could transfer the bytes to a worker)
  return p.then((data) => data);
}

const ASTEROID_ATTRIBUTES = ['position', 'normal', 'uv', 'veinIndex', 'veinU'];
const VEIN_NODE = /^Vein_(\d+)$/;
/** Vertex colours are kept if all parts have them (mergeGeometries wants the same attributes). */
const ASTEROID_COLOR = 'color';

/** Emission of parts from Blender is too strong in the game with bloom – we dampen it. */
const PART_EMISSIVE_SCALE = 0.45;

function scaleEmission(scene: Object3D, scale: number): void {
  const seen = new Set<Material>();
  scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (seen.has(m) || !('emissiveIntensity' in m)) continue;
      seen.add(m);
      (m as Material & { emissiveIntensity: number }).emissiveIntensity *= scale;
    }
  });
}

/**
 * Quantised (KHR_mesh_quantization) or interleaved attributes → Float32. A merged asteroid has the
 * same types as before the model optimisation (mergeGeometries wants matching array types).
 */
export function toFloatAttributes(geometry: BufferGeometry): BufferGeometry {
  for (const [name, attr] of Object.entries(geometry.attributes) as [string, BufferAttribute | InterleavedBufferAttribute][]) {
    if (attr instanceof BufferAttribute && attr.array instanceof Float32Array && !attr.normalized) continue;
    const size = attr.itemSize;
    const out = new Float32Array(attr.count * size);
    for (let i = 0; i < attr.count; i++) {
      out[i * size] = attr.getX(i);
      if (size > 1) out[i * size + 1] = attr.getY(i);
      if (size > 2) out[i * size + 2] = attr.getZ(i);
      if (size > 3) out[i * size + 3] = attr.getW(i);
    }
    geometry.setAttribute(name, new BufferAttribute(out, size));
  }
  return geometry;
}

/** Vein attributes: vein index (−1 = rock) and u along its length (from TEXCOORD_1). */
function addVeinAttributes(geometry: BufferGeometry, veinIndex: number): void {
  const count = geometry.getAttribute('position').count;
  const index = new Float32Array(count).fill(veinIndex);
  const u = new Float32Array(count);
  const uv1 = geometry.getAttribute('uv1');
  if (veinIndex >= 0 && uv1) for (let i = 0; i < count; i++) u[i] = uv1.getX(i);
  geometry.setAttribute('veinIndex', new BufferAttribute(index, 1));
  geometry.setAttribute('veinU', new BufferAttribute(u, 1));
}

/**
 * All meshes of the scene into one geometry, centred and scaled to radius 1. The centre and radius
 * come from the simulation table (data/asteroid_models.json), so the veins lie exactly where it computes them.
 */
function mergeAsteroid(name: string, scene: Object3D): AsteroidModel | null {
  scene.updateMatrixWorld(true);
  const parts: BufferGeometry[] = [];
  let material: Material | null = null;
  let veins = false;
  scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    material ??= Array.isArray(o.material) ? o.material[0] : o.material;
    const geometry = toFloatAttributes((o.geometry as BufferGeometry).clone()).applyMatrix4(o.matrixWorld);
    const vein = VEIN_NODE.exec(o.name);
    if (vein) veins = true;
    addVeinAttributes(geometry, vein ? Number(vein[1]) : -1);
    parts.push(geometry);
  });
  const vertexColors = parts.length > 0 && parts.every((g) => g.getAttribute(ASTEROID_COLOR) !== undefined);
  const keep = vertexColors ? [...ASTEROID_ATTRIBUTES, ASTEROID_COLOR] : ASTEROID_ATTRIBUTES;
  for (const g of parts) for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
  if (parts.length === 0 || !material) return null;
  // mergeGeometries requires either all indexed or none
  const mixed = parts.some((g) => g.index) && parts.some((g) => !g.index);
  const merged = mergeGeometries(mixed ? parts.map((g) => (g.index ? g.toNonIndexed() : g)) : parts, false);
  if (!merged) return null;
  merged.computeBoundingSphere();
  const sphere = merged.boundingSphere!;
  const known = ASTEROID_MODEL_BOUNDS[name];
  const [cx, cy, cz] = known ? known.center : [sphere.center.x, sphere.center.y, sphere.center.z];
  const radius = known ? known.radius : sphere.radius;
  if (known && Math.abs(known.radius - sphere.radius) > 1e-3 * known.radius) {
    console.warn(`Model ${name} does not match data/asteroid_models.json – regenerate the table (UPDATE_ASSET_DATA=1 npm test)`);
  }
  merged.translate(-cx, -cy, -cz);
  merged.scale(1 / radius, 1 / radius, 1 / radius);
  merged.computeBoundingSphere();
  return { name, geometry: merged, material, vertexColors, veins };
}

/**
 * One model through the game's loader (meshopt + shared atlas), emission toned down for parts.
 * Never throws: a missing or broken file logs and returns null (→ placeholder or fallback model).
 */
export async function loadModelScene(loader: GLTFLoader, path: string): Promise<Object3D | null> {
  try {
    const data = await fetchAsset(path);
    if (!data) {
      console.warn(`Model missing: ${path} – using a placeholder`);
      return null;
    }
    const gltf = await loader.parseAsync(data, assetUrl(path).replace(/[^/]*$/, ''));
    if (guardPaletteMaterials(gltf.scene) > 0) console.warn(`Model ${path}: AF_Palette atlas missing – no emission`);
    if ((await restorePaletteBaseColor(gltf.scene)) > 0) console.warn(`Model ${path}: AF_Palette base colour map missing – bound the shared atlas`);
    if (!path.includes('/asteroids/')) scaleEmission(gltf.scene, PART_EMISSIVE_SCALE);
    return gltf.scene;
  } catch (e) {
    console.warn(`Model failed to load: ${path} – using a placeholder`, e);
    return null;
  }
}

/**
 * Palette swatch table (SL2 E1 hull shell, written by the art `liveries` stage, art/README.md "Hull
 * shell"): swatch key → UV of the swatch centre in the shared AF_Palette atlas. The shell takes its
 * colours from it – code never hard-codes the atlas size.
 */
export const PALETTE_SWATCHES_PATH = 'assets/textures/palette_swatches.json';

export type SwatchTable = ReadonlyMap<string, readonly [number, number]>;

/**
 * Reads `{ "_schema": …, "swatches": { "<key>": [u, v], … } }`; entries that are not two finite numbers
 * are skipped. Null = not a swatch file (or no valid entry).
 */
export function parseSwatches(json: unknown): SwatchTable | null {
  const swatches = typeof json === 'object' && json !== null ? (json as { swatches?: unknown }).swatches : undefined;
  if (typeof swatches !== 'object' || swatches === null || Array.isArray(swatches)) return null;
  const out = new Map<string, readonly [number, number]>();
  for (const [key, uv] of Object.entries(swatches as Record<string, unknown>)) {
    if (Array.isArray(uv) && uv.length === 2 && uv.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      out.set(key, [uv[0] as number, uv[1] as number]);
    }
  }
  return out.size > 0 ? out : null;
}

/** Loads the swatch table; a missing or broken file → null with one console warning (the shell stays off). */
async function loadSwatches(): Promise<SwatchTable | null> {
  try {
    const data = await fetchAsset(PALETTE_SWATCHES_PATH);
    const table = data ? parseSwatches(JSON.parse(new TextDecoder().decode(data))) : null;
    if (!table) console.warn(`${PALETTE_SWATCHES_PATH} missing or invalid – the hull shell is off`);
    return table;
  } catch (e) {
    console.warn(`${PALETTE_SWATCHES_PATH} failed to load – the hull shell is off`, e);
    return null;
  }
}

/** Clan part sets loaded lazily through the same loader (pirate ships, render/assets/clanParts.ts). */
function clanPartsFor(loader: GLTFLoader): ClanParts {
  return new ClanParts(
    (path) => loadModelScene(loader, path),
    async () => {
      const data = await fetchAsset(CLAN_MANIFEST_PATH);
      return data ? (JSON.parse(new TextDecoder().decode(data)) as ClanManifest) : null;
    },
  );
}

/** Models from Blender (public/assets/models). A missing model = null → placeholder shape. */
export class ModelLibrary {
  private constructor(
    private readonly parts: ReadonlyMap<string, Object3D>,
    private readonly connectors: ReadonlyMap<ConnectorKind, Object3D>,
    private readonly rocks: ReadonlyMap<ResourceId, AsteroidModel[]>,
    private readonly stations: ReadonlyMap<StationModel, Object3D> = new Map(),
    private readonly clamp: Object3D | null = null,
    private readonly hangarPlatform: Object3D | null = null,
    /** Pirate clan part sets (lazy; the empty library never loads them). */
    readonly clans: ClanParts = new ClanParts(null, null),
    /** Palette swatch UVs (hull shell); null = no table → no shell. */
    private readonly swatches: SwatchTable | null = null,
  ) {}

  /**
   * A library without models – everything is drawn with placeholders. `swatches` = a swatch table for
   * tests of the hull shell (the shell needs one).
   */
  static empty(swatches: SwatchTable | null = null): ModelLibrary {
    return new ModelLibrary(new Map(), new Map(), new Map(), new Map(), null, null, new ClanParts(null, null), swatches);
  }

  /** Number of files load() loads (for the progress indicator). */
  static fileCount(): number {
    return PART_IDS.length * PART_TIERS.length + Object.keys(CONNECTOR_PATHS).length +
      RESOURCE_IDS.reduce((n, id) => n + asteroidModelPaths(id).length, 0) +
      Object.keys(STATION_LAYOUTS).length + 2;
  }

  /** Loads all models in parallel; never fails (missing models are only logged). */
  static async load(onProgress?: LoadProgress): Promise<ModelLibrary> {
    const loader = createModelLoader();
    // the shared atlas first: every model's parse waits for it (perf O14)
    for (const kind of PALETTE_KINDS) void sharedPalette(kind);
    const total = ModelLibrary.fileCount();
    let loaded = 0;
    onProgress?.(0, total);

    const loadScene = async (path: string): Promise<Object3D | null> => {
      try {
        return await loadModelScene(loader, path);
      } finally {
        onProgress?.(++loaded, total);
      }
    };

    const partModels = PART_IDS.flatMap((id) => PART_TIERS.map((tier) => ({ id, tier })));
    const connectorKinds = Object.keys(CONNECTOR_PATHS) as ConnectorKind[];
    const stationModels = Object.keys(STATION_LAYOUTS) as StationModel[];
    // each asteroid is merged as soon as it loads, not all of them after the last download (perf O14)
    const loadRock = async (path: string): Promise<AsteroidModel | null> => {
      const scene = await loadScene(path);
      return scene && mergeAsteroid(path.replace(/^.*\//, '').replace(/\.glb$/, ''), scene);
    };
    const [partScenes, connectorScenes, rockModels, stationScenes, clamp, hangar, swatches] = await Promise.all([
      Promise.all(partModels.map(({ id, tier }) => loadScene(partModelPath(id, tier)))),
      Promise.all(connectorKinds.map((kind) => loadScene(CONNECTOR_PATHS[kind]))),
      Promise.all(RESOURCE_IDS.map((id) => Promise.all(asteroidModelPaths(id).map(loadRock)))),
      Promise.all(stationModels.map((m) => loadScene(stationModelPath(m)))),
      loadScene(DOCK_CLAMP_PATH),
      loadScene(HANGAR_PATH),
      loadSwatches(),
    ]);
    const stations = new Map<StationModel, Object3D>();
    stationModels.forEach((m, i) => {
      const scene = stationScenes[i];
      if (scene) stations.set(m, scene);
    });

    const parts = new Map<string, Object3D>();
    partModels.forEach(({ id, tier }, i) => {
      const scene = partScenes[i];
      if (scene) parts.set(partKey(id, tier), scene);
    });
    const connectors = new Map<ConnectorKind, Object3D>();
    connectorKinds.forEach((kind, i) => {
      const scene = connectorScenes[i];
      if (scene) connectors.set(kind, scene);
    });
    const rocks = new Map<ResourceId, AsteroidModel[]>();
    RESOURCE_IDS.forEach((id, i) => {
      const models = rockModels[i]!.filter((m): m is AsteroidModel => m !== null);
      if (models.length > 0) rocks.set(id, models);
    });
    return new ModelLibrary(parts, connectors, rocks, stations, clamp, hangar, clanPartsFor(loader), swatches);
  }

  /**
   * Every loaded part, connector, station and clamp template (clone, do not modify) – the shader
   * warm-up's samples. The asteroid models are merged into the field's own meshes, the hangar
   * platform is drawn in the hangar only.
   */
  templates(): Object3D[] {
    const out: Object3D[] = [...this.parts.values(), ...this.connectors.values(), ...this.stations.values()];
    if (this.clamp) out.push(this.clamp);
    return out;
  }

  /** Station template (clone it), or null → placeholder shape. */
  station(model: StationModel): Object3D | null {
    return this.stations.get(model) ?? null;
  }

  dockClamp(): Object3D | null {
    return this.clamp;
  }

  /** Hangar platform (template – clone it), or null → placeholder floor. */
  hangar(): Object3D | null {
    return this.hangarPlatform;
  }

  /**
   * Part template (do not modify – clone it; the geometry and material are shared).
   * A missing titanium model is replaced by the iron one, so the ship has no placeholder boxes.
   */
  part(partId: PartId, tier: PartTier = 'iron'): Object3D | null {
    return this.parts.get(partKey(partId, tier)) ?? this.parts.get(partKey(partId, 'iron')) ?? null;
  }

  /**
   * UV of a palette swatch's centre in the shared atlas (hull shell, nav lights), or null when the key
   * is unknown or the swatch table is missing. A `SwatchLookup` (render/hull/shellGeometry.ts) – bound,
   * so it can be passed on as is.
   */
  readonly swatchUv = (key: string): readonly [number, number] | null => this.swatches?.get(key) ?? null;

  /** Is the palette swatch table loaded? Without it the hull shell stays off. */
  get hasSwatches(): boolean {
    return this.swatches !== null;
  }

  connector(kind: ConnectorKind): Object3D | null {
    return this.connectors.get(kind) ?? null;
  }

  /** Loaded asteroid variants of a resource (empty array = placeholder shape). */
  asteroids(resource: ResourceId): readonly AsteroidModel[] {
    return this.rocks.get(resource) ?? [];
  }
}

const partKey = (partId: PartId, tier: PartTier): string => `${partId}:${tier}`;
