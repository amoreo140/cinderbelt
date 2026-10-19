// Pure helpers of the trophy replicas (M4c plan §2.3, T5): a captain's ship as a small display model
// on a trophy hall pedestal. On a pedestal a ship is ~1.3 units long – 35–80 px in the hub – so the
// full part models (15–35k triangles) would only add noise; even simplified they read as scattered
// debris. A replica is built like a desk model instead: the ship's cells (one-cell notches filled,
// convex corners cut) stepped into thin wings, a body over the rows around its axis (the cockpit's
// row) and a ridge in the clan's accent on the axis, every tier with chamfered edges in that accent;
// and only the key parts as simple solids – the cockpit canopy, engine nozzles with glowing exhaust
// cones, gun barrels with glowing muzzles, shield domes. Everything is flat shaded on the shared
// palette atlas (UVs at swatch centres), so a replica is one mesh on the parts' material. The model
// stands on a thin post, nose slightly up.
import { ShapeUtils, Vector2 } from 'three';
import type { FactionId } from '../../data/factions';
import { TROPHY_FIT } from '../../data/home';
import type { PartId } from '../../data/parts';
import type { Vec2 } from '../../sim/math/vec2';
import { facing, partCells, partCenter } from '../../sim/ship/grid';
import { cellKey, gridCellKeys } from '../../sim/ship/outline';
import { partSize } from '../../sim/ship/shape';
import type { PlacedPart, ShipGrid } from '../../sim/ship/types';
import { cellSetLoops, shellStyle, type ShellTier, type SwatchLookup } from '../hull/shellGeometry';

/** An indexed triangle mesh as plain arrays (xyz positions, xyz normals, uv). */
export interface MeshSoup {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/** Triangle budget of one captain replica: six of them plus the fortress stay under the 20k shelf budget. */
export const REPLICA_TRIANGLES = 2800;
/**
 * Diameter of a replica's turn circle (= its footprint's diagonal) – the pedestal's hard limit
 * (TROPHY_FIT.maxExtent); the ship itself is then ~1.2–1.4 units long.
 */
export const REPLICA_EXTENT = TROPHY_FIT.maxExtent;
/** Gap between the pedestal top and the replica's lowest point (the display post's height). */
export const REPLICA_LIFT = 0.3;
/** Nose-up pitch of the display model (rad). */
export const REPLICA_PITCH = 0.17;
/** Radius of the display post (pedestal units). */
export const POST_RADIUS = 0.035;
/** Slow turn of the replicas (rad/s) and the phase step between neighbouring pedestals. */
export const TROPHY_SPIN = 0.22;
const PEDESTAL_PHASE = 1.9;
/** Yaw of a still replica (reduced motion): bow turned from the camera (+X) to a three-quarter view. */
export const STILL_YAW = 0.7;

/** One stepped tier of the display model (ship units; y = 0 is the hull's mid plane). */
interface TierShape {
  /** Bottom of its sides, top of its sides (where the chamfer starts) and its deck. */
  bottom: number;
  edge: number;
  deck: number;
  /** How far the chamfer reaches in, how far the tier starts inside its cells, the corner cut. */
  chamfer: number;
  inset: number;
  cut: number;
}

// The model is stepped like a desk model: thin wings over every hull cell, a body over the three rows
// around the ship's axis (the cockpit's row), and a ridge on the axis itself – fuselage and wings read
// as a ship where one flat slab of a nearly square pirate hull would not.
/** Every hull cell: thin wings. */
export const WING: TierShape = { bottom: -0.14, edge: 0, deck: 0.08, chamfer: 0.1, inset: 0, cut: 0.32 };
/** The rows within BODY_ROWS of the axis. */
export const BODY: TierShape = { bottom: 0.04, edge: 0.26, deck: 0.36, chamfer: 0.1, inset: 0.08, cut: 0.26 };
/** The axis row (where the body is three rows wide). */
export const RIDGE: TierShape = { bottom: 0.34, edge: 0.5, deck: 0.6, chamfer: 0.08, inset: 0.15, cut: 0.2 };
/** Rows on either side of the axis that belong to the body. */
const BODY_ROWS = 1;
/** Passes of the notch filling (hullCells). */
const NOTCH_PASSES = 2;
/** Sides of the round solids (nozzles, turrets, reactors). */
const ROUND_SIDES = 8;
/** Length of an engine's glowing exhaust cone behind its nozzle. */
const EXHAUST_LENGTH = 0.6;

type Uv = readonly [number, number];
type V3 = [number, number, number];

/** Swatch UVs of one replica's roles. */
export interface ReplicaSwatches {
  /** Tier sides; the wing deck. */
  core: Uv;
  /** Decks. */
  plate: Uv;
  /** Chamfers along the deck edges (the clan accent). */
  trim: Uv;
  /** Barrels, nozzles, turret rings, the display post. */
  metal: Uv;
  glass: Uv;
  /** Engine nozzle ends (emissive). */
  glow: Uv;
  /** Gun muzzles (emissive). */
  weapon: Uv;
  /** Shield domes (emissive). */
  shield: Uv;
}

/** Swatch keys of a replica's roles (all but the shared weapon / shield glows). */
type RoleKeys = Record<'core' | 'plate' | 'trim' | 'metal' | 'glass' | 'glow', string>;

/**
 * Clan replicas (art/README §3.1 swatches). A display model is a step lighter than the clan's hull
 * shell – the decks of the dark pirate hulls on the shelf would otherwise melt into one dark blob –
 * so the deck takes the clan's lighter plate, the trim and ridge its bright accent, and the canopy
 * the clan glow (lit bridge windows; the clan glass is nearly black at this size).
 */
const CLAN_ROLES: Partial<Record<FactionId, RoleKeys>> = {
  rust: { core: 'pir_gunmetal_dark', plate: 'pir_gunmetal', trim: 'pir_rust', metal: 'pir_gunmetal_dark', glass: 'pir_glow_red', glow: 'pir_glow_red' },
  slantedStar: { core: 'sst_lacquer', plate: 'sst_graphite', trim: 'sst_gold', metal: 'sst_lacquer', glass: 'sst_glow', glow: 'sst_glow' },
  cauldron: { core: 'kot_iron_dark', plate: 'kot_iron', trim: 'kot_paint', metal: 'kot_iron_dark', glass: 'kot_furnace', glow: 'kot_furnace' },
};

/**
 * The swatches of a replica: the clan's roles (CLAN_ROLES), or for player parts (and clans without a
 * table) the hull shell's tier style (`shellStyle`) with a dark metal, blue glass and the engine glow.
 * Null while the swatch table is not loaded; unknown keys fall back to the core swatch.
 */
export function replicaSwatches(clan: FactionId | null, tier: ShellTier, swatchUv: SwatchLookup): ReplicaSwatches | null {
  const style = shellStyle(tier, null);
  const keys: RoleKeys = (clan ? CLAN_ROLES[clan] : undefined) ?? { core: style.core, plate: style.plate, trim: style.stripe, metal: 'trim_black', glass: 'glass_cockpit', glow: 'engine_glow' };
  const core = swatchUv(keys.core);
  if (!core) return null;
  const sw = (key: string): Uv => swatchUv(key) ?? core;
  return {
    core,
    plate: sw(keys.plate),
    trim: sw(keys.trim),
    metal: sw(keys.metal),
    glass: sw(keys.glass),
    glow: sw(keys.glow),
    weapon: sw('cannon_glow'),
    shield: sw('shield_glow'),
  };
}

/** Growing arrays of a flat-shaded soup. */
class SoupBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  readonly indices: number[] = [];

  /**
   * A planar convex polygon in one swatch, fanned from its first corner. It faces along `outward`
   * (the corner order is flipped when its winding points the other way).
   */
  face(points: readonly V3[], uv: Uv, outward: V3): void {
    const n = newell(points);
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-9) return;
    const flip = n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] < 0;
    const s = flip ? -1 / len : 1 / len;
    const base = this.positions.length / 3;
    for (const p of points) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(n[0] * s, n[1] * s, n[2] * s);
      this.uvs.push(uv[0], uv[1]);
    }
    for (let i = 1; i + 1 < points.length; i++) {
      if (flip) this.indices.push(base, base + i + 1, base + i);
      else this.indices.push(base, base + i, base + i + 1);
    }
  }

  /**
   * A solid between two rings of corners (same count, same order): its sides, and caps on either ring
   * when given a swatch (null = open, e.g. the hidden bottom). A convex ring pair – boxes, frustums,
   * prisms – in any orientation.
   */
  solid(bottom: readonly V3[], top: readonly V3[], side: Uv, bottomCap: Uv | null, topCap: Uv | null): void {
    const cb = centroid(bottom);
    const ct = centroid(top);
    const mid: V3 = [(cb[0] + ct[0]) / 2, (cb[1] + ct[1]) / 2, (cb[2] + ct[2]) / 2];
    const n = bottom.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const quad = [bottom[i]!, bottom[j]!, top[j]!, top[i]!];
      const c = centroid(quad);
      this.face(quad, side, [c[0] - mid[0], c[1] - mid[1], c[2] - mid[2]]);
    }
    if (bottomCap) this.face(bottom, bottomCap, [cb[0] - ct[0], cb[1] - ct[1], cb[2] - ct[2]]);
    if (topCap) this.face(top, topCap, [ct[0] - cb[0], ct[1] - cb[1], ct[2] - cb[2]]);
  }

  soup(): MeshSoup {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: new Float32Array(this.uvs),
      indices: new Uint32Array(this.indices),
    };
  }
}

/** Newell normal of a polygon (unnormalised; its direction follows the corner order). */
function newell(points: readonly V3[]): V3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x, y, z];
}

function centroid(points: readonly V3[]): V3 {
  const c: V3 = [0, 0, 0];
  for (const p of points) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  return [c[0] / points.length, c[1] / points.length, c[2] / points.length];
}

/** Corners of a rectangle at height y (part frame: x forward, z = three.js z). */
function rect(x0: number, x1: number, z0: number, z1: number, y: number): V3[] {
  return [
    [x0, y, z0],
    [x1, y, z0],
    [x1, y, z1],
    [x0, y, z1],
  ];
}

/** A horizontal ring of ROUND_SIDES corners. */
function ring(cx: number, cz: number, r: number, y: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < ROUND_SIDES; i++) {
    const a = ((i + 0.5) / ROUND_SIDES) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]);
  }
  return out;
}

/** A ring of ROUND_SIDES corners across the x axis (a nozzle's cross-section) at `x`. */
function crossRing(x: number, cy: number, r: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < ROUND_SIDES; i++) {
    const a = ((i + 0.5) / ROUND_SIDES) * Math.PI * 2;
    out.push([x, cy + Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

/** The key pieces of one part in its own frame (x = the part's facing, three.js axes) on a deck at `deck`. */
function partPieces(b: SoupBuilder, partId: PartId, w: number, deck: number, reach: number, s: ReplicaSwatches): void {
  switch (partId) {
    case 'cockpit':
      // the canopy: a glass block whose windscreen slopes down to the bow
      b.solid(rect(-0.4, 0.38, -0.3, 0.3, deck), rect(-0.32, 0.04, -0.2, 0.2, deck + 0.3), s.glass, null, s.glass);
      return;
    case 'engine': {
      // the nozzle points against the thrust (−x) out of the hull's side, flared, with a short glowing
      // exhaust cone (seen from every side, unlike the nozzle's end)
      const back = -w / 2 - reach - 0.2;
      b.solid(crossRing(-0.15 - reach, 0, 0.2), crossRing(back, 0, 0.27), s.metal, null, s.glow);
      b.solid(crossRing(back, 0, 0.24), crossRing(back - EXHAUST_LENGTH, 0, 0.07), s.glow, null, s.glow);
      return;
    }
    case 'cannon':
    case 'miningLaser':
    case 'heavyLaser':
    case 'tractorBeam': {
      // a turret ring on the head cell, a barrel to the front past the hull, a glowing muzzle
      const head = (w - 1) / 2;
      b.solid(ring(head, 0, 0.24, deck), ring(head, 0, 0.2, deck + 0.1), s.metal, null, s.metal);
      const half = partId === 'heavyLaser' ? 0.1 : 0.075;
      const tip = w / 2 + reach + (partId === 'cannon' ? 0.45 : 0.32);
      const y0 = deck + 0.02;
      const y1 = deck + 0.02 + half * 2;
      b.solid(rect(head, tip, -half, half, y0), rect(head, tip, -half, half, y1), s.metal, null, s.metal);
      b.face(
        [
          [tip, y0, -half],
          [tip, y0, half],
          [tip, y1, half],
          [tip, y1, -half],
        ],
        partId === 'cannon' ? s.weapon : s.glow,
        [1, 0, 0],
      );
      return;
    }
    case 'shield':
      b.solid(ring(0, 0, 0.26, deck), ring(0, 0, 0.13, deck + 0.14), s.metal, null, s.shield);
      return;
    default:
  }
}

/** Parts that get a key piece on the replica (the rest is plain hull). */
const KEY_PARTS: ReadonlySet<PartId> = new Set(['cockpit', 'engine', 'cannon', 'miningLaser', 'heavyLaser', 'tractorBeam', 'shield']);

/**
 * One part's key pieces in the hull frame (ShipView: the part centre, turned by its rotation); `reach`
 * = whole hull cells past the part's end its nozzle or barrel has to clear.
 */
function addPart(b: SoupBuilder, p: PlacedPart, deck: number, reach: number, s: ReplicaSwatches): void {
  if (!KEY_PARTS.has(p.partId)) return;
  const local = new SoupBuilder();
  partPieces(local, p.partId, partSize(p).w, deck, reach, s);
  const c = partCenter(p);
  const a = (p.rot * Math.PI) / 2;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const base = b.positions.length / 3;
  const pos = local.positions;
  const nor = local.normals;
  for (let i = 0; i < pos.length; i += 3) {
    // rotation about +y (three.js), then the part centre (sim (x, y) → three (x, −y))
    const x = pos[i]!;
    const z = pos[i + 2]!;
    b.positions.push(c.x + x * cos + z * sin, pos[i + 1]!, -c.y - x * sin + z * cos);
    const nx = nor[i]!;
    const nz = nor[i + 2]!;
    b.normals.push(nx * cos + nz * sin, nor[i + 1]!, -nx * sin + nz * cos);
  }
  b.uvs.push(...local.uvs);
  for (const i of local.indices) b.indices.push(base + i);
}

/** A closed loop on the game plane (sim frame), solid on its left: outer loops CCW, holes CW. */
type Loop = Vec2[];

/**
 * A loop moved `d` toward its solid side (mitred corners; a hairpin's mitre is capped at 3 d). Fine
 * for the hull's loops – half-cell edges, insets well under half a cell.
 */
export function insetLoop(loop: readonly Vec2[], d: number): Loop {
  const n = loop.length;
  const out: Loop = [];
  for (let i = 0; i < n; i++) {
    const p = loop[(i + n - 1) % n]!;
    const c = loop[i]!;
    const q = loop[(i + 1) % n]!;
    const l1 = Math.hypot(c.x - p.x, c.y - p.y) || 1;
    const l2 = Math.hypot(q.x - c.x, q.y - c.y) || 1;
    // left normals of the incoming and outgoing edges
    const n1x = -(c.y - p.y) / l1;
    const n1y = (c.x - p.x) / l1;
    const n2x = -(q.y - c.y) / l2;
    const n2y = (q.x - c.x) / l2;
    const k = Math.min(3, 1 / Math.max(1e-3, 1 + n1x * n2x + n1y * n2y));
    out.push({ x: c.x + (n1x + n2x) * d * k, y: c.y + (n1y + n2y) * d * k });
  }
  return out;
}

const signedArea = (loop: readonly Vec2[]): number => {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i]!;
    const q = loop[(i + 1) % loop.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
};

function insideLoop(pt: Vec2, loop: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i]!;
    const c = loop[j]!;
    if (a.y > pt.y !== c.y > pt.y && pt.x < ((c.x - a.x) * (pt.y - a.y)) / (c.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** A flat deck at `y` over loops (outer loops with the holes inside them), facing up. */
function addDeck(b: SoupBuilder, loops: readonly Loop[], y: number, uv: Uv): void {
  const outers = loops.filter((l) => signedArea(l) > 0).map((outer) => ({ outer, holes: [] as Loop[] }));
  for (const l of loops) {
    if (signedArea(l) > 0) continue;
    const owner = outers.find((o) => insideLoop(l[0]!, o.outer)) ?? outers[0];
    owner?.holes.push(l);
  }
  const v2 = (l: Loop): Vector2[] => l.map((p) => new Vector2(p.x, p.y));
  for (const poly of outers) {
    const all = [poly.outer, ...poly.holes].flat();
    const base = b.positions.length / 3;
    for (const p of all) {
      b.positions.push(p.x, y, -p.y);
      b.normals.push(0, 1, 0);
      b.uvs.push(uv[0], uv[1]);
    }
    for (const [i, j, k] of ShapeUtils.triangulateShape(v2(poly.outer), poly.holes.map(v2))) {
      const pi = all[i!]!;
      const pj = all[j!]!;
      const pk = all[k!]!;
      // counter-clockwise in the sim frame = counter-clockwise seen from above (+y) in three.js
      const ccw = (pj.x - pi.x) * (pk.y - pi.y) - (pk.x - pi.x) * (pj.y - pi.y) > 0;
      if (ccw) b.indices.push(base + i!, base + j!, base + k!);
      else b.indices.push(base + i!, base + k!, base + j!);
    }
  }
}

/**
 * One tier of the hull: `loops` extruded from `bottom` to `edge` (sides in the core swatch), a chamfer
 * `chamfer` wide up to the deck at `deck` (trim) and the deck (`top`: the wings' core, the body's
 * plate, the ridge's accent).
 */
function addTier(b: SoupBuilder, loops: readonly Loop[], bottom: number, edge: number, deck: number, chamfer: number, s: ReplicaSwatches, top: Uv): void {
  const tops: Loop[] = [];
  for (const loop of loops) {
    const top = insetLoop(loop, chamfer);
    tops.push(top);
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      const a = loop[i]!;
      const c = loop[(i + 1) % n]!;
      const ta = top[i]!;
      const tc = top[(i + 1) % n]!;
      // solid on the left of a → c: outward is its right, sim (dy, −dx) → three (dy, 0, dx)
      const out: V3 = [c.y - a.y, 0, c.x - a.x];
      b.face(
        [
          [a.x, bottom, -a.y],
          [c.x, bottom, -c.y],
          [c.x, edge, -c.y],
          [a.x, edge, -a.y],
        ],
        s.core,
        out,
      );
      b.face(
        [
          [a.x, edge, -a.y],
          [c.x, edge, -c.y],
          [tc.x, deck, -tc.y],
          [ta.x, deck, -ta.y],
        ],
        s.trim,
        [out[0], Math.hypot(out[0], out[2]), out[2]],
      );
    }
  }
  addDeck(b, tops, deck, top);
}

/** Boundary loops of a set of cells (corner points, sim frame; a diagonal pinch splits the loops). */
function cellLoops(cells: ReadonlySet<string>): Loop[] {
  return cellSetLoops([...cells].map(parseCell)).map((l) => l.x.map((x, i) => ({ x, y: l.y[i]! })));
}

function parseCell(key: string): Vec2 {
  const [x, y] = key.split(',').map(Number) as [number, number];
  return { x, y };
}

const NEIGHBOURS4: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * The cells the model's hull covers: the grid's cells (a shaped part with its whole footprint) with
 * the one-cell notches filled – an empty cell with three or four hull neighbours, twice over. At a
 * few dozen pixels the notches between engines and armour teeth only break the silhouette up.
 */
export function hullCells(grid: ShipGrid): Set<string> {
  const cells = gridCellKeys(grid);
  for (let pass = 0; pass < NOTCH_PASSES; pass++) {
    const add: string[] = [];
    const seen = new Set<string>();
    for (const key of cells) {
      const c = parseCell(key);
      for (const [dx, dy] of NEIGHBOURS4) {
        const k = cellKey(c.x + dx, c.y + dy);
        if (cells.has(k) || seen.has(k)) continue;
        seen.add(k);
        let solid = 0;
        for (const [ex, ey] of NEIGHBOURS4) if (cells.has(cellKey(c.x + dx + ex, c.y + dy + ey))) solid++;
        if (solid >= 3) add.push(k);
      }
    }
    if (add.length === 0) break;
    for (const k of add) cells.add(k);
  }
  return cells;
}

/** The ship's axis: the cockpit's row (the middle row without a cockpit). */
export function axisRow(grid: ShipGrid): number {
  const cockpit = grid.parts.find((p) => p.partId === 'cockpit');
  if (cockpit) return Math.round(partCenter(cockpit).y);
  const ys = grid.parts.map((p) => partCenter(p).y);
  return ys.length > 0 ? Math.round((Math.min(...ys) + Math.max(...ys)) / 2) : 0;
}

/** The body's cells: hull cells within BODY_ROWS of the axis row. */
export function bodyCells(cells: ReadonlySet<string>, row: number): Set<string> {
  const out = new Set<string>();
  for (const key of cells) if (Math.abs(parseCell(key).y - row) <= BODY_ROWS) out.add(key);
  return out;
}

/** The ridge's cells: body cells on the axis row with body on both sides. */
export function ridgeCells(body: ReadonlySet<string>, row: number): Set<string> {
  const out = new Set<string>();
  for (const key of body) {
    const { x, y } = parseCell(key);
    if (y === row && body.has(cellKey(x, y + 1)) && body.has(cellKey(x, y - 1))) out.add(key);
  }
  return out;
}

/**
 * A loop with its convex corners cut by `cut` along both edges (at most 45 % of an edge): the model's
 * silhouette tapers instead of ending in square teeth.
 */
export function cutCorners(loop: readonly Vec2[], cut: number): Loop {
  const n = loop.length;
  const out: Loop = [];
  for (let i = 0; i < n; i++) {
    const p = loop[(i + n - 1) % n]!;
    const c = loop[i]!;
    const q = loop[(i + 1) % n]!;
    const ax = c.x - p.x;
    const ay = c.y - p.y;
    const bx = q.x - c.x;
    const by = q.y - c.y;
    // solid on the left: a left turn wraps around the solid – a convex corner
    if (ax * by - ay * bx <= 1e-9) {
      out.push(c);
      continue;
    }
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    const ka = Math.min(cut, la * 0.45) / la;
    const kb = Math.min(cut, lb * 0.45) / lb;
    out.push({ x: c.x - ax * ka, y: c.y - ay * ka }, { x: c.x + bx * kb, y: c.y + by * kb });
  }
  return out;
}

/** How many whole cells of `cells` follow the part along `dir` (its facing, or −facing) past its own end. */
function reachIn(cells: ReadonlySet<string>, p: PlacedPart, dir: 1 | -1): number {
  const f = facing(p.rot);
  const c = partCenter(p);
  const half = (partSize(p).w - 1) / 2;
  let k = 0;
  while (k < 8 && cells.has(cellKey(Math.round(c.x + dir * f.x * (half + k + 1)), Math.round(c.y + dir * f.y * (half + k + 1))))) k++;
  return k;
}

/** One tier over `cells`: its loops inset and corner-cut, sides, chamfer and a deck in `top`. */
function addTierOver(b: SoupBuilder, cells: ReadonlySet<string>, t: TierShape, s: ReplicaSwatches, top: Uv): void {
  if (cells.size === 0) return;
  const loops = cellLoops(cells).map((l) => cutCorners(t.inset > 0 ? insetLoop(l, t.inset) : l, t.cut));
  addTier(b, loops, t.bottom, t.edge, t.deck, t.chamfer, s, top);
}

/**
 * The display model of `grid` (hull frame: three.js axes, ship units, bow = +x): wings over its cells
 * (notches filled, corners cut), the body and the ridge along its axis, and the key parts, in the
 * swatches `s`. Not yet pitched or fitted.
 */
export function displayModel(grid: ShipGrid, s: ReplicaSwatches): MeshSoup {
  const b = new SoupBuilder();
  const hull = hullCells(grid);
  const row = axisRow(grid);
  const body = bodyCells(hull, row);
  const ridge = ridgeCells(body, row);
  addTierOver(b, hull, WING, s, s.core);
  addTierOver(b, body, BODY, s, s.plate);
  addTierOver(b, ridge, RIDGE, s, s.trim);
  for (const p of grid.parts) {
    // a shaped part (the shipyard's shapes) is plain hull
    if (p.shape !== undefined) continue;
    const cells = partCells(p).map((c) => cellKey(c.x, c.y));
    const deck = cells.every((k) => ridge.has(k)) ? RIDGE.deck : cells.every((k) => body.has(k)) ? BODY.deck : WING.deck;
    // nozzles and barrels reach out of the hull past the filled notches
    const reach = p.partId === 'engine' ? reachIn(hull, p, -1) : reachIn(hull, p, 1);
    addPart(b, p, deck, reach, s);
  }
  return b.soup();
}

/** Turns a soup about the three.js z axis by `angle` (bow +x up for a positive angle), in place. */
export function pitchSoup(soup: MeshSoup, angle: number): MeshSoup {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (const arr of [soup.positions, soup.normals]) {
    for (let i = 0; i < arr.length; i += 3) {
      const x = arr[i]!;
      const y = arr[i + 1]!;
      arr[i] = x * c - y * s;
      arr[i + 1] = x * s + y * c;
    }
  }
  return soup;
}

/**
 * The display post under a fitted model: a thin round post (radius POST_RADIUS in pedestal units) on
 * the turn axis from the pedestal top up to the hull's mid plane (pitched by `pitch`), in the model's
 * unscaled frame.
 */
export function postSoup(fit: PedestalFit, pitch: number, uv: Uv): MeshSoup {
  const b = new SoupBuilder();
  const k = 1 / fit.scale;
  const cx = -fit.offset[0] * k;
  const cz = -fit.offset[2] * k;
  const y0 = -fit.offset[1] * k;
  const y1 = Math.max(y0, cx * Math.tan(pitch));
  b.solid(ring(cx, cz, POST_RADIUS * k, y0), ring(cx, cz, POST_RADIUS * k, y1), uv, null, null);
  return b.soup();
}

/** Two soups as one. */
export function mergeSoups(a: MeshSoup, c: MeshSoup): MeshSoup {
  const offset = a.positions.length / 3;
  const indices = new Uint32Array(a.indices.length + c.indices.length);
  indices.set(a.indices);
  for (let i = 0; i < c.indices.length; i++) indices[a.indices.length + i] = c.indices[i]! + offset;
  const cat = (x: Float32Array, y: Float32Array): Float32Array => {
    const out = new Float32Array(x.length + y.length);
    out.set(x);
    out.set(y, x.length);
    return out;
  };
  return { positions: cat(a.positions, c.positions), normals: cat(a.normals, c.normals), uvs: cat(a.uvs, c.uvs), indices };
}

/** Axis-aligned bounds of a soup (three.js frame: y up). */
export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

export function soupBounds(soup: MeshSoup): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const p = soup.positions;
  for (let i = 0; i < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = p[i + a]!;
      if (v < min[a]!) min[a] = v;
      if (v > max[a]!) max[a] = v;
    }
  }
  return { min, max };
}

/** How a model sits on a pedestal: scale, then offset (in scaled units) of its origin. */
export interface PedestalFit {
  scale: number;
  /** Translation after scaling: centres the model on the turn axis and lifts it onto the pedestal. */
  offset: [number, number, number];
}

/**
 * Fits a model with `bounds` onto a pedestal. A turning model (`turning`) is centred on its
 * footprint, lifted by `lift`, and its whole turn circle (the footprint's diagonal) is `extent`
 * across; a still one keeps its origin (the art's pedestal origin) and its footprint stays within
 * `fit.maxExtent`. The height (with the lift) never exceeds `fit.maxHeight`, and a still model is
 * never scaled up.
 */
export function pedestalFit(bounds: Bounds, turning: boolean, extent = REPLICA_EXTENT, lift = REPLICA_LIFT, fit = TROPHY_FIT): PedestalFit {
  const { min, max } = bounds;
  const sx = max[0] - min[0];
  const sz = max[2] - min[2];
  const height = Math.max(1e-6, max[1] - min[1]);
  const across = turning ? Math.hypot(sx, sz) : Math.max(sx, sz);
  const wanted = Math.min(turning ? extent : fit.maxExtent, fit.maxExtent);
  let scale = across > 0 ? wanted / across : 1;
  scale = Math.min(scale, (fit.maxHeight - (turning ? lift : 0)) / height);
  if (!turning) scale = Math.min(scale, 1);
  const offset: [number, number, number] = turning
    ? [-(min[0] + max[0]) * 0.5 * scale, lift - min[1] * scale, -(min[2] + max[2]) * 0.5 * scale]
    : [0, Math.max(0, -min[1] * scale), 0];
  return { scale, offset };
}

/** Yaw of the replica on pedestal `index` at layer time `time` (s); still with reduced motion. */
export function trophyYaw(index: number, time: number, reducedMotion: boolean): number {
  if (reducedMotion) return STILL_YAW;
  return (STILL_YAW + index * PEDESTAL_PHASE + time * TROPHY_SPIN) % (Math.PI * 2);
}
