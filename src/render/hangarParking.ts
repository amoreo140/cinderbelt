// Parking spots of the hangar hall (M4a "Hangar and fleet", plan T8): where the ships stored at this
// station stand beside the shipyard platform. Pure layout math in the yard frame (the ship grid's
// frame: +x = bow = the bay door, +y = port), unit-tested without WebGL.
//
// The hall (art/README.md §2.7.25, `hangar_bay.glb`) has no free floor next to the platform: the
// service catwalk rings it out to 11 cells and the assembly-arm rails run at y = ±13. The free deck is
// between the rails and the side walls' part racks (|y| 13.8 … 22.8), clear of the corner towers
// (x ±17), the fuel tanks (x < −15) and the tool carts – four spots, two on each side. A ship stands on
// the bay deck; one too large for its spot is scaled down to fit (a parked ship is only shown).
// Everything there stays far under the bay's height rule (nothing rises over the build floor's view
// cone from any shipyard camera pose), so a parked ship never hides the build grid.

/** Top of the bay deck (glTF y) – parked ships stand on it. */
export const BAY_DECK = -1.9;
/** Top of the build floor and the height rule of the bay (hangar_bay.glb, art/README.md §2.7.25). */
export const FLOOR_TOP = -0.37;
export const RULE_K = 0.6;
export const RULE_R0 = 8.5;

/** Ships shown parked (the hangar has at most 4 slots in the whole game). */
export const PARKED_MAX = 4;

/** A parking spot: the centre and the half extents of its free floor (yard frame, cells). */
export interface ParkingSpot {
  x: number;
  y: number;
  halfX: number;
  halfY: number;
}

/**
 * The four spots, in the order ships take them (by ship id): port fore, starboard fore, port aft,
 * starboard aft – one ship stands on the left of the platform, two on both sides. The fore spots
 * first: in the default 3/4 view they lie farther from the camera, so nearer the middle of the
 * screen, out from under the editor's side panels.
 */
export const PARKING_SPOTS: readonly ParkingSpot[] = [
  { x: 4.75, y: 19.55, halfX: 3.75, halfY: 2.95 },
  { x: 4.75, y: -19.55, halfX: 3.75, halfY: 2.95 },
  { x: -4.75, y: 19.55, halfX: 3.75, halfY: 2.95 },
  { x: -4.75, y: -19.55, halfX: 3.75, halfY: 2.95 },
];

/** Highest point allowed at a horizontal distance `r` from the platform centre (the bay's height rule). */
export function heightLimit(r: number): number {
  return r > RULE_R0 ? FLOOR_TOP + RULE_K * (r - RULE_R0) : FLOOR_TOP;
}

/** Axis-aligned box in the yard frame: floor rectangle (cells) and its top (glTF y). */
export interface YardBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  top: number;
}

/** The box stays under the height rule: its top at its point nearest to the platform centre. */
export function clearsHeightRule(box: YardBox): boolean {
  const dx = Math.max(box.minX, 0, -box.maxX);
  const dy = Math.max(box.minY, 0, -box.maxY);
  return box.top <= heightLimit(Math.hypot(dx, dy));
}

/** Ship bounds in its own frame: x along the bow, y to port, z up (model units = cells). */
export interface ShipBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** Where a parked ship goes: its origin in the yard frame (x, y; z = height) and its scale. */
export interface Placement {
  x: number;
  y: number;
  z: number;
  scale: number;
}

/**
 * Fits a ship into a spot: scaled down (never up) so its footprint fits the spot's floor, centred
 * along the spot, against the spot's edge nearer the platform (a narrow ship stands close to the
 * build grid, where a zoomed-out view sees it), its bottom on the bay deck.
 */
export function placeInSpot(bounds: ShipBounds, spot: ParkingSpot): Placement {
  const length = Math.max(1e-6, bounds.maxX - bounds.minX);
  const width = Math.max(1e-6, bounds.maxY - bounds.minY);
  const scale = Math.min(1, (2 * spot.halfX) / length, (2 * spot.halfY) / width);
  const side = Math.sign(spot.y) || 1;
  const centreY = spot.y - side * (spot.halfY - (scale * width) / 2);
  return {
    x: spot.x - (scale * (bounds.minX + bounds.maxX)) / 2,
    y: centreY - (scale * (bounds.minY + bounds.maxY)) / 2,
    z: BAY_DECK - scale * bounds.minZ,
    scale,
  };
}

/** The yard box a placed ship takes (the height-rule check and tests). */
export function placedBox(bounds: ShipBounds, p: Placement): YardBox {
  return {
    minX: p.x + p.scale * bounds.minX,
    maxX: p.x + p.scale * bounds.maxX,
    minY: p.y + p.scale * bounds.minY,
    maxY: p.y + p.scale * bounds.maxY,
    top: p.z + p.scale * bounds.maxZ,
  };
}
