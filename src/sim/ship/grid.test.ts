import { describe, expect, it } from 'vitest';
import {
  connectedToCockpit,
  createGrid,
  facing,
  footprintCells,
  footprintCenter,
  laserPivot,
  partCells,
  partCenter,
  rotatedSize,
  validateGrid,
} from './grid';

describe('grid geometry', () => {
  it('rotates sizes', () => {
    expect(rotatedSize({ w: 2, h: 1 }, 0)).toEqual({ w: 2, h: 1 });
    expect(rotatedSize({ w: 2, h: 1 }, 1)).toEqual({ w: 1, h: 2 });
    expect(rotatedSize({ w: 2, h: 1 }, 2)).toEqual({ w: 2, h: 1 });
  });

  it('maps rotation to facing', () => {
    expect(facing(0)).toEqual({ x: 1, y: 0 });
    expect(facing(1)).toEqual({ x: 0, y: 1 });
    expect(facing(2)).toEqual({ x: -1, y: 0 });
    expect(facing(3)).toEqual({ x: 0, y: -1 });
  });

  it('lists cells and center of a 1x1 part', () => {
    const grid = createGrid([['armor', 3, -2]]);
    const part = grid.parts[0]!;
    expect(partCells(part)).toEqual([{ x: 3, y: -2 }]);
    expect(partCenter(part)).toEqual({ x: 3, y: -2 });
  });

  it('assigns sequential ids, tier 1 by default and the next free id', () => {
    const grid = createGrid([['cockpit', 0, 0], ['armor', 1, 0, 0, 2]]);
    expect(grid.parts.map((p) => p.id)).toEqual([1, 2]);
    expect(grid.parts.map((p) => p.tier)).toEqual([1, 2]);
    expect(grid.nextId).toBe(3);
  });
});

describe('validateGrid', () => {
  it('accepts a valid ship', () => {
    expect(validateGrid(createGrid([['cockpit', 0, 0], ['engine', -1, 0]]))).toEqual([]);
  });

  it('rejects an empty ship', () => {
    expect(validateGrid({ parts: [], nextId: 1 })).toEqual(['empty']);
  });

  it('detects overlap', () => {
    expect(validateGrid(createGrid([['cockpit', 0, 0], ['armor', 0, 0]]))).toContain('overlap');
  });

  it('detects missing and multiple cockpits', () => {
    expect(validateGrid(createGrid([['armor', 0, 0]]))).toContain('noCockpit');
    expect(validateGrid(createGrid([['cockpit', 0, 0], ['cockpit', 1, 0]]))).toContain('multipleCockpits');
  });

  it('detects disconnected parts', () => {
    expect(validateGrid(createGrid([['cockpit', 0, 0], ['armor', 5, 5]]))).toContain('disconnected');
  });
});

describe('connectedToCockpit', () => {
  it('returns ids reachable from the cockpit', () => {
    const grid = createGrid([
      ['cockpit', 0, 0],
      ['armor', 1, 0],
      ['armor', 2, 0],
      ['armor', 9, 9],
    ]);
    expect([...connectedToCockpit(grid)].sort()).toEqual([1, 2, 3]);
  });

  it('is empty without a cockpit', () => {
    expect(connectedToCockpit(createGrid([['armor', 0, 0]])).size).toBe(0);
  });
});

describe('multi-cell parts (2x1, 2x2, 3x1 in every rotation)', () => {
  const SIZES = [
    { w: 2, h: 1 },
    { w: 2, h: 2 },
    { w: 3, h: 1 },
  ];
  const ROTS = [0, 1, 2, 3] as const;

  it('footprint covers w×h cells from (x, y), swapped at 90° and 270°', () => {
    for (const size of SIZES) {
      for (const rot of ROTS) {
        const { w, h } = rotatedSize(size, rot);
        expect(rot % 2 === 0 ? [w, h] : [h, w]).toEqual([size.w, size.h]);
        const cells = footprintCells(size, 4, -3, rot);
        expect(cells).toHaveLength(size.w * size.h);
        const xs = cells.map((c) => c.x);
        const ys = cells.map((c) => c.y);
        expect([Math.min(...xs), Math.max(...xs)]).toEqual([4, 4 + w - 1]);
        expect([Math.min(...ys), Math.max(...ys)]).toEqual([-3, -3 + h - 1]);
        expect(new Set(cells.map((c) => `${c.x},${c.y}`)).size).toBe(cells.length);
      }
    }
  });

  it('centre is the middle of the occupied cells (model origin)', () => {
    expect(footprintCenter({ w: 2, h: 1 }, 3, 0, 0)).toEqual({ x: 3.5, y: 0 });
    expect(footprintCenter({ w: 2, h: 1 }, 3, 0, 1)).toEqual({ x: 3, y: 0.5 });
    expect(footprintCenter({ w: 2, h: 2 }, -1, -1, 3)).toEqual({ x: -0.5, y: -0.5 });
    expect(footprintCenter({ w: 3, h: 1 }, 0, 0, 0)).toEqual({ x: 1, y: 0 });
    expect(footprintCenter({ w: 3, h: 1 }, 0, 0, 3)).toEqual({ x: 0, y: 1 });
    for (const size of SIZES) {
      for (const rot of ROTS) {
        const cells = footprintCells(size, 2, 5, rot);
        const c = footprintCenter(size, 2, 5, rot);
        expect(c.x).toBeCloseTo(cells.reduce((s, q) => s + q.x, 0) / cells.length);
        expect(c.y).toBeCloseTo(cells.reduce((s, q) => s + q.y, 0) / cells.length);
      }
    }
  });

  it('real multi-cell parts use their footprint (heavy laser 2x1, large cargo 2x2)', () => {
    const laser = createGrid([['heavyLaser', 0, 0, 1]]).parts[0]!;
    expect(partCells(laser)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 1 }]);
    expect(partCenter(laser)).toEqual({ x: 0, y: 0.5 });
    const cargo = createGrid([['largeCargo', 1, 1, 2]]).parts[0]!;
    expect(partCells(cargo)).toHaveLength(4);
    expect(partCenter(cargo)).toEqual({ x: 1.5, y: 1.5 });
  });

  it('laser pivot sits over the front cell of a heavy laser in every rotation', () => {
    const at = (rot: 0 | 1 | 2 | 3) => laserPivot(createGrid([['heavyLaser', 0, 0, rot]]).parts[0]!);
    expect(at(0)).toEqual({ x: 1, y: 0 });
    expect(at(1)).toEqual({ x: 0, y: 1 });
    expect(at(2)).toEqual({ x: 0, y: 0 });
    expect(at(3)).toEqual({ x: 0, y: 0 });
    expect(laserPivot(createGrid([['miningLaser', 2, 3, 1]]).parts[0]!)).toEqual({ x: 2, y: 3 });
  });

  it('connects through any cell of a multi-cell part', () => {
    // cockpit – big cargo 2×2 – armour attached only to the upper right corner of the cargo
    const grid = createGrid([
      ['cockpit', 0, 0],
      ['largeCargo', 1, 0],
      ['armor', 2, 2],
      ['heavyLaser', 3, 1, 1],
      ['armor', 5, 5],
    ]);
    expect([...connectedToCockpit(grid)].sort()).toEqual([1, 2, 3, 4]);
    expect(validateGrid(grid)).toEqual(['disconnected']);
  });

  it('detects overlap of multi-cell parts in every rotation', () => {
    for (const rot of ROTS) {
      const grid = createGrid([['cockpit', 0, 0], ['heavyLaser', -1, 0, rot]]);
      // 2×1 from (−1, 0): at 0° and 180° it also occupies (0, 0) with the cockpit, at 90° and 270° it does not
      expect(validateGrid(grid).includes('overlap')).toBe(rot % 2 === 0);
    }
  });
});
