// Shipyard editor controls (M2, 4.6.3–4.6.9): part selection, the ghost under the cursor, placing,
// painting, erasing, moving, rotating, undo/redo and dialogs. Works with grid cells – the renderer does
// the pixel → cell conversion; no DOM knowledge, so it can be tested without a browser.
import { parsePartKey, partKey, type PartInventory, type PartKey, type Tier } from '../data/parts';
import { SHAPEABLE_PARTS, type ShapeId } from '../data/shapes';
import { getLocale, type Locale } from '../i18n/locale';
import { partCells } from '../sim/ship/grid';
import { currentHp, maxHp } from '../sim/ship/hp';
import { partSize } from '../sim/ship/shape';
import type { HpMap, PlacedPart, Rotation, ShipGrid } from '../sim/ship/types';
import { draftBaseHash, shipyardHash } from '../sim/shipyard/commit';
import type { DesignReport, ShipyardContext } from '../sim/shipyard/design';
import {
  applyStroke,
  createDraft,
  extendStroke,
  isDraftDirty,
  rebaseDraft,
  redoDraft,
  resetDraft,
  setAcquire,
  undoDraft,
  type AcquireMode,
  type ShipyardDraft,
} from '../sim/shipyard/draft';
import {
  applyEditorOp,
  checkGroupMove,
  checkPlacement,
  connectedPiece,
  mirrorAxis,
  mirrorCell,
  mirrorGroupMoves,
  mirrorPlacement,
  onMirrorAxis,
  partAt,
  placementAnchor,
  replayOps,
  rotatedGroup,
  rotatedPlacement,
  type EditorOp,
  type PartMove,
  type PlacementError,
} from '../sim/shipyard/editor';
import type { StationId } from '../sim/world/stations';
import { tx } from '../i18n';
import { buildShipyardView, hasShapes, nextShape, placementMessage, SHAPE_CYCLE, type ShipyardView } from './shipyardView';
import { missingParts } from '../sim/ship/blueprint';
import { damagedParts } from '../sim/ship/hp';
import { restoreOps, type RestorePlan } from '../sim/shipyard/restore';
import { restoreDraft, type EditorStroke } from '../sim/shipyard/draft';
import { templateOps, type TemplatePlan } from '../sim/shipyard/template';
import type { ShipTemplate } from '../sim/templates/types';

export interface Cell {
  x: number;
  y: number;
}

/** Where the editor gets the ship, storage and station state (in game: the simulation; in tests: objects). */
export interface ShipyardSource {
  stationId: StationId;
  ship(): { grid: ShipGrid; hp: HpMap };
  inventory(): PartInventory;
  context(): ShipyardContext;
  /** Ship blueprint – the last confirmed design (M3.8); without it there is nothing to restore. */
  blueprint?(): ShipGrid;
}

/** What "Restore to design" would do for the ship in the dock (M3.8). */
export interface RestoreInfo {
  /** Blueprint parts the ship lost. */
  missing: PartInventory;
  missingCount: number;
  /** Damaged installed parts (swapped for new ones). */
  damaged: number;
  /** There is something to restore. */
  available: boolean;
  /** The draft is the restored design right now (last step = restore). */
  applied: boolean;
}

export type MouseButton = 'left' | 'right';

/** A toast for the editor keys (M, Shift+M, Tab) – the game shows it. */
export interface MirrorNotice {
  text: string;
  kind: 'info' | 'ok' | 'error';
}

/** A toast of an editor key (the mirror keys, Tab – SL2 E2). */
export type EditorNotice = MirrorNotice;

/** Mirror mode in the hangar: the axis (twice its y, see `mirrorAxis`) and the ghost of the mirror copy. */
export interface MirrorScene {
  axis2: number;
  /** The mirror copy of the ghost under the cursor; null = nothing to place or the part lies on the axis. */
  ghost: Ghost | null;
  /** Tag at the end of the axis line. */
  label: string;
}

/** Editor dialog: discard changes, fly off without confirming, a draft over an outdated ship. */
export type ShipyardPrompt = 'cancel' | 'undock' | 'stale';

type Drag =
  | { kind: 'paint'; last: Cell; started: boolean }
  | { kind: 'erase'; last: Cell; started: boolean }
  /** Part move: `grab` = the part cell the player grabbed (offset from the part's x, y); the shape stays. */
  | { kind: 'move'; id: number; key: PartKey; shape?: ShapeId; grab: Cell; rot: Rotation; from: { x: number; y: number; rot: Rotation }; base: ShipGrid }
  /** Shift + drag: a selection box from `start` to the cursor (Shift + click without moving = toggle a part). */
  | { kind: 'box'; start: Cell }
  /**
   * Group move: `layout` = the parts relative to the grabbed cell (the cursor cell is the grabbed cell, so
   * R turns the layout around (0, 0)); `base` = the grid without the group.
   */
  | { kind: 'group'; layout: GroupLayout[]; from: PlacedPart[]; base: ShipGrid; version: number };

/** One part of a dragged group, relative to the grabbed cell (a shaped part keeps its shape). */
interface GroupLayout {
  id: number;
  key: PartKey;
  shape?: ShapeId;
  dx: number;
  dy: number;
  rot: Rotation;
}

/** Ghost of a dragged group: every part and every cell with its own validity (red = overlap / out of bounds). */
export interface GroupGhost {
  parts: { id: number; key: PartKey; shape?: ShapeId; x: number; y: number; rot: Rotation; ok: boolean }[];
  cells: { x: number; y: number; ok: boolean }[];
  /** First problem of the whole move (null = it can be dropped here). */
  error: PlacementError | null;
}

export interface Ghost {
  key: PartKey;
  x: number;
  y: number;
  rot: Rotation;
  /** SL2 E2: the armour shape (missing = the full part). */
  shape?: ShapeId;
  /** null = can be placed. */
  error: PlacementError | null;
  /** The part being moved (id) – its original cells do not block. */
  movingId?: number;
}

/** What the hangar should draw. Objects change only on a change (the renderer compares identity). */
export interface HangarScene {
  /** Grid to draw (during a move, without the part being moved). */
  grid: ShipGrid;
  ghost: Ghost | null;
  /** Original cells of the part being moved (dashed outline). */
  origin: Cell[] | null;
  /** Disconnected parts (red tint). */
  disconnected: readonly number[];
  /** Parts highlighted from a check message. */
  focus: { ids: readonly number[]; tone: 'error' | 'warning'; code: string } | null;
  /** Cells of blueprint parts the ship lost that the draft has not filled yet (M3.8, red dashed sockets). */
  blueprint: Cell[] | null;
  /** The part under the cursor (with no part selected – it can be grabbed, rotated, removed). */
  hoverId: number | null;
  layers: boolean;
  /** Group selection (part ids, Shipyard 2.0). */
  selection: readonly number[];
  /** Selection box being dragged (Shift + drag), inclusive cell corners. */
  box: { min: Cell; max: Cell } | null;
  /** Ghost of the dragged group. */
  group: GroupGhost | null;
  /** "Not connected" tags: one cell per loose piece, with the tag text. */
  loose: { cells: Cell[]; label: string } | null;
  /** Mirror mode (SL2 E1): the axis line and the mirror ghost; null = the mode is off. */
  mirror: MirrorScene | null;
}

const rotate = (rot: Rotation, dir: 1 | -1): Rotation => (((rot + dir) % 4) + 4) % 4 as Rotation;
/** Rot-0 footprint of part `key` laid in `shape` (wings and the 2×1 nose are 2×1 armour). */
const sizeOf = (key: PartKey, shape?: ShapeId | null) => partSize({ ...parsePartKey(key), ...shapeField(shape) });
/** Bottom-left cell of part `key` when the cursor is on `cell` (multi-cell parts, 3×1 centred). */
const anchorAt = (key: PartKey, cell: Cell, rot: Rotation, shape?: ShapeId | null): Cell => placementAnchor(sizeOf(key, shape), cell, rot);
/** `shape` as an optional field (null / undefined = none – the full part has no `shape` key). */
function shapeField(shape: ShapeId | null | undefined): { shape?: ShapeId } {
  return shape != null ? { shape } : {};
}
/** Can part `key` be laid in shapes (armour, every tier)? (The Tab cycle and the strip share `SHAPE_CYCLE`.) */
const shapeable = hasShapes;
const sameCell = (a: Cell | null, b: Cell | null): boolean => !!a && !!b && a.x === b.x && a.y === b.y;
/** Inclusive corners of the box between two cells. */
const boxOf = (a: Cell, b: Cell): { min: Cell; max: Cell } => ({
  min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
  max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
});

const sameRecord = (a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean => {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
};

/** Same station state for the shipyard view (no serialisation – called every frame). */
function sameContext(a: ShipyardContext, b: ShipyardContext): boolean {
  return (
    a.ring === b.ring &&
    a.credits === b.credits &&
    a.fuel === b.fuel &&
    a.services.crafting === b.services.crafting &&
    a.services.partsMarket === b.services.partsMarket &&
    sameRecord(a.storage, b.storage) &&
    sameRecord(a.cargo, b.cargo) &&
    sameSet(a.locked, b.locked)
  );
}

/** Same locked parts (Archive, blueprints – M3.5b). */
function sameSet<T>(a: ReadonlySet<T> | undefined, b: ReadonlySet<T> | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** Cells on the segment between two cells (a fast mouse stroke does not skip cells while painting). */
export function cellsBetween(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const n = Math.max(Math.abs(dx), Math.abs(dy));
  for (let i = 1; i <= n; i++) {
    const c = { x: a.x + Math.round((dx * i) / n), y: a.y + Math.round((dy * i) / n) };
    if (!out.some((o) => sameCell(o, c))) out.push(c);
  }
  return out;
}

/** The design fails only for money or materials. */
const economicallyBlocked = (view: ShipyardView): boolean =>
  view.report.errors.some((e) => e.code === 'unaffordable' || e.code === 'missingResources');

export class ShipyardEditor {
  draft: ShipyardDraft;
  tier: Tier = 1;
  selected: PartKey | null = null;
  /**
   * SL2 E2: the shape of the armour in hand (null = the full part). Tab / Shift+Tab (`cycleShape`) and the
   * shape strip (`setShape`) change it; selecting a part without shapes resets it.
   */
  shape: ShapeId | null = null;
  rot: Rotation = 0;
  hover: Cell | null = null;
  layers = true;
  prompt: ShipyardPrompt | null = null;
  /** Part highlight after clicking a check message. */
  focus: HangarScene['focus'] = null;
  /** reqId of the sent confirmation (waiting for the result from the simulation). */
  pendingCommit: number | null = null;
  /**
   * Mirror mode (M, SL2 §2.11): placing, removing and painting repeat across the ship's long axis;
   * `half` puts the axis on the seam above the cockpit row instead of through its centre.
   */
  readonly mirror = { on: false, half: false };
  private drag: Drag | null = null;
  /** Group selection (ids; parts an undo removed are dropped when read). */
  private sel: readonly number[] = [];
  private selCache: { grid: ShipGrid; sel: readonly number[]; ids: readonly number[] } | null = null;
  private groupCache: { key: string; ghost: GroupGhost | null } | null = null;
  private looseCache: { grid: ShipGrid; ids: readonly number[]; locale: Locale; loose: HangarScene['loose'] } | null = null;
  private groupVersion = 0;
  /** The view holds texts too: a language switch rebuilds it. */
  private viewCache: { draft: ShipyardDraft; tier: Tier; ctx: ShipyardContext; locale: Locale; view: ShipyardView } | null = null;
  /** The ghost is drawn every frame – the placement check is recomputed only when its inputs change. */
  private ghostCache: { grid: ShipGrid; key: string; ghost: Ghost | null } | null = null;
  private sceneCache: { key: string; scene: HangarScene } | null = null;
  private mirrorCache: { grid: ShipGrid; ghost: Ghost | null; on: boolean; half: boolean; locale: Locale; scene: MirrorScene | null } | null = null;
  private baseHash: { base: ShipyardDraft['base']; hash: string } | null = null;
  private gapCache: { base: ShipyardDraft['base']; blueprint: ShipGrid; missing: PlacedPart[] } | null = null;
  private socketCache: { grid: ShipGrid; missing: PlacedPart[]; cells: Cell[] | null } | null = null;
  /** The undo step that loaded a template (M4a) and the template's name – not a "restore to design". */
  private templateStep: { stroke: EditorStroke; name: string } | null = null;

  constructor(private readonly source: ShipyardSource) {
    this.draft = this.freshDraft();
  }

  get stationId(): StationId {
    return this.source.stationId;
  }

  private freshDraft(): ShipyardDraft {
    const { grid, hp } = this.source.ship();
    return createDraft(this.source.stationId, grid, hp, this.source.inventory());
  }

  // -------------------------------------------------------------------------
  // data for the UI and the renderer

  /** Palette, stats, check and price – recomputed only when the draft or the station changes. */
  view(): ShipyardView {
    const ctx = this.source.context();
    const c = this.viewCache;
    const locale = getLocale();
    if (c && c.draft === this.draft && c.tier === this.tier && c.locale === locale && (c.ctx === ctx || sameContext(c.ctx, ctx))) return c.view;
    const view = buildShipyardView(this.draft, ctx, this.tier);
    this.viewCache = { draft: this.draft, tier: this.tier, ctx, locale, view };
    return view;
  }

  get dirty(): boolean {
    return isDraftDirty(this.draft);
  }

  /** The ghost under the cursor (the selected part or the part being moved). */
  ghost(): Ghost | null {
    if (!this.hover) return null;
    const grid = this.draft.grid;
    const d = this.drag;
    const key =
      `${this.hover.x},${this.hover.y}|` +
      (d?.kind === 'move' ? `m${d.id}|${d.key}|${d.grab.x},${d.grab.y}|${d.rot}` : `${d?.kind ?? '-'}|${this.selected}|${this.rot}|${this.handShape() ?? ''}`);
    const c = this.ghostCache;
    if (c && c.grid === grid && c.key === key) return c.ghost;
    const ghost = this.computeGhost(grid);
    this.ghostCache = { grid, key, ghost };
    return ghost;
  }

  private computeGhost(grid: ShipGrid): Ghost | null {
    if (!this.hover) return null;
    if (this.drag?.kind === 'move') {
      const d = this.drag;
      const x = this.hover.x - d.grab.x;
      const y = this.hover.y - d.grab.y;
      const { partId, tier } = parsePartKey(d.key);
      const error = checkPlacement(grid, partId, tier, x, y, d.rot, d.id, d.shape);
      return { key: d.key, x, y, rot: d.rot, ...shapeField(d.shape), error, movingId: d.id };
    }
    if (!this.selected || this.drag?.kind === 'erase' || this.drag?.kind === 'box' || this.drag?.kind === 'group') return null;
    const { partId, tier } = parsePartKey(this.selected);
    const shape = this.handShape();
    const { x, y } = anchorAt(this.selected, this.hover, this.rot, shape);
    return { key: this.selected, x, y, rot: this.rot, ...shapeField(shape), error: checkPlacement(grid, partId, tier, x, y, this.rot, undefined, shape) };
  }

  /** The shape the part in hand is laid in (null = full, also for a part without shapes). */
  private handShape(): ShapeId | null {
    return shapeable(this.selected) ? this.shape : null;
  }

  /** Text at the cursor: the reason the part cannot be placed. */
  ghostMessage(): string | null {
    const g = this.ghost();
    return g?.error ? placementMessage(g.error) : null;
  }

  // -------------------------------------------------------------------------
  // mirror mode (SL2 E1)

  /** The axis (twice its y) while the mirror mode is on, else null. */
  private mirrorAxis2(): number | null {
    return this.mirror.on ? mirrorAxis(this.draft.grid, this.mirror.half) : null;
  }

  /** Mirror mode for the hangar: the axis and the copy's ghost (the same object while nothing changes). */
  mirrorScene(): MirrorScene | null {
    const grid = this.draft.grid;
    const ghost = this.ghost();
    const { on, half } = this.mirror;
    const locale = getLocale();
    const c = this.mirrorCache;
    if (c && c.grid === grid && c.ghost === ghost && c.on === on && c.half === half && c.locale === locale) return c.scene;
    let scene: MirrorScene | null = null;
    if (on) {
      const axis2 = mirrorAxis(grid, half);
      scene = { axis2, ghost: ghost ? this.mirrorGhostOf(grid, ghost, axis2) : null, label: tx().shipyardV2.mirror.axisTag };
    }
    this.mirrorCache = { grid, ghost, on, half, locale, scene };
    return scene;
  }

  /**
   * The ghost of the mirror copy: checked against the grid with the original already placed (so a copy
   * overlapping its original is blocked); while the original cannot be placed, the copy is not either.
   * Moves are not mirrored; a part lying on the axis has no copy.
   */
  private mirrorGhostOf(grid: ShipGrid, ghost: Ghost, axis2: number): Ghost | null {
    if (ghost.movingId !== undefined || onMirrorAxis(ghost.key, ghost.x, ghost.y, ghost.rot, axis2, ghost.shape)) return null;
    const m = mirrorPlacement(ghost.key, ghost.x, ghost.y, ghost.rot, axis2, ghost.shape);
    const { partId, tier } = parsePartKey(ghost.key);
    let error: PlacementError | null;
    if (ghost.error === null) {
      const after = applyEditorOp(grid, { op: 'place', key: ghost.key, x: ghost.x, y: ghost.y, rot: ghost.rot, ...shapeField(ghost.shape) });
      error = after.ok ? checkPlacement(after.grid, partId, tier, m.x, m.y, m.rot, undefined, m.shape) : ghost.error;
    } else {
      error = checkPlacement(grid, partId, tier, m.x, m.y, m.rot, undefined, m.shape) ?? ghost.error;
    }
    return { key: ghost.key, x: m.x, y: m.y, rot: m.rot, ...shapeField(m.shape), error };
  }

  /** Text at the mirror ghost: why only the original will be placed (null = the copy fits or there is none). */
  mirrorGhostMessage(): string | null {
    const ghost = this.ghost();
    const copy = this.mirrorScene()?.ghost;
    if (!ghost || ghost.error || !copy?.error) return null;
    return tx().shipyardV2.mirror.ghostBlocked(placementMessage(copy.error));
  }

  /** M: switches the mirror mode. */
  toggleMirror(): MirrorNotice {
    this.mirror.on = !this.mirror.on;
    return { text: this.mirror.on ? tx().shipyardV2.mirror.on : tx().shipyardV2.mirror.off, kind: 'info' };
  }

  /** "os ±½": the axis through the cockpit row's centre or on the seam above it. */
  toggleMirrorAxis(): void {
    this.mirror.half = !this.mirror.half;
  }

  /**
   * Shift+M: mirrors the group selection across its own long axis (across the cockpit row when the
   * cockpit is selected – the cockpit stays) in one undo step. Works with the mirror mode on or off.
   */
  mirrorSelection(): MirrorNotice {
    const texts = tx().shipyardV2.mirror;
    const ids = new Set(this.selection);
    if (this.drag || ids.size === 0) return { text: texts.selectionEmpty, kind: 'info' };
    const moves = mirrorGroupMoves(this.draft.grid.parts.filter((p) => ids.has(p.id)));
    const error = moves.length > 0 ? this.stroke([{ op: 'moveGroup', moves }], false).error : null;
    if (error) return { text: texts.selectionBlocked(placementMessage(error)), kind: 'error' };
    return { text: texts.selectionMirrored, kind: 'ok' };
  }

  /**
   * Places the selected part at a cell; with the mirror mode on also its mirror copy, in the same undo
   * step (`extend` = continue the current stroke). The copy follows only a placed original; a copy that
   * does not fit is skipped (its ghost shows why).
   */
  private placeAt(cell: Cell, extend: boolean): { ok: boolean; error: PlacementError | null } {
    const key = this.selected!;
    const shape = this.handShape();
    const at = anchorAt(key, cell, this.rot, shape);
    const axis2 = this.mirrorAxis2();
    const r = this.stroke([{ op: 'place', key, x: at.x, y: at.y, rot: this.rot, ...shapeField(shape) }], extend);
    if (r.ok && axis2 !== null && !onMirrorAxis(key, at.x, at.y, this.rot, axis2, shape)) {
      this.stroke([{ op: 'place', key, ...mirrorPlacement(key, at.x, at.y, this.rot, axis2, shape) }], true);
    }
    return r;
  }

  /**
   * Removes the part on a cell; with the mirror mode on also the part on the mirrored cell (the eraser is
   * mirrored), in the same undo step. The cockpit is never removed by the mirror.
   */
  private removeAt(cell: Cell, extend: boolean): { ok: boolean; error: PlacementError | null } {
    const grid = this.draft.grid;
    const part = partAt(grid, cell.x, cell.y);
    if (!part) return { ok: false, error: null };
    const ops: EditorOp[] = [{ op: 'remove', id: part.id }];
    const axis2 = this.mirrorAxis2();
    if (axis2 !== null && part.partId !== 'cockpit') {
      const m = mirrorCell(cell, axis2);
      const twin = partAt(grid, m.x, m.y);
      if (twin && twin.id !== part.id && twin.partId !== 'cockpit') ops.push({ op: 'remove', id: twin.id });
    }
    return this.stroke(ops, extend);
  }

  hoveredPart(): number | null {
    if (!this.hover || this.selected || this.drag) return null;
    return partAt(this.draft.grid, this.hover.x, this.hover.y)?.id ?? null;
  }

  /** Selected part ids that still exist in the draft (the same array while nothing changes). */
  get selection(): readonly number[] {
    const grid = this.draft.grid;
    const c = this.selCache;
    if (c && c.grid === grid && c.sel === this.sel) return c.ids;
    const present = new Set(grid.parts.map((p) => p.id));
    const ids = this.sel.filter((id) => present.has(id));
    this.selCache = { grid, sel: this.sel, ids: ids.length === this.sel.length ? this.sel : ids };
    return this.selCache.ids;
  }

  /** The ghost of a dragged group at the cursor. */
  groupGhost(): GroupGhost | null {
    const d = this.drag;
    if (d?.kind !== 'group' || !this.hover) return null;
    const key = `${d.version}|${this.hover.x},${this.hover.y}`;
    if (this.groupCache?.key === key) return this.groupCache.ghost;
    const moves = this.groupMoves(d, this.hover);
    const check = checkGroupMove(this.draft.grid, moves);
    const bad = new Set(check.cells.filter((c) => c.error).map((c) => c.id));
    const ghost: GroupGhost = {
      parts: d.layout.map((s, i) => ({ id: s.id, key: s.key, ...shapeField(s.shape), x: moves[i]!.x, y: moves[i]!.y, rot: s.rot, ok: !bad.has(s.id) })),
      cells: check.cells.map((c) => ({ x: c.x, y: c.y, ok: c.error === null })),
      error: check.error,
    };
    this.groupCache = { key, ghost };
    return ghost;
  }

  private groupMoves(d: Extract<Drag, { kind: 'group' }>, at: Cell): PartMove[] {
    return d.layout.map((s) => ({ id: s.id, x: at.x + s.dx, y: at.y + s.dy, rot: s.rot }));
  }

  /** "Not connected" tags: one per loose piece, on its cell nearest to the piece's middle. */
  private looseTags(disconnected: readonly number[]): HangarScene['loose'] {
    const grid = this.draft.grid;
    const locale = getLocale();
    const c = this.looseCache;
    if (c && c.grid === grid && c.ids === disconnected && c.locale === locale) return c.loose;
    let loose: HangarScene['loose'] = null;
    if (disconnected.length > 0) {
      const byId = new Map(grid.parts.map((p) => [p.id, p]));
      const seen = new Set<number>();
      const cells: Cell[] = [];
      for (const id of disconnected) {
        if (seen.has(id)) continue;
        const piece = connectedPiece(grid, id);
        piece.forEach((p) => seen.add(p));
        const pieceCells = piece.flatMap((p) => partCells(byId.get(p)!));
        const mx = pieceCells.reduce((s, q) => s + q.x, 0) / pieceCells.length;
        const my = pieceCells.reduce((s, q) => s + q.y, 0) / pieceCells.length;
        const best = pieceCells.reduce((a, b) => (Math.hypot(b.x - mx, b.y - my) < Math.hypot(a.x - mx, a.y - my) ? b : a));
        cells.push({ x: best.x, y: best.y });
      }
      loose = { cells, label: tx().shipyardV2.looseTag };
    }
    this.looseCache = { grid, ids: disconnected, locale, loose };
    return loose;
  }

  scene(): HangarScene {
    const ghost = this.ghost();
    const view = this.view();
    const drag = this.drag;
    const grid = drag?.kind === 'move' || drag?.kind === 'group' ? drag.base : this.draft.grid;
    const hoverId = this.hoveredPart();
    const sockets = this.sockets();
    const selection = this.selection;
    const group = this.groupGhost();
    const box = drag?.kind === 'box' && this.hover ? boxOf(drag.start, this.hover) : null;
    const loose = this.looseTags(view.disconnected);
    const mirror = this.mirrorScene();
    const key = [
      ghost ? `${ghost.key}|${ghost.shape ?? ''}|${ghost.x}|${ghost.y}|${ghost.rot}|${ghost.error}` : '-',
      drag?.kind === 'move' ? drag.id : '',
      hoverId,
      this.layers,
      this.focus ? `${this.focus.tone}:${this.focus.ids.join(',')}` : '',
      box ? `${box.min.x},${box.min.y},${box.max.x},${box.max.y}` : '',
    ].join('/');
    const c = this.sceneCache;
    if (
      c && c.key === key && c.scene.grid === grid && c.scene.disconnected === view.disconnected && c.scene.blueprint === sockets &&
      c.scene.selection === selection && c.scene.group === group && c.scene.loose === loose && c.scene.mirror === mirror
    ) return c.scene;
    const scene: HangarScene = {
      grid,
      ghost,
      origin:
        drag?.kind === 'move' ? partCells({ id: -1, ...parsePartKey(drag.key), ...shapeField(drag.shape), x: drag.from.x, y: drag.from.y, rot: drag.from.rot })
        : drag?.kind === 'group' ? drag.from.flatMap((p) => partCells(p))
        : null,
      disconnected: view.disconnected,
      focus: this.focus,
      hoverId,
      layers: this.layers,
      blueprint: sockets,
      selection,
      box,
      group,
      loose,
      mirror,
    };
    this.sceneCache = { key, scene };
    return scene;
  }

  // -------------------------------------------------------------------------
  // draft changes

  private setDraft(draft: ShipyardDraft): boolean {
    if (draft === this.draft) return false;
    this.draft = draft;
    this.focus = null;
    return true;
  }

  private stroke(ops: EditorOp[], extend: boolean): { ok: boolean; error: PlacementError | null } {
    const r = (extend ? extendStroke : applyStroke)(this.draft, ops);
    this.setDraft(r.draft);
    return { ok: r.applied.length > 0, error: r.errors[0] ?? null };
  }

  /** Selects a part from the palette (the same part again = deselect). */
  select(key: PartKey | null): void {
    this.selected = key && key === this.selected ? null : key;
    if (this.selected) this.tier = parsePartKey(this.selected).tier;
    if (this.selected && !shapeable(this.selected)) this.shape = null;
  }

  /** Keys 1–9: a part from the palette of the selected tier. */
  selectHotkey(n: number): void {
    const entry = this.view().palette[n - 1];
    if (entry) this.select(entry.key);
  }

  setTier(tier: Tier): void {
    this.tier = tier;
    if (this.selected) {
      const sel = parsePartKey(this.selected);
      this.selected = partKey(sel.partId, tier, sel.variant);
    }
  }

  toggleTier(): void {
    this.setTier(this.tier === 1 ? 2 : 1);
  }

  toggleLayers(): void {
    this.layers = !this.layers;
  }

  // -------------------------------------------------------------------------
  // shaped armour (SL2 E2, §2.3, §2.7)

  /** The shape strip's click: puts `shape` in hand (null = full); ignored unless armour is in hand. */
  setShape(shape: ShapeId | null): void {
    if (shapeable(this.selected)) this.shape = shape;
  }

  /**
   * Tab / Shift+Tab (`dir` −1): with armour in hand the next / previous shape in hand; with an empty hand
   * over a placed armour that part is reshaped (shapes whose footprint does not fit are skipped). Returns
   * the toast to show, if any ("only armour has shapes", "no other shape fits", the repair note of a
   * damaged plate, a mirror counterpart that stays).
   */
  cycleShape(dir: 1 | -1): EditorNotice | null {
    if (this.drag) return null;
    const texts = tx().shipyardV2.shapes;
    if (this.selected) {
      if (!shapeable(this.selected)) return { text: texts.armourOnly, kind: 'info' };
      this.shape = nextShape(this.shape, dir);
      return null;
    }
    const part = this.hover ? partAt(this.draft.grid, this.hover.x, this.hover.y) : null;
    if (!part) return null;
    if (!SHAPEABLE_PARTS.has(part.partId)) return { text: texts.armourOnly, kind: 'info' };
    return this.reshapeStep(part, dir);
  }

  /** Tab over a placed armour: the next shape that fits its place, as one undo step (with its mirror counterpart). */
  private reshapeStep(part: PlacedPart, dir: 1 | -1): EditorNotice | null {
    const grid = this.draft.grid;
    const texts = tx().shipyardV2.shapes;
    const current = part.shape ?? null;
    let shape: ShapeId | null = current;
    for (let i = 1; i < SHAPE_CYCLE.length; i++) {
      const next = nextShape(current, dir * i);
      if (checkPlacement(grid, part.partId, part.tier, part.x, part.y, part.rot, part.id, next) === null) {
        shape = next;
        break;
      }
    }
    if (shape === current) return { text: texts.noneFits, kind: 'info' };
    const key = partKey(part.partId, part.tier, part.variant);
    const own = this.reshapeOps(part, { x: part.x, y: part.y, rot: part.rot, shape });
    const ops = [...own];
    // a damaged plate (or its counterpart) goes remove + place: the notice says what the design does with it
    let damaged = this.damagedReshape(part, shape);
    let notice: EditorNotice | null = null;
    const axis2 = this.mirrorAxis2();
    const twin = axis2 === null ? null : this.mirrorTwin(part, axis2);
    if (twin && axis2 !== null) {
      const m = mirrorPlacement(key, part.x, part.y, part.rot, axis2, shape);
      const twinOps = this.reshapeOps(twin, { x: m.x, y: m.y, rot: m.rot, shape: m.shape ?? null });
      const before = replayOps(grid, own);
      const after = before.ok ? replayOps(before.grid, twinOps) : before;
      if (after.ok) {
        ops.push(...twinOps);
        if (this.damagedReshape(twin, m.shape ?? null)) damaged = true;
      } else {
        notice = { text: texts.mirrorBlocked(placementMessage(after.error)), kind: 'info' };
      }
    }
    const before = damaged ? this.view().report : null;
    this.stroke(ops, false);
    return notice ?? (before ? this.damagedReshapeNotice(before) : null);
  }

  /**
   * What happens to the damaged plate a reshape removed, read from the design after the stroke: repaired
   * (the repair line in "Cena zmien"), scrapped for a fresh plate (`damagedScrapped` – no repair service,
   * or no credits / material), or neither is possible (a new economic error blocks the design).
   */
  private damagedReshapeNotice(before: DesignReport): EditorNotice {
    const texts = tx().shipyardV2.shapes;
    const report = this.view().report;
    const economic = (r: DesignReport) => r.errors.some((e) => e.code === 'missingParts' || e.code === 'missingResources' || e.code === 'unaffordable');
    if (economic(report) && !economic(before)) return { text: texts.reshapeStuck, kind: 'error' };
    const scrap = report.warnings.find((w) => w.code === 'damagedScrapped');
    if (scrap) return { text: texts.reshapeScrap(scrap.reason === 'noRepairService'), kind: 'info' };
    return { text: texts.reshapeRepair, kind: 'info' };
  }

  /**
   * Would laying `part` in `shape` rescale damage? A base part below its max HP whose max HP changes
   * (wing L ↔ wing R ↔ full keep it) – the design forbids that in place (`reshapeDamaged`, §2.3).
   */
  private damagedReshape(part: PlacedPart, shape: ShapeId | null): boolean {
    const orig = this.draft.base.grid.parts.find((p) => p.id === part.id);
    if (!orig || (orig.shape ?? null) === shape) return false;
    const { shape: _old, ...rest } = orig;
    if (maxHp(orig) === maxHp({ ...rest, ...shapeField(shape) })) return false;
    return currentHp(this.draft.base.hp, orig) < maxHp(orig);
  }

  /**
   * The ops that lay `part` at `to` in `to.shape`: an in-place `reshape` (plus a move when the placement
   * changes – a mirror counterpart laid differently), or `remove` + `place` for a damaged plate, so the
   * design prices its repair and the new shape starts at full HP (§2.3).
   */
  private reshapeOps(part: PlacedPart, to: { x: number; y: number; rot: Rotation; shape: ShapeId | null }): EditorOp[] {
    if (this.damagedReshape(part, to.shape)) {
      const key = partKey(part.partId, part.tier, part.variant);
      return [{ op: 'remove', id: part.id }, { op: 'place', key, x: to.x, y: to.y, rot: to.rot, ...shapeField(to.shape) }];
    }
    if (part.x === to.x && part.y === to.y && part.rot === to.rot) return [{ op: 'reshape', id: part.id, shape: to.shape }];
    return [{ op: 'moveGroup', moves: [{ id: part.id, x: to.x, y: to.y, rot: to.rot, shape: to.shape }] }];
  }

  /**
   * The mirror counterpart of a placed part: the same part type and tier anchored where the mirror image
   * of `part` would be (null = none, or the part lies on the axis).
   */
  private mirrorTwin(part: PlacedPart, axis2: number): PlacedPart | null {
    const key = partKey(part.partId, part.tier, part.variant);
    if (onMirrorAxis(key, part.x, part.y, part.rot, axis2, part.shape)) return null;
    const m = mirrorPlacement(key, part.x, part.y, part.rot, axis2, part.shape);
    return (
      this.draft.grid.parts.find(
        (p) => p.id !== part.id && p.x === m.x && p.y === m.y && partKey(p.partId, p.tier, p.variant) === key,
      ) ?? null
    );
  }

  /**
   * R / Shift+R: rotates the ghost, the dragged part or group, the selected group or the part under the cursor.
   * A multi-cell part (and a group) rotates around the cell under the cursor (it stays covered); a rotation
   * that would overlap another part is skipped.
   */
  rotate(dir: 1 | -1 = 1): void {
    if (this.drag?.kind === 'group') {
      const d = this.drag;
      const turned = rotatedGroup(
        d.layout.map((s) => ({ ...parsePartKey(s.key), ...shapeField(s.shape), id: s.id, x: s.dx, y: s.dy, rot: s.rot })),
        { x: 0, y: 0 },
        dir,
      );
      d.layout = d.layout.map((s, i) => ({ ...s, dx: turned[i]!.x, dy: turned[i]!.y, rot: turned[i]!.rot }));
      d.version = ++this.groupVersion;
      return;
    }
    if (this.drag?.kind === 'move') {
      const d = this.drag;
      if (this.hover) {
        const at = { x: this.hover.x - d.grab.x, y: this.hover.y - d.grab.y, rot: d.rot };
        const next = rotatedPlacement(sizeOf(d.key, d.shape), at, this.hover, dir);
        d.grab = { x: this.hover.x - next.x, y: this.hover.y - next.y };
        d.rot = next.rot;
      } else {
        d.rot = rotate(d.rot, dir);
      }
      return;
    }
    if (this.selected) {
      this.rot = rotate(this.rot, dir);
      return;
    }
    const part = this.hover ? partAt(this.draft.grid, this.hover.x, this.hover.y) : null;
    const group = this.selection;
    if (part && this.hover && group.length > 1 && group.includes(part.id)) {
      const parts = this.draft.grid.parts.filter((p) => group.includes(p.id));
      this.stroke([{ op: 'moveGroup', moves: rotatedGroup(parts, this.hover, dir) }], false);
      return;
    }
    if (part && this.hover) {
      const next = rotatedPlacement(partSize(part), part, this.hover, dir);
      this.stroke([{ op: 'move', id: part.id, ...next }], false);
    }
  }

  setHover(cell: Cell | null): void {
    const prev = this.hover;
    this.hover = cell;
    const drag = this.drag;
    if (!cell || !drag || drag.kind === 'move' || drag.kind === 'box' || drag.kind === 'group' || sameCell(prev, cell)) return;
    const path = sameCell(drag.last, cell) ? [] : cellsBetween(drag.last, cell);
    drag.last = cell;
    for (const c of path) {
      if (drag.kind === 'paint' && !this.selected) return;
      // (not `||=` with the call on the right – it would skip the call once the stroke started)
      const r = drag.kind === 'paint' ? this.placeAt(c, drag.started) : this.removeAt(c, drag.started);
      drag.started ||= r.ok;
    }
  }

  /**
   * Mouse press on a cell. `alt` = eyedropper, `shift` = selection (box drag or toggling the part).
   * Returns the failure reason (for the message).
   */
  pointerDown(cell: Cell, button: MouseButton, alt = false, shift = false): PlacementError | null {
    this.hover = cell;
    this.focus = null;
    const part = partAt(this.draft.grid, cell.x, cell.y);
    if (button === 'right') {
      const started = this.removeAt(cell, false).ok;
      this.drag = { kind: 'erase', last: cell, started };
      return null;
    }
    if (alt) {
      this.eyedrop(cell);
      return null;
    }
    if (shift) {
      this.drag = { kind: 'box', start: cell };
      return null;
    }
    const group = this.selection;
    if (part && !this.selected && group.length > 1 && group.includes(part.id)) {
      const ids = new Set(group);
      const from = this.draft.grid.parts.filter((p) => ids.has(p.id));
      this.drag = {
        kind: 'group',
        layout: from.map((p) => ({ id: p.id, key: partKey(p.partId, p.tier, p.variant), ...shapeField(p.shape), dx: p.x - cell.x, dy: p.y - cell.y, rot: p.rot })),
        from,
        base: { parts: this.draft.grid.parts.filter((p) => !ids.has(p.id)), nextId: this.draft.grid.nextId },
        version: ++this.groupVersion,
      };
      return null;
    }
    // a plain click outside the selection starts over (the clicked part alone can still be dragged)
    if (!part || !group.includes(part.id)) this.sel = [];
    if (this.selected) {
      const r = this.placeAt(cell, false);
      this.drag = { kind: 'paint', last: cell, started: r.ok };
      return r.error;
    }
    if (part) {
      const base: ShipGrid = { parts: this.draft.grid.parts.filter((p) => p.id !== part.id), nextId: this.draft.grid.nextId };
      this.drag = {
        kind: 'move',
        id: part.id,
        key: partKey(part.partId, part.tier, part.variant),
        ...shapeField(part.shape),
        grab: { x: cell.x - part.x, y: cell.y - part.y },
        rot: part.rot,
        from: { x: part.x, y: part.y, rot: part.rot },
        base,
      };
    }
    return null;
  }

  /** Mouse release: finishes the move (an invalid spot = the part or group stays where it was). */
  pointerUp(): PlacementError | null {
    const drag = this.drag;
    this.drag = null;
    if (drag?.kind === 'box') {
      this.finishBox(drag.start, this.hover ?? drag.start);
      return null;
    }
    if (drag?.kind === 'group') {
      if (!this.hover) return null;
      const moves = this.groupMoves(drag, this.hover);
      if (moves.every((m, i) => m.x === drag.from[i]!.x && m.y === drag.from[i]!.y && m.rot === drag.from[i]!.rot)) return null;
      return this.stroke([{ op: 'moveGroup', moves }], false).error;
    }
    if (drag?.kind !== 'move' || !this.hover) return null;
    const x = this.hover.x - drag.grab.x;
    const y = this.hover.y - drag.grab.y;
    if (x === drag.from.x && y === drag.from.y && drag.rot === drag.from.rot) return null;
    return this.stroke([{ op: 'move', id: drag.id, x, y, rot: drag.rot }], false).error;
  }

  /** Shift + click toggles the part; a Shift + drag box adds every part with a cell inside it. */
  private finishBox(start: Cell, end: Cell): void {
    const grid = this.draft.grid;
    const current = this.selection;
    if (sameCell(start, end)) {
      const part = partAt(grid, start.x, start.y);
      if (!part) return;
      this.sel = current.includes(part.id) ? current.filter((id) => id !== part.id) : [...current, part.id];
      return;
    }
    const { min, max } = boxOf(start, end);
    const inside = grid.parts
      .filter((p) => partCells(p).some((c) => c.x >= min.x && c.x <= max.x && c.y >= min.y && c.y <= max.y))
      .map((p) => p.id);
    this.sel = [...current, ...inside.filter((id) => !current.includes(id))];
  }

  /** Double click: the whole connected piece under the cursor. */
  selectPiece(cell: Cell): void {
    if (this.selected || this.drag) return;
    const part = partAt(this.draft.grid, cell.x, cell.y);
    this.sel = part ? connectedPiece(this.draft.grid, part.id) : [];
  }

  /** Ctrl+A: every part. */
  selectAll(): void {
    this.sel = this.draft.grid.parts.map((p) => p.id);
  }

  /** Esc: clears the group selection; false when there was none. */
  clearSelection(): boolean {
    if (this.selection.length === 0) return false;
    this.sel = [];
    return true;
  }

  /** Cancels an unfinished mouse stroke (a move is reverted, painting stays as one step). */
  cancelDrag(): boolean {
    if (!this.drag) return false;
    this.drag = null;
    return true;
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  /** Eyedropper: type, tier, rotation and shape of the part under the cursor. */
  eyedrop(cell: Cell): void {
    const part = partAt(this.draft.grid, cell.x, cell.y);
    if (!part) return;
    this.selected = partKey(part.partId, part.tier, part.variant);
    this.tier = part.tier;
    this.rot = part.rot;
    this.shape = part.shape ?? null;
  }

  /** Delete: removes the selected group (one undo step, the parts go to storage), else the part under the cursor. */
  removeHovered(): void {
    if (this.drag) return;
    const group = this.selection;
    if (group.length > 0) {
      this.stroke(group.map((id) => ({ op: 'remove', id })), false);
      this.sel = [];
      return;
    }
    if (this.hover) this.removeAt(this.hover, false);
  }

  undo(): void {
    if (!this.drag) this.setDraft(undoDraft(this.draft));
  }

  redo(): void {
    if (!this.drag) this.setDraft(redoDraft(this.draft));
  }

  /** Restore the original ship (one undo step). */
  restore(): void {
    this.drag = null;
    this.setDraft(resetDraft(this.draft));
  }

  // -------------------------------------------------------------------------
  // restore to design (M3.8)

  /** Blueprint parts the ship in the dock lost (cached per draft base). */
  private lostParts(): PlacedPart[] {
    const blueprint = this.source.blueprint?.();
    if (!blueprint) return [];
    const base = this.draft.base;
    const c = this.gapCache;
    if (c && c.base === base && c.blueprint === blueprint) return c.missing;
    const missing = missingParts(blueprint, base.grid);
    this.gapCache = { base, blueprint, missing };
    return missing;
  }

  /** Sockets of lost parts the draft has not filled (the same object while nothing changes). */
  private sockets(): Cell[] | null {
    const missing = this.lostParts();
    const grid = this.draft.grid;
    const c = this.socketCache;
    if (c && c.grid === grid && c.missing === missing) return c.cells;
    const taken = new Set<string>();
    for (const p of grid.parts) for (const q of partCells(p)) taken.add(`${q.x},${q.y}`);
    const cells = missing.flatMap((p) => partCells(p)).filter((q) => !taken.has(`${q.x},${q.y}`));
    const out = cells.length > 0 ? cells : null;
    this.socketCache = { grid, missing, cells: out };
    return out;
  }

  restoreInfo(): RestoreInfo {
    const lost = this.lostParts();
    const missing: PartInventory = {};
    for (const p of lost) {
      const key = partKey(p.partId, p.tier, p.variant);
      missing[key] = (missing[key] ?? 0) + 1;
    }
    const damaged = damagedParts(this.draft.base.grid, this.draft.base.hp).length;
    const last = this.draft.undo.at(-1);
    const applied = last?.kind === 'restore' && last !== this.templateStep?.stroke;
    return { missing, missingCount: lost.length, damaged, available: lost.length > 0 || damaged > 0, applied };
  }

  // -------------------------------------------------------------------------
  // build from a template (M4a)

  /**
   * "Build from a template": the draft becomes the template built over the ship in the dock
   * (`templateOps` – matching parts stay or move, the rest comes off, missing parts are placed new and
   * then taken from storage, crafted or bought by the usual rules). One undo step; the price of changes,
   * locks and the check work as for any draft; the commit is the normal one.
   */
  applyTemplate(template: ShipTemplate): TemplatePlan {
    const { grid, hp } = this.draft.base;
    const plan = templateOps(grid, hp, template);
    this.drag = null;
    this.sel = [];
    this.selected = null;
    // the ops replay against the base, so the step replaces whatever the draft held (undo brings it back)
    // (the ship already is the template: back to the ship)
    const draft = plan.ops.length > 0 ? restoreDraft(this.draft, plan.ops) : this.dirty ? resetDraft(this.draft) : this.draft;
    this.setDraft(draft);
    const stroke = draft.undo.at(-1);
    this.templateStep = plan.ops.length > 0 && stroke ? { stroke, name: template.name } : null;
    return plan;
  }

  /** Name of the template the draft shows right now (its loading is the last step), else null. */
  get appliedTemplate(): string | null {
    const step = this.templateStep;
    return step && this.draft.undo.at(-1) === step.stroke ? step.name : null;
  }

  /**
   * Restore to design: the draft becomes the blueprint – lost parts back in their cells (from storage,
   * crafted or bought by the usual rules), damaged ones swapped for new ones. One undo step. Null when
   * there is no blueprint or nothing to do.
   */
  restoreDesign(): (RestorePlan & { skippedRepairs: number }) | null {
    const blueprint = this.source.blueprint?.();
    if (!blueprint) return null;
    const { grid, hp } = this.draft.base;
    // a ship that does not come from the blueprint only gets its damage repaired
    const target = missingParts(blueprint, grid).length > 0 ? blueprint : grid;
    const plan = restoreOps(grid, hp, target);
    if (plan.ops.length === 0) return null;
    this.drag = null;
    const before = this.draft;
    this.setDraft(restoreDraft(before, plan.ops));
    // lost parts come first: when the swaps make the design unaffordable, restore without them
    if (plan.repaired > 0 && plan.missing > 0 && economicallyBlocked(this.view())) {
      const lean = restoreOps(grid, hp, target, { repair: false });
      const draft = restoreDraft(before, lean.ops);
      if (!economicallyBlocked(buildShipyardView(draft, this.source.context(), this.tier))) {
        this.setDraft(draft);
        return { ...lean, skippedRepairs: plan.repaired };
      }
    }
    return { ...plan, skippedRepairs: 0 };
  }

  setAcquire(key: PartKey, mode: AcquireMode | null): void {
    this.setDraft(setAcquire(this.draft, key, mode));
  }

  /** Click on a check message: highlights its parts in the hangar (again = clears). */
  toggleFocus(message: { code: string; severity: 'error' | 'warning'; partIds: readonly number[] }): void {
    const same = this.focus?.code === message.code;
    this.focus = same || message.partIds.length === 0 ? null : { ids: [...message.partIds], tone: message.severity, code: message.code };
  }

  // -------------------------------------------------------------------------
  // synchronisation with the simulation

  /** Discards the draft and starts again over the current ship. */
  discard(): void {
    this.drag = null;
    this.focus = null;
    this.sel = [];
    this.prompt = null;
    this.draft = this.freshDraft();
  }

  /** After a successful confirmation: the new ship is the base, the part selection stays. */
  committed(): void {
    this.pendingCommit = null;
    this.discard();
  }

  private draftHash(): string {
    if (this.baseHash?.base !== this.draft.base) this.baseHash = { base: this.draft.base, hash: draftBaseHash(this.draft) };
    return this.baseHash.hash;
  }

  /** Has the ship or the parts storage changed since the draft was created? */
  isStale(): boolean {
    const { grid, hp } = this.source.ship();
    return shipyardHash(grid, hp, this.source.inventory()) !== this.draftHash();
  }

  /**
   * Called on every render: an outdated draft without edits is silently refreshed; with edits,
   * carrying them over is offered (the "stale" dialog).
   */
  sync(): void {
    if (this.pendingCommit !== null || this.prompt === 'stale' || !this.isStale()) return;
    if (this.dirty) this.prompt = 'stale';
    else this.discard();
  }

  /** Carries the draft over to the current ship; returns the number of operations that could no longer apply. */
  rebase(): number {
    const { grid, hp } = this.source.ship();
    const r = rebaseDraft(this.draft, grid, hp, this.source.inventory());
    this.drag = null;
    this.prompt = null;
    this.focus = null;
    this.sel = [];
    this.draft = r.draft;
    return r.dropped;
  }
}
