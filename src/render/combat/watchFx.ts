// NPC ship looks in the combat layer (M4d plan T13, render polish): the blue-white bolt and muzzle flash
// of a Guild Watch shot, the shield bubble around a live Watch ship (the same bubble material as every
// ship – no new shader program), hull sparks, damage smoke below half hull and the explosion when one is
// destroyed (no wreck, no loot – the sim leaves nothing behind). The escort contract convoys' trader and
// tanker (T6) take the same hull sparks, smoke and explosion – no shields. Pure helpers here; CombatLayer
// calls them.
import { CONVOY_SHAPES } from '../../data/convoys';
import { WATCH } from '../../data/guild';
import { SHIELD_MARGIN } from '../../sim/combat/projectiles';
import type { ShipRef } from '../../sim/combat/types';
import type { WatchShip } from '../../sim/guild/types';
import { sideOf } from '../../sim/npc/sides';
import type { NpcShipKind } from '../../sim/npc/types';

/** Whose colours a shot wears: the player's cyan, the pirates' red-orange or the Guild Watch's blue-white. */
export type BoltSide = 'player' | 'pirate' | 'guild';

export function boltSide(owner: ShipRef): BoltSide {
  const side = sideOf(owner);
  return side === 'player' ? 'player' : side === 'guild' ? 'guild' : 'pirate';
}

/** Radius of a Watch ship's shield bubble (the sim's hit radius of a shielded Watch ship). */
export const watchShieldRadius = (ship: Pick<WatchShip, 'kind'>): number => WATCH.ships[ship.kind].radius + SHIELD_MARGIN;

/** Hull share 0..1 of a live Watch ship. */
export const watchHullShare = (ship: Pick<WatchShip, 'kind' | 'hull'>): number => Math.max(0, Math.min(1, ship.hull / WATCH.ships[ship.kind].hull));

/** Smoke puffs per second of a damaged Watch ship: none at half hull or more, then 2 → 12 as it nears 0. */
export function smokeRate(hullShare: number): number {
  if (hullShare >= 0.5) return 0;
  return 2 + 10 * Math.min(1, (0.5 - hullShare) / 0.5);
}

/** A convoy ship kind that can be destroyed (the escort contract's trader and tanker). */
export const isConvoyHull = (kind: NpcShipKind): kind is 'trader' | 'tanker' => kind === 'trader' || kind === 'tanker';

/**
 * Bulk radius of an NPC ship for its smoke and fireball: a Watch ship's shield radius; a convoy ship's
 * bounding radius overstates its long, slim hull, so a share of it.
 */
export function npcBulkRadius(kind: NpcShipKind): number {
  if (isConvoyHull(kind)) return CONVOY_SHAPES[kind].radius * 0.6;
  return kind === 'cutter' || kind === 'frigate' ? watchShieldRadius({ kind }) : 4;
}

/**
 * How far above the effects plane an NPC ship's damage smoke rises from (u): the top of a tall convoy
 * hull (npc_ships.json bounds ≈ 2.4 u – lower, its own deck would hide the smoke), a Watch ship's back.
 */
export const npcSmokeLift = (kind: NpcShipKind): number => (isConvoyHull(kind) ? 2.3 : 0.4);

/**
 * Bow and stern of a convoy hull along its axis (u, ship frame: + = bow) – where the secondary blasts of a
 * destroyed convoy ship go and the span its damage smoke rises from; [0, 0] for a Watch ship.
 */
export function hullSpan(kind: NpcShipKind): readonly [number, number] {
  if (!isConvoyHull(kind)) return [0, 0];
  const circles = CONVOY_SHAPES[kind].circles;
  return [Math.min(...circles.map((c) => c.x)), Math.max(...circles.map((c) => c.x))];
}
