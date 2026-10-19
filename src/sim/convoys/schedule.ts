// The published convoy schedule (M4d plan §2.5) – OWNED BY T5.
//
// Per lane a departure every `CONVOY.periodTicks` (lane B offset by half a period), pass `cv:<lane>@<n>`,
// out along the lane from `CONVOY.startOffset` past home to the lane end at `CONVOY.speed`, a turn-around,
// back. Route = the lane centre line offset `CONVOY.side` to the right of the direction of travel, clear
// of stations. Composition from `hash3(seed ^ CONVOY_SALT, lane, n)`: trader always, tanker
// `CONVOY.tankerGap` behind (chance), a cosmetic cutter (chance). Scheduled ships are moving obstacles
// near the player (safe, with velocity) and stop every shot except the player's (no friendly fire) – they
// never take damage. `convoySectorsInEpoch` feeds the derived local condition `convoy` (sector.ts).
//
// Everything here is a pure function of (seed, pass, tick) – nothing about a scheduled pass is saved
// (only the trades and the link, sim/convoys/trade.ts and link.ts). Ticks may be fractional (the render
// interpolates between steps).
//
// Time inside a simulation step: the ship ends the step at `state.tick + 1` (the tick is advanced after
// all systems ran), so every in-step query (colliders, hit targets, the link) asks for the convoys at
// `stepTick(state) = state.tick + 1`. After the steps, the game and the render read `convoyAt(…, state.tick)`
// – the same poses the ship was pinned to (a renderer interpolates `state.tick - 1 + alpha`).
//
// Route (one open polyline per lane: out → U-turn → back): the centre line averaged over ±60 u (the
// corners round off wider than the side offset, so the offset line never folds back inside a bend),
// offset to the right going out, a U-turn of radius `CONVOY.side` around the lane end, back on the
// other side; then the points are pushed out of every station's clear circle (+ a hull margin) and
// smoothed (endpoints fixed), like the Guild Watch loops. The tanker follows the trader `tankerGap`
// along the same polyline (extrapolated before its start), the cutter flies `escortAhead` in front and
// `escortSide` to the left.
import { CONVOY, CONVOY_SALT, CONVOY_SHAPES, type ConvoyShipKind } from '../../data/convoys';
import { GIANT_RADIUS } from '../../data/poi';
import { SECTOR_EPOCH_TICKS } from '../../data/sector';
import { poisInChunk } from '../discovery/poi';
import { hypot, type Vec2 } from '../math/vec2';
import type { Circle } from '../physics/collide';
import type { HitBox, NpcHitTarget } from '../npc/types';
import type { LaneId, GuildLane } from '../regions/lanes';
import { sectorIdAt, sectorLanes } from '../regions/sectors';
import type { SimState } from '../Simulation';
import { CHUNK_SIZE, chunkCoord } from '../world/chunks';
import { generateChunk } from '../world/generate';
import { clearList } from '../scratch';
import { hash3 } from '../world/hash';
import { stationAt } from '../world/stations';
import { WORLD_GENS } from '../world/worldGen';
import type { ConvoyLeg, ConvoyPose } from './types';

const TICKS = 60;
const NO_CIRCLES: readonly Circle[] = [];
const NO_TARGETS: readonly NpcHitTarget[] = [];

/** Route sampling step along the lane (u), the lane end trim (u), the U-turn's point count. */
const ROUTE_STEP = 20;
const END_TRIM = 40;
const TURN_POINTS = 12;
/** A lane shorter than this past `startOffset` has no convoys (u). */
const MIN_ROUTE = 400;
/** Kept from a station: its clear radius (at least its rim + 30 u), plus this for the convoy hulls (u). */
const STATION_GAP = 30;
const HULL_MARGIN = 10;
/** Scheduled convoy ships within this distance of the player are projectile targets (u). */
const HIT_REACH = 1200;

/** Lane index in the hash (A = 0, B = 1). */
const LANE_INDEX: Readonly<Record<LaneId, number>> = { A: 0, B: 1 };

/** The route of one lane's convoys and its timing (ticks from the departure). */
export interface ConvoyRoute {
  lane: LaneId;
  points: Vec2[];
  arc: number[];
  /** Arc length of the outbound leg, the U-turn and the way back (u). */
  outLen: number;
  turnLen: number;
  backLen: number;
  outTicks: number;
  turnTicks: number;
  /** Ticks from the departure to the end of the pass. */
  durationTicks: number;
  /** Bounding box of the points (quick distance rejects). */
  box: { x0: number; y0: number; x1: number; y1: number };
  /**
   * The cosmetic cutter's port offset at each point (u, ≤ `escortSide`): closer in line ahead of the trader
   * where a rock leaves the port band less room (null = `escortSide` everywhere).
   */
  cutter: readonly number[] | null;
}

// ---------------------------------------------------------------------------
// Route construction (once per seed)

const unit = (x: number, y: number): Vec2 => {
  const l = hypot(x, y);
  return l > 1e-9 ? { x: x / l, y: y / l } : { x: 1, y: 0 };
};

const arcTable = (points: readonly Vec2[]): number[] => {
  const arc = [0];
  for (let i = 1; i < points.length; i++) arc.push(arc[i - 1]! + hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  return arc;
};

/** Index of the segment [i, i + 1] that holds arc `s` (clamped to the first / last segment). */
function segmentAt(arc: readonly number[], s: number): number {
  let lo = 0;
  let hi = arc.length - 1;
  if (s <= arc[0]!) return 0;
  if (s >= arc[hi]!) return Math.max(0, hi - 1);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arc[mid]! <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Only the point at arc `s` of a polyline, written into `out` (no allocation – the flyby and the
 * colliders sample it every step). The very same arithmetic as `pointAt`.
 */
function positionInto(points: readonly Vec2[], arc: readonly number[], s: number, out: Vec2): Vec2 {
  const i = segmentAt(arc, s);
  const a = points[i]!;
  const b = points[i + 1] ?? a;
  const len = arc[i + 1]! - arc[i]!;
  if (len <= 1e-9) {
    out.x = a.x;
    out.y = a.y;
    return out;
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = hypot(dx, dy);
  const ux = l > 1e-9 ? dx / l : 1;
  const uy = l > 1e-9 ? dy / l : 0;
  const t = s - arc[i]!;
  out.x = a.x + ux * t;
  out.y = a.y + uy * t;
  return out;
}

/** Point and unit tangent at arc `s` of a polyline; beyond its ends extrapolated along the end segments. */
function pointAt(points: readonly Vec2[], arc: readonly number[], s: number): { pos: Vec2; dir: Vec2 } {
  const i = segmentAt(arc, s);
  const a = points[i]!;
  const b = points[i + 1] ?? a;
  const len = arc[i + 1]! - arc[i]!;
  const dir = unit(b.x - a.x, b.y - a.y);
  const t = s - arc[i]!;
  if (len <= 1e-9) return { pos: { x: a.x, y: a.y }, dir };
  return { pos: { x: a.x + dir.x * t, y: a.y + dir.y * t }, dir };
}

interface ClearDisc {
  pos: Vec2;
  need: number;
}

/** Stations whose clear circle may reach `p` (own chunk and the 8 around it), the largest model of any world generation. */
function stationsNear(seed: number, p: Vec2, memo: Map<string, ClearDisc[]>): ClearDisc[] {
  const cx = chunkCoord(p.x);
  const cy = chunkCoord(p.y);
  const key = `${cx},${cy}`;
  const known = memo.get(key);
  if (known) return known;
  const out: ClearDisc[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      let need = 0;
      let pos: Vec2 | null = null;
      for (const gen of WORLD_GENS) {
        const s = stationAt(seed, cx + dx, cy + dy, gen);
        if (!s) continue;
        pos = s.pos;
        need = Math.max(need, s.clearRadius, s.radius + STATION_GAP);
      }
      if (pos) out.push({ pos, need: need + HULL_MARGIN });
    }
  }
  memo.set(key, out);
  return out;
}

/** The required clearance never exceeds a chunk (stations are looked up in the 3 × 3 chunks around a point). */
const MAX_CLEAR = CHUNK_SIZE;

/** Pushes the points out of every station's clear circle and smooths the polyline (both ends fixed). */
function clearAndSmooth(seed: number, points: Vec2[]): Vec2[] {
  const memo = new Map<string, ClearDisc[]>();
  let out = points.map((p) => ({ ...p }));
  for (let pass = 0; pass < 4; pass++) {
    for (const p of out) {
      for (const s of stationsNear(seed, p, memo)) {
        const need = Math.min(MAX_CLEAR, s.need);
        const dx = p.x - s.pos.x;
        const dy = p.y - s.pos.y;
        const d = hypot(dx, dy);
        if (d >= need) continue;
        const u = d > 1e-6 ? { x: dx / d, y: dy / d } : { x: 1, y: 0 };
        p.x = s.pos.x + u.x * need;
        p.y = s.pos.y + u.y * need;
      }
    }
    if (pass === 3) break;
    // Laplacian smoothing of the open line (the ends stay)
    out = out.map((p, i) => {
      if (i === 0 || i === out.length - 1) return p;
      const a = out[i - 1]!;
      const b = out[i + 1]!;
      return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 };
    });
  }
  return out;
}

/** Distance from p to segment ab. */
function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2)) : 0;
  return hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/**
 * The pushes spread the points around a station: a chord between two of them that dips into a clear
 * circle gets its midpoint, pushed radially onto the circle (repeated until no chord dips in).
 */
function closeChords(seed: number, points: Vec2[], memo: Map<string, ClearDisc[]>): Vec2[] {
  let out = points;
  for (let pass = 0; pass < 10; pass++) {
    const next: Vec2[] = [out[0]!];
    let changed = false;
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1]!;
      const b = out[i]!;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      for (const s of stationsNear(seed, mid, memo)) {
        const need = Math.min(MAX_CLEAR, s.need);
        if (segmentDistance(s.pos, a, b) >= need - 0.01) continue;
        const m = { x: mid.x - s.pos.x, y: mid.y - s.pos.y };
        const len = hypot(m.x, m.y) || 1;
        next.push({ x: s.pos.x + (m.x / len) * need, y: s.pos.y + (m.y / len) * need });
        changed = true;
        break;
      }
      next.push(b);
    }
    out = next;
    if (!changed) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rock avoidance (T5 follow-up)
//
// The lanes cross asteroid fields; the convoy ships must not fly through a rock and a linked ship must
// not be dragged through one. Each route point may move sideways (along its left normal) by a lateral
// offset; the offsets are chosen by dynamic programming along the whole route (out, U-turn, back): a
// point whose band touches a rock costs a lot, a near miss a little, an offset its square, a change
// between neighbours its square (and at most `SHIFT_SLOPE` per u). If no point of the route touches a
// rock, the route stays exactly as it was. The rocks are the generated ones of both world generations
// (a mined rock only shrinks) and the giants – inputs only, asteroid ids and fields never change.
//
// Two bands: the hull band (trader and tanker, both sides, `HULL_GAP` from a rock) is kept clear at
// almost any cost; the port band (the cosmetic cutter `escortSide` + its hull, a linked ship = the trade
// port + 2 × its bounding radius ≤ 7; `ROCK_GAP` from a rock) wherever the field leaves room. A moved
// point keeps the station clear radius itself (the hull margin may go to a rock at the rim). The
// offsets cannot loop around a sharp corner, so in the densest spots (a field at the rim of a station's
// clear circle) a hull may still skim a rock; the cutter flies closer in line where the port room is
// short (`cutterSides`) and a linked ship is released before a rock (link.ts `stepLink`, `blocked`).

/** The bands around the route (u; left = port positive): the hulls to both sides, the port band to the left. */
const BAND_RIGHT = 3.5;
const BAND_HULL_LEFT = 3.5;
const BAND_PORT_LEFT = 16;
/** Kept between a rock and a band (u); a gap under `ROCK_SOFT` is avoided when it is cheap. */
const ROCK_GAP = 2;
/** The hull band only has to clear a rock by this much (u) – the last resort in a dense field. */
const HULL_GAP = 1;
const ROCK_SOFT = 4;
/** Lateral offsets tried: ±`SHIFT_MAX` in steps of `SHIFT_STEP` (u), at most `SHIFT_SLOPE` u sideways per u along. */
const SHIFT_MAX = 90;
const SHIFT_STEP = 1.5;
const SHIFT_SLOPE = 0.5;
/** A moved segment keeps at least this share of its forward progress (the line never folds back in a bend). */
const FOLD_KEEP = 0.05;
/** Levels of a (point, offset) and their DP costs; plus per u² of offset and per u² of offset change. */
const FREE = 0;
const NEAR = 1;
const PORT_BLOCKED = 2;
const HULL_BLOCKED = 3;
const LEVEL_COST = [0, 20, 2e3, 1e5] as const;
const COST_OFFSET = 0.02;
const COST_CHANGE = 0.5;
/** Spatial cells of the obstacle lookup (u). */
const OBSTACLE_CELL = 64;

interface Obstacle {
  x: number;
  y: number;
  r: number;
}

/** Rocks (both world generations) and giants in the chunks around the route, in cells of `OBSTACLE_CELL`. */
function obstaclesAlong(seed: number, points: readonly Vec2[]): { cells: Map<string, Obstacle[]>; maxR: number } {
  const seen = new Set<string>();
  const cells = new Map<string, Obstacle[]>();
  let maxR = 0;
  const add = (x: number, y: number, r: number): void => {
    const key = `${Math.floor(x / OBSTACLE_CELL)},${Math.floor(y / OBSTACLE_CELL)}`;
    const list = cells.get(key);
    if (list) list.push({ x, y, r });
    else cells.set(key, [{ x, y, r }]);
    maxR = Math.max(maxR, r);
  };
  for (const p of points) {
    const pcx = chunkCoord(p.x);
    const pcy = chunkCoord(p.y);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cx = pcx + dx;
        const cy = pcy + dy;
        const key = `${cx},${cy}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // the generations differ only in the rocks a station clear circle drops: each rock once
        const rocks = new Set<string>();
        for (const gen of WORLD_GENS) {
          for (const a of generateChunk(seed, cx, cy, gen).asteroids) {
            const at = `${a.pos.x},${a.pos.y}`;
            if (rocks.has(at)) continue;
            rocks.add(at);
            add(a.pos.x, a.pos.y, a.baseRadius);
          }
        }
        for (const poi of poisInChunk(seed, cx, cy)) if (poi.kind === 'giant') add(poi.pos.x, poi.pos.y, GIANT_RADIUS);
      }
    }
  }
  return { cells, maxR };
}

/**
 * Moves the route points sideways around the rocks on the way (see above); the point count stays. Also
 * the free room of the port band at each point of the result (u, ≤ `BAND_PORT_LEFT`; null = all free).
 */
function avoidRocks(seed: number, points: Vec2[], memo: Map<string, ClearDisc[]>): { points: Vec2[]; port: number[] | null } {
  const K = points.length;
  if (K < 3) return { points, port: null };
  const { cells, maxR } = obstaclesAlong(seed, points);
  const J = Math.round(SHIFT_MAX / SHIFT_STEP);
  const W = 2 * J + 1;
  // the frame of every point: tangent (left normal = (−ty, tx)), half the stretch it stands for
  const tx = new Float64Array(K);
  const ty = new Float64Array(K);
  const half = new Float64Array(K);
  const seg = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    const a = points[Math.max(0, k - 1)]!;
    const b = points[Math.min(K - 1, k + 1)]!;
    const t = unit(b.x - a.x, b.y - a.y);
    tx[k] = t.x;
    ty[k] = t.y;
    if (k > 0) seg[k] = hypot(points[k]!.x - points[k - 1]!.x, points[k]!.y - points[k - 1]!.y);
  }
  for (let k = 0; k < K; k++) half[k] = Math.max(seg[k]!, k + 1 < K ? seg[k + 1]! : 0) / 2;
  // a segment between the moved points k − 1 (offset oa) and k (offset ob) must still lead forward:
  // (b + n_k·ob − n_{k−1}·oa) · b ≥ FOLD_KEEP |b|², i.e. ob·foldB[k] − oa·foldA[k] ≥ foldC[k]
  const foldA = new Float64Array(K);
  const foldB = new Float64Array(K);
  const foldC = new Float64Array(K);
  const foldFree = new Uint8Array(K);
  for (let k = 1; k < K; k++) {
    const bx = points[k]!.x - points[k - 1]!.x;
    const by = points[k]!.y - points[k - 1]!.y;
    foldA[k] = -ty[k - 1]! * bx + tx[k - 1]! * by;
    foldB[k] = -ty[k]! * bx + tx[k]! * by;
    foldC[k] = (FOLD_KEEP - 1) * (bx * bx + by * by);
    // no pair of offsets can fold this segment
    foldFree[k] = (Math.abs(foldA[k]!) + Math.abs(foldB[k]!)) * SHIFT_MAX < -foldC[k]! ? 1 : 0;
  }
  const forward = (k: number, oa: number, ob: number): boolean => foldFree[k] === 1 || ob * foldB[k]! - oa * foldA[k]! >= foldC[k]!;

  /**
   * Every obstacle near point k as the open intervals of offsets it blocks: `visit(lo, hi, level)`. A rock
   * at `along` (beyond the point's stretch) and `side` (left of the point) blocks offset o when the gap
   * between its disc and the band [o − BAND_RIGHT, o + left] is under the margin; a station when the centre
   * line enters its clear circle.
   */
  const intervals = (k: number, visit: (lo: number, hi: number, level: number) => void): void => {
    const p = points[k]!;
    const nx = -ty[k]!;
    const ny = tx[k]!;
    for (const end of [0, -SHIFT_MAX, SHIFT_MAX]) {
      for (const s of stationsNear(seed, { x: p.x + nx * end, y: p.y + ny * end }, memo)) {
        // a rock at the rim of a clear circle may take the hull margin: the centre line keeps the clear radius itself
        const need = Math.min(MAX_CLEAR, s.need) - HULL_MARGIN;
        const wx = p.x - s.pos.x;
        const wy = p.y - s.pos.y;
        const b = nx * wx + ny * wy;
        const disc = b * b - (wx * wx + wy * wy - need * need);
        if (disc > 0) visit(-b - Math.sqrt(disc), -b + Math.sqrt(disc), HULL_BLOCKED);
      }
    }
    const reach = half[k]! + SHIFT_MAX + BAND_PORT_LEFT + maxR + ROCK_SOFT;
    const c0 = Math.floor((p.x - reach) / OBSTACLE_CELL);
    const c1 = Math.floor((p.x + reach) / OBSTACLE_CELL);
    const r0 = Math.floor((p.y - reach) / OBSTACLE_CELL);
    const r1 = Math.floor((p.y + reach) / OBSTACLE_CELL);
    for (let cx = c0; cx <= c1; cx++) {
      for (let cy = r0; cy <= r1; cy++) {
        const list = cells.get(`${cx},${cy}`);
        if (!list) continue;
        for (const ob of list) {
          const dx = ob.x - p.x;
          const dy = ob.y - p.y;
          const along = Math.max(0, Math.abs(dx * tx[k]! + dy * ty[k]!) - half[k]!);
          const side = -dx * ty[k]! + dy * tx[k]!;
          const soft = ob.r + ROCK_SOFT;
          if (along >= soft) continue;
          const ls = Math.sqrt(soft * soft - along * along);
          visit(side - BAND_PORT_LEFT - ls, side + BAND_RIGHT + ls, NEAR);
          const gap = ob.r + ROCK_GAP;
          if (along >= gap) continue;
          const lg = Math.sqrt(gap * gap - along * along);
          visit(side - BAND_PORT_LEFT - lg, side + BAND_RIGHT + lg, PORT_BLOCKED);
          const touch = ob.r + HULL_GAP;
          if (along >= touch) continue;
          const lh = Math.sqrt(touch * touch - along * along);
          visit(side - BAND_HULL_LEFT - lh, side + BAND_RIGHT + lh, HULL_BLOCKED);
        }
      }
    }
  };
  // the level of every (point, offset)
  const level = new Uint8Array(K * W);
  let touched = false;
  for (let k = 0; k < K; k++) {
    intervals(k, (lo, hi, v) => {
      const j0 = Math.max(0, Math.floor(lo / SHIFT_STEP + J) + 1);
      const j1 = Math.min(W - 1, Math.ceil(hi / SHIFT_STEP + J) - 1);
      for (let j = j0; j <= j1; j++) if (level[k * W + j]! < v) level[k * W + j] = v;
    });
    if (level[k * W + J]! > FREE) touched = true;
  }
  // nothing touches the route as it is: it stays exactly
  if (!touched) return { points, port: null };
  const levelAt = (k: number, o: number): number => {
    let worst = FREE;
    intervals(k, (lo, hi, v) => {
      if (o > lo && o < hi && v > worst) worst = v;
    });
    return worst;
  };
  // the cheapest offsets
  const total = new Float64Array(K * W);
  const from = new Int32Array(K * W);
  const cost = (k: number, j: number): number => {
    const o = (j - J) * SHIFT_STEP;
    return COST_OFFSET * o * o + LEVEL_COST[level[k * W + j]! as 0 | 1 | 2 | 3];
  };
  for (let j = 0; j < W; j++) total[j] = cost(0, j);
  for (let k = 1; k < K; k++) {
    const step = Math.max(1, Math.floor((SHIFT_SLOPE * seg[k]!) / SHIFT_STEP));
    for (let j = 0; j < W; j++) {
      const own = cost(k, j);
      let best = Infinity;
      let arg = j;
      for (let i = Math.max(0, j - step); i <= Math.min(W - 1, j + step); i++) {
        const d = (j - i) * SHIFT_STEP;
        const c = total[(k - 1) * W + i]! + COST_CHANGE * d * d;
        if (c < best && forward(k, (i - J) * SHIFT_STEP, (j - J) * SHIFT_STEP)) {
          best = c;
          arg = i;
        }
      }
      total[k * W + j] = best + own;
      from[k * W + j] = arg;
    }
  }
  let j = J;
  for (let i = 0; i < W; i++) if (total[(K - 1) * W + i]! < total[(K - 1) * W + j]!) j = i;
  const raw = new Float64Array(K);
  const rawLevel = new Uint8Array(K);
  for (let k = K - 1; k >= 0; k--) {
    raw[k] = (j - J) * SHIFT_STEP;
    rawLevel[k] = level[k * W + j]!;
    j = from[k * W + j]!;
  }
  // smoothed (1 4 6 4 1) where that keeps the bands as clear
  const out: Vec2[] = [];
  const port: number[] = [];
  let used = 0;
  for (let k = 0; k < K; k++) {
    let o = raw[k]!;
    let sum = 0;
    for (let m = -2; m <= 2; m++) sum += (m === 0 ? 6 : m === 1 || m === -1 ? 4 : 1) * raw[Math.max(0, Math.min(K - 1, k + m))]!;
    const smooth = sum / 16;
    if (smooth !== o && (k === 0 || forward(k, used, smooth)) && levelAt(k, smooth) <= Math.max(NEAR, rawLevel[k]!)) o = smooth;
    used = o;
    const p = points[k]!;
    out.push(o === 0 ? p : { x: p.x - ty[k]! * o, y: p.y + tx[k]! * o });
    // the port room: a rock that blocks the port band at this offset limits it to its near edge
    let room = BAND_PORT_LEFT;
    intervals(k, (lo, hi, v) => {
      if (v === PORT_BLOCKED && o < hi) room = Math.min(room, Math.max(0, lo + BAND_PORT_LEFT - o));
    });
    port.push(room);
  }
  return { points: out, port };
}

function buildRoute(seed: number, lane: GuildLane): ConvoyRoute | null {
  const arc = arcTable(lane.points);
  const total = arc[arc.length - 1]!;
  const s0 = CONVOY.startOffset;
  const s1 = total - END_TRIM;
  if (s1 - s0 < MIN_ROUTE) return null;
  const centre = (s: number): Vec2 => {
    let x = 0;
    let y = 0;
    for (let k = -6; k <= 6; k++) {
      const p = pointAt(lane.points, arc, Math.max(0, Math.min(total, s + k * 10))).pos;
      x += p.x;
      y += p.y;
    }
    return { x: x / 13, y: y / 13 };
  };
  const frame = (s: number): { p: Vec2; t: Vec2 } => {
    const p = centre(s);
    const q = centre(Math.min(total, s + 8));
    const o = centre(Math.max(0, s - 8));
    return { p, t: unit(q.x - o.x, q.y - o.y) };
  };
  const side = CONVOY.side;
  const pts: Vec2[] = [];
  // out: right of the outbound direction (right normal = (t.y, −t.x))
  for (let s = s0; s < s1; s += ROUTE_STEP) {
    const { p, t } = frame(s);
    pts.push({ x: p.x + t.y * side, y: p.y - t.x * side });
  }
  // the U-turn around the lane end: right → ahead → left
  const turnStart = pts.length;
  const end = frame(s1);
  for (let k = 0; k <= TURN_POINTS; k++) {
    const a = (k / TURN_POINTS) * Math.PI;
    const r = { x: end.t.y, y: -end.t.x };
    pts.push({ x: end.p.x + (r.x * Math.cos(a) + end.t.x * Math.sin(a)) * side, y: end.p.y + (r.y * Math.cos(a) + end.t.y * Math.sin(a)) * side });
  }
  const turnEnd = pts.length - 1;
  // back: left of the outbound direction, down to the start
  for (let s = s1 - ROUTE_STEP; s > s0; s -= ROUTE_STEP) {
    const { p, t } = frame(s);
    pts.push({ x: p.x - t.y * side, y: p.y + t.x * side });
  }
  const start = frame(s0);
  pts.push({ x: start.p.x - start.t.y * side, y: start.p.y + start.t.x * side });

  const smooth = clearAndSmooth(seed, pts);
  // a long chord between two pushed points can cut back into a clear circle: close it, per section
  const memo = new Map<string, ClearDisc[]>();
  const outPart = closeChords(seed, smooth.slice(0, turnStart + 1), memo);
  const turnPart = closeChords(seed, smooth.slice(turnStart, turnEnd + 1), memo);
  const backPart = closeChords(seed, smooth.slice(turnEnd), memo);
  const avoided = avoidRocks(seed, [...outPart, ...turnPart.slice(1), ...backPart.slice(1)], memo);
  const points = avoided.points;
  const turnFirst = outPart.length - 1;
  const turnLast = turnFirst + turnPart.length - 1;
  const routeArc = arcTable(points);
  const outLen = routeArc[turnFirst]!;
  const turnLen = routeArc[turnLast]! - outLen;
  const backLen = routeArc[routeArc.length - 1]! - routeArc[turnLast]!;
  const outTicks = (outLen / CONVOY.speed) * TICKS;
  const turnTicks = CONVOY.turnSeconds * TICKS;
  const backTicks = (backLen / CONVOY.speed) * TICKS;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return {
    lane: lane.id,
    points,
    arc: routeArc,
    outLen,
    turnLen,
    backLen,
    outTicks,
    turnTicks,
    durationTicks: outTicks + turnTicks + backTicks,
    box: { x0, y0, x1, y1 },
    cutter: avoided.port ? cutterSides(avoided.port, routeArc) : null,
  };
}

const routeCache = new Map<number, readonly ConvoyRoute[]>();

/** The convoy routes of a world (lanes too short to fly are left out). Cached per seed. */
export function convoyRoutes(seed: number): readonly ConvoyRoute[] {
  const known = routeCache.get(seed);
  if (known) return known;
  const out: ConvoyRoute[] = [];
  for (const lane of sectorLanes(seed)) {
    const r = buildRoute(seed, lane);
    if (r) out.push(r);
  }
  if (routeCache.size >= 16) routeCache.clear();
  routeCache.set(seed, out);
  return out;
}

const routeOf = (seed: number, lane: LaneId): ConvoyRoute | null => convoyRoutes(seed).find((r) => r.lane === lane) ?? null;

// ---------------------------------------------------------------------------
// Passes

/** The pass id of departure `n` on `lane`. */
export const convoyPassId = (lane: LaneId, n: number): string => `cv:${lane}@${n}`;

/** Lane and departure index of a pass id `cv:<lane>@<n>`, or null. */
export function parseConvoyPass(pass: string): { lane: LaneId; n: number } | null {
  const m = /^cv:([AB])@(\d{1,9})$/.exec(pass);
  if (!m) return null;
  return { lane: m[1] as LaneId, n: Number(m[2]) };
}

/** Departure tick of pass `n` on `lane`. */
export const departureTick = (lane: LaneId, n: number): number => n * CONVOY.periodTicks + CONVOY.laneOffsetTicks[lane];

/** The ticks of a pass: departure, start of the U-turn, start of the way back, end (exclusive); null = no such pass. */
export function convoyPassWindow(seed: number, pass: string): { depart: number; turn: number; back: number; end: number } | null {
  const id = parseConvoyPass(pass);
  const route = id ? routeOf(seed, id.lane) : null;
  if (!id || !route) return null;
  const depart = departureTick(id.lane, id.n);
  return { depart, turn: depart + route.outTicks, back: depart + route.outTicks + route.turnTicks, end: depart + route.durationTicks };
}

/** The pass composition: a tanker and / or the cosmetic cutter (deterministic per seed, lane and pass). */
export function convoyComposition(seed: number, lane: LaneId, n: number): { tanker: boolean; cutter: boolean } {
  const h = hash3(seed ^ CONVOY_SALT, LANE_INDEX[lane], n);
  return {
    tanker: hash3(h, 1, 0x7a4c) / 4294967296 < CONVOY.tankerChance,
    cutter: hash3(h, 2, 0x7a4c) / 4294967296 < CONVOY.escortChance,
  };
}

/** The pass's hash (the trade offer rolls from it). */
export const convoyPassHash = (seed: number, lane: LaneId, n: number): number => hash3(seed ^ CONVOY_SALT, LANE_INDEX[lane], n);

const headingOf = (d: Vec2): number => Math.atan2(d.y, d.x);

/** The trader's arc along the route, its speed (u/s) and the leg `t` ticks after the departure (null = not in flight). */
function arcAt(route: ConvoyRoute, t: number): { s: number; speed: number; leg: ConvoyLeg } | null {
  if (!(t >= 0 && t < route.durationTicks)) return null;
  if (t < route.outTicks) return { s: (t / TICKS) * CONVOY.speed, speed: CONVOY.speed, leg: 'out' };
  if (t < route.outTicks + route.turnTicks) {
    return { s: route.outLen + ((t - route.outTicks) / route.turnTicks) * route.turnLen, speed: route.turnLen / CONVOY.turnSeconds, leg: 'turn' };
  }
  return { s: route.outLen + route.turnLen + ((t - route.outTicks - route.turnTicks) / TICKS) * CONVOY.speed, speed: CONVOY.speed, leg: 'back' };
}

/** `arcAt(route, t)?.s` without the object (NaN = not in flight) – the per-step position samples. */
function arcSAt(route: ConvoyRoute, t: number): number {
  if (!(t >= 0 && t < route.durationTicks)) return NaN;
  if (t < route.outTicks) return (t / TICKS) * CONVOY.speed;
  if (t < route.outTicks + route.turnTicks) return route.outLen + ((t - route.outTicks) / route.turnTicks) * route.turnLen;
  return route.outLen + route.turnLen + ((t - route.outTicks - route.turnTicks) / TICKS) * CONVOY.speed;
}

/** Only the trader's position of a pass at `tick` (cheap – the flyby samples it), or null. */
export function convoyTraderAt(seed: number, pass: string, tick: number): Vec2 | null {
  const id = parseConvoyPass(pass);
  const route = id ? routeOf(seed, id.lane) : null;
  const a = id && route ? arcAt(route, tick - departureTick(id.lane, id.n)) : null;
  return a ? pointAt(route!.points, route!.arc, a.s).pos : null;
}

/** The cutter keeps the port room of every point within this arc (u) of its own (its hull and some slack). */
const CUTTER_WINDOW = 30;

/** The cutter's offset at each route point from the port room of the points around it. */
function cutterSides(port: readonly number[], arc: readonly number[]): number[] {
  const out: number[] = [];
  let lo = 0;
  let hi = 0;
  for (let k = 0; k < port.length; k++) {
    while (arc[k]! - arc[lo]! > CUTTER_WINDOW) lo++;
    while (hi + 1 < port.length && arc[hi + 1]! - arc[k]! <= CUTTER_WINDOW) hi++;
    let room = Infinity;
    for (let m = lo; m <= hi; m++) room = Math.min(room, port[m]!);
    out.push(Math.min(CONVOY.escortSide, Math.max(0, room - CONVOY_SHAPES.cutter.radius)));
  }
  return out;
}

/** The cutter's port offset at arc `s` (interpolated between the route points). */
function cutterSide(route: ConvoyRoute, s: number): number {
  const side = route.cutter;
  if (!side) return CONVOY.escortSide;
  const i = segmentAt(route.arc, s);
  const a = side[i]!;
  const b = side[Math.min(side.length - 1, i + 1)]!;
  if (a === b) return a;
  const len = route.arc[i + 1]! - route.arc[i]!;
  const t = len > 1e-9 ? Math.max(0, Math.min(1, (s - route.arc[i]!) / len)) : 0;
  return a + (b - a) * t;
}

function poseOf(seed: number, route: ConvoyRoute, n: number, tick: number): ConvoyPose | null {
  const a = arcAt(route, tick - departureTick(route.lane, n));
  if (!a) return null;
  const { s, speed, leg } = a;
  const trader = pointAt(route.points, route.arc, s);
  const ships: ConvoyPose['ships'] = [{ kind: 'trader', pos: trader.pos, heading: headingOf(trader.dir) }];
  const mix = convoyComposition(seed, route.lane, n);
  if (mix.tanker) {
    const tk = pointAt(route.points, route.arc, s - CONVOY.tankerGap);
    ships.push({ kind: 'tanker', pos: tk.pos, heading: headingOf(tk.dir) });
  }
  if (mix.cutter) {
    const at = s + CONVOY.escortAhead;
    const c = pointAt(route.points, route.arc, at);
    const side = cutterSide(route, at);
    ships.push({ kind: 'cutter', pos: { x: c.pos.x - c.dir.y * side, y: c.pos.y + c.dir.x * side }, heading: headingOf(c.dir) });
  }
  return {
    pass: convoyPassId(route.lane, n),
    lane: route.lane,
    ships,
    vel: { x: trader.dir.x * speed, y: trader.dir.y * speed },
    leg,
  };
}

/** The pass at `tick` (pure), or null when it is not in flight. */
export function convoyAt(seed: number, pass: string, tick: number): ConvoyPose | null {
  const id = parseConvoyPass(pass);
  const route = id ? routeOf(seed, id.lane) : null;
  return id && route ? poseOf(seed, route, id.n, tick) : null;
}

/** Departure indices of the passes of a route in flight at some tick of [from, to]. */
function passesBetween(route: ConvoyRoute, from: number, to: number): number[] {
  const off = CONVOY.laneOffsetTicks[route.lane];
  const first = Math.max(0, Math.floor((from - off - route.durationTicks) / CONVOY.periodTicks) + 1);
  const last = Math.floor((to - off) / CONVOY.periodTicks);
  const out: number[] = [];
  for (let n = first; n <= last; n++) {
    const d = departureTick(route.lane, n);
    if (d <= to && d + route.durationTicks > from) out.push(n);
  }
  return out;
}

/** A scheduled pass with its route and ticks resolved (no id parsing in the per-step queries). */
export interface ConvoySlot {
  route: ConvoyRoute;
  n: number;
  pass: string;
  /** Departure tick and the end of the pass (exclusive): `depart + route.durationTicks`. */
  depart: number;
  end: number;
}

/** Slots are listed per bucket of this many ticks, for windows up to `SLOT_SPAN` long (the flyby lead + a step). */
const SLOT_BUCKET = 3600;
const SLOT_SPAN = CONVOY.flybyLead * TICKS + TICKS;

function buildSlots(seed: number, from: number, to: number): ConvoySlot[] {
  const out: ConvoySlot[] = [];
  for (const route of convoyRoutes(seed)) {
    for (const n of passesBetween(route, from, to)) {
      const depart = departureTick(route.lane, n);
      out.push({ route, n, pass: convoyPassId(route.lane, n), depart, end: depart + route.durationTicks });
    }
  }
  return out;
}

let slotCache: { seed: number; bucket: number; slots: readonly ConvoySlot[] } | null = null;

/**
 * The passes that MAY be in flight at some tick of [from, to] – a superset, lane A first, by departure
 * (the caller keeps those with `slotInFlight`). Windows up to `SLOT_SPAN` come from a per-bucket cache,
 * so a step allocates nothing.
 */
export function convoySlots(seed: number, from: number, to: number): readonly ConvoySlot[] {
  if (!(to - from <= SLOT_SPAN)) return buildSlots(seed, from, to);
  const bucket = Math.floor(from / SLOT_BUCKET);
  if (slotCache?.seed === seed && slotCache.bucket === bucket) return slotCache.slots;
  const slots = buildSlots(seed, bucket * SLOT_BUCKET, (bucket + 1) * SLOT_BUCKET + SLOT_SPAN);
  slotCache = { seed, bucket, slots };
  return slots;
}

/** The pass is in flight at some tick of [from, to] (the exact test of `passesBetween`). */
export const slotInFlight = (slot: ConvoySlot, from: number, to: number): boolean => slot.depart <= to && slot.end > from;

/** The trader's position of a slot at `tick` written into `out`, or null when the pass is not in flight. */
export function slotTraderInto(slot: ConvoySlot, tick: number, out: Vec2): Vec2 | null {
  const s = arcSAt(slot.route, tick - slot.depart);
  return s === s ? positionInto(slot.route.points, slot.route.arc, s, out) : null;
}

/** Distance from `pos` to a route's bounding box (0 inside) – a convoy of that route is never nearer. */
export function boxDistance(route: ConvoyRoute, pos: Vec2): number {
  const dx = Math.max(route.box.x0 - pos.x, 0, pos.x - route.box.x1);
  const dy = Math.max(route.box.y0 - pos.y, 0, pos.y - route.box.y1);
  return hypot(dx, dy);
}

/** Every pass in flight at `tick` (the published schedule on the map), lane A first. */
export function convoysInFlight(seed: number, tick: number): ConvoyPose[] {
  const out: ConvoyPose[] = [];
  for (const slot of convoySlots(seed, tick, tick)) {
    if (!slotInFlight(slot, tick, tick)) continue;
    const pose = poseOf(seed, slot.route, slot.n, tick);
    if (pose) out.push(pose);
  }
  return out;
}

/** Passes in flight at `tick` with a ship within `radius` of `pos`. */
export function convoysNear(seed: number, pos: Vec2, radius: number, tick: number): ConvoyPose[] {
  return convoysInFlight(seed, tick).filter((c) => c.ships.some((s) => hypot(s.pos.x - pos.x, s.pos.y - pos.y) <= radius));
}

/** Passes of a route that may be in flight during [from, to] (for the flyby and the epoch sweeps). */
export function convoyPassesBetween(seed: number, from: number, to: number): string[] {
  const out: string[] = [];
  for (const slot of convoySlots(seed, from, to)) if (slotInFlight(slot, from, to)) out.push(slot.pass);
  return out;
}

/** Distance from `pos` to a route's bounding box (0 inside) – a convoy of that lane is never nearer. */
export function routeBoxDistance(seed: number, lane: LaneId, pos: Vec2): number {
  const r = routeOf(seed, lane);
  return r ? boxDistance(r, pos) : Infinity;
}

// ---------------------------------------------------------------------------
// Ship geometry

/** World position of a point given in a convoy ship's local frame (x = bow, y = port / left). */
export function shipLocalToWorld(ship: { pos: Vec2; heading: number }, local: { x: number; y: number }): Vec2 {
  const c = Math.cos(ship.heading);
  const s = Math.sin(ship.heading);
  return { x: ship.pos.x + local.x * c - local.y * s, y: ship.pos.y + local.x * s + local.y * c };
}

/** The collision circles of a convoy ship in the world (safe, moving with `vel`). */
export function convoyShipCircles(kind: ConvoyShipKind, pos: Vec2, heading: number, vel: Vec2): Circle[] {
  return CONVOY_SHAPES[kind].circles.map((c) => ({ pos: shipLocalToWorld({ pos, heading }, c), radius: c.r, safe: true, vel: { ...vel } }));
}

/** The tick the convoys are at when a simulation step ends (every in-step query uses it). */
export const stepTick = (state: SimState): number => state.tick + 1;

interface PassCircles {
  centre: Vec2;
  /** Every circle lies within this distance of `centre`. */
  extent: number;
  circles: Circle[];
  /** The ship id of each circle (`cv:<lane>@<n>:<kind>`). */
  ships: string[];
  /** The circles as projectile targets (built on the first hit query of the tick). */
  targets: NpcHitTarget[] | null;
}

/**
 * No ship circle of a pass lies farther than this from its trader: the tanker `tankerGap` behind along
 * the route, the cutter `escortAhead` ahead and `escortSide` off it, plus their hulls (+1 u of slack).
 * Passes whose trader is farther than reach + this from a query point are skipped without their circles.
 */
const PASS_REACH =
  Math.max(
    CONVOY_SHAPES.trader.radius,
    CONVOY.tankerGap + CONVOY_SHAPES.tanker.radius,
    CONVOY.escortAhead + CONVOY.escortSide + CONVOY_SHAPES.cutter.radius,
  ) + 1;

/** A pass in flight at the cached tick: its trader position, its circles built on the first query that comes near. */
interface PassEntry {
  slot: ConvoySlot;
  trader: Vec2;
  circles: PassCircles | null;
}

/** The tick and seed `PASSES` hold; the entry of each slot is reused tick after tick. */
let passSeed = NaN;
let passTick = NaN;
const PASSES: PassEntry[] = [];
const entryOf = new WeakMap<ConvoySlot, PassEntry>();

/**
 * The passes in flight at `tick` (one-tick cache: asked for every ship every step; no circles yet). The
 * list and its entries are reused (read within the caller's loop only – perf audit 2026-10-17, P4).
 */
function passesAt(seed: number, tick: number): readonly PassEntry[] {
  if (passSeed === seed && passTick === tick) return PASSES;
  clearList(PASSES);
  for (const slot of convoySlots(seed, tick, tick)) {
    if (!slotInFlight(slot, tick, tick)) continue;
    let e = entryOf.get(slot);
    if (!e) {
      e = { slot, trader: { x: 0, y: 0 }, circles: null };
      entryOf.set(slot, e);
    }
    if (!slotTraderInto(slot, tick, e.trader)) continue;
    e.circles = null;
    PASSES.push(e);
  }
  passSeed = seed;
  passTick = tick;
  return PASSES;
}

/** Ship ids of a slot's pass by kind (`cv:<lane>@<n>:<kind>`) – the same strings every tick. */
const shipIds = new WeakMap<ConvoySlot, Partial<Record<ConvoyShipKind, string>>>();

function shipIdOf(slot: ConvoySlot, pass: string, kind: ConvoyShipKind): string {
  let ids = shipIds.get(slot);
  if (!ids) {
    ids = {};
    shipIds.set(slot, ids);
  }
  return (ids[kind] ??= `${pass}:${kind}`);
}

/**
 * The collision circles of a pass at the cached tick (built once per tick, on demand). Like
 * `convoyShipCircles`, but the circles of a pass share one copy of its velocity (read-only, like the
 * circles) – fewer objects per tick (perf audit 2026-10-17, P4).
 */
function circlesOf(seed: number, tick: number, e: PassEntry): PassCircles {
  if (e.circles) return e.circles;
  const pose = poseOf(seed, e.slot.route, e.slot.n, tick)!;
  const centre = pose.ships[0]!.pos;
  const vel = { ...pose.vel };
  let extent = 0;
  const circles: Circle[] = [];
  const ships: string[] = [];
  for (const s of pose.ships) {
    const id = shipIdOf(e.slot, pose.pass, s.kind);
    const c = Math.cos(s.heading);
    const sn = Math.sin(s.heading);
    for (const local of CONVOY_SHAPES[s.kind].circles) {
      // shipLocalToWorld, operation for operation
      const circle: Circle = { pos: { x: s.pos.x + local.x * c - local.y * sn, y: s.pos.y + local.x * sn + local.y * c }, radius: local.r, safe: true, vel };
      circles.push(circle);
      ships.push(id);
      extent = Math.max(extent, hypot(circle.pos.x - centre.x, circle.pos.y - centre.y) + circle.radius);
    }
  }
  e.circles = { centre, extent, circles, ships, targets: null };
  return e.circles;
}

/** Scheduled convoy ship circles within `reach` of `pos` at this step (safe, moving obstacles). */
export function scheduledConvoyColliders(state: SimState, pos: Vec2, reach: number): readonly Circle[] {
  const tick = stepTick(state);
  let out: Circle[] | null = null;
  for (const e of passesAt(state.seed, tick)) {
    if (hypot(e.trader.x - pos.x, e.trader.y - pos.y) > reach + PASS_REACH) continue;
    const p = circlesOf(state.seed, tick, e);
    if (hypot(p.centre.x - pos.x, p.centre.y - pos.y) > reach + p.extent) continue;
    for (const circle of p.circles) {
      if (hypot(circle.pos.x - pos.x, circle.pos.y - pos.y) - circle.radius <= reach) (out ??= []).push(circle);
    }
  }
  return out ?? NO_CIRCLES;
}

/**
 * Scheduled convoy ships near the player as projectile targets (kind 'convoy', never damageable): one
 * target per collision circle, each with its ship's id `cv:<lane>@<n>:<kind>` (a shot stops at the hull,
 * not at a bounding disc around a long trader).
 */
export function scheduledConvoyHitTargets(state: SimState, near?: HitBox): readonly NpcHitTarget[] {
  const pos = state.player.body.pos;
  const tick = stepTick(state);
  let out: NpcHitTarget[] | null = null;
  let only: NpcHitTarget[] | null = null;
  for (const e of passesAt(state.seed, tick)) {
    if (hypot(e.trader.x - pos.x, e.trader.y - pos.y) > HIT_REACH + PASS_REACH) continue;
    // no shot of this step comes within PASS_REACH of the trader: none can reach a hull of the pass
    // (every circle lies within PASS_REACH of it, hit radius included – no shield) – not listed
    if (near && boxDistance2(near, e.trader) > PASS_REACH * PASS_REACH) continue;
    const p = circlesOf(state.seed, tick, e);
    if (hypot(p.centre.x - pos.x, p.centre.y - pos.y) > HIT_REACH + p.extent) continue;
    // the targets of a pass are built once per tick (shared, read-only)
    p.targets ??= p.circles.map((circle, k): NpcHitTarget => ({ id: p.ships[k]!, kind: 'convoy', pos: circle.pos, radius: circle.radius, shield: 0, damageable: false }));
    if (p.targets.length === 0) continue;
    if (out) for (const t of p.targets) out.push(t);
    else if (only) out = [...only, ...p.targets];
    else only = p.targets;
  }
  return out ?? only ?? NO_TARGETS;
}

/** Squared distance from a point to a box (0 inside). */
function boxDistance2(b: HitBox, p: Vec2): number {
  const dx = Math.max(b.x0 - p.x, 0, p.x - b.x1);
  const dy = Math.max(b.y0 - p.y, 0, p.y - b.y1);
  return dx * dx + dy * dy;
}

// ---------------------------------------------------------------------------
// The derived local condition `convoy`

const SECTOR_STRIDE = 60;
const sectorsCache = new Map<string, ReadonlySet<string>>();
/** Per route: the trader's sector by ticks after the departure (null = not in flight). */
const sectorMemo = new WeakMap<ConvoyRoute, Map<number, string | null>>();
const sectorAt: Vec2 = { x: 0, y: 0 };
/** The last answer (asked every step for the same epoch). */
let lastSectors: { seed: number; epoch: number; set: ReadonlySet<string> } | null = null;

/**
 * Sector ids a convoy pass crosses during the sector epoch (ticks [epoch·E, (epoch+1)·E)) – the derived
 * local condition `convoy` (sim/sector/sector.ts). The trader is sampled every second; a sector change
 * between two samples is resolved tick by tick (a thin sliver crossed on the way counts too).
 */
export function convoySectorsInEpoch(seed: number, epoch: number): ReadonlySet<string> {
  if (lastSectors?.seed === seed && lastSectors.epoch === epoch) return lastSectors.set;
  const key = `${seed}|${epoch}`;
  const hit = sectorsCache.get(key);
  if (hit) {
    lastSectors = { seed, epoch, set: hit };
    return hit;
  }
  const from = epoch * SECTOR_EPOCH_TICKS;
  const to = from + SECTOR_EPOCH_TICKS - 1;
  const out = new Set<string>();
  for (const route of convoyRoutes(seed)) {
    for (const n of passesBetween(route, from, to)) {
      const d = departureTick(route.lane, n);
      const lo = Math.max(from, Math.ceil(d));
      const hi = Math.min(to, Math.ceil(d + route.durationTicks) - 1);
      if (lo > hi) continue;
      // the trader's sector τ ticks after the departure is the same for every pass of the route: memoised
      // per route (the stride samples are whole seconds after a departure in every epoch)
      let memo = sectorMemo.get(route);
      if (!memo) {
        memo = new Map();
        sectorMemo.set(route, memo);
      }
      const known = memo;
      const at = (t: number): string | null => {
        const tau = t - d;
        const hit = known.get(tau);
        if (hit !== undefined) return hit;
        const a = arcAt(route, tau);
        const p = a ? positionInto(route.points, route.arc, a.s, sectorAt) : null;
        const id = p ? sectorIdAt(seed, p.x, p.y) : null;
        known.set(tau, id);
        return id;
      };
      let prevT = lo;
      let prev = at(lo);
      if (prev) out.add(prev);
      for (let t = Math.min(hi, lo + SECTOR_STRIDE); t > prevT; t = Math.min(hi, t + SECTOR_STRIDE)) {
        const id = at(t);
        if (id !== prev) {
          for (let k = prevT + 1; k < t; k++) {
            const mid = at(k);
            if (mid) out.add(mid);
          }
        }
        if (id) out.add(id);
        prev = id;
        prevT = t;
      }
    }
  }
  if (sectorsCache.size >= 256) sectorsCache.clear();
  sectorsCache.set(key, out);
  lastSectors = { seed, epoch, set: out };
  return out;
}
