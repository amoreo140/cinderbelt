// Ship editor – a pure reducer of operations (spec M2, 4.6.4 and 7.3). The editor uses it for the preview
// and the simulation on confirm (it replays the same operations), so the result cannot differ.
// Placement is free (Shipyard 2.0): a part may sit anywhere in the hangar, touching nothing – the design
// check (`disconnected`, sim/shipyard/design.ts) blocks confirming a ship whose parts are not connected.
import { ALL_PART_KEYS, parsePartKey, partKey, type PartId, type PartKey, type Tier } from '../../data/parts';
import { partCells, rotatedSize } from '../ship/grid';
import { isShapeId, SHAPEABLE_PARTS, type ShapeId } from '../../data/shapes';
import { mirrorShape, partSize } from '../ship/shape';
import type { PlacedPart, Rotation, ShipGrid } from '../ship/types';

/**
 * Hangar: cells −7…7 on both axes around the grid origin (15 × 15). The part count has no fixed limit –
 * the hull budget replaced it (design error `hullBudget`, sim/ship/budget.ts).
 */
export const HANGAR_MIN = -7;
export const HANGAR_MAX = 7;

/** New placement of one part of a group move. */
export interface PartMove {
  id: number;
  x: number;
  y: number;
  rot: Rotation;
  /** SL2 E2: the part's new shape (Shift+M of shaped parts mirrors it); null clears it, missing keeps it. */
  shape?: ShapeId | null;
}

export type EditorOp =
  /** A new part – it gets id = nextId; `shape` only for `SHAPEABLE_PARTS` (SL2 E2). */
  | { op: 'place'; key: PartKey; x: number; y: number; rot: Rotation; shape?: ShapeId }
  | { op: 'remove'; id: number }
  /** Move and rotation in place; the id (and the shape) stays. */
  | { op: 'move'; id: number; x: number; y: number; rot: Rotation }
  /** Several parts moved at once (group move / rotation): checked against the result, not step by step. */
  | { op: 'moveGroup'; moves: PartMove[] }
  /**
   * SL2 E2: lay a placed part in another shape (null = full) in place – same anchor and rotation, the id
   * (and so its HP entry) stays; the new footprint must fit with the part's own cells ignored. The reducer
   * knows no HP: a reshape of a damaged part is the design error `reshapeDamaged` (sim/shipyard/design.ts);
   * the editor sends `remove` + `place` for a damaged plate instead (plan SL2 E2 §2.3).
   */
  | { op: 'reshape'; id: number; shape: ShapeId | null };

/** Why an operation cannot be done (texts in sk.shipyard.placement). */
export type PlacementError = 'occupied' | 'outOfBounds' | 'cockpitLimit' | 'unknownPart' | 'invalidOp' | 'shapeNotAllowed';

export type EditorResult = { ok: true; grid: ShipGrid } | { ok: false; error: PlacementError };

const KNOWN_KEYS = new Set<string>(ALL_PART_KEYS);
const cellKey = (x: number, y: number): string => `${x},${y}`;
const validRot = (rot: number): rot is Rotation => rot === 0 || rot === 1 || rot === 2 || rot === 3;

/**
 * Problem of laying part `partId` in `shape` (undefined / null = the full part): an unknown shape is a
 * malformed op (`invalidOp`), a shape on a part outside `SHAPEABLE_PARTS` is `shapeNotAllowed`.
 */
function shapeError(partId: PartId, shape: ShapeId | null | undefined): PlacementError | null {
  if (shape == null) return null;
  if (!isShapeId(shape)) return 'invalidOp';
  return SHAPEABLE_PARTS.has(partId) ? null : 'shapeNotAllowed';
}

/** A copy of `part` laid in `shape`; null / undefined = the full part (no `shape` key, the fast path). */
function withShape(part: PlacedPart, shape: ShapeId | null | undefined): PlacedPart {
  const { shape: _old, ...rest } = part;
  return shape == null ? rest : { ...rest, shape };
}

/** Is the cell inside the hangar? */
export const inHangar = (x: number, y: number): boolean =>
  x >= HANGAR_MIN && x <= HANGAR_MAX && y >= HANGAR_MIN && y <= HANGAR_MAX;

/** The part on a cell (or null). */
export function partAt(grid: ShipGrid, x: number, y: number): PlacedPart | null {
  for (const p of grid.parts) for (const c of partCells(p)) if (c.x === x && c.y === y) return p;
  return null;
}

/**
 * Can the part be placed at (x, y) with rotation `rot`, laid in `shape` (undefined / null = full)?
 * `ignoreId` = the dragged or reshaped part (its old cells do not block and it does not count as another
 * cockpit). Null = yes. The part need not touch the ship.
 */
export function checkPlacement(
  grid: ShipGrid,
  partId: PartId,
  tier: Tier,
  x: number,
  y: number,
  rot: Rotation,
  ignoreId?: number,
  shape?: ShapeId | null,
): PlacementError | null {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !validRot(rot)) return 'invalidOp';
  const shapeProblem = shapeError(partId, shape);
  if (shapeProblem) return shapeProblem;
  const cells = partCells(withShape({ id: -1, partId, tier, x, y, rot }, shape));
  if (!cells.every((c) => inHangar(c.x, c.y))) return 'outOfBounds';

  const others = grid.parts.filter((p) => p.id !== ignoreId);
  const occupied = new Set<string>();
  for (const p of others) for (const c of partCells(p)) occupied.add(cellKey(c.x, c.y));
  if (cells.some((c) => occupied.has(cellKey(c.x, c.y)))) return 'occupied';

  if (partId === 'cockpit' && others.some((p) => p.partId === 'cockpit')) return 'cockpitLimit';
  return null;
}

/** One cell of a group ghost: `error` null = the cell is free. */
export interface GroupCell {
  x: number;
  y: number;
  id: number;
  error: PlacementError | null;
}

export interface GroupCheck {
  /** First problem of the whole move (null = it can be done). */
  error: PlacementError | null;
  /** Every cell the moved parts would cover, with its own validity (the ghost colours them). */
  cells: GroupCell[];
}

/**
 * Checks a group move against the grid: every moved part must exist (once), stay in the hangar and cover
 * neither a part outside the group nor another moved part. Cells the group leaves do not block. A move's
 * `shape` (SL2 E2) changes the footprint: null = the full part, missing = the part's current shape.
 */
export function checkGroupMove(grid: ShipGrid, moves: readonly PartMove[]): GroupCheck {
  if (moves.length === 0) return { error: 'invalidOp', cells: [] };
  const byId = new Map(grid.parts.map((p) => [p.id, p]));
  const ids = new Set<number>();
  for (const m of moves) {
    if (!m || !Number.isInteger(m.x) || !Number.isInteger(m.y) || !validRot(m.rot) || ids.has(m.id)) return { error: 'invalidOp', cells: [] };
    if (!byId.has(m.id)) return { error: 'unknownPart', cells: [] };
    const shapeProblem = shapeError(byId.get(m.id)!.partId, m.shape);
    if (shapeProblem) return { error: shapeProblem, cells: [] };
    ids.add(m.id);
  }
  const occupied = new Set<string>();
  for (const p of grid.parts) if (!ids.has(p.id)) for (const c of partCells(p)) occupied.add(cellKey(c.x, c.y));
  const taken = new Map<string, number>();
  const cells: GroupCell[] = [];
  let error: PlacementError | null = null;
  for (const m of moves) {
    for (const c of partCells(movedPart(byId.get(m.id)!, m))) {
      const k = cellKey(c.x, c.y);
      const owner = taken.get(k);
      const cellError: PlacementError | null = !inHangar(c.x, c.y)
        ? 'outOfBounds'
        : occupied.has(k) || (owner !== undefined && owner !== m.id)
          ? 'occupied'
          : null;
      taken.set(k, m.id);
      cells.push({ x: c.x, y: c.y, id: m.id, error: cellError });
      error ??= cellError;
    }
  }
  return { error, cells };
}

/** A part at its group-move placement: `shape` null clears it, missing keeps it. */
const movedPart = (p: PlacedPart, m: PartMove): PlacedPart =>
  m.shape === undefined ? { ...p, x: m.x, y: m.y, rot: m.rot } : withShape({ ...p, x: m.x, y: m.y, rot: m.rot }, m.shape);

/** Does one operation; never changes the input grid. */
export function applyEditorOp(grid: ShipGrid, op: EditorOp): EditorResult {
  switch (op.op) {
    case 'place': {
      if (!KNOWN_KEYS.has(op.key)) return { ok: false, error: 'invalidOp' };
      const { partId, tier, variant } = parsePartKey(op.key);
      const error = checkPlacement(grid, partId, tier, op.x, op.y, op.rot, undefined, op.shape);
      if (error) return { ok: false, error };
      const part = withShape({ id: grid.nextId, partId, tier, x: op.x, y: op.y, rot: op.rot, ...(variant ? { variant } : {}) }, op.shape);
      return { ok: true, grid: { parts: [...grid.parts, part], nextId: grid.nextId + 1 } };
    }
    case 'remove': {
      if (!grid.parts.some((p) => p.id === op.id)) return { ok: false, error: 'unknownPart' };
      return { ok: true, grid: { parts: grid.parts.filter((p) => p.id !== op.id), nextId: grid.nextId } };
    }
    case 'move': {
      const part = grid.parts.find((p) => p.id === op.id);
      if (!part) return { ok: false, error: 'unknownPart' };
      const error = checkPlacement(grid, part.partId, part.tier, op.x, op.y, op.rot, part.id, part.shape);
      if (error) return { ok: false, error };
      const moved: PlacedPart = { ...part, x: op.x, y: op.y, rot: op.rot };
      return { ok: true, grid: { parts: grid.parts.map((p) => (p.id === op.id ? moved : p)), nextId: grid.nextId } };
    }
    case 'moveGroup': {
      if (!Array.isArray(op.moves)) return { ok: false, error: 'invalidOp' };
      const { error } = checkGroupMove(grid, op.moves);
      if (error) return { ok: false, error };
      const to = new Map(op.moves.map((m) => [m.id, m]));
      const parts = grid.parts.map((p) => {
        const m = to.get(p.id);
        return m ? movedPart(p, m) : p;
      });
      return { ok: true, grid: { parts, nextId: grid.nextId } };
    }
    case 'reshape': {
      const part = grid.parts.find((p) => p.id === op.id);
      if (!part) return { ok: false, error: 'unknownPart' };
      // laying a part back as the full part is a shape change too – only shapeable parts have shapes
      if (!SHAPEABLE_PARTS.has(part.partId)) return { ok: false, error: 'shapeNotAllowed' };
      const error = checkPlacement(grid, part.partId, part.tier, part.x, part.y, part.rot, part.id, op.shape);
      if (error) return { ok: false, error };
      const reshaped = withShape(part, op.shape);
      return { ok: true, grid: { parts: grid.parts.map((p) => (p.id === op.id ? reshaped : p)), nextId: grid.nextId } };
    }
    default:
      return { ok: false, error: 'invalidOp' };
  }
}

/** Replays operations in order; the first failing one ends the replay. */
export function replayOps(
  grid: ShipGrid,
  ops: readonly EditorOp[],
): { ok: true; grid: ShipGrid } | { ok: false; error: PlacementError; index: number } {
  let current = grid;
  for (let i = 0; i < ops.length; i++) {
    const r = applyEditorOp(current, ops[i]!);
    if (!r.ok) return { ok: false, error: r.error, index: i };
    current = r.grid;
  }
  return { ok: true, grid: current };
}

type Size = { w: number; h: number };

/**
 * Bottom-left cell of a part under the cursor: the cursor cell is inside the rotated rectangle, centred
 * for 3 cells (1×1, 2×1 and 2×2 start at the cursor).
 */
export function placementAnchor(size: Size, cell: { x: number; y: number }, rot: Rotation): { x: number; y: number } {
  const { w, h } = rotatedSize(size, rot);
  return { x: cell.x - Math.floor((w - 1) / 2), y: cell.y - Math.floor((h - 1) / 2) };
}

/**
 * A quarter turn of a part (dir 1 = counter-clockwise) around the cell `pivot` the player holds it by –
 * that cell stays covered (a 1×1 part does not move). Returns the new position and rotation.
 */
export function rotatedPlacement(
  size: Size,
  part: { x: number; y: number; rot: Rotation },
  pivot: { x: number; y: number },
  dir: 1 | -1,
): { x: number; y: number; rot: Rotation } {
  const { w, h } = rotatedSize(size, part.rot);
  const ox = Math.min(w - 1, Math.max(0, pivot.x - part.x));
  const oy = Math.min(h - 1, Math.max(0, pivot.y - part.y));
  // cell (ox, oy) of a w×h rectangle after the turn: counter-clockwise (h−1−oy, ox), clockwise (oy, w−1−ox)
  const [nx, ny] = dir === 1 ? [h - 1 - oy, ox] : [oy, w - 1 - ox];
  const rot = ((((part.rot + dir) % 4) + 4) % 4) as Rotation;
  return { x: part.x + ox - nx, y: part.y + oy - ny, rot };
}

/**
 * A quarter turn of a whole group (dir 1 = counter-clockwise) around the cell `pivot`: every part keeps
 * its place relative to the others and the pivot cell stays where it is.
 */
export function rotatedGroup(
  parts: readonly Pick<PlacedPart, 'id' | 'partId' | 'tier' | 'variant' | 'shape' | 'x' | 'y' | 'rot'>[],
  pivot: { x: number; y: number },
  dir: 1 | -1,
): PartMove[] {
  const turn = (x: number, y: number) =>
    dir === 1 ? { x: pivot.x - (y - pivot.y), y: pivot.y + (x - pivot.x) } : { x: pivot.x + (y - pivot.y), y: pivot.y - (x - pivot.x) };
  return parts.map((p) => {
    const { w, h } = rotatedSize(partSize(p), p.rot);
    // two opposite corner cells of the footprint, turned around the pivot
    const a = turn(p.x, p.y);
    const b = turn(p.x + w - 1, p.y + h - 1);
    const rot = ((((p.rot + dir) % 4) + 4) % 4) as Rotation;
    return { id: p.id, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), rot };
  });
}

/** The whole piece a part belongs to: every part reachable through shared edges (cockpit or not). */
export function connectedPiece(grid: ShipGrid, id: number): number[] {
  const owners = new Map<string, number>();
  for (const p of grid.parts) for (const c of partCells(p)) owners.set(cellKey(c.x, c.y), p.id);
  const byId = new Map(grid.parts.map((p) => [p.id, p]));
  const start = byId.get(id);
  if (!start) return [];
  const seen = new Set<number>([id]);
  const queue: PlacedPart[] = [start];
  while (queue.length > 0) {
    const p = queue.pop()!;
    for (const c of partCells(p)) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const o = owners.get(cellKey(c.x + dx, c.y + dy));
        if (o !== undefined && !seen.has(o)) {
          seen.add(o);
          queue.push(byId.get(o)!);
        }
      }
    }
  }
  return grid.parts.filter((p) => seen.has(p.id)).map((p) => p.id);
}

/** Cells a part covers, laid in `shape` (missing / null = full) – for the editor ghost (regardless of validity). */
export function ghostCells(key: PartKey, x: number, y: number, rot: Rotation, shape?: ShapeId | null): { x: number; y: number }[] {
  const { partId, tier, variant } = parsePartKey(key);
  return partCells(withShape({ id: -1, partId, tier, x, y, rot, ...(variant ? { variant } : {}) }, shape));
}

// ---------------------------------------------------------------------------
// mirror mode (SL2 E1)
//
// The axis runs along the ship (parallel to x, the bow direction) and mirrors the y coordinate. It is
// kept as twice its y coordinate so a seam axis stays an integer: a cell's row y maps to `axis2 − y`.

/**
 * The ship's mirror axis (twice its y): through the centre of the cockpit row (`2·cy`) or, with `half`,
 * on the seam above it (`2·cy + 1`) for ships of even width. Without a cockpit the grid origin's row
 * stands in for it.
 */
export function mirrorAxis(grid: ShipGrid, half: boolean): number {
  const cockpit = grid.parts.find((p) => p.partId === 'cockpit');
  return (cockpit ? centreRow2(cockpit) : 0) + (half ? 1 : 0);
}

type Footprint = Pick<PlacedPart, 'partId' | 'tier' | 'variant' | 'shape' | 'y' | 'rot'>;
/** Twice the y of a part's centre (an integer for any footprint). */
const centreRow2 = (p: Footprint): number => 2 * p.y + rotatedSize(partSize(p), p.rot).h - 1;

/** A rotation mirrored across a long axis: the facing (fx, fy) becomes (fx, −fy), so k → −k mod 4. */
export const mirrorRot = (rot: Rotation): Rotation => ((4 - rot) % 4) as Rotation;

/** Placement of a mirror copy; `shape` only when the original has one. */
export interface MirroredPlacement {
  x: number;
  y: number;
  rot: Rotation;
  shape?: ShapeId;
}

/**
 * Placement of the mirror copy of part `key` at (x, y, rot), laid in `shape` (missing / null = full): the
 * rotation mirrored (a shape through `mirrorShape` – wedge rot 0 ↔ 3, wing L rot k ↔ wing R rot −k), the
 * bottom-left anchor recomputed from the mirrored cells (a multi-cell part covers rows
 * `axis2 − y − h + 1 … axis2 − y`; a mirror image keeps the footprint's height).
 */
export function mirrorPlacement(key: PartKey, x: number, y: number, rot: Rotation, axis2: number, shape?: ShapeId | null): MirroredPlacement {
  const { partId, tier, variant } = parsePartKey(key);
  const { h } = rotatedSize(partSize({ partId, tier, variant, ...(shape != null ? { shape } : {}) }), rot);
  const my = axis2 - y - h + 1;
  if (shape == null) return { x, y: my, rot: mirrorRot(rot) };
  const m = mirrorShape(shape, rot);
  return { x, y: my, rot: m.rot, shape: m.shape };
}

/** The cell a cell mirrors to. */
export const mirrorCell = (cell: { x: number; y: number }, axis2: number): { x: number; y: number } => ({ x: cell.x, y: axis2 - cell.y });

/**
 * Does the mirror copy cover exactly the original's cells (a part lying on the axis)? Such a part is
 * placed (removed, reshaped) once – also a shaped one whose mirror image differs (a wedge on the axis
 * stays as laid; both cannot share the cells).
 */
export function onMirrorAxis(key: PartKey, x: number, y: number, rot: Rotation, axis2: number, shape?: ShapeId | null): boolean {
  const m = mirrorPlacement(key, x, y, rot, axis2, shape);
  return m.x === x && m.y === y;
}

/**
 * Shift+M: the group moves that mirror `parts` across their own long axis – the middle of their
 * bounding rows, so the selection keeps its place. A shaped part's move carries its mirrored shape. A cockpit in the group never moves: the axis then
 * runs through the cockpit row and the cockpit is left out of the moves.
 */
export function mirrorGroupMoves(
  parts: readonly Pick<PlacedPart, 'id' | 'partId' | 'tier' | 'variant' | 'shape' | 'x' | 'y' | 'rot'>[],
): PartMove[] {
  if (parts.length === 0) return [];
  const cockpit = parts.find((p) => p.partId === 'cockpit');
  let axis2: number;
  if (cockpit) axis2 = centreRow2(cockpit);
  else {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of parts) {
      const { h } = rotatedSize(partSize(p), p.rot);
      lo = Math.min(lo, p.y);
      hi = Math.max(hi, p.y + h - 1);
    }
    axis2 = lo + hi;
  }
  return parts
    .filter((p) => p !== cockpit)
    .map((p) => ({ id: p.id, ...mirrorPlacement(partKey(p.partId, p.tier, p.variant), p.x, p.y, p.rot, axis2, p.shape) }));
}
