// The "not a target" metric (§2.6) – pure functions over a region world.
//  1. Tangential share: the share of border length within ±15° of the tangential direction (a polar
//     grid concentrates it near 0° and 90°; a uniform distribution gives 30/180 ≈ 16.7 %). Target < 25 %.
//     Borders are found on a fixed grid, each crossing is refined by bisection and its true direction
//     comes from the power-diagram normal pulled back through the warp (Jacobian), so the grid adds
//     no axis bias; a crossing stands for h / (|tx| + |ty|) of border length.
//  2. Start map: the known area (Charted + Reported) within r < 1 600 u is ≤ 60 % and the largest
//     angular gap of the unknown is ≥ 60°.
// The winner is the variant with the lower tangential share; a tie (< 1 percentage point) goes to B.
import type { RegionField } from './field';
import type { RegionWorld } from './world';

export interface OrientationOptions {
  /** Grid step (u). */
  step?: number;
  rMin?: number;
  rMax?: number;
  /** Half-width of the tangential window (deg). */
  windowDeg?: number;
}

export interface OrientationReport {
  /** Share of border length within ±window of tangential. */
  tangentialShare: number;
  /** Border length histogram over the angle between border and tangent, 0–90° in 15° bins. */
  histogram: number[];
  /** Total border length measured (u). */
  length: number;
}

const DEG = Math.PI / 180;

/** Share of border length near the tangential direction (criterion 2.6.1). */
export function borderOrientation(field: RegionField, opts: OrientationOptions = {}): OrientationReport {
  const h = opts.step ?? 50;
  const rMin = opts.rMin ?? 300;
  const rMax = opts.rMax ?? 8000;
  const win = Math.sin((opts.windowDeg ?? 15) * DEG);
  const histogram = [0, 0, 0, 0, 0, 0];
  let total = 0;
  let tangential = 0;
  const q0 = { x: 0, y: 0 };
  const q1 = { x: 0, y: 0 };
  const q2 = { x: 0, y: 0 };
  const n = Math.ceil(rMax / h);
  // labels of one row are reused for the vertical pairs
  let prevRow: Int32Array | null = null;
  let row: Int32Array = new Int32Array(2 * n + 1);
  const keyAt = (x: number, y: number) => field.regionAt(x, y).key;
  const measure = (ax: number, ay: number, bx: number, by: number, ka: number) => {
    // bisection to the crossing
    let lx = ax;
    let ly = ay;
    let hx = bx;
    let hy = by;
    for (let k = 0; k < 7; k++) {
      const mx = (lx + hx) / 2;
      const my = (ly + hy) / 2;
      if (keyAt(mx, my) === ka) {
        lx = mx;
        ly = my;
      } else {
        hx = mx;
        hy = my;
      }
    }
    const px = (lx + hx) / 2;
    const py = (ly + hy) / 2;
    const r = Math.hypot(px, py);
    if (r < rMin || r > rMax) return;
    const a = field.regionAt(lx, ly);
    const b = field.regionAt(hx, hy);
    if (a.key === b.key) return;
    // q-space normal of the a|b border, pulled back to world space: n_w = Jᵀ n_q
    const nqx = b.x - a.x;
    const nqy = b.y - a.y;
    const e = 1;
    field.warp(px, py, q0);
    field.warp(px + e, py, q1);
    field.warp(px, py + e, q2);
    const j11 = (q1.x - q0.x) / e;
    const j21 = (q1.y - q0.y) / e;
    const j12 = (q2.x - q0.x) / e;
    const j22 = (q2.y - q0.y) / e;
    const nwx = j11 * nqx + j21 * nqy;
    const nwy = j12 * nqx + j22 * nqy;
    const nl = Math.hypot(nwx, nwy);
    if (nl < 1e-9) return;
    // tangent of the border
    const tx = -nwy / nl;
    const ty = nwx / nl;
    const weight = h / (Math.abs(tx) + Math.abs(ty));
    // |sin| of the angle between the border and the tangential direction = |t · radial|
    const s = Math.abs((tx * px + ty * py) / r);
    total += weight;
    if (s <= win) tangential += weight;
    const angle = Math.asin(Math.min(1, s)) / DEG;
    histogram[Math.min(5, Math.floor(angle / 15))]! += weight;
  };
  for (let j = -n; j <= n; j++) {
    const y = j * h;
    for (let i = -n; i <= n; i++) {
      const x = i * h;
      row[i + n] = x * x + y * y <= (rMax + h) * (rMax + h) ? keyAt(x, y) : -2;
    }
    for (let i = -n; i < n; i++) {
      const ka = row[i + n]!;
      const kb = row[i + n + 1]!;
      if (ka !== kb && ka !== -2 && kb !== -2) measure(i * h, y, (i + 1) * h, y, ka);
      if (prevRow) {
        const kc = prevRow[i + n]!;
        if (kc !== ka && kc !== -2 && ka !== -2) measure(i * h, y - h, i * h, y, kc);
      }
    }
    const tmp: Int32Array = prevRow ?? new Int32Array(2 * n + 1);
    prevRow = row;
    row = tmp;
  }
  return { tangentialShare: total > 0 ? tangential / total : 0, histogram: histogram.map((v) => (total > 0 ? v / total : 0)), length: total };
}

export interface DepthBorderReport {
  /** Radius where the depth first reaches the value, sampled every 1° (mean, std, min, max). */
  mean: number;
  std: number;
  min: number;
  max: number;
}

/** How round a depth border is: radius of the first point of depth ≥ `depth` along 360 rays. */
export function depthBorderSpread(field: RegionField, depth: 2 | 3 | 4): DepthBorderReport {
  const radii: number[] = [];
  for (let a = 0; a < 360; a++) {
    const cx = Math.cos(a * DEG);
    const cy = Math.sin(a * DEG);
    let r = 0;
    while (r < 20000 && field.regionAt(cx * r, cy * r).depth < depth) r += 25;
    radii.push(r);
  }
  const mean = radii.reduce((s, v) => s + v, 0) / radii.length;
  const std = Math.sqrt(radii.reduce((s, v) => s + (v - mean) ** 2, 0) / radii.length);
  return { mean, std, min: Math.min(...radii), max: Math.max(...radii) };
}

export interface StartMapReport {
  /** Known (Charted + Reported) share of the area within `radius`. */
  knownShare: number;
  /** Largest run of directions (deg) whose ray samples are mostly unknown. */
  largestGapDeg: number;
  /** Sectors with a seed within the radius: known / all. */
  knownSectors: number;
  sectors: number;
  pass: boolean;
}

/** Criterion 2.6.2 on the start knowledge of a world. */
export function startMapReport(world: RegionWorld, radius = 1600, step = 50): StartMapReport {
  const known = (x: number, y: number) => world.startKnowledge.has(world.field.regionAt(x, y).id);
  let all = 0;
  let k = 0;
  for (let y = -radius + step / 2; y < radius; y += step) {
    for (let x = -radius + step / 2; x < radius; x += step) {
      if (x * x + y * y > radius * radius) continue;
      all++;
      if (known(x, y)) k++;
    }
  }
  // directions: a ray is unknown when most of its samples in [700, radius] are unknown
  const unknown: boolean[] = [];
  for (let a = 0; a < 360; a++) {
    const cx = Math.cos(a * DEG);
    const cy = Math.sin(a * DEG);
    let samples = 0;
    let unk = 0;
    for (let r = 700; r <= radius; r += step) {
      samples++;
      if (!known(cx * r, cy * r)) unk++;
    }
    unknown.push(unk * 2 > samples);
  }
  let gap = 0;
  if (unknown.every(Boolean)) gap = 360;
  else {
    const first = unknown.indexOf(false);
    let run = 0;
    for (let i = 1; i <= 360; i++) {
      if (unknown[(first + i) % 360]) gap = Math.max(gap, ++run);
      else run = 0;
    }
  }
  const sectorIds = new Set(world.regions.filter((r) => Math.hypot(r.seed.x, r.seed.y) < radius).map((r) => r.seed.id));
  const knownSectors = [...sectorIds].filter((id) => world.startKnowledge.has(id)).length;
  const knownShare = all > 0 ? k / all : 0;
  return { knownShare, largestGapDeg: gap, knownSectors, sectors: sectorIds.size, pass: knownShare <= 0.6 && gap >= 60 };
}

/** The rule of §2.6: lower mean tangential share wins; within 1 percentage point B wins. */
export function pickVariant(meanA: number, meanB: number): 'A' | 'B' {
  return meanA < meanB - 0.01 ? 'A' : 'B';
}
