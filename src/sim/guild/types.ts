// The Guild in the simulation (M4d plan §2.2, §2.3, §3): the relay chain that secures a Contested lane
// sector and the Guild Watch as live ships near the player. Pure data – the logic is in the other files
// of this folder (see index.ts). Saved from V20 (T15): `relays`, `hold`, `watch`, `lost`, `lastRadio`.
//
// User decision 2026-10-16: NO friendly fire – there is no offence / hostility / fine state and no
// `hostile` Watch mode.
import type { ShipRef } from '../combat/types';
import type { Vec2 } from '../math/vec2';
import type { Body } from '../physics/body';
import type { Depth } from '../regions/constants';
import type { LaneId } from '../regions/lanes';
import type { RelaySite } from '../sites/types';
import type { WatchKind } from '../../data/guild';

export type { WatchKind } from '../../data/guild';
export type { LaneId } from '../regions/lanes';

/**
 * patrol = kinematic on the schedule (pose = schedule pose); engage = fights a pirate (target choice every
 * 0.5 s); return = flies back to the scheduled pose; retreat = hull < 25 %: away from the nearest pirate.
 */
export type WatchMode = 'patrol' | 'engage' | 'return' | 'retreat';
export const WATCH_MODES: readonly WatchMode[] = ['patrol', 'engage', 'return', 'retreat'];

/** A live Guild Watch ship (`gw:<routeId>|<slot>`). No part grid – one hull and one shield bubble. */
export interface WatchShip {
  id: string;
  kind: WatchKind;
  body: Body;
  /** The pose before the last step (render interpolation; not saved – equals `body` after a load). */
  prevBody: Body;
  hull: number;
  shield: number;
  /** Seconds until the shield regenerates again. */
  shieldDelay: number;
  /** Per gun (`WATCH.ships[kind].guns` order): seconds until it may fire again. */
  cooldowns: number[];
  mode: WatchMode;
  /** The pirate being engaged (or null). */
  target: ShipRef | null;
  /** The schedule route (`lane:A:0`, `sector:12,-3`, `relay:A`) and the ship's slot on it. */
  route: string;
  slot: number;
  /** Tick the current mode started. */
  modeTick: number;
  /** Tick a pirate last hit this ship (-1 = never) – the retaliation target window. */
  lastHitBy: number;
}

/** A lane's relay chain stage (no record = broken, not repaired). */
export type RelayStage = 'repaired' | 'powered' | 'secured';
export const RELAY_STAGES: readonly RelayStage[] = ['repaired', 'powered', 'secured'];

export interface RelayRecord {
  stage: RelayStage;
  /** The relay's sector, stored so a later retune of `guildRelaySites` never moves a secured sector. */
  sector: string;
  /** Tick the stage was reached. */
  tick: number;
}

/** The running hold of a powered relay against the Rust counterattack. */
export interface RelayHold {
  lane: LaneId;
  /** Tick the counterattack spawns (the radio warns `RELAY_CHAIN.counterattackDelay` s before). */
  start: number;
  /** warning = before `start`; fight = the counterattack is on; idle = interrupted, re-arms near the mast. */
  phase: 'warning' | 'fight' | 'idle';
  /** The Guild reinforcement has arrived. */
  reinforced: boolean;
}

export interface GuildState {
  /** Relay chain stage per lane (only lanes with progress). */
  relays: Map<LaneId, RelayRecord>;
  hold: RelayHold | null;
  /** Live Watch ships (materialised near the player, or the relay reinforcement). */
  watch: WatchShip[];
  /** Watch ship ids destroyed / retreated → tick; back on the schedule after `WATCH.respawnTicks`. */
  lost: Map<string, number>;
  /** Tick of the last Watch radio line (-1e9 = never). */
  lastRadio: number;
}

/** A lane's Guild relay site (pure, from the seed – `guildRelaySites`). */
export interface GuildRelaySite {
  lane: LaneId;
  /** `gr:<lane>` */
  id: string;
  sector: string;
  depth: Depth;
  pos: Vec2;
  /** Facing the lane (rad). */
  angle: number;
  /** The mast as a generic relay (owner 'guild', group = id) for `stepRelays`. */
  relay: RelaySite;
}

/** F at the broken mast of an active relay contract: repair it with materials from the ship's cargo. */
export interface RelayInteraction {
  kind: 'relayRepair';
  contract: number;
  lane: LaneId;
  pos: Vec2;
}

/** Sim events of the Guild (part of SimEvent). */
export type GuildEvent =
  /** A Watch ship engaged a pirate (`target` = the pirate's ref). */
  | { type: 'watchEngaged'; id: string; target: ShipRef }
  /** A damaged Watch ship retreats. */
  | { type: 'watchRetreated'; id: string }
  | { type: 'relayRepaired'; lane: LaneId }
  /** The Rust counterattack of a powered relay is coming (warning) – `at` = where it spawns. */
  | { type: 'relayHoldStarted'; lane: LaneId; at: Vec2 }
  /** The hold is won: the sector is Guarded for good. */
  | { type: 'sectorSecured'; lane: LaneId; sector: string };
