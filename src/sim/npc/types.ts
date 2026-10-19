// The shared contract of non-pirate ships in combat (M4d plan §2.3, §2.4, §3): live Guild Watch ships,
// convoy ships (scheduled and escorted) and the Guild relay mast as projectile targets and obstacles.
//
// User decision 2026-10-16: NO friendly fire. Player-owned shots never hit a Watch ship or a convoy
// ship (`canHit`, src/sim/npc/sides.ts); rams and blasts do no damage to them either (NPC colliders are
// `safe`). Pirates can hit the Watch and the escorted convoy ships.
import type { ConvoyShipKind } from '../../data/convoys';
import type { WatchKind } from '../../data/guild';
import type { ShipRef } from '../combat/types';
import type { Vec2 } from '../math/vec2';

/** Id prefixes of the non-pirate ships (and the Guild relay mast). Everything else that is not 'player' is a pirate. */
export const NPC_PREFIX = {
  /** A live Guild Watch ship: `gw:<routeId>|<slot>` (`lane:A:0`, `sector:12,-3`, `relay:A`). */
  watch: 'gw:',
  /** A scheduled convoy ship: `cv:<lane>@<n>:<kind>`. */
  convoy: 'cv:',
  /** An escort contract's convoy ship: `es:<serial>:<kind>`. */
  escort: 'es:',
  /** The Guild relay mast: `gr:<lane>`. */
  relay: 'gr:',
} as const;

/** Which side a ship (or a projectile's owner) is on. Convoys never shoot. */
export type Side = 'player' | 'pirate' | 'guild' | 'convoy';

/** May a shot of `owner` hit `target` (refs / NPC target ids)? The projectile hit predicate. */
export type HitPredicate = (owner: ShipRef, target: ShipRef) => boolean;

/** Something a projectile can hit that is not a pirate / the player (it stops the shot). */
export interface NpcHitTarget {
  /** The Watch ship / convoy ship / relay id (see `NPC_PREFIX`). */
  id: string;
  kind: 'watch' | 'convoy' | 'relay';
  pos: Vec2;
  /**
   * Velocity of a moving target (a Watch ship, a convoy ship) – the pirate's aim lead when it fights the
   * ship (`pirateTarget`); absent = at rest (the relay mast).
   */
  vel?: Vec2;
  radius: number;
  /** Shield bubble strength now (0 = none / down); a shielded hit lands on `radius + SHIELD_MARGIN`. */
  shield: number;
  /** Takes damage (a live Watch ship, an escorted convoy ship); otherwise the shot is spent (scheduled convoy, relay). */
  damageable: boolean;
}

/**
 * Bounds of every projectile segment of a step (`npcProjectiles`): targets that cannot come near it are
 * not listed – they could not stop a shot anyway.
 */
export interface HitBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The projectile that hit an NPC target (the projectile is consumed by the caller). */
export interface NpcHit {
  owner: ShipRef;
  pos: Vec2;
  damage: number;
  from: Vec2;
}

/** What an NPC ship is (the `npcDestroyed` event). */
export type NpcShipKind = WatchKind | ConvoyShipKind;

/** Sim events of NPC ships in combat (part of SimEvent). */
export type NpcEvent =
  /** A shot hit a Watch / escorted convoy ship; `shielded` = the shield took it; `by` = the shot's owner. */
  | { type: 'npcHit'; id: string; pos: Vec2; damage: number; shielded: boolean; by: ShipRef }
  /** A Watch / escorted convoy ship was destroyed (explosion FX, debris – no wreck, no loot). */
  | { type: 'npcDestroyed'; id: string; kind: NpcShipKind; pos: Vec2; by: ShipRef };
