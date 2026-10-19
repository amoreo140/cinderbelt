// Belt beds (art/README §2.7.22 A5): render-only, non-minable rocks deep under each asteroid field –
// the "bed" the field floats over. Per field (scenery.beltFields, deterministic from the chunk and
// the field's first asteroid) 3–8 `Bed_<field resource>_<v>` rocks, 4–30 u below the plane and
// shifted north so they sit under the field from the default camera (scenery.bedRocks). The bed is
// a step darker and calmer than the minable rocks above it: the art bakes it darker and the shader
// mixes ~30 % of the zone haze in. One BatchedMesh, static instances; rebuilt only when fields come
// into or leave range. Quality: Low has fewer rocks, the software Low (particles 0) none.
import { Color, Group, Object3D, type BatchedMesh, type BufferGeometry, type MeshStandardMaterial, type Vector3 } from 'three';
import type { World } from '../../sim/world/World';
import { bedRockClear, bedRocks, beltFields, type BeltField, type FieldRock, type SceneryManifest } from './scenery';
import { batchOf, hazeMaterial, hazeUniforms, sceneryFile, sceneryManifest } from './sceneryAssets';

/** Fields whose centre is this close to the camera target get their bed (hysteresis on leaving). */
const RANGE = 300;
const RANGE_OUT = 360;
const MAX_ROCKS = 160;
/** Share of the bed haze on the emissive accents. */
const EMISSIVE_HAZE = 0.4;
/**
 * The bed's own darkening of the lit part, and how much darker the deepest rock is than the
 * shallowest (instance colour): under the game lights the baked ×0.55 alone left the bed as bright
 * as the minable rocks above it.
 */
const BED_DIM = 0.62;
const DEPTH_SHADE = 0.35;
/** Remembered chunks (the fields of a chunk are taken from its asteroids when first seen). */
const CHUNK_CACHE = 300;

/** Bed density by the quality's particle multiplier: High 1, Medium 0.8, Low 0.5, software Low 0. */
export const bedDensity = (particles: number): number => (particles <= 0 ? 0 : particles >= 1 ? 1 : particles >= 0.6 ? 0.8 : 0.5);

export class BeltBed {
  readonly object = new Group();
  private manifest: SceneryManifest | null = null;
  private mesh: BatchedMesh | null = null;
  private material: MeshStandardMaterial | null = null;
  private ids = new Map<string, number>();
  private readonly haze = hazeUniforms(new Color(), { value: BED_DIM });
  private readonly shade = new Color();
  /** Fields per chunk, from the asteroids present when the chunk was first seen (mining does not move the bed). */
  private readonly chunks = new Map<string, BeltField[]>();
  private lastAsteroids: readonly FieldRock[] = [];
  private readonly shown = new Set<string>();
  private density = 1;
  private dirty = true;
  private rocks = 0;
  private disposed = false;
  private readonly dummy = new Object3D();

  constructor() {
    this.object.name = 'belt-bed';
    this.object.userData.noShadow = true;
    this.object.userData.noAO = true;
    void this.load();
  }

  private async load(): Promise<void> {
    const manifest = await sceneryManifest();
    const set = manifest?.sets.bed;
    const file = set ? await sceneryFile(set.file) : null;
    if (!manifest || !set || !file || this.disposed) return;
    const names: string[] = [];
    const geometries: BufferGeometry[] = [];
    for (const m of set.meshes) {
      const g = file.geometries.get(m.name);
      if (!g) continue;
      names.push(m.name);
      geometries.push(g);
    }
    this.haze.amount.value = manifest.bed.haze;
    this.haze.emissive.value = manifest.bed.haze * EMISSIVE_HAZE;
    const material = hazeMaterial(file.material, this.haze);
    const batch = batchOf(geometries, MAX_ROCKS, material);
    if (!batch) return;
    batch.mesh.name = 'belt-bed-rocks';
    batch.mesh.userData.noShadow = true;
    batch.mesh.userData.noAO = true;
    // static instances: whole-object bounds are recomputed on each rebuild, per-rock culling stays on
    this.ids = new Map(names.map((n, k) => [n, batch.ids[k]!]));
    this.manifest = manifest;
    this.mesh = batch.mesh;
    this.material = material;
    this.object.add(batch.mesh);
    this.dirty = true;
  }

  setQuality(particles: number): void {
    const d = bedDensity(particles);
    if (d === this.density) return;
    this.density = d;
    this.dirty = true;
  }

  /** `haze` = the zone haze colour of this frame (cross-faded). */
  update(world: World, target: Vector3, haze: number): void {
    this.haze.color.value.setHex(haze);
    if (!this.mesh || !this.manifest) return;
    const asteroids = world.asteroids();
    if (asteroids !== this.lastAsteroids) {
      this.lastAsteroids = asteroids;
      this.learnFields(asteroids);
    }
    // which fields are in range (with hysteresis)
    let changed = this.dirty;
    for (const fields of this.chunks.values()) {
      for (const f of fields) {
        const dx = f.center.x - target.x;
        const dz = -f.center.y - target.z;
        const d2 = dx * dx + dz * dz;
        if (!this.shown.has(f.id) && d2 < RANGE * RANGE) {
          this.shown.add(f.id);
          changed = true;
        } else if (this.shown.has(f.id) && d2 > RANGE_OUT * RANGE_OUT) {
          this.shown.delete(f.id);
          changed = true;
        }
      }
    }
    if (changed) this.rebuild();
  }

  private learnFields(asteroids: readonly FieldRock[]): void {
    const byChunk = new Map<string, FieldRock[]>();
    for (const a of asteroids) {
      const i = a.id.indexOf(':');
      const chunk = i < 0 ? a.id : a.id.slice(0, i);
      if (this.chunks.has(chunk)) continue;
      let list = byChunk.get(chunk);
      if (!list) byChunk.set(chunk, (list = []));
      list.push(a);
    }
    if (byChunk.size === 0) return;
    if (this.chunks.size + byChunk.size > CHUNK_CACHE) {
      this.chunks.clear();
      this.shown.clear();
      this.dirty = true;
      this.learnFields(asteroids);
      return;
    }
    for (const [chunk, rocks] of byChunk) this.chunks.set(chunk, beltFields(rocks));
  }

  private rebuild(): void {
    const mesh = this.mesh!;
    const bed = this.manifest!.bed;
    const [dMin, dMax] = bed.depthBelowPlane;
    this.dirty = false;
    let n = 0;
    for (const fields of this.chunks.values()) {
      for (const f of fields) {
        if (!this.shown.has(f.id)) continue;
        for (const r of bedRocks(f, bed, this.density)) {
          const id = this.ids.get(r.mesh);
          if (id === undefined || n >= MAX_ROCKS || !bedRockClear(r, bed.northShiftPerDepth, this.lastAsteroids)) continue;
          if (n >= mesh.instanceCount) mesh.addInstance(id);
          else mesh.setGeometryIdAt(n, id);
          mesh.setVisibleAt(n, true);
          this.dummy.position.set(r.x, r.y, r.z);
          this.dummy.rotation.set(r.tiltX, r.yaw, r.tiltZ, 'YXZ');
          this.dummy.scale.setScalar(r.scale);
          this.dummy.updateMatrix();
          mesh.setMatrixAt(n, this.dummy.matrix);
          mesh.setColorAt(n, this.shade.setScalar(1 - (DEPTH_SHADE * (-r.y - dMin)) / Math.max(1, dMax - dMin)));
          n++;
        }
      }
    }
    for (let i = n; i < mesh.instanceCount; i++) mesh.setVisibleAt(i, false);
    this.rocks = n;
    mesh.visible = n > 0;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }

  /** Bed rocks placed now (tests, tuning). */
  get count(): number {
    return this.rocks;
  }

  dispose(): void {
    this.disposed = true;
    this.material?.dispose();
    this.mesh?.dispose();
    this.object.removeFromParent();
  }
}
