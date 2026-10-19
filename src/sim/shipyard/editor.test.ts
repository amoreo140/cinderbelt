import { describe, expect, it } from 'vitest';
import { createGrid } from '../ship/grid';
import { createStarterShip } from '../ship/presets';
import type { Rotation, ShipGrid } from '../ship/types';
import { footprintCells, partCells } from '../ship/grid';
import { partSize } from '../ship/shape';
import { SHAPES, SHAPE_IDS, type ShapeId } from '../../data/shapes';
import {
  applyEditorOp,
  checkGroupMove,
  checkPlacement,
  connectedPiece,
  ghostCells,
  HANGAR_MAX,
  HANGAR_MIN,
  partAt,
  placementAnchor,
  rotatedGroup,
  rotatedPlacement,
  replayOps,
  type EditorResult,
} from './editor';

const grid2 = () => createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0]]);

function okGrid(r: EditorResult): ShipGrid {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.grid;
}

describe('applyEditorOp – place', () => {
  it('places a part with the next id and tier from the key', () => {
    const g = grid2();
    const next = okGrid(applyEditorOp(g, { op: 'place', key: 'cargo:2', x: 0, y: 1, rot: 0 }));
    expect(next.parts).toHaveLength(3);
    expect(next.parts[2]).toEqual({ id: 3, partId: 'cargo', tier: 2, x: 0, y: 1, rot: 0 });
    expect(next.nextId).toBe(4);
  });

  it('never mutates the input grid', () => {
    const g = grid2();
    const before = structuredClone(g);
    applyEditorOp(g, { op: 'place', key: 'armor:1', x: 1, y: 0, rot: 0 });
    applyEditorOp(g, { op: 'remove', id: 1 });
    applyEditorOp(g, { op: 'move', id: 2, x: 0, y: 1, rot: 1 });
    expect(g).toEqual(before);
  });

  it('rejects occupied cells', () => {
    expect(applyEditorOp(grid2(), { op: 'place', key: 'armor:1', x: 0, y: 0, rot: 0 })).toEqual({
      ok: false, error: 'occupied',
    });
  });

  it('places a part anywhere in the hangar, touching nothing (free placement)', () => {
    const loose = okGrid(applyEditorOp(grid2(), { op: 'place', key: 'armor:1', x: 4, y: 4, rot: 0 }));
    expect(loose.parts.at(-1)).toMatchObject({ partId: 'armor', x: 4, y: 4 });
    const empty: ShipGrid = { parts: [], nextId: 7 };
    const placed = okGrid(applyEditorOp(empty, { op: 'place', key: 'armor:1', x: 5, y: 5, rot: 0 }));
    expect(placed.parts[0]!.id).toBe(7);
  });

  it('keeps the ship inside the 15 × 15 hangar', () => {
    expect(HANGAR_MIN).toBe(-7);
    expect(HANGAR_MAX).toBe(7);
    const edge = createGrid([['cockpit', 7, 0]]);
    expect(applyEditorOp(edge, { op: 'place', key: 'armor:1', x: 8, y: 0, rot: 0 })).toEqual({
      ok: false, error: 'outOfBounds',
    });
    expect(applyEditorOp(edge, { op: 'place', key: 'armor:1', x: 6, y: 0, rot: 0 }).ok).toBe(true);
  });

  it('allows only one cockpit', () => {
    expect(applyEditorOp(grid2(), { op: 'place', key: 'cockpit:2', x: 1, y: 0, rot: 0 })).toEqual({
      ok: false, error: 'cockpitLimit',
    });
  });

  it('has no part count limit any more – the hull budget replaces it (design error, not placement)', () => {
    const list: ['armor', number, number][] = [];
    for (let i = 0; i < 100; i++) list.push(['armor', (i % 15) - 7, Math.floor(i / 15) - 7]);
    const full = createGrid(list);
    expect(applyEditorOp(full, { op: 'place', key: 'armor:1', x: 3, y: -1, rot: 0 }).ok).toBe(true);
  });

  it('rejects malformed operations', () => {
    expect(applyEditorOp(grid2(), { op: 'place', key: 'armor:1', x: 0.5, y: 1, rot: 0 }).ok).toBe(false);
    expect(applyEditorOp(grid2(), { op: 'place', key: 'armor:1', x: 0, y: 1, rot: 4 as 0 }).ok).toBe(false);
    expect(applyEditorOp(grid2(), { op: 'place', key: 'laser:1' as 'armor:1', x: 0, y: 1, rot: 0 })).toEqual({
      ok: false, error: 'invalidOp',
    });
  });
});

describe('applyEditorOp – remove', () => {
  it('removes anything, even the cockpit, and keeps nextId', () => {
    const next = okGrid(applyEditorOp(grid2(), { op: 'remove', id: 1 }));
    expect(next.parts.map((p) => p.id)).toEqual([2]);
    expect(next.nextId).toBe(3);
  });

  it('rejects unknown ids', () => {
    expect(applyEditorOp(grid2(), { op: 'remove', id: 9 })).toEqual({ ok: false, error: 'unknownPart' });
  });
});

describe('applyEditorOp – move and rotate', () => {
  it('moves a part and keeps its id and tier', () => {
    const g = createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0, 2]]);
    const next = okGrid(applyEditorOp(g, { op: 'move', id: 2, x: 0, y: -1, rot: 1 }));
    expect(next.parts[1]).toEqual({ id: 2, partId: 'engine', tier: 2, x: 0, y: -1, rot: 1 });
    expect(next.nextId).toBe(3);
  });

  it('rotates in place', () => {
    const next = okGrid(applyEditorOp(grid2(), { op: 'move', id: 2, x: -1, y: 0, rot: 2 }));
    expect(next.parts[1]!.rot).toBe(2);
  });

  it('ignores its own old cells but not other parts', () => {
    const g = createGrid([['cockpit', 0, 0], ['armor', 1, 0], ['armor', 2, 0]]);
    expect(applyEditorOp(g, { op: 'move', id: 3, x: 1, y: 0, rot: 0 })).toEqual({ ok: false, error: 'occupied' });
    expect(applyEditorOp(g, { op: 'move', id: 3, x: 3, y: 3, rot: 0 }).ok).toBe(true);
    expect(applyEditorOp(g, { op: 'move', id: 3, x: 1, y: 1, rot: 0 }).ok).toBe(true);
    expect(applyEditorOp(g, { op: 'move', id: 9, x: 1, y: 1, rot: 0 })).toEqual({ ok: false, error: 'unknownPart' });
  });

  it('moves the only part anywhere inside the hangar', () => {
    const g = createGrid([['cockpit', 0, 0]]);
    expect(applyEditorOp(g, { op: 'move', id: 1, x: 5, y: -5, rot: 0 }).ok).toBe(true);
    expect(applyEditorOp(g, { op: 'move', id: 1, x: 8, y: 0, rot: 0 })).toEqual({ ok: false, error: 'outOfBounds' });
  });

  it('moving the cockpit does not count as a second cockpit', () => {
    expect(applyEditorOp(grid2(), { op: 'move', id: 1, x: -1, y: 1, rot: 0 }).ok).toBe(true);
  });
});

describe('placement helpers', () => {
  it('checks a ghost without applying it', () => {
    const g = createStarterShip();
    expect(checkPlacement(g, 'armor', 1, 3, 0, 0)).toBeNull();
    expect(checkPlacement(g, 'armor', 1, 1, 0, 0)).toBe('occupied');
    expect(checkPlacement(g, 'cockpit', 1, 3, 0, 0)).toBe('cockpitLimit');
    // the dragged part does not block itself
    expect(checkPlacement(g, 'cockpit', 1, 1, 0, 0, 1)).toBeNull();
  });

  it('finds the part on a cell', () => {
    const g = createStarterShip();
    expect(partAt(g, 1, 0)?.partId).toBe('cockpit');
    expect(partAt(g, 5, 5)).toBeNull();
  });
});

describe('multi-cell parts in the editor (2x1 heavy laser, 2x2 large cargo)', () => {
  const ROTS = [0, 1, 2, 3] as const;

  it('places a heavy laser and a large cargo hold in every rotation', () => {
    for (const rot of ROTS) {
      const g = createGrid([['cockpit', 0, 0]]);
      const laser = okGrid(applyEditorOp(g, { op: 'place', key: 'heavyLaser:1', x: 1, y: 0, rot }));
      expect(partCells(laser.parts[1]!)).toHaveLength(2);
      const cargo = okGrid(applyEditorOp(g, { op: 'place', key: 'largeCargo:2', x: -2, y: 0, rot }));
      expect(partCells(cargo.parts[1]!)).toEqual([{ x: -2, y: 0 }, { x: -2, y: 1 }, { x: -1, y: 0 }, { x: -1, y: 1 }]);
    }
  });

  it('rejects a multi-cell part that overlaps or leaves the hangar with any of its cells', () => {
    const g = createGrid([['cockpit', 0, 0], ['armor', 0, 1]]);
    // 2×2 from (−1, 0) would take the cockpit
    expect(applyEditorOp(g, { op: 'place', key: 'largeCargo:1', x: -1, y: 0, rot: 0 })).toEqual({ ok: false, error: 'occupied' });
    // a 2×1 turned by 90° from (0, −1) would take (0, 0)
    expect(applyEditorOp(g, { op: 'place', key: 'heavyLaser:1', x: 0, y: -1, rot: 1 })).toEqual({ ok: false, error: 'occupied' });
    expect(applyEditorOp(g, { op: 'place', key: 'heavyLaser:1', x: 0, y: -2, rot: 1 }).ok).toBe(true);
    const edge = createGrid([['cockpit', 6, 0]]);
    expect(applyEditorOp(edge, { op: 'place', key: 'heavyLaser:1', x: 7, y: 0, rot: 0 })).toEqual({ ok: false, error: 'outOfBounds' });
    expect(applyEditorOp(edge, { op: 'place', key: 'heavyLaser:1', x: 7, y: 0, rot: 1 }).ok).toBe(true);
  });

  it('a multi-cell part may touch the ship or stand apart', () => {
    const g = createGrid([['cockpit', 0, 0]]);
    expect(applyEditorOp(g, { op: 'place', key: 'largeCargo:1', x: 1, y: -1, rot: 0 }).ok).toBe(true);
    expect(applyEditorOp(g, { op: 'place', key: 'largeCargo:1', x: 1, y: 1, rot: 0 }).ok).toBe(true);
    expect(applyEditorOp(g, { op: 'place', key: 'largeCargo:1', x: 7, y: 1, rot: 0 })).toEqual({ ok: false, error: 'outOfBounds' });
  });

  it('rotating in place is rejected when the new footprint would overlap a neighbour', () => {
    const g = createGrid([['cockpit', 0, 0], ['heavyLaser', 1, 0, 0], ['armor', 1, 1]]);
    expect(applyEditorOp(g, { op: 'move', id: 2, x: 1, y: 0, rot: 1 })).toEqual({ ok: false, error: 'occupied' });
    expect(applyEditorOp(g, { op: 'move', id: 2, x: 1, y: 0, rot: 3 })).toEqual({ ok: false, error: 'occupied' });
    expect(applyEditorOp(g, { op: 'move', id: 2, x: 1, y: 0, rot: 2 }).ok).toBe(true);
    expect(applyEditorOp(g, { op: 'move', id: 2, x: 1, y: -1, rot: 1 }).ok).toBe(true);
  });

  it('a moved multi-cell part ignores its own old cells', () => {
    const g = createGrid([['cockpit', 0, 0], ['largeCargo', 1, 0]]);
    expect(applyEditorOp(g, { op: 'move', id: 2, x: 1, y: -1, rot: 0 }).ok).toBe(true);
    expect(applyEditorOp(g, { op: 'move', id: 2, x: 0, y: 1, rot: 1 }).ok).toBe(true);
  });

  it('the ghost covers the whole rotated footprint', () => {
    expect(ghostCells('heavyLaser:1', 0, 0, 0)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    expect(ghostCells('heavyLaser:1', 0, 0, 3)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 1 }]);
    expect(ghostCells('largeCargo:1', 2, 2, 1)).toHaveLength(4);
  });
});

describe('placement anchor and rotation pivot', () => {
  it('anchors the footprint so that the cursor cell is inside it (centred for 3 cells)', () => {
    expect(placementAnchor({ w: 1, h: 1 }, { x: 4, y: 2 }, 0)).toEqual({ x: 4, y: 2 });
    expect(placementAnchor({ w: 2, h: 1 }, { x: 4, y: 2 }, 0)).toEqual({ x: 4, y: 2 });
    expect(placementAnchor({ w: 2, h: 2 }, { x: 4, y: 2 }, 3)).toEqual({ x: 4, y: 2 });
    expect(placementAnchor({ w: 3, h: 1 }, { x: 4, y: 2 }, 0)).toEqual({ x: 3, y: 2 });
    expect(placementAnchor({ w: 3, h: 1 }, { x: 4, y: 2 }, 1)).toEqual({ x: 4, y: 1 });
  });

  it('rotates a part around the grabbed cell – that cell stays covered', () => {
    for (const size of [{ w: 2, h: 1 }, { w: 2, h: 2 }, { w: 3, h: 1 }]) {
      for (const rot of [0, 1, 2, 3] as const) {
        for (const dir of [1, -1] as const) {
          const start = { x: 0, y: 0, rot };
          const grabbed = { x: 1, y: 0 };
          const cells = footprint(size, start.x, start.y, rot);
          for (const cell of cells) {
            const r = rotatedPlacement(size, start, cell, dir);
            const after = footprint(size, r.x, r.y, r.rot);
            expect(after.some((c) => c.x === cell.x && c.y === cell.y)).toBe(true);
            expect(r.rot).toBe((((rot + dir) % 4) + 4) % 4);
          }
          void grabbed;
        }
      }
    }
  });

  it('four quarter turns return to the start', () => {
    let p = { x: 2, y: -1, rot: 0 as 0 | 1 | 2 | 3 };
    for (let i = 0; i < 4; i++) p = rotatedPlacement({ w: 2, h: 1 }, p, { x: 3, y: -1 }, 1);
    expect(p).toEqual({ x: 2, y: -1, rot: 0 });
  });
});

function footprint(size: { w: number; h: number }, x: number, y: number, rot: number): { x: number; y: number }[] {
  const [w, h] = rot % 2 === 0 ? [size.w, size.h] : [size.h, size.w];
  const out: { x: number; y: number }[] = [];
  for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) out.push({ x: x + dx, y: y + dy });
  return out;
}

describe('moveGroup', () => {
  // cockpit (0,0), engines (-1,1) and (-1,-1), armour (1,0)
  const ship = () => createGrid([['cockpit', 0, 0], ['engine', -1, 1, 0], ['engine', -1, -1, 0], ['armor', 1, 0], ['gyro', -1, 0]]);

  it('moves several parts at once, keeping ids', () => {
    const g = okGrid(applyEditorOp(ship(), { op: 'moveGroup', moves: [{ id: 2, x: 2, y: 1, rot: 2 }, { id: 3, x: 2, y: -1, rot: 2 }] }));
    expect(g.parts.find((p) => p.id === 2)).toMatchObject({ x: 2, y: 1, rot: 2 });
    expect(g.parts.find((p) => p.id === 3)).toMatchObject({ x: 2, y: -1, rot: 2 });
    expect(g.nextId).toBe(ship().nextId);
  });

  it('checks the result, not step by step: a row shifted onto its own cells is fine', () => {
    const row = createGrid([['cockpit', 0, 0], ['armor', 1, 0], ['armor', 2, 0], ['armor', 3, 0]]);
    // moving 2 onto 3's cell one by one would fail – as a group it is valid
    const moves = [2, 3, 4].map((id, i) => ({ id, x: 2 + i, y: 0, rot: 0 as const }));
    expect(applyEditorOp(row, { op: 'moveGroup', moves }).ok).toBe(true);
    // a swap of two parts as well
    expect(applyEditorOp(row, { op: 'moveGroup', moves: [{ id: 2, x: 2, y: 0, rot: 0 }, { id: 3, x: 1, y: 0, rot: 0 }] }).ok).toBe(true);
  });

  it('rejects overlap with a part outside the group, between group parts, out of bounds and bad input', () => {
    const g = ship();
    expect(applyEditorOp(g, { op: 'moveGroup', moves: [{ id: 2, x: 0, y: 0, rot: 0 }] })).toEqual({ ok: false, error: 'occupied' });
    expect(applyEditorOp(g, { op: 'moveGroup', moves: [{ id: 2, x: 3, y: 3, rot: 0 }, { id: 3, x: 3, y: 3, rot: 0 }] })).toEqual({ ok: false, error: 'occupied' });
    expect(applyEditorOp(g, { op: 'moveGroup', moves: [{ id: 2, x: 8, y: 0, rot: 0 }] })).toEqual({ ok: false, error: 'outOfBounds' });
    expect(applyEditorOp(g, { op: 'moveGroup', moves: [{ id: 99, x: 3, y: 3, rot: 0 }] })).toEqual({ ok: false, error: 'unknownPart' });
    expect(applyEditorOp(g, { op: 'moveGroup', moves: [] })).toEqual({ ok: false, error: 'invalidOp' });
    expect(applyEditorOp(g, { op: 'moveGroup', moves: [{ id: 2, x: 3, y: 3, rot: 0 }, { id: 2, x: 4, y: 4, rot: 0 }] })).toEqual({ ok: false, error: 'invalidOp' });
    expect(applyEditorOp(g, { op: 'moveGroup', moves: [{ id: 2, x: 0.5, y: 3, rot: 0 }] })).toEqual({ ok: false, error: 'invalidOp' });
    expect(applyEditorOp(g, { op: 'moveGroup', moves: null as never })).toEqual({ ok: false, error: 'invalidOp' });
  });

  it('reports the validity of every cell for the ghost', () => {
    const g = ship();
    const r = checkGroupMove(g, [{ id: 2, x: 1, y: 0, rot: 0 }, { id: 3, x: 3, y: 3, rot: 0 }, { id: 4, x: 7, y: 0, rot: 0 }]);
    expect(r.error).toBeNull();
    expect(r.cells).toEqual([
      { x: 1, y: 0, id: 2, error: null }, // armour 4 leaves (1,0) – free for the group
      { x: 3, y: 3, id: 3, error: null },
      { x: 7, y: 0, id: 4, error: null },
    ]);
    const bad = checkGroupMove(g, [{ id: 2, x: 0, y: 0, rot: 0 }, { id: 3, x: 7, y: 7, rot: 0 }]);
    expect(bad.cells.map((c) => c.error)).toEqual(['occupied', null]);
    const big = createGrid([['cockpit', 0, 0], ['largeCargo', 1, 0]]);
    expect(checkGroupMove(big, [{ id: 2, x: 7, y: 0, rot: 0 }]).cells.map((c) => c.error)).toEqual([null, null, 'outOfBounds', 'outOfBounds']);
  });

  it('replays deterministically like any other op', () => {
    const ops = [{ op: 'moveGroup' as const, moves: [{ id: 2, x: 2, y: 1, rot: 2 as const }] }, { op: 'remove' as const, id: 3 }];
    const a = replayOps(ship(), ops);
    const b = replayOps(ship(), ops);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
  });
});

describe('rotatedGroup', () => {
  it('turns every part around the pivot cell and keeps the group rigid', () => {
    const g = createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ['heavyLaser', 1, 0, 0]]);
    const turned = rotatedGroup(g.parts, { x: 0, y: 0 }, 1);
    expect(turned).toEqual([
      { id: 1, x: 0, y: 0, rot: 1 },
      { id: 2, x: 0, y: -1, rot: 1 },
      { id: 3, x: 0, y: 1, rot: 1 }, // 2×1 laser along +x becomes 1×2 along +y
    ]);
    // the turned ship is still one connected piece
    const after = okGrid(applyEditorOp(g, { op: 'moveGroup', moves: turned }));
    expect(connectedPiece(after, 1)).toHaveLength(3);
  });

  it('four quarter turns (either way) return to the start, the pivot cell stays covered', () => {
    const g = createGrid([['largeCargo', 2, -1, 0], ['heavyLaser', 4, -1, 3], ['armor', 3, 1]]);
    for (const dir of [1, -1] as const) {
      let parts = g.parts;
      for (let i = 0; i < 4; i++) {
        const moves = rotatedGroup(parts, { x: 3, y: 0 }, dir);
        parts = parts.map((p) => {
          const m = moves.find((q) => q.id === p.id)!;
          return { ...p, x: m.x, y: m.y, rot: m.rot };
        });
        expect(parts.flatMap((p) => partCells(p)).some((c) => c.x === 3 && c.y === 0)).toBe(true);
      }
      expect(parts).toEqual(g.parts);
    }
  });
});

describe('connectedPiece', () => {
  it('collects every part touching through edges, cockpit or not', () => {
    const g = createGrid([['cockpit', 0, 0], ['armor', 1, 0], ['armor', 4, 4], ['armor', 4, 5], ['armor', 5, 6]]);
    expect(connectedPiece(g, 2)).toEqual([1, 2]);
    expect(connectedPiece(g, 3)).toEqual([3, 4]);
    expect(connectedPiece(g, 5)).toEqual([5]);
    expect(connectedPiece(g, 42)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// SL2 E2 S6a: shaped armour in the reducer

const ROTS: Rotation[] = [0, 1, 2, 3];
const cellSet = (cells: { x: number; y: number }[]) => cells.map((c) => `${c.x},${c.y}`).sort();
const shapeCells = (shape: ShapeId, x: number, y: number, rot: Rotation) => cellSet(footprintCells(SHAPES[shape].size, x, y, rot));
const byId = (g: ShipGrid, id: number) => g.parts.find((p) => p.id === id)!;

describe('applyEditorOp – place with a shape', () => {
  for (const shape of SHAPE_IDS) {
    it(`${shape}: every rotation, footprint from the shape`, () => {
      for (const rot of ROTS) {
        const next = okGrid(applyEditorOp(grid2(), { op: 'place', key: 'armor:2', x: 3, y: 2, rot, shape }));
        const part = next.parts.at(-1)!;
        expect(part).toEqual({ id: 3, partId: 'armor', tier: 2, x: 3, y: 2, rot, shape });
        expect(cellSet(partCells(part))).toEqual(shapeCells(shape, 3, 2, rot));
      }
    });
  }

  it('refuses a shape on a part that cannot be shaped, and an unknown shape', () => {
    expect(applyEditorOp(grid2(), { op: 'place', key: 'cargo:1', x: 3, y: 2, rot: 0, shape: 'wedge' })).toEqual({ ok: false, error: 'shapeNotAllowed' });
    expect(applyEditorOp(grid2(), { op: 'place', key: 'armor:1', x: 3, y: 2, rot: 0, shape: 'blob' as ShapeId })).toEqual({ ok: false, error: 'invalidOp' });
  });

  it('checks the whole 2×1 footprint of a wing (occupied, out of bounds)', () => {
    // wing rot 0 at (−1, 1) covers (−1, 1) and (0, 1); a cargo sits on (0, 1)
    const g = createGrid([['cockpit', 0, 0], ['cargo', 0, 1]]);
    expect(applyEditorOp(g, { op: 'place', key: 'armor:1', x: -1, y: 1, rot: 0, shape: 'wingL' })).toEqual({ ok: false, error: 'occupied' });
    expect(applyEditorOp(g, { op: 'place', key: 'armor:1', x: -1, y: 1, rot: 0, shape: 'wedge' }).ok).toBe(true);
    expect(applyEditorOp(g, { op: 'place', key: 'armor:1', x: HANGAR_MAX, y: 3, rot: 0, shape: 'nose2x1' })).toEqual({ ok: false, error: 'outOfBounds' });
    expect(applyEditorOp(g, { op: 'place', key: 'armor:1', x: HANGAR_MAX, y: 3, rot: 1, shape: 'nose2x1' }).ok).toBe(true);
  });

  it('a shapeless place adds no shape key', () => {
    const next = okGrid(applyEditorOp(grid2(), { op: 'place', key: 'armor:1', x: 3, y: 2, rot: 0 }));
    expect('shape' in next.parts.at(-1)!).toBe(false);
  });
});

describe('checkPlacement and ghostCells with a shape', () => {
  it('uses the shape footprint and refuses shapes on other parts', () => {
    const g = createGrid([['cockpit', 0, 0], ['cargo', 2, 1]]);
    expect(checkPlacement(g, 'armor', 1, 1, 1, 0)).toBeNull();
    expect(checkPlacement(g, 'armor', 1, 1, 1, 0, undefined, 'wingR')).toBe('occupied');
    expect(checkPlacement(g, 'armor', 1, 1, 1, 0, undefined, null)).toBeNull();
    expect(checkPlacement(g, 'engine', 1, 1, 1, 0, undefined, 'wedge')).toBe('shapeNotAllowed');
    expect(checkPlacement(g, 'armor', 1, 1, 1, 0, undefined, 'blob' as ShapeId)).toBe('invalidOp');
  });

  it('ghostCells covers the shape footprint', () => {
    expect(cellSet(ghostCells('armor:1', 0, 0, 1, 'wingL'))).toEqual(['0,0', '0,1']);
    expect(cellSet(ghostCells('armor:1', 0, 0, 1, 'wedge'))).toEqual(['0,0']);
    expect(cellSet(ghostCells('armor:1', 0, 0, 1))).toEqual(['0,0']);
  });
});

describe('applyEditorOp – reshape', () => {
  const base = () => createGrid([['cockpit', 0, 0], ['armor', 1, 0, 0, 2], ['armor', 3, 3]]);

  for (const shape of SHAPE_IDS) {
    it(`${shape}: every rotation, in place, id kept`, () => {
      for (const rot of ROTS) {
        const g = okGrid(applyEditorOp(base(), { op: 'move', id: 3, x: 3, y: 3, rot }));
        const next = okGrid(applyEditorOp(g, { op: 'reshape', id: 3, shape }));
        expect(byId(next, 3)).toEqual({ id: 3, partId: 'armor', tier: 1, x: 3, y: 3, rot, shape });
        expect(next.parts.map((p) => p.id)).toEqual(g.parts.map((p) => p.id));
        expect(next.nextId).toBe(g.nextId);
        expect(cellSet(partCells(byId(next, 3)))).toEqual(shapeCells(shape, 3, 3, rot));
      }
    });
  }

  it('null lays the part back as the full plate (no shape key)', () => {
    const wedge = okGrid(applyEditorOp(base(), { op: 'reshape', id: 2, shape: 'wedge' }));
    const full = okGrid(applyEditorOp(wedge, { op: 'reshape', id: 2, shape: null }));
    expect(full).toEqual(base());
    expect('shape' in byId(full, 2)).toBe(false);
  });

  it('reshaping to the same shape changes nothing', () => {
    const wedge = okGrid(applyEditorOp(base(), { op: 'reshape', id: 2, shape: 'wedge' }));
    expect(okGrid(applyEditorOp(wedge, { op: 'reshape', id: 2, shape: 'wedge' }))).toEqual(wedge);
  });

  it('refuses an unknown part, a non-armour part and an unknown shape', () => {
    expect(applyEditorOp(base(), { op: 'reshape', id: 42, shape: 'wedge' })).toEqual({ ok: false, error: 'unknownPart' });
    expect(applyEditorOp(base(), { op: 'reshape', id: 1, shape: 'wedge' })).toEqual({ ok: false, error: 'shapeNotAllowed' });
    expect(applyEditorOp(base(), { op: 'reshape', id: 1, shape: null })).toEqual({ ok: false, error: 'shapeNotAllowed' });
    expect(applyEditorOp(base(), { op: 'reshape', id: 2, shape: 'blob' as ShapeId })).toEqual({ ok: false, error: 'invalidOp' });
  });

  it('a wing reshape is blocked by a neighbour on its second cell, and by the hangar edge', () => {
    // armour 2 at (1, 0) rot 0: a wing would also cover (2, 0)
    const g = createGrid([['cockpit', 0, 0], ['armor', 1, 0], ['cargo', 2, 0]]);
    expect(applyEditorOp(g, { op: 'reshape', id: 2, shape: 'wingL' })).toEqual({ ok: false, error: 'occupied' });
    expect(applyEditorOp(g, { op: 'reshape', id: 2, shape: 'nose2x1' })).toEqual({ ok: false, error: 'occupied' });
    expect(applyEditorOp(g, { op: 'reshape', id: 2, shape: 'wedge' }).ok).toBe(true);
    const edge = createGrid([['armor', HANGAR_MAX, 0]]);
    expect(applyEditorOp(edge, { op: 'reshape', id: 1, shape: 'wingR' })).toEqual({ ok: false, error: 'outOfBounds' });
  });

  it('the own cells of a wing never block it (wing L → wing R → full)', () => {
    const g = createGrid([['cockpit', 0, 0], ['armor', 1, 0, 0, 1, 'wingL'], ['cargo', 3, 0]]);
    const r = okGrid(applyEditorOp(g, { op: 'reshape', id: 2, shape: 'wingR' }));
    expect(byId(r, 2).shape).toBe('wingR');
    const full = okGrid(applyEditorOp(r, { op: 'reshape', id: 2, shape: null }));
    // the full plate frees (2, 0)
    expect(partAt(full, 2, 0)).toBeNull();
    expect(applyEditorOp(full, { op: 'place', key: 'armor:1', x: 2, y: 0, rot: 0 }).ok).toBe(true);
  });

  it('never mutates the input grid', () => {
    const g = base();
    const before = structuredClone(g);
    applyEditorOp(g, { op: 'reshape', id: 2, shape: 'wingL' });
    applyEditorOp(g, { op: 'reshape', id: 3, shape: 'wedge' });
    expect(g).toEqual(before);
  });
});

describe('applyEditorOp – move and moveGroup of shaped parts', () => {
  const g = () => createGrid([['cockpit', 0, 0], ['armor', 1, 0, 0, 1, 'wedge'], ['armor', 0, 2, 1, 1, 'wingL'], ['cargo', 3, 0]]);

  it('move keeps the shape and checks its footprint', () => {
    const moved = okGrid(applyEditorOp(g(), { op: 'move', id: 3, x: 0, y: -2, rot: 1 }));
    expect(byId(moved, 3)).toEqual({ id: 3, partId: 'armor', tier: 1, x: 0, y: -2, rot: 1, shape: 'wingL' });
    const turned = okGrid(applyEditorOp(g(), { op: 'move', id: 2, x: 1, y: 0, rot: 3 }));
    expect(byId(turned, 2)).toMatchObject({ rot: 3, shape: 'wedge' });
    // the wing laid along x at (2, 0) would cover the cargo at (3, 0)
    expect(applyEditorOp(g(), { op: 'move', id: 3, x: 2, y: 0, rot: 0 })).toEqual({ ok: false, error: 'occupied' });
    expect(applyEditorOp(g(), { op: 'move', id: 3, x: 2, y: 1, rot: 0 }).ok).toBe(true);
  });

  it('moveGroup sets, clears and keeps shapes', () => {
    const next = okGrid(
      applyEditorOp(g(), {
        op: 'moveGroup',
        moves: [
          { id: 2, x: 1, y: 0, rot: 3, shape: 'chamfer' },
          { id: 3, x: 0, y: 2, rot: 3, shape: 'wingR' },
          { id: 4, x: 3, y: 0, rot: 0 },
        ],
      }),
    );
    expect(byId(next, 2)).toEqual({ id: 2, partId: 'armor', tier: 1, x: 1, y: 0, rot: 3, shape: 'chamfer' });
    expect(byId(next, 3)).toMatchObject({ rot: 3, shape: 'wingR' });
    expect('shape' in byId(next, 4)).toBe(false);
    const cleared = okGrid(
      applyEditorOp(next, { op: 'moveGroup', moves: [{ id: 2, x: 1, y: 0, rot: 3, shape: null }, { id: 3, x: 0, y: 2, rot: 3 }] }),
    );
    expect('shape' in byId(cleared, 2)).toBe(false);
    expect(byId(cleared, 3).shape).toBe('wingR');
  });

  it('checkGroupMove uses the new shape footprint', () => {
    // a wedge at (2, 0) becoming a wing along x would cover the cargo at (3, 0)
    const grid = createGrid([['cockpit', 0, 0], ['armor', 2, 0, 0, 1, 'wedge'], ['cargo', 3, 0]]);
    const check = checkGroupMove(grid, [{ id: 2, x: 2, y: 0, rot: 0, shape: 'wingL' }]);
    expect(check.error).toBe('occupied');
    expect(check.cells.map((c) => `${c.x},${c.y}:${c.error}`)).toEqual(['2,0:null', '3,0:occupied']);
    // a wing turned back into a plate leaves its second cell free for another moved part
    const wing = createGrid([['armor', 0, 0, 0, 1, 'wingL'], ['armor', 0, 1]]);
    expect(checkGroupMove(wing, [{ id: 1, x: 0, y: 0, rot: 0, shape: null }, { id: 2, x: 1, y: 0, rot: 0 }]).error).toBeNull();
    expect(checkGroupMove(wing, [{ id: 1, x: 0, y: 0, rot: 0 }, { id: 2, x: 1, y: 0, rot: 0 }]).error).toBe('occupied');
  });

  it('refuses a shape on a non-armour part and an unknown shape', () => {
    expect(applyEditorOp(g(), { op: 'moveGroup', moves: [{ id: 4, x: 3, y: 0, rot: 0, shape: 'wedge' }] })).toEqual({ ok: false, error: 'shapeNotAllowed' });
    expect(applyEditorOp(g(), { op: 'moveGroup', moves: [{ id: 2, x: 1, y: 0, rot: 0, shape: 'blob' as ShapeId }] })).toEqual({ ok: false, error: 'invalidOp' });
    // null (= full) on an unshaped part is a plain move
    expect(applyEditorOp(g(), { op: 'moveGroup', moves: [{ id: 4, x: 3, y: 1, rot: 1, shape: null }] }).ok).toBe(true);
  });
});

describe('footprint helpers with shapes', () => {
  it('placementAnchor and rotatedPlacement take the shape size', () => {
    const wing = partSize({ partId: 'armor', tier: 1, shape: 'wingL' });
    expect(placementAnchor(wing, { x: 4, y: 4 }, 0)).toEqual({ x: 4, y: 4 });
    // turning a wing held by its front cell keeps that cell covered
    expect(rotatedPlacement(wing, { x: 0, y: 0, rot: 0 }, { x: 1, y: 0 }, 1)).toEqual({ x: 1, y: -1, rot: 1 });
  });

  it('rotatedGroup turns a wing by its 2×1 footprint', () => {
    const grid = createGrid([['armor', 0, 0, 0, 1, 'wingL'], ['armor', 0, 1, 0, 1, 'wedge']]);
    const moves = rotatedGroup(grid.parts, { x: 0, y: 0 }, 1);
    // (0,0)–(1,0) turned ccw around (0,0) → (0,0)–(0,1); the wedge (0,1) → (−1,0)
    expect(moves).toEqual([
      { id: 1, x: 0, y: 0, rot: 1 },
      { id: 2, x: -1, y: 0, rot: 1 },
    ]);
    const after = okGrid(applyEditorOp(grid, { op: 'moveGroup', moves }));
    expect(cellSet(partCells(byId(after, 1)))).toEqual(['0,0', '0,1']);
  });

  it('connectedPiece follows the second cell of a wing', () => {
    const g = createGrid([['cockpit', 0, 0], ['armor', 1, 0, 0, 1, 'wingL'], ['armor', 3, 0]]);
    expect(connectedPiece(g, 1)).toEqual([1, 2, 3]);
  });
});
