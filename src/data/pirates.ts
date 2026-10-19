// Pirates M3.6 (long-term design 6.2–6.5): the Scavenger, pirate attention, toll, clan challenge, raids
// and the Rust fortress; M4b adds the Gunner and the derelict sentry – numbers as data, logic in src/sim/pirates.
import type { RingIndex } from './economy';

// ---------------------------------------------------------------------------
// Pirate groups (spec 2.7, design 6.2) by the DEPTH of the chunk's sector (sectors design §6.1);
// the sector's security and the Guild Lane corridor multiply the rate (src/sim/regions).

export const PIRATE_GROUPS = {
  /** Average pirate groups per chunk at normal density (depth 1 is safe except the pirate corner). */
  rate: { 1: 0, 2: 0.08, 3: 0.12, 4: 0.16 } as Record<RingIndex, number>,
  /** Share of groups led by a Hammer. */
  hammerShare: { 1: 0, 2: 0.2, 3: 0.5, 4: 0.6 } as Record<RingIndex, number>,
} as const;

// ---------------------------------------------------------------------------
// Scavenger (6.2): ignores the player, steals loot, runs when hit

export const SCAVENGER = {
  /** Lone scavenger chance per chunk by sector depth (× security, corridor and enemy density). */
  chunkChance: { 1: 0, 2: 0.05, 3: 0.06, 4: 0.06 } as Record<RingIndex, number>,
  /** Chance that a scavenger waits at a medium or large POI wreck (depth 2+). */
  wreckChance: 0.4,
  /** The scavenger waits this far from the wreck (u). */
  wreckOffset: 70,
  /** It sees loot within this distance (u). */
  sight: 220,
  /** It steals loot from this gap to the object (u). */
  grab: 2.5,
  /** It tows a wreck of at most this many parts. */
  maxParts: 6,
  /** After a theft it patrols for a while (steps). */
  pause: 90,
  /** When hit it runs at least this many steps and until it is farther than `fleeSafe`. */
  fleeTicks: 10 * 60,
  fleeSafe: 320,
  patrolRadius: 50,
  /** Its own cargo (u of iron; copper ×0.6, titanium ×0.5 in depth 2+) and the chance of a part. */
  hold: [18, 34] as readonly [number, number],
  partChance: 0.35,
} as const;

// ---------------------------------------------------------------------------
// Pirate attention (6.3): grows only from activity, decays with time; the peak is content, not a punishment

export const ATTENTION = {
  max: 100,
  /** +1 per this many credits of cargo (base prices) when entering another chunk of a dangerous sector. */
  cargoPerPoint: 2000,
  /** Flying through a dangerous (Contested or Pirate) sector: every new chunk entered. */
  newChunk: 0.25,
  /** First contact with a Pirate sector (its first explored chunk – derived from `explored`, sectors §3.1). */
  pirateSectorFirst: 2,
  /** Destroyed pirate. */
  kill: 2,
  /** Destroyed fortress (like a nest in 6.3). */
  fortress: -25,
  /** Paid toll. */
  toll: -10,
  /** Decay: −1 per 3 game minutes outside dangerous sectors (Quiet, Guarded, docked), −1 per 9 minutes inside. */
  decayOutsideTicks: 3 * 60 * 60,
  decayInsideTicks: 9 * 60 * 60,
  /** Level thresholds: 30 scouts, 60 hunting party, 90 announced raid. */
  levels: [30, 60, 90] as readonly [number, number, number],
  /** After a raid (defended or not) attention drops to this. */
  afterRaid: 40,
  /** Enemy density multiplies all gains (low: no raids, attention stops below the raid level). */
  densityMult: { low: 0.5, normal: 1, high: 1.5 } as Record<'low' | 'normal' | 'high', number>,
  /** Spawn chance multiplier, extra hammer share and loot multiplier by level 0–3. */
  spawnMult: [1, 1.3, 1.5, 1.5] as readonly number[],
  hammerBonus: [0, 0.1, 0.2, 0.2] as readonly number[],
  lootMult: [1, 1.2, 1.4, 1.4] as readonly number[],
} as const;

/** Attention level 0–3 (0–29, 30–59, 60–89, 90+). */
export const attentionLevel = (attention: number): 0 | 1 | 2 | 3 =>
  attention >= ATTENTION.levels[2] ? 3 : attention >= ATTENTION.levels[1] ? 2 : attention >= ATTENTION.levels[0] ? 1 : 0;

// ---------------------------------------------------------------------------
// Toll (6.3, question 8): a pirate group led by a Hammer may hail the player and demand a toll

export const TOLL = {
  /**
   * Chance that a hammer-led group hails instead of attacking (per group and respawn period), by the
   * security of the sector the player is in (sectors design §3.1: Guarded never, Contested 0.6, Pirate 0.75).
   */
  chance: { quiet: 0, guarded: 0, contested: 0.6, pirate: 0.75 } as { readonly quiet: number; readonly guarded: number; readonly contested: number; readonly pirate: number },
  /** Seconds to answer (Y pay / X refuse) before they open fire. */
  seconds: 20,
  /** Fly this far from the whole group to slip away. */
  escape: 250,
  /** A paid group leaves the player alone this long (s); a group asks only once per this period. */
  calmSeconds: 10 * 60,
  /** Amount: base + per sector depth + share of the cargo value, rounded to 50. */
  base: 150,
  perDepth: 100,
  cargoShare: 0.1,
  /** Hailing pirates hold this distance. */
  hailDistance: 45,
} as const;

// ---------------------------------------------------------------------------
// Hunting party (60+) and raids (90+), clan challenge (pirate beacon, F)

export const HUNT = {
  /** At most one hunting party per this many game minutes. */
  cooldownTicks: 12 * 60 * 60,
  /** Spawned this far from the player (out of view). */
  distance: 330,
  jackals: 2,
} as const;

export const RAID = {
  /** Natural raid is announced this long ahead (7.7: 8 game minutes). */
  announceTicks: 8 * 60 * 60,
  /** Clan challenge: the duel comes sooner (within the 8 minutes of 6.3). */
  challengeTicks: 3 * 60 * 60,
  /** The raid fleet waits this long at the target, then leaves. */
  lingerTicks: 6 * 60 * 60,
  /** Fleet appears when the player comes this close. */
  spawnRange: 600,
  /** Escorts (one Hammer, rest Jackals). */
  escorts: 3,
  /** War chest: credits in hours of the ring reference income, containers with rich loot. */
  chestHours: 0.35,
  chestContainers: 3,
  /** Beacon usable again after a raid this long (game minutes). */
  beaconCooldownTicks: 20 * 60 * 60,
  /** F at the beacon from this gap (j). */
  beaconRange: 10,
} as const;

// ---------------------------------------------------------------------------
// Rust fortress (6.5): turrets, two shield generators to destroy first, the core, reinforcements

export const FORTRESS = {
  /** Fortresses per seed (2–4 in the design), all in ring 2. */
  count: 3,
  /** Distance from home (j). */
  distance: [2300, 3400] as readonly [number, number],
  /** HP of the parts. */
  turretHp: 160,
  generatorHp: 360,
  coreHp: 1600,
  /** Hit circles of turrets and generators (j). */
  turretRadius: 1.8,
  generatorRadius: 2.4,
  /** Turret gun: like a T2 pirate cannon with a longer reach (aimed with the difficulty's aim error, combat/aim.ts). */
  turret: { damage: 5, fireRate: 0.9, projectileSpeed: 80, range: 130 },
  /** Turrets and reinforcements wake up when the player is this close. */
  aggroRange: 170,
  /** Reinforcements every 45 s from spawn_0 (6.5) while the player is near; at most this many alive. */
  reinforceTicks: 45 * 60,
  reinforceMax: 3,
  reinforceRange: 450,
  /** Rebuilt this long after destruction (the boss returns with a smaller reward). */
  rebuildTicks: 60 * 60 * 60,
  /** Rewards (6.5): 20 000 kr, Resonator (first time), fragments, guild reputation, war chest. */
  credits: 20000,
  rebuiltCredits: 6000,
  fragments: 2,
  rep: 40,
  data: 80,
  chestContainers: 4,
} as const;

// ---------------------------------------------------------------------------
// Gunner (M4b, design 6.2; M4b plan §2.6): 20–25 parts with three
// forward cannons; keeps its distance, evades when the player closes in, flees at low hull.

export const GUNNER = {
  /** Salt of the separate leader roll of a regular group: fnv1a32("m4gunner"); hash3(seed ^ salt, cx, cy). */
  salt: 0xaa26_c1c7,
  /** Share of regular groups (by depth) whose leader (slot 0) becomes a Gunner – group size and slot ids stay. */
  groupShare: { 1: 0, 2: 0, 3: 0.25, 4: 0.3 } as Record<RingIndex, number>,
  /** Parts of its grid (valid: connected, no covered nozzle). */
  parts: [20, 25] as readonly [number, number],
  cannons: 3,
  /** Gunners always carry T2 cannons (range 100). */
  cannonTier: 2 as const,
  /** Standoff = min(maxStandoff, standoffShare × its cannon range): 90 u with T2 cannons (plan §9 q3). */
  maxStandoff: 120,
  standoffShare: 0.9,
  /** Standoff band: speed relative to the target it flies to its standoff point at most (u/s)… */
  moveSpeed: 9,
  /** …slowing down near the point (u/s per u of distance)… */
  closeGain: 0.5,
  /** …and never faster than this (u/s, world frame) – a ship that chases it faster closes in (no kiting). */
  cruiseSpeed: 16,
  /** The standoff point leads the current bearing by this angle (rad) – it drifts slowly around the target. */
  orbitStep: 0.12,
  /** Fires when the target is within this share of its cannon range (the shots reach 100 u, the standoff is 90). */
  fireShare: 0.96,
  /**
   * Artillery salvos: it fires for `on` seconds (two volleys of its three cannons), then re-aims for
   * `off` seconds. Three T2 cannons at full rate strip a starter ship in 15–30 s; with the salvos the
   * starter lasts 70 s+ on Standard (the bar is 40 s – fairness test), ~30–100 s on Hard.
   */
  salvo: { on: 0.6, off: 2 },
  /** It evades (mode 'evade') when the player is within this share of the standoff… */
  evadeShare: 0.5,
  /** …for this long (s), full thrust away and sideways, then back to the standoff. */
  evadeSeconds: [4, 6] as readonly [number, number],
  /** Evade heading: this far (rad) from straight away from the player, to the side of its orbit. */
  evadeAngle: 0.7,
  /** Flees below this share of its hull. */
  fleeHull: 0.35,
  aggroRange: 180,
  leashRange: 420,
  /** A hunting party at attention 60+ whose point lies in a Pirate sector of this depth swaps one Jackal for a Gunner. */
  huntDepth: 2,
  /** Every n-th fortress reinforcement is a Gunner. */
  fortressEvery: 3,
} as const;

// ---------------------------------------------------------------------------
// Sentry drone of a derelict station (M4b, plan §2.4): 5 parts (cockpit, cannon, 2 engines, armour),
// guards its derelict, never flees, never tolls, never respawns.

export const SENTRY = {
  parts: 5,
  /** T1 at depth 2, T2 from depth 3 (the derelict's depth). */
  t2FromDepth: 3,
  /** Attacks within this distance of the derelict; never farther from it than the leash (u). */
  guardRadius: 160,
  leash: 260,
  aggroRange: 160,
  /** Orbit distance around the target while attacking (u). */
  orbit: 28,
  /** Within this distance (u) of the point it wants to be at, it holds still and turns its gun like a turret. */
  holdRadius: 8,
  /** It fights from at most `leash − leashMargin` from the derelict (room to brake before the leash). */
  leashMargin: 25,
  /** Top speed of its chase (it brakes before its leash) and its cruise back to its post (u/s). */
  chaseSpeed: 25,
  returnSpeed: 12,
} as const;
