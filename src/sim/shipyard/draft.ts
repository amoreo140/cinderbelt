// Ship draft in the shipyard (spec M2, 4.6.9 and 7.3): the original ship + strokes of operations with undo/redo.
// All functions are pure – they return a new draft and never change the old one.
import type { PartInventory, PartKey } from '../../data/parts';
import type { HpMap, PlacedPart, ShipGrid } from '../ship/types';
import type { StationId } from '../world/stations';
import { applyEditorOp, replayOps, type EditorOp, type PlacementError } from './editor';

/** At most this many undo steps. */
export const HISTORY_LIMIT = 100;

/**
 * One stroke = a click, a paint or erase drag, a move (also of a whole group); "reset" = Restore original;
 * „restore“ = Restore to design (M3.8): the draft becomes exactly these ops against the ship.
 */
export type EditorStroke = { kind: 'ops'; ops: EditorOp[] } | { kind: 'reset' } | { kind: 'restore'; ops: EditorOp[] };

export type AcquireMode = 'craft' | 'buy';

export interface ShipyardDraft {
  stationId: StationId;
  /** The ship and the parts storage when the editor was opened (or after a confirm). */
  base: { grid: ShipGrid; hp: HpMap; inventory: PartInventory };
  /** Operations of strokes that fell out of the history (over HISTORY_LIMIT) – their effect stays. */
  locked: EditorOp[];
  undo: EditorStroke[];
  redo: EditorStroke[];
  /** Derived: base.grid + draftOps(draft). */
  grid: ShipGrid;
  /** How to get missing parts (evaluateDesign decides the default). */
  acquire: Partial<Record<PartKey, AcquireMode>>;
}

const cloneGrid = (grid: ShipGrid): ShipGrid => ({ parts: grid.parts.map((p) => ({ ...p })), nextId: grid.nextId });

export function createDraft(stationId: StationId, grid: ShipGrid, hp: HpMap, inventory: PartInventory): ShipyardDraft {
  const base = { grid: cloneGrid(grid), hp: new Map(hp), inventory: { ...inventory } };
  return { stationId, base, locked: [], undo: [], redo: [], grid: base.grid, acquire: {} };
}

/** Operations against the original ship – exactly what `shipyardCommit` sends. */
export function draftOps(draft: Pick<ShipyardDraft, 'locked' | 'undo'>): EditorOp[] {
  let ops = [...draft.locked];
  for (const stroke of draft.undo) {
    if (stroke.kind === 'reset') ops = [];
    else if (stroke.kind === 'restore') ops = [...stroke.ops];
    else ops.push(...stroke.ops);
  }
  return ops;
}

function rebuild(draft: ShipyardDraft): ShipyardDraft {
  const r = replayOps(draft.base.grid, draftOps(draft));
  // strokes hold only operations that once succeeded, so the replay always succeeds
  if (!r.ok) throw new Error(`The draft does not replay: ${r.error}`);
  return { ...draft, grid: r.grid };
}

/** Adds a stroke to the history; the oldest stroke over the limit is baked into `locked`. */
function pushStroke(draft: ShipyardDraft, stroke: EditorStroke, grid: ShipGrid): ShipyardDraft {
  let locked = draft.locked;
  const undo = [...draft.undo, stroke];
  while (undo.length > HISTORY_LIMIT) {
    const oldest = undo.shift()!;
    locked = oldest.kind === 'reset' ? [] : oldest.kind === 'restore' ? [...oldest.ops] : [...locked, ...oldest.ops];
  }
  return { ...draft, locked, undo, redo: [], grid };
}

/**
 * A move (or a group move) that changes nothing – skipped so it does not become an undo step. A group
 * move's `shape` counts (SL2 E2): null clears the shape, missing keeps it, so a shape-only move (Shift+M
 * of a wing on the mirror axis) is a change.
 */
const isNoOpMove = (grid: ShipGrid, op: EditorOp): boolean => {
  const same = (m: { id: number; x: number; y: number; rot: number; shape?: PlacedPart['shape'] | null }) => {
    const p = grid.parts.find((q) => q.id === m.id);
    const shapeKept = m.shape === undefined || (m.shape ?? undefined) === p?.shape;
    return !!p && p.x === m.x && p.y === m.y && p.rot === m.rot && shapeKept;
  };
  if (op.op === 'moveGroup') return Array.isArray(op.moves) && op.moves.length > 0 && op.moves.every(same);
  return op.op === 'move' && same(op);
};

export interface StrokeResult {
  draft: ShipyardDraft;
  /** Operations that were done (in order). */
  applied: EditorOp[];
  /** Reasons of the failed operations (for the ghost / the message at the cursor). */
  errors: PlacementError[];
}

function applyOps(grid: ShipGrid, ops: readonly EditorOp[]): { grid: ShipGrid; applied: EditorOp[]; errors: PlacementError[] } {
  let current = grid;
  const applied: EditorOp[] = [];
  const errors: PlacementError[] = [];
  for (const op of ops) {
    if (isNoOpMove(current, op)) continue;
    const r = applyEditorOp(current, op);
    if (r.ok) {
      current = r.grid;
      applied.push(op);
    } else {
      errors.push(r.error);
    }
  }
  return { grid: current, applied, errors };
}

/** A new stroke (1 undo step). Invalid operations are skipped; without a change the draft stays the same object. */
export function applyStroke(draft: ShipyardDraft, ops: readonly EditorOp[]): StrokeResult {
  const r = applyOps(draft.grid, ops);
  if (r.applied.length === 0) return { draft, applied: [], errors: r.errors };
  return { draft: pushStroke(draft, { kind: 'ops', ops: r.applied }, r.grid), applied: r.applied, errors: r.errors };
}

/** Continues the last stroke (painting / erasing by dragging) – still one undo step. */
export function extendStroke(draft: ShipyardDraft, ops: readonly EditorOp[]): StrokeResult {
  const last = draft.undo.at(-1);
  if (!last || last.kind !== 'ops') return applyStroke(draft, ops);
  const r = applyOps(draft.grid, ops);
  if (r.applied.length === 0) return { draft, applied: [], errors: r.errors };
  const undo = [...draft.undo.slice(0, -1), { kind: 'ops' as const, ops: [...last.ops, ...r.applied] }];
  return { draft: { ...draft, undo, redo: [], grid: r.grid }, applied: r.applied, errors: r.errors };
}

export const canUndo = (draft: ShipyardDraft): boolean => draft.undo.length > 0;
export const canRedo = (draft: ShipyardDraft): boolean => draft.redo.length > 0;

export function undoDraft(draft: ShipyardDraft): ShipyardDraft {
  const last = draft.undo.at(-1);
  if (!last) return draft;
  return rebuild({ ...draft, undo: draft.undo.slice(0, -1), redo: [...draft.redo, last] });
}

export function redoDraft(draft: ShipyardDraft): ShipyardDraft {
  const next = draft.redo.at(-1);
  if (!next) return draft;
  return rebuild({ ...draft, undo: [...draft.undo, next], redo: draft.redo.slice(0, -1) });
}

const samePart = (a: PlacedPart, b: PlacedPart): boolean =>
  a.id === b.id && a.partId === b.partId && a.tier === b.tier && a.x === b.x && a.y === b.y && a.rot === b.rot && a.shape === b.shape;

/** Does the draft differ from the original ship? */
export function isDraftDirty(draft: Pick<ShipyardDraft, 'base' | 'grid'>): boolean {
  const a = draft.base.grid.parts;
  const b = draft.grid.parts;
  if (a.length !== b.length) return true;
  const byId = new Map(a.map((p) => [p.id, p]));
  return b.some((p) => {
    const q = byId.get(p.id);
    return !q || !samePart(p, q);
  });
}

/** "Restore original" – one stroke back to the original ship (it can be undone). */
export function resetDraft(draft: ShipyardDraft): ShipyardDraft {
  if (draftOps(draft).length === 0) return draft;
  return pushStroke(draft, { kind: 'reset' }, draft.base.grid);
}

/**
 * Restore to design (M3.8): one undo step that turns the draft into `ops` against the ship (from
 * `restoreOps`), whatever was drafted before. Without ops the draft stays the same object.
 */
export function restoreDraft(draft: ShipyardDraft, ops: readonly EditorOp[]): ShipyardDraft {
  if (ops.length === 0) return draft;
  const r = replayOps(draft.base.grid, ops);
  if (!r.ok) throw new Error(`Restore ops do not replay: ${r.error}`);
  return pushStroke(draft, { kind: 'restore', ops: [...ops] }, r.grid);
}

/** Craft / Buy choice for a missing part (null = default). */
export function setAcquire(draft: ShipyardDraft, key: PartKey, mode: AcquireMode | null): ShipyardDraft {
  const acquire = { ...draft.acquire };
  if (mode) acquire[key] = mode;
  else delete acquire[key];
  return { ...draft, acquire };
}

/**
 * After `staleDraft`: a new base (the current ship and storage) and the draft operations replayed as
 * one stroke. `dropped` = the number of operations that could no longer be done.
 */
export function rebaseDraft(
  draft: ShipyardDraft,
  grid: ShipGrid,
  hp: HpMap,
  inventory: PartInventory,
): { draft: ShipyardDraft; dropped: number } {
  const fresh = { ...createDraft(draft.stationId, grid, hp, inventory), acquire: { ...draft.acquire } };
  const ops = draftOps(draft);
  const r = applyStroke(fresh, ops);
  return { draft: r.draft, dropped: r.errors.length };
}
