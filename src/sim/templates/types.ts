// Ship templates (M4a, long-term design 3.4.3, plan §2): a named, normalised ship design
// the player can rebuild in the shipyard, and export / import as a text code.
import type { PartKey } from '../../data/parts';
import type { ShapeId } from '../../data/shapes';
import type { Rotation } from '../ship/types';

/**
 * One part of a template: key (with tier and variant), lower-left cell and rotation like `PlacedPart`;
 * a shaped part (SL2 E2) carries its `ShapeId` as a 5th element, an unshaped one has exactly 4.
 */
export type TemplatePart =
  | [key: PartKey, x: number, y: number, rot: Rotation]
  | [key: PartKey, x: number, y: number, rot: Rotation, shape: ShapeId];

/**
 * A template: normalised – the cockpit at (0, 0), parts sorted (by key, x, y, rot, then the shape:
 * absent first, then `SHAPE_IDS` order), no part ids, no HP, no Guild loan flag. The parts form a valid
 * design (`validateGrid`).
 */
export interface ShipTemplate {
  /** Sanitised name (`sanitizeName`, 1–SHIP_NAME_MAX characters). */
  name: string;
  parts: TemplatePart[];
}

/**
 * Why a template export code was rejected (codec.ts `decodeTemplate`; the UI shows a text per code,
 * `tx().fleet.templates`). Codes, never texts.
 */
export type TemplateDecodeError =
  /** Longer than TEMPLATE_CODE_MAX. */
  | 'tooLong'
  /** Not "AF1.<payload>.<checksum>" (or "AF2.…" from SL2 E2). */
  | 'prefix'
  /** The checksum does not match the payload (typo or tampering). */
  | 'checksum'
  /** The payload is not base64url JSON of the expected shape. */
  | 'format'
  /** Unknown format version (`v`). */
  | 'version'
  /** Missing or invalid name. */
  | 'name'
  /** A part key the game does not know. */
  | 'unknownPart'
  /** No cockpit. */
  | 'noCockpit'
  /** More than one cockpit. */
  | 'manyCockpits'
  /** Two parts share a cell. */
  | 'overlap'
  /** A part outside the hangar's 15 × 15 build area. */
  | 'outOfBounds'
  /** Not a valid design otherwise (`validateGrid`: disconnected parts etc.). */
  | 'invalidDesign'
  /** SL2 E2: a shape code (AF2 `m`) the game does not know. */
  | 'unknownShape'
  /** SL2 E2: a shape on a part that cannot have one (only armour can). */
  | 'shapeNotAllowed';

export type TemplateDecodeResult = { ok: true; template: ShipTemplate } | { ok: false; error: TemplateDecodeError };
