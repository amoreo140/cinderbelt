// Shape geometry of placed parts (SL2 E2, shaped parts design).
// Pure and deterministic.
//
// Fast path: a part without `shape` never reaches polygon code – `partPolygon`/`cellPolygon` answer null
// (= the full footprint), multipliers are 1 and sizes/points come from the part definition, so ships
// without shapes are bit-identical to before E2.
//
// Frames: a "part-centred" polygon has the part centre at the origin (+x bow, +y port at rot 0, CCW
// rotation by 90°·rot); a "grid" polygon is in ship-local cell coordinates (cell centres are integers).
// Every shape outline (and therefore every clip of it to a cell) is convex and CCW.
//
// This module must not import ./grid (grid imports `partSize` from here) – the footprint helpers below
// are the same formulas as grid's `footprintCells`/`footprintCenter`.
import { partDef } from '../../data/parts';
import { CURVE_SEGMENTS_RENDER, CURVE_SEGMENTS_SIM, SHAPEABLE_PARTS, SHAPES, SHAPE_IDS, isShapeId, type ShapeDef, type ShapeId } from '../../data/shapes';
import type { Vec2 } from '../math/vec2';
import { sizeHullPoints } from './budget';
import type { PlacedPart, Rotation } from './types';

/** A polygon, CCW; grid frame unless noted. */
export type Poly = readonly Vec2[];

export type ShapeDetail = 'sim' | 'render';

type SizedPart = Pick<PlacedPart, 'partId' | 'tier' | 'variant' | 'shape'>;

const EPS = 1e-9;
const ROTATIONS: readonly Rotation[] = [0, 1, 2, 3];

/** The part's shape definition, or undefined (no shape, or an unknown one – validators report that). */
const shapeDefOf = (p: Pick<PlacedPart, 'shape'>): ShapeDef | undefined =>
  p.shape === undefined ? undefined : isShapeId(p.shape) ? SHAPES[p.shape] : undefined;

/** Footprint at rot 0 (w along the bow): the shape's size when present, else the part's. */
export function partSize(p: SizedPart): { w: number; h: number } {
  if (p.shape !== undefined) {
    const def = shapeDefOf(p);
    if (def) return def.size;
  }
  return partDef(p.partId, p.tier, p.variant).size;
}

// ---------------------------------------------------------------------------------------------------
// Outline expansion and rotation

/** Expand the rot-0 outline of a shape into a polyline (arcs and ogives as chords). */
function expandOutline(def: ShapeDef, detail: ShapeDetail): Vec2[] {
  const segments = detail === 'sim' ? CURVE_SEGMENTS_SIM : CURVE_SEGMENTS_RENDER;
  const pts: Vec2[] = [def.start];
  let at = def.start;
  for (const seg of def.segs) {
    if (seg.kind === 'arc') {
      const { centre } = seg;
      const r = Math.hypot(at.x - centre.x, at.y - centre.y);
      const a0 = Math.atan2(at.y - centre.y, at.x - centre.x);
      let a1 = Math.atan2(seg.to.y - centre.y, seg.to.x - centre.x);
      while (a1 <= a0) a1 += 2 * Math.PI;
      const n = Math.max(1, Math.round(((a1 - a0) / (Math.PI / 2)) * segments.quarter));
      for (let i = 1; i < n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        pts.push({ x: centre.x + r * Math.cos(a), y: centre.y + r * Math.sin(a) });
      }
    } else if (seg.kind === 'ogive') {
      // parabola tangent to the x axis at its base (the end farther from y = 0)
      const fromBase = Math.abs(at.y) >= Math.abs(seg.to.y);
      const base = fromBase ? at : seg.to;
      const tip = fromBase ? seg.to : at;
      const n = segments.ogive;
      for (let i = 1; i < n; i++) {
        const s = fromBase ? i / n : 1 - i / n;
        pts.push({ x: base.x + (tip.x - base.x) * s, y: tip.y + (base.y - tip.y) * (1 - s * s) });
      }
    }
    pts.push(seg.to);
    at = seg.to;
  }
  pts.pop(); // the last segment closes back to `start`
  return pts;
}

/** Exact CCW rotation by 90°·rot (coordinate swaps, no trig); `+ 0` turns −0 into 0. */
function rotatePoint(v: Vec2, rot: Rotation): Vec2 {
  switch (rot) {
    case 0:
      return { x: v.x + 0, y: v.y + 0 };
    case 1:
      return { x: -v.y + 0, y: v.x + 0 };
    case 2:
      return { x: -v.x + 0, y: -v.y + 0 };
    case 3:
      return { x: v.y + 0, y: -v.x + 0 };
  }
}

const polyCache = new Map<string, Poly>();

/** The shape's outline, part-centred, rotated by `rot` (cached, frozen). */
export function shapePolygon(shape: ShapeId, rot: Rotation, detail: ShapeDetail = 'sim'): Poly {
  const key = `${shape}:${rot}:${detail}`;
  let poly = polyCache.get(key);
  if (!poly) {
    poly = Object.freeze(expandOutline(SHAPES[shape], detail).map((v) => Object.freeze(rotatePoint(v, rot))));
    polyCache.set(key, poly);
  }
  return poly;
}

/** Centre of a part's footprint (grid frame) – the same formula as grid's `footprintCenter`. */
function centreOf(p: PlacedPart, size: { w: number; h: number }): Vec2 {
  const [w, h] = p.rot % 2 === 0 ? [size.w, size.h] : [size.h, size.w];
  return { x: p.x + (w - 1) / 2, y: p.y + (h - 1) / 2 };
}

/** Cells of a part's footprint – the same order as grid's `footprintCells`. */
function cellsOf(p: PlacedPart): Vec2[] {
  const size = partSize(p);
  const [w, h] = p.rot % 2 === 0 ? [size.w, size.h] : [size.h, size.w];
  const out: Vec2[] = [];
  for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) out.push({ x: p.x + dx, y: p.y + dy });
  return out;
}

const translate = (poly: Poly, d: Vec2): Vec2[] => poly.map((v) => ({ x: v.x + d.x, y: v.y + d.y }));

/** The part's outline in the grid frame; null = the full footprint (no shape – the fast path). */
export function partPolygon(p: PlacedPart, detail: ShapeDetail = 'sim'): Poly | null {
  if (p.shape === undefined) return null;
  const def = shapeDefOf(p);
  if (!def) return null;
  return translate(shapePolygon(def.id, p.rot, detail), centreOf(p, def.size));
}

// ---------------------------------------------------------------------------------------------------
// Clipping to a cell

/** Sutherland–Hodgman clip of a polygon against the axis-aligned square [lo, hi] (both axes given). */
function clipToBox(poly: Poly, minX: number, maxX: number, minY: number, maxY: number): Vec2[] {
  // each plane: inside(v) ≥ 0, with the crossing parameter along an edge
  const planes: ((v: Vec2) => number)[] = [(v) => v.x - minX, (v) => maxX - v.x, (v) => v.y - minY, (v) => maxY - v.y];
  let out: Vec2[] = [...poly];
  for (const dist of planes) {
    if (out.length === 0) break;
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i]!;
      const b = input[(i + 1) % input.length]!;
      const da = dist(a);
      const db = dist(b);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
  }
  // drop repeated vertices (a vertex exactly on a clip plane is emitted twice)
  const clean: Vec2[] = [];
  for (const v of out) {
    const last = clean[clean.length - 1];
    if (!last || Math.abs(last.x - v.x) > EPS || Math.abs(last.y - v.y) > EPS) clean.push({ x: v.x + 0, y: v.y + 0 });
  }
  while (clean.length > 1 && Math.abs(clean[0]!.x - clean[clean.length - 1]!.x) <= EPS && Math.abs(clean[0]!.y - clean[clean.length - 1]!.y) <= EPS) {
    clean.pop();
  }
  return clean;
}

/** Part-centred cell clips (null = the cell is fully solid), keyed by shape, rot and the cell offset. */
const cellCache = new Map<string, Poly | null>();

/**
 * The part's outline clipped to one of its cells (grid frame, sim detail); null = the whole cell is
 * solid (always for a part without a shape). A cell outside the footprint of a shaped part is [].
 */
export function cellPolygon(p: PlacedPart, cell: Vec2): Poly | null {
  if (p.shape === undefined) return null;
  const def = shapeDefOf(p);
  if (!def) return null;
  const c = centreOf(p, def.size);
  const dx = cell.x - c.x;
  const dy = cell.y - c.y;
  const key = `${def.id}:${p.rot}:${dx}:${dy}`;
  let local = cellCache.get(key);
  if (local === undefined) {
    const clip = clipToBox(shapePolygon(def.id, p.rot, 'sim'), dx - 0.5, dx + 0.5, dy - 0.5, dy + 0.5);
    const area = clip.length >= 3 ? polygonArea(clip) : 0;
    local = area >= 1 - EPS ? null : Object.freeze(area <= EPS ? [] : clip.map((v) => Object.freeze(v)));
    cellCache.set(key, local);
  }
  return local === null ? null : translate(local, c);
}

// ---------------------------------------------------------------------------------------------------
// Measures

/** Signed area (positive for CCW). */
export function polygonArea(poly: Poly): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** Area centroid (the vertex mean for a degenerate polygon). */
export function polygonCentroid(poly: Poly): Vec2 {
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const cross = p.x * q.y - q.x * p.y;
    a2 += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a2) < 1e-12) {
    const n = Math.max(1, poly.length);
    return { x: poly.reduce((s, v) => s + v.x, 0) / n, y: poly.reduce((s, v) => s + v.y, 0) / n };
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

// ---------------------------------------------------------------------------------------------------
// Ray entry

/**
 * Where the segment from → to first enters the convex CCW polygon: t ∈ [0, 1] along the segment (0 when
 * `from` is inside or on the boundary), null when it misses. The boundary counts as solid (closed set,
 * like the arc slab test): grazing an edge or touching a vertex is a hit at the first contact.
 * Cyrus–Beck clipping; an empty or degenerate polygon is never hit.
 */
export function segmentPolygonEntry(from: Vec2, to: Vec2, poly: Poly): number | null {
  if (poly.length < 3) return null;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let tEnter = 0;
  let tLeave = 1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    // outward normal of a CCW edge
    const nx = b.y - a.y;
    const ny = a.x - b.x;
    const len = Math.hypot(nx, ny);
    if (len < EPS) continue; // a repeated vertex
    // inside: n·(p − a) ≤ 0 → t·den ≤ num
    const num = (nx * (a.x - from.x) + ny * (a.y - from.y)) / len;
    const den = (nx * dx + ny * dy) / len;
    if (Math.abs(den) < 1e-12) {
      if (num < -EPS) return null; // parallel and outside this edge
      continue;
    }
    const t = num / den;
    if (den < 0) {
      if (t > tEnter) tEnter = t;
    } else if (t < tLeave) tLeave = t;
    if (tEnter > tLeave + EPS) return null;
  }
  return tEnter;
}

// ---------------------------------------------------------------------------------------------------
// Mirror

/** (shape, rot) → its mirror image (y → −y), derived once by matching the mirrored polygons. */
let mirrorTable: Map<string, { shape: ShapeId; rot: Rotation }> | null = null;

const samePointSet = (a: Poly, b: Poly): boolean =>
  a.length === b.length && a.every((v) => b.some((w) => Math.abs(v.x - w.x) <= 1e-6 && Math.abs(v.y - w.y) <= 1e-6));

function buildMirrorTable(): Map<string, { shape: ShapeId; rot: Rotation }> {
  const table = new Map<string, { shape: ShapeId; rot: Rotation }>();
  for (const shape of SHAPE_IDS) {
    for (const rot of ROTATIONS) {
      const mirrored = shapePolygon(shape, rot, 'sim').map((v) => ({ x: v.x, y: -v.y }));
      let found: { shape: ShapeId; rot: Rotation } | null = null;
      for (const s of SHAPE_IDS) {
        for (const r of ROTATIONS) if (!found && samePointSet(mirrored, shapePolygon(s, r, 'sim'))) found = { shape: s, rot: r };
      }
      if (!found) throw new Error(`mirrorShape: no mirror image of ${shape} rot ${rot}`);
      table.set(`${shape}:${rot}`, found);
    }
  }
  return table;
}

/** The (shape, rot) whose outline is the mirror image (y → −y) of (shape, rot) – derived from polygons. */
export function mirrorShape(shape: ShapeId, rot: Rotation): { shape: ShapeId; rot: Rotation } {
  mirrorTable ??= buildMirrorTable();
  return mirrorTable.get(`${shape}:${rot}`)!;
}

// ---------------------------------------------------------------------------------------------------
// Solid sides

const FULL_SIDE: readonly [number, number] = Object.freeze([0, 1] as const);

/**
 * The solid interval of one side of one of the part's cells, as fractions [from, to] along the side;
 * null = the side has no solid edge (a point contact is not solid). Sides: 0 = +x, 1 = +y, 2 = −x,
 * 3 = −y. Fractions run along +y on sides 0 and 2 and along +x on sides 1 and 3, so the two sides of a
 * shared cell edge are directly comparable. A part without a shape: every side is [0, 1].
 */
export function sideSolid(p: PlacedPart, cell: Vec2, side: 0 | 1 | 2 | 3): readonly [number, number] | null {
  const poly = cellPolygon(p, cell);
  if (poly === null) return FULL_SIDE;
  const vertical = side === 0 || side === 2;
  const line = vertical ? cell.x + (side === 0 ? 0.5 : -0.5) : cell.y + (side === 1 ? 0.5 : -0.5);
  const origin = vertical ? cell.y - 0.5 : cell.x - 0.5;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const [aOn, bOn] = vertical ? [a.x, b.x] : [a.y, b.y];
    if (Math.abs(aOn - line) > EPS || Math.abs(bOn - line) > EPS) continue;
    const [aAlong, bAlong] = vertical ? [a.y, b.y] : [a.x, b.x];
    lo = Math.min(lo, aAlong - origin, bAlong - origin);
    hi = Math.max(hi, aAlong - origin, bAlong - origin);
  }
  if (!(hi - lo > EPS)) return null;
  const clamp = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 1e9) / 1e9 + 0;
  return [clamp(lo), clamp(hi)];
}

/** Length of the solid edges two parts share (in cells; full neighbours: the number of shared cell sides). */
export function solidContact(a: PlacedPart, b: PlacedPart): number {
  const aCells = cellsOf(a);
  const bCells = cellsOf(b);
  const plain = a.shape === undefined && b.shape === undefined;
  let total = 0;
  for (const c of aCells) {
    for (const d of bCells) {
      const dx = d.x - c.x;
      const dy = d.y - c.y;
      if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
      if (plain) {
        total += 1;
        continue;
      }
      const side = (dx === 1 ? 0 : dy === 1 ? 1 : dx === -1 ? 2 : 3) as 0 | 1 | 2 | 3;
      const sa = sideSolid(a, c, side);
      const sb = sideSolid(b, d, ((side + 2) % 4) as 0 | 1 | 2 | 3);
      if (sa && sb) total += Math.max(0, Math.min(sa[1], sb[1]) - Math.max(sa[0], sb[0]));
    }
  }
  return total;
}

// ---------------------------------------------------------------------------------------------------
// Rules and multipliers

/** Why a part's shape is not allowed (editor, template codec, save validator); null = fine or no shape. */
export function shapeProblem(p: Pick<PlacedPart, 'partId' | 'shape'>): 'unknownShape' | 'shapeNotAllowed' | null {
  if (p.shape === undefined) return null;
  if (!isShapeId(p.shape)) return 'unknownShape';
  return SHAPEABLE_PARTS.has(p.partId) ? null : 'shapeNotAllowed';
}

/** Max HP multiplier of the part's shape (= its area); 1 without a shape. */
export const hpMultOf = (p: PlacedPart): number => (p.shape === undefined ? 1 : (shapeDefOf(p)?.area ?? 1));

/** Mass multiplier of the part's shape (= its area); 1 without a shape. */
export const massMultOf = (p: PlacedPart): number => (p.shape === undefined ? 1 : (shapeDefOf(p)?.area ?? 1));

/** Hull points of the part with its shape (½ steps); without a shape the size-based points. */
export const shapeHullPoints = (p: PlacedPart): number => {
  const def = p.shape === undefined ? undefined : shapeDefOf(p);
  return def ? def.points : sizeHullPoints(partSize(p));
};
