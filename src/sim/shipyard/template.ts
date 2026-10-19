// "Build from template" (M4a, plan §2): editor operations that turn the current ship
// into a saved template – the same idea as `restoreOps` (M3.8), but parts match by placement and part
// key instead of part id. The editor loads the ops as the shipyard draft; the usual price of changes,
// locks (`partLocked`) and validation apply, and the commit is the normal `shipyardCommit`.
//
// The template is placed so its cockpit lands on the current cockpit's cell (or on the hangar centre
// when the cockpit keys differ – the cockpit is then swapped like any other part), shifted as little
// as needed to fit the hangar. Then:
//   - a part with the same key, cell and rotation as a template part stays (damaged or not – repair
//     is the shipyard's business);
//   - other parts whose key the template still needs are moved there (one group move; they keep
//     their id and HP, so nothing is bought for them);
//   - the rest is taken off (into storage, repaired or scrapped by the design rules);
//   - the template parts still missing are placed new (from storage, bought or crafted).
// Shapes (SL2 E2) are part of the match: a part matches a template place only in the same shape, so a
// full plate where the template has a wedge is taken off and a new wedge laid (no reshape ops – the
// removed plate cancels against the new one, the cost is the installation; a damaged one is priced).
import { parsePartKey, placedKey, type PartInventory, type PartKey } from '../../data/parts';
import { currentHp, maxHp } from '../ship/hp';
import type { HpMap, PlacedPart, ShipGrid } from '../ship/types';
import { normalizeParts, templateBounds, templateGrid } from '../templates/normalize';
import type { ShipTemplate, TemplatePart } from '../templates/types';
import { applyEditorOp, HANGAR_MAX, HANGAR_MIN, type EditorOp, type PartMove } from './editor';

export interface TemplatePlan {
  /** Operations against the current grid, in order (they always replay). */
  ops: EditorOp[];
  /** Where the template's cockpit cell (0, 0) lands in the hangar. */
  offset: { x: number; y: number };
  /** Parts already where the template wants them. */
  kept: number;
  /** Parts moved (or turned) into a template place – no new part needed. */
  moved: number;
  /** Parts taken off the ship, by key. */
  removed: PartInventory;
  /** New parts the template needs, by key – the shipyard takes them from storage, buys or crafts them. */
  placed: PartInventory;
  /** Template parts that could not be placed (only for a template that does not fit the hangar). */
  unplaced: number;
}

const add = (inv: PartInventory, key: PartKey): void => {
  inv[key] = (inv[key] ?? 0) + 1;
};

const clamp = (v: number, lo: number, hi: number): number => (lo > hi ? lo : Math.min(hi, Math.max(lo, v)));

/** Where the template's cockpit goes: on the current cockpit when the keys match, else the hangar centre; then into the hangar. */
function templateOffset(grid: ShipGrid, parts: readonly TemplatePart[]): { x: number; y: number } {
  const wanted = parts.find((p) => parsePartKey(p[0]).partId === 'cockpit');
  const cockpit = grid.parts.filter((p) => p.partId === 'cockpit').sort((a, b) => a.id - b.id)[0];
  const pref = wanted && cockpit && wanted[0] === placedKey(cockpit) ? { x: cockpit.x - wanted[1], y: cockpit.y - wanted[2] } : { x: 0, y: 0 };
  const b = templateBounds(parts);
  if (!b) return pref;
  return { x: clamp(pref.x, HANGAR_MIN - b.minX, HANGAR_MAX - b.maxX), y: clamp(pref.y, HANGAR_MIN - b.minY, HANGAR_MAX - b.maxY) };
}

const samePlace = (a: PlacedPart, b: PlacedPart): boolean => a.x === b.x && a.y === b.y && a.rot === b.rot;

/** What a part must share with a template place to fill it: the part key and the shape. */
const sameKind = (a: PlacedPart, b: PlacedPart): boolean => placedKey(a) === placedKey(b) && a.shape === b.shape;

/**
 * Editor ops that turn `grid` (with HP `hp`) into `template`. Pure; the ops always replay through
 * `applyEditorOp` / `replayOps` from `grid`. Locks and prices are not checked here.
 */
export function templateOps(grid: ShipGrid, hp: HpMap, template: ShipTemplate): TemplatePlan {
  const normal = normalizeParts(template.parts) ?? template.parts;
  const offset = templateOffset(grid, normal);
  const targets = templateGrid(normal, offset.x, offset.y).parts;

  // 1. exact matches: same key, shape, cell and rotation (template parts never overlap, so a cell has one target)
  const open = new Set(targets.map((t) => t.id));
  const keptIds = new Set<number>();
  for (const p of [...grid.parts].sort((a, b) => a.id - b.id)) {
    const t = targets.find((c) => open.has(c.id) && samePlace(c, p) && sameKind(c, p));
    if (t) {
      open.delete(t.id);
      keptIds.add(p.id);
    }
  }

  // 2. moves: per key and shape, the best leftover parts (owned before loan, healthiest, oldest) fill the open places
  const health = (p: PlacedPart): number => currentHp(hp, p) / maxHp(p);
  const leftovers = grid.parts
    .filter((p) => !keptIds.has(p.id))
    .sort((a, b) => Number(!!a.loan) - Number(!!b.loan) || health(b) - health(a) || a.id - b.id);
  const moves: PartMove[] = [];
  const movedIds = new Set<number>();
  for (const t of targets) {
    if (!open.has(t.id)) continue;
    const p = leftovers.find((c) => !movedIds.has(c.id) && sameKind(c, t));
    if (!p) continue;
    movedIds.add(p.id);
    open.delete(t.id);
    moves.push({ id: p.id, x: t.x, y: t.y, rot: t.rot });
  }

  const ops: EditorOp[] = [];
  let current = grid;
  const run = (op: EditorOp): boolean => {
    const r = applyEditorOp(current, op);
    if (r.ok) {
      current = r.grid;
      ops.push(op);
    }
    return r.ok;
  };

  // 3. everything else comes off first, so moves and new parts find their cells free
  const removed: PartInventory = {};
  for (const p of [...grid.parts].sort((a, b) => a.id - b.id)) {
    if (keptIds.has(p.id) || movedIds.has(p.id)) continue;
    if (run({ op: 'remove', id: p.id })) add(removed, placedKey(p));
  }

  // 4. one group move (checked against the result, so parts may trade places)
  let moved = 0;
  if (moves.length > 0) {
    moves.sort((a, b) => a.id - b.id);
    if (run({ op: 'moveGroup', moves })) moved = moves.length;
    else for (const m of moves) if (run({ op: 'move', ...m })) moved++;
  }

  // 5. new parts for the places still open, in template order
  const placed: PartInventory = {};
  let unplaced = 0;
  for (const t of targets) {
    if (!open.has(t.id)) continue;
    const key = placedKey(t);
    if (run({ op: 'place', key, x: t.x, y: t.y, rot: t.rot, ...(t.shape !== undefined ? { shape: t.shape } : {}) })) add(placed, key);
    else unplaced++;
  }
  // a fallback single move that failed leaves its place open and the part where it was
  unplaced += moves.length - moved;

  return { ops, offset, kept: keptIds.size, moved, removed, placed, unplaced };
}
