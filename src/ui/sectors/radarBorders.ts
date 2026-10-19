// Sector borders near the ship for the radar arc (sectors design §5.2, §6.8): a local sample grid
// around the ship (25 u, finer for a short radar range, at most 64 × 64 samples), marching squares over
// the sector ids, chained and smoothed into lines. Pure – the game layer recomputes it every 30 steps;
// the radar only shifts it by how far the ship flew since.
import type { Vec2 } from '../../sim/math/vec2';
import { chainSegments, organicLine } from './polyline';

/** Border segments towards one neighbouring sector. */
export interface RadarBorderGroup {
  /** The sector on the far side of the border. */
  other: string;
  /** The border touches the ship's sector (false = a border between two other sectors). */
  adjacent: boolean;
  /** Segments x0, y0, x1, y1 … relative to `origin` (world units, y up). */
  segments: number[];
  /** The segments chained into smoothed polylines (x, y, x, y …, relative to `origin`). */
  lines: number[][];
}

export interface RadarBorders {
  origin: Vec2;
  /** The grid step used (u). */
  step: number;
  groups: RadarBorderGroup[];
}

/** Default sample step of the radar grid (u, §6.8) … */
export const RADAR_BORDER_STEP = 25;
/** … but at least this many samples across the radar radius (a short range needs a finer grid). */
export const RADAR_BORDER_PER_RANGE = 24;
/** Samples per side at most (the step grows for a long radar range). */
export const RADAR_BORDER_MAX = 64;

/** The sample grid of `radarBorders` for a range: samples per side and the step actually used (u). */
export function radarBorderGrid(range: number, step = Math.min(RADAR_BORDER_STEP, range / RADAR_BORDER_PER_RANGE)): { n: number; step: number } {
  const half = Math.ceil(range / step);
  const n = Math.min(RADAR_BORDER_MAX, 2 * half + 1);
  return { n, step: n < 2 * half + 1 ? (2 * range) / (n - 1) : step };
}

/**
 * Borders within `range` of `origin`: marching squares over sector ids sampled on a grid anchored at
 * the origin. Each segment is filed under the sector on the other side of `currentId`.
 */
export function radarBorders(
  regionAt: (x: number, y: number) => string,
  origin: Vec2,
  range: number,
  currentId: string,
  step = Math.min(RADAR_BORDER_STEP, range / RADAR_BORDER_PER_RANGE),
): RadarBorders {
  const { n, step: st } = radarBorderGrid(range, step);
  const c = (n - 1) / 2;
  const ids: string[] = new Array<string>(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) ids[j * n + i] = regionAt(origin.x + (i - c) * st, origin.y + (j - c) * st);
  const groups = new Map<string, RadarBorderGroup>();
  const emit = (p: string, q: string, x0: number, y0: number, x1: number, y1: number) => {
    const adjacent = p === currentId || q === currentId;
    // the far side: the one that is not the ship's sector (between two others: the smaller id, stable)
    const other = p === currentId ? q : q === currentId ? p : p < q ? p : q;
    const key = `${other}|${adjacent ? 1 : 0}`;
    let g = groups.get(key);
    if (!g) {
      g = { other, adjacent, segments: [], lines: [] };
      groups.set(key, g);
    }
    g.segments.push(x0, y0, x1, y1);
  };
  const h = st / 2;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = ids[j * n + i]!;
      const b = ids[j * n + i + 1]!;
      const cc = ids[(j + 1) * n + i]!;
      const d = ids[(j + 1) * n + i + 1]!;
      if (a === b && a === cc && a === d) continue;
      const x = (i - c) * st;
      const y = (j - c) * st;
      // edge midpoints where the sector changes, with the pair across that edge
      const mids: [number, number, string, string][] = [];
      if (a !== b) mids.push([x + h, y, a, b]);
      if (b !== d) mids.push([x + st, y + h, b, d]);
      if (cc !== d) mids.push([x + h, y + st, cc, d]);
      if (a !== cc) mids.push([x, y + h, a, cc]);
      if (mids.length === 2 && ((mids[0]![2] === mids[1]![2] && mids[0]![3] === mids[1]![3]) || (mids[0]![2] === mids[1]![3] && mids[0]![3] === mids[1]![2]))) {
        emit(mids[0]![2], mids[0]![3], mids[0]![0], mids[0]![1], mids[1]![0], mids[1]![1]);
      } else {
        // a junction (or a saddle): every crossing runs to the cell centre
        for (const m of mids) emit(m[2], m[3], m[0], m[1], x + h, y + h);
      }
    }
  }
  for (const g of groups.values()) g.lines = chainSegments(g.segments).map((l) => organicLine(l, 0.6 * st));
  return { origin: { ...origin }, step: st, groups: [...groups.values()] };
}
