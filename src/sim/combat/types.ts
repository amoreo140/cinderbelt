// Combat types (M3a): ships in combat, projectiles, enemies and wrecks. Pure data – the logic is
// in the other files of the folder, the orchestration in combat.ts.
import type { PartInventory, Tier } from '../../data/parts';
import type { PlanId } from '../../data/plans';
import type { Cargo } from '../../data/resources';
import type { Vec2 } from '../math/vec2';
import type { Body } from '../physics/body';
import type { ShipProperties } from '../ship/properties';
import type { HpMap, ShipGrid } from '../ship/types';

/** A reference to a ship in combat: 'player' or an enemy id (e.g. 'pr:12,-3:0'). */
export type ShipRef = string;
export const PLAYER_REF: ShipRef = 'player';

/** Everything a ship needs for combat (player and enemy alike). */
export interface CombatShip {
  grid: ShipGrid;
  /** Incremented on every grid change (the renderer rebuilds the ship model from it). */
  gridVersion: number;
  hp: HpMap;
  props: ShipProperties;
  body: Body;
  prevBody: Body;
  lastLocalForce: Vec2;
  energy: number;
  /** Current shield (0..props.shield.capacity). */
  shield: number;
  /** Steps until the shield starts recharging (set to the delay after a hit). */
  shieldDelay: number;
  /** Cannon part id → steps until the next shot (a missing entry = ready). */
  cooldowns: Map<number, number>;
}

export interface Projectile {
  id: number;
  owner: ShipRef;
  pos: Vec2;
  vel: Vec2;
  /** Remaining flight steps. */
  ttl: number;
  damage: number;
  /** Cannon level (look of the projectile). */
  tier: Tier;
  /** Where the shot came from – for the attack direction indicator. */
  origin: Vec2;
}

/**
 * Jackal, Hammer and Scavenger (M3.6: ignores the player, steals loot, runs when hit); M4b: the Gunner
 * (Gunner – keeps its distance with three cannons, evades) and the derelict's sentry drone (guards
 * its station, never flees, never tolls, never respawns).
 */
export type EnemyKind = 'jackal' | 'hammer' | 'scavenger' | 'gunner' | 'sentry';
export const ENEMY_KINDS: readonly EnemyKind[] = ['jackal', 'hammer', 'scavenger', 'gunner', 'sentry'];

/**
 * collect = the scavenger flies to loot (target in `waypoint`); hail = pirates demand a toll (hold
 * distance, no fire); retreat = low on fuel – the pirate breaks off and heads home, where it waits
 * (combat/ai.ts). M4b: evade = a Gunner breaks away (full thrust away and sideways, then back to its
 * standoff); dormant = a graveyard sleeper: no thrust, no fire, shields 0, shown as a wreck until scanned
 * or awake.
 */
export type AiMode = 'patrol' | 'attack' | 'flee' | 'collect' | 'hail' | 'retreat' | 'evade' | 'dormant';
export const AI_MODES: readonly AiMode[] = ['patrol', 'attack', 'flee', 'collect', 'hail', 'retreat', 'evade', 'dormant'];

export interface AiState {
  mode: AiMode;
  /** Patrol target point. */
  waypoint: Vec2;
  /** Steps until the next decision (new patrol point, change of circling direction, jackal retreat). */
  timer: number;
  /** Circling direction around the target: 1 = counter-clockwise, −1 = clockwise. */
  orbit: 1 | -1;
  /** After a strafing run the jackal flies off (hit and run) – steps until it returns to the attack. */
  breakOff: number;
  /** Steps until the gunner may fire – its reaction to a new target or a course change (combat/aim.ts). */
  react: number;
  /** The target velocity the gunner last reacted to. */
  seen: Vec2;
}

export interface Enemy extends CombatShip {
  /** Spawn slot id – a destroyed enemy does not respawn immediately from it. */
  id: string;
  kind: EnemyKind;
  /** Centre of the outpost. */
  home: Vec2;
  /** Sum of maximum HP at spawn (flee at low HP). */
  maxHull: number;
  ai: AiState;
  /** Hauler cargo (own and stolen) – goes into the wreck on destruction (M3.6). */
  hold?: WreckLoot;
  /** Paid toll: the pirate does not attack the player (cleared by the pirate step when it runs out). */
  calm?: boolean;
  /** Fuel in the tanks of its grid (props.fuelCapacity); burnt by the same rule as the player's. */
  fuel: number;
}

export type Livery = 'default' | 'pirate';

export interface WreckLoot {
  cargo: Cargo;
  parts: PartInventory;
}

export interface Wreck {
  id: number;
  /** Parts in the original coordinates of the ship grid (look and collisions only). */
  grid: ShipGrid;
  /** Derived from the grid (not saved). */
  props: ShipProperties;
  body: Body;
  prevBody: Body;
  loot: WreckLoot;
  /** Remaining steps until it disappears. */
  ttl: number;
  livery: Livery;
  /**
   * Discoveries (M3.5b): a wreck from a POI (`wreck:cx,cy`) or from a Pickup contract (`rt:<index>`) –
   * disappears when left behind and is regenerated from the seed (the id is negative, it does not use up the combat numbering).
   */
  poi?: string;
  /** Wreck class for blueprint fragments (only a wreck with loot). */
  cls?: 'miner' | 'freighter' | 'pirate';
  /** Contents determined at the first analysis or loading (fragment, shard). */
  contents?: { fragment: PlanId | null; shard: boolean };
  /**
   * Salvageable wreck (M3.6): ids of the intact (valuable) grid parts. A bigger wreck cannot be
   * loaded whole – it is cut at the joints with a laser and loose parts are ripped out with the tractor beam.
   */
  dismantle?: { intact: number[] };
  /** Cutting a joint with a laser: the part and progress 0..1. */
  cutting?: { partId: number; progress: number };
  /** A piece cut off a POI wreck (POI key) – gives Data for the intact parts when loaded. */
  from?: string;
  /**
   * A player wreck: the id of the fleet ship it broke off (M4a, save V16). Part ids repeat across the
   * ships of a fleet, so a respawn reclaims restored parts only from the wrecks of the ship that died.
   */
  ship?: number;
}

/** A container with cargo (M3.6): towed with the tractor beam and loaded with F. */
export interface Container {
  id: number;
  body: Body;
  prevBody: Body;
  loot: WreckLoot;
  /** Remaining steps until it disappears. */
  ttl: number;
  /** A container at a POI wreck (`ct:<poi>:<i>`) – does not reappear after loading. */
  poi?: string;
}

/** What the tractor beam holds (a nugget since Mining 2.0). */
export type TowRef = { kind: 'wreck'; id: number } | { kind: 'container'; id: number } | { kind: 'nugget'; id: number };

/** The player's tractor beam: target and ripping a part off a wreck (progress 0..1). */
export interface TractorState {
  target: TowRef;
  rip: { partId: number; progress: number } | null;
}

/** Combat state in the simulation (saved in full, determinism). */
export interface CombatState {
  /** State of the combat RNG (mulberry32). */
  rng: number;
  /** The next projectile or wreck id. */
  nextId: number;
  enemies: Enemy[];
  /** Slot id → destruction step; the slot is restored after RESPAWN_TICKS. */
  defeated: Map<string, number>;
  projectiles: Projectile[];
  wrecks: Wreck[];
  /** Containers (M3.6). */
  containers: Container[];
}
