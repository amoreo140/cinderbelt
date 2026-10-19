// Sampling grid and polygons of sectors (§6.8):
//  - label tiles: 1000 × 1000 u tiles of region labels at 50 / 100 / 200 u (zoom levels). A tile is a
//    pure function of (seed, variant, tile, step) with a transferable result, so it can be built in
//    idle time or in a worker and cached; map borders come from the grid, not from sector envelopes.
//  - region masks: a flood fill from the seed on a fixed grid (also the connectivity check);
//  - polygons: the outline of the mask (pixel edges chained into loops, Douglas–Peucker simplified),
//    built only for sectors the player knows.
import type { Vec2 } from '../math/vec2';
import type { RegionVariant } from './constants';
import { regionField, type RegionField, type RegionSeed } from './field';

/** Map tile side (u). */
export const MAP_TILE = 1000;
/** Sample steps of the zoom levels (u). */
export const MAP_LEVELS = [50, 100, 200] as const;
export type MapLevel = (typeof MAP_LEVELS)[number];

/** One label tile – plain data (transferable from a worker). */
export interface LabelTile {
  tx: number;
  ty: number;
  step: number;
  /** Samples per side. */
  size: number;
  /** Row-major (row 0 = southernmost, y grows with the row), index into `ids`. */
  labels: Uint16Array;
  /** Region ids of the palette. */
  ids: string[];
  /** Depth of each palette entry. */
  depths: Uint8Array;
}

/** Label tile (tx, ty) at the sample step – sample centres at tile origin + (i + ½)·step. */
export function buildLabelTile(field: RegionField, tx: number, ty: number, step: number): LabelTile {
  const size = Math.round(MAP_TILE / step);
  const labels = new Uint16Array(size * size);
  const ids: string[] = [];
  const depths: number[] = [];
  const palette = new Map<number, number>();
  const x0 = tx * MAP_TILE + step / 2;
  const y0 = ty * MAP_TILE + step / 2;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const s = field.regionAt(x0 + i * step, y0 + j * step);
      let idx = palette.get(s.key);
      if (idx === undefined) {
        idx = ids.length;
        palette.set(s.key, idx);
        ids.push(s.id);
        depths.push(s.depth);
      }
      labels[j * size + i] = idx;
    }
  }
  return { tx, ty, step, size, labels, ids, depths: Uint8Array.from(depths) };
}

/** Worker entry: the same tile from plain parameters. */
export const buildLabelTileFor = (seed: number, variant: RegionVariant, tx: number, ty: number, step: number): LabelTile =>
  buildLabelTile(regionField(seed, variant), tx, ty, step);

/** A sector rastered on a fixed grid around its seed. */
export interface RegionMask {
  id: string;
  step: number;
  /** World position of sample (0, 0)'s centre. */
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  /** 1 = sample belongs to the sector and is (8-)connected to the seed sample. */
  mask: Uint8Array;
  /** Samples flood-filled from the seed. */
  filled: number;
  /** All samples of the sector in the window (≠ filled → the sector is not connected). */
  total: number;
}

/**
 * Flood fill of a sector from its seed on a grid with this step, anchored at multiples of `step`
 * (independent of the query). The window grows until the sector does not touch its edge.
 */
export function regionMask(field: RegionField, seed: RegionSeed, step: number): RegionMask {
  let half = 1.5 * seed.spacing;
  for (let attempt = 0; attempt < 6; attempt++, half *= 1.5) {
    const i0 = Math.floor((seed.x - half) / step);
    const j0 = Math.floor((seed.y - half) / step);
    const cols = Math.ceil((2 * half) / step) + 1;
    const rows = cols;
    const x0 = (i0 + 0.5) * step;
    const y0 = (j0 + 0.5) * step;
    const own = new Uint8Array(cols * rows);
    let total = 0;
    let touchesEdge = false;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if (field.regionAt(x0 + i * step, y0 + j * step).key !== seed.key) continue;
        own[j * cols + i] = 1;
        total++;
        if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) touchesEdge = true;
      }
    }
    if (touchesEdge && attempt < 5) continue;
    // start: the sample nearest to the seed that belongs to the sector (spiral search)
    const si = Math.round((seed.x - x0) / step);
    const sj = Math.round((seed.y - y0) / step);
    let start = -1;
    for (let rad = 0; rad < Math.max(cols, rows) && start < 0; rad++) {
      for (let dj = -rad; dj <= rad && start < 0; dj++) {
        for (let di = -rad; di <= rad; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== rad) continue;
          const i = si + di;
          const j = sj + dj;
          if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
          if (own[j * cols + i]) {
            start = j * cols + i;
            break;
          }
        }
      }
    }
    const mask = new Uint8Array(cols * rows);
    let filled = 0;
    if (start >= 0) {
      const stack = [start];
      mask[start] = 1;
      while (stack.length > 0) {
        const k = stack.pop()!;
        filled++;
        const i = k % cols;
        const j = (k - i) / cols;
        const visit = (n: number) => {
          if (own[n] && !mask[n]) {
            mask[n] = 1;
            stack.push(n);
          }
        };
        // 8-connected: a border running diagonally through the grid keeps its samples together
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if ((di === 0 && dj === 0) || i + di < 0 || j + dj < 0 || i + di >= cols || j + dj >= rows) continue;
            visit(k + dj * cols + di);
          }
        }
      }
    }
    return { id: seed.id, step, x0, y0, cols, rows, mask, filled, total };
  }
  throw new Error('unreachable');
}

/** Signed area of a closed polygon (positive = counter-clockwise). */
export function polygonArea(poly: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Even–odd point-in-polygon test. */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Douglas–Peucker on a closed loop (keeps the two farthest-apart anchors). */
function simplifyLoop(points: Vec2[], tolerance: number): Vec2[] {
  if (points.length <= 4) return points;
  const simplify = (pts: Vec2[]): Vec2[] => {
    const keep = new Uint8Array(pts.length);
    keep[0] = 1;
    keep[pts.length - 1] = 1;
    const stack: [number, number][] = [[0, pts.length - 1]];
    while (stack.length > 0) {
      const [a, b] = stack.pop()!;
      const pa = pts[a]!;
      const pb = pts[b]!;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const len = Math.hypot(dx, dy) || 1;
      let worst = -1;
      let worstD = tolerance;
      for (let k = a + 1; k < b; k++) {
        const p = pts[k]!;
        const d = Math.abs((p.x - pa.x) * dy - (p.y - pa.y) * dx) / len;
        if (d > worstD) {
          worstD = d;
          worst = k;
        }
      }
      if (worst >= 0) {
        keep[worst] = 1;
        stack.push([a, worst], [worst, b]);
      }
    }
    return pts.filter((_, k) => keep[k]);
  };
  // split at the point farthest from the first one
  let far = 0;
  let farD = -1;
  for (let k = 1; k < points.length; k++) {
    const d = Math.hypot(points[k]!.x - points[0]!.x, points[k]!.y - points[0]!.y);
    if (d > farD) {
      farD = d;
      far = k;
    }
  }
  const first = simplify(points.slice(0, far + 1));
  const second = simplify([...points.slice(far), points[0]!]);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

/**
 * Outline of a mask: pixel edges with the sector on the left, chained into loops; the loop with the
 * largest area is the outer border, traced through the edge midpoints and simplified to `tolerance`
 * (default 0.6 × step).
 */
export function maskOutline(m: RegionMask, tolerance = 0.6 * m.step): Vec2[] {
  const { cols, rows, mask, step } = m;
  const at = (i: number, j: number) => i >= 0 && j >= 0 && i < cols && j < rows && mask[j * cols + i] === 1;
  // corner (ci, cj) → key; edges from → to (counter-clockwise around the inside)
  const W = cols + 1;
  const next = new Map<number, number[]>();
  const addEdge = (a: number, b: number) => {
    const list = next.get(a);
    if (list) list.push(b);
    else next.set(a, [b]);
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (!at(i, j)) continue;
      // corners of sample (i, j): (i, j) bottom-left … (i+1, j+1) top-right (y up)
      const bl = j * W + i;
      const br = j * W + i + 1;
      const tl = (j + 1) * W + i;
      const tr = (j + 1) * W + i + 1;
      if (!at(i, j - 1)) addEdge(bl, br);
      if (!at(i + 1, j)) addEdge(br, tr);
      if (!at(i, j + 1)) addEdge(tr, tl);
      if (!at(i - 1, j)) addEdge(tl, bl);
    }
  }
  const loops: Vec2[][] = [];
  const toPoint = (key: number): Vec2 => {
    const ci = key % W;
    const cj = (key - ci) / W;
    return { x: m.x0 - step / 2 + ci * step, y: m.y0 - step / 2 + cj * step };
  };
  for (const startKey of [...next.keys()].sort((a, b) => a - b)) {
    while ((next.get(startKey)?.length ?? 0) > 0) {
      const loop: Vec2[] = [];
      let cur = startKey;
      for (let guard = 0; guard < 4 * cols * rows + 8; guard++) {
        loop.push(toPoint(cur));
        const outs = next.get(cur)!;
        const to = outs.pop()!;
        if (outs.length === 0) next.delete(cur);
        cur = to;
        if (cur === startKey) break;
      }
      loops.push(loop);
    }
  }
  let best: Vec2[] = [];
  let bestA = -Infinity;
  for (const l of loops) {
    const a = Math.abs(polygonArea(l));
    if (a > bestA) {
      bestA = a;
      best = l;
    }
  }
  // edge midpoints instead of the pixel corners: stair steps become straight diagonals (like
  // marching squares), then Douglas–Peucker
  const mids = best.map((p, k) => {
    const q = best[(k + 1) % best.length]!;
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  });
  return simplifyLoop(mids, tolerance);
}

/** The outline polygon of a sector (counter-clockwise) at this grid step. */
export function regionPolygon(field: RegionField, seed: RegionSeed, step = 50): Vec2[] {
  return maskOutline(regionMask(field, seed, step));
}
