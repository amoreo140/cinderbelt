// What border markers, lane buoys, the Guild picket and the Guild Watch keep clear of (render-only
// scenery, sectors design §5.2): stations with their asteroid-free clear radius and their dock
// corridor, the rocks of asteroid fields, places of interest and the Rust fortresses. Read from the
// deterministic world generators (no simulation state), cached per chunk.
import { poiRadius, poisInChunk } from '../../sim/discovery/poi';
import type { Vec2 } from '../../sim/math/vec2';
import { fortressSites } from '../../sim/pirates/sites';
import { CHUNK_SIZE, chunkCoord, chunkKey } from '../../sim/world/chunks';
import { generateChunk } from '../../sim/world/generate';
import { stationAt } from '../../sim/world/stations';

/** Half angle and reach (beyond the rim) of a station's dock corridor – as the station traffic keeps it. */
export const DOCK_CORRIDOR = { halfAngle: (50 * Math.PI) / 180, reach: 260 } as const;
/** Extra gap kept around rocks, POIs and fortresses (u). */
const ROCK_GAP = 3;
const POI_GAP = 6;
const FORTRESS_CLEAR = 70;
const CACHE = 512;

export interface ObstacleStation {
  id: string;
  pos: Vec2;
  radius: number;
  clearRadius: number;
  portAngle: number;
}

export interface ChunkObstacles {
  /** Stations whose clear area can reach into the chunk (own chunk and the 8 around it). */
  stations: ObstacleStation[];
  rocks: { pos: Vec2; radius: number }[];
  pois: { pos: Vec2; radius: number }[];
}

/** A disc kept clear of scenery (the Guild picket). */
export interface KeepClear {
  pos: Vec2;
  radius: number;
}

/** Is `p` in the dock corridor of station `s` (cone around the port, out to rim + reach)? */
export function inDockCorridor(s: Pick<ObstacleStation, 'pos' | 'radius' | 'portAngle'>, p: Vec2, margin = 0): boolean {
  const dx = p.x - s.pos.x;
  const dy = p.y - s.pos.y;
  const d = Math.hypot(dx, dy);
  if (d > s.radius + DOCK_CORRIDOR.reach + margin) return false;
  let a = Math.atan2(dy, dx) - s.portAngle;
  a = Math.atan2(Math.sin(a), Math.cos(a));
  // the margin widens the cone by its angle at that distance
  return Math.abs(a) < DOCK_CORRIDOR.halfAngle + Math.atan2(margin, Math.max(1, d));
}

export class ObstacleMap {
  private readonly chunks = new Map<string, ChunkObstacles>();
  private readonly fortresses: Vec2[];
  private keep: KeepClear[] = [];

  constructor(readonly seed: number) {
    this.fortresses = fortressSites(seed).map((f) => f.pos);
  }

  /** Discs to keep clear in addition to the world (pickets). */
  setKeepClear(list: readonly KeepClear[]): void {
    this.keep = [...list];
  }

  chunk(cx: number, cy: number): ChunkObstacles {
    const key = chunkKey(cx, cy);
    let hit = this.chunks.get(key);
    if (!hit) {
      const stations: ObstacleStation[] = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const s = stationAt(this.seed, cx + dx, cy + dy);
          if (s) stations.push({ id: s.id, pos: s.pos, radius: s.radius, clearRadius: s.clearRadius, portAngle: s.portAngle });
        }
      }
      const rocks = generateChunk(this.seed, cx, cy).asteroids.map((a) => ({ pos: a.pos, radius: a.baseRadius }));
      const pois = poisInChunk(this.seed, cx, cy).map((p) => ({ pos: p.pos, radius: poiRadius(p) }));
      hit = { stations, rocks, pois };
      if (this.chunks.size >= CACHE) this.chunks.clear();
      this.chunks.set(key, hit);
    }
    return hit;
  }

  /** Stations near a point (from its chunk's list – each covers its 3 × 3 chunks). */
  stationsNear(p: Vec2): readonly ObstacleStation[] {
    return this.chunk(chunkCoord(p.x), chunkCoord(p.y)).stations;
  }

  /**
   * Is a disc of radius `r` at `p` blocked: inside a station's clear radius or its dock corridor,
   * on a rock (own chunk and the neighbours), a POI, near a fortress or a kept-clear disc?
   */
  blocked(p: Vec2, r: number, opts: { corridor?: boolean } = {}): boolean {
    const cx = chunkCoord(p.x);
    const cy = chunkCoord(p.y);
    for (const s of this.chunk(cx, cy).stations) {
      if (Math.hypot(p.x - s.pos.x, p.y - s.pos.y) < Math.max(s.clearRadius, s.radius + 20) + r) return true;
      if ((opts.corridor ?? true) && inDockCorridor(s, p, r)) return true;
    }
    for (const f of this.fortresses) if (Math.hypot(p.x - f.x, p.y - f.y) < FORTRESS_CLEAR + r) return true;
    for (const k of this.keep) if (Math.hypot(p.x - k.pos.x, p.y - k.pos.y) < k.radius + r) return true;
    // rocks and POIs of the chunks the disc can touch
    const reach = r + 30;
    const x0 = chunkCoord(p.x - reach);
    const x1 = chunkCoord(p.x + reach);
    const y0 = chunkCoord(p.y - reach);
    const y1 = chunkCoord(p.y + reach);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const c = this.chunk(x, y);
        for (const rock of c.rocks) if (Math.hypot(p.x - rock.pos.x, p.y - rock.pos.y) < rock.radius + r + ROCK_GAP) return true;
        for (const poi of c.pois) if (Math.hypot(p.x - poi.pos.x, p.y - poi.pos.y) < poi.radius + r + POI_GAP) return true;
      }
    }
    return false;
  }

  /** Is `p` within `margin` of a station's rim (fences and ribbons stop short of stations)? */
  nearStation(p: Vec2, margin: number): boolean {
    for (const s of this.stationsNear(p)) if (Math.hypot(p.x - s.pos.x, p.y - s.pos.y) < s.radius + margin) return true;
    return false;
  }
}

/** Chunk of a world point. */
export const chunkOf = (p: Vec2): { cx: number; cy: number } => ({ cx: Math.floor(p.x / CHUNK_SIZE), cy: Math.floor(p.y / CHUNK_SIZE) });
