import { describe, expect, it } from 'vitest';
import { createGrid } from '../ship/grid';
import { createRng } from '../math/rng';
import { shaped } from '../ship/testing';
import { cellOwners, gridToWorld, raycastGrid, raycastShip, segmentCircle, shapedCells, worldToGrid } from './geometry';

describe('ship frame transforms', () => {
  it('maps world points to grid coordinates and back', () => {
    const body = { pos: { x: 10, y: 5 }, vel: { x: 0, y: 0 }, angle: Math.PI / 2, angVel: 0 };
    const com = { x: 0.5, y: 0 };
    // cell (1, 0) lies 0.5 ahead of the centre of mass; the ship points to +y
    const w = gridToWorld(body, com, { x: 1, y: 0 });
    expect(w.x).toBeCloseTo(10);
    expect(w.y).toBeCloseTo(5.5);
    const g = worldToGrid(body, com, w);
    expect(g.x).toBeCloseTo(1);
    expect(g.y).toBeCloseTo(0);
  });
});

describe('raycastGrid (DDA)', () => {
  const grid = createGrid([['cockpit', 0, 0], ['armor', 1, 0], ['armor', 1, 1], ['engine', -1, 0]]);
  const owners = cellOwners(grid);

  it('caches the owner map per grid object', () => {
    expect(cellOwners(grid)).toBe(owners);
    expect(owners.get('1,1')).toBe(3);
  });

  it('finds the first occupied cell along the segment', () => {
    const hit = raycastGrid(owners, { x: 5, y: 0 }, { x: -5, y: 0 });
    expect(hit).toMatchObject({ partId: 2, cell: { x: 1, y: 0 } });
    // entry into cell (1,0) at x = 1.5 → t = 3.5 / 10
    expect(hit!.t).toBeCloseTo(0.35);
  });

  it('walks diagonally through cells', () => {
    const hit = raycastGrid(owners, { x: 4, y: 4 }, { x: -1, y: -1 });
    expect(hit?.cell).toEqual({ x: 1, y: 1 });
    expect(hit?.partId).toBe(3);
  });

  it('misses empty space and stops at the end of the segment', () => {
    expect(raycastGrid(owners, { x: 5, y: 3 }, { x: -5, y: 3 })).toBeNull();
    expect(raycastGrid(owners, { x: 5, y: 0 }, { x: 2, y: 0 })).toBeNull();
  });

  it('reports t = 0 when the segment starts inside a cell', () => {
    expect(raycastGrid(owners, { x: 0.1, y: 0.2 }, { x: 0.3, y: 0.2 })).toMatchObject({ partId: 1, t: 0 });
  });

  it('handles vertical segments', () => {
    expect(raycastGrid(owners, { x: 1, y: 5 }, { x: 1, y: -5 })).toMatchObject({ partId: 3, cell: { x: 1, y: 1 } });
  });
});

describe('segmentCircle', () => {
  it('returns the entry parameter of a segment into a circle', () => {
    expect(segmentCircle({ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, 2)).toBeCloseTo(0.4);
  });

  it('returns null for misses, short segments and starts inside the circle', () => {
    expect(segmentCircle({ x: -10, y: 3 }, { x: 10, y: 3 }, { x: 0, y: 0 }, 2)).toBeNull();
    expect(segmentCircle({ x: -10, y: 0 }, { x: -5, y: 0 }, { x: 0, y: 0 }, 2)).toBeNull();
    expect(segmentCircle({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, 2)).toBeNull();
  });
});

describe('shapedCells', () => {
  it('is empty (the fast path) for a grid without shapes and cached per grid object', () => {
    const grid = createGrid([['cockpit', 0, 0], ['armor', 1, 0]]);
    expect(shapedCells(grid).size).toBe(0);
    expect(shapedCells(grid)).toBe(shapedCells(grid));
  });

  it('holds the clipped polygon of every shaped cell; fully solid cells stay plain', () => {
    const grid = shaped(shaped(createGrid([['cockpit', 0, 0], ['armor', 1, 0], ['armor', 2, 0]]), 2, 'wedge'), 3, 'nose2x1');
    const cells = shapedCells(grid);
    expect(cells.get('1,0')).toMatchObject({ partId: 2 });
    expect(cells.get('1,0')!.poly).toHaveLength(3);
    // nose2x1 at (2,0): the rear cell is full, the front cell is the ogive
    expect(cells.has('2,0')).toBe(false);
    expect(cells.get('3,0')).toMatchObject({ partId: 3 });
    expect(cells.has('0,0')).toBe(false);
  });
});

describe('raycastGrid with shapes (polygon hits)', () => {
  // wedge at (1,0): solid where (x − 1) + y ≤ 0 (the hypotenuse faces front-port)
  const withWedge = (behind: boolean) =>
    shaped(createGrid(behind ? [['cockpit', 0, 0], ['armor', 1, 0], ['armor', 1, 1]] : [['cockpit', 0, 0], ['armor', 1, 0]]), 2, 'wedge');

  it('a shot through the empty half of a wedge hits the cell behind it', () => {
    const grid = withWedge(true);
    // along x + y = 1.3 (parallel to the hypotenuse, in its empty corner), towards −x +y
    const from = { x: 2.3, y: -1 };
    const to = { x: -1.7, y: 3 };
    expect(raycastGrid(cellOwners(grid), from, to)).toMatchObject({ partId: 2, cell: { x: 1, y: 0 } });
    const hit = raycastGrid(cellOwners(grid), from, to, shapedCells(grid));
    expect(hit).toMatchObject({ partId: 3, cell: { x: 1, y: 1 } });
    expect(raycastShip(grid, from, to)).toEqual(hit);
  });

  it('… and nothing when the cell behind is empty', () => {
    const grid = withWedge(false);
    expect(raycastShip(grid, { x: 2.3, y: -1 }, { x: -1.7, y: 3 })).toBeNull();
  });

  it('a shot on the hypotenuse returns t on the edge, not on the cell side', () => {
    const grid = withWedge(false);
    const from = { x: 3, y: 1.9 };
    const to = { x: -1, y: -2.1 };
    // the full cell is entered at (1.5, 0.4) → t = 0.375; the hypotenuse x + y = 1 at (1.05, −0.05) → t = 0.4875
    expect(raycastGrid(cellOwners(grid), from, to)!.t).toBeCloseTo(0.375);
    const hit = raycastShip(grid, from, to)!;
    expect(hit).toMatchObject({ partId: 2, cell: { x: 1, y: 0 } });
    expect(hit.t).toBeCloseTo(0.4875);
  });

  it('a half plate lets a shot along its open side through to the next part', () => {
    const grid = shaped(createGrid([['cockpit', 0, 0], ['armor', 1, 0]]), 2, 'half');
    // half at rot 0 is solid for y ∈ [−½, 0]
    expect(raycastShip(grid, { x: 5, y: 0.3 }, { x: -5, y: 0.3 })).toMatchObject({ partId: 1, cell: { x: 0, y: 0 } });
    const low = raycastShip(grid, { x: 5, y: -0.3 }, { x: -5, y: -0.3 })!;
    expect(low).toMatchObject({ partId: 2, cell: { x: 1, y: 0 } });
    expect(low.t).toBeCloseTo(0.35);
  });

  it('wing cells: each cell is hit on the slope, the empty front corner lets a shot through', () => {
    // wingL rot 0 at (0,0)+(1,0): solid below y = −½ + (1.5 − x) / 2
    const grid = shaped(createGrid([['armor', 0, 0]]), 1, 'wingL');
    expect(grid.parts[0]!.shape).toBe('wingL');
    const front = raycastShip(grid, { x: 1.2, y: 5 }, { x: 1.2, y: -5 })!;
    expect(front).toMatchObject({ partId: 1, cell: { x: 1, y: 0 } });
    expect(5 - 10 * front.t).toBeCloseTo(-0.35);
    const rear = raycastShip(grid, { x: 0.2, y: 5 }, { x: 0.2, y: -5 })!;
    expect(rear).toMatchObject({ partId: 1, cell: { x: 0, y: 0 } });
    expect(5 - 10 * rear.t).toBeCloseTo(0.15);
    // along y = 0.3 from the bow: the front cell is empty there, the rear cell is entered at x = −0.1
    const side = raycastShip(grid, { x: 5, y: 0.3 }, { x: -5, y: 0.3 })!;
    expect(side).toMatchObject({ partId: 1, cell: { x: 0, y: 0 } });
    expect(5 - 10 * side.t).toBeCloseTo(-0.1);
  });

  it('a segment starting inside the solid part of a shaped cell hits at t = 0', () => {
    const grid = withWedge(false);
    expect(raycastShip(grid, { x: 0.8, y: -0.3 }, { x: 0.9, y: -0.3 })).toMatchObject({ partId: 2, t: 0 });
    // starting in the empty corner and staying there: no hit
    expect(raycastShip(grid, { x: 1.3, y: 0.3 }, { x: 1.4, y: 0.4 })).toBeNull();
  });

  it('raycastShip skips parts outside `alive`', () => {
    const grid = withWedge(true);
    expect(raycastShip(grid, { x: 5, y: -0.2 }, { x: -5, y: -0.2 }, new Set([1, 3]))).toMatchObject({ partId: 1 });
    expect(raycastShip(grid, { x: 5, y: -0.2 }, { x: -5, y: -0.2 }, new Set([2]))).toMatchObject({ partId: 2 });
  });
});

describe('fast path: grids without shapes', () => {
  it('200 random shots give identical hits with and without the shapes argument', () => {
    const grid = createGrid([
      ['cockpit', 0, 0],
      ['armor', 1, 0],
      ['armor', 1, 1],
      ['engine', -1, 0],
      ['cargo', 0, -1],
      ['reactor', -1, 1],
      ['armor', 2, -1],
    ]);
    const owners = cellOwners(grid);
    const shapes = shapedCells(grid);
    const all = new Set(grid.parts.map((p) => p.id));
    const rng = createRng(20261020);
    const r = () => (rng() - 0.5) * 12;
    let hits = 0;
    for (let i = 0; i < 200; i++) {
      const from = { x: r(), y: r() };
      const to = { x: r(), y: r() };
      const plain = raycastGrid(owners, from, to);
      if (plain) hits++;
      expect(raycastGrid(owners, from, to, shapes)).toEqual(plain);
      expect(raycastShip(grid, from, to)).toEqual(plain);
      expect(raycastShip(grid, from, to, all)).toEqual(plain);
    }
    expect(hits).toBeGreaterThan(40);
  });
});
