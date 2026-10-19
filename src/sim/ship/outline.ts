// Hull outline (SL2 E1 "Hull"; the ship-building 2 design):
// the pure 2D geometry the hull shell, the card / HUD silhouettes and later the shaped parts (E2) are
// built from. Reference implementation: art/blender/mockups/ship2_geo.py (`outline`, `split_edges`,
// `classify`, `Shell._corners`, `nav_points`, `terrace`).
//
// Pure and deterministic like the rest of src/sim/ (no three.js, no DOM), but **nothing in the
// simulation reads it** – it is render / UI data that only lives here so the UI and the renderer share
// one implementation.
//
// Frame: the ship grid frame. Cell (x, y) is centred at the integer point (x, y) and spans ±0.5, so
// every outline vertex lies on the half grid (coordinates × 2 are integers). +x = bow (forward),
// +y = port (left), −y = starboard. Rotation k turns counter-clockwise (types.ts).
//
// Algorithm (SL2 E1 plan, T1): every side of every cell is
// looked at once. A side towards a cell of the same part is dropped (multi-cell parts have no internal
// edges), a side towards another part is a seam, a side towards empty space becomes two half-grid
// outline edges (directed so the solid is on the left – the "edge cancellation" of the mock-up without
// ever building the cancelled pairs). The edges are chained into loops (outer boundaries
// counter-clockwise, holes clockwise), classified, merged into runs, and the corners, seams, hubs, nav
// points and terraces are derived from them. Internally all half-grid coordinates are doubled integers.
//
// Shaped parts (SL2 E2, R1): a cell side
// is no longer all-or-nothing but its solid interval (`sideSolid`, always whole halves). A half side is an
// outline edge where this cell is solid and the neighbour is not, so a half plate's end side cancels
// against its full neighbour exactly like a full side does. Every other polygon edge of a shape (diagonals,
// curve chords, the half plate's open side) is one outline edge of kind `shaped` that never cancels; its
// off-grid vertices (curves) are chained through quantised float keys. Seams run only where both sides of
// a cell side are solid. Parts without a shape never reach any of this (the fast path), so unshaped
// outlines are identical to E1's.
//
// Ordering contract (deterministic, relied on by the shell geometry and the silhouettes):
// - `loops`: outer loops first (largest area first), then holes (largest first); ties by start vertex.
//   `loops[0]` is the main hull's outer boundary.
// - every loop starts at its lowest-x (then lowest-y) run start; runs follow the loop direction;
// - `corners` are listed loop by loop in that loop order: exactly one corner at the start of every run
//   whose direction differs from the previous run's (a kind change on a straight line is no corner;
//   every vertex of a curve is a corner of kind `none`);
// - `seams` sorted by axis (vertical lines first), line, start; `hubs` and terrace cells by x, then y;
//   `terraces` largest first (ties: the lowest owner id);
// - `nav`: bow, port, starboard, then the port and the starboard aft light (each only if present).
import { partDef } from '../../data/parts';
import type { Vec2 } from '../math/vec2';
import { facing, footprintCells, partCells } from './grid';
import { partPolygon, partSize, sideSolid, type Poly, type ShapeDetail } from './shape';
import type { PlacedPart, ShipGrid } from './types';

/**
 * What runs along an outline edge (spec §3.2 step 3):
 * - `raw` – the side of a full cell: band + lip (+ guards / bevels at its corners);
 * - `nozzle` – the rear edge of an engine (against its thrust) and the rear half of its side edges:
 *   nothing at all (no band, no lip, no light);
 * - `muzzle` – the front edge of a cannon, mining laser, heavy laser or tractor beam: band only;
 * - `torn` – the cell across the edge existed before (`OutlineOptions.tornFrom`) and is gone now:
 *   soot strip, no band, no lip, no bevel;
 * - `shaped` (E2) – a polygon edge of a shaped part that is not on a cell side: a diagonal, a curve chord,
 *   the open side of a half plate. Band + lip along the polygon, never bevelled, never cancelled, never
 *   torn. The sides of a shaped part that lie on cell sides are classified like full cells (`raw` /
 *   `torn`).
 */
export type EdgeKind = 'raw' | 'shaped' | 'nozzle' | 'muzzle' | 'torn';

/**
 * One edge of the outline. Solid is on the left of a → b. Every non-`shaped` edge is an axis-aligned
 * half-grid edge of length 0.5; a `shaped` edge is one polygon edge of any length and direction (curve
 * vertices are off the half grid).
 */
export interface OutlineEdge {
  a: Vec2;
  b: Vec2;
  kind: EdgeKind;
  /** Grid part id of the part on the inside of the edge (the shell piece's owner). */
  owner: number;
}

/**
 * Collinear consecutive edges of the same kind merged into one straight run – the shell builds one
 * profile ribbon per run (mitred against the neighbouring runs). A run may span several owners; its
 * `edges` keep the per-edge owners so the geometry can be split per owner part.
 */
export interface OutlineRun {
  edges: OutlineEdge[];
  a: Vec2;
  b: Vec2;
  kind: EdgeKind;
  /** Owner of the run's first edge (convenience; per-edge owners are authoritative). */
  owner: number;
}

/** A closed outline loop: the outer boundary (counter-clockwise) or a hole (clockwise). */
export interface OutlineLoop {
  /** Runs in loop order; run[i].b === run[i + 1].a, the last one closes onto the first. */
  runs: OutlineRun[];
  /** True for the outer boundary of a connected piece, false for a hole. */
  outer: boolean;
  /** Signed area in cells² (positive = outer / counter-clockwise, negative = hole). */
  area: number;
}

/** A corner of the outline (spec §3.3). */
export interface OutlineCorner {
  at: Vec2;
  /** Convex (pointing out of the hull) or concave (notch / hole corner). */
  convex: boolean;
  /** Part id of the cell the corner belongs to. */
  owner: number;
  /**
   * - `bevel` – convex axis corner of a full player armour cell between two `raw` edges: the armour model
   *   is shaved `BEVEL` × `BEVEL` (see `HullOutline.bevels`);
   * - `guard` – convex corner of any other unshaped part (or of clan armour): an L corner guard;
   * - `none` – concave corners, corners touching a nozzle / muzzle / torn / shaped edge and every corner
   *   of a shaped part (golden rule 1: the shape's geometry is the player's – mitre only).
   */
  kind: 'bevel' | 'guard' | 'none';
}

/** One straight internal seam run between two different parts (spec §3.4). */
export interface SeamRun {
  a: Vec2;
  b: Vec2;
  /** The parts on both sides, lower id first. A run is split where either side changes owner. */
  owners: [number, number];
}

/** Nav light position on the lip (spec §3.6), before the 0.075 pull towards the centroid. */
export interface NavPoint {
  at: Vec2;
  /** bow = white, port = red, starboard = green, aft = amber (one per side, so up to two). */
  kind: 'bow' | 'port' | 'starboard' | 'aft';
  /** Part whose lip carries the light. */
  owner: number;
}

/**
 * A terrace – the low inner spine of terrace v2 (plan §2.8): a straight, one cell wide run of
 * ≥ 3 inner full (unshaped) armour cells. At most `TERRACE_MAX_GROUPS` per ship, never touching.
 */
export interface TerraceGroup {
  /** Cell centres of the group (grid frame), x, then y. */
  cells: Vec2[];
  /** Lowest part id in the group (decals, liveries). */
  owner: number;
}

/** Everything the hull shell needs for one grid (+ options). Immutable once returned (memoised). */
export interface HullOutline {
  loops: OutlineLoop[];
  corners: OutlineCorner[];
  seams: SeamRun[];
  /** Corner-connector positions: only where seam runs meet in a T or an L, never on the outline. */
  hubs: Vec2[];
  nav: NavPoint[];
  terraces: TerraceGroup[];
  /**
   * Armour parts to shave: part id → bit mask of its corners in the grid frame
   * (`BEVEL_FP` 1 front-port, `BEVEL_RP` 2 rear-port, `BEVEL_RS` 4 rear-starboard, `BEVEL_FS` 8
   * front-starboard). Multi-cell parts: only their outer corners. Empty when `bevelArmour` is false.
   */
  bevels: Map<number, number>;
}

/** Bevel mask bits (HullOutline.bevels). Front = +x, port = +y. */
export const BEVEL_FP = 1;
export const BEVEL_RP = 2;
export const BEVEL_RS = 4;
export const BEVEL_FS = 8;

/** Leg of the shaved armour corner (spec §3.12 BEVEL; render/hull/shellConstants.ts has the same value). */
export const OUTLINE_BEVEL = 0.25;

/** Nav lights: weight of the distance from the cockpit row in the bow / aft scores (spec §3.6). */
export const NAV_AXIS_WEIGHT = 0.6;
/** Nav lights: the port / starboard light is the frontmost point within this of the extreme y. */
export const NAV_SIDE_TOLERANCE = 0.05;
/** Nav lights: aft lights only on points at least this far from the cockpit row. */
export const NAV_AFT_MIN_SIDE = 0.3;
/** Terraces: smallest group of inner full armour cells that gets a spine (plan §2.8). */
export const TERRACE_MIN_CELLS = 3;
/** Terraces: most spines per ship (bow-axis runs first, longest first, ties: the lowest owner id). */
export const TERRACE_MAX_GROUPS = 2;

export interface OutlineOptions {
  /**
   * Cell keys (`cellKey`) that existed before – an edge whose outside cell is in this set and empty now
   * is `torn`. null = no torn edges (shipyard draft, parked ships, hangar cards).
   */
  tornFrom: ReadonlySet<string> | null;
  /** Player ships shave their armour corners; clan (pirate) ships never do. */
  bevelArmour: boolean;
  /**
   * Curve detail of shaped edges (`CURVE_SEGMENTS_SIM` / `_RENDER` chords); default 'sim'. The shell
   * (ShipView) and the silhouettes use 'render'. Grids without shapes give the same outline either way.
   */
  detail?: ShapeDetail;
}

/** Cell key of the torn-edge sets: the same `"x,y"` format as grid.ts and shipyard/editor.ts. */
export const cellKey = (x: number, y: number): string => `${x},${y}`;

/**
 * The keys of every occupied cell of a grid – the "cells that existed before" for `tornFrom`
 * (ShipView's first build of a pirate / wreck, the player's blueprint).
 */
export function gridCellKeys(grid: ShipGrid): Set<string> {
  const out = new Set<string>();
  for (const p of grid.parts) for (const c of partCells(p)) out.add(cellKey(c.x, c.y));
  return out;
}

// ---------------------------------------------------------------------------------------------------
// internals: doubled integer coordinates on dense arrays over the grid's bounding box
// ---------------------------------------------------------------------------------------------------

/** Direction index → unit vector: 0 +x, 1 +y, 2 −x, 3 −y (counter-clockwise order). */
const DX = [1, 0, -1, 0] as const;
const DY = [0, 1, 0, -1] as const;

const KIND_RAW = 0;
const KIND_NOZZLE = 1;
const KIND_MUZZLE = 2;
const KIND_TORN = 3;
const KIND_SHAPED = 4;
const KIND_NAMES: readonly EdgeKind[] = ['raw', 'nozzle', 'muzzle', 'torn', 'shaped'];

/** Edge direction index of a non-axis edge (diagonals, curve chords); axis edges use 0..3. */
const DIR_FREE = 4;

/** Per-part data the classification needs (doubled centre, facing, roles from the part def). */
interface PartInfo {
  id: number;
  part: PlacedPart;
  isCockpit: boolean;
  cells: Vec2[];
  /** Engine (the def has thrust): nozzle edges at the rear. */
  nozzle: boolean;
  /** Cannon / mining laser / heavy laser / tractor beam (weapon, mining or tractor def): muzzle at the front. */
  muzzle: boolean;
  armor: boolean;
  /** The part has a `shape` field (known or not) – never a terrace, never bevelled. */
  hasShape: boolean;
  /**
   * The part's polygon (grid frame, the requested detail) when it is laid in a known shape and owns all
   * of its cells; null = full cells (no shape – the fast path – or an overlapped draft part).
   */
  poly: Poly | null;
  fx: number;
  fy: number;
  /** Footprint centre × 2. */
  cx2: number;
  cy2: number;
}

function partInfo(part: PlacedPart): PartInfo {
  const def = partDef(part.partId, part.tier, part.variant);
  const f = facing(part.rot);
  const hasShape = part.shape !== undefined;
  const cells = footprintCells(hasShape ? partSize(part) : def.size, part.x, part.y, part.rot);
  const last = cells[cells.length - 1]!; // footprintCells: the lower-left cell first, the upper-right last
  return {
    id: part.id,
    part,
    isCockpit: part.partId === 'cockpit',
    cells,
    nozzle: def.thrust !== undefined,
    muzzle: def.weapon !== undefined || def.mining !== undefined || def.tractor !== undefined,
    armor: part.partId === 'armor',
    hasShape,
    poly: null,
    fx: f.x,
    fy: f.y,
    cx2: part.x + last.x,
    cy2: part.y + last.y,
  };
}

type Interval = readonly [number, number] | null;
const FULL: Interval = [0, 1];
/** Solid side intervals of shaped cells, keyed by shape, rotation, cell offset in the part and side. */
const SIDE_CACHE = new Map<string, Interval>();

/** `sideSolid` of a cell of a part (FULL for a part drawn with full cells), cached per shape placement. */
function sideOf(info: PartInfo, x: number, y: number, side: 0 | 1 | 2 | 3): Interval {
  if (info.poly === null) return FULL;
  const p = info.part;
  const key = `${p.shape}:${p.rot}:${x - p.x}:${y - p.y}:${side}`;
  let v = SIDE_CACHE.get(key);
  if (v === undefined) {
    v = sideSolid(p, { x, y }, side);
    SIDE_CACHE.set(key, v);
  }
  return v;
}

/** Does the interval cover [f0, f0 + ½]? (Solid intervals always start and end on whole halves.) */
const covers = (iv: Interval, f0: number): boolean => iv !== null && iv[0] <= f0 + 1e-6 && iv[1] >= f0 + 0.5 - 1e-6;

/** Tolerance of "two edge directions are the same" (unit vectors). */
const DIR_EPS = 1e-9;
/** Tolerance of "this doubled coordinate is an integer" (half-grid vertices). */
const GRID_EPS = 1e-7;

const EMPTY: HullOutline = Object.freeze({
  loops: [],
  corners: [],
  seams: [],
  hubs: [],
  nav: [],
  terraces: [],
  bevels: new Map<number, number>(),
}) as HullOutline;

interface MemoEntry {
  tornFrom: ReadonlySet<string> | null;
  bevelArmour: boolean;
  detail: ShapeDetail;
  outline: HullOutline;
}

const MEMO = new WeakMap<ShipGrid, MemoEntry[]>();
/** A grid is shown in at most a couple of option sets (flight with a torn set, cards without). */
const MEMO_PER_GRID = 4;

/**
 * The hull outline of a grid (spec §3.2–3.7, 3.11). Memoised per grid object and options (torn set
 * identity, bevel flag, curve detail) – grids are replaced on change, so a WeakMap keyed by the grid is safe. Output
 * order is deterministic (same input → same arrays in the same order, see the file header) and does
 * not depend on the order of `grid.parts`. Works for any grid, also shipyard drafts (disconnected
 * pieces; overlapping parts: the first one in the list owns the cell).
 */
export function hullOutline(grid: ShipGrid, opts: OutlineOptions): HullOutline {
  const detail = opts.detail ?? 'sim';
  let entries = MEMO.get(grid);
  if (entries) {
    for (const e of entries) {
      if (e.tornFrom === opts.tornFrom && e.bevelArmour === opts.bevelArmour && e.detail === detail) return e.outline;
    }
  } else {
    entries = [];
    MEMO.set(grid, entries);
  }
  const outline = computeOutline(grid, opts.tornFrom, opts.bevelArmour, detail);
  if (entries.length >= MEMO_PER_GRID) entries.shift();
  entries.push({ tornFrom: opts.tornFrom, bevelArmour: opts.bevelArmour, detail, outline });
  return outline;
}

/**
 * Index spaces of one computation. Cells live on a grid padded by one cell on every side (so every
 * neighbour of an occupied cell has an index), x-major: `cell = (x − cx0) · ch + (y − cy0)`, so +x is
 * `+ ch` and +y is `+ 1`, and index order is "x, then y". Vertices (doubled coordinates) likewise:
 * `vert = (X − vx0) · vh + (Y − vy0)`.
 */
interface Frame {
  cx0: number;
  cy0: number;
  cw: number;
  ch: number;
  vx0: number;
  vy0: number;
  vw: number;
  vh: number;
}

function computeOutline(
  grid: ShipGrid,
  torn: ReadonlySet<string> | null,
  bevelArmour: boolean,
  detail: ShapeDetail,
): HullOutline {
  if (grid.parts.length === 0) return EMPTY;
  const infos = grid.parts.map(partInfo);

  // --- 0. frame and cell owners ----------------------------------------------------------------------
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let cellCount = 0;
  for (const info of infos) {
    for (const c of info.cells) {
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.y > maxY) maxY = c.y;
      cellCount++;
    }
  }
  const fr: Frame = {
    cx0: minX - 1,
    cy0: minY - 1,
    cw: maxX - minX + 3,
    ch: maxY - minY + 3,
    vx0: 2 * minX - 1,
    vy0: 2 * minY - 1,
    vw: 2 * (maxX - minX) + 3,
    vh: 2 * (maxY - minY) + 3,
  };
  const { ch, vh } = fr;
  const owner = new Int32Array(fr.cw * ch).fill(-1);
  for (let i = 0; i < infos.length; i++) {
    for (const c of infos[i]!.cells) {
      const idx = (c.x - fr.cx0) * ch + (c.y - fr.cy0);
      if (owner[idx]! < 0) owner[idx] = i;
    }
  }

  // shaped parts: the polygon, only when the part owns all its cells (an overlapped draft part is drawn
  // with the full cells it owns, so the outline stays closed)
  let shapedEdges = 0;
  for (let i = 0; i < infos.length; i++) {
    const info = infos[i]!;
    if (!info.hasShape) continue;
    if (!info.cells.every((c) => owner[(c.x - fr.cx0) * ch + (c.y - fr.cy0)] === i)) continue;
    info.poly = partPolygon(info.part, detail);
    if (info.poly) shapedEdges += info.poly.length;
  }

  // vertices: half-grid points are dense indices (doubled coordinates); off-grid points (curve chords)
  // get ids from nV on, through quantised float keys
  const nV = fr.vw * vh;
  const points: (Vec2 | undefined)[] = new Array<Vec2 | undefined>(nV);
  const pt = (X: number, Y: number): Vec2 => {
    const k = (X - fr.vx0) * vh + (Y - fr.vy0);
    return (points[k] ??= { x: X / 2, y: Y / 2 });
  };
  const offPts: Vec2[] = [];
  let offIds: Map<string, number> | null = null;
  const vertexId = (X2: number, Y2: number): number => {
    const rx = Math.round(X2);
    const ry = Math.round(Y2);
    if (Math.abs(X2 - rx) < GRID_EPS && Math.abs(Y2 - ry) < GRID_EPS) return (rx - fr.vx0) * vh + (ry - fr.vy0);
    offIds ??= new Map();
    const key = `${Math.round(X2 * 1e6)},${Math.round(Y2 * 1e6)}`;
    let id = offIds.get(key);
    if (id === undefined) {
      id = nV + offPts.length;
      offIds.set(key, id);
      offPts.push({ x: X2 / 2, y: Y2 / 2 });
    }
    return id;
  };
  const vertex = (id: number): Vec2 => {
    if (id >= nV) return offPts[id - nV]!;
    const gx = Math.floor(id / vh);
    return pt(gx + fr.vx0, id - gx * vh + fr.vy0);
  };

  // --- 1. outline edges (x-major cell order) ---------------------------------------------------------------
  const cap = cellCount * 8 + shapedEdges;
  const eX = new Float64Array(cap); // start, doubled
  const eY = new Float64Array(cap);
  const eX2 = new Float64Array(cap); // end, doubled
  const eY2 = new Float64Array(cap);
  const eA = new Int32Array(cap); // start / end vertex ids
  const eB = new Int32Array(cap);
  const eDir = new Uint8Array(cap); // 0..3 axis direction, DIR_FREE otherwise
  const eUx = new Float64Array(cap); // unit direction
  const eUy = new Float64Array(cap);
  const ePart = new Int32Array(cap);
  const eKind = new Uint8Array(cap);
  let nE = 0;
  const pushAxis = (sx: number, sy: number, d: number, i: number, kind: number): void => {
    const dx = DX[d]!;
    const dy = DY[d]!;
    eX[nE] = sx;
    eY[nE] = sy;
    eX2[nE] = sx + dx;
    eY2[nE] = sy + dy;
    const a = (sx - fr.vx0) * vh + (sy - fr.vy0);
    eA[nE] = a;
    eB[nE] = a + dx * vh + dy;
    eDir[nE] = d;
    eUx[nE] = dx;
    eUy[nE] = dy;
    ePart[nE] = i;
    eKind[nE] = kind;
    nE++;
  };
  /** The polygon edges of a shaped part that do not lie on a cell side, as `shaped` edges. */
  const pushShaped = (poly: Poly, i: number): void => {
    for (let j = 0; j < poly.length; j++) {
      const p = poly[j]!;
      const q = poly[(j + 1) % poly.length]!;
      const ax = p.x * 2;
      const ay = p.y * 2;
      const bx = q.x * 2;
      const by = q.y * 2;
      const dx = bx - ax;
      const dy = by - ay;
      const vertical = Math.abs(dx) < GRID_EPS;
      const horizontal = Math.abs(dy) < GRID_EPS;
      if (vertical || horizontal) {
        // on a cell side line (doubled coordinate odd): handled per cell side through `sideSolid`
        const line = vertical ? ax : ay;
        const r = Math.round(line);
        if (Math.abs(line - r) < GRID_EPS && (r & 1) === 1) continue;
      }
      const a = vertexId(ax, ay);
      const b = vertexId(bx, by);
      const pa = vertex(a);
      const pb = vertex(b);
      eX[nE] = pa.x * 2;
      eY[nE] = pa.y * 2;
      eX2[nE] = pb.x * 2;
      eY2[nE] = pb.y * 2;
      eA[nE] = a;
      eB[nE] = b;
      const len = Math.hypot(dx, dy);
      eUx[nE] = horizontal ? Math.sign(dx) : dx / len;
      eUy[nE] = vertical ? Math.sign(dy) : dy / len;
      eDir[nE] = horizontal ? (dx > 0 ? 0 : 2) : vertical ? (dy > 0 ? 1 : 3) : DIR_FREE;
      ePart[nE] = i;
      eKind[nE] = KIND_SHAPED;
      nE++;
    }
  };

  for (let gx = 1; gx < fr.cw - 1; gx++) {
    for (let gy = 1; gy < ch - 1; gy++) {
      const idx = gx * ch + gy;
      const i = owner[idx]!;
      if (i < 0) continue;
      const info = infos[i]!;
      const x = gx + fr.cx0;
      const y = gy + fr.cy0;
      const shaped = info.poly !== null;
      if (shaped && info.cells[0]!.x === x && info.cells[0]!.y === y) pushShaped(info.poly!, i);
      for (let d = 0; d < 4; d++) {
        const dx = DX[d]!;
        const dy = DY[d]!;
        const nx = dy; // outward normal = direction turned clockwise
        const ny = -dx;
        const j = owner[idx + nx * ch + ny]!;
        if (j === i) continue; // same part: no edge
        // halves of the side (along d) that are outline: solid here, not solid across
        let halves = 3;
        if (j >= 0) {
          const other = infos[j]!;
          if (!shaped && other.poly === null) continue; // two full cells: a seam
          const side = ((d + 3) % 4) as 0 | 1 | 2 | 3;
          const mine = sideOf(info, x, y, side);
          const theirs = sideOf(other, x + nx, y + ny, ((side + 2) % 4) as 0 | 1 | 2 | 3);
          halves = 0;
          // side fractions run along +x / +y: along d for d = 0, 1, against it for d = 2, 3
          for (let h = 0; h < 2; h++) {
            const f0 = d < 2 ? h * 0.5 : 0.5 - h * 0.5;
            if (covers(mine, f0) && !covers(theirs, f0)) halves |= 1 << h;
          }
        } else if (shaped) {
          const mine = sideOf(info, x, y, ((d + 3) % 4) as 0 | 1 | 2 | 3);
          halves = 0;
          for (let h = 0; h < 2; h++) if (covers(mine, d < 2 ? h * 0.5 : 0.5 - h * 0.5)) halves |= 1 << h;
        }
        if (halves === 0) continue;
        // outline side: two half-edges from the corner (centre + n − d) along d
        const x0 = 2 * x + nx - dx;
        const y0 = 2 * y + ny - dy;
        let sideKind = -1;
        if (j < 0 && torn !== null && torn.has(cellKey(x + nx, y + ny))) sideKind = KIND_TORN;
        else if (info.nozzle && nx === -info.fx && ny === -info.fy) sideKind = KIND_NOZZLE;
        else if (info.muzzle && nx === info.fx && ny === info.fy) sideKind = KIND_MUZZLE;
        for (let h = 0; h < 2; h++) {
          if ((halves & (1 << h)) === 0) continue;
          const sx = x0 + dx * h;
          const sy = y0 + dy * h;
          let kind = sideKind;
          if (kind < 0) {
            kind = KIND_RAW;
            // rear half of an engine's side edge: the bell sits there (midpoint behind the part centre)
            if (info.nozzle && (sx + dx * 0.5 - info.cx2) * info.fx + (sy + dy * 0.5 - info.cy2) * info.fy < -0.02) {
              kind = KIND_NOZZLE;
            }
          }
          pushAxis(sx, sy, d, i, kind);
        }
      }
    }
  }

  /** Same direction (collinear, not opposite) – the run-merge test. */
  const sameDir = (p: number, e: number): boolean => {
    const dp = eDir[p]!;
    if (dp !== eDir[e]) return false;
    if (dp !== DIR_FREE) return true;
    return Math.abs(eUx[p]! * eUy[e]! - eUy[p]! * eUx[e]!) <= DIR_EPS && eUx[p]! * eUx[e]! + eUy[p]! * eUy[e]! > 0;
  };

  // --- 2. chain the edges into loops -----------------------------------------------------------------
  const nVert = nV + offPts.length;
  const head = new Int32Array(nVert).fill(-1); // outgoing edges per vertex: a linked list
  const nextOut = new Int32Array(nE);
  for (let e = nE - 1; e >= 0; e--) {
    const k = eA[e]!;
    nextOut[e] = head[k]!;
    head[k] = e;
  }
  const used = new Uint8Array(nE);
  const rawLoops: number[][] = [];
  for (let e0 = 0; e0 < nE; e0++) {
    if (used[e0]) continue;
    const loop: number[] = [];
    let cur = e0;
    while (cur >= 0 && !used[cur]) {
      used[cur] = 1;
      loop.push(cur);
      let next = -1;
      let nextAngle = Infinity;
      let count = 0;
      for (let c = head[eB[cur]!]!; c >= 0; c = nextOut[c]!) {
        if (used[c]) continue;
        count++;
        if (count === 1) {
          next = c;
          continue;
        }
        // pinch vertex: take the sharpest left turn, which keeps going round the same solid sector –
        // every loop stays a simple polygon (two pieces touching at a point get two loops, each with
        // its own corner): the smallest clockwise angle from the way back to the candidate
        if (count === 2) nextAngle = cwFromBack(eUx[cur]!, eUy[cur]!, eUx[next]!, eUy[next]!);
        const ang = cwFromBack(eUx[cur]!, eUy[cur]!, eUx[c]!, eUy[c]!);
        if (ang < nextAngle) {
          next = c;
          nextAngle = ang;
        }
      }
      cur = next;
    }
    rawLoops.push(loop);
  }

  // --- 3. canonical start, area, order -------------------------------------------------------------------
  interface LoopWork {
    edges: number[];
    area: number;
    sx: number;
    sy: number;
  }
  const work: LoopWork[] = [];
  for (const loop of rawLoops) {
    const n = loop.length;
    let best = -1;
    let twiceArea = 0;
    for (let j = 0; j < n; j++) {
      const e = loop[j]!;
      const p = loop[(j + n - 1) % n]!;
      const ax = eX[e]!;
      const ay = eY[e]!;
      twiceArea += ax * eY2[e]! - eX2[e]! * ay;
      if (sameDir(p, e) && eKind[p] === eKind[e]) continue; // not a run start
      if (best < 0) best = j;
      else {
        const b = loop[best]!;
        if (ax < eX[b]! || (ax === eX[b]! && ay < eY[b]!)) best = j;
      }
    }
    if (best < 0) best = 0; // cannot happen for a closed loop of cell sides
    const edges = best === 0 ? loop : loop.slice(best).concat(loop.slice(0, best));
    const s = edges[0]!;
    work.push({ edges, area: twiceArea / 8, sx: eX[s]!, sy: eY[s]! });
  }
  work.sort((a, b) => {
    const ao = a.area > 0 ? 0 : 1;
    const bo = b.area > 0 ? 0 : 1;
    if (ao !== bo) return ao - bo;
    const da = Math.abs(b.area) - Math.abs(a.area);
    if (da !== 0) return da;
    return a.sx - b.sx || a.sy - b.sy;
  });

  // --- 4. runs, corners, bevels, nav candidates ----------------------------------------------------------
  const loops: OutlineLoop[] = [];
  const corners: OutlineCorner[] = [];
  const bevels = new Map<number, number>();
  const onOutline = new Uint8Array(nV);
  // nav candidates of the main outer loop (loops[0]): doubled coordinates, owners
  const navX: number[] = [];
  const navY: number[] = [];
  const navOwner: number[] = [];
  const leg = OUTLINE_BEVEL * 2;

  for (let li = 0; li < work.length; li++) {
    const w = work[li]!;
    const runs: OutlineRun[] = [];
    let run: OutlineRun | null = null;
    let prevE = -1;
    for (const e of w.edges) {
      const k = eKind[e]!;
      if (eA[e]! < nV) onOutline[eA[e]!] = 1;
      const edge: OutlineEdge = {
        a: vertex(eA[e]!),
        b: vertex(eB[e]!),
        kind: KIND_NAMES[k]!,
        owner: infos[ePart[e]!]!.id,
      };
      if (run !== null && sameDir(prevE, e) && k === eKind[prevE]) {
        run.edges.push(edge);
        run.b = edge.b;
      } else {
        run = { edges: [edge], a: edge.a, b: edge.b, kind: edge.kind, owner: edge.owner };
        runs.push(run);
      }
      prevE = e;
    }
    loops.push({ runs, outer: w.area > 0, area: w.area });

    // corners: at the start of every run that turns against the previous one
    const isMain = li === 0 && w.area > 0;
    const nEdges = w.edges.length;
    for (let j = 0; j < nEdges; j++) {
      const e = w.edges[j]!;
      const p = w.edges[(j + nEdges - 1) % nEdges]!;
      const vx = eX[e]!;
      const vy = eY[e]!;
      const rawIn = eKind[p] === KIND_RAW;
      const rawOut = eKind[e] === KIND_RAW;
      let bevelled = false;
      if (!sameDir(p, e)) {
        const convex = eUx[p]! * eUy[e]! - eUy[p]! * eUx[e]! > 0;
        const info = infos[ePart[p]!]!;
        let kind: OutlineCorner['kind'] = 'none';
        // a convex corner between two raw (axis) edges is a cell corner, so ePart[e] === ePart[p] here;
        // shaped parts keep their own geometry (no bevel, no guard)
        if (convex && rawIn && rawOut && ePart[e] === ePart[p] && !info.hasShape) {
          if (info.armor && bevelArmour) {
            kind = 'bevel';
            bevelled = true;
            const front = vx > info.cx2;
            const port = vy > info.cy2;
            const bit = front ? (port ? BEVEL_FP : BEVEL_FS) : port ? BEVEL_RP : BEVEL_RS;
            bevels.set(info.id, (bevels.get(info.id) ?? 0) | bit);
          } else kind = 'guard';
        }
        corners.push({ at: vertex(eA[e]!), convex, owner: info.id, kind });
      }
      const lipIn = rawIn || eKind[p] === KIND_SHAPED;
      const lipOut = rawOut || eKind[e] === KIND_SHAPED;
      if (isMain && (lipIn || lipOut)) {
        if (bevelled) {
          // the shaved corner: the lip runs over the cut, so the light candidates are its two ends
          const id = infos[ePart[e]!]!.id;
          navX.push(vx - eUx[p]! * leg, vx + eUx[e]! * leg);
          navY.push(vy - eUy[p]! * leg, vy + eUy[e]! * leg);
          navOwner.push(id, id);
        } else {
          navX.push(vx);
          navY.push(vy);
          navOwner.push(infos[ePart[lipOut ? e : p]!]!.id);
        }
      }
    }
  }

  // --- 5. seams and hubs ------------------------------------------------------------------------------
  // A seam piece is a cell side (or, next to a shaped part, a half side) solid on both sides.
  const seams: SeamRun[] = [];
  const seamDeg = new Uint8Array(nV); // horizontal seam pieces at a vertex + 4 × vertical ones
  for (let axis = 0; axis < 2; axis++) {
    // axis 0: vertical lines x = gx + ½ (scan x-major), axis 1: horizontal lines y = gy + ½ (y-major)
    const outerN = axis === 0 ? fr.cw : ch;
    const innerN = axis === 0 ? ch : fr.cw;
    const outerStep = axis === 0 ? ch : 1;
    const innerStep = axis === 0 ? 1 : ch;
    const across = axis === 0 ? ch : 1; // the neighbour on the other side of the line
    const line0 = axis === 0 ? fr.cx0 : fr.cy0;
    const along0 = axis === 0 ? fr.cy0 : fr.cx0;
    const inc = axis === 0 ? 4 : 1;
    for (let o = 1; o < outerN - 2; o++) {
      const line = 2 * (o + line0) + 1;
      let openFrom = 0;
      let openTo = Number.NaN;
      let openLo = -1;
      let openHi = -1;
      const piece = (from: number, to: number, lo: number, hi: number): void => {
        const k0 = axis === 0 ? (line - fr.vx0) * vh + (from - fr.vy0) : (from - fr.vx0) * vh + (line - fr.vy0);
        const k1 = axis === 0 ? k0 + (to - from) : k0 + (to - from) * vh;
        seamDeg[k0] = seamDeg[k0]! + inc;
        seamDeg[k1] = seamDeg[k1]! + inc;
        if (from === openTo && lo === openLo && hi === openHi) {
          openTo = to;
          return;
        }
        if (openLo >= 0) seams.push(seamRun(axis, line, openFrom, openTo, openLo, openHi, pt));
        openFrom = from;
        openTo = to;
        openLo = lo;
        openHi = hi;
      };
      for (let q = 1; q < innerN - 1; q++) {
        const idx = o * outerStep + q * innerStep;
        const a = owner[idx]!;
        const b = owner[idx + across]!;
        if (a < 0 || b < 0 || a === b) continue;
        const ia = infos[a]!;
        const ib = infos[b]!;
        const lo = ia.id < ib.id ? ia.id : ib.id;
        const hi = ia.id < ib.id ? ib.id : ia.id;
        const from = 2 * (q + along0) - 1;
        if (ia.poly === null && ib.poly === null) {
          piece(from, from + 2, lo, hi);
          continue;
        }
        // cell a below / left of the line, b across it; side fractions run along the line
        const ax = axis === 0 ? o + fr.cx0 : q + fr.cx0;
        const ay = axis === 0 ? q + fr.cy0 : o + fr.cy0;
        const sa = sideOf(ia, ax, ay, axis === 0 ? 0 : 1);
        const sb = sideOf(ib, ax + (axis === 0 ? 1 : 0), ay + (axis === 0 ? 0 : 1), axis === 0 ? 2 : 3);
        for (let h = 0; h < 2; h++) {
          if (covers(sa, h * 0.5) && covers(sb, h * 0.5)) piece(from + h, from + h + 1, lo, hi);
        }
      }
      if (openLo >= 0) seams.push(seamRun(axis, line, openFrom, openTo, openLo, openHi, pt));
    }
  }

  const hubs: Vec2[] = [];
  for (let k = 0; k < nV; k++) {
    const deg = seamDeg[k]!;
    if (deg === 0) continue;
    const h = deg & 3;
    const v = deg >> 2;
    // T (one direction passes, the other ends) or L (both end); a + crossing and straight runs get none
    if (h >= 1 && v >= 1 && !(h === 2 && v === 2) && !onOutline[k]) {
      const gx = Math.floor(k / vh);
      hubs.push(pt(gx + fr.vx0, k - gx * vh + fr.vy0));
    }
  }

  // --- 6. nav lights and terraces ------------------------------------------------------------------------
  const nav = navPoints(navX, navY, navOwner, infos);
  const terraces = terraceGroups(infos, owner, fr);

  return { loops, corners, seams, hubs, nav, terraces, bevels };
}

/**
 * Clockwise angle in (0, 2π] from the way back along the incoming direction (−in) to the outgoing
 * direction `out` (unit vectors) – the smallest one is the sharpest left turn.
 */
function cwFromBack(inX: number, inY: number, outX: number, outY: number): number {
  const bx = -inX;
  const by = -inY;
  const ccw = Math.atan2(bx * outY - by * outX, bx * outX + by * outY); // (−π, π]
  const cw = -ccw;
  return cw <= 1e-12 ? cw + 2 * Math.PI : cw;
}

function seamRun(
  axis: number,
  line: number,
  from: number,
  to: number,
  lo: number,
  hi: number,
  pt: (X: number, Y: number) => Vec2,
): SeamRun {
  return axis === 0
    ? { a: pt(line, from), b: pt(line, to), owners: [lo, hi] }
    : { a: pt(from, line), b: pt(to, line), owners: [lo, hi] };
}

/**
 * Nav light positions (spec §3.6) from the lipped points of the main outer loop (doubled coordinates).
 * yAxis = the cockpit row (no cockpit: the mean of the candidates), x "centroid" = the mean candidate x
 * (as the mock-up's `nav_points`).
 */
function navPoints(xs2: number[], ys2: number[], owners: number[], infos: PartInfo[]): NavPoint[] {
  const n = xs2.length;
  if (n === 0) return [];
  const xs = xs2.map((v) => v / 2);
  const ys = ys2.map((v) => v / 2);
  let meanX = 0;
  let meanY = 0;
  for (let i = 0; i < n; i++) {
    meanX += xs[i]!;
    meanY += ys[i]!;
  }
  meanX /= n;
  meanY /= n;
  const cockpit = infos.find((p) => p.isCockpit);
  const yAxis = cockpit ? cockpit.cy2 / 2 : meanY;
  const EPS = 1e-9;
  const score = (i: number): number => xs[i]! - NAV_AXIS_WEIGHT * Math.abs(ys[i]! - yAxis);
  const out: NavPoint[] = [];
  const at = (i: number): Vec2 => ({ x: xs[i]!, y: ys[i]! });

  // bow: the frontmost point weighted towards the cockpit row; ties → nearer the row, then port
  let bow = 0;
  for (let i = 1; i < n; i++) {
    const ds = score(i) - score(bow);
    if (ds > EPS) bow = i;
    else if (ds > -EPS) {
      const dd = Math.abs(ys[i]! - yAxis) - Math.abs(ys[bow]! - yAxis);
      if (dd < -EPS || (dd < EPS && ys[i]! > ys[bow]!)) bow = i;
    }
  }
  out.push({ at: at(bow), kind: 'bow', owner: owners[bow]! });

  // port / starboard: the frontmost of the outermost points (ties → the more outward one)
  for (const s of [1, -1] as const) {
    let edge = -Infinity;
    for (let i = 0; i < n; i++) edge = Math.max(edge, s * ys[i]!);
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (s * ys[i]! < edge - NAV_SIDE_TOLERANCE) continue;
      if (best < 0 || xs[i]! > xs[best]! + EPS || (xs[i]! > xs[best]! - EPS && s * ys[i]! > s * ys[best]!)) best = i;
    }
    out.push({ at: at(best), kind: s > 0 ? 'port' : 'starboard', owner: owners[best]! });
  }

  // aft: per side, behind the centre, the rear side corner (min score; ties → further aft, then outward)
  for (const s of [1, -1] as const) {
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (s * (ys[i]! - yAxis) <= NAV_AFT_MIN_SIDE || xs[i]! >= meanX) continue;
      if (best < 0) {
        best = i;
        continue;
      }
      const ds = score(i) - score(best);
      if (ds < -EPS || (ds < EPS && (xs[i]! < xs[best]! - EPS || (xs[i]! < xs[best]! + EPS && s * ys[i]! > s * ys[best]!)))) {
        best = i;
      }
    }
    if (best >= 0) out.push({ at: at(best), kind: 'aft', owner: owners[best]! });
  }
  return out;
}

/**
 * Terraces (terrace v2, plan §2.8 rules 1–2, narrowed in R5 review): **inner** full (unshaped)
 * armour cells – all four edge neighbours occupied, each with a fully solid side towards the cell (so no
 * edge of the cell is on the outline) – minus the cell in front of every muzzle and behind every nozzle.
 * A spine is a straight, one cell wide run of such cells (≥ TERRACE_MIN_CELLS): runs along the bow axis
 * first, then across it, each longest first (ties: the lowest owner id). A run is taken only when it
 * neither shares nor touches a cell of a spine already taken – spines never merge into a carpet; at most
 * TERRACE_MAX_GROUPS. Listed in that order; cells x, then y.
 */
function terraceGroups(infos: PartInfo[], owner: Int32Array, fr: Frame): TerraceGroup[] {
  const { ch } = fr;
  const n = owner.length;
  const banned = new Uint8Array(n);
  for (let i = 0; i < infos.length; i++) {
    const info = infos[i]!;
    if (!info.nozzle && !info.muzzle) continue;
    const s = info.muzzle ? 1 : -1; // muzzle: the cell in front; nozzle: the cell behind
    for (const c of info.cells) {
      const k = (c.x + s * info.fx - fr.cx0) * ch + (c.y + s * info.fy - fr.cy0);
      if (owner[k] !== i) banned[k] = 1;
    }
  }
  /** Every neighbour occupied, its side towards the cell fully solid (padding: neighbours are in range). */
  const inner = (k: number): boolean => {
    const gx = Math.floor(k / ch);
    const x = gx + fr.cx0;
    const y = k - gx * ch + fr.cy0;
    for (let s = 0; s < 4; s++) {
      const j = owner[k + DX[s]! * ch + DY[s]!]!;
      if (j < 0) return false;
      const iv = sideOf(infos[j]!, x + DX[s]!, y + DY[s]!, ((s + 2) % 4) as 0 | 1 | 2 | 3);
      if (iv === null || iv[0] > 1e-6 || iv[1] < 1 - 1e-6) return false;
    }
    return true;
  };
  const candidate = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const o = owner[k]!;
    if (o >= 0 && infos[o]!.armor && !infos[o]!.hasShape && !banned[k] && inner(k)) candidate[k] = 1;
  }
  // straight runs of candidates: along the bow axis (step ch = +x) first, then across it (step 1 = +y)
  interface Run {
    cells: number[];
    axis: 0 | 1;
    owner: number;
  }
  const runs: Run[] = [];
  for (const [axis, step] of [[0, ch], [1, 1]] as const) {
    for (let k0 = 0; k0 < n; k0++) {
      if (!candidate[k0] || candidate[k0 - step]) continue; // start of a maximal run
      const cells: number[] = [];
      for (let k = k0; candidate[k]; k += step) cells.push(k);
      if (cells.length < TERRACE_MIN_CELLS) continue;
      let id = Infinity;
      for (const k of cells) id = Math.min(id, infos[owner[k]!]!.id);
      runs.push({ cells, axis, owner: id });
    }
  }
  runs.sort((a, b) => a.axis - b.axis || b.cells.length - a.cells.length || a.owner - b.owner);
  // greedy: a run joins only if it neither shares nor touches (4-neighbours) a cell of a taken spine
  const taken = new Uint8Array(n);
  const groups: TerraceGroup[] = [];
  for (const run of runs) {
    if (groups.length >= TERRACE_MAX_GROUPS) break;
    if (run.cells.some((k) => taken[k] || taken[k + ch] || taken[k - ch] || taken[k + 1] || taken[k - 1])) continue;
    for (const k of run.cells) taken[k] = 1;
    const out: Vec2[] = [];
    for (const k of run.cells) {
      const gx = Math.floor(k / ch);
      out.push({ x: gx + fr.cx0, y: k - gx * ch + fr.cy0 });
    }
    groups.push({ cells: out, owner: run.owner });
  }
  return groups;
}

const fmt = (v: number): string => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

/**
 * The outer loops and holes of a grid as one SVG path (`fill-rule: evenodd`) in grid units – the card
 * and HUD silhouettes (T10). Uses the grid frame unchanged (+x bow, +y port): the caller flips / scales
 * it to its own view box. Armour corners are cut by 0.25 (spec §3.3) when `bevelArmour` (player
 * ships – the default; pass false for clan ships); no torn edges. Empty grid → ''.
 * One `M … Z` subpath per loop, in `HullOutline.loops` order, only at direction changes. Shaped parts
 * follow their polygons (curves at `detail`, default 'render').
 */
export function outlineSvgPath(grid: ShipGrid, bevelArmour = true, detail: ShapeDetail = 'render'): string {
  const o = hullOutline(grid, { tornFrom: null, bevelArmour, detail });
  let out = '';
  let ci = 0;
  for (const loop of o.loops) {
    const runs = loop.runs;
    const pts: string[] = [];
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i]!;
      const p = runs[(i + runs.length - 1) % runs.length]!;
      const rl = Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y);
      const pl = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y);
      const dx = (r.b.x - r.a.x) / rl;
      const dy = (r.b.y - r.a.y) / rl;
      const px = (p.b.x - p.a.x) / pl;
      const py = (p.b.y - p.a.y) / pl;
      if (Math.abs(px * dy - py * dx) <= DIR_EPS && px * dx + py * dy > 0) continue; // kind change on a straight line
      const corner = o.corners[ci++]!;
      if (corner.kind === 'bevel') {
        pts.push(`${fmt(r.a.x - px * OUTLINE_BEVEL)} ${fmt(r.a.y - py * OUTLINE_BEVEL)}`);
        pts.push(`${fmt(r.a.x + dx * OUTLINE_BEVEL)} ${fmt(r.a.y + dy * OUTLINE_BEVEL)}`);
      } else pts.push(`${fmt(r.a.x)} ${fmt(r.a.y)}`);
    }
    if (pts.length === 0) continue;
    if (out) out += ' ';
    out += `M${pts.join('L')}Z`;
  }
  return out;
}
