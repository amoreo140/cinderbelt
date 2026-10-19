// Depth below the gameplay plane (visual polish): up to three layers of distant asteroid / debris
// silhouettes and up to two layers of nebula fog. Every layer is real geometry at its own depth, so
// it parallaxes at its own speed as the camera travels; the layers wrap around the point the camera
// looks at on their depth (like SpaceDust), so they never run out. Silhouettes fade toward the
// zone's haze colour with depth (aerial perspective); fog is additive, world-anchored and soft-edged.
//
// The silhouettes are the batch A far sets (art/README §2.7.22): neutral rocks everywhere plus the
// depth's identity set (depth 2 scrap, depth 3 crystal, depth 4 obsidian) by `depth.mix[depth][layer]`
// of the scenery manifest, shifted by the sector environment (DebrisLook: set bias, rock tint,
// density). One BatchedMesh per layer holds every set's geometry, so a zone change only re-points
// the instances: each one shrinks away and comes back as its new-zone silhouette at a staggered
// moment of the zone cross-fade.
import {
  AdditiveBlending,
  Color,
  Group,
  Mesh,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type BatchedMesh,
  type BufferGeometry,
  type MeshStandardMaterial,
} from 'three';
import type { RingIndex } from '../../data/economy';
import { createRng } from '../../sim/math/rng';
import { vfxTexture } from '../fx/textures';
import { uploadBatchColors, uploadBatchMatrices } from '../uploads';
import { wrapAround } from '../wrap';
import { depthPick, depthSetIds, type SceneryManifest } from './scenery';
import { batchOf, hazeMaterial, hazeUniforms, sceneryFile, sceneryManifest, type HazeUniforms } from './sceneryAssets';
import { lookAheadAtDepth, type DebrisLook } from './zoneLook';

interface DebrisLayerSpec {
  depth: readonly [number, number];
  count: number;
  scale: readonly [number, number];
  /** Wrap area (square, world units) – larger than the view at that depth from the highest camera. */
  area: number;
  /** Share of the haze colour mixed in (× zone haze strength). */
  haze: number;
}

// the two nearer layers carry more silhouettes than the lumpy-rock era (24 / 30): with only ~3 in
// view the ring identity sets barely registered at the default zoom (one draw call per layer either way)
export const DEBRIS_LAYERS: readonly DebrisLayerSpec[] = [
  { depth: [95, 150], count: 34, scale: [0.6, 1.8], area: 800, haze: 0.62 },
  { depth: [170, 260], count: 38, scale: [4, 11], area: 1300, haze: 0.6 },
  { depth: [420, 620], count: 22, scale: [12, 30], area: 2400, haze: 0.82 },
];

/** Share of the layer haze applied to the emissive part (the landmarks keep ~15 % on theirs). */
const EMISSIVE_HAZE = 0.15;
/** A zone change re-points every instance within this time (s) – about the zone cross-fade. */
const SWAP_SPREAD = 3.5;
/** One instance shrinks away and grows back as its new silhouette over this time (s). */
const SWAP_TIME = 0.7;

interface FogLayerSpec {
  depth: number;
  size: number;
  /** World units per texture repeat (two octaves at ×1 and ×0.37). */
  scale: number;
  drift: number;
}

export const FOG_LAYERS: readonly FogLayerSpec[] = [
  { depth: 130, size: 1500, scale: 260, drift: 1.2 },
  { depth: 380, size: 3200, scale: 620, drift: 0.6 },
];

const PITCH = 55;

const FOG_VERTEX = /* glsl */ `
varying vec2 vWorld;
varying vec2 vLocal;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xz;
  vLocal = position.xy;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FOG_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uTintA;
uniform vec3 uTintB;
uniform float uScale;
uniform float uOpacity;
uniform float uHalf;
uniform vec2 uDrift;
varying vec2 vWorld;
varying vec2 vLocal;
void main() {
  vec2 p = vWorld / uScale;
  float a = texture2D(uMap, p + uDrift).a;
  float b = texture2D(uMap, p * 0.37 + vec2(0.31, 0.77) - uDrift * 0.6).a;
  float d = texture2D(uMap, p * 2.3 + vec2(0.5, 0.1) + uDrift * 1.4).a;
  float density = smoothstep(0.08, 0.9, a * b * 1.8 + d * 0.25);
  float edge = 1.0 - smoothstep(0.55, 1.0, length(vLocal) / uHalf);
  vec3 tint = mix(uTintA, uTintB, smoothstep(0.2, 0.8, b));
  gl_FragColor = vec4(tint * density * edge * uOpacity, 1.0);
}`;

/** Per instance: x, y, z, scale, then a ±10 % jitter per axis. */
const BASE = 7;
/** Per instance: three start angles, spin speed, the set pick, the mesh pick, the swap moment. */
const PICK = 7;

interface DebrisLayer {
  spec: DebrisLayerSpec;
  haze: HazeUniforms;
  base: Float32Array;
  pick: Float32Array;
  /** Built once the scenery has loaded. */
  mesh: BatchedMesh | null;
  material: MeshStandardMaterial | null;
  /** Zone (index + 1 into DepthLayers.zones) each instance shows now (0 = none yet) and its current set scale. */
  shown: Uint8Array;
  setScale: Float32Array;
  /** When (layer time) each instance swaps to the current zone. */
  swapAt: Float32Array;
}

interface FogLayer {
  spec: FogLayerSpec;
  mesh: Mesh;
  material: ShaderMaterial;
}

/** A zone as the layers see it: the depth's mix and the environment's debris look. */
interface DebrisZone {
  ring: RingIndex;
  debris: DebrisLook;
}

const DEFAULT_ZONE: DebrisZone = { ring: 1, debris: { bias: {}, rockTint: null, density: 1 } };

interface SceneryGeometry {
  manifest: SceneryManifest;
  /** BatchedMesh geometry id by mesh name (the same order in every layer). */
  ids: Map<string, number>;
}

export class DepthLayers {
  readonly object = new Group();
  private readonly debris: DebrisLayer[] = [];
  private readonly fog: FogLayer[] = [];
  private readonly ownedGeometries: BufferGeometry[] = [];
  private readonly hazeColor = new Color();
  /** Colour multiplier of the silhouettes (background brightness). */
  private readonly dim = { value: 1 };
  private readonly dummy = new Object3D();
  private readonly look = new Vector3();
  private readonly tint = new Color();
  private readonly white = new Color(1, 1, 1);
  private scenery: SceneryGeometry | null = null;
  /** Zones seen so far (an instance stores index + 1); a handful per game. */
  private readonly zones: DebrisZone[] = [];
  /** Current zone (index + 1 into `zones`, 0 = none yet). */
  private zone = 0;
  private hazeHex = 0;
  private time = 0;
  private debrisCount = 3;
  private fogCount = 2;
  private disposed = false;

  constructor(seed: number) {
    this.object.name = 'depth-layers';
    this.object.userData.noShadow = true;
    DEBRIS_LAYERS.forEach((spec, li) => {
      const rng = createRng((seed ^ 0x3d9a1e) + li * 7919);
      const base = new Float32Array(spec.count * BASE);
      const pick = new Float32Array(spec.count * PICK);
      for (let i = 0; i < spec.count; i++) {
        base[i * BASE] = (rng() - 0.5) * spec.area;
        base[i * BASE + 1] = -(spec.depth[0] + rng() * (spec.depth[1] - spec.depth[0]));
        base[i * BASE + 2] = (rng() - 0.5) * spec.area;
        base[i * BASE + 3] = spec.scale[0] + Math.pow(rng(), 1.8) * (spec.scale[1] - spec.scale[0]);
        // the meshes carry their own elongation – only a mild non-uniform jitter
        for (let k = 0; k < 3; k++) base[i * BASE + 4 + k] = 0.9 + rng() * 0.2;
        pick[i * PICK] = rng() * Math.PI * 2;
        pick[i * PICK + 1] = rng() * Math.PI * 2;
        pick[i * PICK + 2] = (rng() - 0.5) * 0.08;
        pick[i * PICK + 3] = rng();
        pick[i * PICK + 4] = rng();
        pick[i * PICK + 5] = rng();
      }
      this.debris.push({
        spec,
        haze: hazeUniforms(this.hazeColor, this.dim),
        base,
        pick,
        mesh: null,
        material: null,
        shown: new Uint8Array(spec.count),
        setScale: new Float32Array(spec.count),
        swapAt: new Float32Array(spec.count),
      });
    });
    void this.loadScenery();

    const map = vfxTexture('nebula_cloud');
    for (const spec of FOG_LAYERS) {
      const material = new ShaderMaterial({
        uniforms: {
          uMap: { value: map },
          uTintA: { value: new Color() },
          uTintB: { value: new Color() },
          uScale: { value: spec.scale },
          uOpacity: { value: 0 },
          uHalf: { value: spec.size / 2 },
          uDrift: { value: { x: 0, y: 0 } },
        },
        vertexShader: FOG_VERTEX,
        fragmentShader: FOG_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      material.userData.noAO = true;
      const mesh = new Mesh(this.own(new PlaneGeometry(spec.size, spec.size)), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.frustumCulled = false;
      mesh.renderOrder = -50;
      mesh.userData.noAO = true;
      this.object.add(mesh);
      this.fog.push({ spec, mesh, material });
    }
  }

  /** The far sets of every ring go into one BatchedMesh per layer (≈ 5 k triangles of geometry). */
  private async loadScenery(): Promise<void> {
    const manifest = await sceneryManifest();
    if (!manifest || this.disposed) return;
    const sets = depthSetIds(manifest);
    const loaded = await Promise.all(sets.map((id) => sceneryFile(manifest.sets[id]!.file)));
    if (this.disposed) return;
    const names: string[] = [];
    const geometries: BufferGeometry[] = [];
    let source: MeshStandardMaterial | null = null;
    sets.forEach((id, k) => {
      const file = loaded[k];
      if (!file) return;
      source ??= file.material;
      for (const m of manifest.sets[id]!.meshes) {
        const g = file.geometries.get(m.name);
        if (!g) continue;
        names.push(m.name);
        geometries.push(g);
      }
    });
    if (!source || geometries.length === 0) return;
    let ids: Map<string, number> | null = null;
    for (const layer of this.debris) {
      const material = hazeMaterial(source, layer.haze);
      const batch = batchOf(geometries, layer.spec.count, material);
      if (!batch) return;
      ids ??= new Map(names.map((n, k) => [n, batch.ids[k]!]));
      const { mesh } = batch;
      mesh.name = 'depth-silhouettes';
      // the instances move every frame: the whole-object bounds would go stale (per-instance culling stays)
      mesh.frustumCulled = false;
      mesh.userData.noShadow = true;
      mesh.userData.noAO = true;
      for (let i = 0; i < layer.spec.count; i++) mesh.addInstance(batch.ids[0]!);
      layer.mesh = mesh;
      layer.material = material;
      layer.shown.fill(0);
      this.object.add(mesh);
    }
    this.scenery = ids ? { manifest, ids } : null;
  }

  private own<T extends BufferGeometry>(g: T): T {
    this.ownedGeometries.push(g);
    return g;
  }

  setQuality(debrisLayers: number, fogLayers: number): void {
    this.debrisCount = debrisLayers;
    this.fogCount = fogLayers;
  }

  /**
   * The zone the player is in (the sector's depth and its environment's debris look): its
   * silhouettes swap in over the zone cross-fade. `debris` is compared by identity (zoneLookFor caches it).
   */
  setZone(ring: RingIndex, debris: DebrisLook): void {
    const current = this.zones[this.zone - 1];
    if (current && current.ring === ring && current.debris === debris) return;
    let index = this.zones.findIndex((z) => z.ring === ring && z.debris === debris);
    if (index < 0) index = this.zones.push({ ring, debris }) - 1;
    const first = this.zone === 0;
    this.zone = index + 1;
    for (const layer of this.debris) {
      for (let i = 0; i < layer.spec.count; i++) layer.swapAt[i] = first ? -Infinity : this.time + layer.pick[i * PICK + 5]! * SWAP_SPREAD;
    }
  }

  /** Points instance `i` at the silhouette of the current zone (and its tint). */
  private assign(layer: DebrisLayer, li: number, i: number): void {
    const s = this.scenery!;
    const { ring, debris } = this.zones[this.zone - 1] ?? DEFAULT_ZONE;
    layer.shown[i] = this.zone;
    // a sparse environment hides a fixed share of the instances (golden-ratio sequence, no rng)
    if (debris.density < 1 && (i * 0.618034 + li * 0.31) % 1 >= debris.density) {
      layer.setScale[i] = 0;
      return;
    }
    const pick = depthPick(s.manifest, ring, li, layer.pick[i * PICK + 3]!, layer.pick[i * PICK + 4]!, debris.bias);
    const id = pick ? s.ids.get(pick.mesh) : undefined;
    if (!pick || id === undefined) {
      layer.setScale[i] = 0;
      return;
    }
    layer.mesh!.setGeometryIdAt(i, id);
    layer.setScale[i] = s.manifest.depth.setScale[pick.set] ?? 1;
    const tint = pick.set === 'rocks' ? (debris.rockTint ?? s.manifest.depth.rockTint[String(ring)]) : undefined;
    layer.mesh!.setColorAt(i, tint ? this.tint.set(tint) : this.white);
  }

  /**
   * `target` = the point the camera looks at on the gameplay plane; haze / nebula from the zone look
   * (already cross-faded); `dim` = colour multiplier of the silhouettes (background brightness).
   */
  update(target: Vector3, dt: number, haze: number, hazeStrength: number, nebula: readonly [number, number], nebulaOpacity: number, dim = 1): void {
    this.time += dt;
    this.dim.value = dim;
    this.hazeColor.setHex(haze);
    this.hazeHex = haze;
    this.debris.forEach((layer, li) => {
      const mesh = layer.mesh;
      if (!mesh || !this.scenery) return;
      mesh.visible = li < this.debrisCount;
      if (!mesh.visible) return;
      layer.haze.amount.value = Math.min(0.95, layer.spec.haze * hazeStrength);
      layer.haze.emissive.value = layer.haze.amount.value * EMISSIVE_HAZE;
      const { spec, base, pick } = layer;
      const mid = (spec.depth[0] + spec.depth[1]) / 2;
      this.look.set(target.x, 0, target.z - lookAheadAtDepth(mid, PITCH));
      const zone = Math.max(1, this.zone);
      for (let i = 0; i < spec.count; i++) {
        // a zone change: shrink away, swap at the smallest, grow back
        let k = 1;
        if (layer.shown[i] !== zone) {
          const t = (this.time - layer.swapAt[i]!) / SWAP_TIME;
          if (layer.shown[i] === 0 || t >= 0.5) this.assign(layer, li, i);
          else if (t > 0) k = 1 - 2 * t;
        } else {
          const t = (this.time - layer.swapAt[i]!) / SWAP_TIME;
          if (t < 1) k = Math.max(0, 2 * t - 1);
        }
        const s = base[i * BASE + 3]! * layer.setScale[i]! * k;
        this.dummy.position.set(
          wrapAround(base[i * BASE]!, this.look.x, spec.area),
          base[i * BASE + 1]!,
          wrapAround(base[i * BASE + 2]!, this.look.z, spec.area),
        );
        const spin = pick[i * PICK + 2]!;
        this.dummy.rotation.set(pick[i * PICK]! + this.time * spin, pick[i * PICK + 1]!, this.time * spin * 0.6);
        this.dummy.scale.set(s * base[i * BASE + 4]!, s * base[i * BASE + 5]!, s * base[i * BASE + 6]!);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
      }
      // the instances in use, not the texture's padding; colours only after a zone swap re-tinted some
      uploadBatchMatrices(mesh);
      uploadBatchColors(mesh);
    });
    this.fog.forEach((layer, li) => {
      layer.mesh.visible = li < this.fogCount && nebulaOpacity > 0.001;
      if (!layer.mesh.visible) return;
      const u = layer.material.uniforms;
      (u.uTintA!.value as Color).setHex(nebula[0]);
      (u.uTintB!.value as Color).setHex(nebula[1]);
      u.uOpacity!.value = nebulaOpacity * (li === 0 ? 0.8 : 1.15);
      const drift = u.uDrift!.value as { x: number; y: number };
      drift.x = (this.time * layer.spec.drift) / layer.spec.scale;
      drift.y = (this.time * layer.spec.drift * 0.4) / layer.spec.scale;
      layer.mesh.position.set(target.x, -layer.spec.depth, target.z - lookAheadAtDepth(layer.spec.depth, PITCH));
    });
  }

  /** The zone haze colour of this frame (cross-faded) – the belt beds mix it in too. */
  get haze(): number {
    return this.hazeHex;
  }

  /** Silhouettes per layer currently shown (tests, tuning): [instances, of which the depth identity set]. */
  stats(): { instances: number; identity: number }[] {
    const s = this.scenery;
    return this.debris.map((layer, li) => {
      if (!layer.mesh || !s || li >= this.debrisCount) return { instances: 0, identity: 0 };
      let instances = 0;
      let identity = 0;
      for (let i = 0; i < layer.spec.count; i++) {
        if (layer.setScale[i] === 0) continue;
        instances++;
        const { ring, debris } = this.zones[(layer.shown[i] || 1) - 1] ?? DEFAULT_ZONE;
        const pick = depthPick(s.manifest, ring, li, layer.pick[i * PICK + 3]!, layer.pick[i * PICK + 4]!, debris.bias);
        if (pick && pick.set !== 'rocks') identity++;
      }
      return { instances, identity };
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const l of this.debris) {
      l.material?.dispose();
      l.mesh?.dispose();
    }
    for (const l of this.fog) l.material.dispose();
    for (const g of this.ownedGeometries) g.dispose();
    this.object.removeFromParent();
  }
}
