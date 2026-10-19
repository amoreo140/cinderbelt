import { describe, expect, it } from 'vitest';
import { regionField } from '../../sim/regions/field';
import { polylineDistance } from '../../sim/regions/lanes';
import { sectorInfo, sectorLanes } from '../../sim/regions/sectors';
import { generateChunk } from '../../sim/world/generate';
import { stationAt } from '../../sim/world/stations';
import { BorderPlanner, BUOY_GAP, laneArc, markerSlots, MARKER_SPACING, PICKET_CLEAR, PICKET_SIDE, SIDE_OFFSET, type BorderMarker } from './borderPlan';
import { pieceAt, traceBorderChunk, TRACE_CELLS, TRACE_STEP } from './borderTrace';
import { DOCK_CORRIDOR } from './obstacles';

const SEEDS = [1337, 42];
/** Chunks around home planned in the tests (−R..R). */
const R = 5;

function window(planner: BorderPlanner) {
  const chunks = [];
  for (let cx = -R; cx <= R; cx++) for (let cy = -R; cy <= R; cy++) chunks.push(planner.chunk(cx, cy));
  return chunks;
}

const planners = new Map(SEEDS.map((s) => [s, new BorderPlanner(s)]));

describe('traceBorderChunk', () => {
  it('is deterministic and puts the smaller-key sector on the left', () => {
    const field = regionField(1337);
    const label = (x: number, y: number) => field.regionAt(x, y);
    let checked = 0;
    let good = 0;
    for (let cx = -4; cx <= 4; cx++) {
      for (let cy = -4; cy <= 4; cy++) {
        const a = traceBorderChunk(label, cx, cy);
        expect(traceBorderChunk(label, cx, cy)).toEqual(a);
        for (const piece of a) {
          expect(piece.left).not.toBe(piece.right);
          expect(field.seedById(piece.left)!.key).toBeLessThan(field.seedById(piece.right)!.key);
          for (let s = 1; s < piece.length - 1; s += 3) {
            const p = pieceAt(piece, s);
            const q = pieceAt(piece, s + 0.5);
            const t = { x: q.x - p.x, y: q.y - p.y };
            const l = Math.hypot(t.x, t.y) || 1;
            const n = { x: -t.y / l, y: t.x / l };
            checked++;
            if (label(p.x + n.x * 2.5, p.y + n.y * 2.5).id === piece.left && label(p.x - n.x * 2.5, p.y - n.y * 2.5).id === piece.right) good++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
    // the line follows the real border within ~1 u (bisection) – a sharp warp bend may fool a probe
    expect(good / checked).toBeGreaterThan(0.95);
  });

  it('joins chunks seamlessly: a piece ending on a shared edge continues there at the same point', () => {
    const field = regionField(1337);
    const label = (x: number, y: number) => field.regionAt(x, y);
    let joins = 0;
    const starts = new Map<string, { x: number; y: number }>();
    const ends = new Map<string, { x: number; y: number }>();
    for (let cx = -4; cx <= 4; cx++) {
      for (let cy = -4; cy <= 4; cy++) {
        for (const p of traceBorderChunk(label, cx, cy)) {
          if (p.loop) continue;
          starts.set(p.startEdge, p.points[0]!);
          ends.set(p.endEdge, p.points[p.points.length - 1]!);
        }
      }
    }
    for (const [edge, end] of ends) {
      const start = starts.get(edge);
      if (!start) continue;
      joins++;
      expect(start).toEqual(end);
    }
    expect(joins).toBeGreaterThan(10);
  });

  it('samples on the global grid (16 squares per chunk)', () => {
    expect(TRACE_CELLS * TRACE_STEP).toBe(200);
  });
});

describe('BorderPlanner markers', () => {
  it('spaces each row 60–90 u on average and never closer than ~40 u', () => {
    expect(markerSlots(150, 'left')).toEqual([22.5, 97.5]);
    expect(markerSlots(30, 'right')).toEqual([]);
    for (const seed of SEEDS) {
      const chunks = window(planners.get(seed)!);
      let length = 0;
      let count = 0;
      const rows = new Map<string, BorderMarker[]>();
      for (const c of chunks) {
        for (const p of c.pieces) length += p.length;
        for (const m of c.markers) {
          count++;
          const key = `${m.sector}|${m.other}`;
          rows.set(key, [...(rows.get(key) ?? []), m]);
        }
      }
      // both sides, minus the few dropped at stations and rocks
      const spacing = (2 * length) / count;
      expect(spacing).toBeGreaterThan(60);
      expect(spacing).toBeLessThan(95);
      for (const row of rows.values()) {
        for (let i = 0; i < row.length; i++) {
          for (let j = i + 1; j < row.length; j++) {
            expect(Math.hypot(row[i]!.pos.x - row[j]!.pos.x, row[i]!.pos.y - row[j]!.pos.y)).toBeGreaterThan(38);
          }
        }
      }
    }
  });

  it('stands each marker in its own sector, facing into it', () => {
    for (const seed of SEEDS) {
      const field = regionField(seed);
      let total = 0;
      let inside = 0;
      for (const c of window(planners.get(seed)!)) {
        for (const m of c.markers) {
          total++;
          if (field.regionAt(m.pos.x + m.into.x * 2, m.pos.y + m.into.y * 2).id === m.sector) inside++;
          // "into" is perpendicular to "along"
          expect(Math.abs(m.into.x * m.along.x + m.into.y * m.along.y)).toBeLessThan(1e-6);
        }
      }
      expect(total).toBeGreaterThan(50);
      expect(inside / total).toBeGreaterThan(0.95);
    }
  });

  it('keeps markers out of station clear radii, dock corridors and asteroid rocks', () => {
    for (const seed of SEEDS) {
      for (const c of window(planners.get(seed)!)) {
        for (const m of c.markers) {
          const mcx = Math.floor(m.pos.x / 200);
          const mcy = Math.floor(m.pos.y / 200);
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              const s = stationAt(seed, mcx + dx, mcy + dy);
              if (s) {
                const d = Math.hypot(m.pos.x - s.pos.x, m.pos.y - s.pos.y);
                expect(d).toBeGreaterThan(s.clearRadius);
                const a = Math.atan2(m.pos.y - s.pos.y, m.pos.x - s.pos.x) - s.portAngle;
                const inCone = Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < DOCK_CORRIDOR.halfAngle;
                expect(inCone && d < s.radius + DOCK_CORRIDOR.reach).toBe(false);
              }
              for (const rock of generateChunk(seed, mcx + dx, mcy + dy).asteroids) {
                expect(Math.hypot(m.pos.x - rock.pos.x, m.pos.y - rock.pos.y)).toBeGreaterThan(rock.baseRadius + 1);
              }
            }
          }
        }
      }
    }
  });

  it('is the same plan in a fresh planner (deterministic, independent of the order of chunks)', () => {
    const a = new BorderPlanner(1337);
    const b = new BorderPlanner(1337);
    const first = a.chunk(2, -1);
    b.chunk(-3, 4);
    b.chunk(3, -1);
    expect(b.chunk(2, -1)).toEqual(first);
    expect(SIDE_OFFSET).toBeGreaterThan(0);
    expect(MARKER_SPACING).toBe(75);
  });
});

describe('BorderPlanner lanes', () => {
  it('puts buoys on the lane centre line every 120–160 u, clear of stations and rocks', () => {
    for (const seed of SEEDS) {
      const planner = planners.get(seed)!;
      const lanes = sectorLanes(seed);
      let kept = 0;
      for (const lane of lanes) {
        const arc = laneArc(lane.points);
        const buoys = [];
        const x0 = Math.floor(lane.box.x0 / 200);
        const x1 = Math.floor(lane.box.x1 / 200);
        const y0 = Math.floor(lane.box.y0 / 200);
        const y1 = Math.floor(lane.box.y1 / 200);
        for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) buoys.push(...planner.buoys(cx, cy).filter((b) => b.lane === lane.id));
        buoys.sort((p, q) => p.index - q.index);
        expect(arc[arc.length - 1]!).toBeGreaterThan(1000);
        for (const b of buoys) {
          expect(polylineDistance(b.pos, lane.points)).toBeLessThan(0.5);
          const s = stationAt(seed, Math.floor(b.pos.x / 200), Math.floor(b.pos.y / 200));
          if (s) expect(Math.hypot(b.pos.x - s.pos.x, b.pos.y - s.pos.y)).toBeGreaterThan(s.clearRadius);
        }
        for (let i = 1; i < buoys.length; i++) {
          if (buoys[i]!.index !== buoys[i - 1]!.index + 1) continue;
          const d = Math.hypot(buoys[i]!.pos.x - buoys[i - 1]!.pos.x, buoys[i]!.pos.y - buoys[i - 1]!.pos.y);
          // chord ≤ arc; a bend shortens it a little
          expect(d).toBeGreaterThan(BUOY_GAP[0] * 0.9);
          expect(d).toBeLessThanOrEqual(BUOY_GAP[1] + 1e-6);
        }
        kept += buoys.length;
      }
      expect(kept).toBeGreaterThan(15);
    }
  });

  it('puts the Guild pickets beside a lane inside a Guarded sector, clear of stations', () => {
    let total = 0;
    for (const seed of SEEDS) {
      const planner = planners.get(seed)!;
      const field = regionField(seed);
      const lanes = sectorLanes(seed);
      for (const p of planner.pickets()) {
        total++;
        expect(sectorInfo(seed, p.sector)!.security).toBe('guarded');
        expect(field.regionAt(p.pos.x, p.pos.y).id).toBe(p.sector);
        const lane = lanes.find((l) => l.id === p.lane)!;
        const d = polylineDistance(p.pos, lane.points);
        expect(d).toBeGreaterThan(PICKET_SIDE - 6);
        expect(d).toBeLessThan(PICKET_SIDE + 25);
        expect(planner.obstacles.blocked(p.pos, PICKET_CLEAR - 0.5, {})).toBe(true); // its own keep-clear disc
      }
      // pickets keep markers and buoys out of their clear radius
      for (const c of window(planner)) {
        for (const m of c.markers) for (const p of planner.pickets()) expect(Math.hypot(m.pos.x - p.pos.x, m.pos.y - p.pos.y)).toBeGreaterThan(PICKET_CLEAR);
      }
    }
    expect(total).toBeGreaterThan(0);
  });
});
