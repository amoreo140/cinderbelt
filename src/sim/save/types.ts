// Save game format (spec M2, 5.8 and 9; slots per decision 15.7).
// Plain JSON data – no Map/Set, no classes.
import type { PartId, PartInventory, PartKey, Tier } from '../../data/parts';
import type { ArchiveNodeId } from '../../data/archive';
import type { HomeModuleId } from '../../data/home';
import type { PaintId } from '../../data/paints';
import type { AtlasCollection } from '../../data/atlas';
import type { KeyItemId } from '../../data/echoes';
import type { FragmentSource, PlanId } from '../../data/plans';
import type { WreckClass } from '../../data/poi';
import type { ShapeId } from '../../data/shapes';
import type { VariantId } from '../../data/variants';
import type { Buff, DiscoveryLogEntry, Fix, ScannerState, Signal } from '../discovery/types';
import type { AiMode, EnemyKind, Livery, TractorState } from '../combat/types';
import type { FortressState, Raid, Toll } from '../pirates/state';
import type { Cargo, ResourceId } from '../../data/resources';
import type { Vec2 } from '../math/vec2';
import type { DeathPenalty, GameSettings } from '../settings';
import type { GameStats } from '../Simulation';
import type { Rotation } from '../ship/types';
import type { StationId } from '../world/stations';
import type { WorldGen } from '../world/worldGen';
import type { RegionGenId } from '../regions/constants';
import type { TrainingState } from '../training/types';
import type { TrophyId } from '../home/types';
import type { ContractType } from '../../data/contracts';
import type { RepFactionId } from '../../data/factions';
import type { WatchKind } from '../../data/guild';
import type { NoteIcon } from '../../data/navigation';
import type { RelayStage, WatchMode } from '../guild/types';
import type { LaneId } from '../regions/lanes';
import type {
  BoardState,
  CaptainState,
  Contract,
  LogEntry,
  RepState,
  Shipment,
  TrophyEntry,
} from '../career/types';

export const SAVE_FORMAT = 'cinderbelt-save';
/** The format string of saves written before the rename to Cinderbelt; still loaded. */
export const LEGACY_SAVE_FORMAT = 'astra-forge-save';

/** What the storage holds under a slot key (the current record and the backup). */
export interface SaveEnvelope {
  format: typeof SAVE_FORMAT | typeof LEGACY_SAVE_FORMAT;
  /** Schema version of `data` – it selects the migrations to run. */
  version: number;
  /** FNV-1a (32 bit, hex) of the `data` string. */
  checksum: string;
  /** JSON.stringify(SaveGameVn). */
  data: string;
}

export type SaveReason = 'new' | 'manual' | 'dock' | 'interval' | 'quit' | 'death';
export const SAVE_REASONS: readonly SaveReason[] = ['new', 'manual', 'dock', 'interval', 'quit', 'death'];

/**
 * Slot: 4 per difficulty (= death penalty). Index 0–3 when a new game is created; a game moved to Hard
 * after a hardcore death may get an index ≥ 4 too (spec 15.7).
 */
export interface SlotRef {
  difficulty: DeathPenalty;
  index: number;
}

export interface SavedGridV1 {
  nextId: number;
  /**
   * `variant` from V5 (M3.5b) – missing on a base part; `loan` from V8 (Guild loan part); `shape` from V18
   * (SL2 E2, shaped armour) – missing = the full cell(s).
   */
  parts: { id: number; partId: PartId; tier: Tier; x: number; y: number; rot: Rotation; variant?: VariantId; loan?: true; shape?: ShapeId }[];
}

export interface SavedBodyV1 {
  pos: Vec2;
  vel: Vec2;
  angle: number;
  angVel: number;
}

export interface SavedPlayerV1 {
  grid: SavedGridV1;
  /** Only damaged parts: [id, hp], sorted by id. */
  hp: [number, number][];
  body: SavedBodyV1;
  dampers: boolean;
  fuel: number;
  energy: number;
  cargo: Cargo;
  /** Docked at a station, otherwise null. The transitional `docking` is saved as the target `docked`. */
  dockedAt: StationId | null;
}

export interface SavedStationV1 {
  resources: Cargo;
  parts: PartInventory;
}

export interface SavedWorldV1 {
  /** Asteroid deltas: [asteroidId, remaining amount] (0 = mined out), sorted. */
  remaining: [string, number][];
  /** Keys 'cx,cy' of the explored chunks, sorted. */
  explored: string[];
  /** Discovered stations, sorted. */
  discoveredStations: StationId[];
  /** Centre of the active chunks [cx, cy] – a load activates the same chunks. */
  center: [number, number] | null;
}

/** Statistics in version 1 (no pirates destroyed). */
export type GameStatsV1 = Omit<GameStats, 'kills' | 'bestUnitsPerHour'>;

export interface SaveGameV1 {
  version: 1;
  /** Random game id (tells a new game in the same slot apart). */
  gameId: string;
  /** Game name in the slot list. */
  name: string;
  /** ISO 8601. */
  createdAt: string;
  savedAt: string;
  saveReason: SaveReason;
  /** Build version, informative only. */
  gameVersion: string;
  /** uint32 world seed. */
  seed: number;
  settings: GameSettings;
  /** Game time in steps (60/s). */
  tick: number;
  credits: number;
  player: SavedPlayerV1;
  respawn: { stationId: StationId; grid: SavedGridV1 };
  /** Only stations with a non-empty storage. */
  stations: Record<StationId, SavedStationV1>;
  world: SavedWorldV1;
  stats: GameStatsV1;
}

// ---------------------------------------------------------------------------
// version 2 (M3a): combat – the player's shield and cannons, parts from wrecks, pirates, projectiles, wrecks

export interface SavedPlayerV2 extends SavedPlayerV1 {
  shield: number;
  /** Steps until the shield starts recharging. */
  shieldDelay: number;
  /** [cannon part id, steps until it may fire], sorted by id. */
  cooldowns: [number, number][];
  /** Parts salvaged from wrecks (aboard). */
  salvage: PartInventory;
  /** Cockpit destroyed, the death not applied yet. */
  destroyed: boolean;
}

export interface SavedEnemyV2 {
  id: string;
  kind: EnemyKind;
  grid: SavedGridV1;
  /** Only damaged parts: [id, hp], sorted. */
  hp: [number, number][];
  body: SavedBodyV1;
  energy: number;
  shield: number;
  shieldDelay: number;
  cooldowns: [number, number][];
  home: Vec2;
  maxHull: number;
  ai: { mode: AiMode; waypoint: Vec2; timer: number; orbit: 1 | -1; breakOff: number };
}

export interface SavedProjectileV2 {
  id: number;
  owner: string;
  pos: Vec2;
  vel: Vec2;
  ttl: number;
  damage: number;
  tier: Tier;
  origin: Vec2;
}

export interface SavedWreckV2 {
  id: number;
  grid: SavedGridV1;
  body: SavedBodyV1;
  loot: { cargo: Cargo; parts: PartInventory };
  ttl: number;
  livery: Livery;
  /** From V5 (M3.5b): a wreck of a POI / contract, its class for fragments, its fixed contents. */
  poi?: string;
  cls?: WreckClass;
  contents?: { fragment: PlanId | null; shard: boolean };
}

export interface SavedCombatV2 {
  /** State of the combat RNG. */
  rng: number;
  nextId: number;
  enemies: SavedEnemyV2[];
  /** [slot id, step of destruction], sorted. */
  defeated: [string, number][];
  projectiles: SavedProjectileV2[];
  wrecks: SavedWreckV2[];
}

/** Statistics before version 8 (no best-ship record). */
export type GameStatsV7 = Omit<GameStats, 'bestUnitsPerHour'>;

export interface SaveGameV2 extends Omit<SaveGameV1, 'version' | 'player' | 'stats'> {
  version: 2;
  player: SavedPlayerV2;
  stats: GameStatsV7;
  combat: SavedCombatV2;
}

// ---------------------------------------------------------------------------
// version 3 (M2d): veins on asteroids, cracked ice and mining laser heat

export interface SavedPlayerV3 extends SavedPlayerV2 {
  /** Laser heat: [part id, seconds on a vein, cooling steps], non-zero only, sorted by id. */
  heat: [number, number, number][];
}

export interface SavedWorldV3 extends SavedWorldV1 {
  /** Veins of mined asteroids: [asteroidId, centres of the active segments (u), directions ±1], sorted. */
  veins: [string, number[], number[]][];
  /** Cracked ice: [parent id, amount left when it cracked] (the shards derive from it), sorted. */
  cracked: [string, number][];
}

export interface SaveGameV3 extends Omit<SaveGameV2, 'version' | 'player' | 'world'> {
  version: 3;
  player: SavedPlayerV3;
  world: SavedWorldV3;
}

/** "First Day" onboarding state of saves V4–V9. */
export interface FirstDayStateV4 {
  step: number;
  status: 'active' | 'done' | 'skipped';
  base: number;
}

// ---------------------------------------------------------------------------
// version 4 (M3.5a): career – contracts and boards, reputation, captains, courier, "First Day",
// market demand and a short log. The career data shapes are plain JSON (Maps as sorted pairs).

export interface SavedCareerV4 {
  nextId: number;
  contracts: Contract[];
  /** Only the boards of the current period: [station, board], sorted. */
  boards: [StationId, BoardState][];
  rep: Record<RepFactionId, RepState>;
  /** [captain index, state], sorted. */
  captains: [number, CaptainState][];
  /** [captain index, HP share], sorted. */
  engaged: [number, number][];
  shipments: Shipment[];
  /** The former "First Day" onboarding (replaced by the Guild Training in V10). */
  firstDay: FirstDayStateV4;
  /** Only the current period of the sector: [station, period, units sold], sorted. */
  demandSold: [StationId, number, number][];
  completed: Partial<Record<ContractType, number>>;
  trophies: TrophyEntry[];
  log: LogEntry[];
}

export interface SaveGameV4 extends Omit<SaveGameV3, 'version'> {
  version: 4;
  career: SavedCareerV4;
}

// ---------------------------------------------------------------------------
// version 5 (M3.5b): discoveries – Data, Archive, fragments and plans, scanner and signals, discovered
// places, triangulations, giant asteroids, journal, key items, anomaly bonuses; part variants in grids
// and wreck contents (POI). Maps and sets as sorted arrays.

export interface SavedDiscoveryV5 {
  dataTotal: number;
  dataFund: number;
  /** Bought Archive nodes (in tree order). */
  archive: ArchiveNodeId[];
  /** [plan, fragments 1–2], sorted. */
  fragments: [PlanId, number][];
  plans: PlanId[];
  /** [source, sources without a fragment], sorted. */
  pity: [FragmentSource, number][];
  scanned: string[];
  known: string[];
  signals: Signal[];
  /** [id, triangulation], sorted. */
  fixes: [string, Fix][];
  opened: string[];
  /** [giant id, shell left], sorted. */
  giants: [string, number][];
  journal: { id: string; tick: number }[];
  keyItems: KeyItemId[];
  buffs: Buff[];
  anomalyUsed: [string, number][];
  scanner: ScannerState;
  distressScans: [string, number][];
  pirateLogs: number;
  atlas: string[];
  atlasDone: AtlasCollection[];
  log: DiscoveryLogEntry[];
}

export interface SaveGameV5 extends Omit<SaveGameV4, 'version'> {
  version: 5;
  discovery: SavedDiscoveryV5;
}

// ---------------------------------------------------------------------------
// version 6 (M3.6): the player's tractor beam, containers, dismantlable wrecks (intact parts, cutting,
// POI pieces) and the parts cut off POI wrecks.

export interface SavedPlayerV6 extends SavedPlayerV3 {
  /** Tractor beam: target and part pulling, or null. */
  tractor: TractorState | null;
}

export interface SavedWreckV6 extends SavedWreckV2 {
  dismantle?: { intact: number[] };
  cutting?: { partId: number; progress: number };
  from?: string;
}

export interface SavedContainerV6 {
  id: number;
  body: SavedBodyV1;
  loot: { cargo: Cargo; parts: PartInventory };
  ttl: number;
  poi?: string;
}

/** Enemy V6: a collector's hold. */
export interface SavedEnemyV6 extends SavedEnemyV2 {
  hold?: { cargo: Cargo; parts: PartInventory };
}

export interface SavedCombatV6 extends Omit<SavedCombatV2, 'wrecks' | 'enemies'> {
  enemies: SavedEnemyV6[];
  wrecks: SavedWreckV6[];
  containers: SavedContainerV6[];
}

export interface SavedDiscoveryV6 extends SavedDiscoveryV5 {
  /** [POI wreck key, ids of the parts cut off], sorted. */
  cut: [string, number[]][];
}

/** Pirate attention, toll, raid and fortresses (M3.6). Maps as sorted pairs. */
export interface SavedPiratesV6 {
  attention: number;
  chunk: string | null;
  lastHunt: number;
  serial: number;
  raid: Raid | null;
  toll: Toll | null;
  tolled: [string, number][];
  fortresses: [string, FortressState][];
  beacons: [string, number][];
}

export interface SaveGameV6 extends Omit<SaveGameV5, 'version' | 'player' | 'combat' | 'discovery'> {
  version: 6;
  player: SavedPlayerV6;
  combat: SavedCombatV6;
  discovery: SavedDiscoveryV6;
  pirates: SavedPiratesV6;
}

// ---------------------------------------------------------------------------
// version 7 (M3.8): the ship blueprint – the layout at the last shipyard commit.

export interface SavedPlayerV7 extends SavedPlayerV6 {
  blueprint: SavedGridV1;
}

export interface SaveGameV7 extends Omit<SaveGameV6, 'version' | 'player'> {
  version: 7;
  player: SavedPlayerV7;
}

// ---------------------------------------------------------------------------
// version 8 (saboteur fixes): Guild loan parts on grids (`loan: true`) and the scuttle flag – a ship
// abandoned by the player waits for applyDeath with the voluntary-scuttle rules.

export interface SavedPlayerV8 extends SavedPlayerV7 {
  /** The player abandoned the ship (pause menu) – the death screen applies the scuttle rules. */
  scuttled: boolean;
}

export interface SaveGameV8 extends Omit<SaveGameV7, 'version' | 'player' | 'stats'> {
  version: 8;
  player: SavedPlayerV8;
  stats: GameStats;
}

// ---------------------------------------------------------------------------
// version 9 (combat fairness): pirates carry fuel (the tanks of their grid) and the gunner's
// reaction state (steps until it may fire, the target velocity it last reacted to).

export interface SavedEnemyV9 extends Omit<SavedEnemyV6, 'ai'> {
  fuel: number;
  ai: SavedEnemyV6['ai'] & { react: number; seen: Vec2 };
}

export interface SavedCombatV9 extends Omit<SavedCombatV6, 'enemies'> {
  enemies: SavedEnemyV9[];
}

export interface SaveGameV9 extends Omit<SaveGameV8, 'version' | 'combat'> {
  version: 9;
  combat: SavedCombatV9;
}

// ---------------------------------------------------------------------------
// version 10 (M3.7 Guild Training): the training replaces the "First Day" onboarding in the career.

export interface SavedCareerV10 extends Omit<SavedCareerV4, 'firstDay'> {
  training: TrainingState;
}

export interface SaveGameV10 extends Omit<SaveGameV9, 'version' | 'career'> {
  version: 10;
  career: SavedCareerV10;
}

// ---------------------------------------------------------------------------
// version 11 (second code review I1): a paid toll keeps the pirate group calm through save and load.

export interface SavedPiratesV11 extends SavedPiratesV6 {
  /** Group → tick until which a paid toll keeps it calm, sorted. */
  paid: [string, number][];
}

export interface SaveGameV11 extends Omit<SaveGameV10, 'version' | 'pirates'> {
  version: 11;
  pirates: SavedPiratesV11;
}

// ---------------------------------------------------------------------------
// version 12 (Mining 2.0): live rich nuggets and the chunks whose ore grades the scanner assayed.
// The grade of a rock is not saved – it is a pure function of the seed and the rock id.

export interface SavedNuggetV12 {
  id: number;
  resource: ResourceId;
  /** Ore in the nugget (cargo units). */
  amount: number;
  grade: number;
  /** Asteroid it broke off. */
  source: string;
  body: SavedBodyV1;
  ttl: number;
}

export interface SavedMiningV12 {
  nextId: number;
  nuggets: SavedNuggetV12[];
  /** Assayed chunk keys, sorted. */
  assayed: string[];
}

export interface SaveGameV12 extends Omit<SaveGameV11, 'version'> {
  version: 12;
  mining: SavedMiningV12;
}

// ---------------------------------------------------------------------------
// version 13 (the training hull gets a reverse engine): no new fields – the 12 → 13 migration hands
// a training still running before the brake reward the reverse engine its old hull lacked.

export interface SaveGameV13 extends Omit<SaveGameV12, 'version'> {
  version: 13;
}

// ---------------------------------------------------------------------------
// version 14 (art batch D station variants): the world generation rules the game was started with.
// Every older save is generation 1 (the original station model pick); a new game takes the latest.

export interface SaveGameV14 extends Omit<SaveGameV13, 'version'> {
  version: 14;
  /** World generation rules (sim/world/worldGen.ts) – fixed for the life of the game. */
  worldGen: WorldGen;
}

// ---------------------------------------------------------------------------
// version 15 (sectors stage 2, "maps as a commodity"): the region generator is frozen and saved, with
// the sector charts – survey points the scanner marked, charts bought from and sold to the Guild.
// Knowledge from flight coverage stays derived from `world.explored`.

export interface SavedRegionsV15 {
  /** Region generator id (REGION_GEN_ID; 1 = the frozen stage-2 generator). */
  gen: RegionGenId;
  /** [sector id, bit mask of the marked survey points], sorted by id, masks > 0. */
  points: [string, number][];
  /** Sector ids, sorted. */
  bought: string[];
  sold: string[];
  /** [sector id, tick] of per-sector cooldowns, sorted (none yet). */
  cooldowns: [string, number][];
}

export interface SaveGameV15 extends Omit<SaveGameV14, 'version'> {
  version: 15;
  regions: SavedRegionsV15;
}

// ---------------------------------------------------------------------------
// version 16 (M4a "Hangar and Fleet"): the fleet – the active ship's record (name, log) and the ships
// stored in hangar slots – the bought slots per station, the ship templates, and the ship a player
// wreck broke off (so a respawn reclaims parts only from the wrecks of the ship that died).

/** The ship's log (sim/fleet/types `ShipLog`). */
export interface SavedShipLogV16 {
  distance: number;
  kills: number;
  mined: number;
  deaths: number;
  built: number;
}

/** Identity of a ship: id, custom name (null = the generated name `nameIdx`), log. */
export interface SavedShipRecordV16 {
  id: number;
  name: string | null;
  nameIdx: number;
  log: SavedShipLogV16;
}

/** A ship parked in a hangar slot (cold: no shield, energy, heat or cooldowns are kept). */
export interface SavedStoredShipV16 {
  record: SavedShipRecordV16;
  stationId: StationId;
  /** Never contains Guild loan parts. */
  grid: SavedGridV1;
  blueprint: SavedGridV1;
  /** Only damaged parts: [id, hp], sorted by id (like the player). */
  hp: [number, number][];
  fuel: number;
  cargo: Cargo;
}

export interface SavedFleetV16 {
  nextShipId: number;
  active: SavedShipRecordV16;
  /** Sorted by record id. */
  stored: SavedStoredShipV16[];
  /** [station, bought slots], sorted by station id, counts > 0. */
  slots: [StationId, number][];
}

/** A ship template (sim/templates/types `ShipTemplate`): normalised parts [key, x, y, rot]. */
export interface SavedTemplateV16 {
  name: string;
  parts: [PartKey, number, number, Rotation][];
}

export interface SavedWreckV16 extends SavedWreckV6 {
  /** A player wreck: the id of the ship it broke off (missing on pirate and POI wrecks). */
  ship?: number;
}

export interface SavedCombatV16 extends Omit<SavedCombatV9, 'wrecks'> {
  wrecks: SavedWreckV16[];
}

export interface SaveGameV16 extends Omit<SaveGameV15, 'version' | 'combat'> {
  version: 16;
  combat: SavedCombatV16;
  fleet: SavedFleetV16;
  /** In the player's order (the index is the template's id in the actions). */
  templates: SavedTemplateV16[];
}

// ---------------------------------------------------------------------------
// version 17 (M4b "World Comes Alive"): the world sites the player touched and the events director. Sites and
// comets are pure functions of the seed (comet positions of the tick); only what the player changed is
// saved. Maps and sets as sorted arrays, so a save is canonical.

/** A touched derelict station (sim/sites/types `DerelictState`). */
export interface SavedDerelictV17 {
  /** Tick its defence woke (the 2nd relay lit), null = asleep. */
  woke: number | null;
  /** Bitmask of the terminal items taken. */
  taken: number;
  /** The first berth gave the Data and the log. */
  visited: boolean;
}

/** Graveyard party state: 0 asleep, 1 awake, 2 cleared. */
export type SavedPartyV17 = 0 | 1 | 2;

/** A touched ship graveyard (sim/sites/types `GraveyardState`). */
export interface SavedGraveyardV17 {
  /** Bitmask of the mines that are gone. */
  mines: number;
  party: SavedPartyV17;
  /** The first-analysis Data were given. */
  data: boolean;
  /** Fragment rolls used. */
  rolls: number;
}

/** A comet mined in its current pass (sim/sites/types `CometState`). */
export interface SavedCometV17 {
  pass: number;
  /** Nucleus rock units mined in this pass. */
  core: number;
  /** Bitmask of the tail shards mined in this pass. */
  tail: number;
}

export interface SavedSitesV17 {
  /** Powered relay ids, sorted. */
  powered: string[];
  /** The relay being charged and its charge (seconds of beam). */
  charge: { id: string; progress: number } | null;
  /** Derelict id while berthed at its clamp. */
  berth: string | null;
  /** Sorted by id. */
  derelicts: [string, SavedDerelictV17][];
  graveyards: [string, SavedGraveyardV17][];
  comets: [string, SavedCometV17][];
  /** Armed mines [mine id, arming tick], sorted – the fuse (≤ 1.5 s) continues after a load. */
  armed: [string, number][];
}

export interface SavedDirectorV17 {
  /** Tick the last director event ended (may lie in the future while one runs; -1e9 = never). */
  last: number;
  /** One-shot keys [key, tick], sorted by key (markers `…#hail` / `…#end` and comet flybys included). */
  fired: [string, number][];
}

export interface SaveGameV17 extends Omit<SaveGameV16, 'version'> {
  version: 17;
  sites: SavedSitesV17;
  director: SavedDirectorV17;
}

// ---------------------------------------------------------------------------
// version 18 (SL2 E2 "Shaped Parts"): shaped armour. Grid parts may carry `shape` (SavedGridV1) and
// template parts a 5th element, the shape. No new state – the 17 → 18 migration only bumps the number.

/** A template part: [key, x, y, rot] or, for a shaped part, [key, x, y, rot, shape]. */
export type SavedTemplatePartV18 = [PartKey, number, number, Rotation] | [PartKey, number, number, Rotation, ShapeId];

/** A ship template (sim/templates/types `ShipTemplate`): normalised parts, shaped ones as 5-tuples. */
export interface SavedTemplateV18 {
  name: string;
  parts: SavedTemplatePartV18[];
}

export interface SaveGameV18 extends Omit<SaveGameV17, 'version' | 'templates'> {
  version: 18;
  /** In the player's order (the index is the template's id in the actions). */
  templates: SavedTemplateV18[];
}

// ---------------------------------------------------------------------------
// version 19 (M4c "Home and Workshop"): the home station (built modules, pinned trophies), ship paints and
// the on-board workshop (refined ore as a sub-account of the cargo, the repair module's material bank).

/** The home station (sim/home/types `HomeState`). */
export interface SavedHomeV19 {
  /** Built modules in HOME_MODULE_IDS order (only buildable ones – never a `since` module). */
  modules: HomeModuleId[];
  /** Pinned trophies in pin order (≤ TROPHY_PEDESTALS, unique): `cap:<captain>` or `fort:<siteId>`. */
  trophyPins: TrophyId[];
}

/** A ship record with its paint (always written; 'factory' = unpainted). */
export interface SavedShipRecordV19 extends SavedShipRecordV16 {
  paint: PaintId;
}

/**
 * Refined ore (the refinery's sub-account of a cargo): only resources with a positive amount, in resource
 * order, never ice, each ≤ the cargo's amount. `{}` = nothing refined.
 */
export type SavedRefinedV19 = Partial<Cargo>;

export interface SavedStoredShipV19 extends Omit<SavedStoredShipV16, 'record'> {
  record: SavedShipRecordV19;
  refined: SavedRefinedV19;
}

export interface SavedFleetV19 extends Omit<SavedFleetV16, 'active' | 'stored'> {
  active: SavedShipRecordV19;
  /** Sorted by record id. */
  stored: SavedStoredShipV19[];
}

/** The repair module's material bank: HP paid for part `part` (worth < 1 unit of its material). */
export interface SavedRepairBankV19 {
  part: number;
  bank: number;
}

export interface SavedPlayerV19 extends SavedPlayerV8 {
  refined: SavedRefinedV19;
  /** Null = no bank (also when its part is gone). */
  repair: SavedRepairBankV19 | null;
}

export interface SaveGameV19 extends Omit<SaveGameV18, 'version' | 'player' | 'fleet'> {
  version: 19;
  player: SavedPlayerV19;
  fleet: SavedFleetV19;
  home: SavedHomeV19;
}

// ---------------------------------------------------------------------------
// version 20 (M4d "Guild and Trade"): the Guild (relay chain, the relay hold, live Watch ships), convoys
// (trades with scheduled passes, the link to a trader, escort convoys) and navigation (map notes). The
// convoy schedule, the Watch schedule and the relay sites are pure functions of the seed – only what the
// game changed is saved. Maps as sorted arrays. No friendly fire (user decision 2026-10-16): no offence
// state, no closed passes.

/** A lane's relay chain stage (sim/guild/types `RelayRecord`; no record = broken). */
export interface SavedRelayRecordV20 {
  stage: RelayStage;
  /** The relay's sector at the time (a later retune of the relay sites never moves a secured sector). */
  sector: string;
  tick: number;
}

/** The running relay hold (sim/guild/types `RelayHold`). */
export interface SavedRelayHoldV20 {
  lane: LaneId;
  start: number;
  phase: 'warning' | 'fight' | 'idle';
  reinforced: boolean;
}

/** A live Guild Watch ship (sim/guild/types `WatchShip`; `prevBody` is not saved – it equals `body` after a load). */
export interface SavedWatchShipV20 {
  /** `gw:<route>|<slot>` */
  id: string;
  kind: WatchKind;
  body: SavedBodyV1;
  hull: number;
  shield: number;
  shieldDelay: number;
  /** Per gun, in `WATCH.ships[kind].guns` order. */
  cooldowns: number[];
  mode: WatchMode;
  target: string | null;
  route: string;
  slot: number;
  modeTick: number;
  lastHitBy: number;
}

export interface SavedGuildV20 {
  /** Sorted by lane. */
  relays: [LaneId, SavedRelayRecordV20][];
  hold: SavedRelayHoldV20 | null;
  /** In the simulation's order (the AI steps them in it). */
  watch: SavedWatchShipV20[];
  /** Destroyed / retreated Watch ship ids → tick, sorted by id. */
  lost: [string, number][];
  /** Tick of the last Watch radio line (-1e9 = never). */
  lastRadio: number;
}

/** What the player traded with a pass (sim/convoys/types `ConvoyTrade`). */
export interface SavedConvoyTradeV20 {
  bought: number;
  sold: number;
  fuel: number;
}

/** An escort contract's convoy (sim/convoys/types `EscortState`); `deposit` always written (0 = none held). */
export interface SavedEscortV20 {
  progress: number;
  state: 'waiting' | 'moving' | 'stopped' | 'done';
  departed: number | null;
  away: number;
  stopUntil: number;
  fired: number;
  hulls: number[];
  deposit: number;
}

export interface SavedConvoysV20 {
  /** [pass id `cv:<lane>@<n>`, trade], sorted by pass. */
  trades: [string, SavedConvoyTradeV20][];
  /** Linked to a pass's trader – only a pass in flight at the save tick. */
  link: { pass: string; since: number } | null;
  /** [contract serial, convoy], sorted by serial – only active escort contracts. */
  escorts: [number, SavedEscortV20][];
}

/** A map note (sim/navigation/types `MapNote`): player text, stored cleaned. */
export interface SavedMapNoteV20 {
  id: number;
  x: number;
  y: number;
  icon: NoteIcon;
  text: string;
}

export interface SavedNavigationV20 {
  /** In the player's order. */
  notes: SavedMapNoteV20[];
  nextNote: number;
}

export interface SaveGameV20 extends Omit<SaveGameV19, 'version'> {
  version: 20;
  guild: SavedGuildV20;
  convoys: SavedConvoysV20;
  navigation: SavedNavigationV20;
}

/** The current save version. */
export type SaveGame = SaveGameV20;
