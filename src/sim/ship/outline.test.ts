import { describe, expect, it } from 'vitest';
import type { PartId, Tier } from '../../data/parts';
import { SHAPE_IDS, type ShapeId } from '../../data/shapes';
import { ENEMY_TEMPLATES } from '../combat/enemies';
import type { Vec2 } from '../math/vec2';
import { createGrid, partCells } from './grid';
import {
  BEVEL_FP,
  BEVEL_FS,
  BEVEL_RP,
  BEVEL_RS,
  gridCellKeys,
  hullOutline,
  outlineSvgPath,
  type HullOutline,
  type OutlineEdge,
  type OutlineOptions,
} from './outline';
import { createStarterShip } from './presets';
import { partPolygon, polygonArea } from './shape';
import type { Rotation, ShipGrid } from './types';

// --- helpers -------------------------------------------------------------------------------------------

type Entry = [PartId, number, number, Rotation?, Tier?, ShapeId?];

const opts = (o: Partial<OutlineOptions> = {}): OutlineOptions => ({ tornFrom: null, bevelArmour: true, ...o });
const outlineOf = (grid: ShipGrid, o: Partial<OutlineOptions> = {}): HullOutline => hullOutline(grid, opts(o));
const P = (v: Vec2): string => `${v.x},${v.y}`;

/** Grid from rows of codes (top row first = highest y), as the spec §9 tables. '.' = empty. */
const CODES: Record<string, [PartId, Rotation]> = {
  'E': ['engine', 0], // forward engine, nozzle at the rear
  'E<': ['engine', 2], // braking engine
  'F': ['fuelTank', 0],
  'A': ['armor', 0],
  'K': ['cannon', 0],
  'R': ['reactor', 0],
  'G': ['gyro', 0],
  'Ca': ['cargo', 0],
  'S': ['shield', 0],
  'Rd': ['radar', 0],
  'C': ['cockpit', 0],
  'B': ['battery', 0],
  'L': ['miningLaser', 0],
  'T': ['tractorBeam', 0],
};
function fromRows(rows: string[], x0: number, yTop: number, tier: Tier = 1, extra: Entry[] = []): ShipGrid {
  const list: Entry[] = [];
  rows.forEach((row, r) => {
    row.split(/\s+/).forEach((code, c) => {
      if (code === '.') return;
      const [partId, rot] = CODES[code]!;
      list.push([partId, x0 + c, yTop - r, rot, tier]);
    });
  });
  return createGrid([...list, ...extra]);
}

/** Spec §9.3 A – small miner T1 "Scythe". */
const scythe = (): ShipGrid => fromRows(['E F Ca Ca L', 'E R G C A', 'E Rd Ca Ca L'], -2, 1);

/** Spec §9.4 B – freighter T2 "Mule" (before E2); the two 2×2 large cargo bays added at (−2,1) and (−2,−2). */
const freighter = (): ShipGrid =>
  fromRows(
    ['E F . . Ca Ca A A', 'E R . . Ca Ca S A', 'E R G B Ca Ca C A', 'E R . . Ca Ca Rd A', 'E F . . Ca Ca T A'],
    -4,
    2,
    2,
    [
      ['largeCargo', -2, 1, 0, 2],
      ['largeCargo', -2, -2, 0, 2],
    ],
  );

/** Warship "Halberd" C (before E2; tier 2 stands in for T3). */
const warship = (): ShipGrid =>
  fromRows(
    [
      'E F A A A A A A K',
      'E R G Ca S A K A A',
      'E R B Ca Rd A A A A',
      'E R G S A A C A K',
      'E R B Ca S A A A A',
      'E R G Ca S A K A A',
      'E F A A A A A A K',
    ],
    -4,
    3,
    2,
  );

/** A 30-cell ship for the benchmark (engines, tanks, cockpit, armour, cannons). */
const thirtyCells = (): ShipGrid =>
  fromRows(
    ['. . E< . . .', 'E R Ca A K .', 'E F S A A A', 'E G C A A A', 'E F S A A A', 'E R Ca A K .', '. . . . . .'],
    -2,
    3,
    1,
    [['engine', 0, -3, 1]],
  );

const idAt = (grid: ShipGrid, x: number, y: number): number => {
  const p = grid.parts.find((q) => partCells(q).some((c) => c.x === x && c.y === y));
  if (!p) throw new Error(`no part at ${x},${y}`);
  return p.id;
};

const allEdges = (o: HullOutline): OutlineEdge[] => o.loops.flatMap((l) => l.runs.flatMap((r) => r.edges));
/** The outline edge whose midpoint is (x, y). */
const edgeAt = (o: HullOutline, x: number, y: number): OutlineEdge => {
  const e = allEdges(o).find((q) => (q.a.x + q.b.x) / 2 === x && (q.a.y + q.b.y) / 2 === y);
  if (!e) throw new Error(`no outline edge at ${x},${y}`);
  return e;
};
const cornerAt = (o: HullOutline, x: number, y: number) => {
  const c = o.corners.filter((q) => q.at.x === x && q.at.y === y);
  if (c.length !== 1) throw new Error(`${c.length} corners at ${x},${y}`);
  return c[0]!;
};
const cellCount = (grid: ShipGrid): number => gridCellKeys(grid).size;

/** Structural invariants every outline must satisfy. */
function checkInvariants(grid: ShipGrid, o: HullOutline): void {
  let area = 0;
  let turns = 0;
  const verts = new Set<string>();
  for (const loop of o.loops) {
    area += loop.area;
    expect(loop.outer).toBe(loop.area > 0);
    const runs = loop.runs;
    expect(runs.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i]!;
      const next = runs[(i + 1) % runs.length]!;
      expect(r.b).toBe(next.a); // shared vertex objects, closed loop
      expect(r.a).toBe(r.edges[0]!.a);
      expect(r.b).toBe(r.edges[r.edges.length - 1]!.b);
      expect(r.owner).toBe(r.edges[0]!.owner);
      const dx = Math.sign(r.b.x - r.a.x);
      const dy = Math.sign(r.b.y - r.a.y);
      expect(Math.abs(dx) + Math.abs(dy)).toBe(1);
      for (let j = 0; j < r.edges.length; j++) {
        const e = r.edges[j]!;
        expect(e.kind).toBe(r.kind);
        expect(Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y)).toBe(0.5);
        expect(Math.sign(e.b.x - e.a.x)).toBe(dx);
        expect(Math.sign(e.b.y - e.a.y)).toBe(dy);
        if (j > 0) expect(e.a).toBe(r.edges[j - 1]!.b);
        verts.add(P(e.a));
      }
      const ndx = Math.sign(next.b.x - next.a.x);
      const ndy = Math.sign(next.b.y - next.a.y);
      const turn = ndx !== dx || ndy !== dy;
      if (turn) turns++;
      else expect(next.kind).not.toBe(r.kind); // a straight continuation is a new run only on a kind change
    }
  }
  expect(area).toBe(cellCount(grid));
  expect(o.corners.length).toBe(turns);
  for (const h of o.hubs) expect(verts.has(P(h))).toBe(false);
  for (const s of o.seams) expect(s.owners[0]).toBeLessThan(s.owners[1]);
}

// --- basics --------------------------------------------------------------------------------------------

describe('hullOutline – loops', () => {
  it('empty grid: nothing', () => {
    const o = outlineOf({ parts: [], nextId: 1 });
    expect(o.loops).toEqual([]);
    expect(o.corners).toEqual([]);
    expect(o.nav).toEqual([]);
    expect(outlineSvgPath({ parts: [], nextId: 1 })).toBe('');
  });

  it('single cell: one counter-clockwise loop of four raw runs with guards', () => {
    const grid = createGrid([['cockpit', 0, 0]]);
    const o = outlineOf(grid);
    checkInvariants(grid, o);
    expect(o.loops).toHaveLength(1);
    expect(o.loops[0]!.outer).toBe(true);
    expect(o.loops[0]!.area).toBe(1);
    expect(o.loops[0]!.runs.map((r) => `${P(r.a)}>${P(r.b)} ${r.kind} ${r.edges.length}`)).toEqual([
      '-0.5,-0.5>0.5,-0.5 raw 2',
      '0.5,-0.5>0.5,0.5 raw 2',
      '0.5,0.5>-0.5,0.5 raw 2',
      '-0.5,0.5>-0.5,-0.5 raw 2',
    ]);
    expect(o.corners.map((c) => `${P(c.at)} ${c.convex} ${c.kind} ${c.owner}`)).toEqual([
      '-0.5,-0.5 true guard 1',
      '0.5,-0.5 true guard 1',
      '0.5,0.5 true guard 1',
      '-0.5,0.5 true guard 1',
    ]);
    expect(o.seams).toEqual([]);
    expect(o.hubs).toEqual([]);
    expect(o.terraces).toEqual([]);
    expect(o.bevels.size).toBe(0);
  });

  it('5×3 armour block: one loop, bevelled corner cells, seams per cell side, no hubs at + crossings', () => {
    const list: Entry[] = [];
    for (let x = 0; x < 5; x++) for (let y = 0; y < 3; y++) list.push(['armor', x, y]);
    const grid = createGrid(list);
    const o = outlineOf(grid);
    checkInvariants(grid, o);
    expect(o.loops).toHaveLength(1);
    expect(o.loops[0]!.area).toBe(15);
    expect(o.loops[0]!.runs.map((r) => r.edges.length)).toEqual([10, 6, 10, 6]);
    expect(o.corners.map((c) => c.kind)).toEqual(['bevel', 'bevel', 'bevel', 'bevel']);
    expect([...o.bevels].sort((a, b) => a[0] - b[0])).toEqual([
      [idAt(grid, 0, 0), BEVEL_RS],
      [idAt(grid, 0, 2), BEVEL_RP],
      [idAt(grid, 4, 0), BEVEL_FS],
      [idAt(grid, 4, 2), BEVEL_FP],
    ]);
    // 4 vertical lines × 3 sides + 2 horizontal lines × 5 sides, every side between a different pair
    expect(o.seams).toHaveLength(22);
    expect(o.seams.every((s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) === 1)).toBe(true);
    expect(o.hubs).toEqual([]);
    // terrace v2: only the inner row (no cell on the outline)
    expect(o.terraces.map((t) => t.cells.map(P))).toEqual([['1,1', '2,1', '3,1']]);
    expect(o.terraces[0]!.owner).toBe(idAt(grid, 1, 1));
  });

  it('clan ships never bevel: the same corners get guards', () => {
    const grid = createGrid([['armor', 0, 0]]);
    const player = outlineOf(grid);
    expect(player.corners.map((c) => c.kind)).toEqual(['bevel', 'bevel', 'bevel', 'bevel']);
    expect(player.bevels.get(1)).toBe(BEVEL_FP | BEVEL_RP | BEVEL_RS | BEVEL_FS);
    const clan = outlineOf(grid, { bevelArmour: false });
    expect(clan.corners.map((c) => c.kind)).toEqual(['guard', 'guard', 'guard', 'guard']);
    expect(clan.bevels.size).toBe(0);
  });

  it('2×2 part: no internal edges, one loop of four 2-cell runs', () => {
    const grid = createGrid([['largeCargo', 0, 0]]);
    const o = outlineOf(grid);
    checkInvariants(grid, o);
    expect(o.loops[0]!.area).toBe(4);
    expect(o.loops[0]!.runs.map((r) => `${P(r.a)}>${P(r.b)} ${r.edges.length}`)).toEqual([
      '-0.5,-0.5>1.5,-0.5 4',
      '1.5,-0.5>1.5,1.5 4',
      '1.5,1.5>-0.5,1.5 4',
      '-0.5,1.5>-0.5,-0.5 4',
    ]);
    expect(o.corners.map((c) => c.kind)).toEqual(['guard', 'guard', 'guard', 'guard']);
    expect(o.seams).toEqual([]);
  });

  it('U notch: one loop, two concave corners, no fill', () => {
    const grid = createGrid([
      ['armor', 0, 0],
      ['armor', 1, 0],
      ['armor', 2, 0],
      ['armor', 0, 1],
      ['armor', 2, 1],
    ]);
    const o = outlineOf(grid);
    checkInvariants(grid, o);
    expect(o.loops).toHaveLength(1);
    expect(o.loops[0]!.area).toBe(5);
    expect(o.corners.filter((c) => c.convex)).toHaveLength(6);
    const concave = o.corners.filter((c) => !c.convex);
    expect(concave.map((c) => `${P(c.at)} ${c.kind}`)).toEqual(['1.5,0.5 none', '0.5,0.5 none']);
    expect(o.bevels.get(idAt(grid, 0, 1))).toBe(BEVEL_RP | BEVEL_FP);
    expect(o.bevels.get(idAt(grid, 2, 1))).toBe(BEVEL_RP | BEVEL_FP);
    expect(o.bevels.get(idAt(grid, 0, 0))).toBe(BEVEL_RS);
    expect(o.bevels.get(idAt(grid, 2, 0))).toBe(BEVEL_FS);
    expect(o.bevels.has(idAt(grid, 1, 0))).toBe(false);
  });

  it('closed hole: an outer loop and a clockwise hole with concave corners', () => {
    const list: Entry[] = [];
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) if (x !== 1 || y !== 1) list.push(['cargo', x, y]);
    const grid = createGrid(list);
    const o = outlineOf(grid);
    checkInvariants(grid, o);
    expect(o.loops.map((l) => [l.outer, l.area])).toEqual([
      [true, 9],
      [false, -1],
    ]);
    const hole = o.loops[1]!;
    expect(hole.runs.map((r) => `${P(r.a)}>${P(r.b)} ${r.kind}`)).toEqual([
      '0.5,0.5>0.5,1.5 raw',
      '0.5,1.5>1.5,1.5 raw',
      '1.5,1.5>1.5,0.5 raw',
      '1.5,0.5>0.5,0.5 raw',
    ]);
    const holeCorners = o.corners.slice(4);
    expect(holeCorners.every((c) => !c.convex && c.kind === 'none')).toBe(true);
    expect(o.hubs).toEqual([]);
  });

  it('L-shaped hole: the solid corner sticking into it is convex (bevel / guard)', () => {
    const list: Entry[] = [];
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) {
        if ((x === 1 && y === 1) || (x === 2 && y === 1) || (x === 1 && y === 2)) continue;
        list.push(['armor', x, y]);
      }
    }
    const grid = createGrid(list);
    const o = outlineOf(grid);
    checkInvariants(grid, o);
    expect(o.loops.map((l) => l.area)).toEqual([16, -3]);
    const inner = cornerAt(o, 1.5, 1.5);
    expect(inner.convex).toBe(true);
    expect(inner.kind).toBe('bevel');
    expect(inner.owner).toBe(idAt(grid, 2, 2));
    expect(o.bevels.get(idAt(grid, 2, 2))).toBe(BEVEL_RS);
    expect(outlineOf(grid, { bevelArmour: false }).corners.filter((c) => c.kind === 'guard')).toHaveLength(5);
  });

  it('disconnected draft: one outer loop per piece, the largest first, nav on it only', () => {
    const grid = createGrid([
      ['cockpit', 0, 0],
      ['armor', 3, 0],
      ['armor', 3, 1],
    ]);
    const o = outlineOf(grid);
    checkInvariants(grid, o);
    expect(o.loops.map((l) => [l.outer, l.area, P(l.runs[0]!.a)])).toEqual([
      [true, 2, '2.5,-0.5'],
      [true, 1, '-0.5,-0.5'],
    ]);
    expect(o.nav.every((n) => n.at.x >= 2.5 && n.at.x <= 3.5)).toBe(true);
  });

  it('pieces touching at a corner: two simple loops, each with its own convex corner', () => {
    const grid = createGrid([
      ['armor', 0, 0],
      ['armor', 1, 1],
    ]);
    const o = outlineOf(grid);
    checkInvariants(grid, o);
    expect(o.loops.map((l) => [l.area, l.runs.length])).toEqual([
      [1, 4],
      [1, 4],
    ]);
    expect(o.corners).toHaveLength(8);
    expect(o.corners.every((c) => c.convex && c.kind === 'bevel')).toBe(true);
    expect(o.corners.filter((c) => c.at.x === 0.5 && c.at.y === 0.5)).toHaveLength(2);
  });

  it('overlapping draft parts: the first part owns the cell, no crash', () => {
    const grid = createGrid([
      ['cargo', 0, 0],
      ['armor', 0, 0],
      ['armor', 1, 0],
    ]);
    const o = outlineOf(grid);
    expect(o.loops.map((l) => l.area)).toEqual([2]);
    expect(edgeAt(o, -0.5, 0.25).owner).toBe(1);
    expect(o.seams.map((s) => s.owners)).toEqual([[1, 3]]);
  });
});

// --- edge kinds ----------------------------------------------------------------------------------------

describe('hullOutline – edge kinds', () => {
  it('starter ship (spec §9.2 E): nozzles of rotated engines, the mining laser muzzle', () => {
    const grid = createStarterShip();
    const o = outlineOf(grid);
    checkInvariants(grid, o);
    expect(o.loops).toHaveLength(1);
    expect(o.loops[0]!.runs.map((r) => `${P(r.a)}>${P(r.b)} ${r.kind} #${r.owner}`)).toEqual([
      '-1.5,-1.5>-1,-1.5 nozzle #10',
      '-1,-1.5>-0.5,-1.5 raw #10',
      '-0.5,-1.5>-0.5,-2 raw #13',
      '-0.5,-2>-0.5,-2.5 nozzle #13',
      '-0.5,-2.5>0.5,-2.5 nozzle #13',
      '0.5,-2.5>0.5,-2 nozzle #13',
      '0.5,-2>0.5,-1.5 raw #13',
      '0.5,-1.5>2,-1.5 raw #8',
      '2,-1.5>2.5,-1.5 nozzle #12',
      '2.5,-1.5>2.5,-0.5 nozzle #12',
      '2.5,-0.5>2.5,0.5 muzzle #3',
      '2.5,0.5>2.5,1.5 nozzle #11',
      '2.5,1.5>2,1.5 nozzle #11',
      '2,1.5>0.5,1.5 raw #11',
      '0.5,1.5>0.5,2 raw #14',
      '0.5,2>0.5,2.5 nozzle #14',
      '0.5,2.5>-0.5,2.5 nozzle #14',
      '-0.5,2.5>-0.5,2 nozzle #14',
      '-0.5,2>-0.5,1.5 raw #14',
      '-0.5,1.5>-1,1.5 raw #9',
      '-1,1.5>-1.5,1.5 nozzle #9',
      '-1.5,1.5>-1.5,0.5 nozzle #9',
      '-1.5,0.5>-1.5,-0.5 raw #4',
      '-1.5,-0.5>-1.5,-1.5 nozzle #10',
    ]);
    // a run may span owners (radar → front half of the braking engine); per-edge owners are kept
    expect(o.loops[0]!.runs[7]!.edges.map((e) => e.owner)).toEqual([8, 8, 12]);
    // every convex corner of the starter ship touches a nozzle or the muzzle → no guards
    expect(o.corners.filter((c) => c.kind !== 'none')).toEqual([]);
  });

  it('engine rotations: the nozzle is always against the thrust, plus the rear half of the sides', () => {
    for (const rot of [0, 1, 2, 3] as const) {
      const o = outlineOf(createGrid([['engine', 0, 0, rot]]));
      const f = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ][rot]!;
      for (const e of allEdges(o)) {
        const mx = (e.a.x + e.b.x) / 2;
        const my = (e.a.y + e.b.y) / 2;
        const along = mx * f[0]! + my * f[1]!; // > 0 in front, < 0 behind
        expect(e.kind).toBe(along < 0 ? 'nozzle' : 'raw');
      }
    }
  });

  it('muzzles: cannon, mining laser, tractor beam and the 2×1 heavy laser (front edge only)', () => {
    for (const partId of ['cannon', 'miningLaser', 'tractorBeam'] as const) {
      const o = outlineOf(createGrid([[partId, 0, 0, 1]]));
      expect(edgeAt(o, -0.25, 0.5).kind).toBe('muzzle');
      expect(edgeAt(o, 0.25, 0.5).kind).toBe('muzzle');
      expect(allEdges(o).filter((e) => e.kind === 'muzzle')).toHaveLength(2);
    }
    const heavy = outlineOf(createGrid([['heavyLaser', 0, 0, 0]]));
    expect(allEdges(heavy).filter((e) => e.kind === 'muzzle').map((e) => P(e.a))).toEqual(['1.5,-0.5', '1.5,0']);
    const up = outlineOf(createGrid([['heavyLaser', 0, 0, 1]]));
    expect(allEdges(up).filter((e) => e.kind === 'muzzle').map((e) => P(e.a))).toEqual(['0.5,1.5', '0,1.5']);
    // a muzzle against another part is an internal seam, not an outline edge
    const covered = outlineOf(createGrid([['cannon', 0, 0], ['armor', 1, 0]]));
    expect(allEdges(covered).some((e) => e.kind === 'muzzle')).toBe(false);
  });

  it('pirate hulls: jackal cannon muzzle, scavenger tractor muzzle, hammer armour bow', () => {
    const jackal = outlineOf(ENEMY_TEMPLATES.jackal(1), { bevelArmour: false });
    expect(edgeAt(jackal, 1.5, 0.25).kind).toBe('muzzle');
    const scavenger = outlineOf(ENEMY_TEMPLATES.scavenger(2), { bevelArmour: false });
    expect(edgeAt(scavenger, 2.5, -0.25).kind).toBe('muzzle');
    const hammer = outlineOf(ENEMY_TEMPLATES.hammer(2), { bevelArmour: false });
    expect(edgeAt(hammer, 2.5, 0.25).kind).toBe('raw');
    expect(edgeAt(hammer, 2.5, 1.25).kind).toBe('muzzle');
    for (const grid of [ENEMY_TEMPLATES.jackal(1), ENEMY_TEMPLATES.scavenger(2), ENEMY_TEMPLATES.hammer(2)]) {
      checkInvariants(grid, outlineOf(grid, { bevelArmour: false }));
    }
  });

  it('torn edges: where a cell existed before and is gone now (no bevel / guard there)', () => {
    const before = ENEMY_TEMPLATES.hammer(2);
    const armourId = idAt(before, 2, 0);
    const after: ShipGrid = { parts: before.parts.filter((p) => p.id !== armourId), nextId: before.nextId };
    const torn = gridCellKeys(before);
    const o = outlineOf(after, { tornFrom: torn, bevelArmour: false });
    checkInvariants(after, o);
    const tornEdges = allEdges(o).filter((e) => e.kind === 'torn');
    expect(tornEdges.map((e) => `${(e.a.x + e.b.x) / 2},${(e.a.y + e.b.y) / 2}`).sort()).toEqual(
      ['1.5,-0.25', '1.5,0.25', '1.75,-0.5', '1.75,0.5', '2.25,-0.5', '2.25,0.5'].sort(),
    );
    for (const at of [
      [1.5, 0.5],
      [1.5, -0.5],
      [2.5, 0.5],
      [2.5, -0.5],
    ] as const) {
      expect(cornerAt(o, at[0], at[1]).kind).toBe('none');
    }
    // without the memory of the old cells the same edges are plain raw edges
    const fresh = outlineOf(after, { bevelArmour: false });
    expect(allEdges(fresh).some((e) => e.kind === 'torn')).toBe(false);
    expect(edgeAt(fresh, 1.5, 0.25).kind).toBe('raw');
  });

  it('a torn edge wins over a nozzle (the cell behind an engine was shot off)', () => {
    const before = createGrid([['engine', 0, 0, 0], ['armor', -1, 0], ['cockpit', 1, 0]]);
    const after: ShipGrid = { parts: before.parts.filter((p) => p.partId !== 'armor'), nextId: before.nextId };
    const o = outlineOf(after, { tornFrom: gridCellKeys(before) });
    expect(edgeAt(o, -0.5, 0.25).kind).toBe('torn');
    expect(edgeAt(o, -0.25, 0.5).kind).toBe('nozzle');
  });
});

// --- corners, bevels, seams, hubs -----------------------------------------------------------------------

describe('hullOutline – corners, seams and hubs', () => {
  it('gunner: only its two rear armour plates are shaved (player look) – guards for the clan', () => {
    const grid = ENEMY_TEMPLATES.gunner(1);
    const player = outlineOf(grid);
    checkInvariants(grid, player);
    expect([...player.bevels]).toEqual([
      [idAt(grid, -1, -2), BEVEL_RS],
      [idAt(grid, -1, 2), BEVEL_RP],
    ]);
    const clan = outlineOf(grid, { bevelArmour: false });
    expect(clan.bevels.size).toBe(0);
    expect(cornerAt(clan, -1.5, 2.5).kind).toBe('guard');
    expect(cornerAt(clan, -1.5, -2.5).kind).toBe('guard');
    // the front corners belong to cannons with a muzzle edge → nothing
    expect(cornerAt(clan, 3.5, 1.5).kind).toBe('none');
  });

  it('Scythe (spec §9.3): the armour nose is not a convex outline corner → no bevel', () => {
    const grid = scythe();
    const o = outlineOf(grid);
    checkInvariants(grid, o);
    expect(o.bevels.size).toBe(0);
    expect(edgeAt(o, 2.5, 0.25).kind).toBe('raw');
    expect(cornerAt(o, 2.5, 1.5).kind).toBe('none');
    expect(cornerAt(o, 2.5, -1.5).kind).toBe('none');
  });

  it('freighter (spec §9.4): bow armour corners bevelled, T hubs around the 2×2 bays', () => {
    const grid = freighter();
    const o = outlineOf(grid);
    checkInvariants(grid, o);
    expect(o.loops).toHaveLength(1);
    expect(o.loops[0]!.area).toBe(40);
    expect([...o.bevels].sort((a, b) => a[0] - b[0])).toEqual(
      [
        [idAt(grid, 3, 2), BEVEL_FP],
        [idAt(grid, 3, -2), BEVEL_FS],
      ].sort((a, b) => a[0]! - b[0]!),
    );
    expect(o.hubs.map(P)).toEqual(['-2.5,-1.5', '-2.5,1.5', '-1.5,-0.5', '-1.5,0.5', '-0.5,-1.5', '-0.5,1.5']);
    // the bay's right side meets two cargo cells → two seam runs on the same line
    const bay = idAt(grid, -2, 1);
    expect(
      o.seams.filter((s) => s.a.x === -0.5 && s.b.x === -0.5 && s.owners.includes(bay)).map((s) => `${P(s.a)}>${P(s.b)}`),
    ).toEqual(['-0.5,0.5>-0.5,1.5', '-0.5,1.5>-0.5,2.5']);
  });

  it('seams merge into straight runs along a multi-cell neighbour', () => {
    const grid = createGrid([
      ['largeCargo', 0, 0],
      ['heavyLaser', 2, 0, 1],
    ]);
    const o = outlineOf(grid);
    checkInvariants(grid, o);
    expect(o.seams.map((s) => `${P(s.a)}>${P(s.b)} ${s.owners.join('|')}`)).toEqual(['1.5,-0.5>1.5,1.5 1|2']);
  });

  it('hubs: a T junction gets one, a + crossing and seam ends on the outline none', () => {
    const t = createGrid([
      ['cargo', 0, 0],
      ['cargo', 1, 0],
      ['heavyLaser', 0, 1, 0],
    ]);
    const ot = outlineOf(t);
    checkInvariants(t, ot);
    // (0.5, 0.5): the laser's seam passes, the cargo|cargo seam ends → T; its other end (0.5, −0.5) is
    // on the outline → none
    expect(ot.hubs.map(P)).toEqual(['0.5,0.5']);
    const t2 = createGrid([
      ['cargo', 0, 0],
      ['cargo', 1, 0],
      ['heavyLaser', 0, 1, 0],
      ['heavyLaser', 0, -1, 0],
    ]);
    const ot2 = outlineOf(t2);
    checkInvariants(t2, ot2);
    // (0.5, ±0.5): a horizontal seam passes, the vertical cargo|cargo seam ends → two T hubs
    expect(ot2.hubs.map(P)).toEqual(['0.5,-0.5', '0.5,0.5']);
    const plus = createGrid([
      ['cargo', 0, 0],
      ['cargo', 1, 0],
      ['cargo', 0, 1],
      ['cargo', 1, 1],
    ]);
    expect(outlineOf(plus).hubs).toEqual([]);
  });

  it('hub rule on real ships: exactly the interior cell corners with three different parts around', () => {
    for (const grid of [createStarterShip(), freighter(), warship(), scythe(), ENEMY_TEMPLATES.gunner(2), ENEMY_TEMPLATES.hammer(1)]) {
      const o = outlineOf(grid);
      const owner = new Map<string, number>();
      for (const p of grid.parts) for (const c of partCells(p)) owner.set(`${c.x},${c.y}`, p.id);
      const expected: string[] = [];
      for (const [k] of owner) {
        const [x, y] = k.split(',').map(Number) as [number, number];
        // the corner (x + ½, y + ½) – each interior corner is visited from its lower-left cell
        const around = [owner.get(`${x},${y}`), owner.get(`${x + 1},${y}`), owner.get(`${x},${y + 1}`), owner.get(`${x + 1},${y + 1}`)];
        if (around.some((v) => v === undefined)) continue;
        if (new Set(around).size === 3) expected.push(`${x + 0.5},${y + 0.5}`);
      }
      expect(o.hubs.map(P).sort()).toEqual(expected.sort());
    }
  });
});

// --- nav lights ----------------------------------------------------------------------------------------

describe('hullOutline – nav points', () => {
  const nav = (o: HullOutline): string[] => o.nav.map((n) => `${n.kind} ${P(n.at)} #${n.owner}`);
  const mirror = (o: HullOutline): void => {
    const by = (k: string) => o.nav.filter((n) => n.kind === k);
    const port = by('port')[0]!;
    const star = by('starboard')[0]!;
    expect(star.at).toEqual({ x: port.at.x, y: -port.at.y });
    const aft = by('aft');
    expect(aft).toHaveLength(2);
    expect(aft[1]!.at).toEqual({ x: aft[0]!.at.x, y: -aft[0]!.at.y });
  };

  it('starter ship: lights only on lipped points (no light on a nozzle or the muzzle)', () => {
    const grid = createStarterShip();
    const o = outlineOf(grid);
    expect(nav(o)).toEqual([
      'bow 2,1.5 #11',
      'port 0.5,2 #14',
      'starboard 0.5,-2 #13',
      'aft -1,1.5 #9',
      'aft -1,-1.5 #10',
    ]);
    mirror(o);
  });

  it('symmetric ships: port / starboard and the aft pair mirror, the bow sits on the axis', () => {
    const hammer = outlineOf(ENEMY_TEMPLATES.hammer(2), { bevelArmour: false });
    expect(nav(hammer)[0]).toBe(`bow 2.5,0 #${idAt(ENEMY_TEMPLATES.hammer(2), 2, 0)}`);
    mirror(hammer);
    const grid = freighter();
    const f = outlineOf(grid);
    expect(nav(f)).toEqual([
      `bow 3.5,0 #${idAt(grid, 3, 0)}`,
      // the bevelled bow corners: the lights sit on the cut's ends
      `port 3.25,2.5 #${idAt(grid, 3, 2)}`,
      `starboard 3.25,-2.5 #${idAt(grid, 3, -2)}`,
      `aft -4,2.5 #${idAt(grid, -4, 2)}`,
      `aft -4,-2.5 #${idAt(grid, -4, -2)}`,
    ]);
    mirror(f);
    mirror(outlineOf(warship()));
    mirror(outlineOf(ENEMY_TEMPLATES.gunner(1)));
  });

  it('asymmetric ship: the bow light is weighted towards the cockpit row', () => {
    const shape: Entry[] = [
      ['cockpit', 0, 0],
      ['cargo', 1, 0],
      ['cargo', 0, 1],
      ['cargo', 0, 2],
      ['cargo', 1, 2],
    ];
    const low = createGrid(shape);
    expect(nav(outlineOf(low))).toEqual([
      'bow 1.5,0 #2',
      'port 1.5,2.5 #5',
      'starboard 1.5,-0.5 #2',
      'aft -0.5,2.5 #4',
      'aft -0.5,-0.5 #1',
    ]);
    // the same shape with the cockpit in the top row: the bow light moves up to it
    const high = createGrid([
      ['cargo', 0, 0],
      ['cargo', 1, 0],
      ['cargo', 0, 1],
      ['cockpit', 0, 2],
      ['cargo', 1, 2],
    ]);
    expect(nav(outlineOf(high))[0]).toBe('bow 1.5,2 #5');
  });
});

// --- terraces (v2: the low inner spine, plan §2.8) ----------------------------------------------

/** The warship's spines: the two bow-axis rails of inner armour beside the cockpit. */
const WARSHIP_SPINES = [
  ['1,1', '2,1', '3,1'],
  ['1,-1', '2,-1', '3,-1'],
];

describe('hullOutline – terraces', () => {
  const cells = (o: HullOutline): string[][] => o.terraces.map((t) => t.cells.map(P));
  /** An armour block w × h from (0, 0), `swap` entries replacing the armour at their cells. */
  const block = (w: number, h: number, swap: Entry[] = []): ShipGrid => {
    const list: Entry[] = [];
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const s = swap.find((e) => e[1] === x && e[2] === y);
        list.push(s ?? ['armor', x, y]);
      }
    }
    return createGrid(list);
  };
  /** Every terrace: a straight run of unshaped armour with four occupied neighbours, spines never touching. */
  const checkRule = (grid: ShipGrid, o: HullOutline): void => {
    const keys = gridCellKeys(grid);
    expect(o.terraces.length).toBeLessThanOrEqual(2);
    for (let i = 0; i < o.terraces.length; i++) {
      const t = o.terraces[i]!;
      expect(t.cells.length).toBeGreaterThanOrEqual(3);
      if (i > 0) expect(t.cells.length).toBeLessThanOrEqual(o.terraces[i - 1]!.cells.length);
      for (const c of t.cells) {
        const part = grid.parts.find((p) => p.id === idAt(grid, c.x, c.y))!;
        expect(part.partId).toBe('armor');
        expect(part.shape).toBeUndefined();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) expect(keys.has(`${c.x + dx},${c.y + dy}`)).toBe(true);
      }
      expect(Math.min(...t.cells.map((c) => idAt(grid, c.x, c.y)))).toBe(t.owner);
      // one cell wide and straight: all on one row or one column, consecutive
      const xs = new Set(t.cells.map((c) => c.x));
      const ys = new Set(t.cells.map((c) => c.y));
      expect(xs.size === 1 || ys.size === 1).toBe(true);
      expect(Math.max(xs.size, ys.size)).toBe(t.cells.length);
    }
    // spines never touch
    for (let i = 0; i < o.terraces.length; i++) {
      for (let j = i + 1; j < o.terraces.length; j++) {
        for (const a of o.terraces[i]!.cells) for (const b of o.terraces[j]!.cells) expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThan(1);
      }
    }
    // no terrace cell has an outline edge
    const terraceKeys = new Set(o.terraces.flatMap((t) => t.cells.map(P)));
    for (const e of allEdges(o)) {
      const mx = (e.a.x + e.b.x) / 2;
      const my = (e.a.y + e.b.y) / 2;
      for (const c of [`${Math.round(mx - 0.25)},${Math.round(my - 0.25)}`, `${Math.round(mx + 0.25)},${Math.round(my + 0.25)}`]) {
        if (Math.abs(mx - Math.round(mx)) < 1e-9 || Math.abs(my - Math.round(my)) < 1e-9) expect(terraceKeys.has(c)).toBe(false);
      }
    }
  };

  it('inner cells only: a 3-row block keeps its middle row; runs shorter than 3 get nothing', () => {
    const g = block(5, 3);
    expect(cells(outlineOf(g))).toEqual([['1,1', '2,1', '3,1']]);
    checkRule(g, outlineOf(g));
    // a 4 × 4 block: the inner 2 × 2 has no run of 3
    expect(outlineOf(block(4, 4)).terraces).toEqual([]);
    // two rows: every cell is on the outline
    expect(outlineOf(block(8, 2)).terraces).toEqual([]);
  });

  it('a spine, not a carpet: one cell wide runs that never touch, the bow axis first', () => {
    // 7 × 5 block: inner 5 × 3 → rows y = 1 and y = 3 (the middle row touches both), never a 5 × 3 slab
    const g = block(7, 5);
    const o = outlineOf(g);
    expect(cells(o)).toEqual([
      ['1,1', '2,1', '3,1', '4,1', '5,1'],
      ['1,3', '2,3', '3,3', '4,3', '5,3'],
    ]);
    checkRule(g, o);
    // 3 wide, 7 long across the bow axis (x 0..2, y 0..6): no bow-axis run of 3 – the transverse column
    const tall = block(3, 7);
    expect(cells(outlineOf(tall))).toEqual([['1,1', '1,2', '1,3', '1,4', '1,5']]);
    checkRule(tall, outlineOf(tall));
  });

  it('the cell in front of a muzzle and behind a nozzle is left out (and < 3 left = no terrace)', () => {
    // cannon at the rear of the middle row: its muzzle bans (1,1)
    expect(outlineOf(block(5, 3, [['cannon', 0, 1]])).terraces).toEqual([]);
    const o = outlineOf(block(6, 3, [['cannon', 0, 1]]));
    expect(cells(o)).toEqual([['2,1', '3,1', '4,1']]);
    // a braking engine (nozzle towards the bow) at (0, 1): the cell behind it, (1, 1), is left out
    expect(cells(outlineOf(block(6, 3, [['engine', 0, 1, 2]])))).toEqual([['2,1', '3,1', '4,1']]);
    // a forward engine there: its nozzle points out of the hull, nothing banned
    expect(cells(outlineOf(block(6, 3, [['engine', 0, 1, 0]])))).toEqual([['1,1', '2,1', '3,1', '4,1']]);
  });

  it('shaped cells are out, and so is a cell whose shaped neighbour leaves its side open', () => {
    // a shaped plate in the middle row splits it: 1 + 1 cells, no terrace
    expect(outlineOf(block(5, 3, [['armor', 2, 1, 0, 1, 'chamfer']])).terraces).toEqual([]);
    // a half plate above (2, 1): solid side towards it (rot 0, starboard half) keeps the cell inner …
    const closed = block(5, 3, [['armor', 2, 2, 0, 1, 'half']]);
    expect(cells(outlineOf(closed))).toEqual([['1,1', '2,1', '3,1']]);
    // … turned by 180° (the port half) it leaves (2, 1)'s top side on the outline
    const open = block(5, 3, [['armor', 2, 2, 2, 1, 'half']]);
    expect(outlineOf(open).terraces).toEqual([]);
    checkRule(closed, outlineOf(closed));
  });

  it('only full armour: a non-armour cell breaks a run', () => {
    // 5 × 5 block, cargo at (3, 3) and (2, 1): bow-axis runs (1..3, 2) only; (1..2, 3) and (1, 1) are short
    const g = block(5, 5, [['cargo', 3, 3], ['cargo', 2, 1]]);
    const o = outlineOf(g);
    expect(cells(o)).toEqual([['1,2', '2,2', '3,2']]);
    checkRule(g, o);
  });

  it('at most two terraces: the longest first, ties by the lowest owner id', () => {
    // 3 rows, the middle row split by cargo into inner runs of 3, 4 and 3 cells
    const entries = (order: 'x' | 'rightFirst'): Entry[] => {
      const list: Entry[] = [];
      for (let x = 0; x < 14; x++) {
        for (let y = 0; y < 3; y++) list.push(y === 1 && (x === 4 || x === 9) ? ['cargo', x, y] : ['armor', x, y]);
      }
      if (order === 'x') return list;
      // the right-hand group's parts listed first: it gets the lower ids
      const right = list.filter((e) => e[1] >= 10);
      return [...right, ...list.filter((e) => e[1] < 10)];
    };
    const g = createGrid(entries('x'));
    const o = outlineOf(g);
    expect(cells(o)).toEqual([
      ['5,1', '6,1', '7,1', '8,1'],
      ['1,1', '2,1', '3,1'],
    ]);
    checkRule(g, o);
    const r = createGrid(entries('rightFirst'));
    expect(cells(outlineOf(r))).toEqual([
      ['5,1', '6,1', '7,1', '8,1'],
      ['10,1', '11,1', '12,1'],
    ]);
  });

  it('spec ships: no spine on the narrow gunner and freighter, two rails beside the warship cockpit', () => {
    expect(outlineOf(ENEMY_TEMPLATES.gunner(1), { bevelArmour: false }).terraces).toEqual([]);
    expect(outlineOf(freighter()).terraces).toEqual([]);
    const w = warship();
    const ow = outlineOf(w);
    checkRule(w, ow);
    expect(cells(ow)).toEqual(WARSHIP_SPINES);
    expect(outlineOf(createStarterShip()).terraces).toEqual([]);
  });
});

// --- determinism, memo, SVG, performance ----------------------------------------------------------------

describe('hullOutline – determinism and memo', () => {
  it('same input → same output; the order of grid.parts does not matter', () => {
    for (const make of [createStarterShip, freighter, warship, scythe, () => ENEMY_TEMPLATES.gunner(2)]) {
      const a = make();
      const b = make();
      const shuffled: ShipGrid = { parts: [...b.parts].reverse(), nextId: b.nextId };
      const oa = outlineOf(a);
      expect(outlineOf(b)).toEqual(oa);
      const os = outlineOf(shuffled);
      expect(os.loops).toEqual(oa.loops);
      expect(os.corners).toEqual(oa.corners);
      expect(os.seams).toEqual(oa.seams);
      expect(os.hubs).toEqual(oa.hubs);
      expect(os.nav).toEqual(oa.nav);
      expect(os.terraces).toEqual(oa.terraces);
      expect([...os.bevels].sort()).toEqual([...oa.bevels].sort());
      checkInvariants(a, oa);
    }
  });

  it('memoised per grid object and options', () => {
    const grid = createStarterShip();
    const torn = gridCellKeys(grid);
    const a = hullOutline(grid, { tornFrom: null, bevelArmour: true });
    expect(hullOutline(grid, { tornFrom: null, bevelArmour: true })).toBe(a);
    expect(hullOutline(grid, { tornFrom: null, bevelArmour: false })).not.toBe(a);
    const t = hullOutline(grid, { tornFrom: torn, bevelArmour: true });
    expect(t).not.toBe(a);
    expect(hullOutline(grid, { tornFrom: torn, bevelArmour: true })).toBe(t);
    expect(hullOutline({ ...grid }, { tornFrom: null, bevelArmour: true })).not.toBe(a);
  });

  it('every pirate hull of both tiers passes the invariants', () => {
    for (const make of Object.values(ENEMY_TEMPLATES)) {
      for (const tier of [1, 2] as const) {
        const grid = make(tier);
        checkInvariants(grid, outlineOf(grid, { bevelArmour: false }));
        checkInvariants(grid, outlineOf(grid, { bevelArmour: false, tornFrom: gridCellKeys(grid) }));
      }
    }
  });
});

describe('outlineSvgPath', () => {
  it('single cell: a square from the lowest-x corner, counter-clockwise', () => {
    expect(outlineSvgPath(createGrid([['cockpit', 0, 0]]))).toBe('M-0.5 -0.5L0.5 -0.5L0.5 0.5L-0.5 0.5Z');
  });

  it('armour corners cut by 0.25 for the player, square for clans', () => {
    const grid = createGrid([['armor', 0, 0]]);
    expect(outlineSvgPath(grid)).toBe(
      'M-0.5 -0.25L-0.25 -0.5L0.25 -0.5L0.5 -0.25L0.5 0.25L0.25 0.5L-0.25 0.5L-0.5 0.25Z',
    );
    expect(outlineSvgPath(grid, false)).toBe('M-0.5 -0.5L0.5 -0.5L0.5 0.5L-0.5 0.5Z');
  });

  it('holes are their own subpath (evenodd)', () => {
    const list: Entry[] = [];
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) if (x !== 1 || y !== 1) list.push(['cargo', x, y]);
    expect(outlineSvgPath(createGrid(list))).toBe(
      'M-0.5 -0.5L2.5 -0.5L2.5 2.5L-0.5 2.5Z M0.5 0.5L0.5 1.5L1.5 1.5L1.5 0.5Z',
    );
  });

  it('snapshots: starter ship and the gunner with its two shaved rear plates', () => {
    expect(outlineSvgPath(createStarterShip())).toBe(
      'M-1.5 -1.5L-0.5 -1.5L-0.5 -2.5L0.5 -2.5L0.5 -1.5L2.5 -1.5L2.5 1.5L0.5 1.5L0.5 2.5L-0.5 2.5L-0.5 1.5L-1.5 1.5Z',
    );
    expect(outlineSvgPath(ENEMY_TEMPLATES.gunner(1))).toBe(
      'M-1.5 -2.25L-1.25 -2.5L1.5 -2.5L1.5 -1.5L3.5 -1.5L3.5 1.5L1.5 1.5L1.5 2.5L-1.25 2.5L-1.5 2.25Z',
    );
    expect(outlineSvgPath(ENEMY_TEMPLATES.gunner(1), false)).toBe(
      'M-1.5 -2.5L1.5 -2.5L1.5 -1.5L3.5 -1.5L3.5 1.5L1.5 1.5L1.5 2.5L-1.5 2.5Z',
    );
  });
});

// --- recorded unshaped outlines (before SL2 E2 R1) -------------------------------------------------------

/**
 * FNV-1a over the JSON of a whole outline (bevels as a sorted list). Terraces are left out (hashed as
 * none): terrace v2 (R5) changed their rule on purpose – the "hullOutline – terraces" tests cover it.
 */
function outlineHash(o: HullOutline): string {
  const json = JSON.stringify({ ...o, terraces: [], bevels: [...o.bevels].sort((a, b) => a[0] - b[0]) });
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Every unshaped test ship with the option sets the game uses, by name. */
function recordedCases(): [string, ShipGrid, Partial<OutlineOptions>][] {
  const out: [string, ShipGrid, Partial<OutlineOptions>][] = [
    ['starter', createStarterShip(), {}],
    ['kosa', scythe(), {}],
    ['freighter', freighter(), {}],
    ['warship', warship(), {}],
    ['thirty', thirtyCells(), {}],
    ['warship-clan', warship(), { bevelArmour: false }],
  ];
  for (const [kind, make] of Object.entries(ENEMY_TEMPLATES)) {
    for (const tier of [1, 2] as const) {
      const grid = make(tier);
      out.push([`${kind}${tier}`, grid, { bevelArmour: false }]);
      out.push([`${kind}${tier}-player`, grid, {}]);
      // torn: every second part shot off
      const torn = gridCellKeys(grid);
      const after: ShipGrid = { parts: grid.parts.filter((_, i) => i % 2 === 0), nextId: grid.nextId };
      out.push([`${kind}${tier}-torn`, after, { bevelArmour: false, tornFrom: torn }]);
    }
  }
  return out;
}

// Ships that had E1 terraces (freighter, warship, thirty, gunner) were re-recorded once with the terraces
// left out of the hash (R5) – loops, corners, seams, hubs, nav and bevels are unchanged.
const RECORDED: Record<string, string> = {
  starter: '778e239e',
  kosa: 'a228fbad',
  freighter: 'e61dfd51',
  warship: '4c70fb21',
  thirty: '6941577a',
  'warship-clan': '4c70fb21',
  jackal1: '245a5a47',
  'jackal1-player': '245a5a47',
  'jackal1-torn': '5a764e92',
  jackal2: '245a5a47',
  'jackal2-player': '245a5a47',
  'jackal2-torn': '5a764e92',
  hammer1: 'f9280bca',
  'hammer1-player': 'f9280bca',
  'hammer1-torn': '7352332c',
  hammer2: 'f9280bca',
  'hammer2-player': 'f9280bca',
  'hammer2-torn': '7352332c',
  scavenger1: '8cef53d1',
  'scavenger1-player': '8cef53d1',
  'scavenger1-torn': '3076ed92',
  scavenger2: '8cef53d1',
  'scavenger2-player': '8cef53d1',
  'scavenger2-torn': '3076ed92',
  gunner1: 'cd6a7038',
  'gunner1-player': '8d0fd175',
  'gunner1-torn': '62c3f666',
  gunner2: 'cd6a7038',
  'gunner2-player': '8d0fd175',
  'gunner2-torn': '62c3f666',
  sentry1: '7d608f14',
  'sentry1-player': 'f862ae88',
  'sentry1-torn': '3e5bb30a',
  sentry2: '7d608f14',
  'sentry2-player': 'f862ae88',
  'sentry2-torn': '3e5bb30a',
};

describe('hullOutline – unshaped outlines are unchanged by E2', () => {
  it('outline hashes equal the values recorded before shapes', () => {
    const got: Record<string, string> = {};
    for (const [name, grid, o] of recordedCases()) got[name] = outlineHash(outlineOf(grid, o));
    expect(got).toEqual(RECORDED);
  });
});

// --- shaped parts (SL2 E2 R1) ------------------------------------------------------------------------------

const toEntries = (grid: ShipGrid): Entry[] =>
  grid.parts.map((p): Entry => (p.shape ? [p.partId, p.x, p.y, p.rot, p.tier, p.shape] : [p.partId, p.x, p.y, p.rot, p.tier]));

/** Spec §9.2 E after E2: two wedges beside the steering engines. */
const starterE2 = (): ShipGrid =>
  createGrid([...toEntries(createStarterShip()), ['armor', 1, 2, 0, 1, 'wedge'], ['armor', 1, -2, 3, 1, 'wedge']]);

/** Spec §9.3 A after E2: nose tip, wings, arcs. */
const scytheE2 = (): ShipGrid =>
  fromRows(['E F Ca Ca L', 'E R G C .', 'E Rd Ca Ca L'], -2, 1, 1, [
    ['armor', 2, 0, 0, 1, 'nose'],
    ['armor', 0, 2, 0, 1, 'wingL'],
    ['armor', 0, -2, 0, 1, 'wingR'],
    ['armor', -1, 2, 1, 1, 'arc'],
    ['armor', -1, -2, 2, 1, 'arc'],
  ]);

/** Spec §9.4 B after E2: the 45° wedge bow with the tractor beam at the tip, wings over the cargo. */
const freighterE2 = (): ShipGrid =>
  fromRows(
    ['E F . . Ca Ca . .', 'E R . . Ca Ca S .', 'E R G B Ca Ca C T', 'E R . . Ca Ca Rd .', 'E F . . Ca Ca . .'],
    -4,
    2,
    2,
    [
      ['largeCargo', -2, 1, 0, 2],
      ['largeCargo', -2, -2, 0, 2],
      ['armor', 2, 2, 0, 2, 'wedge'],
      ['armor', 2, -2, 3, 2, 'wedge'],
      ['armor', 3, 1, 0, 2, 'wedge'],
      ['armor', 3, -1, 3, 2, 'wedge'],
      ['armor', 0, 3, 0, 2, 'wingL'],
      ['armor', 0, -3, 0, 2, 'wingR'],
    ],
  );

/** Spec §9.5 C after E2: the stepped cannon bow, wedges and the 2×1 nose, wings at the stern. */
const warshipE2 = (): ShipGrid =>
  fromRows(
    [
      '. A A A A A A K .',
      'E F Ca F B G A A K',
      'E R R S R R S A A',
      'E G B R G C Rd A A',
      'E R R S R R S A A',
      'E F Ca F B G A A K',
      '. A A A A A A K .',
    ],
    -4,
    3,
    2,
    [
      ['armor', 5, 1, 0, 2, 'wedge'],
      ['armor', 5, -1, 3, 2, 'wedge'],
      ['armor', 5, 0, 0, 2, 'nose2x1'],
      ['armor', -3, 4, 0, 2, 'wingL'],
      ['armor', -3, -4, 0, 2, 'wingR'],
    ],
  );

/** Spec §9.6 D after E2: the hammer with a nose tip and two wings (a clan ship). */
const hammerE2 = (): ShipGrid =>
  createGrid([
    ...toEntries(ENEMY_TEMPLATES.hammer(2)),
    ['armor', 3, 0, 0, 2, 'nose'],
    ['armor', -2, 2, 0, 2, 'wingL'],
    ['armor', -2, -2, 0, 2, 'wingR'],
  ]);

const SHAPED_SHIPS: [string, () => ShipGrid, Partial<OutlineOptions>][] = [
  ['E', starterE2, {}],
  ['A', scytheE2, {}],
  ['B', freighterE2, {}],
  ['C', warshipE2, {}],
  ['D', hammerE2, { bevelArmour: false }],
];

const unit = (a: Vec2, b: Vec2): Vec2 => {
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
};
const sameDirection = (u: Vec2, v: Vec2): boolean => Math.abs(u.x * v.y - u.y * v.x) <= 1e-9 && u.x * v.x + u.y * v.y > 0;

/** Structural invariants of an outline with shaped parts (general edge directions and lengths). */
function checkShapedInvariants(grid: ShipGrid, o: HullOutline, detail: 'sim' | 'render' = 'sim'): void {
  const byId = new Map(grid.parts.map((p) => [p.id, p]));
  let area = 0;
  let turns = 0;
  const verts = new Set<string>();
  for (const loop of o.loops) {
    area += loop.area;
    expect(loop.outer).toBe(loop.area > 0);
    const runs = loop.runs;
    expect(runs.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i]!;
      const next = runs[(i + 1) % runs.length]!;
      expect(r.b).toBe(next.a);
      expect(r.a).toBe(r.edges[0]!.a);
      expect(r.b).toBe(r.edges[r.edges.length - 1]!.b);
      expect(r.owner).toBe(r.edges[0]!.owner);
      const dir = unit(r.a, r.b);
      for (let j = 0; j < r.edges.length; j++) {
        const e = r.edges[j]!;
        expect(e.kind).toBe(r.kind);
        expect(sameDirection(unit(e.a, e.b), dir)).toBe(true);
        if (j > 0) expect(e.a).toBe(r.edges[j - 1]!.b);
        if (e.kind === 'shaped') expect(byId.get(e.owner)!.shape).toBeDefined();
        else {
          expect(Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y)).toBe(0.5);
          expect(e.a.x === e.b.x || e.a.y === e.b.y).toBe(true);
        }
        verts.add(P(e.a));
      }
      if (!sameDirection(dir, unit(next.a, next.b))) turns++;
      else expect(next.kind).not.toBe(r.kind);
    }
  }
  let expected = 0;
  for (const p of grid.parts) {
    const poly = partPolygon(p, detail);
    expected += poly ? polygonArea(poly) : partCells(p).length;
  }
  expect(area).toBeCloseTo(expected, 9);
  expect(o.corners.length).toBe(turns);
  for (const h of o.hubs) expect(verts.has(P(h))).toBe(false);
  for (const s of o.seams) expect(s.owners[0]).toBeLessThan(s.owners[1]);
  // golden rule 1: shaped parts are never bevelled and get no guards
  for (const p of grid.parts) {
    if (p.shape === undefined) continue;
    expect(o.bevels.has(p.id)).toBe(false);
    for (const c of o.corners) if (c.owner === p.id) expect(c.kind).toBe('none');
  }
}

/** A grid with the parts at the given cells laid in a shape (and rotation). */
function reshape(grid: ShipGrid, changes: [number, number, ShapeId, Rotation][]): ShipGrid {
  const list = toEntries(grid);
  for (const [x, y, shape, rot] of changes) {
    const i = list.findIndex((e) => e[1] === x && e[2] === y);
    if (i < 0) throw new Error(`no part at ${x},${y}`);
    const [partId, , , , tier] = list[i]!;
    list[i] = [partId, x, y, rot, tier, shape];
  }
  return createGrid(list);
}

describe('hullOutline – shaped parts alone', () => {
  it('every shape in every rotation: one loop along its polygon, raw cell sides, shaped cuts, no bevel', () => {
    for (const shape of SHAPE_IDS) {
      for (const rot of [0, 1, 2, 3] as const) {
        for (const detail of ['sim', 'render'] as const) {
          const grid = createGrid([['armor', 0, 0, rot, 1, shape]]);
          const o = outlineOf(grid, { detail });
          checkShapedInvariants(grid, o, detail);
          expect(o.loops).toHaveLength(1);
          const poly = partPolygon(grid.parts[0]!, detail)!;
          expect(o.loops[0]!.area).toBeCloseTo(polygonArea(poly), 12);
          // the corners are exactly the polygon's vertices
          expect(o.corners.map((c) => P(c.at)).sort()).toEqual(poly.map(P).sort());
          expect(o.corners.every((c) => c.convex && c.kind === 'none')).toBe(true);
          expect(o.bevels.size).toBe(0);
          expect(o.terraces).toEqual([]);
          // an edge is raw exactly when it lies on a cell side
          for (const e of allEdges(o)) {
            const onSide =
              (e.a.x === e.b.x && Math.abs(Math.abs(e.a.x % 1) - 0.5) < 1e-12) ||
              (e.a.y === e.b.y && Math.abs(Math.abs(e.a.y % 1) - 0.5) < 1e-12);
            expect(`${shape} ${rot} ${e.kind}`).toBe(`${shape} ${rot} ${onSide ? 'raw' : 'shaped'}`);
          }
        }
      }
    }
  });

  it('a single wedge: two raw legs and one shaped hypotenuse; SVG follows the triangle', () => {
    const grid = createGrid([['armor', 0, 0, 0, 1, 'wedge']]);
    const o = outlineOf(grid);
    expect(o.loops[0]!.runs.map((r) => `${P(r.a)}>${P(r.b)} ${r.kind} ${r.edges.length}`)).toEqual([
      '-0.5,-0.5>0.5,-0.5 raw 2',
      '0.5,-0.5>-0.5,0.5 shaped 1',
      '-0.5,0.5>-0.5,-0.5 raw 2',
    ]);
    expect(outlineSvgPath(grid)).toBe('M-0.5 -0.5L0.5 -0.5L-0.5 0.5Z');
  });

  it('curves: render detail has more chords than sim detail; curve vertices are shared objects', () => {
    const grid = createGrid([['armor', 0, 0, 0, 1, 'round']]);
    const sim = outlineOf(grid, { detail: 'sim' });
    const render = outlineOf(grid, { detail: 'render' });
    const shapedCount = (o: HullOutline): number => allEdges(o).filter((e) => e.kind === 'shaped').length;
    expect(shapedCount(sim)).toBe(4);
    expect(shapedCount(render)).toBe(12);
    checkShapedInvariants(grid, render, 'render');
    // the SVG path of a curve uses the render chords
    expect(outlineSvgPath(grid).split('L')).toHaveLength(render.corners.length);
  });
});

describe('hullOutline – shaped parts against their neighbours', () => {
  it('half plate against a full cell: the shared half side cancels, the other half is a raw edge', () => {
    const grid = createGrid([
      ['armor', 0, 0, 0, 1, 'half'],
      ['armor', 1, 0],
    ]);
    const o = outlineOf(grid);
    checkShapedInvariants(grid, o);
    expect(o.loops).toHaveLength(1);
    expect(o.loops[0]!.area).toBe(1.5);
    expect(allEdges(o).some((e) => (e.a.x + e.b.x) / 2 === 0.5 && (e.a.y + e.b.y) / 2 === -0.25)).toBe(false);
    const upper = edgeAt(o, 0.5, 0.25);
    expect([upper.kind, upper.owner, P(upper.a), P(upper.b)]).toEqual(['raw', 2, '0.5,0.5', '0.5,0']);
    const open = edgeAt(o, 0, 0);
    expect([open.kind, open.owner, P(open.a), P(open.b)]).toEqual(['shaped', 1, '0.5,0', '-0.5,0']);
    expect(cornerAt(o, 0.5, 0).convex).toBe(false);
    // the seam runs along the solid half only
    expect(o.seams.map((s) => `${P(s.a)}>${P(s.b)} ${s.owners.join('|')}`)).toEqual(['0.5,-0.5>0.5,0 1|2']);
    // the full plate keeps its outer bevels and the rear-port corner standing out over the half plate;
    // the corner touching the half plate's open edge is concave (mitre only)
    expect(o.bevels.get(2)).toBe(BEVEL_FP | BEVEL_FS | BEVEL_RP);
    expect(o.bevels.has(1)).toBe(false);
  });

  it('wedge beside a full plate: one straight raw bottom run, bevels only on the full plate', () => {
    const grid = createGrid([
      ['armor', 0, 0],
      ['armor', 1, 0, 0, 1, 'wedge'],
    ]);
    const o = outlineOf(grid);
    checkShapedInvariants(grid, o);
    expect(o.loops[0]!.runs.map((r) => `${P(r.a)}>${P(r.b)} ${r.kind} ${r.edges.map((e) => e.owner).join('')}`)).toEqual([
      '-0.5,-0.5>1.5,-0.5 raw 1122',
      '1.5,-0.5>0.5,0.5 shaped 2',
      '0.5,0.5>-0.5,0.5 raw 11',
      '-0.5,0.5>-0.5,-0.5 raw 11',
    ]);
    expect(o.bevels.get(1)).toBe(BEVEL_RS | BEVEL_RP);
    expect(cornerAt(o, 1.5, -0.5).kind).toBe('none');
    expect(cornerAt(o, 0.5, 0.5).kind).toBe('none');
    expect(o.seams.map((s) => `${P(s.a)}>${P(s.b)}`)).toEqual(['0.5,-0.5>0.5,0.5']);
    expect(outlineSvgPath(grid)).toBe('M-0.5 -0.25L-0.25 -0.5L1.5 -0.5L0.5 0.5L-0.25 0.5L-0.5 0.25Z');
    expect(outlineSvgPath(grid, false)).toBe('M-0.5 -0.5L1.5 -0.5L0.5 0.5L-0.5 0.5Z');
  });

  it('a hypotenuse towards a neighbour: no seam, the neighbour keeps its raw side; point contact = two loops', () => {
    const grid = createGrid([
      ['cockpit', 0, 0],
      ['armor', 1, 0, 2, 1, 'wedge'], // hypotenuse rear-starboard: touches the cockpit only at (0.5, 0.5)
    ]);
    const o = outlineOf(grid);
    checkShapedInvariants(grid, o);
    expect(o.loops.map((l) => [l.outer, l.area])).toEqual([
      [true, 1],
      [true, 0.5],
    ]);
    expect(o.seams).toEqual([]);
    expect(edgeAt(o, 0.5, 0.25).kind).toBe('raw');
    expect(edgeAt(o, 0.5, -0.25).kind).toBe('raw');
    // the cockpit keeps its guards, the wedge none
    expect(o.corners.filter((c) => c.owner === 1).map((c) => c.kind)).toEqual(['guard', 'guard', 'guard', 'guard']);
  });

  it('seams follow the shared solid intervals; a chamfer cut closed by its neighbours is a hole (no hub)', () => {
    const grid = createGrid([
      ['cargo', 0, 0],
      ['cargo', 1, 0],
      ['cargo', 0, 1],
      ['armor', 1, 1, 2, 1, 'chamfer'], // cut corner rear-starboard, at the block centre
    ]);
    const o = outlineOf(grid);
    checkShapedInvariants(grid, o);
    expect(o.loops.map((l) => [l.outer, l.area])).toEqual([
      [true, 4],
      [false, -0.125],
    ]);
    expect(o.loops[1]!.runs.map((r) => `${P(r.a)}>${P(r.b)} ${r.kind}`)).toEqual([
      '0.5,0.5>0.5,1 raw',
      '0.5,1>1,0.5 shaped',
      '1,0.5>0.5,0.5 raw',
    ]);
    expect(o.seams.map((s) => `${P(s.a)}>${P(s.b)} ${s.owners.join('|')}`)).toEqual([
      '0.5,-0.5>0.5,0.5 1|2',
      '0.5,1>0.5,1.5 3|4',
      '-0.5,0.5>0.5,0.5 1|3',
      '1,0.5>1.5,0.5 2|4',
    ]);
    expect(o.hubs).toEqual([]);
    expect(edgeAt(o, 0.75, 0.5).kind).toBe('raw');
    expect(edgeAt(o, 0.75, 0.75).kind).toBe('shaped');
  });

  it('a chamfered corner inside a block of four: L / T seams get hubs, the shaped notch none', () => {
    // 3×3 cargo block with a chamfer in the middle of the top row, cut corner pointing out (FP)
    const list: Entry[] = [];
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) list.push(['cargo', x, y]);
    const grid = reshape(createGrid(list), [[1, 2, 'chamfer', 0]]);
    const o = outlineOf(grid);
    checkShapedInvariants(grid, o);
    expect(o.hubs).toEqual([]); // every interior corner has four different parts around: + crossings
    expect(edgeAt(o, 1.25, 2.25).kind).toBe('shaped');
  });

  it("torn edges: a shaped part's cell sides tear like full cells, its shaped edges never", () => {
    const before = warshipE2();
    const gone = [idAt(before, 3, 3), idAt(before, 2, 3), idAt(before, 4, 1)];
    const after: ShipGrid = { parts: before.parts.filter((p) => !gone.includes(p.id)), nextId: before.nextId };
    const o = outlineOf(after, { tornFrom: gridCellKeys(before) });
    checkShapedInvariants(after, o);
    const wedge = idAt(before, 5, 1);
    // the wedge's rear leg faced (4, 1)
    const leg = edgeAt(o, 4.5, 0.75);
    expect([leg.kind, leg.owner]).toEqual(['torn', wedge]);
    expect(allEdges(o).filter((e) => e.owner === wedge && e.kind === 'shaped')).toHaveLength(1);
    expect(allEdges(o).some((e) => e.kind === 'shaped' && byShape(after, e.owner) === undefined)).toBe(false);
  });

  it('overlapping draft: a wing half covered by another part is drawn as the full cell it owns', () => {
    const grid = createGrid([
      ['cargo', 1, 0],
      ['armor', 0, 0, 0, 1, 'wingL'], // (0,0)+(1,0); (1,0) belongs to the cargo
    ]);
    const o = outlineOf(grid);
    expect(o.loops.map((l) => l.area)).toEqual([2]);
    expect(allEdges(o).some((e) => e.kind === 'shaped')).toBe(false);
    expect(o.bevels.has(2)).toBe(false);
  });

  it('terraces skip shaped cells', () => {
    // a 6 × 3 armour block: inner row (1..4, 1); a shaped plate at (4, 1) leaves (1..3, 1)
    const list: Entry[] = [];
    for (let x = 0; x < 6; x++) for (let y = 0; y < 3; y++) list.push(x === 4 && y === 1 ? ['armor', x, y, 0, 1, 'chamfer'] : ['armor', x, y]);
    expect(outlineOf(createGrid(list)).terraces.map((t) => t.cells.map(P))).toEqual([['1,1', '2,1', '3,1']]);
    const wedge = list.map((e): Entry => (e[1] === 2 && e[2] === 1 ? ['armor', 2, 1, 0, 1, 'wedge'] : e));
    expect(outlineOf(createGrid(wedge)).terraces).toEqual([]);
  });
});

const byShape = (grid: ShipGrid, id: number): ShapeId | undefined => grid.parts.find((p) => p.id === id)?.shape;

describe('hullOutline – spec ships after E2', () => {
  it('A–E: one outer loop each, invariants at both details, shaped parts never bevelled', () => {
    for (const [name, make, o] of SHAPED_SHIPS) {
      for (const detail of ['sim', 'render'] as const) {
        const grid = make();
        const out = outlineOf(grid, { ...o, detail });
        checkShapedInvariants(grid, out, detail);
        expect(`${name} ${out.loops.filter((l) => l.outer).length}`).toBe(`${name} 1`);
      }
    }
  });

  it("B: the wedge bow is one 45° shaped run from the tractor beam's tip, per-edge owners kept", () => {
    const grid = freighterE2();
    const o = outlineOf(grid);
    const runs = o.loops[0]!.runs;
    const port = runs.find((r) => P(r.a) === '3.5,0.5')!;
    expect([port.kind, P(port.b), port.edges.map((e) => e.owner)]).toEqual([
      'shaped',
      '1.5,2.5',
      [idAt(grid, 3, 1), idAt(grid, 2, 2)],
    ]);
    const star = runs.find((r) => P(r.b) === '3.5,-0.5')!;
    expect([star.kind, P(star.a)]).toEqual(['shaped', '1.5,-2.5']);
    // the tractor beam's front is still a muzzle between the two hypotenuses
    expect(edgeAt(o, 3.5, 0.25).kind).toBe('muzzle');
    expect(cornerAt(o, 3.5, 0.5).kind).toBe('none');
    // the wedges sit on the station parts: seams along their solid legs
    expect(o.seams.some((s) => s.owners.includes(idAt(grid, 3, 1)) && s.owners.includes(idAt(grid, 3, 0)))).toBe(true);
    expect(o.bevels.size).toBe(0);
  });

  it('A and C: the wing tips are convex vertices', () => {
    const a = outlineOf(scytheE2(), { detail: 'render' });
    for (const y of [2.5, -2.5]) {
      const c = cornerAt(a, -0.5, y);
      expect([c.convex, c.kind]).toEqual([true, 'none']);
    }
    // the inner end of the wing's slope meets the laser: a concave corner
    expect(cornerAt(a, 1.5, 1.5).convex).toBe(false);
    const c = outlineOf(warshipE2());
    for (const y of [4.5, -4.5]) {
      const corner = cornerAt(c, -3.5, y);
      expect([corner.convex, corner.kind]).toEqual([true, 'none']);
    }
  });

  it("C: the 2×1 nose tip is the bow nav point; port / starboard lights mirror", () => {
    const grid = warshipE2();
    for (const detail of ['sim', 'render'] as const) {
      const o = outlineOf(grid, { detail });
      expect(o.nav[0]).toEqual({ at: { x: 6.5, y: 0 }, kind: 'bow', owner: idAt(grid, 6, 0) });
      const port = o.nav.find((n) => n.kind === 'port')!;
      const star = o.nav.find((n) => n.kind === 'starboard')!;
      expect(star.at).toEqual({ x: port.at.x, y: -port.at.y });
      expect(port.at).toEqual({ x: -3.5, y: 4.5 }); // the wing tip
    }
  });

  it('A: the nose tip is the bow light, the arcs and wings carry the lip candidates', () => {
    const grid = scytheE2();
    const o = outlineOf(grid);
    expect(o.nav[0]).toEqual({ at: { x: 2.5, y: 0 }, kind: 'bow', owner: idAt(grid, 2, 0) });
    expect(o.nav.find((n) => n.kind === 'port')!.at).toEqual({ x: -0.5, y: 2.5 });
  });

  it('determinism: same input → same output, independent of the order of grid.parts', () => {
    for (const [, make, opt] of SHAPED_SHIPS) {
      for (const detail of ['sim', 'render'] as const) {
        const a = make();
        const b = make();
        const shuffled: ShipGrid = { parts: [...b.parts].reverse(), nextId: b.nextId };
        const oa = outlineOf(a, { ...opt, detail });
        expect(outlineOf(b, { ...opt, detail })).toEqual(oa);
        const os = outlineOf(shuffled, { ...opt, detail });
        expect(os.loops).toEqual(oa.loops);
        expect(os.corners).toEqual(oa.corners);
        expect(os.seams).toEqual(oa.seams);
        expect(os.hubs).toEqual(oa.hubs);
        expect(os.nav).toEqual(oa.nav);
        expect(os.terraces).toEqual(oa.terraces);
        expect([...os.bevels].sort()).toEqual([...oa.bevels].sort());
      }
    }
  });

  it('memo: the curve detail is part of the key; unshaped grids give the same outline at both details', () => {
    const grid = scytheE2();
    const sim = hullOutline(grid, { tornFrom: null, bevelArmour: true, detail: 'sim' });
    expect(hullOutline(grid, { tornFrom: null, bevelArmour: true })).toBe(sim);
    const render = hullOutline(grid, { tornFrom: null, bevelArmour: true, detail: 'render' });
    expect(render).not.toBe(sim);
    expect(hullOutline(grid, { tornFrom: null, bevelArmour: true, detail: 'render' })).toBe(render);
    expect(allEdges(render).length).toBeGreaterThan(allEdges(sim).length);
    for (const [name, g, o] of recordedCases()) {
      expect(`${name} ${outlineHash(outlineOf(g, { ...o, detail: 'render' }))}`).toBe(`${name} ${RECORDED[name]}`);
    }
  });
});

// shared CI runners are several times slower than a dev machine; the budgets are for the latter
const CI_SLACK = import.meta.env.CI ? 3 : 1;

describe('hullOutline – performance', () => {
  it('≤ 0.1 ms for a 30-cell ship (uncached)', () => {
    const grid = thirtyCells();
    expect(cellCount(grid)).toBe(30);
    const torn = gridCellKeys(grid);
    // a fresh grid object per call defeats the memo
    const once = (): HullOutline => hullOutline({ parts: grid.parts, nextId: grid.nextId }, { tornFrom: torn, bevelArmour: true });
    for (let i = 0; i < 300; i++) once();
    let best = Infinity;
    for (let b = 0; b < 7; b++) {
      const t0 = performance.now();
      for (let i = 0; i < 200; i++) once();
      best = Math.min(best, (performance.now() - t0) / 200);
    }
    expect(best).toBeLessThanOrEqual(0.1 * CI_SLACK);
  });

  it('≤ 0.15 ms for a 30-cell ship with 6 shapes (render detail, uncached)', () => {
    const grid = reshape(thirtyCells(), [
      [3, 1, 'wedge', 0],
      [3, -1, 'wedge', 3],
      [3, 0, 'nose', 0],
      [1, 2, 'round', 1],
      [1, -2, 'arc', 2],
      [2, 1, 'chamfer', 0],
    ]);
    expect(cellCount(grid)).toBe(30);
    expect(grid.parts.filter((p) => p.shape !== undefined)).toHaveLength(6);
    const torn = gridCellKeys(grid);
    checkShapedInvariants(grid, hullOutline(grid, { tornFrom: torn, bevelArmour: true, detail: 'render' }), 'render');
    const once = (): HullOutline =>
      hullOutline({ parts: grid.parts, nextId: grid.nextId }, { tornFrom: torn, bevelArmour: true, detail: 'render' });
    for (let i = 0; i < 300; i++) once();
    let best = Infinity;
    for (let b = 0; b < 7; b++) {
      const t0 = performance.now();
      for (let i = 0; i < 200; i++) once();
      best = Math.min(best, (performance.now() - t0) / 200);
    }
    expect(best).toBeLessThanOrEqual(0.15 * CI_SLACK);
  });
});
