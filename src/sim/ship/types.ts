import type { PartId, Tier } from '../../data/parts';
import type { ShapeId } from '../../data/shapes';
import type { VariantId } from '../../data/variants';

/** Rotation in multiples of 90° counter-clockwise. 0 = the part points to +x (forward). */
export type Rotation = 0 | 1 | 2 | 3;

export interface PlacedPart {
  /** Stable id within the ship; a moved part keeps it (important for HP). */
  id: number;
  partId: PartId;
  /** Part tier: 1 = iron, 2 = titanium. */
  tier: Tier;
  /** Lower-left cell of the rotated part rectangle (ship-local frame). */
  x: number;
  y: number;
  rot: Rotation;
  /** Part variant from a plan or the Archive (M3.5b); missing = the base part. */
  variant?: VariantId;
  /**
   * Guild loan (free help for a stranded player): the part works normally but belongs to the Guild –
   * it cannot be sold, scrapped, stored, couriered or used for crafting; taking it off the hull in
   * the shipyard (or losing it) returns it to the Guild. Missing = an owned part.
   */
  loan?: true;
  /**
   * SL2 E2: the shape the part is laid in (only `SHAPEABLE_PARTS`, data/shapes.ts); missing = the full
   * cell(s). Parts without a shape never reach polygon code (fast path, bit-identical to before).
   */
  shape?: ShapeId;
}

export interface ShipGrid {
  parts: PlacedPart[];
  /** Next free id (new parts get nextId++). */
  nextId: number;
}

/** Current HP of the mounted parts by id; a missing entry = full HP. */
export type HpMap = Map<number, number>;
