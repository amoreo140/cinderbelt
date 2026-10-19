import { describe, expect, it } from 'vitest';
import { TROPHY_FIT } from '../../data/home';
import type { FactionId } from '../../data/factions';
import { captainGrid } from '../../sim/captains/captains';
import { createGrid } from '../../sim/ship/grid';
import {
  axisRow,
  bodyCells,
  cutCorners,
  displayModel,
  hullCells,
  insetLoop,
  pedestalFit,
  pitchSoup,
  postSoup,
  REPLICA_EXTENT,
  REPLICA_LIFT,
  REPLICA_TRIANGLES,
  replicaSwatches,
  ridgeCells,
  RIDGE,
  soupBounds,
  STILL_YAW,
  trophyYaw,
  WING,
  type MeshSoup,
} from './replica';

/** A swatch table where every key has its own u (v = 0.5); `missing` keys are unknown. */
function swatchTable(missing: string[] = []): (key: string) => readonly [number, number] | null {
  const known = new Map<string, number>();
  return (key) => {
    if (missing.includes(key)) return null;
    if (!known.has(key)) known.set(key, known.size);
    return [(known.get(key)! + 0.5) / 256, 0.5];
  };
}

const tris = (s: MeshSoup): number => s.indices.length / 3;

/** Geometric normal of triangle t (unnormalised). */
function faceNormal(s: MeshSoup, t: number): [number, number, number] {
  const p = s.positions;
  const [a, b, c] = [s.indices[t * 3]! * 3, s.indices[t * 3 + 1]! * 3, s.indices[t * 3 + 2]! * 3];
  const u = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!];
  const v = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
  return [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
}

describe('replicaSwatches', () => {
  it('is null without the swatch table, else maps the clan roles (unknown keys → core)', () => {
    expect(replicaSwatches('rust', 1, () => null)).toBeNull();
    const lookup = swatchTable(['sst_gold']);
    const s = replicaSwatches('slantedStar', 2, lookup)!;
    expect(s.core).toEqual(lookup('sst_lacquer'));
    expect(s.plate).toEqual(lookup('sst_graphite'));
    // sst_gold is missing → the core swatch
    expect(s.trim).toEqual(s.core);
    expect(s.glow).toEqual(lookup('sst_glow'));
    const player = replicaSwatches(null, 1, lookup)!;
    expect(player.plate).toEqual(lookup('hull_light'));
    expect(player.glass).toEqual(lookup('glass_cockpit'));
  });
});

describe('cell sets and loops', () => {
  it('fills one-cell notches of the hull', () => {
    // a U: (0,0) (1,0) (2,0) (0,1) (2,1) – the notch (1,1) has three hull neighbours
    const grid = createGrid([
      ['armor', 0, 0, 0, 1],
      ['armor', 1, 0, 0, 1],
      ['armor', 2, 0, 0, 1],
      ['armor', 0, 1, 0, 1],
      ['armor', 2, 1, 0, 1],
    ]);
    expect(hullCells(grid).has('1,1')).toBe(true);
    expect(hullCells(grid).size).toBe(6);
  });

  it('splits the hull into body and ridge around the cockpit row', () => {
    const grid = captainGrid(5);
    const hull = hullCells(grid);
    const row = axisRow(grid);
    expect(row).toBe(0);
    const body = bodyCells(hull, row);
    expect([...body].every((k) => Math.abs(Number(k.split(',')[1])) <= 1)).toBe(true);
    const ridge = ridgeCells(body, row);
    expect(ridge.size).toBeGreaterThan(2);
    expect([...ridge].every((k) => k.endsWith(',0'))).toBe(true);
  });

  it('insets a loop toward its solid side and cuts convex corners', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    const inner = insetLoop(square, 0.25);
    expect(inner[0]).toEqual({ x: 0.25, y: 0.25 });
    expect(inner[2]).toEqual({ x: 1.75, y: 1.75 });
    const cut = cutCorners(square, 0.3);
    expect(cut).toHaveLength(8);
    expect(cut[0]!.x).toBeCloseTo(0, 9);
    expect(cut[0]!.y).toBeCloseTo(0.3, 9);
    // a hole (clockwise) keeps its corners: they are concave for the solid around it
    expect(cutCorners([...square].reverse(), 0.3)).toHaveLength(4);
  });
});

describe('displayModel', () => {
  const clans: (FactionId | null)[] = ['rust', 'slantedStar', 'cauldron', null];
  const lookup = swatchTable();

  it('stays within the triangle budget for every captain level and clan', () => {
    for (const clan of clans) {
      for (let level = 1; level <= 5; level++) {
        const soup = displayModel(captainGrid(level), replicaSwatches(clan, level >= 3 ? 2 : 1, lookup)!);
        expect(tris(soup)).toBeGreaterThan(200);
        expect(tris(soup)).toBeLessThanOrEqual(REPLICA_TRIANGLES);
      }
    }
  });

  it('is flat shaded: stored normals follow every triangle winding', () => {
    const soup = displayModel(captainGrid(4), replicaSwatches('cauldron', 2, lookup)!);
    for (let t = 0; t < tris(soup); t++) {
      const n = faceNormal(soup, t);
      const len = Math.hypot(...n);
      if (len < 1e-9) continue;
      for (let k = 0; k < 3; k++) {
        const v = soup.indices[t * 3 + k]! * 3;
        const dot = (n[0] * soup.normals[v]! + n[1] * soup.normals[v + 1]! + n[2] * soup.normals[v + 2]!) / len;
        expect(dot).toBeGreaterThan(0.99);
      }
    }
  });

  it('covers the hull with decks, puts the ridge highest and lets barrels and exhausts reach out', () => {
    const grid = captainGrid(5);
    const s = replicaSwatches('rust', 2, lookup)!;
    const soup = displayModel(grid, s);
    let deckArea = 0;
    let ridgeTop = -Infinity;
    for (let t = 0; t < tris(soup); t++) {
      const n = faceNormal(soup, t);
      const v = soup.indices[t * 3]!;
      if (n[1] > 0 && Math.abs(n[0]) + Math.abs(n[2]) < 1e-9) {
        deckArea += n[1] / 2;
        if (soup.uvs[v * 2] === s.trim[0]) ridgeTop = Math.max(ridgeTop, soup.positions[v * 3 + 1]!);
      }
    }
    // seen from above, the wing deck plus the upper tiers cover most of the hull (corners cut)
    expect(deckArea).toBeGreaterThan(hullCells(grid).size * 0.8);
    expect(ridgeTop).toBeCloseTo(RIDGE.deck, 6);
    // gun barrels (glowing muzzles) ahead of the guns, exhaust cones behind the rear engines
    const xsOf = (uv: readonly [number, number]): number[] => {
      const out: number[] = [];
      for (let v = 0; v < soup.uvs.length / 2; v++) if (soup.uvs[v * 2] === uv[0]) out.push(soup.positions[v * 3]!);
      return out;
    };
    const cannons = grid.parts.filter((p) => p.partId === 'cannon').map((p) => p.x);
    const engines = grid.parts.filter((p) => p.partId === 'engine').map((p) => p.x);
    expect(Math.max(...xsOf(s.weapon))).toBeGreaterThan(Math.max(...cannons) + 0.9);
    expect(Math.min(...xsOf(s.glow))).toBeLessThan(Math.min(...engines) - 1.2);
    const b = soupBounds(soup);
    expect(b.min[1]).toBeGreaterThanOrEqual(WING.bottom - 0.3);
  });
});

describe('pitchSoup and postSoup', () => {
  it('lifts the bow and stands the model on a post from the pedestal top to its axis', () => {
    const soup = displayModel(captainGrid(1), replicaSwatches(null, 1, swatchTable())!);
    const before = soupBounds(soup);
    pitchSoup(soup, 0.2);
    const after = soupBounds(soup);
    expect(after.max[1]).toBeGreaterThan(before.max[1]);
    const fit = pedestalFit(after, true);
    const post = soupBounds(postSoup(fit, 0.2, [0.5, 0.5]));
    // the post starts on the pedestal top (y = 0 after the fit) and stays near the turn axis
    expect(post.min[1] * fit.scale + fit.offset[1]).toBeCloseTo(0, 6);
    expect(post.max[1] * fit.scale + fit.offset[1]).toBeGreaterThan(REPLICA_LIFT);
    expect(Math.abs(((post.min[0] + post.max[0]) / 2) * fit.scale + fit.offset[0])).toBeLessThan(1e-6);
  });
});

describe('pedestalFit', () => {
  const ship = { min: [-3, -0.4, -2] as [number, number, number], max: [5, 0.5, 4] as [number, number, number] };

  it('fits a turning replica: its turn circle is REPLICA_EXTENT across, centred and lifted', () => {
    const f = pedestalFit(ship, true);
    expect(Math.hypot(8, 6) * f.scale).toBeCloseTo(REPLICA_EXTENT, 6);
    expect(REPLICA_EXTENT).toBeLessThanOrEqual(TROPHY_FIT.maxExtent);
    // the footprint centre (1, 1) lands on the axis, the lowest point at REPLICA_LIFT
    expect(1 * f.scale + f.offset[0]).toBeCloseTo(0, 6);
    expect(1 * f.scale + f.offset[2]).toBeCloseTo(0, 6);
    expect(-0.4 * f.scale + f.offset[1]).toBeCloseTo(REPLICA_LIFT, 6);
    expect(0.5 * f.scale + f.offset[1]).toBeLessThanOrEqual(TROPHY_FIT.maxHeight);
  });

  it('respects the height limit of a tall model', () => {
    const f = pedestalFit({ min: [0, 0, 0], max: [1, 10, 1] }, true);
    expect(10 * f.scale + REPLICA_LIFT).toBeCloseTo(TROPHY_FIT.maxHeight, 6);
  });

  it('keeps a still model at its origin and never scales it up', () => {
    const f = pedestalFit({ min: [-0.8, 0, -0.7], max: [0.8, 1.09, 0.7] }, false);
    expect(f.scale).toBe(1);
    expect(f.offset).toEqual([0, 0, 0]);
    expect(pedestalFit({ min: [-2, 0, -1], max: [2, 1, 1] }, false).scale).toBeCloseTo(TROPHY_FIT.maxExtent / 4, 6);
  });
});

describe('trophyYaw', () => {
  it('stands still with reduced motion, else turns slowly with a phase per pedestal', () => {
    expect(trophyYaw(3, 100, true)).toBe(STILL_YAW);
    expect(trophyYaw(0, 0, false)).toBeCloseTo(STILL_YAW, 6);
    expect(trophyYaw(0, 1, false)).toBeGreaterThan(trophyYaw(0, 0, false));
    expect(trophyYaw(0, 1, false) - trophyYaw(0, 0, false)).toBeLessThan(0.5);
    expect(trophyYaw(1, 0, false)).not.toBeCloseTo(trophyYaw(0, 0, false), 2);
  });
});
