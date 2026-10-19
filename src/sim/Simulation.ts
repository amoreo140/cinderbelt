import { clearList } from './scratch';
import { STARTING_CREDITS, STARTING_HOME_PARTS } from '../data/economy';
import type { RepFactionId, RepLevel } from '../data/factions';
import type { PartInventory, PartKey, Tier } from '../data/parts';
import { cargoMass, emptyCargo, RESOURCE_IDS, type Cargo } from '../data/resources';
import { applyRam, burnExhausts, createCombatState, mergeInventory, scuttlePlayer, shotEvent, stepCombat } from './combat/combat';
import { partAtCell, ramDamage } from './combat/ram';
import { PLAYER_REF, type CombatShip, type CombatState, type EnemyKind, type ShipRef, type TractorState } from './combat/types';
import { fireWeapons } from './combat/weapons';
import type { GameAction, PlayerCommand } from './commands';
import { lerpAngle } from './math/angle';
import { hypot, lerp, scale, type Vec2 } from './math/vec2';
import { stepHeat, type LaserHeat } from './mining/heat';
import { runMining, type MiningBeam } from './mining/mining';
import { oreGrade } from './mining/grade';
import { assayOre, createMiningState, spawnNuggets, stepNuggets, type MiningEvent, type MiningState } from './mining/nuggets';
import { createBody, integrate, type Body } from './physics/body';
import { DEFAULT_SETTINGS, type GameSettings } from './settings';
import { resolveCollisions, type Circle } from './physics/collide';
import { computeFlight, type FlightProps } from './ship/control';
import { clampRefined, idleWorkshop, stepWorkshop, type RepairBank, type WorkshopActivity } from './ship/workshop';
import { flightFuel } from './ship/fuel';
import type { VeinState } from './mining/veins';
import { createStarterShip } from './ship/presets';
import { computeProperties, type ShipProperties } from './ship/properties';
import type { HpMap, ShipGrid } from './ship/types';
import { applyAction, type ActionError, type CreditReason } from './station/actions';
import { checkDock, DOCKING_TICKS, dockPose, smoothstep, type DockState, type DockStatus } from './station/dock';
import { playerDockRules } from './station/dockRules';
import { ensureStorage } from './station/storage';
import { towAvailable, towShip } from './station/tow';
import { CHUNK_SIZE, generateChunk, type ChunkGenerator } from './world/generate';
import { HOME_STATION_ID, homeStation, stationById, type StationDef, type StationId } from './world/stations';
import { World } from './world/World';
import { WORLD_GEN_LATEST, type WorldGen } from './world/worldGen';
import { careerAction, careerInteraction, careerOnStationAction, createCareer, interact, isCareerAction, stepCareer } from './career/career';
import type { CareerState } from './career/types';
import { recordShipCapability } from './contracts/board';
import { stepGuildLoan } from './station/guildLoan';
import { driftOf, sectorAt, sectorEffects } from './sector/sector';
import { createDiscovery } from './discovery/state';
import { discoveryAction, isDiscoveryAction, stepDiscovery } from './discovery/discovery';
import { stepCharting } from './discovery/charting';
import { anomalyPull, flightMods } from './discovery/anomalies';
import { giantCircles, giantCirclesInto, mineGiants } from './discovery/giants';
import { discoveryInteraction, interactDiscovery } from './discovery/interact';
import { applyCutting, hulkCircles } from './salvage/cutting';
import { salvage, salvageAt } from './salvage/salvage';
import { stepTractor, toggleTractor } from './salvage/tractor';
import type { DiscoveryEvent, DiscoveryState } from './discovery/types';
import type { SalvageEvent } from './salvage/types';
import type { PirateEvent } from './pirates/types';
import { createPirates, type PirateState } from './pirates/state';
import { interactPirates, pirateInteraction, stepPirates } from './pirates/pirates';
import { fortressObstacles, fortressObstaclesInto } from './pirates/fortress';
import type { TrainingEvent } from './training/types';
import { createRegionsState, type RegionsState } from './regions/state';
import { chartAction, isChartAction } from './charts/actions';
import { fleetAction, isFleetAction } from './fleet/actions';
import { advanceShipLog, logMark, type LogMark } from './fleet/log';
import { createFleet } from './fleet/state';
import type { FleetState, ShipId } from './fleet/types';
import { isTemplateAction, templateAction } from './templates/actions';
import type { ShipTemplate } from './templates/types';
import { applyMoverExtractions, createSites, holdBerth, isSiteAction, miningMovers, siteAction, siteCollidersInto, stepSites, structureColliders, tryBerth, type SiteEvent, type SitesState } from './sites';
import { directorAction, isDirectorAction, stepDirector } from './events/director';
import { createDirector } from './events/state';
import type { DirectorEvent, DirectorState } from './events/types';
import { createHome, homeAction, homeColliders, isHomeAction, stepHome, type HomeEvent, type HomeState } from './home';
import { createGuild, guildAction, isGuildAction, stepGuild, type GuildEvent, type GuildState } from './guild';
import { convoyAction, createConvoys, holdLink, isConvoyAction, stepConvoys, tryConvoyLink, type ConvoyEvent, type ConvoysState } from './convoys';
import { createNavigation, isNavigationAction, navigationAction, type NavigationState } from './navigation';
import { npcColliders, npcCollidersInto, type NpcEvent } from './npc';
import type { ContractFailReason } from './career/types';

/** Fixed simulation step (60 Hz). */
export const SIM_DT = 1 / 60;

export interface PlayerShip extends CombatShip {
  grid: ShipGrid;
  /** Bumped on every grid change (the render rebuilds the ship model by it). */
  gridVersion: number;
  /** HP of the mounted parts (a missing entry = full HP). */
  hp: HpMap;
  props: ShipProperties;
  body: Body;
  /** The state before the last step – for render interpolation. */
  prevBody: Body;
  dampers: boolean;
  lastLocalForce: Vec2;
  fuel: number;
  energy: number;
  cargo: Cargo;
  beams: MiningBeam[];
  /** Heat of the mining lasers by part id (non-zero only; spec 2.1.1). */
  heat: Map<number, LaserHeat>;
  dock: DockState;
  /** Parts salvaged from wrecks – they go to the station storage on docking. */
  salvage: PartInventory;
  /** The cockpit was destroyed – waiting for applyDeath (the death sequence in the game layer). */
  destroyed: boolean;
  /** The player abandoned the ship (scuttle) – applyDeath uses the voluntary-scuttle rules. */
  scuttled?: boolean;
  /** Tractor beam (M3.6): what it holds, or null. */
  tractor: TractorState | null;
  /**
   * Blueprint (M3.8): the layout at the last shipyard commit. Parts lost in flight are the blueprint
   * minus the grid (`missingParts`); the shipyard can restore it.
   */
  blueprint: ShipGrid;
  /**
   * Refined ore (M4c refinery): a sub-account of `cargo` (`refined[r] ≤ cargo[r]`, ice always 0, kept by
   * `clampRefined`) that sells with a bonus. Lives only on ships.
   */
  refined: Cargo;
  /** Repair module material bank (M4c): HP paid for with whole units of material, or null. */
  repair: RepairBank | null;
  /** What the on-board workshop does this step (transient, rebuilt by `stepWorkshop`, never saved). */
  workshop: WorkshopActivity;
}

/** Respawn point after death (spec M2, 5.7): the last station visited and the ship layout there. */
export interface RespawnPoint {
  stationId: StationId;
  /** The ship layout at the last stay in the dock (for the "none" and "mild" penalties). */
  grid: ShipGrid;
}

export interface GameStats {
  mined: Cargo;
  /** Sum of the positive credit changes (sales etc.). */
  creditsEarned: number;
  partsCrafted: number;
  distanceFlown: number;
  deaths: number;
  /** Pirates destroyed (M3a). */
  kills: number;
  /** Tick of the last Guild loan (laser / engine) mounted on the hull (-1 = never; station/guildLoan.ts). */
  lastEmergencyKit: number;
  /**
   * Best mining capability the player's ship has had, units/h per ring (index ring - 1) at the game's
   * yield – contract quotes never use a worse ship (contracts/board.ts, saboteur report X2). Save V8.
   */
  bestUnitsPerHour: number[];
}

export const emptyStats = (): GameStats => ({
  mined: emptyCargo(),
  creditsEarned: 0,
  partsCrafted: 0,
  distanceFlown: 0,
  deaths: 0,
  kills: 0,
  lastEmergencyKit: -1,
  bestUnitsPerHour: [0, 0, 0, 0],
});

/** Mutable station state – the storage (unlimited). Saved only for stations touched. */
export interface StationState {
  resources: Cargo;
  parts: PartInventory;
}

export interface SimState {
  seed: number;
  tick: number;
  settings: GameSettings;
  player: PlayerShip;
  world: World;
  credits: number;
  stations: Map<StationId, StationState>;
  respawn: RespawnPoint;
  stats: GameStats;
  /** Pirates, projectiles and wrecks (M3a). */
  combat: CombatState;
  /** Contracts, reputation, captains, courier, "First Day" (M3.5a). */
  career: CareerState;
  /** Scanner, Data, Archive, blueprints, journal, discovered places (M3.5b). */
  discovery: DiscoveryState;
  /** Pirate attention, toll, raids and fortresses (M3.6). */
  pirates: PirateState;
  /** Nuggets and the assayed chunks (Mining 2.0, save V12). */
  mining: MiningState;
  /** Sector charts: survey points, bought and sold charts (sectors stage 2, save V15). */
  regions: RegionsState;
  /** The active ship's record and the ships stored in hangar slots (M4a, save V16). */
  fleet: FleetState;
  /** Saved ship templates, at most `templateCap(state)` (M4a, save V16). */
  templates: ShipTemplate[];
  /** World sites (M4b): powered relays, relay charge, berth, touched derelicts / graveyards / comets (save V17). */
  sites: SitesState;
  /** Events director (M4b): the last event's end and the one-shot keys (save V17). */
  director: DirectorState;
  /** Home station (M4c): built modules and pinned trophies. */
  home: HomeState;
  /** The Guild (M4d): relay chain stages, the relay hold, live Watch ships (save V20). */
  guild: GuildState;
  /** Convoys (M4d): trades with passes, the link to a trader, escort convoys (save V20). */
  convoys: ConvoysState;
  /** Navigation (M4d): the player's map notes (save V20). */
  navigation: NavigationState;
}

/**
 * State restored from a save (spec M2, 9.4) – everything that cannot be derived from the seed.
 * Not saved: props (from the grid), prevBody (= body), beams, lastLocalForce, the active chunks.
 */
export interface RestoredState {
  tick: number;
  credits: number;
  stations: Map<StationId, StationState>;
  respawn: RespawnPoint;
  stats: GameStats;
  player: {
    grid: ShipGrid;
    hp: HpMap;
    body: Body;
    dampers: boolean;
    fuel: number;
    energy: number;
    cargo: Cargo;
    /** Docked at a station, else null (the transitional `docking` state is not saved). */
    dockedAt: StationId | null;
    shield: number;
    shieldDelay: number;
    cooldowns: Map<number, number>;
    salvage: PartInventory;
    destroyed: boolean;
    scuttled: boolean;
    heat: Map<number, LaserHeat>;
    tractor: TractorState | null;
    blueprint: ShipGrid;
    /** Missing (saves before M4c) = nothing refined. */
    refined?: Cargo;
    /** Missing (saves before M4c) = no repair bank. */
    repair?: RepairBank | null;
  };
  combat: CombatState;
  career: CareerState;
  discovery: DiscoveryState;
  pirates: PirateState;
  mining: MiningState;
  regions: RegionsState;
  /** Missing (saves before V16) = `createFleet(seed)`. */
  fleet?: FleetState;
  /** Missing (saves before V16) = no templates. */
  templates?: ShipTemplate[];
  /** Missing (saves before V17) = `createSites()`. */
  sites?: SitesState;
  /** Missing (saves before V17) = `createDirector()`. */
  director?: DirectorState;
  /** Missing (saves before M4c) = `createHome()`. */
  home?: HomeState;
  /** Missing (saves before V20) = `createGuild()`. */
  guild?: GuildState;
  /** Missing (saves before V20) = `createConvoys()`. */
  convoys?: ConvoysState;
  /** Missing (saves before V20) = `createNavigation()`. */
  navigation?: NavigationState;
  world: {
    remaining: Map<string, number>;
    /** Vein state of the mined asteroids (M2d). */
    veins: Map<string, VeinState>;
    /** Cracked ice: id → amount left at the crack (M2d). */
    cracked: Map<string, number>;
    explored: readonly string[];
    discovered: readonly StationId[];
    /** The chunk the active chunks were loaded around (null = around the ship). */
    center: { cx: number; cy: number } | null;
    /** World generation rules of the saved game (V14; older saves = 1). */
    gen: WorldGen;
  };
}

/** What took a part off the player's ship: a shot, a collision, or a hazard (radiation, a cut blast). */
/** exhaust = burnt through by an engine blowing into it (ship/exhaust.ts). */
/** blast = an exploding large reactor next to it (M4c, combat/partBlast.ts). */
export type PartLossCause = 'shot' | 'impact' | 'hazard' | 'exhaust' | 'blast';

export type SimEvent =
  | { type: 'dampersToggled'; on: boolean }
  | { type: 'cargoFull' }
  | { type: 'asteroidDepleted'; id: string }
  /** Ice cracked into fragments at 30 % (spec 2.1.1); radius = the parent's radius before the crack. */
  | { type: 'asteroidCracked'; id: string; pos: Vec2; radius: number; fragments: string[] }
  /** The laser was on a vein for 4 s – it cools for 1.5 s (spec 2.1.1). */
  | { type: 'laserOverheated'; partId: number }
  | { type: 'outOfFuel' }
  /**
   * An engine of the player's ship blows into a part (covered nozzle) and burns it while it fires:
   * sent when the burn starts and at every quarter of the part's HP; `hp` = share left (0..1).
   */
  | { type: 'exhaustBurn'; engineId: number; partId: number; key: PartKey; hp: number }
  /** An impact; damage = impact damage (shield + hull, M21), missing for a safe impact; pos = contact point (M3.8). */
  | { type: 'collision'; speed: number; damage?: number; pos?: Vec2 }
  | { type: 'stationDiscovered'; stationId: StationId }
  /** F away from the dock clamp's tolerances: the failing rule and the values at the request (angle in rad). */
  | { type: 'dockRejected'; reason: Exclude<DockStatus, 'ok'>; distance: number; speed: number; angle: number }
  | { type: 'dockingStarted'; stationId: StationId }
  | { type: 'docked'; stationId: StationId }
  | { type: 'undocked'; stationId: StationId }
  | { type: 'towed'; stationId: StationId; cost: number; cargoLost: boolean }
  | { type: 'shipRebuilt'; cost: number; cargoToStorage: number; fuelLost: number }
  | { type: 'creditsChanged'; delta: number; reason: CreditReason }
  // --- combat (M3a) ---
  /** A cannon shot (dir = the shot's direction relative to the ship). */
  | { type: 'shotFired'; owner: ShipRef; pos: Vec2; dir: Vec2; tier: Tier }
  /** A projectile hit; ref = the ship hit (null for an asteroid, a station, a wreck), from = where the shot came from. */
  | {
      type: 'projectileHit';
      target: 'ship' | 'shield' | 'wreck' | 'asteroid' | 'station';
      owner: ShipRef;
      ref: ShipRef | null;
      pos: Vec2;
      damage: number;
      from: Vec2;
      /** Hit on a Rust fortress (M3.6). */
      fortress?: string;
      /** Hit on an M4b world site: a derelict / relay id, a mine id or a comet id. */
      site?: string;
    }
  | { type: 'partDestroyed'; ref: ShipRef; partId: number; key: PartKey; pos: Vec2 }
  /** An explosive part (M4c large reactor) of ship `ref` blew at `pos`, hitting its neighbours by `damage`. */
  | { type: 'partBlast'; ref: ShipRef; partId: number; pos: Vec2; damage: number }
  /** A repair module brought a part of the player's ship back to full HP (M4c). */
  | { type: 'partRepaired'; partId: number }
  /** The player's refineries / repair modules stopped (edge-triggered, M4c): no energy, no material, nothing to do. */
  | { type: 'workshopIdle'; what: 'refinery' | 'repair'; reason: 'energy' | 'material' | 'nothing' }
  /**
   * The player's ship lost parts and flies on (M3.8): destroyed ones and those torn off with them
   * (`detached`). Not sent when the cockpit goes – that is `playerDestroyed`.
   */
  | { type: 'partsLost'; cause: PartLossCause; parts: { partId: number; key: PartKey; detached: boolean }[] }
  /** `by` = owner of the destroying shot (M4d – a Guild Watch kill is not the player's); unset for rams, exhausts, blasts. */
  | { type: 'shipDestroyed'; ref: ShipRef; kind: EnemyKind; pos: Vec2; vel: Vec2; radius: number; by?: ShipRef }
  /** The player's cockpit destroyed → the game layer runs the death sequence and calls applyDeath. */
  | { type: 'playerDestroyed'; pos: Vec2; vel: Vec2; radius: number }
  /** The player abandoned the ship (`scuttle`) – followed at once by the cockpit's partDestroyed and playerDestroyed. */
  | { type: 'shipScuttled'; pos: Vec2 }
  | { type: 'enemyAlert'; ref: ShipRef; pos: Vec2 }
  | { type: 'salvaged'; wreckId: number; cargo: Partial<Cargo>; parts: PartInventory; cargoFull: boolean; data?: number }
  /** Parts from wrecks moved to the station storage on docking. */
  | { type: 'salvageStored'; stationId: StationId; parts: PartInventory }
  /** The Guild lent the missing part(s) and mounted them on the hull (station/guildLoan.ts). */
  | { type: 'guildLoan'; stationId: StationId; parts: PartInventory }
  /** The player lost cargo space – the surplus spilled (into a wreck, if one was made). */
  | { type: 'cargoSpilled'; cargo: Partial<Cargo>; toWreck: number | null }
  // --- career (M3.5a) ---
  | { type: 'contractAccepted'; contractId: number }
  /** The contract's goals are met – it is handed in at a station. */
  | { type: 'contractReady'; contractId: number }
  | { type: 'contractCompleted'; contractId: number; reward: number; rep: number; part: PartKey | null }
  /** refunded = cancelled within 2 min (the slip went back on the board). */
  | { type: 'contractAbandoned'; contractId: number; refunded: boolean }
  | { type: 'buoyDeployed'; contractId: number; index: number; pos: Vec2 }
  | { type: 'rescueFueled'; contractId: number; fuel: number }
  /** contractId −1 = a ship in distress (M3.5b); notEnoughResources = the Guild relay repair (M4d). */
  | { type: 'interactFailed'; contractId: number; reason: 'notEnoughFuel' | 'notEnoughIron' | 'notEnoughResources' }
  /** A contract failed (M4d escort): removed without a reward, the deposit lost. */
  | { type: 'contractFailed'; contractId: number; reason: ContractFailReason }
  | { type: 'repLevelUp'; faction: RepFactionId; level: RepLevel }
  | { type: 'captainPromoted'; captain: number; level: number; trophies: PartKey[] }
  | { type: 'captainDefeated'; captain: number }
  | { type: 'courierDelivered'; shipment: number; to: StationId }
  // --- Hangar and fleet (M4a, sim/fleet) ---
  /**
   * The active ship `from` was parked here and the stored ship `to` became active. `loanReturned` =
   * Guild loan parts taken off the parked ship and returned to the Guild (empty when none). When the
   * old ship was all loan parts it is dissolved instead (`shipDissolved` comes first, `from` = its id).
   */
  | { type: 'shipSwitched'; stationId: StationId; from: ShipId; to: ShipId; loanReturned: PartInventory }
  /**
   * A new ship `shipId` (a cockpit alone) became active; the old active ship `parked` stands in a slot
   * here (null when it was dissolved). `loanReturned` like in `shipSwitched`.
   */
  | { type: 'shipCreated'; stationId: StationId; shipId: ShipId; parked: ShipId | null; loanReturned: PartInventory }
  /**
   * The stored ship `shipId` was taken apart here: `parts` went to this station's storage (damaged
   * ones repaired for `fee`), `scrapped` were scrapped for `scrap` resources, its `cargo` to storage.
   */
  | {
      type: 'shipDismantled';
      stationId: StationId;
      shipId: ShipId;
      fee: number;
      parts: PartInventory;
      scrapped: PartInventory;
      scrap: Partial<Cargo>;
      cargo: Partial<Cargo>;
    }
  /**
   * The ship left behind by a switch / new ship had no cockpit of its own (a Guild loan hull): its
   * owned `parts` and `cargo` went to this station's storage, the loan parts back to the Guild, its
   * record was dropped – no slot used.
   */
  | { type: 'shipDissolved'; stationId: StationId; shipId: ShipId; parts: PartInventory; cargo: Partial<Cargo>; loanReturned: PartInventory }
  /** name = the new custom name, null = back to the generated one. */
  | { type: 'shipRenamed'; shipId: ShipId; name: string | null }
  /** price = credits paid (also a `creditsChanged` with reason 'hangar'); here / total = slots after the purchase. */
  | { type: 'hangarSlotBought'; stationId: StationId; price: number; here: number; total: number }
  // --- Ship templates (M4a, sim/templates) ---
  /** index = position in `state.templates` (a new template is appended). */
  | { type: 'templateSaved'; index: number; name: string }
  | { type: 'templateRenamed'; index: number; name: string }
  /** The templates after `index` moved one place up. */
  | { type: 'templateDeleted'; index: number }
  // --- Guild Training (M3.7) ---
  | TrainingEvent
  // --- Mining 2.0: nuggets and ore assay ---
  | MiningEvent
  // --- discoveries (M3.5b) ---
  | DiscoveryEvent
  // --- salvage and dismantling (M3.6) ---
  | SalvageEvent
  // --- pirates (M3.6) ---
  | PirateEvent
  // --- world sites and the events director (M4b, sim/sites/types.ts, sim/events/types.ts) ---
  | SiteEvent
  | DirectorEvent
  // --- home station (M4c, sim/home/types.ts) ---
  | HomeEvent
  // --- Guild, convoys, NPC ships in combat (M4d, sim/guild, sim/convoys, sim/npc) ---
  | GuildEvent
  | ConvoyEvent
  | NpcEvent
  | { type: 'actionResult'; reqId: number; ok: true }
  /** detail = a more precise code (e.g. the first error of a ship design). */
  | { type: 'actionResult'; reqId: number; ok: false; reason: ActionError; detail?: string };

export interface SimulationOptions {
  seed: number;
  grid?: ShipGrid;
  /** A replacement world generator (tests). */
  generator?: ChunkGenerator;
  /** Settings of a new game (missing fields = DEFAULT_SETTINGS). */
  settings?: Partial<GameSettings>;
  /** A new game starts docked at the home station; false = flying at the origin (tests). */
  startDocked?: boolean;
  /** Restore a saved game (see `restoreSimulation` in sim/save). `grid` and `startDocked` are ignored. */
  restore?: RestoredState;
  /** World generation rules of a new game (default: the latest; a restore takes the save's). */
  worldGen?: WorldGen;
}

const chunkCenter = (c: { cx: number; cy: number }): Vec2 => ({ x: (c.cx + 0.5) * CHUNK_SIZE, y: (c.cy + 0.5) * CHUNK_SIZE });

/** An impact slower than this is not reported. */
const COLLISION_EVENT_SPEED = 1;
/** The longest laser range of the ship – for picking mining candidates. */
const maxLaserRange = (props: ShipProperties): number => props.lasers.reduce((m, l) => Math.max(m, l.range), 0);

/** Thrust of every engine group × k (the gravity anomaly sling). */
const scaleThrust = (t: ShipProperties['thrust'], k: number): ShipProperties['thrust'] => ({
  forward: t.forward * k,
  backward: t.backward * k,
  left: t.left * k,
  right: t.right * k,
});

/** Collision query margin beyond the ship's radius (covers one step of movement too). */
const COLLISION_MARGIN = 6;

/** The player's flight view (`stepFlight`; computeFlight keeps nothing). */
const PLAYER_FLIGHT: FlightProps = { thrust: { forward: 0, backward: 0, left: 0, right: 0 }, rcsThrust: 0, torque: 0, mass: 1, inertia: 1 };
/** The player's obstacle list, reused every step (`stepFlight`). */
const PLAYER_OBSTACLES: Circle[] = [];
/** The `safe` copy of each station circle (station circles are rebuilt on chunk loads – a weak map). */
const safeCopies = new WeakMap<Circle, Circle>();

/** A station circle as a safe obstacle (`{ ...c, safe: true }`, made once per circle). */
function safeCircle(c: Circle): Circle {
  let s = safeCopies.get(c);
  if (!s) {
    s = { ...c, safe: true };
    safeCopies.set(c, s);
  }
  return s;
}

export class Simulation {
  readonly state: SimState;
  /** The global stats at the last ship-log update (trackProgress); not saved – it equals the stats between steps. */
  private readonly logMark: LogMark;

  constructor(options: SimulationOptions) {
    const settings: GameSettings = { ...DEFAULT_SETTINGS, ...options.settings };
    if (options.restore) {
      this.state = Simulation.restoredState(options.seed, settings, options.restore, options.generator ?? generateChunk);
      this.logMark = logMark(this.state.stats);
      // the built home modules collide like the station (M4c)
      this.state.world.setStationExtraColliders(HOME_STATION_ID, homeColliders(this.state));
      // a save from the docking animation (or an older save) → the same state the dock would give (I2)
      const dockedAt = options.restore.player.dockedAt;
      if (dockedAt !== null) this.enterDocked(dockedAt, this.state.player.body);
      return;
    }
    const grid = options.grid ?? createStarterShip();
    const props = computeProperties(grid);
    const startDocked = options.startDocked ?? true;
    const body = startDocked ? dockPose(homeStation(), props.boundingRadius) : createBody();
    const world = new World(options.seed, options.generator ?? generateChunk, options.worldGen ?? WORLD_GEN_LATEST);
    world.update(body.pos);
    this.state = {
      seed: options.seed,
      tick: 0,
      settings,
      world,
      credits: STARTING_CREDITS,
      stations: new Map([[HOME_STATION_ID, { resources: emptyCargo(), parts: { ...STARTING_HOME_PARTS } }]]),
      respawn: { stationId: HOME_STATION_ID, grid },
      stats: emptyStats(),
      combat: createCombatState(options.seed),
      career: createCareer(),
      discovery: createDiscovery(),
      pirates: createPirates(),
      mining: createMiningState(),
      regions: createRegionsState(),
      fleet: createFleet(options.seed),
      templates: [],
      sites: createSites(),
      director: createDirector(),
      home: createHome(),
      guild: createGuild(),
      convoys: createConvoys(),
      navigation: createNavigation(),
      player: {
        grid,
        gridVersion: 0,
        hp: new Map(),
        props,
        body,
        prevBody: body,
        dampers: true,
        lastLocalForce: { x: 0, y: 0 },
        fuel: props.fuelCapacity,
        energy: props.batteryCapacity,
        cargo: emptyCargo(),
        beams: [],
        heat: new Map(),
        dock: startDocked ? { mode: 'docked', stationId: HOME_STATION_ID } : { mode: 'flying' },
        shield: props.shield.capacity,
        shieldDelay: 0,
        cooldowns: new Map(),
        salvage: {},
        destroyed: false,
        tractor: null,
        blueprint: grid,
        refined: emptyCargo(),
        repair: null,
        workshop: idleWorkshop(),
      },
    };
    this.logMark = logMark(this.state.stats);
  }

  private static restoredState(seed: number, settings: GameSettings, r: RestoredState, generator: ChunkGenerator): SimState {
    const world = new World(seed, generator, r.world.gen);
    for (const [id, left] of r.world.remaining) world.remainingById.set(id, left);
    for (const [id, state] of r.world.veins) world.veins.set(id, { centers: [...state.centers], dirs: [...state.dirs] });
    for (const [id, amount] of r.world.cracked) world.cracked.set(id, amount);
    for (const key of r.world.explored) world.explored.add(key);
    for (const id of r.world.discovered) world.discovered.add(id);
    const { body } = r.player;
    // active chunks around the same centre as in the saved game (exact determinism)
    world.update(r.world.center ? chunkCenter(r.world.center) : body.pos);
    // the chunks around the saved centre were explored in the original game already
    world.newlyExplored = [];
    return {
      seed,
      tick: r.tick,
      settings,
      world,
      credits: r.credits,
      stations: r.stations,
      respawn: r.respawn,
      stats: r.stats,
      combat: r.combat,
      career: r.career,
      discovery: r.discovery,
      pirates: r.pirates,
      mining: r.mining,
      regions: r.regions,
      fleet: r.fleet ?? createFleet(seed),
      templates: r.templates ?? [],
      sites: r.sites ?? createSites(),
      director: r.director ?? createDirector(),
      home: r.home ?? createHome(),
      guild: r.guild ?? createGuild(),
      convoys: r.convoys ?? createConvoys(),
      navigation: r.navigation ?? createNavigation(),
      player: {
        grid: r.player.grid,
        gridVersion: 0,
        hp: r.player.hp,
        props: computeProperties(r.player.grid),
        body,
        prevBody: body,
        dampers: r.player.dampers,
        lastLocalForce: { x: 0, y: 0 },
        fuel: r.player.fuel,
        energy: r.player.energy,
        cargo: r.player.cargo,
        beams: [],
        heat: r.player.heat,
        dock: r.player.dockedAt === null ? { mode: 'flying' } : { mode: 'docked', stationId: r.player.dockedAt },
        shield: r.player.shield,
        shieldDelay: r.player.shieldDelay,
        cooldowns: r.player.cooldowns,
        salvage: r.player.salvage,
        destroyed: r.player.destroyed,
        ...(r.player.scuttled ? { scuttled: true } : {}),
        tractor: r.player.tractor,
        blueprint: r.player.blueprint,
        refined: r.player.refined ?? emptyCargo(),
        repair: r.player.repair ?? null,
        workshop: idleWorkshop(),
      },
    };
  }

  /** A station definition by id – from the active chunks first, else from the world hash. */
  station(id: StationId): StationDef | null {
    return this.state.world.stations().find((s) => s.id === id) ?? stationById(this.state.seed, id, this.state.world.gen);
  }

  step(cmd: PlayerCommand): SimEvent[] {
    const events: SimEvent[] = [];
    const { player } = this.state;
    const startMode = player.dock.mode;

    // refined ore (M4c) never exceeds the cargo: every outflow takes raw units first. Clamped after each
    // action, so units moved to storage and back within one step come back as ordinary ore.
    for (const action of cmd.actions) {
      events.push(...this.runAction(action));
      clampRefined(this.state.player.cargo, this.state.player.refined);
    }
    // abandoning the ship (C2) – in flight only; the game layer then handles the death as for a destroyed cockpit
    if (cmd.scuttle && player.dock.mode === 'flying' && !player.destroyed) scuttlePlayer(this.state, events);

    if (player.destroyed) {
      // the player's debris – waiting for applyDeath
      player.prevBody = player.body;
    } else if (player.dock.mode === 'docking') {
      this.advanceDocking(events);
    } else if (player.dock.mode === 'docked') {
      player.prevBody = player.body;
    } else if (this.state.sites.berth !== null) {
      // berthed at a derelict's clamp (M4b): pinned at the dock pose, F leaves (sim/sites/berth.ts)
      holdBerth(this.state, cmd, startMode === 'flying', events);
    } else if (this.state.convoys.link !== null) {
      // linked to a convoy trader (M4d): pinned beside its trade port, F leaves (sim/convoys/link.ts)
      holdLink(this.state, cmd, startMode === 'flying', events);
    } else {
      this.stepFlight(cmd, startMode === 'flying', events);
    }
    // world sites (M4b): relays (this step's beams), derelict defences, graveyards, mines, comets
    stepSites(this.state, events, SIM_DT);
    // M4d: the Guild relay chain and the live Watch, then the convoys (link, escorts, trades) – before combat
    stepGuild(this.state, events, SIM_DT);
    stepConvoys(this.state, events, SIM_DT);

    stepCombat(this.state, events, SIM_DT);
    // on-board workshop (M4c): after lasers, cannons, tractor and shields took their energy; flight only
    stepWorkshop(this.state, events, SIM_DT);
    stepNuggets(this.state, SIM_DT, events);
    // before the pirate step: it consumes the newly explored chunks
    stepCharting(this.state, events);
    events.push(...stepPirates(this.state, cmd, events));
    // space events (M4b): micrometeors, ambushes, comet flybys
    stepDirector(this.state, events);
    stepHome(this.state, events);
    stepDiscovery(this.state, cmd, events);
    assayOre(this.state, events);
    events.push(...stepCareer(this.state, events));
    stepGuildLoan(this.state, events, (id) => this.station(id));
    this.trackProgress(events);
    clampRefined(this.state.player.cargo, this.state.player.refined);
    this.state.tick++;
    return events;
  }

  /** The respawn point, the stats and the active ship's log after a step. */
  private trackProgress(events: readonly SimEvent[]): void {
    const { player, respawn, stats } = this.state;
    // the best ship the player has had (contract quotes, saboteur report X2) – every docked step, so a
    // loaded game records exactly what the original does
    if (player.dock.mode === 'docked') recordShipCapability(this.state);
    if (player.dock.mode === 'docked' && (respawn.stationId !== player.dock.stationId || respawn.grid !== player.grid)) {
      this.state.respawn = { stationId: player.dock.stationId, grid: player.grid };
    }
    for (const e of events) if (e.type === 'creditsChanged' && e.delta > 0) stats.creditsEarned += e.delta;
    // the active ship's log (M4a): its share of what the global stats gained in this step
    advanceShipLog(this.state.fleet.active.log, this.logMark, stats);
  }

  private runAction(action: GameAction): SimEvent[] {
    const { player } = this.state;
    if (isCareerAction(action)) {
      const at = player.dock.mode === 'docked' ? this.station(player.dock.stationId) : null;
      return careerAction(this.state, at, action);
    }
    if (isDiscoveryAction(action)) return discoveryAction(this.state, action);
    if (isChartAction(action)) return chartAction(this.state, action);
    // hangar and templates (M4a): they check docking themselves (rename and templates work in flight)
    if (isFleetAction(action)) {
      const at = player.dock.mode === 'docked' ? this.station(player.dock.stationId) : null;
      return fleetAction(this.state, at, action);
    }
    if (isTemplateAction(action)) return templateAction(this.state, action);
    // world sites (M4b): terminal and berth actions happen berthed at a derelict, not docked
    if (isSiteAction(action)) return siteAction(this.state, action);
    if (isDirectorAction(action)) return directorAction(this.state, action);
    // home station (M4c): the home actions check where the ship is themselves
    if (isHomeAction(action)) return homeAction(this.state, action);
    // M4d: convoy trade (linked to a trader), map notes (anywhere), the dev-only `debugGuild`
    if (isConvoyAction(action)) return convoyAction(this.state, action);
    if (isNavigationAction(action)) return navigationAction(this.state, action);
    if (isGuildAction(action)) return guildAction(this.state, action);
    if (player.dock.mode !== 'docked') return [{ type: 'actionResult', reqId: action.reqId, ok: false, reason: 'notDocked' }];
    const station = this.station(player.dock.stationId);
    if (!station) return [{ type: 'actionResult', reqId: action.reqId, ok: false, reason: 'serviceUnavailable' }];
    const events = applyAction(this.state, station, action);
    const ok = events.some((e) => e.type === 'actionResult' && e.ok);
    if (action.type === 'craft' && ok) this.state.stats.partsCrafted += action.count;
    if (ok) careerOnStationAction(this.state, action);
    return events;
  }

  private advanceDocking(events: SimEvent[]): void {
    const player = this.state.player;
    const dock = player.dock;
    if (dock.mode !== 'docking') return;
    const k = this.state.tick - dock.startTick + 1;
    player.prevBody = player.body;
    if (k >= DOCKING_TICKS) {
      const stored = this.enterDocked(dock.stationId, dock.to);
      events.push({ type: 'docked', stationId: dock.stationId }, ...stored);
      return;
    }
    const t = smoothstep(k / DOCKING_TICKS);
    player.body = {
      pos: lerp(dock.from.pos, dock.to.pos, t),
      vel: { x: 0, y: 0 },
      angle: lerpAngle(dock.from.angle, dock.to.angle, t),
      angVel: 0,
    };
  }

  /**
   * The ship is at the port: motionless, battery and shield charged, parts from wrecks go to the station storage.
   * Idempotent (a docked ship does not change). Returns a salvageStored event when something was stored.
   */
  enterDocked(stationId: StationId, pose: Body): SimEvent[] {
    const player = this.state.player;
    player.dock = { mode: 'docked', stationId };
    player.body = pose;
    player.prevBody = pose;
    player.beams = [];
    player.heat = new Map();
    player.lastLocalForce = { x: 0, y: 0 };
    player.energy = player.props.batteryCapacity;
    player.shield = player.props.shield.capacity;
    player.shieldDelay = 0;
    player.cooldowns = new Map();
    player.tractor = null;
    if (Object.keys(player.salvage).length === 0) return [];
    // ensureStorage: an untouched station (also home after a load) has no storage record yet (C1)
    const parts = player.salvage;
    mergeInventory(ensureStorage(this.state, stationId).parts, parts);
    player.salvage = {};
    return [{ type: 'salvageStored', stationId, parts }];
  }

  private tryDock(events: SimEvent[]): boolean {
    // a convoy trader's trade port in reach (M4d): link to it instead
    const link = tryConvoyLink(this.state, events);
    if (link !== 'none') return link === 'linked';
    // a derelict's dock clamp (M4b) when it is the nearest dock target: berth there instead
    const berth = tryBerth(this.state, events);
    if (berth !== 'none') return berth === 'berthed';
    const { player, world } = this.state;
    const check = checkDock(player.body, player.props.boundingRadius, world.stations(), playerDockRules(this.state));
    if (check.status !== 'ok' || !check.station) {
      const reason = check.status === 'ok' ? 'noStation' : check.status;
      events.push({ type: 'dockRejected', reason, distance: check.distance, speed: check.speed, angle: check.angle });
      return false;
    }
    const station = check.station;
    player.dock = {
      mode: 'docking',
      stationId: station.id,
      startTick: this.state.tick,
      from: player.body,
      to: dockPose(station, player.props.boundingRadius),
    };
    player.beams = [];
    player.lastLocalForce = { x: 0, y: 0 };
    events.push({ type: 'dockingStarted', stationId: station.id });
    this.advanceDocking(events);
    return true;
  }

  /** Heat of every laser (spec 2.1.1); cold lasers are left out of the map (canonical save). */
  private stepLaserHeat(onVein: readonly number[], events: SimEvent[]): void {
    const { player } = this.state;
    for (const laser of player.props.lasers) {
      const on = onVein.includes(laser.partId);
      const known = player.heat.get(laser.partId);
      // a cold laser off the vein stays cold: nothing to step, nothing stored (no temporary state)
      if (!known && !on) continue;
      const h = known ?? { heat: 0, cooling: 0 };
      if (stepHeat(h, on, SIM_DT)) events.push({ type: 'laserOverheated', partId: laser.partId });
      if (h.heat > 0 || h.cooling > 0) player.heat.set(laser.partId, h);
      else player.heat.delete(laser.partId);
    }
    if (player.heat.size > 0) {
      for (const id of [...player.heat.keys()]) {
        if (!player.props.lasers.some((l) => l.partId === id)) player.heat.delete(id);
      }
    }
  }

  private stepFlight(cmd: PlayerCommand, canDock: boolean, events: SimEvent[]): void {
    const { player, world } = this.state;
    const props = player.props;

    if (cmd.toggleDampers) {
      player.dampers = !player.dampers;
      events.push({ type: 'dampersToggled', on: player.dampers });
    }
    if (cmd.emergency && towAvailable(player)) {
      events.push(...towShip(this));
      return;
    }

    for (const stationId of world.update(player.body.pos)) events.push({ type: 'stationDiscovered', stationId });

    if (cmd.dock && canDock) {
      // F at a wreck or container with loot (and out of docking reach) = load the loot (M3.6)
      const loot = salvageAt(this.state);
      const dockable = checkDock(player.body, props.boundingRadius, world.stations(), playerDockRules(this.state)).status === 'ok';
      const contract = dockable ? null : careerInteraction(this.state);
      const found = dockable || contract ? null : discoveryInteraction(this.state);
      // F at a clan beacon (M3.6): clan challenge
      const beacon = dockable || contract || found ? null : pirateInteraction(this.state);
      if (loot && !dockable && !(loot.kind === 'hulk' && (contract || found))) {
        salvage(this.state, loot, events);
      } else if (contract) {
        // F at a survey point / a stranded ship (M3.5a)
        events.push(...interact(this.state, contract));
      } else if (found) {
        // F at a found cache / a ship in distress (M3.5b)
        interactDiscovery(this.state, found, events);
      } else if (beacon) {
        interactPirates(this.state, beacon, events);
      } else if (this.tryDock(events)) {
        return;
      }
    }

    // sector state (M3.5a): currents, fuel use, energy generation, veins
    const sector = sectorAt(this.state.seed, player.body.pos, this.state.tick);
    const effects = sectorEffects(sector);

    // anomaly bonuses (M3.5b): sling, ion charge, time echo
    const mods = flightMods(this.state);

    // flight – without fuel only the gyros work
    const hasFuel = player.fuel > 0;
    const flight = hasFuel ? cmd.flight : { forward: 0, strafe: 0, turn: cmd.flight.turn };
    const mass = props.mass + cargoMass(player.cargo);
    const thrust = mods.thrustMult === 1 ? props.thrust : scaleThrust(props.thrust, mods.thrustMult);
    // the flight view of the loaded ship – a reused object instead of a copy of all the properties
    const effective = PLAYER_FLIGHT;
    effective.thrust = thrust;
    effective.rcsThrust = props.rcsThrust;
    effective.torque = props.torque;
    effective.mass = mass;
    effective.inertia = (props.inertia * mass) / props.mass;
    const out = computeFlight(effective, player.body, flight, player.dampers && hasFuel, SIM_DT);

    const needed = flightFuel(out, props.fuelUseMult, SIM_DT) * effects.fuelUseMult;
    const ratio = needed > player.fuel ? player.fuel / needed : 1;
    const force = ratio < 1 ? scale(out.force, ratio) : out.force;
    const localForce = ratio < 1 ? scale(out.localForce, ratio) : out.localForce;
    player.fuel = Math.max(0, player.fuel - needed * ratio);
    if (hasFuel && player.fuel <= 0) events.push({ type: 'outOfFuel' });

    player.prevBody = player.body;
    const drift = driftOf(sector);
    // gravity anomalies pull (M3.5b)
    const pull = anomalyPull(this.state, player.body.pos);
    const ax = (drift?.x ?? 0) + pull.x;
    const ay = (drift?.y ?? 0) + pull.y;
    const pushed = ax !== 0 || ay !== 0 ? { x: force.x + ax * effective.mass, y: force.y + ay * effective.mass } : force;
    const moved = integrate(player.body, pushed, out.torque, effective.mass, effective.inertia, SIM_DT);
    const reach = props.boundingRadius + COLLISION_MARGIN;
    // one reused list (perf audit 2026-10-17, P4), read by resolveCollisions only
    const obstacles = PLAYER_OBSTACLES;
    clearList(obstacles);
    world.circlesInto(moved.pos, reach, obstacles);
    // giant asteroids (M3.5b) are as hard as any rock
    giantCirclesInto(this.state, moved.pos, reach, obstacles);
    fortressObstaclesInto(this.state, moved.pos, reach, obstacles);
    siteCollidersInto(this.state, moved.pos, reach, obstacles);
    // live Guild Watch and convoy ships (M4d) are safe obstacles (no ram damage), the Guild relay mast is hard
    npcCollidersInto(this.state, moved.pos, reach, obstacles);
    // stations do no damage – docking and manoeuvres near a station stay safe (M21)
    const stationsFrom = obstacles.length;
    world.stationCirclesInto(moved.pos, reach, obstacles);
    for (let i = stationsFrom; i < obstacles.length; i++) obstacles[i] = safeCircle(obstacles[i]!);
    const collision = resolveCollisions(moved, props.cellOffsets, props.boundingRadius, obstacles);
    player.body = collision.body;
    this.state.stats.distanceFlown += hypot(player.body.pos.x - player.prevBody.pos.x, player.body.pos.y - player.prevBody.pos.y);
    player.lastLocalForce = localForce;
    // an asteroid impact (M21) – applied at the end of the step, so mining and the cannons see the same ship
    const ram = ramDamage(collision.hardImpact);
    const ramPart = ram > 0 && collision.hardCell ? partAtCell(player.grid, props, collision.hardCell) : null;
    if (collision.impactSpeed > COLLISION_EVENT_SPEED) {
      const at = collision.contact ? { pos: collision.contact } : {};
      events.push(ram > 0 ? { type: 'collision', speed: collision.impactSpeed, damage: ram, ...at } : { type: 'collision', speed: collision.impactSpeed, ...at });
    }

    // mining – before recharging, so an empty battery really switches the laser off
    let onVein: readonly number[] = [];
    if (cmd.mining) {
      const before = { ...player.cargo };
      const range = props.boundingRadius + maxLaserRange(props);
      const result = runMining({
        body: player.body,
        props,
        cargo: player.cargo,
        energy: player.energy,
        aim: cmd.aim,
        candidates: world.circlesNear(player.body.pos, range),
        // giants (M3.5b) stop the beam – the heavy laser breaks the shell, the core is mined (mineGiants);
        // dismantlable wrecks (M3.6) too – the beam cuts their joints
        blockers: [
          ...world.stationCirclesNear(player.body.pos, range),
          ...giantCircles(this.state, player.body.pos, range),
          ...hulkCircles(this.state, player.body.pos, range),
          ...fortressObstacles(this.state, player.body.pos, range),
          // derelicts and relays stop the beam (a relay's receiver is charged by the beam end, M4b);
          // comet nuclei are movers, not blockers
          ...structureColliders(this.state, player.body.pos, range),
          // M4d: the Guild relay mast (charged like a derelict relay), Watch and convoy hulls
          ...npcColliders(this.state, player.body.pos, range),
        ],
        // moving targets (M4b comets)
        movers: miningMovers(this.state),
        world,
        dt: SIM_DT,
        yieldMultiplier: this.state.settings.miningYield,
        veinMultiplier: effects.veinYieldMult,
        time: this.state.tick * SIM_DT,
        heat: player.heat,
        gradeOf: (a) => oreGrade(this.state.seed, a),
      });
      spawnNuggets(this.state, result.extractions, events);
      applyMoverExtractions(this.state, result, events);
      onVein = mods.noHeat ? [] : result.onVein;
      mineGiants(this.state, result.beams, props, SIM_DT, this.state.settings.miningYield, events);
      applyCutting(this.state, result.beams, props, SIM_DT, events);
      for (const r of RESOURCE_IDS) this.state.stats.mined[r] += player.cargo[r] - before[r];
      player.energy -= result.energyUsed;
      player.beams = result.beams;
      if (result.cargoFilled) events.push({ type: 'cargoFull' });
      for (const id of result.depleted) events.push({ type: 'asteroidDepleted', id });
      for (const c of result.cracked) events.push({ type: 'asteroidCracked', ...c });
    } else {
      player.beams = [];
      applyCutting(this.state, [], props, SIM_DT, events);
    }
    this.stepLaserHeat(onVein, events);

    // tractor beam (M3.6): T grabs / releases, then the pull of the object to the ship
    if (cmd.tractor) toggleTractor(this.state, cmd.aim, events);
    stepTractor(this.state, SIM_DT, events);

    // cannons – the left button, aimed with the mouse (M3a)
    if (cmd.fire) {
      const combat = this.state.combat;
      for (const shot of fireWeapons(player, 'player', cmd.aim, combat)) {
        combat.projectiles.push(shot);
        events.push(shotEvent('player', shot.pos, shot.vel, player.body.vel, shot.tier));
      }
    }
    player.energy = Math.min(props.batteryCapacity, player.energy + props.energyGen * effects.energyGenMult * mods.energyGenMult * SIM_DT);
    applyRam(this.state, PLAYER_REF, player, ramPart, ram, events);
    // engines blowing into a part burn it (design 3.4.2)
    if (!player.destroyed) burnExhausts(this.state, PLAYER_REF, player, localForce, events, SIM_DT);
  }
}
