// Shaped armour parts (SL2 E2, ship-building 2 design §2.2, shaped-parts plan
// §2–§3). A shape is a way of laying a part, not a new good: storage,
// market, recipes and `PartKey` are unchanged; `PlacedPart.shape` only changes the outline. Pure data –
// the geometry (curve expansion, rotation, clipping) lives in sim/ship/shape.ts.
import type { Vec2 } from '../sim/math/vec2';
import type { PartId } from './parts';

export type ShapeId = 'wedge' | 'chamfer' | 'round' | 'arc' | 'half' | 'nose' | 'wingL' | 'wingR' | 'nose2x1';

/** Tab cycle order after "full" (the shipyard's shape strip uses the same order). */
export const SHAPE_IDS: readonly ShapeId[] = ['wedge', 'chamfer', 'round', 'arc', 'half', 'nose', 'wingL', 'wingR', 'nose2x1'];

/**
 * One edge of a shape outline, from the previous point to `to`:
 * - `line`: a straight edge;
 * - `arc`: a circular arc around `centre`, counter-clockwise (every curve bulges outward of the CCW outline);
 * - `ogive`: a parabolic nose side. Its base is the end farther from the part's long axis (y = 0 at
 *   rot 0), its tip the other end; the curve is tangent to the x axis at the base:
 *   x = base.x + (tip.x − base.x)·s, y = tip.y + (base.y − tip.y)·(1 − s²), s ∈ [0, 1] from the base.
 */
export type ShapeSeg = { kind: 'line'; to: Vec2 } | { kind: 'arc'; centre: Vec2; to: Vec2 } | { kind: 'ogive'; to: Vec2 };

export interface ShapeDef {
  id: ShapeId;
  /** Footprint at rot 0 (like `PartDef.size`): wings and the 2×1 nose are 2×1 armour. */
  size: { w: 1 | 2; h: 1 };
  /**
   * Outline at rot 0 around the part centre (+x bow, +y port), CCW, from `start`; the last segment
   * returns to `start`. Straight-edge vertices lie on the half grid.
   */
  start: Vec2;
  segs: readonly ShapeSeg[];
  /** = massMult = hpMult (spec §2.2 table); within 1 % of the outline's area. */
  area: number;
  /** Hull points: `area` rounded to ½, at least ½. */
  points: 0.5 | 1 | 1.5;
  /** AF2 template code modifier. */
  code: 'w' | 'c' | 'r' | 'a' | 'h' | 'n' | 'wl' | 'wr' | 'n2';
}

const P = (x: number, y: number): Vec2 => ({ x, y });
const line = (x: number, y: number): ShapeSeg => ({ kind: 'line', to: P(x, y) });

export const SHAPES: Readonly<Record<ShapeId, ShapeDef>> = {
  // right triangle, hypotenuse front-port (FP)
  wedge: {
    id: 'wedge',
    size: { w: 1, h: 1 },
    start: P(-0.5, -0.5),
    segs: [line(0.5, -0.5), line(-0.5, 0.5), line(-0.5, -0.5)],
    area: 0.5,
    points: 0.5,
    code: 'w',
  },
  // square without the FP corner (legs ½)
  chamfer: {
    id: 'chamfer',
    size: { w: 1, h: 1 },
    start: P(-0.5, -0.5),
    segs: [line(0.5, -0.5), line(0.5, 0), line(0, 0.5), line(-0.5, 0.5), line(-0.5, -0.5)],
    area: 0.875,
    points: 1,
    code: 'c',
  },
  // square with the FP corner rounded, r = ½
  round: {
    id: 'round',
    size: { w: 1, h: 1 },
    start: P(-0.5, -0.5),
    segs: [line(0.5, -0.5), line(0.5, 0), { kind: 'arc', centre: P(0, 0), to: P(0, 0.5) }, line(-0.5, 0.5), line(-0.5, -0.5)],
    area: 0.946,
    points: 1,
    code: 'r',
  },
  // quarter circle r = 1 centred on the rear-starboard corner
  arc: {
    id: 'arc',
    size: { w: 1, h: 1 },
    start: P(-0.5, -0.5),
    segs: [line(0.5, -0.5), { kind: 'arc', centre: P(-0.5, -0.5), to: P(-0.5, 0.5) }, line(-0.5, -0.5)],
    area: 0.785,
    points: 1,
    code: 'a',
  },
  // the starboard half (y ∈ [−½, 0]); the open side faces port
  half: {
    id: 'half',
    size: { w: 1, h: 1 },
    start: P(-0.5, -0.5),
    segs: [line(0.5, -0.5), line(0.5, 0), line(-0.5, 0), line(-0.5, -0.5)],
    area: 0.5,
    points: 0.5,
    code: 'h',
  },
  // triangle pointing to the bow
  nose: {
    id: 'nose',
    size: { w: 1, h: 1 },
    start: P(-0.5, -0.5),
    segs: [line(0.5, 0), line(-0.5, 0.5), line(-0.5, -0.5)],
    area: 0.5,
    points: 0.5,
    code: 'n',
  },
  // 2×1 fin: long leg on the starboard edge, slope 1:2 front-port
  wingL: {
    id: 'wingL',
    size: { w: 2, h: 1 },
    start: P(-1, -0.5),
    segs: [line(1, -0.5), line(-1, 0.5), line(-1, -0.5)],
    area: 1.0,
    points: 1,
    code: 'wl',
  },
  // mirror of wingL: long leg on the port edge, slope front-starboard
  wingR: {
    id: 'wingR',
    size: { w: 2, h: 1 },
    start: P(-1, -0.5),
    segs: [line(1, 0.5), line(-1, 0.5), line(-1, -0.5)],
    area: 1.0,
    points: 1,
    code: 'wr',
  },
  // rear cell full, the front cell a parabolic ogive to the tip (1, 0)
  nose2x1: {
    id: 'nose2x1',
    size: { w: 2, h: 1 },
    start: P(-1, -0.5),
    segs: [line(0, -0.5), { kind: 'ogive', to: P(1, 0) }, { kind: 'ogive', to: P(0, 0.5) }, line(-1, 0.5), line(-1, -0.5)],
    area: 1.67,
    points: 1.5,
    code: 'n2',
  },
};

/** Parts that may carry a shape (armour of every tier; shielding later). Anything else: `shapeNotAllowed`. */
export const SHAPEABLE_PARTS: ReadonlySet<PartId> = new Set<PartId>(['armor']);

/** Curve detail of the simulation (hits, arcs): chords per quarter circle and per ogive side. */
export const CURVE_SEGMENTS_SIM = { quarter: 4, ogive: 6 } as const;
/** Curve detail of the renderer (plates, ghosts, icons). */
export const CURVE_SEGMENTS_RENDER = { quarter: 12, ogive: 12 } as const;

/** Wrecks other than the player's: an intact shaped part drops as the part only with at least this area. */
export const SHAPE_LOOT_MIN_AREA = 0.75;

export const isShapeId = (v: unknown): v is ShapeId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(SHAPES, v);

const BY_CODE: ReadonlyMap<string, ShapeId> = new Map(SHAPE_IDS.map((id) => [SHAPES[id].code, id]));

/** The shape of an AF2 modifier code, or null. */
export const shapeOfCode = (code: string): ShapeId | null => BY_CODE.get(code) ?? null;
