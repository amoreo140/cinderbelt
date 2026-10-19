// Guild Lanes (§2.3): two polylines from home with a ±250 u corridor around each.
//   Lane A: home → G1 → onto the fortress-pair bisector nearest in bearing to G1 → out along it,
//           ending on the depth 2/3 border (extended to the Nebula Rim only with M5a).
//   Lane B: home → G2 → radially out to r = 3400.
// A guild_relay landmark within 400 u of a lane becomes a lane vertex. Every lane point closer than
// 900 u to a fortress is pushed out perpendicular to the lane. Nothing else moves: stations, POIs,
// fortresses and landmarks are inputs only.
import type { Vec2 } from '../math/vec2';
import { REGION_GEN, type Depth } from './constants';

export type LaneId = 'A' | 'B';

export interface GuildLane {
  id: LaneId;
  /** The lane's route before densifying and bending (home, stations, relay, axis point, end). */
  vertices: Vec2[];
  /** The final line: densified every `lanes.step` and bent around fortresses. */
  points: Vec2[];
  /** Bounding box of `points` (corridor queries). */
  box: { x0: number; y0: number; x1: number; y1: number };
}

export interface LaneInputs {
  /** Guaranteed stations G1 (ring 1) and G2 (ring 2). */
  g1: Vec2;
  g2: Vec2;
  fortresses: readonly Vec2[];
  /** The guild_relay landmark, if the world has one. */
  relay: Vec2 | null;
  /** Depth of the sector at a world point (lane A ends on the depth 2/3 border). */
  depthAt: (x: number, y: number) => Depth;
}

const unit = (v: Vec2): Vec2 => {
  const l = Math.hypot(v.x, v.y);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: 1, y: 0 };
};

/** Distance from p to segment ab and the parameter of the closest point. */
export function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2)) : 0;
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** Distance from p to a polyline. */
export function polylineDistance(p: Vec2, line: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, segmentDistance(p, line[i - 1]!, line[i]!));
  return line.length === 1 ? Math.hypot(p.x - line[0]!.x, p.y - line[0]!.y) : best;
}

/** Insert the relay as a vertex of the closest segment when it is within `relaySnap`. */
function viaRelay(vertices: Vec2[], relay: Vec2 | null): Vec2[] {
  if (!relay || polylineDistance(relay, vertices) > REGION_GEN.lanes.relaySnap) return vertices;
  let best = 1;
  let bestD = Infinity;
  for (let i = 1; i < vertices.length; i++) {
    const d = segmentDistance(relay, vertices[i - 1]!, vertices[i]!);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return [...vertices.slice(0, best), { ...relay }, ...vertices.slice(best)];
}

function densify(vertices: readonly Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [{ ...vertices[0]! }];
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1]!;
    const b = vertices[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

/** Push every point (but the first – home) out of the fortress clearance, perpendicular to the lane. */
function bend(points: Vec2[], fortresses: readonly Vec2[]): Vec2[] {
  const clear = REGION_GEN.lanes.fortressClear;
  const out = points.map((p) => ({ ...p }));
  for (let i = 1; i < points.length; i++) {
    // the lane direction from the unbent neighbours (stable, independent of earlier pushes)
    const prev = points[i - 1]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    const t = unit({ x: next.x - prev.x, y: next.y - prev.y });
    const n = { x: -t.y, y: t.x };
    const p = out[i]!;
    for (const f of fortresses) {
      const dx = p.x - f.x;
      const dy = p.y - f.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= clear * clear) continue;
      const side = dx * n.x + dy * n.y >= 0 ? 1 : -1;
      const m = { x: n.x * side, y: n.y * side };
      const dm = dx * m.x + dy * m.y;
      const s = -dm + Math.sqrt(dm * dm - (d2 - clear * clear));
      p.x += m.x * s;
      p.y += m.y * s;
    }
  }
  return out;
}

/**
 * The perpendicular pushes spread the points around a fortress; a long chord between two of them can
 * cut back into the clearance. Such a chord gets its midpoint, pushed radially onto the clearance circle.
 */
function closeChords(points: Vec2[], fortresses: readonly Vec2[]): Vec2[] {
  const clear = REGION_GEN.lanes.fortressClear;
  let out = points;
  for (let pass = 0; pass < 8; pass++) {
    const next: Vec2[] = [out[0]!];
    let changed = false;
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1]!;
      const b = out[i]!;
      for (const f of fortresses) {
        if (segmentDistance(f, a, b) >= clear - 0.5) continue;
        const m = { x: (a.x + b.x) / 2 - f.x, y: (a.y + b.y) / 2 - f.y };
        const len = Math.hypot(m.x, m.y) || 1;
        next.push({ x: f.x + (m.x / len) * clear, y: f.y + (m.y / len) * clear });
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

function finish(id: LaneId, vertices: Vec2[], inputs: LaneInputs): GuildLane {
  const routed = viaRelay(vertices, inputs.relay);
  const points = closeChords(bend(densify(routed, REGION_GEN.lanes.step), inputs.fortresses), inputs.fortresses);
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
  return { id, vertices: routed, points, box: { x0, y0, x1, y1 } };
}

/**
 * Lane A's axis: of the bisectors between fortresses adjacent in angle around home, the one closest
 * in bearing to `from` (G1) – so the lane never doubles back from G1 to reach it. With fewer than two
 * fortresses: `from`'s own bearing.
 */
function fortressAxis(from: Vec2, fortresses: readonly Vec2[]): Vec2 {
  if (fortresses.length < 2) return unit(from);
  const dir = unit(from);
  const sorted = [...fortresses].sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
  let best = dir;
  let bestDot = -Infinity;
  for (let i = 0; i < sorted.length; i++) {
    // with two fortresses there is one pair (the bisector on the short side)
    if (sorted.length === 2 && i === 1) break;
    const a = unit(sorted[i]!);
    const b = unit(sorted[(i + 1) % sorted.length]!);
    const sum = { x: a.x + b.x, y: a.y + b.y };
    // opposite fortresses: turn to the side of `from`
    let axis = Math.hypot(sum.x, sum.y) < 1e-6 ? dir : unit(sum);
    // the long way round (pair spanning more than 180°): the bisector points the other way
    const cross = a.x * b.y - a.y * b.x;
    if (cross < 0 && sorted.length > 2) axis = { x: -axis.x, y: -axis.y };
    const d = axis.x * dir.x + axis.y * dir.y;
    if (d > bestDot) {
      bestDot = d;
      best = axis;
    }
  }
  return best;
}

/** First point along origin + dir·r (r from r0) whose depth reaches 3, refined to 5 u; the point just before it. */
function depthBorder(dir: Vec2, r0: number, depthAt: LaneInputs['depthAt']): Vec2 {
  const at = (r: number): Vec2 => ({ x: dir.x * r, y: dir.y * r });
  const MAX_R = 9000;
  let lo = r0;
  let hi = -1;
  for (let r = r0; r <= MAX_R; r += 50) {
    const p = at(r);
    if (depthAt(p.x, p.y) >= 3) {
      hi = r;
      break;
    }
    lo = r;
  }
  if (hi < 0) return at(MAX_R);
  while (hi - lo > 5) {
    const mid = (lo + hi) / 2;
    const p = at(mid);
    if (depthAt(p.x, p.y) >= 3) hi = mid;
    else lo = mid;
  }
  return at(lo);
}

/** Both Guild Lanes of the world. */
export function guildLanes(inputs: LaneInputs): GuildLane[] {
  const home = { x: 0, y: 0 };
  const g = REGION_GEN.lanes;
  // lane A: home → G1 → the fortress axis → out to the depth 2/3 border
  const axis = fortressAxis(inputs.g1, inputs.fortresses);
  // far enough out that the leg G1 → axis point still heads away from home (r·cos θ > |G1|)
  const rG1 = Math.hypot(inputs.g1.x, inputs.g1.y);
  const cos = (axis.x * inputs.g1.x + axis.y * inputs.g1.y) / Math.max(1e-9, rG1);
  const rAxis = Math.max(rG1 + 600, g.laneAAxisMin, Math.min(g.laneAAxisMax, (rG1 + 400) / Math.max(0.3, cos)));
  const axisPoint = { x: axis.x * rAxis, y: axis.y * rAxis };
  const endA = depthBorder(axis, rAxis, inputs.depthAt);
  const laneA = finish('A', [home, { ...inputs.g1 }, axisPoint, endA], inputs);
  // lane B: home → G2 → radially out to laneBEnd
  const dirB = unit(inputs.g2);
  const rG2 = Math.hypot(inputs.g2.x, inputs.g2.y);
  const verticesB = [home, { ...inputs.g2 }];
  if (rG2 < g.laneBEnd - 1) verticesB.push({ x: dirB.x * g.laneBEnd, y: dirB.y * g.laneBEnd });
  const laneB = finish('B', verticesB, inputs);
  return [laneA, laneB];
}

/** Distance from (x, y) to the nearest lane line (Infinity when no lane is near its box). */
export function laneDistance(lanes: readonly GuildLane[], x: number, y: number, reach: number = REGION_GEN.lanes.corridor): number {
  let best = Infinity;
  const p = { x, y };
  for (const lane of lanes) {
    const b = lane.box;
    if (x < b.x0 - reach || x > b.x1 + reach || y < b.y0 - reach || y > b.y1 + reach) continue;
    best = Math.min(best, polylineDistance(p, lane.points));
  }
  return best;
}

/** Is (x, y) inside a Guild Lane corridor (±250 u)? */
export const inCorridor = (lanes: readonly GuildLane[], x: number, y: number): boolean =>
  laneDistance(lanes, x, y) <= REGION_GEN.lanes.corridor;
