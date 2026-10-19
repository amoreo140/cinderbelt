// Shaved player armour corners (SL2 E1, spec §3.2 step 7, §3.3): the armour model is clipped at
// runtime by the vertical 45° plane through each masked corner (legs `BEVEL` = 0.25). Triangles
// outside the plane are dropped, triangles across it are cut (attributes interpolated); no cap faces –
// the hull shell's band and lip run along the cut and cover it. One variant per (template, mask) – at
// most 15 per armour template (= per tier / clan set), cached for the session; its geometry is shared
// by every view that clones it and never disposed by a view.
//
// Mode `'deck'` (terrace v2, plan 2026-10-20 §2.8 rule 4): the armour under a terrace slab is cut at
// `TERRACE_CLIP_Z` (just over the deck top) – pads, chevrons and bolts go, the deck plate and the core
// stay – so no geometry is drawn under the slab and nothing pokes through it. One more variant per
// template; inner cells are never bevelled, so the two kinds never combine.
import { BufferAttribute, BufferGeometry, Matrix4, Mesh, Vector3, type InterleavedBufferAttribute, type Object3D, type TypedArray } from 'three';
import { BEVEL_FP, BEVEL_FS, BEVEL_RP, BEVEL_RS } from '../../sim/ship/outline';
import type { Rotation } from '../../sim/ship/types';
import { BEVEL, TERRACE_CLIP_Z } from './shellConstants';

/**
 * The bevel mask of `HullOutline.bevels` (grid frame) turned into the armour model's own frame for a
 * part placed with rotation `rot` (the part node is turned by rot · 90° counter-clockwise). Bits:
 * 1 front-port, 2 rear-port, 4 rear-starboard, 8 front-starboard – counter-clockwise, so a turn is a
 * 4-bit rotation.
 */
export function armourLocalMask(gridMask: number, rot: Rotation): number {
  const m = gridMask & 15;
  const k = rot & 3;
  return ((m >> k) | (m << (4 - k))) & 15;
}

/** Corner directions of the mask bits in the part's grid frame (+x bow, +y port). */
const CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [BEVEL_FP, 1, 1],
  [BEVEL_RP, -1, 1],
  [BEVEL_RS, -1, -1],
  [BEVEL_FS, 1, -1],
];

/** Kept side of a corner plane: sx·x + sy·y ≤ 1 − BEVEL (cell corner at (±0.5, ±0.5), legs BEVEL). */
const PLANE_C = 1 - BEVEL;

const cache = new WeakMap<Object3D, Map<number, Object3D>>();
/** Cache key of the deck-clipped variant (corner masks use 1…15). */
const DECK_KEY = 16;

/**
 * The armour template with the corners of `localMask` (`armourLocalMask`) shaved, or – `'deck'` –
 * cut at `TERRACE_CLIP_Z` (the armour under a terrace). Mask 0 → the template itself. The result is a
 * template too: clone it like the others (shared geometry). Meshes left without a triangle are
 * dropped from the variant.
 * Frame: the template's root is the part node's frame (three.js: x = bow, −z = port at rot 0, y up).
 */
export function clipArmour(template: Object3D, localMask: number | 'deck'): Object3D {
  const deck = localMask === 'deck';
  const mask = deck ? DECK_KEY : localMask & 15;
  if (mask === 0) return template;
  let variants = cache.get(template);
  if (!variants) {
    variants = new Map();
    cache.set(template, variants);
  }
  const hit = variants.get(mask);
  if (hit) return hit;
  const planes: [number, number][] = [];
  if (!deck) for (const [bit, sx, sy] of CORNERS) if (mask & bit) planes.push([sx, sy]);

  const variant = template.clone();
  variant.userData.afArmourClip = deck ? 'deck' : mask;
  // mesh → root matrices, read from the original (same structure as the clone)
  template.updateMatrixWorld(true);
  const rootInv = new Matrix4().copy(template.matrixWorld).invert();
  const srcMeshes: Mesh[] = [];
  template.traverse((o) => {
    if (o instanceof Mesh) srcMeshes.push(o);
  });
  const dstMeshes: Mesh[] = [];
  variant.traverse((o) => {
    if (o instanceof Mesh) dstMeshes.push(o);
  });
  const done = new Map<BufferGeometry, BufferGeometry>();
  for (let i = 0; i < srcMeshes.length && i < dstMeshes.length; i++) {
    const src = srcMeshes[i]!;
    const toRoot = new Matrix4().multiplyMatrices(rootInv, src.matrixWorld);
    let g = done.get(src.geometry);
    if (!g) {
      g = clipGeometry(src.geometry, toRoot, planes, deck ? TERRACE_CLIP_Z : null);
      done.set(src.geometry, g);
    }
    dstMeshes[i]!.geometry = g;
  }
  for (const m of dstMeshes) if (m.geometry.index?.count === 0) m.removeFromParent();
  variants.set(mask, variant);
  return variant;
}

/** Cached clipped variants of a template – at most CLIP_ARMOUR_MAX_VARIANTS (the non-empty masks + deck). */
export function clipArmourVariants(template: Object3D): number {
  return cache.get(template)?.size ?? 0;
}

type Attr = BufferAttribute | InterleavedBufferAttribute;

/**
 * Clips a geometry (vertices mapped to the part frame by `toRoot`) against the planes
 * `sx·x + sy·(−z) ≤ PLANE_C` and, with `maxHeight`, the horizontal plane `y ≤ maxHeight`. Keeps the
 * attribute names, item sizes, array types and normalisation; the result is indexed and holds only
 * the vertices still used.
 */
export function clipGeometry(
  geometry: BufferGeometry,
  toRoot: Matrix4,
  corners: ReadonlyArray<readonly [number, number]>,
  maxHeight: number | null = null,
): BufferGeometry {
  // plane i: a·x + b·y + c·h ≤ d (x, y part-frame grid coordinates, h height)
  const planes: [number, number, number, number][] = corners.map(([sx, sy]) => [sx, sy, 0, PLANE_C]);
  if (maxHeight !== null) planes.push([0, 0, 1, maxHeight]);
  const names = Object.keys(geometry.attributes);
  const attrs = names.map((n) => geometry.getAttribute(n) as Attr);
  const pos = geometry.getAttribute('position') as Attr;
  const count0 = pos.count;
  // vertex store: original values + new interpolated vertices, per attribute flat arrays
  const values: number[][] = attrs.map((a) => {
    const out: number[] = new Array<number>(count0 * a.itemSize);
    for (let v = 0; v < count0; v++) for (let c = 0; c < a.itemSize; c++) out[v * a.itemSize + c] = a.getComponent(v, c);
    return out;
  });
  // part-frame grid coordinates per vertex (gx = x, gy = −z) and height (gh = y)
  const gx: number[] = [];
  const gy: number[] = [];
  const gh: number[] = [];
  const p = new Vector3();
  for (let v = 0; v < count0; v++) {
    p.fromBufferAttribute(pos, v).applyMatrix4(toRoot);
    gx.push(p.x);
    gy.push(-p.z);
    gh.push(p.y);
  }
  let count = count0;
  const normalIdx = names.indexOf('normal');
  const lerpCache = new Map<string, number>();
  const lerp = (a: number, b: number, t: number, plane: number): number => {
    const key = a < b ? `${plane}:${a}:${b}` : `${plane}:${b}:${a}`;
    const hit = lerpCache.get(key);
    if (hit !== undefined) return hit;
    // keep the interpolation symmetric so the shared edge gets the very same vertex from both sides
    const [lo, hi, s] = a < b ? [a, b, t] : [b, a, 1 - t];
    for (let k = 0; k < attrs.length; k++) {
      const size = attrs[k]!.itemSize;
      const arr = values[k]!;
      for (let c = 0; c < size; c++) arr.push(arr[lo * size + c]! + (arr[hi * size + c]! - arr[lo * size + c]!) * s);
      if (k === normalIdx && size >= 3) {
        const o = count * size;
        const l = Math.hypot(arr[o]!, arr[o + 1]!, arr[o + 2]!) || 1;
        arr[o] = arr[o]! / l;
        arr[o + 1] = arr[o + 1]! / l;
        arr[o + 2] = arr[o + 2]! / l;
      }
    }
    gx.push(gx[lo]! + (gx[hi]! - gx[lo]!) * s);
    gy.push(gy[lo]! + (gy[hi]! - gy[lo]!) * s);
    gh.push(gh[lo]! + (gh[hi]! - gh[lo]!) * s);
    lerpCache.set(key, count);
    return count++;
  };

  const index = geometry.index;
  const triCount = index ? index.count / 3 : count0 / 3;
  const vi = (t: number): number => (index ? index.getX(t) : t);
  const outIdx: number[] = [];
  const groups = geometry.groups.length > 0 ? geometry.groups : [{ start: 0, count: triCount * 3, materialIndex: 0 }];
  const outGroups: { start: number; count: number; materialIndex?: number }[] = [];
  for (const grp of groups) {
    const start = outIdx.length;
    const t0 = grp.start / 3;
    const t1 = Math.min(triCount, (grp.start + grp.count) / 3);
    for (let t = t0; t < t1; t++) {
      let poly = [vi(t * 3), vi(t * 3 + 1), vi(t * 3 + 2)];
      for (let pl = 0; pl < planes.length && poly.length >= 3; pl++) {
        const [a, b, c, d] = planes[pl]!;
        const dist = (v: number): number => a * gx[v]! + b * gy[v]! + c * gh[v]! - d;
        const next: number[] = [];
        for (let q = 0; q < poly.length; q++) {
          const a = poly[q]!;
          const b = poly[(q + 1) % poly.length]!;
          const da = dist(a);
          const db = dist(b);
          if (da <= 0) next.push(a);
          if ((da < 0 && db > 0) || (da > 0 && db < 0)) next.push(lerp(a, b, da / (da - db), pl));
        }
        poly = next;
      }
      for (let q = 1; q + 1 < poly.length; q++) outIdx.push(poly[0]!, poly[q]!, poly[q + 1]!);
    }
    outGroups.push({ start, count: outIdx.length - start, materialIndex: grp.materialIndex });
  }

  // compact: only the vertices still used, in first-use order
  const remap = new Int32Array(count).fill(-1);
  let used = 0;
  for (let i = 0; i < outIdx.length; i++) {
    const v = outIdx[i]!;
    if (remap[v]! < 0) remap[v] = used++;
    outIdx[i] = remap[v]!;
  }
  const out = new BufferGeometry();
  for (let k = 0; k < attrs.length; k++) {
    const a = attrs[k]!;
    const size = a.itemSize;
    const srcArray = ('data' in a && a.data ? a.data.array : (a as BufferAttribute).array) as TypedArray;
    const Ctor = srcArray.constructor as new (n: number) => TypedArray;
    const attr = new BufferAttribute(new Ctor(used * size), size, a.normalized);
    const arr = values[k]!;
    for (let v = 0; v < count; v++) {
      const r = remap[v]!;
      if (r < 0) continue;
      for (let c = 0; c < size; c++) attr.setComponent(r, c, arr[v * size + c]!);
    }
    out.setAttribute(names[k]!, attr);
  }
  out.setIndex(new BufferAttribute(used > 65535 ? Uint32Array.from(outIdx) : Uint16Array.from(outIdx), 1));
  if (geometry.groups.length > 0) for (const g of outGroups) out.addGroup(g.start, g.count, g.materialIndex);
  out.name = geometry.name;
  out.userData = { ...geometry.userData, afArmourClip: planes.length };
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
