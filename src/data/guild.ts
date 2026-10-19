// M4d "Guild and trade" – the Guild (M4d plan §2.2,
// §2.3, §3): the Guild Watch as live ships near the player and the Guild relay chain that secures a
// Contested lane sector. Every number lives here – the logic is in src/sim/guild. The values are the
// starting tune; the econ/bot task (T16) may retune them within ±30 % and reports it.
//
// User decision 2026-10-16: NO friendly fire – the player can never hit a Guild Watch ship or a convoy,
// so there is no offence / hostility / fine table here.
import type { EnemyKind } from '../sim/combat/types';
import type { Depth } from '../sim/regions/constants';
import type { Cargo } from './resources';
import type { RelayLayout } from './sites';
import layoutsJson from './derelict_layouts.json';

/** The two Guild Watch hulls (art batch C: `npc/guild_cutter`, `npc/guild_frigate`). */
export type WatchKind = 'cutter' | 'frigate';
export const WATCH_KINDS: readonly WatchKind[] = ['cutter', 'frigate'];

/** One gun of a Watch ship (the models are single meshes – no part grid, art §2.7.24). */
export interface WatchGunDef {
  damage: number;
  /** Shots per second. */
  rate: number;
  range: number;
  /** Half-angle of the firing arc around the bow (rad); π = a 360° turret. */
  arc: number;
  /**
   * Muzzle in the ship's local frame (+X = bow, +Y = left), game units – the glTF `muzzle_<i>` node at rest
   * (glTF x → +X, glTF z → −Y).
   */
  muzzle: { x: number; y: number };
  /** A turret's yaw pivot (local frame): the muzzle turns around it toward the aim (`Turret_0`). */
  pivot?: { x: number; y: number };
}

export interface WatchShipDef {
  /** Collision and hit radius (u). */
  radius: number;
  hull: number;
  shield: number;
  /** Shield regeneration (per second) after `shieldDelay` seconds without a hit. */
  shieldRegen: number;
  shieldDelay: number;
  /** Kinematic flight: max speed (u/s), acceleration (u/s²), turn rate (rad/s). */
  maxSpeed: number;
  accel: number;
  turn: number;
  /** Orbit distance around an engaged target (u). */
  orbit: number;
  guns: readonly WatchGunDef[];
}

const DEG = Math.PI / 180;

export const WATCH = {
  /** A scheduled Watch ship within this distance of the flying player becomes a live sim ship (u). */
  liveRadius: 520,
  /** A live ship in `patrol` beyond this distance returns to the schedule (removed, u). */
  despawnRadius: 800,
  /** At most this many live Watch ships at once. */
  maxLive: 3,
  /** Pirates + live Watch + escort convoy ships never exceed this (DH §12.4; pirates keep priority). */
  aiBudget: 10,
  /** Engage a pirate in the beat within this distance (u). */
  engageRange: 260,
  /** Defend the player / the escorted convoy from pirates within this distance of the Watch ship (u). */
  defendRange: 400,
  /** Never farther than this from the ship's scheduled point of the tick (then `return`, u). */
  leash: 450,
  /** Hull share below which the ship retreats. */
  retreatHull: 0.25,
  /** A retreating ship farther than this from the player leaves (u). */
  retreatLeave: 600,
  /** `return` flies at this multiple of the max speed back to the schedule… */
  catchUp: 1.3,
  /** …and becomes `patrol` within this distance of the scheduled pose (u). */
  returnRadius: 10,
  /** A pirate that hit this ship within this many seconds is a retaliation target. */
  retaliateSeconds: 4,
  /** Target choice period (s). */
  retargetSeconds: 0.5,
  /** A destroyed (or retreated) Watch ship is back on its route after 20 game minutes. */
  respawnTicks: 20 * 60 * 60,
  /** The Watch radio ("Kontakt, zasahujeme.") at most once per this many seconds. */
  radioSeconds: 60,
  /** Route cell of the sector patrols (u) – the existing render math (guildWatch.ts). */
  sectorCell: 900,
  ships: {
    cutter: {
      radius: 3.6,
      hull: 220,
      shield: 60,
      shieldRegen: 6,
      shieldDelay: 3,
      maxSpeed: 34,
      accel: 18,
      turn: 2.2,
      orbit: 60,
      // guns 6.5 dmg × 1.8/s (T3 balance, +30 % each over the first tune 5 × 1.4): 2 cutters beat a Hammer +
      // Jackal in 40–120 s but lose to a depth-3 trio (src/sim/guild/watchBalance.test.ts)
      guns: [
        { damage: 6.5, rate: 1.8, range: 95, arc: 35 * DEG, muzzle: { x: 1.55, y: 1.12 } },
        { damage: 6.5, rate: 1.8, range: 95, arc: 35 * DEG, muzzle: { x: 1.55, y: -1.12 } },
      ],
    },
    frigate: {
      radius: 6.8,
      hull: 640,
      shield: 160,
      shieldRegen: 10,
      shieldDelay: 3,
      maxSpeed: 22,
      accel: 9,
      turn: 1.0,
      orbit: 90,
      guns: [
        { damage: 9, rate: 0.9, range: 115, arc: Math.PI, muzzle: { x: 2.6, y: -0.09 }, pivot: { x: 0.6, y: 0 } },
        { damage: 9, rate: 0.9, range: 115, arc: Math.PI, muzzle: { x: 2.6, y: 0.09 }, pivot: { x: 0.6, y: 0 } },
      ],
    },
  } as Readonly<Record<WatchKind, WatchShipDef>>,
} as const;

/** The Guild relay mast (art: `guild_relay_mast` in derelict_layouts.json – the same frame as a derelict relay). */
export const GUILD_RELAY_LAYOUT: RelayLayout = (layoutsJson as unknown as { guild_relay_mast: RelayLayout }).guild_relay_mast;

/** The relay chain (§2.2): repair → power → hold → the lane sector is Guarded for good. */
export const RELAY_CHAIN = {
  /** Guild reputation level that unlocks the relay contract (the `guildRelay` unlock, data/factions.ts). */
  minRep: 2,
  /** Repair materials, taken from the ship's cargo (raw first). */
  repair: { iron: 60, copper: 40, titanium: 10 } as Readonly<Partial<Cargo>>,
  /** The mast stands this far to the right of the outbound lane direction (u). */
  side: 70,
  /** Site candidates in order: offsets along the lane from the run's middle × side offsets (u). */
  along: [0, 150, -150, 300, -300] as readonly number[],
  sides: [70, -70, 110] as readonly number[],
  /** Clearances of the mast site (u, added to the obstacle's own radius). */
  clear: { station: 50, site: 40, rock: 20, fortress: 150, survey: 30, poi: 30 },
  /** Depths a relay sector may have (lane A may fall back to depth 3). */
  depths: [2, 3] as readonly Depth[],
  /** Pinned offer at stations within this distance of a relay site whose lane is not secured (u). */
  offerRange: 3200,
  /** Contract risk (the k of the reward formula is `CONTRACT_DEFS.relay.k`). */
  risk: 0.5 as const,
  /** Rust counterattack: distance from the mast on the bearing away from home (u) and the warning lead (s). */
  counterattackDistance: 320,
  counterattackDelay: 6,
  /** The counterattack party by the sector's depth (all T1). */
  party: { 2: ['hammer', 'jackal', 'jackal'], 3: ['gunner', 'hammer', 'jackal'] } as Readonly<Record<2 | 3, readonly EnemyKind[]>>,
  /** The Guild reinforcement (frigate + 2 cutters) arrives this long after the counterattack (s)… */
  watchArrive: 25,
  /** …from this far along the lane (u). */
  watchFrom: 500,
  reinforcement: ['frigate', 'cutter', 'cutter'] as readonly WatchKind[],
  /** The hold is won when every counterattack ship is destroyed or farther than this from the mast (u). */
  fledRadius: 600,
  /** The hold is interrupted when the player is farther than this from the mast (u)… */
  holdRadius: 900,
  /** …and re-arms when the player comes back within this distance (u). */
  rearmRadius: 400,
} as const;
