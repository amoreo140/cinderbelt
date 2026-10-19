// Mirror mode helpers (SL2 E1, spec §2.11): the mirror table of every part and rotation, the axis on a
// cell or on a seam, and the group mirror of Shift+M.
import { describe, expect, it } from 'vitest';
import { ALL_PART_KEYS, parsePartKey, partKey } from '../../data/parts';
import { createGrid, facing, partCells } from '../ship/grid';
import { createStarterShip } from '../ship/presets';
import { mirrorShape, partPolygon } from '../ship/shape';
import type { PlacedPart, Rotation } from '../ship/types';
import { SHAPE_IDS, type ShapeId } from '../../data/shapes';
import { applyEditorOp, mirrorAxis, mirrorCell, mirrorGroupMoves, mirrorPlacement, mirrorRot, onMirrorAxis } from './editor';

const ROTS: Rotation[] = [0, 1, 2, 3];
const cellSet = (cells: { x: number; y: number }[]) => cells.map((c) => `${c.x},${c.y}`).sort();
const placed = (key: string, x: number, y: number, rot: Rotation): PlacedPart => ({ id: -1, ...parsePartKey(key as never), x, y, rot });

describe('mirrorRot', () => {
  it('maps k to −k mod 4 (engine rot 1 ↔ 3, 0 and 2 stay)', () => {
    expect(ROTS.map(mirrorRot)).toEqual([0, 3, 2, 1]);
  });
});

describe('mirrorAxis', () => {
  it('runs through the cockpit row, or on the seam above it', () => {
    const grid = createGrid([['cockpit', 1, 2], ['armor', 0, 2]]);
    expect(mirrorAxis(grid, false)).toBe(4);
    expect(mirrorAxis(grid, true)).toBe(5);
  });

  it('falls back to the grid origin without a cockpit', () => {
    expect(mirrorAxis(createGrid([['armor', 3, 3]]), false)).toBe(0);
    expect(mirrorAxis({ parts: [], nextId: 1 }, true)).toBe(1);
  });
});

describe('mirrorPlacement – the mirror table', () => {
  for (const key of ALL_PART_KEYS) {
    it(`${key}: every rotation, axis on a cell and on a seam`, () => {
      for (const rot of ROTS) {
        for (const axis2 of [0, 1, 5]) {
          const p = placed(key, 2, -3, rot);
          const m = mirrorPlacement(key, p.x, p.y, rot, axis2);
          const q = placed(key, m.x, m.y, m.rot);
          // the copy covers exactly the mirrored cells and faces the mirrored direction
          expect(cellSet(partCells(q))).toEqual(cellSet(partCells(p).map((c) => mirrorCell(c, axis2))));
          const f = facing(rot);
          expect(facing(m.rot)).toEqual({ x: f.x, y: f.y === 0 ? 0 : -f.y });
          // mirroring twice is the identity
          expect(mirrorPlacement(key, m.x, m.y, m.rot, axis2)).toEqual({ x: p.x, y: p.y, rot });
        }
      }
    });
  }

  it('recomputes the anchor of a vertical 2×1 and of a 2×2 part', () => {
    // heavy laser rot 1 covers (0, 2) and (0, 3): across the row y = 0 it covers (0, −3) and (0, −2)
    expect(mirrorPlacement('heavyLaser:1', 0, 2, 1, 0)).toEqual({ x: 0, y: -3, rot: 3 });
    // lying along the axis (rot 0) it stays in its row
    expect(mirrorPlacement('heavyLaser:1', 0, 2, 0, 0)).toEqual({ x: 0, y: -2, rot: 0 });
    // large cargo 2×2 at rows 1–2: across the seam y = ½ (axis2 = 1) it covers rows −1…0
    expect(mirrorPlacement('largeCargo:1', 3, 1, 0, 1)).toEqual({ x: 3, y: -1, rot: 0 });
  });

  it('a part on the axis is its own mirror copy', () => {
    expect(onMirrorAxis('armor:1', 4, 0, 0, 0)).toBe(true);
    expect(onMirrorAxis('engine:1', 4, 0, 1, 0)).toBe(true);
    expect(onMirrorAxis('armor:1', 4, 1, 0, 0)).toBe(false);
    // a 2×2 part straddles a seam axis, not a cell axis
    expect(onMirrorAxis('largeCargo:1', 4, 0, 0, 1)).toBe(true);
    expect(onMirrorAxis('largeCargo:1', 4, 0, 0, 0)).toBe(false);
    // a vertical 3-cell footprint would straddle a cell axis – none exists, but a vertical 2×1 never does
    expect(onMirrorAxis('heavyLaser:1', 4, -1, 1, 0)).toBe(false);
  });
});

describe('mirrorGroupMoves (Shift+M)', () => {
  it('mirrors a selection across its own middle row', () => {
    const grid = createGrid([['cockpit', 0, 0], ['engine', 3, 2, 1], ['armor', 3, 3], ['heavyLaser', 4, 2, 0]]);
    const sel = grid.parts.filter((p) => p.partId !== 'cockpit');
    // rows 2…3 → the axis is the seam y = 2.5
    expect(mirrorGroupMoves(sel)).toEqual([
      { id: 2, x: 3, y: 3, rot: 3 },
      { id: 3, x: 3, y: 2, rot: 0 },
      { id: 4, x: 4, y: 3, rot: 0 },
    ]);
  });

  it('keeps the cockpit and mirrors the rest across the cockpit row', () => {
    const grid = createGrid([['cockpit', 1, 1], ['engine', 0, 2, 1], ['armor', 2, 2]]);
    const moves = mirrorGroupMoves(grid.parts);
    expect(moves.map((m) => m.id)).toEqual([2, 3]);
    expect(moves).toEqual([
      { id: 2, x: 0, y: 0, rot: 3 },
      { id: 3, x: 2, y: 0, rot: 0 },
    ]);
  });

  it('mirrors a symmetric ship onto itself, and an asymmetric one back with a second mirror', () => {
    const starter = createStarterShip();
    const once = applyEditorOp(starter, { op: 'moveGroup', moves: mirrorGroupMoves(starter.parts) });
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    // the starter is symmetric except the fuel tank (1, 1) and the radar (1, −1): they swap sides
    const at = (g: typeof starter, id: number) => g.parts.find((p) => p.id === id)!;
    const tank = starter.parts.find((p) => p.partId === 'fuelTank')!;
    expect(at(once.grid, tank.id)).toMatchObject({ x: 1, y: -1 });
    const twice = applyEditorOp(once.grid, { op: 'moveGroup', moves: mirrorGroupMoves(once.grid.parts) });
    expect(twice.ok && twice.grid.parts).toEqual(starter.parts);
  });

  it('is empty for an empty selection', () => {
    expect(mirrorGroupMoves([])).toEqual([]);
  });

  it('mirrors a part variant like its base part', () => {
    const p = { id: 1, partId: 'engine' as const, tier: 1 as const, variant: 'overdrive' as const, x: 0, y: 1, rot: 1 as Rotation };
    expect(mirrorGroupMoves([p])).toEqual([{ id: 1, x: 0, y: 1, rot: 3 }]);
    expect(mirrorPlacement(partKey('engine', 1, 'overdrive'), 0, 1, 1, 0)).toEqual({ x: 0, y: -1, rot: 3 });
  });
});

// ---------------------------------------------------------------------------------------------------
// SL2 E2 S6a: mirroring shaped armour (spec §2.11 – wedge 0↔3, wing L rot k ↔ wing R rot −k, …)

const shapedPart = (shape: ShapeId, x: number, y: number, rot: Rotation): PlacedPart => ({ id: -1, partId: 'armor', tier: 1, x, y, rot, shape });
const pointSet = (poly: readonly { x: number; y: number }[]) => poly.map((v) => `${v.x.toFixed(6)},${v.y.toFixed(6)}`).sort();

describe('mirrorPlacement – shapes', () => {
  for (const shape of SHAPE_IDS) {
    it(`${shape}: every rotation, axis on a cell and on a seam`, () => {
      for (const rot of ROTS) {
        for (const axis2 of [0, 1, 5]) {
          const p = shapedPart(shape, 2, -3, rot);
          const m = mirrorPlacement('armor:1', p.x, p.y, rot, axis2, shape);
          expect(m.shape).toBe(mirrorShape(shape, rot).shape);
          expect(m.rot).toBe(mirrorShape(shape, rot).rot);
          const q = shapedPart(m.shape!, m.x, m.y, m.rot);
          // the copy covers exactly the mirrored cells and its outline is the mirrored outline
          expect(cellSet(partCells(q))).toEqual(cellSet(partCells(p).map((c) => mirrorCell(c, axis2))));
          expect(pointSet(partPolygon(q)!)).toEqual(pointSet(partPolygon(p)!.map((v) => ({ x: v.x, y: axis2 - v.y }))));
          // mirroring twice is the identity
          expect(mirrorPlacement('armor:1', m.x, m.y, m.rot, axis2, m.shape)).toEqual({ x: p.x, y: p.y, rot, shape });
        }
      }
    });
  }

  it('wing L rot k ↔ wing R rot −k with the anchors recomputed', () => {
    // a wing along x stays in its mirrored row
    expect(mirrorPlacement('armor:1', 1, 2, 0, 0, 'wingL')).toEqual({ x: 1, y: -2, rot: 0, shape: 'wingR' });
    expect(mirrorPlacement('armor:1', 1, -2, 2, 0, 'wingR')).toEqual({ x: 1, y: 2, rot: 2, shape: 'wingL' });
    // a vertical wing at rows 2–3 covers rows −3…−2 across the row y = 0
    expect(mirrorPlacement('armor:1', 1, 2, 1, 0, 'wingL')).toEqual({ x: 1, y: -3, rot: 3, shape: 'wingR' });
    // … and stays on its rows across the seam between them
    expect(mirrorPlacement('armor:1', 1, 2, 3, 5, 'wingR')).toEqual({ x: 1, y: 2, rot: 1, shape: 'wingL' });
    // a wedge on the axis turns rot 0 → 3
    expect(mirrorPlacement('armor:1', 4, 0, 0, 0, 'wedge')).toEqual({ x: 4, y: 0, rot: 3, shape: 'wedge' });
  });

  it('a part without a shape gets no shape key', () => {
    expect(mirrorPlacement('armor:1', 4, 1, 0, 0)).toEqual({ x: 4, y: -1, rot: 0 });
    expect(mirrorPlacement('armor:1', 4, 1, 0, 0, null)).toEqual({ x: 4, y: -1, rot: 0 });
  });

  it('onMirrorAxis uses the shape footprint (a vertical wing straddles a seam)', () => {
    expect(onMirrorAxis('armor:1', 1, 2, 1, 5, 'wingL')).toBe(true);
    expect(onMirrorAxis('armor:1', 1, 2, 1, 5)).toBe(false);
    expect(onMirrorAxis('armor:1', 1, 2, 0, 4, 'wingL')).toBe(true);
    // a wedge on the axis is placed once even though its mirror image differs
    expect(onMirrorAxis('armor:1', 4, 0, 0, 0, 'wedge')).toBe(true);
  });
});

describe('mirrorGroupMoves (Shift+M) – shapes', () => {
  it('mirrors a selection with wedges and a wing, and back with a second mirror', () => {
    const grid = createGrid([
      ['cockpit', 0, 0],
      ['armor', 1, 1, 0, 1, 'wedge'],
      ['armor', 1, 2, 1, 1, 'wedge'],
      ['armor', 2, 1, 0, 1, 'wingL'],
      ['engine', -1, 1, 2],
    ]);
    const sel = grid.parts.filter((p) => p.partId !== 'cockpit');
    // rows 1…2 → the axis is the seam y = 1.5
    expect(mirrorGroupMoves(sel)).toEqual([
      { id: 2, x: 1, y: 2, rot: 3, shape: 'wedge' },
      { id: 3, x: 1, y: 1, rot: 2, shape: 'wedge' },
      { id: 4, x: 2, y: 2, rot: 0, shape: 'wingR' },
      { id: 5, x: -1, y: 2, rot: 2 },
    ]);
    const once = applyEditorOp(grid, { op: 'moveGroup', moves: mirrorGroupMoves(sel) });
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = applyEditorOp(once.grid, { op: 'moveGroup', moves: mirrorGroupMoves(once.grid.parts.filter((p) => p.partId !== 'cockpit')) });
    expect(twice.ok && twice.grid).toEqual(grid);
  });

  it('measures the axis from the shape footprint of a vertical wing', () => {
    const grid = createGrid([['armor', 0, 0, 1, 1, 'wingL'], ['armor', 1, 0]]);
    // rows 0…1 → seam y = 0.5: the wing stays on its rows as a wing R, the plate goes to row 1
    expect(mirrorGroupMoves(grid.parts)).toEqual([
      { id: 1, x: 0, y: 0, rot: 3, shape: 'wingR' },
      { id: 2, x: 1, y: 1, rot: 0 },
    ]);
  });
});
