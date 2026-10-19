// Placement of the sector border scenery (sectors design §2.3, §5.2 stage 2; art batch C4,
// models/borders/borders.json): markers on both sides of every border every 60–90 u, Guild Lane
// buoys every 120–160 u on the lane centre line and the Guild pickets at the Guarded sector
// entrances on the lanes. Render only – no collision, no simulation state, nothing in the save.
//
// Everything is a pure function of the world seed: border pieces per chunk (borderTrace.ts), the
// markers of a piece by its own length (n = round(L / 75) slots, the left side's markers at slot
// + 0.3, the right side's at slot + 0.8, so the two rows are staggered), jittered by a hash of the
// place. A piece ends where its chunk ends, so a chunk's markers never depend on the window around
// the camera. Which borders SHOW is decided later from the current securities (a destroyed
// fortress turns its sector Contested) – the plan keeps both sector ids.
import type { Vec2 } from '../../sim/math/vec2';
import type { Security } from '../../sim/regions/constants';
import { regionField } from '../../sim/regions/field';
import { polylineDistance, type GuildLane } from '../../sim/regions/lanes';
import { sectorInfo, sectorLanes } from '../../sim/regions/sectors';
import { chunkKey } from '../../sim/world/chunks';
import { hash3 } from '../../sim/world/hash';
import { pieceFrame, traceBorderChunk, type BorderPiece } from './borderTrace';
import { ObstacleMap } from './obstacles';

/** Spacing target of the markers along a border (u) – borders.json `placement.spacing` [60, 90]. */
export const MARKER_SPACING = 75;
/** Random shift of a marker along the border (±u) and of its yaw (±rad) – `placement.jitter`. */
export const MARKER_JITTER = { along: 8, yaw: (12 * Math.PI) / 180 } as const;
/** Markers stand this far into the sector they announce (u): the two rows and fences run side by side. */
export const SIDE_OFFSET = 5;
/** Footprint radius of a marker (u, the pylon crossbar). */
const MARKER_RADIUS = 1.6;
/** Lane buoys: first one past home, gap range (u) – borders.json `laneBuoy.placement`. */
export const BUOY_START = 160;
export const BUOY_GAP: readonly [number, number] = [120, 160];
const BUOY_RADIUS = 1.2;
/** Guild picket: clear radius (borders.json `picket.clearRadius`), distance beside the lane and past the border. */
export const PICKET_CLEAR = 12;
export const PICKET_SIDE = 38;
export const PICKET_INSIDE = 30;
const PLAN_CACHE = 256;

const SALT = 0xb0bd_e125;

/** Danger order of the securities (the ribbon takes the more dangerous side's colour). */
export const SECURITY_RANK: Readonly<Record<Security, number>> = { quiet: 0, guarded: 1, contested: 2, pirate: 3 };

export interface BorderMarker {
  pos: Vec2;
  /** Unit direction along the border (the marker's local −Z, toward the next marker on its side). */
  along: Vec2;
  /** Unit direction into the sector it announces (the marker's local +X). */
  into: Vec2;
  /** The sector it announces and the one across the border. */
  sector: string;
  other: string;
  /** Yaw jitter (rad), scale and lamp phase (0..1). */
  yaw: number;
  scale: number;
  phase: number;
}

export interface ChunkBorders {
  cx: number;
  cy: number;
  pieces: BorderPiece[];
  markers: BorderMarker[];
}

export interface LaneBuoy {
  lane: string;
  /** Index along its lane (the chase blink runs outward with it). */
  index: number;
  pos: Vec2;
  /** Unit direction along the lane, away from home (the buoy's +X arrowhead). */
  along: Vec2;
}

export interface PicketSite {
  id: string;
  pos: Vec2;
  /** Sim angle of the picket's +X (the dock stub) – toward the lane. */
  angle: number;
  /** The Guarded sector whose entrance it watches. */
  sector: string;
  lane: string;
}

const unit = (x: number, y: number): Vec2 => {
  const l = Math.hypot(x, y);
  return l > 1e-9 ? { x: x / l, y: y / l } : { x: 1, y: 0 };
};

/** 0..1 hash of a world point (quantised to 1/8 u) and a salt. */
const hashAt = (seed: number, p: Vec2, k: number): number => hash3(hash3(seed ^ SALT, Math.round(p.x * 8), Math.round(p.y * 8)), k, 0x51de) / 4294967296;

/** Arc-length positions of the markers of one side of a piece. */
export function markerSlots(length: number, side: 'left' | 'right'): number[] {
  const n = Math.round(length / MARKER_SPACING);
  const out: number[] = [];
  const shift = side === 'left' ? 0.3 : 0.8;
  for (let k = 0; k < n; k++) out.push(((k + shift) / n) * length);
  return out;
}

/** Point and unit tangent at arc length `s` of a lane polyline. */
function laneFrame(points: readonly Vec2[], arc: readonly number[], s: number): { pos: Vec2; along: Vec2 } {
  let i = 1;
  while (i < arc.length - 1 && arc[i]! < s) i++;
  const a = points[i - 1]!;
  const b = points[i]!;
  const t = Math.min(1, Math.max(0, (s - arc[i - 1]!) / Math.max(1e-9, arc[i]! - arc[i - 1]!)));
  return { pos: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, along: unit(b.x - a.x, b.y - a.y) };
}

export const laneArc = (points: readonly Vec2[]): number[] => {
  const arc = [0];
  for (let i = 1; i < points.length; i++) arc.push(arc[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  return arc;
};

export class BorderPlanner {
  readonly obstacles: ObstacleMap;
  private readonly plans = new Map<string, ChunkBorders>();
  private readonly lanes: readonly GuildLane[];
  private buoyList: LaneBuoy[] | null = null;
  private readonly buoyChunks = new Map<string, LaneBuoy[]>();

  constructor(readonly seed: number) {
    this.obstacles = new ObstacleMap(seed);
    this.lanes = sectorLanes(seed);
    // pickets first: the markers and buoys keep their clear radius free
    this.obstacles.setKeepClear(this.pickets().map((p) => ({ pos: p.pos, radius: PICKET_CLEAR })));
  }

  /** Border pieces and markers of chunk (cx, cy) (cached). */
  chunk(cx: number, cy: number): ChunkBorders {
    const key = chunkKey(cx, cy);
    let plan = this.plans.get(key);
    if (!plan) {
      const field = regionField(this.seed);
      const pieces = traceBorderChunk((x, y) => field.regionAt(x, y), cx, cy);
      const markers: BorderMarker[] = [];
      for (const piece of pieces) {
        for (const side of ['left', 'right'] as const) {
          markerSlots(piece.length, side).forEach((s0, k) => {
            const probe = pieceFrame(piece, s0).pos;
            const r = (n: number) => hashAt(this.seed, probe, k * 8 + n + (side === 'left' ? 0 : 4));
            const s = Math.min(piece.length - 2, Math.max(2, s0 + (r(0) * 2 - 1) * MARKER_JITTER.along));
            const { pos: on, tangent } = pieceFrame(piece, s);
            // left normal of the walking direction points into the left sector
            const nx = side === 'left' ? -tangent.y : tangent.y;
            const ny = side === 'left' ? tangent.x : -tangent.x;
            const pos = { x: on.x + nx * SIDE_OFFSET, y: on.y + ny * SIDE_OFFSET };
            if (this.obstacles.blocked(pos, MARKER_RADIUS)) return;
            markers.push({
              pos,
              along: side === 'left' ? tangent : { x: -tangent.x, y: -tangent.y },
              into: { x: nx, y: ny },
              sector: side === 'left' ? piece.left : piece.right,
              other: side === 'left' ? piece.right : piece.left,
              yaw: (r(1) * 2 - 1) * MARKER_JITTER.yaw,
              scale: 0.95 + r(2) * 0.15,
              phase: r(3),
            });
          });
        }
      }
      plan = { cx, cy, pieces, markers };
      if (this.plans.size >= PLAN_CACHE) this.plans.clear();
      this.plans.set(key, plan);
    }
    return plan;
  }

  /** Has chunk (cx, cy) been planned already (the layer plans a few per frame)? */
  planned(cx: number, cy: number): boolean {
    return this.plans.has(chunkKey(cx, cy));
  }

  /** Every lane buoy position (not yet checked against obstacles). */
  private allBuoys(): LaneBuoy[] {
    if (this.buoyList) return this.buoyList;
    const out: LaneBuoy[] = [];
    for (const lane of this.lanes) {
      const arc = laneArc(lane.points);
      const total = arc[arc.length - 1]!;
      let s = BUOY_START;
      for (let k = 0; s < total - 20; k++) {
        const { pos, along } = laneFrame(lane.points, arc, s);
        out.push({ lane: lane.id, index: k, pos, along });
        s += BUOY_GAP[0] + hashAt(this.seed, pos, 100 + k) * (BUOY_GAP[1] - BUOY_GAP[0]);
      }
    }
    this.buoyList = out;
    return out;
  }

  /** The lane buoys in chunk (cx, cy), clear of stations, rocks and pickets (cached). */
  buoys(cx: number, cy: number): LaneBuoy[] {
    const key = chunkKey(cx, cy);
    let hit = this.buoyChunks.get(key);
    if (!hit) {
      hit = this.allBuoys().filter((b) => Math.floor(b.pos.x / 200) === cx && Math.floor(b.pos.y / 200) === cy && !this.obstacles.blocked(b.pos, BUOY_RADIUS));
      if (this.buoyChunks.size >= PLAN_CACHE) this.buoyChunks.clear();
      this.buoyChunks.set(key, hit);
    }
    return hit;
  }

  /** The Guild pickets of the world (see `guildPickets`). */
  pickets(): PicketSite[] {
    return guildPickets(this.seed);
  }
}

const picketCache = new Map<number, PicketSite[]>();

/**
 * Guild pickets (art C3): where a lane crosses into or out of a Guarded sector from a sector that is
 * not Guarded, one picket on the Guarded side – PICKET_INSIDE past the border and PICKET_SIDE beside
 * the lane, facing it; the side and the exact spot are the first clear ones of a few tries. Cached
 * per seed (the scatter keeps their clear radius free too).
 */
export function guildPickets(seed: number): PicketSite[] {
  const hit = picketCache.get(seed);
  if (hit) return hit;
  const obstacles = new ObstacleMap(seed);
  const field = regionField(seed);
  const security = (id: string): Security => sectorInfo(seed, id)?.security ?? 'contested';
  const out: PicketSite[] = [];
  for (const lane of sectorLanes(seed)) {
    const arc = laneArc(lane.points);
    const total = arc[arc.length - 1]!;
    const step = 10;
    let prev = field.regionAt(lane.points[0]!.x, lane.points[0]!.y).id;
    for (let s = step; s <= total; s += step) {
      const { pos } = laneFrame(lane.points, arc, s);
      const id = field.regionAt(pos.x, pos.y).id;
      if (id === prev) continue;
      const into = security(id) === 'guarded' && security(prev) !== 'guarded';
      const outOf = security(prev) === 'guarded' && security(id) !== 'guarded';
      if (into || outOf) {
        const sector = into ? id : prev;
        // walk into the Guarded sector along the lane
        const at = into ? s + PICKET_INSIDE : s - step - PICKET_INSIDE;
        const site = picketSpot(seed, obstacles, field, lane, arc, at, into ? 1 : -1, sector);
        if (site && !out.some((p) => Math.hypot(p.pos.x - site.pos.x, p.pos.y - site.pos.y) < 150)) out.push({ ...site, id: `picket:${lane.id}:${out.length}` });
      }
      prev = id;
    }
  }
  if (picketCache.size >= 4) picketCache.clear();
  picketCache.set(seed, out);
  return out;
}

function picketSpot(
  seed: number,
  obstacles: ObstacleMap,
  field: ReturnType<typeof regionField>,
  lane: GuildLane,
  arc: number[],
  at: number,
  dir: number,
  sector: string,
): Omit<PicketSite, 'id'> | null {
  const first = hashAt(seed, laneFrame(lane.points, arc, at).pos, 200) < 0.5 ? 1 : -1;
  for (const shift of [0, 25, 50, 80]) {
    const { pos: c, along } = laneFrame(lane.points, arc, at + dir * shift);
    for (const side of [first, -first]) {
      for (const d of [PICKET_SIDE, PICKET_SIDE + 20]) {
        const pos = { x: c.x - along.y * side * d, y: c.y + along.x * side * d };
        if (field.regionAt(pos.x, pos.y).id !== sector) continue;
        if (obstacles.blocked(pos, PICKET_CLEAR)) continue;
        // stays beside the corridor's centre, never on another part of the lane
        if (polylineDistance(pos, lane.points) < PICKET_SIDE - 5) continue;
        return { pos, angle: Math.atan2(c.y - pos.y, c.x - pos.x), sector, lane: lane.id };
      }
    }
  }
  return null;
}
