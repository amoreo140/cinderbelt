// Damage decals on a ship's hull (art batch B7): scorch blotches, torn plates, bullet holes and burn
// streaks from `vfx/damage_decals.png` on the parts that lost HP (decalPlan.ts thresholds), 2–3 per
// part on a wreck. Cheap by design: one InstancedMesh per damaged ship with ONE shared material and
// texture (the atlas cell and the alpha are per-instance attributes) – a ship with decals costs one
// draw call, an undamaged ship none. Each decal is a small quad laid on the part's top surface: a
// ray from above finds the surface point and normal once (when the part reaches the level), so the
// quad hugs slopes instead of floating. Fresh damage starts with the hot-rim cell and cools to the
// plain one over a few seconds.
// The rays are the expensive part of a view build (every triangle of the part under the decal, ~2 ms
// per wreck on a desktop – perf audit 2026-10-17): placements are cached by the hull's build signature
// (`cacheKey`, ShipView – grid, shell, clan set, torn edges), the part and the decal, so a wreck that
// streams back in, a view rebuilt for its clan set or a cut wreck's untouched parts place without rays.
import {
  BufferGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Vector3,
  type Group,
} from 'three';
import { partCenter, rotatedSize } from '../../sim/ship/grid';
import { currentHp, maxHp } from '../../sim/ship/hp';
import { partSize } from '../../sim/ship/shape';
import type { HpMap, PlacedPart } from '../../sim/ship/types';
import { simToWorld } from '../coords';
import { vfxTexture } from '../fx/textures';
import { DECAL_GRID, FRESH_COL, WRECK_LEVEL, damageLevel, decalSpecs, type DamageLevel, type DecalSpec } from './decalPlan';
import type { WarmUpZoo } from '../warmup';

/** Seconds a fresh decal takes to cool from the hot-rim cell to the plain one. */
export const DECAL_COOL_TIME = 4;
/** The quad sits this far above the surface (plus polygon offset) – no z-fighting. */
const LIFT = 0.012;
/** Nodes that rotate on their own (turrets, laser heads, gyros, radar) – no decal sticks to them. */
const MOVING = /^(Laser_Head|Cannon_Turret|Tractor_Head|Gyro_Ring_Outer|Gyro_Ring_Inner|Radar_Dish)$/;

export interface DecalPart {
  part: PlacedPart;
  node: Object3D;
}

interface Placed {
  spec: DecalSpec;
  /** Hull-local pose of the quad; null = the ray missed the part (no decal). */
  matrix: Matrix4 | null;
  /** 1 → 0 while the fresh cell cools. */
  heat: number;
}

interface PartState {
  entry: DecalPart;
  level: DamageLevel;
  decals: Placed[];
}

let sharedMaterial: MeshStandardMaterial | null = null;
let sharedQuad: PlaneGeometry | null = null;

/** One material for every hull decal of the game (atlas cell + alpha per instance). Never disposed. */
function decalMaterial(): MeshStandardMaterial {
  if (sharedMaterial) return sharedMaterial;
  const m = new MeshStandardMaterial({
    map: vfxTexture('damage_decals'),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    roughness: 0.92,
    metalness: 0.05,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 decalCell;\nvarying float vDecalAlpha;\nvarying float vDecalHot;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
vMapUv = vec2((decalCell.x + uv.x) / ${DECAL_GRID.toFixed(1)}, 1.0 - (decalCell.y + 1.0 - uv.y) / ${DECAL_GRID.toFixed(1)});
vDecalAlpha = decalCell.z;
vDecalHot = decalCell.x > ${(FRESH_COL - 0.5).toFixed(1)} ? 1.0 : 0.0;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vDecalAlpha;\nvarying float vDecalHot;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vDecalAlpha;')
      // the hot rim of fresh damage glows (the charred core is black, so only the rim lights up)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vDecalHot * 2.2;');
  };
  m.customProgramCacheKey = () => 'cinder-hull-decal-v1';
  // no rim light on the decals (render/rimLight.ts)
  m.userData.noRim = true;
  m.userData.noAO = true;
  sharedMaterial = m;
  return m;
}

/** Shader warm-up: an instanced decal mesh with the shared material (the first hit must not compile it). */
export function hullDecalSample(zoo: WarmUpZoo): void {
  sharedQuad ??= new PlaneGeometry(1, 1);
  const geometry = zoo.geometry(new BufferGeometry());
  geometry.setIndex(sharedQuad.index);
  geometry.setAttribute('position', sharedQuad.getAttribute('position'));
  geometry.setAttribute('normal', sharedQuad.getAttribute('normal'));
  geometry.setAttribute('uv', sharedQuad.getAttribute('uv'));
  geometry.setAttribute('decalCell', new InstancedBufferAttribute(new Float32Array(3), 3));
  const mesh = new InstancedMesh(geometry, decalMaterial(), 1);
  mesh.receiveShadow = true;
  zoo.add(mesh);
}

const tmpPos = new Vector3();
const tmpNormal = new Vector3();
const tmpTip = new Vector3();
const tmpQuat = new Quaternion();
const tmpSpin = new Quaternion();
const tmpScale = new Vector3();
const Z = new Vector3(0, 0, 1);
const UP = new Vector3(0, 1, 0);
const raycaster = new Raycaster();

/** Placements by build signature, part and decal (least recently used first); null = the ray missed. */
const placements = new Map<string, Matrix4 | null>();
/** Placements kept (~2–3 per part: a few hundred wrecks' worth). */
export const PLACEMENT_CACHE = 2048;

/** Cached placements (tests). */
export function placementCacheSize(): number {
  return placements.size;
}

/** Decals of one ship view (ShipView owns it; rebuilt with the hull). */
export class HullDecals {
  private readonly parts: PartState[];
  private mesh: InstancedMesh | null = null;
  private cells: InstancedBufferAttribute | null = null;
  private geometry: BufferGeometry | null = null;
  private dirty = true;
  /** The first update places the existing damage cold (a fresh look only for damage taken in view). */
  private primed = false;
  /** Decals drawn (tests, debugging). */
  count = 0;

  /**
   * @param frame root of the part nodes the rays hit, whose own frame is the hull's (the hull itself,
   *   or ShipView's detached probes of a batched hull – shipBatch.ts)
   */
  /**
   * @param cacheKey the hull's build signature (same signature = the same probe geometry in the same
   *   frame); null = no caching
   */
  constructor(
    private readonly hull: Group,
    parts: readonly DecalPart[],
    private readonly frame: Object3D = hull,
    private readonly cacheKey: string | null = null,
  ) {
    this.parts = parts.map((entry) => ({ entry, level: 0, decals: [] }));
  }

  /**
   * Damage of the ship this frame: its HP map, or 'wreck' (always some decals). `seed` varies the
   * decals between ships of the same design; `dt` cools fresh decals.
   */
  update(hp: HpMap | 'wreck', dt: number, seed: number): void {
    for (const s of this.parts) {
      const p = s.entry.part;
      const level = hp === 'wreck' ? WRECK_LEVEL : damageLevel(currentHp(hp, p) / maxHp(p));
      if (level !== s.level) this.setLevel(s, level, seed);
      for (const d of s.decals) {
        if (d.heat <= 0) continue;
        d.heat = Math.max(0, d.heat - dt / DECAL_COOL_TIME);
        this.dirty = true;
      }
    }
    this.primed = true;
    if (this.dirty) this.write();
  }

  private setLevel(s: PartState, level: DamageLevel, seed: number): void {
    // the shape's footprint (a 2×1 wing): decals scatter over the plate's cells, rays off its empty part miss
    const footprint = rotatedSize(partSize(s.entry.part), s.entry.part.rot);
    const specs = decalSpecs(seed, s.entry.part.id, level, footprint);
    // a heavier level keeps the decals already there (same prefix) and adds the new ones fresh
    const kept = s.decals.slice(0, Math.min(s.decals.length, specs.length));
    const fresh = this.primed && level > s.level && level !== WRECK_LEVEL;
    for (let i = kept.length; i < specs.length; i++) {
      kept.push({ spec: specs[i]!, matrix: this.placed(s.entry, specs[i]!), heat: fresh ? 1 : 0 });
    }
    s.decals = kept;
    s.level = level;
    this.dirty = true;
  }

  /** `place` through the cache (the matrices are shared – never written to). */
  private placed(entry: DecalPart, spec: DecalSpec): Matrix4 | null {
    if (this.cacheKey === null) return this.place(entry, spec);
    const key = `${this.cacheKey}|${entry.part.id}|${spec.x}|${spec.y}|${spec.rot}|${spec.size}`;
    const hit = placements.get(key);
    if (hit !== undefined) {
      placements.delete(key);
      placements.set(key, hit);
      return hit;
    }
    const matrix = this.place(entry, spec);
    placements.set(key, matrix);
    if (placements.size > PLACEMENT_CACHE) placements.delete(placements.keys().next().value!);
    return matrix;
  }

  /** Hull-local pose of a decal: a ray from above onto the part (null = it missed). */
  private place(entry: DecalPart, spec: DecalSpec): Matrix4 | null {
    const c = partCenter(entry.part);
    const local = simToWorld({ x: c.x + spec.x, y: c.y + spec.y }, 3, tmpPos);
    const frame = this.frame;
    frame.updateWorldMatrix(true, true);
    const origin = frame.localToWorld(local.clone());
    const below = frame.localToWorld(local.clone().setY(-3));
    raycaster.set(origin, below.sub(origin).normalize());
    raycaster.far = 8;
    const hits = raycaster.intersectObject(entry.node, true);
    const hit = hits.find((h) => !movingAncestor(h.object, entry.node) && h.face);
    if (!hit || !hit.face) return null;
    // point and normal back into the hull frame
    const point = frame.worldToLocal(hit.point.clone());
    tmpNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    tmpTip.copy(hit.point).add(tmpNormal);
    const normal = frame.worldToLocal(tmpTip).sub(point).normalize();
    // facing up-ish only (a ray from above may graze a vertical side)
    if (normal.dot(UP) < 0.35) normal.lerp(UP, 0.6).normalize();
    point.addScaledVector(normal, LIFT);
    tmpQuat.setFromUnitVectors(Z, normal);
    tmpSpin.setFromAxisAngle(Z, spec.rot);
    tmpQuat.multiply(tmpSpin);
    return new Matrix4().compose(point, tmpQuat, tmpScale.setScalar(spec.size));
  }

  /** Writes the instances (one per decal, plus an overlay of the fresh cell while it cools). */
  private write(): void {
    this.dirty = false;
    let needed = 0;
    for (const s of this.parts) for (const d of s.decals) if (d.matrix) needed += overlay(d) ? 2 : 1;
    if (needed === 0) {
      this.count = 0;
      if (this.mesh) this.mesh.visible = false;
      return;
    }
    if (!this.mesh || this.mesh.instanceMatrix.count < needed) this.allocate(Math.ceil(needed / 8) * 8);
    const mesh = this.mesh!;
    const cells = this.cells!;
    let i = 0;
    for (const s of this.parts) {
      for (const d of s.decals) {
        if (!d.matrix) continue;
        // a fresh large decal cross-fades from the hot-rim cell (column 3) to the plain one
        const hot = overlay(d);
        mesh.setMatrixAt(i, d.matrix);
        cells.setXYZ(i, d.spec.col, d.spec.row, hot ? 1 - d.heat : 1);
        i++;
        if (hot) {
          mesh.setMatrixAt(i, d.matrix);
          cells.setXYZ(i, FRESH_COL, d.spec.row, d.heat);
          i++;
        }
      }
    }
    mesh.count = i;
    mesh.visible = true;
    mesh.instanceMatrix.needsUpdate = true;
    cells.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.count = i;
  }

  private allocate(capacity: number): void {
    this.disposeMesh();
    sharedQuad ??= new PlaneGeometry(1, 1);
    const geometry = new BufferGeometry();
    geometry.setIndex(sharedQuad.index);
    geometry.setAttribute('position', sharedQuad.getAttribute('position'));
    geometry.setAttribute('normal', sharedQuad.getAttribute('normal'));
    geometry.setAttribute('uv', sharedQuad.getAttribute('uv'));
    const cells = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    cells.setUsage(DynamicDrawUsage);
    geometry.setAttribute('decalCell', cells);
    const mesh = new InstancedMesh(geometry, decalMaterial(), capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    mesh.name = 'hull-decals';
    this.geometry = geometry;
    this.cells = cells;
    this.mesh = mesh;
    this.hull.add(mesh);
  }

  private disposeMesh(): void {
    if (!this.mesh) return;
    this.hull.remove(this.mesh);
    this.mesh.dispose();
    // the quad's buffers are shared: dropping them here only means a re-upload of 4 vertices later
    this.geometry?.dispose();
    this.mesh = null;
    this.cells = null;
    this.geometry = null;
  }

  dispose(): void {
    this.disposeMesh();
    this.count = 0;
  }
}

/** A decal drawn twice: the plain cell and the hot-rim cell fading out over it. */
const overlay = (d: Placed): boolean => d.heat > 0 && d.spec.col === 0;

/** The hit lies on a node that rotates by itself (turret, laser head …) below the part node. */
function movingAncestor(o: Object3D, stop: Object3D): boolean {
  for (let n: Object3D | null = o; n && n !== stop; n = n.parent) if (MOVING.test(n.name)) return true;
  return false;
}
