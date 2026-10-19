// World sites of M4b "World Comes Alive" – the shared contract (the M4b plan
// §2.1, §2.3–§2.5, §3). Derelict stations with three relays, ship graveyards (wrecks, live mines, a
// sleeping pirate party) and comets. Sites and comets are pure functions of the seed (and of the tick
// for comets); only what the player changed is saved (`SitesState`, save V17 by T11).
//
// Ids (stable, also the save keys, §2.1):
//   derelict  `dl:<cx>,<cy>`        its relays `dl:<cx>,<cy>:r<0-2>`   its sentries `dd:<cx>,<cy>:<i>`
//   graveyard `gy:<cx>,<cy>`        its wrecks `gy:<cx>,<cy>#<i>`      mines `gy:<cx>,<cy>:m<i>`
//                                   sleepers `gs:<cx>,<cy>:<i>`
//   comet     `cm:<n>`              Guild relay (M4d, reserved) `gr:<lane>`
import type { DerelictModel } from '../../data/sites';
import type { PartKey } from '../../data/parts';
import type { PlanId } from '../../data/plans';
import type { EnemyKind } from '../combat/types';
import type { Vec2 } from '../math/vec2';
import type { Depth } from '../regions/constants';
import type { DockStatus } from '../station/dock';

export type SiteKind = 'derelict' | 'graveyard';

/** Who a relay belongs to. `relays.ts` treats both the same (M4d reuses it for the Guild relay). */
export type RelayOwner = 'derelict' | 'guild';

/** A relay mast: hold a mining beam on its receiver (`RELAY_LAYOUT.powerTarget`) for 5 s to power it. */
export interface RelaySite {
  /** `dl:<cx>,<cy>:r<i>` (derelict) or `gr:<lane>` (Guild, M4d). */
  id: string;
  pos: Vec2;
  /** Rotation of the relay layout (rad). */
  angle: number;
  owner: RelayOwner;
  /**
   * The group the relay counts in (`relayPowered.lit` = powered relays of the group): the derelict id for
   * derelict relays, the relay's own id for a Guild relay. `relays.ts` never interprets it.
   */
  group: string;
}

export type DerelictDefence = 'sentries' | 'storm' | 'none';
export type DerelictService = 'stash' | 'plan' | 'fabricator';

/** An abandoned station (DH §5.3.2): a static obstacle with a dock clamp at (R, 0) rotated by `angle`. */
export interface DerelictSite {
  kind: 'derelict';
  /** `dl:<cx>,<cy>` */
  id: string;
  cx: number;
  cy: number;
  pos: Vec2;
  /** Rotation of the layout; the dock port direction (`DockTarget.portAngle`). */
  angle: number;
  model: DerelictModel;
  /** Depth of the chunk's sector (placement reads the static sector, never `currentSecurity`). */
  depth: Depth;
  /** Always `RELAY.count` relays, 60–120 u from the derelict. */
  relays: RelaySite[];
  defence: DerelictDefence;
  service: DerelictService;
}

/** A ship graveyard (DH §5.3): 10–20 dismantlable wrecks in a 200 u field, live mines, maybe a sleeping party. */
export interface GraveyardSite {
  kind: 'graveyard';
  /** `gy:<cx>,<cy>` */
  id: string;
  cx: number;
  cy: number;
  /** Centre of the field. */
  pos: Vec2;
  depth: Depth;
  /** Number of wrecks; wreck i has the key `gy:<cx>,<cy>#<i>` (placed by `wreckGrid`-like rules, T5). */
  wrecks: number;
  /** Mine i (`gy:<cx>,<cy>:m<i>`) sits here. */
  mines: Vec2[];
  /** Kinds of the sleeping party (empty = none); sleeper i has the id `gs:<cx>,<cy>:<i>`. */
  sleepers: EnemyKind[];
}

export type Site = DerelictSite | GraveyardSite;

// ---------------------------------------------------------------------------
// saved state (only touched sites)

export interface DerelictState {
  /** Tick its defence woke (the 2nd relay lit), null = asleep. Wakes once. */
  woke: number | null;
  /** Bitmask of the terminal items taken (bit = `TerminalOfferItem.index`). */
  taken: number;
  /** The first berth happened: the Data and the journal log were given (once). */
  visited: boolean;
}

export interface GraveyardState {
  /** Bitmask of the mines that are gone (blown or shot). */
  mines: number;
  party: 'asleep' | 'awake' | 'cleared';
  /** The graveyard's first-analysis Data were given. */
  data: boolean;
  /** Fragment rolls used (≤ `GRAVEYARD.fragmentRolls`). */
  rolls: number;
}

/** A comet the player touched in its current pass (older passes are dropped). */
export interface CometState {
  /** Pass index the budgets belong to. */
  pass: number;
  /** Nucleus rock units mined in this pass (of `COMET.budget`). */
  core: number;
  /** Bitmask of the tail shards mined in this pass. */
  tail: number;
}

export interface SitesState {
  /** Powered relay ids (derelict now, Guild relays in M4d) – permanent. */
  powered: Set<string>;
  /** The relay being charged (one at a time) and its charge in seconds of beam (0..RELAY.powerSeconds). */
  charge: { id: string; progress: number } | null;
  /** Derelict id while the ship is berthed at its clamp (not docked at a station: no respawn, market, hub). */
  berth: string | null;
  /** Only touched derelicts. */
  derelicts: Map<string, DerelictState>;
  /** Only touched graveyards. */
  graveyards: Map<string, GraveyardState>;
  /** Current pass only. */
  comets: Map<string, CometState>;
}

// ---------------------------------------------------------------------------
// comets (§2.3) – positions are pure functions of the tick, nothing about them is saved

/** A comet of the seed (T2 may add fields it needs internally; consumers use only these). */
export interface CometDef {
  /** `cm:<n>` */
  id: string;
  n: number;
  /** Depth band of its perihelion. */
  depth: Depth;
  /** Orbit period and pass length (ticks). */
  periodTicks: number;
  passTicks: number;
  /** Speed along the pass (u/s). */
  speed: number;
}

/** A comet in its pass at a tick (`cometAt`). Outside the pass the comet is "away" (null). */
export interface CometPose {
  id: string;
  /** Pass index (budgets refresh every pass). */
  pass: number;
  pos: Vec2;
  vel: Vec2;
  /** Progress through the pass, 0..1 (render fade in / out at the ends). */
  t: number;
}

/** A tail shard of a comet (positions relative to the nucleus, away from home; shared by sim and render). */
export interface CometShard {
  /** 0..COMET.tail.shards-1 (bit in `CometState.tail`). */
  index: number;
  pos: Vec2;
  radius: number;
}

// ---------------------------------------------------------------------------
// combat hooks: projectiles that hit a site (combat.ts asks `siteHitTargets`, then calls `onSiteHit`)

export type SiteHitKind = 'mine' | 'structure' | 'comet';

export interface SiteHitTarget {
  /** Mine id (`gy:…:m<i>`), derelict / relay id, or comet id. */
  id: string;
  kind: SiteHitKind;
  pos: Vec2;
  radius: number;
}

/** The projectile that hit a site (the projectile is consumed). */
export interface SiteHit {
  owner: string;
  pos: Vec2;
  damage: number;
  /** Where the projectile came from (hit indicator). */
  from: Vec2;
}

/** A local ion storm of a derelict's defence (§2.2): consumed by `stormAt` (src/sim/events/storms.ts). */
export interface SiteStorm {
  /** The derelict id. */
  id: string;
  pos: Vec2;
  radius: number;
  /** Ticks [start, end). */
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------
// derelict terminal (§2.4) – what the sim offers; the game layer (T7) turns it into DerelictTerminalData

/** What a terminal item is. */
export type TerminalItemWhat =
  /** A stashed part (to the ship's part hold, 10 cargo). */
  | { kind: 'part'; key: PartKey }
  /** Fragments of one plan (awardFragment, source 'derelict'). */
  | { kind: 'fragments'; plan: PlanId; count: number }
  /** One free craft of a part ≤ T2 from the ship's cargo (the part is chosen by `derelictTake.key`). */
  | { kind: 'fabricate' };

export interface TerminalOfferItem {
  /** Bit in `DerelictState.taken`; the `item` of a `derelictTake` action. */
  index: number;
  what: TerminalItemWhat;
  taken: boolean;
}

export interface TerminalOffer {
  /** The derelict id. */
  site: string;
  model: DerelictModel;
  /** Data the first berth gives (`DERELICT.data`); null once given. */
  data: number | null;
  /** Journal entry of the model's log (`derelictLog_<model>`); null when already unlocked. */
  log: string | null;
  service: DerelictService;
  items: TerminalOfferItem[];
}

/** What a taken terminal item gave (`derelictTaken.what`). */
export type TakenWhat = { kind: 'part'; key: PartKey } | { kind: 'fragments'; plan: PlanId; count: number } | { kind: 'crafted'; key: PartKey };

/** Result of an F press near a derelict clamp (`tryBerth`). */
export type BerthAttempt =
  /** No derelict clamp is the nearest dock target – the station dock runs as usual. */
  | 'none'
  /** The ship berthed (latch started). */
  | 'berthed'
  /** A derelict clamp is the target but the berth was refused (`berthRejected` sent). */
  | 'rejected';

// ---------------------------------------------------------------------------
// sim events of the sites (part of SimEvent)

export type SiteEvent =
  /** A comet became known: seen within radar or reached as a signal (T2). */
  | { type: 'cometSighted'; id: string; pos: Vec2 }
  /** A relay is charging (sent when the charge starts and every quarter); progress 0..1. */
  | { type: 'relayCharging'; id: string; progress: number }
  /** A relay is powered; `site` = its group (derelict id), `lit` = powered relays of the group now. */
  | { type: 'relayPowered'; id: string; site: string; lit: number }
  /** A derelict's defence woke (2nd relay lit). */
  | { type: 'derelictWoke'; id: string; defence: DerelictDefence }
  /** F at a derelict clamp refused: not all relays powered, or the manoeuvre rules (like `dockRejected`). */
  | { type: 'berthRejected'; id: string; reason: 'relaysUnpowered' | Exclude<DockStatus, 'ok' | 'noStation'>; distance: number; speed: number; angle: number }
  | { type: 'berthed'; id: string }
  | { type: 'berthLeft'; id: string }
  /** First berth: Data given (0 when none) and the journal entry unlocked (null when none). */
  | { type: 'derelictVisited'; id: string; data: number; journal: string | null }
  /** A terminal item taken. */
  | { type: 'derelictTaken'; id: string; item: number; what: TakenWhat }
  | { type: 'mineArmed'; id: string; pos: Vec2 }
  | { type: 'mineExploded'; id: string; pos: Vec2 }
  /** A graveyard's sleeping party woke (`id` = graveyard id). */
  | { type: 'sleepersWoke'; id: string; pos: Vec2 };
