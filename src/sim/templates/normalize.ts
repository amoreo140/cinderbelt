// Ship template normal form (M4a, plan §2; shapes SL2 E2 §2.5): the cockpit's lower-left
// cell at (0, 0), parts sorted by (key, x, y, rot) with the shape as the last tiebreak (absent first,
// then `SHAPE_IDS` order), no part ids, no HP, no Guild loan flag. Two ships with the same layout built
// in different spots of the hangar give the same template; templates without shapes sort exactly as
// before shapes existed. Pure and deterministic.
import { isPartKey, parsePartKey, placedKey, type PartKey } from '../../data/parts';
import { isShapeId, SHAPE_IDS, type ShapeId } from '../../data/shapes';
import { partCells, validateGrid, type GridError } from '../ship/grid';
import { shapeProblem } from '../ship/shape';
import type { PlacedPart, Rotation, ShipGrid } from '../ship/types';
import { HANGAR_MAX, HANGAR_MIN } from '../shipyard/editor';
import type { TemplatePart } from './types';

/** Side of the hangar's build area in cells (15). A template must fit in it. */
export const HANGAR_SIZE = HANGAR_MAX - HANGAR_MIN + 1;

/** Most parts a template can have: every part covers at least one hangar cell. */
export const TEMPLATE_MAX_PARTS = HANGAR_SIZE * HANGAR_SIZE;

const isRotation = (rot: unknown): rot is Rotation => rot === 0 || rot === 1 || rot === 2 || rot === 3;
/** Coordinates a stored template can have (cockpit at 0,0 and the whole ship within 15 × 15 cells). */
const isCoord = (v: unknown): v is number => Number.isInteger(v) && Math.abs(v as number) < HANGAR_SIZE;

/**
 * Is `raw` a well-formed template part: `[known part key, integer x, integer y, rotation 0–3]`, optionally
 * with a known `ShapeId` as a 5th element? Form only – whether the part may have that shape, bounds,
 * overlaps and cockpits are `templateProblem`'s business.
 */
export function isTemplatePart(raw: unknown): raw is TemplatePart {
  return (
    Array.isArray(raw) &&
    (raw.length === 4 || (raw.length === 5 && isShapeId(raw[4]))) &&
    isPartKey(raw[0]) &&
    Number.isSafeInteger(raw[1]) &&
    Number.isSafeInteger(raw[2]) &&
    isRotation(raw[3])
  );
}

/** Sort rank of a shape: none first, then the `SHAPE_IDS` order. */
const shapeRank = (shape: ShapeId | undefined): number => (shape === undefined ? -1 : SHAPE_IDS.indexOf(shape));

/** Template part order: key, then x, y, rot, then the shape (none first, then `SHAPE_IDS` order). */
export function compareTemplateParts(a: TemplatePart, b: TemplatePart): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  return a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || shapeRank(a[4]) - shapeRank(b[4]);
}

/** A template part from its fields; the 5th element only for a shaped part. */
const templatePart = (key: PartKey, x: number, y: number, rot: Rotation, shape: ShapeId | undefined): TemplatePart =>
  shape === undefined ? [key, x, y, rot] : [key, x, y, rot, shape];

/**
 * The parts of a grid as template parts (as placed, not normalised). Loan flags and ids are dropped; a
 * shaped part gets its shape as the 5th element, an unshaped one stays a 4-tuple.
 */
export const gridTemplateParts = (grid: ShipGrid): TemplatePart[] => grid.parts.map((p) => templatePart(placedKey(p), p.x, p.y, p.rot, p.shape));

const isCockpit = (key: PartKey): boolean => parsePartKey(key).partId === 'cockpit';

/**
 * Normal form of template parts: shifted so the (only) cockpit sits at (0, 0), sorted. Null when the
 * parts do not have exactly one cockpit (no origin to normalise to). Idempotent; returns fresh tuples.
 */
export function normalizeParts(parts: readonly TemplatePart[]): TemplatePart[] | null {
  const cockpits = parts.filter((p) => isCockpit(p[0]));
  if (cockpits.length !== 1) return null;
  const [, cx, cy] = cockpits[0]!;
  return parts.map((p) => templatePart(p[0], p[1] - cx, p[2] - cy, p[3], p[4])).sort(compareTemplateParts);
}

/** The template parts of a ship (the active ship's grid or a shipyard draft); null without exactly one cockpit. */
export const normalizeTemplate = (grid: ShipGrid): TemplatePart[] | null => normalizeParts(gridTemplateParts(grid));

/** Template parts as a grid placed at offset (dx, dy); ids 1..n in template order, shapes restored. */
export function templateGrid(parts: readonly TemplatePart[], dx = 0, dy = 0): ShipGrid {
  return {
    parts: parts.map(([key, x, y, rot, shape], i): PlacedPart => {
      const { partId, tier, variant } = parsePartKey(key);
      return { id: i + 1, partId, tier, x: x + dx, y: y + dy, rot, ...(variant ? { variant } : {}), ...(shape !== undefined ? { shape } : {}) };
    }),
    nextId: parts.length + 1,
  };
}

/** Bounding box of the cells the parts cover (shape footprints included; null for no parts). */
export function templateBounds(parts: readonly TemplatePart[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (parts.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of templateGrid(parts).parts) {
    for (const c of partCells(p)) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x);
      maxY = Math.max(maxY, c.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Why template parts are not a usable design (null = they are). */
export type TemplateProblem =
  | 'unknownPart'
  | 'unknownShape'
  | 'shapeNotAllowed'
  | 'outOfBounds'
  | 'tooMany'
  | Exclude<GridError, 'empty'>
  | 'empty';

/**
 * Checks well-formed template parts (`isTemplatePart`): a known key each, a known shape only on a part
 * that can have one (armour), at most TEMPLATE_MAX_PARTS, the whole ship within the hangar's 15 × 15
 * cells, exactly one cockpit, no overlap, connected (`validateGrid`). Footprints follow the shapes
 * (a wing is 2×1). Cockpit and overlap problems come before bounds, bounds before connectivity.
 */
export function templateProblem(parts: readonly TemplatePart[]): TemplateProblem | null {
  if (parts.length === 0) return 'empty';
  if (parts.length > TEMPLATE_MAX_PARTS) return 'tooMany';
  if (!parts.every((p) => isPartKey(p[0]))) return 'unknownPart';
  for (const p of parts) {
    if (p.length > 4) {
      const problem = shapeProblem({ partId: parsePartKey(p[0]).partId, shape: p[4] });
      if (problem) return problem;
    }
  }
  // reject far-away coordinates before touching cells (a crafted code could put a part at 1e15)
  if (!parts.every((p) => isCoord(p[1] - parts[0]![1]) && isCoord(p[2] - parts[0]![2]))) return 'outOfBounds';
  const grid = templateGrid(parts);
  const errors = validateGrid(grid);
  if (errors.includes('noCockpit')) return 'noCockpit';
  if (errors.includes('multipleCockpits')) return 'multipleCockpits';
  if (errors.includes('overlap')) return 'overlap';
  const b = templateBounds(parts)!;
  if (b.maxX - b.minX + 1 > HANGAR_SIZE || b.maxY - b.minY + 1 > HANGAR_SIZE) return 'outOfBounds';
  if (errors.includes('disconnected')) return 'disconnected';
  return null;
}
