// Salvage and dismantling of wrecks (long-term design 5.3.1, M3.6): the tractor beam, containers,
// cutting joints with the mining laser and ripping loose parts. The numbers live here, the logic in
// src/sim/salvage.
import type { PartId } from './parts';

/** A wreck of more parts cannot be loaded whole – it has to be cut up (a T1 tractor beam pulls 4 parts). */
export const LOAD_MAX_PARTS = 4;

/** Cutting a joint (5.3.1): a T1 mining laser beam on the joint for 3 s; a faster laser cuts faster. */
export const CUT_SECONDS = 3;
/** Mining rate of a T1 laser – cutting scales with the square root of the ratio (T2 ~2.4 s, heavy ~1.9 s). */
export const CUT_REFERENCE_RATE = 2.5;
/** A half-cut joint cools without a beam – the progress drops at this rate (share per second). */
export const CUT_DECAY = 0.5;

/**
 * A badly cut joint: a fuel tank or a reactor blows (20–50 dmg), destroys the neighbouring parts and
 * hits a ship within reach. The large reactor (M4c) blows hardest.
 */
export const CUT_BLAST: Partial<Record<PartId, number>> = { fuelTank: 30, reactor: 40, largeReactor: 50 };
export const CUT_BLAST_RADIUS = 8;

/** A part ripped from a wreck or a part of a piece: 30–70 % HP (scrap unless intact). */
export const PIECE_SCRAP_HP = 0.5;
/** Data per intact part loaded from a dismantled wreck (3.2.2 – the skill pays in the Archive too). */
export const SALVAGE_DATA_PER_PART = 4;

/** Pull of the tractor beam: a spring to a point by the ship (1/s²) and damping against the ship's velocity (1/s). */
export const TOW_SPRING = 2.2;
export const TOW_DAMPING = 1.8;
/** The towed object is held this far from the ship's hull (u). */
export const TOW_GAP = 1.5;
/** The beam breaks when the object is farther than range × this. */
export const TOW_BREAK = 1.25;
/** The beam locks onto an object up to this far from the cursor (beyond the object's radius, u). */
export const TOW_AIM_SLACK = 6;

/**
 * Archive "Tractor beam+" (`tractorPlus`, M4b plan §2.5): the beam reaches `rangeMult` × farther and pulls
 * wrecks `maxPartsBonus` parts larger. A hulk too big to load is still only ripped (I11).
 */
export const TRACTOR_PLUS = { rangeMult: 1.5, maxPartsBonus: 2 } as const;

// ---------------------------------------------------------------------------
// containers (5.3 "Container / pod")

/** Container radius (the model is ~1.2 × 0.8 u, scaled up in the game). */
export const CONTAINER_RADIUS = 0.9;
/** A container dropped from a ship (loot, war chest) disappears after 10 min of game time. */
export const CONTAINER_TTL = 10 * 60 * 60;
/** Containers by a medium and a large POI wreck. */
export const WRECK_CONTAINERS: readonly [number, number, number] = [0, 1, 2];
/** Cargo of a POI container (resource units). */
export const CONTAINER_CARGO: readonly [number, number] = [14, 36];
/** Chance that a container also carries a part. */
export const CONTAINER_PART_CHANCE = 0.25;
