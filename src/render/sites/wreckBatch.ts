// Static batching of graveyard wrecks (M4b plan T13). A wreck view is one ShipView, merged per material
// (shipBatch.bakeHull) – but a dead hull has a shade per part (combat/livery.ts DERELICT_SHADES, 4
// materials), so one wreck costs ~4 draw calls per pass, and a 17-wreck graveyard in view at High (main +
// shadow + AO) ~200 (measured, camera 140). The plan's budget is ≤ 25 for a full graveyard.
//
// `WreckBatch` merges the frozen static meshes of many still wrecks into one mesh per material and layout
// across all of them. The derelict shades do not split it: a plain palette material's base colour goes
// into a per-vertex `color` attribute (`shadedMaterial` – the same material with vertex colours, shared by
// every batch), so a cell draws one mesh per base material whatever its shades (perf audit 2026-10-17:
// the cells of a graveyard in view drew 24 meshes, now ~8; pirate clan parts, which keep their own
// palette, add their own). `WreckBatcher` runs the lifecycle for combat/CombatLayer.ts: a graveyard wreck
// (`w.poi` starting with `gy:`) or a dormant sleeper that has lain still (not moving, cut, towed or
// ripped) for a moment is baked in (`set(id, bakeStatic(view.group).batches, view.group.matrix)`) and its
// live view leaves the scene graph (no matrix update, no AO or shadow sweep visits it); when it changes
// (cut → new grid, towed, woken, despawned, the hull shell setting flipped) it is taken out (`delete(id)`)
// and the live view comes back; `flush()` once per frame rebuilds only when the set changed. The batcher
// keeps one batch per 100 u cell (`WRECK_CELL`): a graveyard is ~400 u across, and one batch for all of it
// would draw every wreck in every pass even when one or two are in view.
//
// Far band (perf audit 2026-10-17, P2.2): each merged mesh carries a second index range, a meshopt LOD1
// of its triangles (wreckLodCore.ts, simplified in a worker – wreckLod.ts – while the batch draws LOD0)
// over the same vertices. Past the far-tier switch (env/ShadowRig.ts `farTier`: view distance > 105 on,
// < 95 off) the batches draw the LOD1 range – a draw-range flip, nothing uploaded. There the batches cast
// no shadow and skip the AO pass, so LOD1 only ever draws in the main pass.
//
// Damage decals (decals/HullDecals.ts) are one InstancedMesh per hull with a shared material: a batched
// wreck's decals are frozen too (`freezeDecals` – a wreck's decals never change) and all of them draw as
// one InstancedMesh, so a batch costs its hull meshes + 1 decal mesh for any number of wrecks.
import { BufferAttribute, BufferGeometry, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, type Color, type InterleavedBufferAttribute, type Material, type Object3D } from 'three';
import { farTier } from '../env/ShadowRig';
import { cloneWithRim } from '../rimLight';
import { bakeStatic, batchKey, materialKey, mergeSources, type BatchSource } from '../shipBatch';
import { workerLod, type LodProvider } from './wreckLod';
import type { LodJob } from './wreckLodCore';

interface MemberMesh {
  geometry: BufferGeometry;
  /** What the batch draws it with (the shaded twin of its material, or the material itself). */
  material: Material;
  key: string;
  /** The mesh in world space (the wreck's pose × the mesh's frozen matrix). */
  matrix: Matrix4;
  castShadow: boolean;
  receiveShadow: boolean;
  renderOrder: number;
  /** LOD1 triangles (the geometry's own vertex numbers); null = none (LOD0 draws far out too), undefined = pending. */
  lod?: Uint32Array | null;
}

/** Name of a hull's decal mesh (decals/HullDecals.ts). */
const DECALS = 'hull-decals';

/**
 * The per-vertex colour is the material's base colour divided by this (8-bit normalised, 0…1), the
 * shaded material's colour is this – the derelict shades with the clan lift reach 1.7.
 */
export const SHADE_SCALE = 2;

/** The shaded twin of each plain palette material, by `materialKey(m, true)` – shared by every batch. */
const shaded = new Map<string, MeshStandardMaterial>();

/**
 * The material a batch draws `m` with when its base colour goes per vertex: a twin with vertex colours
 * and the colour `SHADE_SCALE` (same maps, rim and everything else). Null = `m` does not shade-merge
 * (not a plain MeshStandardMaterial, or vertex colours of its own).
 */
export function shadedMaterial(m: Material): MeshStandardMaterial | null {
  if (!(m instanceof MeshStandardMaterial) || m.vertexColors) return null;
  const key = materialKey(m, true);
  if (key === null || key.startsWith('id:')) return null;
  let twin = shaded.get(key);
  if (!twin) {
    twin = cloneWithRim(m);
    twin.vertexColors = true;
    twin.color.setScalar(SHADE_SCALE);
    twin.name = `${m.name || 'material'}-shaded`;
    shaded.set(key, twin);
  }
  return twin;
}

/** Frees the shaded twins (the combat layer is disposed). */
export function disposeShadedMaterials(): void {
  for (const m of shaded.values()) m.dispose();
  shaded.clear();
}

/** A mesh's base colour as its `color` attribute (scaled by 1 / SHADE_SCALE, 8-bit normalised). */
export function shadeColorAttribute(count: number, color: Color): BufferAttribute {
  const a = new Uint8Array(count * 3);
  const r = Math.round(Math.min(1, color.r / SHADE_SCALE) * 255);
  const g = Math.round(Math.min(1, color.g / SHADE_SCALE) * 255);
  const b = Math.round(Math.min(1, color.b / SHADE_SCALE) * 255);
  for (let i = 0; i < a.length; i += 3) {
    a[i] = r;
    a[i + 1] = g;
    a[i + 2] = b;
  }
  return new BufferAttribute(a, 3, true);
}

/**
 * A wreck's damage decals frozen for the batch: one entry per drawn decal instance. A wreck's decals do
 * not change (always the wreck level, never fresh), so a copy taken once stays right.
 */
export interface FrozenDecals {
  /** The shared decal material. */
  material: Material;
  /** The decal mesh's geometry (its quad attributes are shared; the batch builds its own geometry on them). */
  quad: BufferGeometry;
  renderOrder: number;
  /** 16 floats per instance: the decal's pose in the frame of the root it was frozen from. */
  matrices: Float32Array;
  /** 3 floats per instance: the `decalCell` attribute (atlas column, row, alpha). */
  cells: Float32Array;
  count: number;
}

const tmpInstance = new Matrix4();
const tmpToRoot = new Matrix4();

/** The decals drawn on a ship view now (`root` = view.group), in the root's frame; null = none. */
export function freezeDecals(root: Object3D): FrozenDecals | null {
  const mesh = root.getObjectByName(DECALS);
  if (!(mesh instanceof InstancedMesh) || !mesh.visible || mesh.count === 0) return null;
  const cellAttr = mesh.geometry.getAttribute('decalCell');
  if (!cellAttr) return null;
  root.updateMatrixWorld(true);
  tmpToRoot.copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
  const count = mesh.count;
  const matrices = new Float32Array(count * 16);
  const cells = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    mesh.getMatrixAt(i, tmpInstance);
    tmpInstance.premultiply(tmpToRoot).toArray(matrices, i * 16);
    cells[i * 3] = cellAttr.getX(i);
    cells[i * 3 + 1] = cellAttr.getY(i);
    cells[i * 3 + 2] = cellAttr.getZ(i);
  }
  return { material: mesh.material as Material, quad: mesh.geometry, renderOrder: mesh.renderOrder, matrices, cells, count };
}

interface Member {
  meshes: MemberMesh[];
  /** The decals with their matrices in the batch's frame, or null. */
  decals: FrozenDecals | null;
}

/** One merged mesh of a batch and what went into it (its LOD1 range is written from its members). */
interface Merged {
  mesh: Mesh;
  members: MemberMesh[];
  /** LOD0 index count (the range [0, lod0)). */
  lod0: number;
  /** LOD1 index count (the range [lod0, lod0 + lod1)); 0 = no LOD1 yet – LOD0 draws far out. */
  lod1: number;
}

/** xyz floats of a 3-component attribute (a copy). */
function floats3(a: BufferAttribute | InterleavedBufferAttribute): Float32Array {
  const out = new Float32Array(a.count * 3);
  if (a instanceof BufferAttribute && a.array instanceof Float32Array && !a.normalized) out.set(a.array.subarray(0, a.count * 3));
  else {
    for (let i = 0; i < a.count; i++) {
      out[i * 3] = a.getX(i);
      out[i * 3 + 1] = a.getY(i);
      out[i * 3 + 2] = a.getZ(i);
    }
  }
  return out;
}

/** A member mesh's geometry as a LOD job (copies – the worker takes the arrays). */
function lodJob(g: BufferGeometry): LodJob | null {
  const pos = g.getAttribute('position');
  const normal = g.getAttribute('normal');
  const index = g.index;
  if (!pos || !index || pos.itemSize !== 3) return null;
  const job: LodJob = { index: Uint32Array.from(index.array as ArrayLike<number>), positions: floats3(pos) };
  if (normal?.itemSize === 3) job.normals = floats3(normal);
  return job;
}

export class WreckBatch {
  readonly object = new Group();
  private readonly members = new Map<string | number, Member>();
  private merged: Merged[] = [];
  /** The merged meshes (the same array until the next rebuild). */
  private mergedMeshes: Mesh[] = [];
  /** All the batched wrecks' decals in one draw (null = none). */
  private decalMesh: InstancedMesh | null = null;
  private dirty = false;
  /** A LOD1 arrived for a member: the LOD1 ranges are rewritten at the next flush. */
  private lodDirty = false;
  /** The far band: the merged meshes draw their LOD1 range. */
  private far = false;

  /** `lod` = where LOD1 is simplified (null = LOD0 only). */
  constructor(private readonly lod: LodProvider | null = workerLod) {
    this.object.name = 'wreck-batch';
  }

  /**
   * Puts a still wreck into the batch (or replaces it): `baked` = its frozen static meshes in the view's
   * frame (shipBatch.bakeStatic – the batch owns their geometries from now on), `world` = the view's pose
   * in the batch's frame, `decals` = its frozen decals in the view's frame (`freezeDecals`).
   */
  set(id: string | number, baked: readonly Mesh[], world: Matrix4, decals: FrozenDecals | null = null): void {
    this.release(id);
    const meshes = baked.map((m): MemberMesh => {
      const source = m.material as Material;
      const twin = shadedMaterial(source);
      // the base colour goes per vertex: every shade of a material lands in one merged mesh
      if (twin) m.geometry.setAttribute('color', shadeColorAttribute(m.geometry.getAttribute('position').count, (source as MeshStandardMaterial).color));
      const key = twin ? `shaded|${batchKey(m, false, true)}` : batchKey(m);
      return {
        geometry: m.geometry,
        material: twin ?? source,
        key: key ?? `solo:${m.uuid}`,
        matrix: new Matrix4().multiplyMatrices(world, m.matrix),
        castShadow: m.castShadow,
        receiveShadow: m.receiveShadow,
        renderOrder: m.renderOrder,
      };
    });
    let placed: FrozenDecals | null = null;
    if (decals) {
      const matrices = new Float32Array(decals.count * 16);
      for (let i = 0; i < decals.count; i++) tmpInstance.fromArray(decals.matrices, i * 16).premultiply(world).toArray(matrices, i * 16);
      placed = { ...decals, matrices };
    }
    const member: Member = { meshes, decals: placed };
    this.members.set(id, member);
    this.dirty = true;
    this.requestLod(id, member);
  }

  /** Asks for the member's LOD1; it lands in a later frame (the merged meshes draw LOD0 far out until then). */
  private requestLod(id: string | number, member: Member): void {
    if (!this.lod) return;
    const jobs: LodJob[] = [];
    const owners: MemberMesh[] = [];
    for (const m of member.meshes) {
      const job = lodJob(m.geometry);
      if (job) {
        jobs.push(job);
        owners.push(m);
      } else m.lod = null;
    }
    if (jobs.length === 0) return;
    const pending = this.lod(jobs);
    if (!pending) {
      for (const m of owners) m.lod = null;
      return;
    }
    void pending.then((lods) => {
      // the wreck left (or was baked anew) meanwhile: its old meshes are gone
      if (this.members.get(id) !== member) return;
      owners.forEach((m, i) => (m.lod = lods[i] ?? null));
      this.lodDirty = true;
    });
  }

  /** Takes a wreck out of the batch (its geometries are freed). False = it was not in. */
  delete(id: string | number): boolean {
    if (!this.release(id)) return false;
    this.dirty = true;
    return true;
  }

  has(id: string | number): boolean {
    return this.members.has(id);
  }

  get size(): number {
    return this.members.size;
  }

  /** Merged meshes drawn now (one per material and layout). */
  get meshes(): readonly Mesh[] {
    return this.mergedMeshes;
  }

  /** The decals of every batched wreck as one InstancedMesh (null = none). */
  get decals(): InstancedMesh | null {
    return this.decalMesh;
  }

  /** Triangles of the merged meshes in the near and in the far band (tests, stats). */
  get triangles(): { near: number; far: number } {
    let near = 0;
    let far = 0;
    for (const m of this.merged) {
      near += m.lod0 / 3;
      far += (m.lod1 > 0 ? m.lod1 : m.lod0) / 3;
    }
    return { near, far };
  }

  /** The far band on / off: the LOD1 or the LOD0 range draws (a draw-range flip). */
  setFar(far: boolean): void {
    if (far === this.far) return;
    this.far = far;
    for (const m of this.merged) this.applyBand(m);
  }

  private applyBand(m: Merged): void {
    if (this.far && m.lod1 > 0) m.mesh.geometry.setDrawRange(m.lod0, m.lod1);
    else m.mesh.geometry.setDrawRange(0, m.lod0);
  }

  private release(id: string | number): boolean {
    const old = this.members.get(id);
    if (!old) return false;
    for (const m of old.meshes) m.geometry.dispose();
    this.members.delete(id);
    return true;
  }

  /** Rebuilds the merged meshes when the set changed since the last flush (only the LOD1 ranges when a LOD1 arrived). */
  flush(): void {
    if (!this.dirty) {
      if (this.lodDirty) {
        this.lodDirty = false;
        for (const m of this.merged) this.writeLod(m, true);
      }
      return;
    }
    this.dirty = false;
    this.lodDirty = false;
    for (const m of this.merged) {
      this.object.remove(m.mesh);
      m.mesh.geometry.dispose();
    }
    this.disposeDecals();
    const groups = new Map<string, MemberMesh[]>();
    for (const { meshes } of this.members.values()) {
      for (const m of meshes) {
        let g = groups.get(m.key);
        if (!g) groups.set(m.key, (g = []));
        g.push(m);
      }
    }
    this.merged = [...groups.values()].map((members) => {
      const first = members[0]!;
      // mergeSources sets the bounding box and sphere
      const geometry = mergeSources(members.map((m): BatchSource => ({ geometry: m.geometry, matrix: m.matrix })));
      const mesh = new Mesh(geometry, first.material);
      mesh.name = 'wreck-batch';
      mesh.castShadow = first.castShadow;
      mesh.receiveShadow = first.receiveShadow;
      mesh.renderOrder = first.renderOrder;
      mesh.matrixAutoUpdate = false;
      this.object.add(mesh);
      const merged: Merged = { mesh, members, lod0: geometry.index!.count, lod1: 0 };
      this.writeLod(merged, false);
      return merged;
    });
    this.mergedMeshes = this.merged.map((m) => m.mesh);
    this.buildDecals();
  }

  /**
   * Writes the LOD1 range of a merged mesh behind its LOD0 range (the index is twice the LOD0 length, so
   * a later LOD1 fits without a new buffer): each member's LOD1, or its LOD0 triangles while it has none.
   * Nothing is written while no member has a LOD1. `upload` = only the LOD1 range goes to the GPU again.
   */
  private writeLod(m: Merged, upload: boolean): void {
    if (!m.members.some((x) => x.lod)) {
      m.lod1 = 0;
      this.applyBand(m);
      return;
    }
    const geometry = m.mesh.geometry;
    let index = geometry.index!;
    if (index.count < m.lod0 * 2) {
      const grown = index.array instanceof Uint32Array ? new Uint32Array(m.lod0 * 2) : new Uint16Array(m.lod0 * 2);
      grown.set((index.array as Uint16Array | Uint32Array).subarray(0, m.lod0));
      index = new BufferAttribute(grown, 1);
      geometry.setIndex(index);
      upload = false;
    }
    const out = index.array as Uint16Array | Uint32Array;
    let o = m.lod0;
    let base = 0;
    for (const x of m.members) {
      const g = x.geometry;
      const src = (x.lod ?? g.index!.array) as ArrayLike<number>;
      // a mirrored source keeps its triangles facing out (as in mergeSources)
      const [b1, b2] = x.matrix.determinant() < 0 ? [2, 1] : [1, 2];
      for (let i = 0; i < src.length; i += 3) {
        out[o++] = base + src[i]!;
        out[o++] = base + src[i + b1]!;
        out[o++] = base + src[i + b2]!;
      }
      base += g.getAttribute('position').count;
    }
    m.lod1 = o - m.lod0;
    index.clearUpdateRanges();
    if (upload) index.addUpdateRange(m.lod0, m.lod1);
    index.needsUpdate = true;
    this.applyBand(m);
  }

  /** One InstancedMesh with the decals of every batched wreck (the shared material and quad). */
  private buildDecals(): void {
    let total = 0;
    let first: FrozenDecals | null = null;
    for (const { decals } of this.members.values()) {
      if (!decals) continue;
      first ??= decals;
      total += decals.count;
    }
    if (!first || total === 0) return;
    const geometry = new BufferGeometry();
    geometry.setIndex(first.quad.index);
    for (const name of ['position', 'normal', 'uv']) {
      const a = first.quad.getAttribute(name);
      if (a) geometry.setAttribute(name, a);
    }
    const cells = new Float32Array(total * 3);
    const mesh = new InstancedMesh(geometry, first.material, total);
    const matrices = mesh.instanceMatrix.array as Float32Array;
    let o = 0;
    for (const { decals } of this.members.values()) {
      if (!decals) continue;
      matrices.set(decals.matrices, o * 16);
      cells.set(decals.cells, o * 3);
      o += decals.count;
    }
    geometry.setAttribute('decalCell', new InstancedBufferAttribute(cells, 3));
    mesh.name = 'wreck-decals';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = first.renderOrder;
    mesh.matrixAutoUpdate = false;
    mesh.computeBoundingSphere();
    this.decalMesh = mesh;
    this.object.add(mesh);
  }

  private disposeDecals(): void {
    const mesh = this.decalMesh;
    if (!mesh) return;
    this.object.remove(mesh);
    // the quad's buffers are shared with the hull decals: dropping them only means a re-upload later
    mesh.geometry.dispose();
    mesh.dispose();
    this.decalMesh = null;
  }

  dispose(): void {
    for (const id of [...this.members.keys()]) this.release(id);
    for (const m of this.merged) m.mesh.geometry.dispose();
    this.merged = [];
    this.mergedMeshes = [];
    this.disposeDecals();
    this.object.clear();
  }
}

/** A wreck lies still this many frames before it joins the batch – a nudge or a short tug does not flap it. */
export const SETTLE_FRAMES = 30;

/**
 * Side of the square cells (world units) the still wrecks are batched by: one `WreckBatch` per cell, so
 * a cell out of view (and out of the shadow camera) is culled whole, and a wreck going in or out rebuilds
 * only its cell. 0 = one batch for everything. Measured on the `graveyard` fixture (12 wrecks, High):
 * one batch for all drew every wreck in every pass at the default zoom (48: 786 k triangles against
 * 413 k unbatched); 100 u cells keep the triangles (433 k) at 120 draw calls (164 unbatched).
 */
export const WRECK_CELL = 100;

/** Wrecks baked in per frame at most (a whole graveyard settling at once would be one long frame). */
export const BAKES_PER_FRAME = 1;

interface Tracked {
  /** Frames the wreck has lain still in a row. */
  frames: number;
  /** The look version it was baked with; null = its live view is drawn. */
  version: number | null;
  /** The cell batch it is in (while `version` is set). */
  cell: string;
  /** It cannot be batched (meshes that do not merge) – never tried again for this view. */
  never: boolean;
  /** Where its live view hangs while it is out of the scene graph (baked in); null = in place. */
  parent: Object3D | null;
}

/**
 * The set / delete lifecycle of the still wrecks and sleepers around their `WreckBatch`es (CombatLayer).
 * Per frame and ship: `batched()` before the live view is updated (true = it is in a batch – skip the
 * view), otherwise the view update and then `settle()`; `release()` before a view is rebuilt or when it
 * is gone; `flush()` once at the end of the frame. `version` = what the view's look depends on besides
 * its grid (the hull shell setting: a view rebuilds itself when it moves). A baked-in view is taken out
 * of its parent (and hidden); it comes back when the ship leaves the batch.
 */
export class WreckBatcher {
  readonly object = new Group();
  private readonly cells = new Map<string, WreckBatch>();
  private readonly tracked = new Map<string | number, Tracked>();
  /** Wrecks baked in since the last flush. */
  private bakes = 0;
  /** The far band (LOD1 draws), by the view distance (`setViewDistance`). */
  private far = false;

  constructor(
    private readonly cellSize = WRECK_CELL,
    private readonly lod: LodProvider | null = workerLod,
  ) {
    this.object.name = 'wreck-batches';
    // the far tier drops the batches' shadow casting and AO with the camera far out (env/ShadowRig.ts)
    this.object.userData.farLite = true;
  }

  /** The camera's view distance this frame: the batches draw LOD1 in the far band (ShadowRig's hysteresis). */
  setViewDistance(distance: number): void {
    const far = farTier(this.far, distance);
    if (far === this.far) return;
    this.far = far;
    for (const b of this.cells.values()) b.setFar(far);
  }

  /** In the far band now (tests, stats). */
  get farBand(): boolean {
    return this.far;
  }

  /**
   * True = the ship stays in its batch this frame (its live view stays out). A batched ship that is no
   * longer still, or whose look version moved, is taken out and its view shown again (false).
   */
  batched(id: string | number, view: Object3D, still: boolean, version: number): boolean {
    const t = this.tracked.get(id);
    if (!t) return false;
    if (t.version !== null) {
      if (still && t.version === version) return true;
      this.cells.get(t.cell)?.delete(id);
      t.version = null;
      this.show(t, view);
    }
    if (!still) t.frames = 0;
    return false;
  }

  /**
   * After the live view of a ship was posed and its decals updated: counts the still frames and bakes the
   * ship in once it has settled (the view leaves the scene graph from then on).
   */
  settle(id: string | number, view: Object3D, still: boolean, version: number): void {
    let t = this.tracked.get(id);
    if (!t) {
      t = { frames: 0, version: null, cell: '', never: false, parent: null };
      this.tracked.set(id, t);
    }
    if (t.version !== null || t.never) return;
    t.frames = still ? t.frames + 1 : 0;
    if (t.frames < SETTLE_FRAMES || this.bakes >= BAKES_PER_FRAME) return;
    this.bakes++;
    // the decals freeze apart (one InstancedMesh per batch), not as loose copies of the hull
    const decalMesh = view.getObjectByName(DECALS);
    const decalsShown = decalMesh?.visible ?? false;
    if (decalMesh) decalMesh.visible = false;
    const baked = bakeStatic(view);
    if (decalMesh) decalMesh.visible = decalsShown;
    if (baked.loose.length > 0) {
      // something that does not merge (transparent): the live view keeps drawing it all
      for (const m of baked.batches) m.geometry.dispose();
      t.never = true;
      return;
    }
    t.cell = this.cellOf(view);
    let batch = this.cells.get(t.cell);
    if (!batch) {
      batch = new WreckBatch(this.lod);
      batch.setFar(this.far);
      this.cells.set(t.cell, batch);
      this.object.add(batch.object);
    }
    batch.set(id, baked.batches, view.matrix, freezeDecals(view));
    t.version = version;
    this.hide(t, view);
  }

  /** The ship's view is rebuilt (cut, ripped, woken, clan set arrived) or gone: out of its batch, the view shown. */
  release(id: string | number, view?: Object3D): void {
    const t = this.tracked.get(id);
    if (t?.version != null) this.cells.get(t.cell)?.delete(id);
    this.tracked.delete(id);
    if (view && t) this.show(t, view);
    else if (view) view.visible = true;
  }

  /** The baked-in view leaves the scene graph: no matrix update, no traversal by the AO pass or the shadow sweep. */
  private hide(t: Tracked, view: Object3D): void {
    view.visible = false;
    t.parent = view.parent;
    view.removeFromParent();
  }

  private show(t: Tracked, view: Object3D): void {
    view.visible = true;
    if (t.parent && !view.parent) t.parent.add(view);
    t.parent = null;
  }

  private cellOf(view: Object3D): string {
    if (this.cellSize <= 0) return '';
    const p = view.position;
    return `${Math.floor(p.x / this.cellSize)},${Math.floor(p.z / this.cellSize)}`;
  }

  /** Is the ship in a batch now (tests, stats)? */
  has(id: string | number): boolean {
    const t = this.tracked.get(id);
    return t?.version != null && this.cells.get(t.cell)?.has(id) === true;
  }

  /** Ships in the batches. */
  get size(): number {
    let n = 0;
    for (const b of this.cells.values()) n += b.size;
    return n;
  }

  /** The cell batches (tests, debugging). */
  get batches(): readonly WreckBatch[] {
    return [...this.cells.values()];
  }

  /** Rebuilds the batches whose set changed; an emptied cell is dropped. */
  flush(): void {
    this.bakes = 0;
    for (const [key, batch] of this.cells) {
      batch.flush();
      if (batch.size > 0) continue;
      this.object.remove(batch.object);
      batch.dispose();
      this.cells.delete(key);
    }
  }

  dispose(): void {
    this.tracked.clear();
    for (const b of this.cells.values()) b.dispose();
    this.cells.clear();
    this.object.clear();
  }
}
