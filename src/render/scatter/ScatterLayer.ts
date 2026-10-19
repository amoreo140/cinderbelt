// Scenery scatter (art batch B3–B5): space clutter props and wreck-field fragments around the camera,
// planned per chunk by scatterPlan.ts (deterministic, render-only – no collision, nothing in the save).
//
// Cost: every model of both manifests goes into ONE BatchedMesh with one material (they all use the
// shared AF_Palette atlas), so the whole layer is one draw call (WEBGL_multi_draw; three.js falls back
// to a loop without it) plus one additive sprite batch for the blinking lamps. Animated nodes
// (satellite dishes and solar wings, the mine core) and the tinted ore window are separate batch
// instances of the same draw. Pieces in the 3 × 3 chunks around the camera target are instanced;
// per-object frustum culling drops the rest. No shadows, no AO, no rim light – scenery stays calmer
// than gameplay objects; the background-brightness setting dims it a little with the backdrop.
//
// Quality: the density follows the preset's particle multiplier (Low ≈ 40 %, Medium ≈ 75 %, High all,
// software Low none); Low drops the lamp sprites (the lamp meshes still glow).
import {
  BatchedMesh,
  BufferAttribute,
  Color,
  Euler,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Raycaster,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { RESOURCES } from '../../data/resources';
import { asteroidOrientation, modelNameOf } from '../../sim/mining/veins';
import { CHUNK_SIZE, chunkCoord, chunkKey } from '../../sim/world/chunks';
import type { SimState } from '../../sim/Simulation';
import { createModelLoader } from '../assets/gltf';
import { fetchAsset, loadModelScene, toFloatAttributes, type ModelLibrary } from '../assets/ModelLibrary';
import { SpriteBatch } from '../fx/Particles';
import { vfxTexture } from '../fx/textures';
import type { QualityPreset } from '../quality';
import { uploadBatchColors, uploadBatchMatrices } from '../uploads';
import { buildCatalog, type LampDef, type ScatterCatalog, type ScatterModelDef, type SpinDef } from './scatterManifest';
import { chunkScatterInput, sectorSecurityOf, type SecurityOf } from './scatterInput';
import { planChunk, scatterDensity, visiblePieces, type ScatterPiece } from './scatterPlan';

export const PROPS_MANIFEST = 'assets/models/props/props.json';
export const WRECK_MANIFEST = 'assets/models/wreckage/wreckage.json';
/** Chunks around the camera target that get instances (1 → 3 × 3 = 600 × 600 u). */
const CHUNK_RANGE = 1;
const MAX_INSTANCES = 512;
const MAX_LAMPS = 256;
/** Cached chunk plans (cleared beyond this). */
const PLAN_CACHE = 256;
/** Bobbing of upright props (u, rad/s). */
const BOB_AMPLITUDE = 0.25;
const BOB_SPEED = 0.6;
/** A claim marker's spike sinks this far into the rock (u, before scale). */
const CLAIM_BURY = 0.12;
/** Lamp sprite size (u) and brightness (HDR). */
const LAMP_SIZE = 1.1;
const LAMP_GLOW = 2.2;

/** One batch geometry of a model: the static body, a spinning node or the tinted window. */
interface ModelPart {
  geometryId: number;
  /** Pose of the node in the model frame (identity for the merged static body). */
  base: Matrix4;
  spin: SpinDef | null;
  tinted: boolean;
}

interface ModelLamp {
  def: LampDef;
  /** Lamp centre in the frame of `part` (its node), or the model frame for part −1. */
  local: Vector3;
  part: number;
}

interface ModelEntry {
  def: ScatterModelDef;
  parts: ModelPart[];
  lamps: ModelLamp[];
}

interface Shown {
  piece: ScatterPiece;
  model: ModelEntry;
  /** Batch instance per model part. */
  ids: number[];
  /** Claim marker: the rock-local direction and the surface factor (null until the rock is known). */
  claim: { dir: Vector3; surface: number } | null;
  /** Nothing of the piece moves (no motion, no spinning node, not on a rock): its matrices are written once. */
  still: boolean;
  /** The world matrix of a still piece once written (its lamps still blink from it). */
  fixed: Matrix4 | null;
}

/** Brightness 0..1 of a lamp at time `t` (s) with a per-piece phase (0..1). */
export function lampLevel(def: Pick<LampDef, 'mode' | 'hz'>, t: number, phase: number): number {
  const period = 1 / Math.max(0.05, def.hz);
  const u = (((t + phase * period) / period) % 1 + 1) % 1;
  switch (def.mode) {
    case 'steady':
      return 0.85;
    case 'pulse':
      return 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(u * Math.PI * 2));
    case 'strobe':
      return u < 0.08 / period ? 1 : 0;
    case 'distress': {
      // three short flashes, then a pause (over a 2.4 s cycle)
      const c = (((t + phase * 2.4) % 2.4) + 2.4) % 2.4;
      return c < 1.2 && c % 0.4 < 0.16 ? 1 : 0;
    }
    case 'irregular':
      return Math.sin(t * 2.3 + phase * 40) + Math.sin(t * 0.7 + phase * 13) > 0.9 ? 0.9 : 0.08;
    case 'blink':
    default:
      return u < 0.45 ? 1 : 0.05;
  }
}

const AXES: Readonly<Record<SpinDef['axis'], Vector3>> = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };
const UP = new Vector3(0, 1, 0);
const WHITE = new Color(1, 1, 1);
const ATTRIBUTES = ['position', 'normal', 'uv', 'color'];

export class ScatterLayer {
  readonly object = new Group();
  private catalog: ScatterCatalog | null = null;
  private readonly models = new Map<string, ModelEntry>();
  private batch: BatchedMesh | null = null;
  private material: MeshStandardMaterial | null = null;
  private readonly lamps = new SpriteBatch({ texture: vfxTexture('glow_soft'), additive: true, max: MAX_LAMPS, renderOrder: 12 });
  private readonly plans = new Map<string, ScatterPiece[]>();
  private shown: Shown[] = [];
  private shownKey = '';
  private density = 1;
  private lampsOn = true;
  private readonly dim = { value: 1 };
  private lampDim = 1;
  private time = 0;
  private disposed = false;
  private readonly m = new Matrix4();
  private readonly m2 = new Matrix4();
  private readonly spinM = new Matrix4();
  private readonly q = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly e = new Euler();
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  private readonly lampColor = new Color();
  private readonly tint = new Color();
  private readonly surfaceCache = new Map<string, number>();

  /** @param securityOf danger of a chunk – the security of its sector (sectors design §3.1). */
  constructor(
    private readonly seed: number,
    private readonly library: ModelLibrary,
    private readonly securityOf: SecurityOf = sectorSecurityOf,
  ) {
    this.object.name = 'scatter';
    this.object.userData.noAO = true;
    this.lamps.mesh.visible = false;
    this.object.add(this.lamps.mesh);
    this.ready = this.load().catch(() => {});
  }

  /** The clutter and wreckage models have loaded (or failed) – the shader warm-up waits for it. */
  readonly ready: Promise<void>;

  private async load(): Promise<void> {
    const json = async (path: string): Promise<unknown> => {
      try {
        const data = await fetchAsset(path);
        return data ? JSON.parse(new TextDecoder().decode(data)) : null;
      } catch {
        return null;
      }
    };
    const [props, wreckage] = await Promise.all([json(PROPS_MANIFEST), json(WRECK_MANIFEST)]);
    const catalog = buildCatalog(props, wreckage);
    if (catalog.size === 0 || this.disposed) return;
    const loader = createModelLoader();
    const defs = [...catalog.values()];
    const scenes = await Promise.all(defs.map((d) => loadModelScene(loader, d.file)));
    if (this.disposed) return;
    this.build(catalog, defs, scenes);
  }

  /** Turns the loaded scenes into batch geometries (static body + spinning nodes + tinted node per model). */
  private build(catalog: ScatterCatalog, defs: ScatterModelDef[], scenes: (Object3D | null)[]): void {
    const pending: { def: ScatterModelDef; parts: { geometry: BufferGeometry; base: Matrix4; spin: SpinDef | null; tinted: boolean }[]; lamps: ModelLamp[] }[] = [];
    let material: Material | null = null;
    defs.forEach((def, i) => {
      const scene = scenes[i];
      if (!scene) return;
      scene.updateMatrixWorld(true);
      const special = new Map<string, { spin: SpinDef | null; tinted: boolean }>();
      for (const s of def.spins) special.set(s.node, { spin: s, tinted: false });
      if (def.tintNode) special.set(def.tintNode, { spin: null, tinted: true });
      const groups = new Map<Object3D | null, BufferGeometry[]>();
      const lampsRaw: { def: LampDef; local: Vector3; owner: Object3D | null }[] = [];
      const lampNodes = new Map(def.lamps.map((l) => [l.node, l]));
      scene.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        material ??= Array.isArray(o.material) ? o.material[0]! : o.material;
        // nearest special ancestor (or itself) decides the group
        let owner: Object3D | null = null;
        for (let n: Object3D | null = o; n && n !== scene; n = n.parent) if (special.has(n.name)) owner = owner ?? n;
        const toOwner = owner ? this.m.copy(owner.matrixWorld).invert().multiply(o.matrixWorld) : o.matrixWorld;
        const geometry = normalizeGeometry(toFloatAttributes((o.geometry as BufferGeometry).clone()).applyMatrix4(toOwner));
        const list = groups.get(owner) ?? [];
        list.push(geometry);
        groups.set(owner, list);
        // a lamp node's centre (in its group's frame) – the glow sprite blinks there
        const lamp = lampNodes.get(o.name) ?? (o.parent ? lampNodes.get(o.parent.name) : undefined);
        if (lamp) {
          geometry.computeBoundingBox();
          lampsRaw.push({ def: lamp, local: geometry.boundingBox!.getCenter(new Vector3()), owner });
        }
      });
      const parts: (typeof pending)[number]['parts'] = [];
      const partOf = new Map<Object3D | null, number>();
      for (const [owner, list] of groups) {
        const geometry = list.length === 1 ? list[0]! : mergeAll(list);
        if (!geometry) continue;
        const sp = owner ? special.get(owner.name)! : { spin: null, tinted: false };
        partOf.set(owner, parts.length);
        parts.push({ geometry, base: owner ? owner.matrixWorld.clone() : new Matrix4(), spin: sp.spin, tinted: sp.tinted });
      }
      // a lamp in the static body moves with the piece (−1), one under a spinning node with that node
      const lamps: ModelLamp[] = lampsRaw.map((l) => ({ def: l.def, local: l.local, part: l.owner ? (partOf.get(l.owner) ?? -1) : -1 }));
      pending.push({ def, parts, lamps });
      scene.traverse((o) => {
        if (o instanceof Mesh) (o.geometry as BufferGeometry).dispose();
      });
    });
    if (pending.length === 0 || !material) return;

    let vertices = 0;
    let indices = 0;
    for (const p of pending) for (const part of p.parts) {
      vertices += part.geometry.getAttribute('position').count;
      indices += part.geometry.index!.count;
    }
    const mat = (material as MeshStandardMaterial).clone();
    mat.vertexColors = true;
    patchScatterMaterial(mat, this.dim);
    const batch = new BatchedMesh(MAX_INSTANCES, vertices, indices, mat);
    batch.name = 'scatter-batch';
    batch.frustumCulled = false;
    batch.perObjectFrustumCulled = true;
    batch.sortObjects = false;
    batch.castShadow = false;
    batch.receiveShadow = false;
    batch.userData.noAO = true;
    for (const p of pending) {
      const parts: ModelPart[] = p.parts.map((part) => {
        const geometryId = batch.addGeometry(part.geometry);
        part.geometry.dispose();
        return { geometryId, base: part.base, spin: part.spin, tinted: part.tinted };
      });
      this.models.set(p.def.name, { def: p.def, parts, lamps: p.lamps });
    }
    this.catalog = catalog;
    this.material = mat;
    this.batch = batch;
    this.object.add(batch);
    this.shownKey = '';
  }

  setQuality(preset: QualityPreset): void {
    const density = scatterDensity(preset.particles);
    if (density !== this.density) this.shownKey = '';
    this.density = density;
    this.lampsOn = preset.particles >= 0.5;
  }

  /** Background brightness (0..1): the scenery dims a little with the backdrop (readability R4). */
  setBackdrop(level: number): void {
    const s = Math.min(1, Math.max(0, level));
    this.dim.value = 0.72 + 0.28 * s;
    this.lampDim = 0.6 + 0.4 * s;
  }

  private plan(cx: number, cy: number): ScatterPiece[] {
    const key = chunkKey(cx, cy);
    let plan = this.plans.get(key);
    if (!plan) {
      if (this.plans.size >= PLAN_CACHE) this.plans.clear();
      plan = this.catalog ? planChunk(chunkScatterInput(this.seed, cx, cy, this.securityOf), this.catalog) : [];
      this.plans.set(key, plan);
    }
    return plan;
  }

  /** Re-instances the pieces of the chunks around (cx, cy) at the current density. */
  private reshow(cx: number, cy: number): void {
    const batch = this.batch!;
    for (const s of this.shown) for (const id of s.ids) batch.deleteInstance(id);
    this.shown = [];
    for (let dx = -CHUNK_RANGE; dx <= CHUNK_RANGE; dx++) {
      for (let dy = -CHUNK_RANGE; dy <= CHUNK_RANGE; dy++) {
        for (const piece of visiblePieces(this.plan(cx + dx, cy + dy), this.density)) {
          const model = this.models.get(piece.model);
          if (!model) continue;
          if (batch.instanceCount + model.parts.length > MAX_INSTANCES) continue;
          const ids = model.parts.map((part) => {
            const id = batch.addInstance(part.geometryId);
            const color = part.tinted && piece.tint ? this.tint.set(RESOURCES[piece.tint].color).multiplyScalar(1.6) : WHITE;
            batch.setColorAt(id, color);
            return id;
          });
          const still = piece.motion === 'still' && !piece.attach && model.parts.every((p) => !p.spin);
          this.shown.push({ piece, model, ids, claim: null, still, fixed: null });
        }
      }
    }
    uploadBatchColors(batch);
  }

  /**
   * Once per frame: `target` = the camera's aim on the plane, `simTime` = the interpolated
   * simulation time (claim markers turn with their rocks), `dt` = frame time.
   */
  update(state: SimState, target: Vector3, simTime: number, dt: number): void {
    this.time += dt;
    const batch = this.batch;
    if (!batch) return;
    const cx = chunkCoord(target.x);
    const cy = chunkCoord(-target.z);
    const key = `${cx},${cy}|${this.density}`;
    if (key !== this.shownKey) {
      this.shownKey = key;
      this.reshow(cx, cy);
    }
    batch.visible = this.shown.length > 0;
    const t = this.time;
    const lampsOn = this.lampsOn && this.density > 0;
    if (lampsOn) this.lamps.begin();
    for (const s of this.shown) {
      let ok = true;
      let m = s.fixed;
      if (!m) {
        ok = this.pieceMatrix(s, state, simTime, t, this.m);
        m = this.m;
        for (let i = 0; i < s.ids.length; i++) {
          const id = s.ids[i]!;
          batch.setVisibleAt(id, ok);
          if (!ok) continue;
          const part = s.model.parts[i]!;
          this.m2.multiplyMatrices(this.m, part.base);
          if (part.spin) this.m2.multiply(this.spinMatrix(part.spin, t, s.piece.phase));
          batch.setMatrixAt(id, this.m2);
        }
        if (ok && s.still) s.fixed = this.m.clone();
      }
      if (!ok || !lampsOn) continue;
      for (const lamp of s.model.lamps) {
        const level = lampLevel(lamp.def, t, s.piece.phase) * lamp.def.gain * this.lampDim;
        if (level < 0.03) continue;
        this.v.copy(lamp.local);
        if (lamp.part >= 0) {
          const part = s.model.parts[lamp.part]!;
          if (part.spin) this.v.applyMatrix4(this.spinMatrix(part.spin, t, s.piece.phase));
          this.v.applyMatrix4(part.base);
        }
        this.v.applyMatrix4(m);
        const [r, g, b] = lamp.def.color;
        this.lampColor.setRGB(r * LAMP_GLOW, g * LAMP_GLOW, b * LAMP_GLOW);
        this.lamps.add(this.v, null, LAMP_SIZE * s.piece.scale, LAMP_SIZE * s.piece.scale, 0, this.lampColor, 0.55 * level);
      }
    }
    if (lampsOn) this.lamps.end();
    this.lamps.mesh.visible = lampsOn;
    // the moving pieces' matrices: the ids in use, not the 512-slot texture (audit 2026-10-17 P9)
    uploadBatchMatrices(batch);
  }

  /** Rotation of a spinning node at time `t` (its own axis, per-piece phase). */
  private spinMatrix(spin: SpinDef, t: number, phase: number): Matrix4 {
    return this.spinM.makeRotationAxis(AXES[spin.axis], ((spin.rate * Math.PI) / 180) * t + phase * Math.PI * 2);
  }

  /** World matrix of a piece at time `t`; false = hide it (its rock is gone or not loaded). */
  private pieceMatrix(s: Shown, state: SimState, simTime: number, t: number, out: Matrix4): boolean {
    const p = s.piece;
    if (p.attach) return this.claimMatrix(s, state, simTime, out);
    this.v.set(p.pos.x, p.height, -p.pos.y);
    this.q.setFromEuler(this.e.set(p.rot[0], p.rot[1], p.rot[2]));
    if (p.motion === 'tumble' || p.motion === 'yaw') {
      this.q2.setFromAxisAngle(this.s.set(p.axis[0], p.axis[1], p.axis[2]), p.rate * t);
      this.q.premultiply(this.q2);
    } else if (p.motion === 'bob') {
      this.v.y += Math.sin(t * BOB_SPEED + p.phase * 6.283) * BOB_AMPLITUDE;
    }
    out.compose(this.v, this.q, this.s.setScalar(p.scale));
    return true;
  }

  /** A claim marker on its rock: the rock's pose, the spike foot on the surface along a fixed rock-local direction. */
  private claimMatrix(s: Shown, state: SimState, simTime: number, out: Matrix4): boolean {
    const p = s.piece;
    const rock = state.world.findAsteroid(p.attach!.asteroid);
    const r = rock ? state.world.radiusOf(rock) : 0;
    if (!rock || r <= 0) return false;
    if (!s.claim) {
      const e0 = asteroidOrientation(rock, 0);
      // a rock tipped on its side would carry the claim underneath – leave it unclaimed
      if (Math.abs(Math.cos(e0.x)) < 0.6) return false;
      const sign = Math.cos(e0.x) >= 0 ? 1 : -1;
      // direction in the rock model frame: world = Rx · Ry(t) · Rz · v, so v = Rz⁻¹ · (±dir)
      const dir = new Vector3(p.attach!.dir[0], p.attach!.dir[1] * sign, p.attach!.dir[2]).applyAxisAngle(AXES.z, -e0.z).normalize();
      s.claim = { dir, surface: this.surfaceOf(rock, dir) };
    }
    const e = asteroidOrientation(rock, simTime);
    this.q.setFromEuler(this.e.set(e.x, e.y, e.z));
    // the spike: +Y along the out-direction, foot on the surface (a little buried)
    this.v.copy(s.claim.dir).applyQuaternion(this.q);
    this.q2.setFromUnitVectors(UP, this.v);
    const foot = s.claim.surface * r - CLAIM_BURY * p.scale;
    this.v.multiplyScalar(foot).add(this.s.set(rock.pos.x, 0, -rock.pos.y));
    out.compose(this.v, this.q2, this.s.setScalar(p.scale));
    return true;
  }

  /** Distance of the rock model's surface along a direction (unit-radius model; 0.85 without a model). */
  private surfaceOf(rock: Parameters<typeof modelNameOf>[0] & { id: string }, dir: Vector3): number {
    const key = `${rock.id}|${dir.x.toFixed(3)},${dir.y.toFixed(3)},${dir.z.toFixed(3)}`;
    const hit = this.surfaceCache.get(key);
    if (hit !== undefined) return hit;
    let surface = 0.85;
    const name = modelNameOf(rock);
    const model = this.library.asteroids(rock.resource).find((m) => m.name === name);
    if (model) {
      const ray = new Raycaster(dir.clone().multiplyScalar(2), dir.clone().negate(), 0, 3);
      const hits = ray.intersectObject(new Mesh(model.geometry), false);
      if (hits[0]) surface = 2 - hits[0].distance;
    }
    if (this.surfaceCache.size > 512) this.surfaceCache.clear();
    this.surfaceCache.set(key, surface);
    return surface;
  }

  /** What the layer shows (tests and tuning). */
  stats(): { loaded: boolean; pieces: number; instances: number; lamps: number; density: number; byModel: Record<string, number> } {
    const byModel: Record<string, number> = {};
    for (const s of this.shown) byModel[s.piece.model] = (byModel[s.piece.model] ?? 0) + 1;
    return {
      loaded: this.batch !== null,
      pieces: this.shown.length,
      instances: this.batch?.instanceCount ?? 0,
      lamps: this.lamps.mesh.visible ? (this.lamps.mesh.geometry as { instanceCount?: number }).instanceCount ?? 0 : 0,
      density: this.density,
      byModel,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.batch?.dispose();
    this.material?.dispose();
    this.lamps.dispose();
    this.plans.clear();
    this.shown = [];
    this.object.removeFromParent();
  }
}

/** Same attribute set for every batch geometry: position, normal, uv, colour (RGB, white if missing), indexed. */
export function normalizeGeometry(g: BufferGeometry): BufferGeometry {
  for (const name of Object.keys(g.attributes)) if (!ATTRIBUTES.includes(name)) g.deleteAttribute(name);
  const count = g.getAttribute('position').count;
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getAttribute('uv')) g.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2));
  const color = g.getAttribute('color');
  if (!color) g.setAttribute('color', new BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  else if (color.itemSize !== 3) {
    const rgb = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      rgb[i * 3] = color.getX(i);
      rgb[i * 3 + 1] = color.getY(i);
      rgb[i * 3 + 2] = color.getZ(i);
    }
    g.setAttribute('color', new BufferAttribute(rgb, 3));
  }
  if (!g.index) {
    const index = new Uint32Array(count);
    for (let i = 0; i < count; i++) index[i] = i;
    g.setIndex(new BufferAttribute(index, 1));
  }
  return g;
}

/** Merges geometries with the same attribute set (indices offset). */
export function mergeAll(list: BufferGeometry[]): BufferGeometry | null {
  let vertices = 0;
  let indices = 0;
  for (const g of list) {
    vertices += g.getAttribute('position').count;
    indices += g.index!.count;
  }
  const out = new (list[0]!.constructor as new () => BufferGeometry)();
  for (const name of ATTRIBUTES) {
    const size = list[0]!.getAttribute(name).itemSize;
    const array = new Float32Array(vertices * size);
    let offset = 0;
    for (const g of list) {
      const a = g.getAttribute(name);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) array[(offset + i) * size + k] = a.getComponent(i, k);
      offset += a.count;
    }
    out.setAttribute(name, new BufferAttribute(array, size));
  }
  const index = new Uint32Array(indices);
  let base = 0;
  let at = 0;
  for (const g of list) {
    const idx = g.index!;
    for (let i = 0; i < idx.count; i++) index[at++] = idx.getX(i) + base;
    base += g.getAttribute('position').count;
  }
  out.setIndex(new BufferAttribute(index, 1));
  for (const g of list) g.dispose();
  return out;
}

/**
 * The batch material: the shared atlas material plus (1) the per-instance colour also tints the
 * emission (ore window glows in the resource colour; every other instance is white) and (2) one
 * brightness uniform for the background-brightness setting.
 */
function patchScatterMaterial(material: MeshStandardMaterial, dim: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uScatterDim = dim;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vScatterTint;')
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
#ifdef USE_BATCHING_COLOR
vScatterTint = getBatchingColor( getIndirectIndex( gl_DrawID ) ).rgb;
#else
vScatterTint = vec3( 1.0 );
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uScatterDim;\nvarying vec3 vScatterTint;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vScatterTint;')
      .replace('#include <opaque_fragment>', 'outgoingLight *= uScatterDim;\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => 'cinder-scatter-v1';
}

/** Chunk of a world point (tests). */
export const scatterChunkOf = (x: number, z: number): { cx: number; cy: number } => ({ cx: Math.floor(x / CHUNK_SIZE), cy: Math.floor(-z / CHUNK_SIZE) });
