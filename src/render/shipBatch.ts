// Static batching of a ship hull (audit 2026-10-16, issue #4): every part model is its own small
// mesh, and on High each one is drawn in the main pass, the shadow map and the AO pre-pass. All part
// models share the AF_Palette atlas, so the static meshes of a hull (part bodies and hull connectors)
// merge into one mesh per material; only the nodes that move on their own (turrets, laser and
// tractor heads, gyro rings, radar dish) and the engine flames stay separate. Static nodes freeze
// their local matrices. A part shot off rebuilds the whole view (ShipView.rebuild), so a batch never
// has to drop a part in place.
//
// Damage decals (decals/HullDecals.ts) raycast the part's surface: each part gets a detached "probe"
// copy of its static meshes in the hull's local frame (shared geometry, nothing is drawn).
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedMesh,
  InterleavedBufferAttribute,
  Material,
  Matrix3,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Sphere,
  Vector3,
  type Texture,
  type TypedArray,
} from 'three';

/** Nodes that rotate on their own (ShipView animates them) – never merged, nor anything below. */
export const MOVING_NODE = /^(Laser_Head|Cannon_Turret|Tractor_Head|Gyro_Ring_Outer|Gyro_Ring_Inner|Radar_Dish)$/;

/** One mesh (or one instance of a hull connector) to merge, with its matrix in the hull's frame. */
export interface BatchSource {
  geometry: BufferGeometry;
  matrix: Matrix4;
}

const texKey = (t: Texture | null | undefined): string => (t ? t.uuid : '-');
const rgb = (c: { r: number; g: number; b: number }): string => `${c.r},${c.g},${c.b}`;

/**
 * Materials that draw the same: the part GLBs each bring their own copy of AF_Palette with the same
 * parameters and the same shared atlas textures. Only plain opaque MeshStandardMaterials (patched
 * at most by the rim light, whose uniforms are shared) are merged across instances; anything else
 * keys by identity. Null = do not batch (transparent – keeps its own sorting). `ignoreColor` leaves
 * the base colour out (graveyard batches carry it per vertex – sites/wreckBatch.ts).
 */
export function materialKey(m: Material, ignoreColor = false): string | null {
  if (m.transparent) return null;
  if (!(m instanceof MeshStandardMaterial) || m.type !== 'MeshStandardMaterial') return `id:${m.uuid}`;
  const patched = m.onBeforeCompile !== Material.prototype.onBeforeCompile;
  if (patched && m.userData.cinderRim !== true) return `id:${m.uuid}`;
  return [
    m.customProgramCacheKey(),
    texKey(m.map), texKey(m.roughnessMap), texKey(m.metalnessMap), texKey(m.emissiveMap), texKey(m.normalMap),
    texKey(m.aoMap), texKey(m.alphaMap), texKey(m.lightMap), texKey(m.bumpMap), texKey(m.displacementMap), texKey(m.envMap),
    ignoreColor ? '-' : rgb(m.color), rgb(m.emissive), m.emissiveIntensity, m.roughness, m.metalness, m.opacity, m.alphaTest, m.side,
    m.vertexColors, m.flatShading, m.wireframe, m.fog, m.toneMapped, m.depthTest, m.depthWrite, m.colorWrite, m.blending,
    m.polygonOffset ? `${m.polygonOffsetFactor}/${m.polygonOffsetUnits}` : 0,
    m.normalScale.x, m.normalScale.y, m.aoMapIntensity, m.envMapIntensity, m.clippingPlanes?.length ?? 0,
    JSON.stringify(m.defines ?? {}), String(m.userData.afClan ?? ''),
  ].join('|');
}

/**
 * Batch group of a mesh (material, attribute layout, draw order), or null = leave it alone.
 * `instances` = an InstancedMesh whose instances are merged (hull connectors); `ignoreColor` see
 * `materialKey`.
 */
export function batchKey(mesh: Mesh, instances = false, ignoreColor = false): string | null {
  if ((mesh instanceof InstancedMesh) !== instances || (mesh as Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh) return null;
  if (Array.isArray(mesh.material) || !mesh.visible) return null;
  const g = mesh.geometry;
  if (Object.keys(g.morphAttributes).length > 0 || !g.getAttribute('position')) return null;
  const mat = materialKey(mesh.material, ignoreColor);
  if (mat === null) return null;
  const attrs = Object.keys(g.attributes).sort().map((n) => `${n}${g.getAttribute(n).itemSize}`).join(',');
  return `${mat}#${attrs}#${mesh.renderOrder}#${mesh.layers.mask}#${mesh.userData.noShadow === true}#${mesh.userData.noAO === true}`;
}

/** Raw access to an attribute, plain or interleaved (meshopt pads normals into interleaved buffers). */
interface View {
  array: TypedArray;
  stride: number;
  offset: number;
  size: number;
  normalized: boolean;
  /** Multiplier from the stored integer to −1…1 / 0…1 (1 for floats). */
  scale: number;
  signed: boolean;
}

function viewOf(a: BufferAttribute | InterleavedBufferAttribute): View {
  const inter = a instanceof InterleavedBufferAttribute;
  const array = (inter ? a.data.array : a.array) as TypedArray;
  let scale = 1;
  let signed = false;
  if (a.normalized) {
    if (array instanceof Int8Array) (scale = 1 / 127), (signed = true);
    else if (array instanceof Int16Array) (scale = 1 / 32767), (signed = true);
    else if (array instanceof Int32Array) (scale = 1 / 2147483647), (signed = true);
    else if (array instanceof Uint8Array) scale = 1 / 255;
    else if (array instanceof Uint16Array) scale = 1 / 65535;
    else if (array instanceof Uint32Array) scale = 1 / 4294967295;
  }
  return { array, stride: inter ? a.data.stride : a.itemSize, offset: inter ? a.offset : 0, size: a.itemSize, normalized: a.normalized, scale, signed };
}

/** Same array type and normalisation in every source – the merged attribute keeps it (UVs stay 16-bit). */
function commonArray(views: readonly View[]): { ctor: new (n: number) => TypedArray; normalized: boolean } | null {
  const first = views[0]!;
  const ctor = first.array.constructor as new (n: number) => TypedArray;
  for (const w of views) if (w.array.constructor !== ctor || w.normalized !== first.normalized) return null;
  return { ctor, normalized: first.normalized };
}

const nm = new Matrix3();

/**
 * Merges the sources into one geometry in the hull's frame: positions by the matrix, normals and
 * tangents by its rotation (renormalised), other attributes copied (their own array type when all
 * sources agree, Float32 otherwise). A mirrored source gets its winding flipped. All sources must
 * have the same attribute names (batchKey groups them so). Plain typed-array loops – a 28-part hull
 * with its connectors is ~50 k vertices and merges on a part loss mid-fight.
 */
export function mergeSources(sources: readonly BatchSource[]): BufferGeometry {
  const first = sources[0]!.geometry;
  const names = Object.keys(first.attributes);
  const counts = sources.map((s) => s.geometry.getAttribute('position').count);
  let vertices = 0;
  let indices = 0;
  sources.forEach((s, k) => {
    vertices += counts[k]!;
    indices += s.geometry.index ? s.geometry.index.count : counts[k]!;
  });
  const out = new BufferGeometry();
  for (const name of names) {
    const views = sources.map((s) => viewOf(s.geometry.getAttribute(name) as BufferAttribute | InterleavedBufferAttribute));
    const size = views[0]!.size;
    const transformed = name === 'position' || name === 'normal' || name === 'tangent';
    const common = transformed ? null : commonArray(views);
    const array = common ? new common.ctor(vertices * size) : new Float32Array(vertices * size);
    let o = 0;
    for (let k = 0; k < sources.length; k++) {
      const s = sources[k]!;
      const { array: src, stride, offset, scale, signed } = views[k]!;
      const n = counts[k]!;
      // signed normalised values clamp at −1 (−128 / 127 for int8)
      const lo = signed ? -1 : -Infinity;
      if (name === 'position') {
        const e = s.matrix.elements;
        for (let i = 0, j = offset; i < n; i++, j += stride, o += 3) {
          const x = Math.max(src[j]! * scale, lo);
          const y = Math.max(src[j + 1]! * scale, lo);
          const z = Math.max(src[j + 2]! * scale, lo);
          const w = 1 / (e[3]! * x + e[7]! * y + e[11]! * z + e[15]!);
          array[o] = (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) * w;
          array[o + 1] = (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) * w;
          array[o + 2] = (e[2]! * x + e[6]! * y + e[10]! * z + e[14]!) * w;
        }
      } else if (name === 'normal' || name === 'tangent') {
        // normals by the normal matrix, tangents by the rotation part
        const m = name === 'normal' ? nm.getNormalMatrix(s.matrix).elements : nm.setFromMatrix4(s.matrix).elements;
        const flip = s.matrix.determinant() < 0 ? -1 : 1;
        for (let i = 0, j = offset; i < n; i++, j += stride, o += size) {
          const x = Math.max(src[j]! * scale, lo);
          const y = Math.max(src[j + 1]! * scale, lo);
          const z = Math.max(src[j + 2]! * scale, lo);
          const tx = m[0]! * x + m[3]! * y + m[6]! * z;
          const ty = m[1]! * x + m[4]! * y + m[7]! * z;
          const tz = m[2]! * x + m[5]! * y + m[8]! * z;
          const inv = 1 / (Math.sqrt(tx * tx + ty * ty + tz * tz) || 1);
          array[o] = tx * inv;
          array[o + 1] = ty * inv;
          array[o + 2] = tz * inv;
          if (size === 4) array[o + 3] = Math.max(src[j + 3]! * scale, lo) * flip;
        }
      } else if (common && stride === size && offset === 0) {
        array.set(src.subarray(0, n * size), o);
        o += n * size;
      } else if (common) {
        // the raw values (same type everywhere), from an interleaved buffer
        for (let i = 0, j = offset; i < n; i++, j += stride, o += size) for (let c = 0; c < size; c++) array[o + c] = src[j + c]!;
      } else {
        for (let i = 0, j = offset; i < n; i++, j += stride, o += size) for (let c = 0; c < size; c++) array[o + c] = Math.max(src[j + c]! * scale, lo);
      }
    }
    out.setAttribute(name, new BufferAttribute(array, size, common?.normalized ?? false));
    if (name === 'position') bounds(out, array);
  }
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let base = 0;
  let o = 0;
  for (let k = 0; k < sources.length; k++) {
    const s = sources[k]!;
    const n = counts[k]!;
    const src = s.geometry.index?.array as TypedArray | undefined;
    // a mirrored source keeps its triangles facing out: swap two corners
    const [b1, b2] = s.matrix.determinant() < 0 ? [2, 1] : [1, 2];
    if (src) {
      for (let i = 0; i < src.length; i += 3) {
        index[o++] = base + src[i]!;
        index[o++] = base + src[i + b1]!;
        index[o++] = base + src[i + b2]!;
      }
    } else {
      for (let i = 0; i < n; i += 3) {
        index[o++] = base + i;
        index[o++] = base + i + b1;
        index[o++] = base + i + b2;
      }
    }
    base += n;
  }
  out.setIndex(new BufferAttribute(index, 1));
  return out;
}

/** Bounding box and sphere (centred on the box, like three.js) of merged positions. */
function bounds(g: BufferGeometry, p: TypedArray): void {
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i]!;
    const y = p[i + 1]!;
    const z = p[i + 2]!;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  const box = new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1));
  const c = box.getCenter(new Vector3());
  let r2 = 0;
  for (let i = 0; i < p.length; i += 3) {
    const dx = p[i]! - c.x;
    const dy = p[i + 1]! - c.y;
    const dz = p[i + 2]! - c.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > r2) r2 = d;
  }
  g.boundingBox = box;
  g.boundingSphere = new Sphere(c, Math.sqrt(r2));
}

export interface BakedHull {
  /** The merged meshes added to the hull (one per batch group with more than one source). */
  batches: Mesh[];
  /** Detached copies of each part's static meshes in the hull frame (same order as `parts`). */
  probes: Group[];
  /** Detached root of the probes (identity = the hull's frame). */
  probeRoot: Group;
}

interface Entry {
  /** Source mesh, or null for a connector instance. */
  mesh: Mesh | null;
  connector: InstancedMesh | null;
  material: Material;
  source: BatchSource;
  castShadow: boolean;
  receiveShadow: boolean;
  renderOrder: number;
}

/**
 * Bakes a built hull in place: merges the static meshes of `parts` (direct children of `hull`) and
 * the instances of the hull `connectors` per batch group, removes what was merged from the scene
 * graph (a merged mesh that has children becomes a plain node), prunes the nodes left empty unless
 * `keep` holds them, and freezes the local matrices of every static node.
 */
export function bakeHull(hull: Group, parts: readonly Object3D[], connectors: readonly InstancedMesh[], keep: ReadonlySet<Object3D>): BakedHull {
  hull.updateMatrix();
  const groups = new Map<string, Entry[]>();
  const add = (key: string, e: Entry) => {
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  };
  const probeRoot = new Group();
  const probes: Group[] = [];

  const walk = (o: Object3D, parent: Matrix4, probe: Group) => {
    // a kept node moves on its own (ShipView's workshop rig) – never merged, nor anything below
    if (MOVING_NODE.test(o.name) || keep.has(o)) return;
    o.updateMatrix();
    const matrix = new Matrix4().multiplyMatrices(parent, o.matrix);
    if (o instanceof Mesh && !(o instanceof InstancedMesh)) {
      const p = new Mesh(o.geometry, o.material);
      p.matrixAutoUpdate = false;
      p.matrix.copy(matrix);
      probe.add(p);
      const key = batchKey(o);
      if (key !== null) add(key, { mesh: o, connector: null, material: o.material as Material, source: { geometry: o.geometry, matrix }, castShadow: o.castShadow, receiveShadow: o.receiveShadow, renderOrder: o.renderOrder });
    }
    for (const c of o.children) walk(c, matrix, probe);
  };
  const identity = new Matrix4();
  for (const part of parts) {
    const probe = new Group();
    probe.name = part.name;
    probe.userData.afPart = part.userData.afPart;
    probeRoot.add(probe);
    probes.push(probe);
    walk(part, identity, probe);
  }

  // hull connectors: each instance of each template mesh joins the batch of its material
  const instance = new Matrix4();
  for (const c of connectors) {
    const key = batchKey(c, true);
    if (key === null) continue;
    c.updateMatrix();
    for (let i = 0; i < c.count; i++) {
      c.getMatrixAt(i, instance);
      add(key, { mesh: null, connector: c, material: c.material as Material, source: { geometry: c.geometry, matrix: new Matrix4().multiplyMatrices(c.matrix, instance) }, castShadow: c.castShadow, receiveShadow: c.receiveShadow, renderOrder: c.renderOrder });
    }
  }

  const batches: Mesh[] = [];
  const merged = new Set<Mesh>();
  const mergedConnectors = new Set<InstancedMesh>();
  for (const [key, list] of groups) {
    // a lone mesh draws the same on its own; a lone connector instance still replaces its InstancedMesh
    if (list.length < 2 && list[0]!.mesh) continue;
    const mesh = new Mesh(mergeSources(list.map((e) => e.source)), list[0]!.material);
    mesh.name = 'ship-batch';
    mesh.castShadow = list[0]!.castShadow;
    mesh.receiveShadow = list[0]!.receiveShadow;
    mesh.renderOrder = list[0]!.renderOrder;
    mesh.matrixAutoUpdate = false;
    mesh.userData.batchKey = key;
    batches.push(mesh);
    for (const e of list) {
      if (e.mesh) merged.add(e.mesh);
      if (e.connector) mergedConnectors.add(e.connector);
    }
  }

  // take the merged meshes out of the graph
  takeOut(merged, hull, keep);
  for (const c of mergedConnectors) hull.remove(c);
  for (const b of batches) hull.add(b);

  // freeze the static nodes (moving nodes and the flames keep updating)
  const freeze = (o: Object3D) => {
    if (MOVING_NODE.test(o.name) || keep.has(o)) return;
    o.updateMatrix();
    o.matrixAutoUpdate = false;
    for (const c of o.children) freeze(c);
  };
  for (const part of parts) if (part.parent === hull) freeze(part);
  hull.matrixAutoUpdate = false;
  return { batches, probes, probeRoot };
}

/**
 * Takes merged meshes out of the scene graph below `root`: a mesh with children (a turret on its
 * base, thruster nodes on a hull) leaves a plain node with the same transform in its place, an
 * empty one goes along with the ancestors it leaves empty (unless `keep` holds them).
 */
export function takeOut(meshes: Iterable<Mesh>, root: Object3D, keep: ReadonlySet<Object3D> = new Set()): void {
  for (const mesh of meshes) {
    const parent = mesh.parent;
    if (!parent) continue;
    if (mesh.children.length > 0) {
      const stub = new Object3D();
      stub.name = mesh.name;
      stub.userData = mesh.userData;
      stub.position.copy(mesh.position);
      stub.quaternion.copy(mesh.quaternion);
      stub.scale.copy(mesh.scale);
      for (const c of [...mesh.children]) stub.add(c);
      parent.children[parent.children.indexOf(mesh)] = stub;
      stub.parent = parent;
      mesh.parent = null;
    } else {
      parent.remove(mesh);
      prune(parent, root, keep);
    }
  }
}

/** Removes `node` and its ancestors below `hull` while they are empty and not kept. */
function prune(node: Object3D, hull: Object3D, keep: ReadonlySet<Object3D>): void {
  let n: Object3D | null = node;
  while (n && n !== hull && n.children.length === 0 && !keep.has(n) && !(n instanceof Mesh)) {
    const parent: Object3D | null = n.parent;
    parent?.remove(n);
    n = parent;
  }
}

/** A frozen copy of a whole ship (bakeStatic): merged meshes plus the meshes that cannot merge. */
export interface StaticShip {
  /** Merged meshes, one per batch group; their geometries are new (the caller disposes them). */
  batches: Mesh[];
  /** Visible meshes that do not batch (transparent, special materials) – template geometry, shared. */
  loose: Mesh[];
}

/**
 * Freezes a built ship for display only (parked ships in the hangar hall, M4a): every visible mesh
 * below `root` – the moving nodes too, since nothing on a parked ship turns – and every instance of
 * the hull connectors merge per batch group into one mesh in `root`'s frame. Hidden meshes (engine
 * flames) are left out. `material` maps each source material to the one the copy draws with (a
 * dimmed clone); batch groups are keyed by the source material, so the map must be stable per key.
 * Nothing is added to `root`; the returned meshes are new, detached and frozen.
 */
export function bakeStatic(root: Object3D, material: (m: Material) => Material = (m) => m): StaticShip {
  root.updateMatrixWorld(true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, { material: Material; sources: BatchSource[]; castShadow: boolean; receiveShadow: boolean; renderOrder: number }>();
  const loose: Mesh[] = [];
  const instance = new Matrix4();
  const visit = (o: Object3D): void => {
    if (!o.visible) return;
    if (o instanceof Mesh && !Array.isArray(o.material)) {
      const placed = new Matrix4().multiplyMatrices(toRoot, o.matrixWorld);
      const instanced = o instanceof InstancedMesh;
      const key = batchKey(o, instanced);
      const list: Matrix4[] = [];
      if (instanced) {
        for (let i = 0; i < o.count; i++) list.push(new Matrix4().multiplyMatrices(placed, o.getMatrixAt(i, instance)));
      } else list.push(placed);
      if (key === null) {
        for (const m of list) {
          const copy = new Mesh(o.geometry, material(o.material as Material));
          copy.matrixAutoUpdate = false;
          copy.matrix.copy(m);
          copy.renderOrder = o.renderOrder;
          loose.push(copy);
        }
      } else {
        let g = groups.get(key);
        if (!g) {
          g = { material: material(o.material as Material), sources: [], castShadow: o.castShadow, receiveShadow: o.receiveShadow, renderOrder: o.renderOrder };
          groups.set(key, g);
        }
        for (const m of list) g.sources.push({ geometry: o.geometry, matrix: m });
      }
    }
    for (const c of o.children) visit(c);
  };
  for (const c of root.children) visit(c);
  const batches: Mesh[] = [];
  for (const [key, g] of groups) {
    const mesh = new Mesh(mergeSources(g.sources), g.material);
    mesh.name = 'ship-static';
    mesh.castShadow = g.castShadow;
    mesh.receiveShadow = g.receiveShadow;
    mesh.renderOrder = g.renderOrder;
    mesh.matrixAutoUpdate = false;
    mesh.userData.batchKey = key;
    batches.push(mesh);
  }
  return { batches, loose };
}
