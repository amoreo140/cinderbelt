// Sector borders traced around the camera (sectors design §5.2, stage 2 – render only).
//
// One world chunk (200 × 200 u) at a time: the sector label is sampled on a fixed global grid
// (TRACE_STEP), every grid edge whose two ends belong to different sectors gets a crossing point
// (refined by bisection), and marching squares join the crossings into segments. Segments are walked
// with the sector of the smaller seed key on the LEFT, so a border always runs the same way, and
// chained into pieces through their shared grid edges. A crossing on a grid edge is computed from the
// edge's canonical ends only, so the piece of a chunk ends exactly where the neighbour chunk's piece
// starts (same edge key, same point): pieces join across chunks without a seam.
//
// Pure and deterministic – a function of the region field only (no camera, no simulation state).
// Squares where three sectors meet are skipped (a gap of one grid step at a junction).
import type { Vec2 } from '../../sim/math/vec2';
import type { RegionSeed } from '../../sim/regions/field';
import { CHUNK_SIZE } from '../../sim/world/chunks';

/** Sample step of the label grid (u): 16 squares per chunk side. */
export const TRACE_STEP = 12.5;
export const TRACE_CELLS = Math.round(CHUNK_SIZE / TRACE_STEP);
/** Bisection steps of a crossing (12.5 / 2⁴ ≈ 0.8 u). */
const BISECT = 4;

/** The sector at a world point. */
export type LabelAt = (x: number, y: number) => RegionSeed;

/** A run of border inside one chunk between two sectors. */
export interface BorderPiece {
  /** Sector on the left of the walking direction (the smaller seed key) and on the right. */
  left: string;
  right: string;
  points: Vec2[];
  /** Arc length at each point (arc[0] = 0). */
  arc: number[];
  length: number;
  /** Grid edges of the first and the last point – a piece ending on `endEdge` continues in the piece starting there. */
  startEdge: string;
  endEdge: string;
  /** A closed loop inside the chunk (first point = last point). */
  loop: boolean;
}

interface Segment {
  from: string;
  to: string;
  p: Vec2;
  q: Vec2;
  left: RegionSeed;
  right: RegionSeed;
}

/** Key of the horizontal grid edge (gi, gj) → (gi + 1, gj) and of the vertical one (gi, gj) → (gi, gj + 1). */
const hKey = (gi: number, gj: number): string => `h${gi},${gj}`;
const vKey = (gi: number, gj: number): string => `v${gi},${gj}`;

/** Crossing on the segment a → b (a has label `la`): bisection toward the first point not in `la`. */
function crossing(labelAt: LabelAt, ax: number, ay: number, bx: number, by: number, la: RegionSeed): Vec2 {
  let x0 = ax;
  let y0 = ay;
  let x1 = bx;
  let y1 = by;
  for (let k = 0; k < BISECT; k++) {
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    if (labelAt(mx, my).key === la.key) {
      x0 = mx;
      y0 = my;
    } else {
      x1 = mx;
      y1 = my;
    }
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** The border pieces of chunk (cx, cy). */
export function traceBorderChunk(labelAt: LabelAt, cx: number, cy: number): BorderPiece[] {
  const N = TRACE_CELLS;
  const S = TRACE_STEP;
  const gi0 = cx * N;
  const gj0 = cy * N;
  const W = N + 1;
  const labels: RegionSeed[] = new Array(W * W);
  let uniform = true;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const l = labelAt((gi0 + i) * S, (gj0 + j) * S);
      labels[j * W + i] = l;
      if (l.key !== labels[0]!.key) uniform = false;
    }
  }
  if (uniform) return [];
  const L = (i: number, j: number): RegionSeed => labels[j * W + i]!;
  const points = new Map<string, Vec2>();
  // the crossing of a grid edge, from its canonical low end (the same in both chunks sharing it)
  const edge = (key: string, gi: number, gj: number, horizontal: boolean, la: RegionSeed): Vec2 => {
    let p = points.get(key);
    if (!p) {
      p = horizontal ? crossing(labelAt, gi * S, gj * S, (gi + 1) * S, gj * S, la) : crossing(labelAt, gi * S, gj * S, gi * S, (gj + 1) * S, la);
      points.set(key, p);
    }
    return p;
  };

  const segments: Segment[] = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = L(i, j);
      const b = L(i + 1, j);
      const c = L(i + 1, j + 1);
      const d = L(i, j + 1);
      if (a.key === b.key && b.key === c.key && c.key === d.key) continue;
      const other = [b, c, d].find((s) => s.key !== a.key)!;
      // three sectors in one square: a junction, skipped
      if ([b, c, d].some((s) => s.key !== a.key && s.key !== other.key)) continue;
      const gi = gi0 + i;
      const gj = gj0 + j;
      // edges: bottom a→b, right b→c, top d→c, left a→d (each from its low end)
      const bottom = a.key !== b.key ? { key: hKey(gi, gj), p: edge(hKey(gi, gj), gi, gj, true, a) } : null;
      const right = b.key !== c.key ? { key: vKey(gi + 1, gj), p: edge(vKey(gi + 1, gj), gi + 1, gj, false, b) } : null;
      const top = d.key !== c.key ? { key: hKey(gi, gj + 1), p: edge(hKey(gi, gj + 1), gi, gj + 1, true, d) } : null;
      const left = a.key !== d.key ? { key: vKey(gi, gj), p: edge(vKey(gi, gj), gi, gj, false, a) } : null;
      const corner = (ci: number, cj: number): Vec2 => ({ x: (gi + ci) * S, y: (gj + cj) * S });
      const add = (e1: { key: string; p: Vec2 }, e2: { key: string; p: Vec2 }, probe: Vec2, probeLabel: RegionSeed) => {
        const otherLabel = probeLabel.key === a.key ? other : a;
        // which side of e1 → e2 the probe corner lies on
        const cross = (e2.p.x - e1.p.x) * (probe.y - e1.p.y) - (e2.p.y - e1.p.y) * (probe.x - e1.p.x);
        const leftLabel = cross > 0 ? probeLabel : otherLabel;
        const rightLabel = cross > 0 ? otherLabel : probeLabel;
        if (leftLabel.key < rightLabel.key) segments.push({ from: e1.key, to: e2.key, p: e1.p, q: e2.p, left: leftLabel, right: rightLabel });
        else segments.push({ from: e2.key, to: e1.key, p: e2.p, q: e1.p, left: rightLabel, right: leftLabel });
      };
      const hits = [bottom, right, top, left].filter((e): e is { key: string; p: Vec2 } => e !== null);
      if (hits.length === 2) {
        // any corner works as the probe: the segment splits the square by label
        add(hits[0]!, hits[1]!, corner(0, 0), a);
      } else if (hits.length === 4) {
        // saddle (a = c ≠ b = d): the centre decides which pair of corners connects
        const m = labelAt((gi + 0.5) * S, (gj + 0.5) * S);
        if (m.key === a.key) {
          add(bottom!, right!, corner(1, 0), b);
          add(top!, left!, corner(0, 1), d);
        } else {
          add(left!, bottom!, corner(0, 0), a);
          add(right!, top!, corner(1, 1), c);
        }
      }
    }
  }
  return chain(segments);
}

/** Joins segments through their shared edges into pieces (open runs first, then closed loops). */
function chain(segments: Segment[]): BorderPiece[] {
  const byFrom = new Map<string, number>();
  const byTo = new Map<string, number>();
  segments.forEach((s, i) => {
    byFrom.set(s.from, i);
    byTo.set(s.to, i);
  });
  const used = new Uint8Array(segments.length);
  const pieces: BorderPiece[] = [];
  const walk = (start: number, loop: boolean) => {
    const s0 = segments[start]!;
    const pts: Vec2[] = [s0.p];
    let endEdge = s0.from;
    for (let i: number | undefined = start; i !== undefined && !used[i]; i = byFrom.get(segments[i]!.to)) {
      const s: Segment = segments[i]!;
      // a different pair never shares an edge, but keep the piece to one pair
      if (s.left.key !== s0.left.key || s.right.key !== s0.right.key) break;
      used[i] = 1;
      pts.push(s.q);
      endEdge = s.to;
    }
    const arc = [0];
    for (let k = 1; k < pts.length; k++) arc.push(arc[k - 1]! + Math.hypot(pts[k]!.x - pts[k - 1]!.x, pts[k]!.y - pts[k - 1]!.y));
    pieces.push({ left: s0.left.id, right: s0.right.id, points: pts, arc, length: arc[arc.length - 1]!, startEdge: s0.from, endEdge, loop });
  };
  segments.forEach((s, i) => {
    if (!used[i] && !byTo.has(s.from)) walk(i, false);
  });
  segments.forEach((_, i) => {
    if (!used[i]) walk(i, true);
  });
  return pieces;
}

/** Point and unit tangent of a piece at arc length `s` (clamped); the tangent spans ±`window` u. */
export function pieceFrame(piece: BorderPiece, s: number, window = 6): { pos: Vec2; tangent: Vec2 } {
  const pos = pieceAt(piece, s);
  const a = pieceAt(piece, s - window);
  const b = pieceAt(piece, s + window);
  let tx = b.x - a.x;
  let ty = b.y - a.y;
  const len = Math.hypot(tx, ty);
  if (len < 1e-9) {
    tx = 1;
    ty = 0;
  } else {
    tx /= len;
    ty /= len;
  }
  return { pos, tangent: { x: tx, y: ty } };
}

/** Point of a piece at arc length `s` (clamped to the piece). */
export function pieceAt(piece: BorderPiece, s: number): Vec2 {
  const { points, arc } = piece;
  if (s <= 0) return { ...points[0]! };
  if (s >= piece.length) return { ...points[points.length - 1]! };
  let lo = 0;
  let hi = arc.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arc[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const t = (s - arc[lo]!) / Math.max(1e-9, arc[hi]! - arc[lo]!);
  const p = points[lo]!;
  const q = points[hi]!;
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
}
