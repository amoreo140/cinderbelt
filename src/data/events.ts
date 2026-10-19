// Space events (long-term design 5.5). M3.5b: distress signals (5.3.5) and ion storms – deterministic
// from hash(seed, chunk/area, time bucket), only their resolution is saved; M4b adds the events
// director below. Echoes (story) are in data/echoes.ts.
import type { Security } from '../sim/regions/constants';
import type { RingIndex } from './economy';

// ---------------------------------------------------------------------------
// distress signals (5.3.5)

/** A stranded miner (fuel), a damaged ship (iron for repairs), a trap (a pirate ambush). */
export type DistressKind = 'fuel' | 'repair' | 'trap';
export const DISTRESS_KINDS: readonly DistressKind[] = ['fuel', 'repair', 'trap'];

export const DISTRESS = {
  /** Time bucket (s) – the signal lives until its end. */
  bucketSeconds: 5 * 60,
  /** Chance of a signal per chunk and bucket by ring (5.5: ~1 event per 4–6 min of flight in ring 2+). */
  chance: { 1: 0.006, 2: 0.01, 3: 0.01, 4: 0.008 } as Record<RingIndex, number>,
  weights: { fuel: 0.45, repair: 0.4, trap: 0.15 } as Record<DistressKind, number>,
  /** The signal is a broadcast – a ship hears it without a pulse within this distance (u). */
  hearRange: 900,
  /** F near the ship from this gap (u). */
  interactRange: 12,
  /** Radius of the ship in distress (a trader). */
  shipRadius: 7,
  /** Fuel for the stranded miner (u) and iron for the repair (u from the cargo). */
  fuel: [12, 25] as readonly [number, number],
  iron: 20,
  /** Trap: the ambush when the ship comes closer than this (u); number of pirates. */
  ambushRange: 140,
  ambushShips: 2,
  /** The trap gives itself away at the 2nd analysis ("signature mismatch"). */
  trapRevealScans: 2,
  /** Reward ~ a 6-minute rescue (Rescue k) and Guild points. */
  rewardSeconds: 6 * 60,
  rep: 8,
  /** No signal near home. */
  homeClear: 400,
} as const;

// ---------------------------------------------------------------------------
// ion storms (5.5): shields off, radar ×0.5 – "Ion season" makes them more frequent

export const ION_STORM = {
  /** Bucket (s) – one storm may pass in each bucket of an area. */
  bucketSeconds: 3 * 60,
  chance: { 1: 0, 2: 0.06, 3: 0.08, 4: 0.08 } as Record<RingIndex, number>,
  /** Duration (s). */
  duration: [60, 120] as readonly [number, number],
  radarMult: 0.5,
} as const;

// ---------------------------------------------------------------------------
// Events director (M4b, long-term design 5.5; M4b plan §2.2). One pure module
// (src/sim/events/director.ts) lists every space event: the legacy ones above keep their own
// generators, salts, buckets and chances (behaviour identical – golden test), the rolled ones are drawn
// per (seed, the player's sector, 60 s bucket), the derived ones follow comet passes.

/** Every kind of space event the director lists (radio, HUD event chip). */
export type DirectorEventKind = 'distress' | 'ionStorm' | 'micrometeors' | 'ambush' | 'cometFlyby' | 'convoyFlyby';
export const DIRECTOR_EVENT_KINDS: readonly DirectorEventKind[] = ['distress', 'ionStorm', 'micrometeors', 'ambush', 'cometFlyby', 'convoyFlyby'];

/** How the director gets an event: its old generator, its own roll, or from comet passes. */
export type DirectorEventMode = 'legacy' | 'rolled' | 'derived';
/** Severity of the HUD chip and the radio line. */
export type EventTone = 'info' | 'warn' | 'danger';

export interface EventDef {
  kind: DirectorEventKind;
  mode: DirectorEventMode;
  tone: EventTone;
  /** Radio / chip warning this many seconds before the event starts (0 = none). */
  leadSeconds: number;
}

export const EVENT_DEFS: Readonly<Record<DirectorEventKind, EventDef>> = {
  distress: { kind: 'distress', mode: 'legacy', tone: 'info', leadSeconds: 0 },
  ionStorm: { kind: 'ionStorm', mode: 'legacy', tone: 'warn', leadSeconds: 0 },
  micrometeors: { kind: 'micrometeors', mode: 'rolled', tone: 'warn', leadSeconds: 8 },
  ambush: { kind: 'ambush', mode: 'rolled', tone: 'danger', leadSeconds: 6 },
  cometFlyby: { kind: 'cometFlyby', mode: 'derived', tone: 'info', leadSeconds: 180 },
  // M4d: a Free Traders convoy pass comes near (data/convoys.ts CONVOY.flybyRadius / flybyLead)
  convoyFlyby: { kind: 'convoyFlyby', mode: 'derived', tone: 'info', leadSeconds: 120 },
};

/** Rolled kinds in the fixed roll order: the first whose roll succeeds is the bucket's event. */
export type RolledEventKind = 'ambush' | 'micrometeors';
export const ROLLED_EVENT_ORDER: readonly RolledEventKind[] = ['ambush', 'micrometeors'];

export const DIRECTOR = {
  /** Salt of the director stream: fnv1a32("m4director"); hash3(seed ^ salt, fnv1a32(sectorId), bucket). */
  salt: 0x8ad3_6a6c,
  /** One roll per sector and bucket (s). */
  bucketSeconds: 60,
  /** Trigger tick = bucket start + offset within this range (s). */
  offsetSeconds: [0, 40] as readonly [number, number],
  /** A rolled event fires only when the last director event ended at least this long ago (s). */
  quietSeconds: 120,
  /** …and the player is at least this far from any station (u). */
  stationClear: 600,
  /** …and the sector epoch is at least this (the first 30 min are calm). */
  minEpoch: 1,
  /** Security weight of each rolled kind (the static-or-current security of `securityHere`). */
  securityWeight: {
    micrometeors: { quiet: 1, guarded: 1, contested: 1, pirate: 1 },
    ambush: { quiet: 0, guarded: 0, contested: 1, pirate: 1.4 },
  } as Record<RolledEventKind, Record<Security, number>>,
  /** Multiplier inside a Guild Lane corridor. */
  corridor: { micrometeors: 1, ambush: 0.2 } as Record<RolledEventKind, number>,
  /** Local conditions that change the ambush rate. */
  modifierMult: { huntingGrounds: 1.5, pirateWar: 0.5 } as Readonly<Record<string, number>>,
  /** `director.fired` keys older than this many buckets are pruned. */
  pruneBuckets: 2,
} as const;

/** Micrometeor shower (DH 5.5 "P1+"): turn the armour into the stream. */
export const MICROMETEORS = {
  /** Salt of the stream rng (direction, ray offsets): fnv1a32("m4micrometeor"). */
  salt: 0x2c51_c598,
  /** Chance per 60 s bucket by the depth of the player's sector (gentle in depth 1, plan §9 q5). */
  rate: { 1: 0.04, 2: 0.08, 3: 0.08, 4: 0.1 } as Record<RingIndex, number>,
  duration: [20, 40] as readonly [number, number],
  /** Radio lead with the stream direction (s). */
  leadSeconds: 8,
  /** One ray every this many seconds across a band `bandWidth` u wide perpendicular to the stream. */
  rayInterval: 0.5,
  bandWidth: 16,
  /** Damage of a hit on the first part along the ray, by depth. Cause 'hazard'. */
  damage: { 1: 1, 2: 2, 3: 3, 4: 3 } as Record<RingIndex, number>,
  /** A raised shield absorbs the hit and drains this × the damage. */
  shieldDrainMult: 2,
} as const;

/** Ambush (DH: 2–4 pirates come out of the dark). */
export const AMBUSH = {
  /** Salt of the party rng: fnv1a32("m4ambush"). */
  salt: 0x8c5c_4aa0,
  /** Chance per 60 s bucket by depth (before the security, corridor and local-condition weights). */
  rate: { 1: 0, 2: 0.1, 3: 0.12, 4: 0.14 } as Record<RingIndex, number>,
  /** Radio "Contacts at 5 o'clock" this long before the party spawns (s). */
  leadSeconds: 6,
  /** The party spawns this far away, on a bearing that lies in a dangerous sector (u). */
  spawnDistance: 300,
  /** AI budget (DH §12.4 ≤ 10 AI ships): fewer than `maxNearby` enemies within `nearbyRange`, fewer than `maxEnemies` in total. */
  maxNearby: 4,
  nearbyRange: 600,
  maxEnemies: 7,
  /** Depth 3: the leader is a Gunner with this chance, else a Hammer. */
  gunnerLeaderChance: 0.3,
  /** Party size [min, max] and tier by depth (depth 2: Hammer + 1–2 Jackals). */
  party: {
    1: { size: [0, 0], tier: 1 },
    2: { size: [2, 3], tier: 1 },
    3: { size: [3, 3], tier: 1 },
    4: { size: [3, 4], tier: 2 },
  } as Record<RingIndex, { size: readonly [number, number]; tier: 1 | 2 }>,
} as const;

/** Comet flyby (derived from comet passes, src/sim/events/cometFlyby.ts). */
export const COMET_FLYBY = {
  /** Announce a pass that comes within this distance of the player… */
  range: 1_500,
  /** …in the next this many seconds (once per comet pass). */
  leadSeconds: 180,
} as const;
