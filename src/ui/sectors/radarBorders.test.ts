import { describe, expect, it } from 'vitest';
import { chainSegments, simplifyLine, smoothLine } from './polyline';
import { RADAR_BORDER_MAX, radarBorders } from './radarBorders';

describe('radar sector borders', () => {
  it('finds a straight border and files it under the neighbour', () => {
    // border at world x = 110: A west, B east; ship at (0, 0), range 300
    const r = radarBorders((x) => (x < 110 ? 'A' : 'B'), { x: 0, y: 0 }, 300, 'A', 25);
    expect(r.groups).toHaveLength(1);
    const g = r.groups[0]!;
    expect(g.other).toBe('B');
    expect(g.adjacent).toBe(true);
    // every segment lies on the border (between the samples at 100 and 125)
    for (let k = 0; k < g.segments.length; k += 4) {
      expect(g.segments[k]).toBeCloseTo(112.5);
      expect(g.segments[k + 2]).toBeCloseTo(112.5);
    }
    // it spans the whole grid vertically
    const ys = g.segments.filter((_, k) => k % 2 === 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(550);
  });

  it('is relative to the origin and marks borders between two other sectors', () => {
    const at = (x: number, y: number) => (x < 1000 ? 'A' : y < 0 ? 'B' : 'C');
    const r = radarBorders(at, { x: 900, y: 0 }, 300, 'A', 25);
    const keys = r.groups.map((g) => `${g.other}:${g.adjacent}`).sort();
    expect(keys).toEqual(['B:false', 'B:true', 'C:true']);
    const ab = r.groups.find((g) => g.other === 'B' && g.adjacent)!;
    for (let k = 0; k < ab.segments.length; k += 2) expect(ab.segments[k]! + 900).toBeGreaterThan(980);
  });

  it('caps the grid for a long range', () => {
    let calls = 0;
    const r = radarBorders(
      () => {
        calls++;
        return 'A';
      },
      { x: 0, y: 0 },
      5000,
      'A',
    );
    expect(calls).toBe(RADAR_BORDER_MAX * RADAR_BORDER_MAX);
    expect(r.groups).toEqual([]);
    expect(r.step).toBeGreaterThan(25);
  });
});

describe('border polylines', () => {
  it('chains segments into one line and smoothing keeps the end points', () => {
    // a staircase given in shuffled order and directions
    const segs = [10, 0, 10, 10, 0, 0, 10, 0, 20, 10, 10, 10, 20, 20, 20, 10];
    const lines = chainSegments(segs);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line).toHaveLength(10);
    const ends = [line.slice(0, 2), line.slice(-2)].map((p) => p.join(',')).sort();
    expect(ends).toEqual(['0,0', '20,20']);
    const smooth = smoothLine(line);
    expect(smooth.slice(0, 2)).toEqual(line.slice(0, 2));
    expect(smooth.slice(-2)).toEqual(line.slice(-2));
    expect(smooth.length).toBeGreaterThan(line.length);
  });

  it('simplifying drops points within the tolerance and keeps the ends', () => {
    // a 45° staircase from (0, 0) to (40, 40) with 5 u steps
    const stairs: number[] = [0, 0];
    for (let k = 1; k <= 8; k++) stairs.push(k * 5, (k - 1) * 5, k * 5, k * 5);
    const simple = simplifyLine(stairs, 4);
    expect(simple).toEqual([0, 0, 40, 40]);
    expect(simplifyLine(stairs, 1).length).toBe(stairs.length);
  });

  it('the radar groups carry smoothed lines with a short range on a finer grid', () => {
    const r = radarBorders((x) => (x < 37 ? 'A' : 'B'), { x: 0, y: 0 }, 180, 'A');
    expect(r.step).toBeCloseTo(7.5);
    expect(r.groups[0]!.lines.length).toBeGreaterThan(0);
  });
});
