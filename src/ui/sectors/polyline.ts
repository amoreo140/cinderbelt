// Border polylines of the sector layers (map, radar): marching-squares segments chained into lines
// and softened with Chaikin corner cutting, so 45° grid steps read as organic borders. Pure.

/** Chains segments that share end points into polylines (within one tile). */
export function chainSegments(segs: readonly number[]): number[][] {
  const count = segs.length / 4;
  const key = (x: number, y: number) => `${Math.round(x * 4)},${Math.round(y * 4)}`;
  const at = new Map<string, number[]>();
  for (let s = 0; s < count; s++) {
    for (const e of [0, 1]) {
      const k = key(segs[s * 4 + e * 2]!, segs[s * 4 + e * 2 + 1]!);
      const list = at.get(k);
      if (list) list.push(s * 2 + e);
      else at.set(k, [s * 2 + e]);
    }
  }
  const used = new Uint8Array(count);
  const out: number[][] = [];
  const walk = (x: number, y: number): number[] => {
    const pts: number[] = [];
    for (;;) {
      const next = at.get(key(x, y))?.find((v) => !used[v >> 1]);
      if (next === undefined) return pts;
      const s = next >> 1;
      used[s] = 1;
      const o = (next & 1) === 0 ? 1 : 0;
      x = segs[s * 4 + o * 2]!;
      y = segs[s * 4 + o * 2 + 1]!;
      pts.push(x, y);
    }
  };
  for (let s = 0; s < count; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const ax = segs[s * 4]!;
    const ay = segs[s * 4 + 1]!;
    const bx = segs[s * 4 + 2]!;
    const by = segs[s * 4 + 3]!;
    const fwd = walk(bx, by);
    const back = walk(ax, ay);
    const line: number[] = [];
    for (let k = back.length - 2; k >= 0; k -= 2) line.push(back[k]!, back[k + 1]!);
    line.push(ax, ay, bx, by, ...fwd);
    out.push(line);
  }
  return out;
}

/** One pass of Chaikin corner cutting; open lines keep their end points (tile edges stay joined). */
export function smoothLine(pts: readonly number[]): number[] {
  const n = pts.length / 2;
  if (n < 3) return [...pts];
  const closed = pts[0] === pts[pts.length - 2] && pts[1] === pts[pts.length - 1];
  const out: number[] = [];
  if (!closed) out.push(pts[0]!, pts[1]!);
  for (let k = 0; k < n - 1; k++) {
    const x0 = pts[k * 2]!;
    const y0 = pts[k * 2 + 1]!;
    const x1 = pts[k * 2 + 2]!;
    const y1 = pts[k * 2 + 3]!;
    out.push(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1, 0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1);
  }
  if (closed) out.push(out[0]!, out[1]!);
  else out.push(pts[pts.length - 2]!, pts[pts.length - 1]!);
  return out;
}

/** Douglas–Peucker on an open polyline (x, y, x, y …); the end points stay. */
export function simplifyLine(pts: readonly number[], tolerance: number): number[] {
  const n = pts.length / 2;
  if (n <= 2) return [...pts];
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const ax = pts[a * 2]!;
    const ay = pts[a * 2 + 1]!;
    const dx = pts[b * 2]! - ax;
    const dy = pts[b * 2 + 1]! - ay;
    const len = Math.hypot(dx, dy);
    let worst = -1;
    let worstD = tolerance;
    for (let k = a + 1; k < b; k++) {
      const px = pts[k * 2]! - ax;
      const py = pts[k * 2 + 1]! - ay;
      // a closed loop (a = b in space): distance to the point itself
      const d = len > 1e-9 ? Math.abs(px * dy - py * dx) / len : Math.hypot(px, py);
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
  const out: number[] = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(pts[k * 2]!, pts[k * 2 + 1]!);
  return out;
}

/** A marching-squares border made organic: simplified to `tolerance`, then two Chaikin passes. */
export const organicLine = (pts: readonly number[], tolerance: number): number[] => smoothLine(smoothLine(simplifyLine(pts, tolerance)));
