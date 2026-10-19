// Hand-written type guards for the current SaveGame (spec M2, 9.3 and 12.4; combat M3a; veins M2d;
// career M3.5a; discovery M3.5b; salvage M3.6; fleet and templates M4a / V16; world sites and the events
// director M4b / V17; shaped armour SL2 E2 / V18; home station, paints and the workshop M4c / V19; the
// Guild, convoys and map notes M4d / V20) – no dependencies.
// The result is a clean copy (unknown fields are dropped). An invalid ship is not rejected: it is taken
// apart into the respawn station's storage and replaced by the starter ship (a stored ship likewise,
// validateFleet.ts).
import { ALL_PART_KEYS, PART_IDS, partDef, partKey, TIERS, variantFits, type PartId, type PartInventory, type PartKey, type Tier } from '../../data/parts';
import type { ShapeId } from '../../data/shapes';
import { PLAN_IDS, type PlanId } from '../../data/plans';
import { WRECK_CLASSES, type WreckClass } from '../../data/poi';
import { COOL_TICKS, HEAT_MAX } from '../mining/heat';
import { hullBudgetOf } from '../ship/budget';
import { AI_MODES, ENEMY_KINDS, type Livery, type TractorState } from '../combat/types';
import { RESOURCE_IDS, cargoUsed, emptyCargo, type Cargo } from '../../data/resources';
import type { Vec2 } from '../math/vec2';
import { DEATH_PENALTIES, ENEMY_DENSITIES, MINING_YIELDS, type GameSettings } from '../settings';
import type { GameStats } from '../Simulation';
import { validateGrid } from '../ship/grid';
import { maxHp } from '../ship/hp';
import { shapeProblem } from '../ship/shape';
import { loanStarterShip } from '../ship/loan';
import { computeProperties } from '../ship/properties';
import type { Rotation } from '../ship/types';
import { dockPose } from '../station/dock';
import { homeStation, stationById, type StationId } from '../world/stations';
import { WORLD_GENS, type WorldGen } from '../world/worldGen';
import { fitHangar, gridShape, gridToSave } from './gridSave';
import { validateCareer } from './validateCareer';
import { validateRegions } from './regions';
import { validateDiscovery } from './validateDiscovery';
import { validatePirates } from './validatePirates';
import { validateMining } from './validateMining';
import { repairFleet, validateFleetShape, validateTemplatesShape } from './validateFleet';
import { repairSites, validateDirectorShape, validateSitesShape } from './validateSites';
import { repairHome, validateHomeShape, validateRefined, validateRepair } from './validateHome';
import { repairGuild, validateGuildShape } from './validateGuild';
import { repairConvoys, validateConvoysShape } from './validateConvoys';
import { validateNavigationShape } from './validateNavigation';
import {
  SAVE_REASONS,
  type SavedBodyV1,
  type SavedCombatV16,
  type SavedContainerV6,
  type SavedEnemyV9,
  type SavedGridV1,
  type SavedStationV1,
  type SavedWreckV16,
  type SaveGame,
  type SaveReason,
} from './types';

/**
 * A load warning (the save loaded, but something was repaired or the player should be told).
 * overBudgetLegacy: a ship from an old game is over the hull budget – it flies on, but nothing can be
 * added to it until it is under the budget (long-term design 3.4.1).
 */
export type LoadWarning =
  | { code: 'shipReplaced'; stationId: StationId }
  | { code: 'overBudgetLegacy'; used: number; budget: number }
  /**
   * A value above its capacity (fuel, energy, shield, cargo of the player or a pirate, part or fortress
   * HP – capacities are tunable) was clamped instead of rejecting the whole save (M1). `paths` lists them.
   */
  | { code: 'capacityClamped'; paths: string[] }
  /**
   * The ship (from a save before exhaust burns, V8 and older) has engines blowing into other parts –
   * those parts now burn while the engines fire (I15). `engines` = how many nozzles are covered.
   */
  | { code: 'coveredNozzleLegacy'; engines: number }
  /**
   * A ship stored in a hangar slot could not stand there (invalid ship, Guild loan parts, a station
   * without a shipyard, a duplicate id – V16): its parts and cargo are in the storage at `stationId`.
   */
  | { code: 'storedShipDropped'; shipId: number; stationId: StationId }
  /**
   * World site records (V17) that do not match this world's generator (a site, relay, comet or mine it no
   * longer has – placement is tunable), a berth at a derelict without power, an enemy of a site that is
   * gone, a trophy pin (V19) whose captain or fortress this save does not have, or Guild and convoy records
   * (V20) that do not match this seed or the save tick (a relay site, a pass, a link, an escort without its
   * contract) were dropped or cut to size. `paths` lists them.
   */
  | { code: 'sitesRepaired'; paths: string[] };

export type ValidationResult = { ok: true; save: SaveGame; warnings: LoadWarning[] } | { ok: false; errors: string[] };

/** Capacity tolerance (fuel, energy, cargo) for floating-point errors. */
const CAPACITY_EPS = 1e-6;
const STATION_ID = /^(home|st:-?\d+,-?\d+)$/;
const CHUNK_KEY = /^-?\d+,-?\d+$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);

export class Checker {
  readonly errors: string[] = [];
  /** Paths of values clamped to their capacity (warning `capacityClamped`, M1). */
  readonly clamped: string[] = [];

  err(path: string, msg: string): void {
    this.errors.push(`${path}: ${msg}`);
  }

  obj(v: unknown, path: string): Obj | null {
    if (isObj(v)) return v;
    this.err(path, 'expected an object');
    return null;
  }

  arr(v: unknown, path: string): unknown[] | null {
    if (Array.isArray(v)) return v;
    this.err(path, 'expected an array');
    return null;
  }

  str(v: unknown, path: string, nonEmpty = false): string {
    if (typeof v === 'string' && (!nonEmpty || v.length > 0)) return v;
    this.err(path, nonEmpty ? 'expected a non-empty string' : 'expected a string');
    return '';
  }

  date(v: unknown, path: string): string {
    const s = this.str(v, path, true);
    if (s && Number.isNaN(Date.parse(s))) this.err(path, 'expected an ISO date');
    return s;
  }

  bool(v: unknown, path: string): boolean {
    if (typeof v === 'boolean') return v;
    this.err(path, 'expected a boolean');
    return false;
  }

  /**
   * A number of at least `min`; a value above the (tunable) capacity `max` is clamped to it and reported
   * as a warning instead of an error (M1).
   */
  capped(v: unknown, path: string, min: number, max: number): number {
    const value = this.num(v, path, min);
    if (value <= max + CAPACITY_EPS) return value;
    this.clamped.push(path);
    return Math.max(min, max);
  }

  num(v: unknown, path: string, min = -Infinity, max = Infinity): number {
    if (!isNum(v)) {
      this.err(path, 'expected a finite number');
      return 0;
    }
    if (v < min || v > max) this.err(path, `out of range [${min}, ${max}]`);
    return v;
  }

  int(v: unknown, path: string, min = -Infinity, max = Infinity): number {
    if (!isInt(v)) {
      this.err(path, 'expected an integer');
      return 0;
    }
    return this.num(v, path, min, max);
  }

  oneOf<T>(v: unknown, options: readonly T[], path: string): T {
    if (options.includes(v as T)) return v as T;
    this.err(path, `expected one of ${options.join(', ')}`);
    return options[0]!;
  }

  stationId(v: unknown, path: string): StationId {
    const s = this.str(v, path);
    if (!STATION_ID.test(s)) this.err(path, 'expected a station id');
    return s;
  }

  vec(v: unknown, path: string): Vec2 {
    const o = this.obj(v, path);
    if (!o) return { x: 0, y: 0 };
    return { x: this.num(o.x, path), y: this.num(o.y, path) };
  }

  /** A complete cargo – every resource, no unknown ones. */
  cargo(v: unknown, path: string): Cargo {
    const o = this.obj(v, path);
    const out = emptyCargo();
    if (!o) return out;
    for (const r of RESOURCE_IDS) out[r] = this.num(o[r], `${path}.${r}`, 0);
    for (const k of Object.keys(o)) if (!(RESOURCE_IDS as readonly string[]).includes(k)) this.err(`${path}.${k}`, 'unknown resource');
    return out;
  }

  parts(v: unknown, path: string): PartInventory {
    const o = this.obj(v, path);
    const out: PartInventory = {};
    if (!o) return out;
    for (const [k, n] of Object.entries(o)) {
      if (!(ALL_PART_KEYS as readonly string[]).includes(k)) {
        this.err(`${path}.${k}`, 'unknown part key');
        continue;
      }
      const count = this.int(n, `${path}.${k}`, 0);
      if (count > 0) out[k as PartKey] = count;
    }
    return out;
  }

  grid(v: unknown, path: string): SavedGridV1 {
    const o = this.obj(v, path);
    if (!o) return { nextId: 0, parts: [] };
    const list = this.arr(o.parts, `${path}.parts`) ?? [];
    const ids = new Set<number>();
    let maxId = -1;
    const parts = list.map((raw, i) => {
      const pp = `${path}.parts[${i}]`;
      const p = this.obj(raw, pp) ?? {};
      const id = this.int(p.id, `${pp}.id`, 0);
      if (ids.has(id)) this.err(`${pp}.id`, 'duplicate part id');
      ids.add(id);
      maxId = Math.max(maxId, id);
      const partId = this.oneOf<PartId>(p.partId, PART_IDS, `${pp}.partId`);
      const part = {
        id,
        partId,
        tier: this.oneOf<Tier>(p.tier, TIERS, `${pp}.tier`),
        x: this.int(p.x, `${pp}.x`),
        y: this.int(p.y, `${pp}.y`),
        rot: this.oneOf<Rotation>(p.rot, [0, 1, 2, 3], `${pp}.rot`),
      };
      // a Guild loan part (V8) carries `loan: true`, nothing else
      if (p.loan !== undefined && p.loan !== true) this.err(`${pp}.loan`, 'expected true or nothing');
      const loan = p.loan === true ? { loan: true as const } : {};
      // a shape (V18) must be known and the part shapeable (armour); footprints, overlaps and budgets
      // follow it in the grid checks (`validateGrid`, `fitHangar`, `hullBudgetOf` read the shape)
      const shapeErr = p.shape === undefined ? null : shapeProblem({ partId, shape: p.shape as ShapeId });
      if (shapeErr) this.err(`${pp}.shape`, shapeErr === 'unknownShape' ? 'unknown shape' : 'shape not allowed on this part');
      const shape = p.shape !== undefined && !shapeErr ? { shape: p.shape as ShapeId } : {};
      // the part's variant (V5) must belong to its type
      if (p.variant === undefined) return { ...part, ...loan, ...shape };
      if (!variantFits(partId, p.variant)) {
        this.err(`${pp}.variant`, 'unknown variant for this part');
        return { ...part, ...loan, ...shape };
      }
      return { ...part, variant: p.variant, ...loan, ...shape };
    });
    const nextId = this.int(o.nextId, `${path}.nextId`, 0);
    if (nextId <= maxId) this.err(`${path}.nextId`, 'must be greater than every part id');
    return { nextId, parts };
  }

  body(v: unknown, path: string): SavedBodyV1 {
    const o = this.obj(v, path) ?? {};
    return {
      pos: this.vec(o.pos, `${path}.pos`),
      vel: this.vec(o.vel, `${path}.vel`),
      angle: this.num(o.angle, `${path}.angle`),
      angVel: this.num(o.angVel, `${path}.angVel`),
    };
  }

  stats(v: unknown, path: string): GameStats {
    const o = this.obj(v, path) ?? {};
    return {
      mined: this.cargo(o.mined, `${path}.mined`),
      creditsEarned: this.num(o.creditsEarned, `${path}.creditsEarned`, 0),
      partsCrafted: this.int(o.partsCrafted, `${path}.partsCrafted`, 0),
      distanceFlown: this.num(o.distanceFlown, `${path}.distanceFlown`, 0),
      deaths: this.int(o.deaths, `${path}.deaths`, 0),
      kills: this.int(o.kills, `${path}.kills`, 0),
      // added after save V6 without a version bump: older saves simply have had no emergency kit yet
      lastEmergencyKit: o.lastEmergencyKit === undefined ? -1 : this.int(o.lastEmergencyKit, `${path}.lastEmergencyKit`, -1),
      bestUnitsPerHour: this.bestUnits(o.bestUnitsPerHour, `${path}.bestUnitsPerHour`),
    };
  }

  /** Four non-negative numbers (units/h per ring). */
  bestUnits(v: unknown, path: string): number[] {
    const list = this.arr(v, path) ?? [];
    if (list.length !== 4) this.err(path, 'expected 4 numbers (one per ring)');
    return [0, 1, 2, 3].map((i) => (i < list.length ? this.num(list[i], `${path}[${i}]`, 0) : 0));
  }

  /** [part id, value] pairs; `check` checks the value against the grid's part. */
  idPairs(v: unknown, path: string, grid: SavedGridV1, check: (value: number, partId: number) => string | null): [number, number][] {
    const out: [number, number][] = [];
    (this.arr(v, path) ?? []).forEach((entry, i) => {
      const p = `${path}[${i}]`;
      if (!Array.isArray(entry) || entry.length !== 2) return this.err(p, 'expected [id, value]');
      const id = this.int(entry[0], p);
      const value = this.num(entry[1], p);
      if (!grid.parts.some((x) => x.id === id)) return this.err(p, `no part with id ${id}`);
      const problem = check(value, id);
      if (problem) this.err(p, problem);
      out.push([id, value]);
    });
    return out;
  }

  hp(v: unknown, path: string, grid: SavedGridV1): [number, number][] {
    const pairs = this.idPairs(v, path, grid, (value) => (value <= 0 ? `hp ${value} out of (0, max]` : null));
    // a part's maximum HP is tunable: more than it now has is clamped (M1)
    return pairs.map(([id, value], i): [number, number] => {
      const max = maxHp(grid.parts.find((x) => x.id === id)!);
      if (value <= max) return [id, value];
      this.clamped.push(`${path}[${i}]`);
      return [id, max];
    });
  }

  cooldowns(v: unknown, path: string, grid: SavedGridV1): [number, number][] {
    return this.idPairs(v, path, grid, (value) => (Number.isInteger(value) && value > 0 ? null : 'expected a positive integer'));
  }

  /** Laser heat: [mining part id, heat 0 … HEAT_MAX, cooling steps 0 … COOL_TICKS]. */
  heat(v: unknown, path: string, grid: SavedGridV1): [number, number, number][] {
    const out: [number, number, number][] = [];
    (this.arr(v, path) ?? []).forEach((entry, i) => {
      const p = `${path}[${i}]`;
      if (!Array.isArray(entry) || entry.length !== 3) return this.err(p, 'expected [partId, heat, cooling]');
      const id = this.int(entry[0], p);
      const part = grid.parts.find((x) => x.id === id);
      if (!part) return this.err(p, `no part with id ${id}`);
      if (!partDef(part.partId, part.tier, part.variant).mining) return this.err(p, `part ${id} is not a mining laser`);
      out.push([id, this.num(entry[1], p, 0, HEAT_MAX), this.int(entry[2], p, 0, COOL_TICKS)]);
    });
    return out;
  }

  /** Vein state: [asteroid id, segment centres 0 … 1, directions ±1] (1–3 veins). */
  veins(v: unknown, path: string): [string, number[], number[]][] {
    const out: [string, number[], number[]][] = [];
    (this.arr(v, path) ?? []).forEach((entry, i) => {
      const p = `${path}[${i}]`;
      if (!Array.isArray(entry) || entry.length !== 3) return this.err(p, 'expected [asteroidId, centers, dirs]');
      const id = this.str(entry[0], p, true);
      const centers = (this.arr(entry[1], `${p}.centers`) ?? []).map((c) => this.num(c, `${p}.centers`, 0, 1));
      const dirs = (this.arr(entry[2], `${p}.dirs`) ?? []).map((d) => this.oneOf<number>(d, [1, -1], `${p}.dirs`));
      if (centers.length === 0 || centers.length > 3 || dirs.length !== centers.length) this.err(p, 'expected 1–3 veins');
      out.push([id, centers, dirs]);
    });
    return out;
  }

  combat(v: unknown, path: string): SavedCombatV16 {
    const o = this.obj(v, path) ?? {};
    const enemies = (this.arr(o.enemies, `${path}.enemies`) ?? []).map((raw, i) => this.enemy(raw, `${path}.enemies[${i}]`));
    const defeated: [string, number][] = [];
    (this.arr(o.defeated, `${path}.defeated`) ?? []).forEach((entry, i) => {
      const p = `${path}.defeated[${i}]`;
      if (!Array.isArray(entry) || entry.length !== 2) return this.err(p, 'expected [slotId, tick]');
      defeated.push([this.str(entry[0], p, true), this.int(entry[1], p, 0)]);
    });
    const projectiles = (this.arr(o.projectiles, `${path}.projectiles`) ?? []).map((raw, i) => {
      const p = `${path}.projectiles[${i}]`;
      const x = this.obj(raw, p) ?? {};
      return {
        id: this.int(x.id, `${p}.id`, 0),
        owner: this.str(x.owner, `${p}.owner`, true),
        pos: this.vec(x.pos, `${p}.pos`),
        vel: this.vec(x.vel, `${p}.vel`),
        ttl: this.int(x.ttl, `${p}.ttl`, 1),
        damage: this.num(x.damage, `${p}.damage`, 0),
        tier: this.oneOf<Tier>(x.tier, TIERS, `${p}.tier`),
        origin: this.vec(x.origin, `${p}.origin`),
      };
    });
    const wrecks = (this.arr(o.wrecks, `${path}.wrecks`) ?? []).map((raw, i) => this.wreck(raw, `${path}.wrecks[${i}]`));
    const containers = (this.arr(o.containers, `${path}.containers`) ?? []).map((raw, i) => this.container(raw, `${path}.containers[${i}]`));
    return {
      rng: this.int(o.rng, `${path}.rng`, 0, 0xffff_ffff),
      nextId: this.int(o.nextId, `${path}.nextId`, 1),
      enemies,
      defeated,
      projectiles,
      wrecks,
      containers,
    };
  }

  /** A container (V6): POI containers have negative ids. */
  container(raw: unknown, path: string): SavedContainerV6 {
    const o = this.obj(raw, path) ?? {};
    const poi = o.poi === undefined ? undefined : this.str(o.poi, `${path}.poi`, true);
    const loot = this.obj(o.loot, `${path}.loot`) ?? {};
    return {
      id: this.int(o.id, `${path}.id`, poi ? -Infinity : 0),
      body: this.body(o.body, `${path}.body`),
      loot: { cargo: this.cargo(loot.cargo, `${path}.loot.cargo`), parts: this.parts(loot.parts, `${path}.loot.parts`) },
      ttl: this.int(o.ttl, `${path}.ttl`, 0),
      ...(poi ? { poi } : {}),
    };
  }

  /** The player's tractor beam (V6). */
  tractor(v: unknown, path: string): TractorState | null {
    if (v === null) return null;
    const o = this.obj(v, path) ?? {};
    const t = this.obj(o.target, `${path}.target`) ?? {};
    const kind = this.oneOf(t.kind, ['wreck', 'container', 'nugget'] as const, `${path}.target.kind`);
    const id = this.int(t.id, `${path}.target.id`);
    let rip: TractorState['rip'] = null;
    if (o.rip !== null) {
      const r = this.obj(o.rip, `${path}.rip`) ?? {};
      rip = { partId: this.int(r.partId, `${path}.rip.partId`), progress: this.num(r.progress, `${path}.rip.progress`, 0, 1) };
    }
    return { target: { kind, id }, rip };
  }

  /** A pirate's fuel (V9): within the tanks of its grid (more is clamped, M1 / C1). */
  enemyFuel(v: unknown, path: string, grid: SavedGridV1): number {
    const capacity = grid.parts.length > 0 && validateGrid(gridShape(grid)).length === 0 ? computeProperties(gridShape(grid)).fuelCapacity : 0;
    return this.capped(v, path, 0, capacity);
  }

  enemy(raw: unknown, path: string): SavedEnemyV9 {
    const o = this.obj(raw, path) ?? {};
    const grid = this.grid(o.grid, `${path}.grid`);
    if (grid.parts.length > 0 && validateGrid(gridShape(grid)).length > 0) this.err(`${path}.grid`, 'invalid ship');
    const ai = this.obj(o.ai, `${path}.ai`) ?? {};
    const holdRaw = o.hold === undefined ? null : (this.obj(o.hold, `${path}.hold`) ?? {});
    const hold = holdRaw ? { hold: { cargo: this.cargo(holdRaw.cargo, `${path}.hold.cargo`), parts: this.parts(holdRaw.parts, `${path}.hold.parts`) } } : {};
    return {
      ...hold,
      id: this.str(o.id, `${path}.id`, true),
      kind: this.oneOf(o.kind, ENEMY_KINDS, `${path}.kind`),
      grid,
      hp: this.hp(o.hp, `${path}.hp`, grid),
      body: this.body(o.body, `${path}.body`),
      energy: this.num(o.energy, `${path}.energy`, 0),
      shield: this.num(o.shield, `${path}.shield`, 0),
      shieldDelay: this.int(o.shieldDelay, `${path}.shieldDelay`, 0),
      cooldowns: this.cooldowns(o.cooldowns, `${path}.cooldowns`, grid),
      home: this.vec(o.home, `${path}.home`),
      maxHull: this.num(o.maxHull, `${path}.maxHull`, 0),
      fuel: this.enemyFuel(o.fuel, `${path}.fuel`, grid),
      ai: {
        mode: this.oneOf(ai.mode, AI_MODES, `${path}.ai.mode`),
        waypoint: this.vec(ai.waypoint, `${path}.ai.waypoint`),
        timer: this.int(ai.timer, `${path}.ai.timer`),
        orbit: this.oneOf<1 | -1>(ai.orbit, [1, -1], `${path}.ai.orbit`),
        breakOff: this.int(ai.breakOff, `${path}.ai.breakOff`, 0),
        react: this.int(ai.react, `${path}.ai.react`, 0),
        seen: this.vec(ai.seen, `${path}.ai.seen`),
      },
    };
  }

  wreck(raw: unknown, path: string): SavedWreckV16 {
    const o = this.obj(raw, path) ?? {};
    const grid = this.grid(o.grid, `${path}.grid`);
    if (grid.parts.length === 0) this.err(`${path}.grid`, 'a wreck needs at least one part');
    if (grid.parts.length > 0 && validateGrid(gridShape(grid)).includes('overlap')) this.err(`${path}.grid`, 'overlapping parts');
    const loot = this.obj(o.loot, `${path}.loot`) ?? {};
    // POI and contract wrecks (V5) have negative ids outside the combat numbering
    const poi = o.poi === undefined ? undefined : this.str(o.poi, `${path}.poi`, true);
    const out: SavedWreckV16 = {
      id: this.int(o.id, `${path}.id`, poi ? -Infinity : 0),
      grid,
      body: this.body(o.body, `${path}.body`),
      loot: { cargo: this.cargo(loot.cargo, `${path}.loot.cargo`), parts: this.parts(loot.parts, `${path}.loot.parts`) },
      ttl: this.int(o.ttl, `${path}.ttl`, 0),
      livery: this.oneOf<Livery>(o.livery, ['default', 'pirate'], `${path}.livery`),
    };
    if (poi) out.poi = poi;
    if (o.cls !== undefined) out.cls = this.oneOf<WreckClass>(o.cls, WRECK_CLASSES, `${path}.cls`);
    if (o.contents !== undefined) {
      const x = this.obj(o.contents, `${path}.contents`) ?? {};
      const fragment = x.fragment === null ? null : this.oneOf<PlanId>(x.fragment, PLAN_IDS, `${path}.contents.fragment`);
      out.contents = { fragment, shard: this.bool(x.shard, `${path}.contents.shard`) };
    }
    // dismantling (V6): the intact parts and the part being cut must be in the wreck's grid
    const ids = new Set(grid.parts.map((p) => p.id));
    if (o.dismantle !== undefined) {
      const x = this.obj(o.dismantle, `${path}.dismantle`) ?? {};
      const intact = (this.arr(x.intact, `${path}.dismantle.intact`) ?? []).map((id, i) => this.int(id, `${path}.dismantle.intact[${i}]`));
      for (const id of intact) if (!ids.has(id)) this.err(`${path}.dismantle.intact`, `no part with id ${id}`);
      out.dismantle = { intact };
    }
    if (o.cutting !== undefined) {
      const x = this.obj(o.cutting, `${path}.cutting`) ?? {};
      const partId = this.int(x.partId, `${path}.cutting.partId`);
      if (!ids.has(partId)) this.err(`${path}.cutting.partId`, `no part with id ${partId}`);
      out.cutting = { partId, progress: this.num(x.progress, `${path}.cutting.progress`, 0, 1) };
    }
    if (o.from !== undefined) out.from = this.str(o.from, `${path}.from`, true);
    // a player wreck's fleet ship (V16)
    if (o.ship !== undefined) out.ship = this.int(o.ship, `${path}.ship`, 1);
    return out;
  }
}

export function validateSave(data: unknown): ValidationResult {
  const c = new Checker();
  if (!isObj(data)) return { ok: false, errors: ['save: expected an object'] };
  if (data.version !== 20) return { ok: false, errors: [`version: expected 20, got ${String(data.version)}`] };

  const settingsRaw = c.obj(data.settings, 'settings') ?? {};
  const settings: GameSettings = {
    seedText: c.str(settingsRaw.seedText, 'settings.seedText'),
    deathPenalty: c.oneOf(settingsRaw.deathPenalty, DEATH_PENALTIES, 'settings.deathPenalty'),
    enemyDensity: c.oneOf(settingsRaw.enemyDensity, ENEMY_DENSITIES, 'settings.enemyDensity'),
    miningYield: c.oneOf(settingsRaw.miningYield, MINING_YIELDS, 'settings.miningYield'),
    fallenFromHardcore: c.bool(settingsRaw.fallenFromHardcore, 'settings.fallenFromHardcore'),
  };

  const playerRaw = c.obj(data.player, 'player') ?? {};
  const grid = c.grid(playerRaw.grid, 'player.grid');
  const hp = c.hp(playerRaw.hp, 'player.hp', grid);
  const dockedAtRaw = playerRaw.dockedAt;
  const dockedAt = dockedAtRaw === null ? null : c.stationId(dockedAtRaw, 'player.dockedAt');
  const cargo = c.cargo(playerRaw.cargo, 'player.cargo');
  const player: SaveGame['player'] = {
    grid,
    hp,
    body: c.body(playerRaw.body, 'player.body'),
    dampers: c.bool(playerRaw.dampers, 'player.dampers'),
    fuel: c.num(playerRaw.fuel, 'player.fuel', 0),
    energy: c.num(playerRaw.energy, 'player.energy', 0),
    cargo,
    dockedAt,
    shield: c.num(playerRaw.shield, 'player.shield', 0),
    shieldDelay: c.int(playerRaw.shieldDelay, 'player.shieldDelay', 0),
    cooldowns: c.cooldowns(playerRaw.cooldowns, 'player.cooldowns', grid),
    salvage: c.parts(playerRaw.salvage, 'player.salvage'),
    destroyed: c.bool(playerRaw.destroyed, 'player.destroyed'),
    scuttled: c.bool(playerRaw.scuttled, 'player.scuttled'),
    heat: c.heat(playerRaw.heat, 'player.heat', grid),
    tractor: c.tractor(playerRaw.tractor, 'player.tractor'),
    blueprint: c.grid(playerRaw.blueprint, 'player.blueprint'),
    // M4c workshop (V19)
    refined: validateRefined(c, playerRaw.refined, 'player.refined', cargo),
    repair: validateRepair(c, playerRaw.repair, 'player.repair', grid),
  };

  const respawnRaw = c.obj(data.respawn, 'respawn') ?? {};
  const respawn = {
    stationId: c.stationId(respawnRaw.stationId, 'respawn.stationId'),
    grid: c.grid(respawnRaw.grid, 'respawn.grid'),
  };

  const stationsRaw = c.obj(data.stations, 'stations') ?? {};
  const stations: Record<StationId, SavedStationV1> = {};
  for (const [id, raw] of Object.entries(stationsRaw)) {
    const path = `stations.${id}`;
    if (!STATION_ID.test(id)) c.err(path, 'expected a station id');
    const s = c.obj(raw, path) ?? {};
    stations[id] = { resources: c.cargo(s.resources, `${path}.resources`), parts: c.parts(s.parts, `${path}.parts`) };
  }

  const worldRaw = c.obj(data.world, 'world') ?? {};
  const remaining: [string, number][] = [];
  (c.arr(worldRaw.remaining, 'world.remaining') ?? []).forEach((entry, i) => {
    const path = `world.remaining[${i}]`;
    if (!Array.isArray(entry) || entry.length !== 2) return c.err(path, 'expected [asteroidId, amount]');
    remaining.push([c.str(entry[0], path, true), c.num(entry[1], path, 0)]);
  });
  const explored = (c.arr(worldRaw.explored, 'world.explored') ?? []).map((k, i) => {
    const s = c.str(k, `world.explored[${i}]`);
    if (!CHUNK_KEY.test(s)) c.err(`world.explored[${i}]`, 'expected a chunk key "cx,cy"');
    return s;
  });
  const discoveredStations = (c.arr(worldRaw.discoveredStations, 'world.discoveredStations') ?? []).map((id, i) =>
    c.stationId(id, `world.discoveredStations[${i}]`),
  );
  let center: [number, number] | null = null;
  if (worldRaw.center !== null) {
    const arr = c.arr(worldRaw.center, 'world.center');
    if (arr && arr.length === 2) center = [c.int(arr[0], 'world.center'), c.int(arr[1], 'world.center')];
    else if (arr) c.err('world.center', 'expected [cx, cy] or null');
  }

  const cracked: [string, number][] = [];
  (c.arr(worldRaw.cracked, 'world.cracked') ?? []).forEach((entry, i) => {
    const path = `world.cracked[${i}]`;
    if (!Array.isArray(entry) || entry.length !== 2) return c.err(path, 'expected [asteroidId, amount]');
    cracked.push([c.str(entry[0], path, true), c.num(entry[1], path, 0)]);
  });

  const seed = c.int(data.seed, 'seed', 0, 0xffff_ffff);
  const save: SaveGame = {
    version: 20,
    gameId: c.str(data.gameId, 'gameId', true),
    name: c.str(data.name, 'name'),
    createdAt: c.date(data.createdAt, 'createdAt'),
    savedAt: c.date(data.savedAt, 'savedAt'),
    saveReason: c.oneOf<SaveReason>(data.saveReason, SAVE_REASONS, 'saveReason'),
    gameVersion: c.str(data.gameVersion, 'gameVersion'),
    seed,
    worldGen: c.oneOf<WorldGen>(data.worldGen, WORLD_GENS, 'worldGen'),
    settings,
    tick: c.int(data.tick, 'tick', 0),
    credits: c.num(data.credits, 'credits', 0),
    player,
    respawn,
    stations,
    world: { remaining, explored, discoveredStations, center, veins: c.veins(worldRaw.veins, 'world.veins'), cracked },
    stats: c.stats(data.stats, 'stats'),
    combat: c.combat(data.combat, 'combat'),
    career: validateCareer(c, data.career, 'career'),
    discovery: validateDiscovery(c, data.discovery, 'discovery'),
    pirates: validatePirates(c, data.pirates, 'pirates'),
    mining: validateMining(c, data.mining, 'mining'),
    regions: validateRegions(c, data.regions, 'regions', seed),
    fleet: validateFleetShape(c, data.fleet, 'fleet'),
    templates: validateTemplatesShape(c, data.templates, 'templates'),
    sites: validateSitesShape(c, data.sites, 'sites'),
    director: validateDirectorShape(c, data.director, 'director'),
    home: validateHomeShape(c, data.home, 'home'),
    // M4d (V20)
    guild: validateGuildShape(c, data.guild, 'guild'),
    convoys: validateConvoysShape(c, data.convoys, 'convoys'),
    navigation: validateNavigationShape(c, data.navigation, 'navigation'),
  };
  if (c.errors.length > 0) return { ok: false, errors: c.errors };

  // --- ship validity (the structure is fine by now) ---
  const warnings: LoadWarning[] = [];
  // a ship outside the hangar would report tooLarge in the shipyard forever (M7): move it in if it fits
  const respawnFits = fitHangar(save.respawn.grid);
  if (respawnFits) save.respawn.grid = respawnFits;
  if (!respawnFits || validateGrid(gridShape(save.respawn.grid)).length > 0) save.respawn.grid = gridShape(save.player.grid);
  const playerFits = fitHangar(save.player.grid);
  // the blueprint shares the ship's cells: a ship moved into the hangar (or a broken blueprint)
  // starts a new one from the ship as it is
  const blueprintFits = fitHangar(save.player.blueprint);
  if (playerFits !== save.player.grid || blueprintFits !== save.player.blueprint || validateGrid(gridShape(save.player.blueprint)).length > 0) {
    save.player.blueprint = gridShape(playerFits ?? save.player.grid);
  }
  if (playerFits) save.player.grid = playerFits;
  if (!playerFits || validateGrid(gridShape(save.player.grid)).length > 0) {
    warnings.push({ code: 'shipReplaced', stationId: replaceShip(save) });
  }
  const hull = hullBudgetOf(gridShape(save.player.grid));
  if (hull.over && hull.budget !== null) warnings.push({ code: 'overBudgetLegacy', used: hull.used, budget: hull.budget });

  // capacities are tunable (and a ship can shrink): an overflow is clamped with a warning, never a
  // rejected save (M1)
  const props = computeProperties(gridShape(save.player.grid));
  save.player.fuel = c.capped(save.player.fuel, 'player.fuel', 0, props.fuelCapacity);
  save.player.energy = c.capped(save.player.energy, 'player.energy', 0, props.batteryCapacity);
  save.player.shield = c.capped(save.player.shield, 'player.shield', 0, props.shield.capacity);
  const used = cargoUsed(save.player.cargo);
  if (used > props.cargoCapacity + CAPACITY_EPS) {
    c.clamped.push('player.cargo');
    const k = props.cargoCapacity / used;
    for (const r of RESOURCE_IDS) save.player.cargo[r] *= k;
  }
  // stored ships, slots and templates (V16): repaired, never a rejected save
  warnings.push(...repairFleet(c, save));
  // world sites, the director and the site enemies (V17): checked against the seed, repaired
  const sitePaths = repairSites(save);
  // refined ore and the repair bank follow the checked ships, pins the trophies of this save (V19)
  sitePaths.push(...repairHome(c, save));
  // the Guild and the convoys (V20): checked against the seed, the save tick, the ship and the contracts
  sitePaths.push(...repairGuild(save), ...repairConvoys(save));
  if (sitePaths.length > 0) warnings.push({ code: 'sitesRepaired', paths: sitePaths });
  if (c.errors.length > 0) return { ok: false, errors: c.errors };
  if (c.clamped.length > 0) warnings.push({ code: 'capacityClamped', paths: [...c.clamped] });
  return { ok: true, save, warnings };
}

/**
 * Spec 12.4: an invalid ship → its parts into the respawn point's storage, the starter ship docked there,
 * the cargo into that station's storage. Returns the station id.
 */
function replaceShip(save: SaveGame): StationId {
  const station = stationById(save.seed, save.respawn.stationId, save.worldGen) ?? homeStation();
  const id = station.id;
  const storage = (save.stations[id] ??= { resources: emptyCargo(), parts: {} });
  for (const p of save.player.grid.parts) {
    // Guild loan parts go back to the Guild, never into a storage
    if (p.loan) continue;
    const key: PartKey = partKey(p.partId, p.tier, p.variant);
    storage.parts[key] = (storage.parts[key] ?? 0) + 1;
  }
  for (const r of RESOURCE_IDS) storage.resources[r] += save.player.cargo[r];
  // canonical order of the part keys
  storage.parts = Object.fromEntries(ALL_PART_KEYS.filter((k) => storage.parts[k]).map((k) => [k, storage.parts[k]]));

  // the replacement hull is a Guild loan (a broken save must not print a free ship)
  const starter = loanStarterShip();
  const props = computeProperties(starter);
  const pose = dockPose(station, props.boundingRadius);
  save.player = {
    grid: gridToSave(starter),
    hp: [],
    body: { pos: { ...pose.pos }, vel: { ...pose.vel }, angle: pose.angle, angVel: pose.angVel },
    dampers: true,
    fuel: Math.min(save.player.fuel, props.fuelCapacity),
    energy: props.batteryCapacity,
    cargo: emptyCargo(),
    dockedAt: id,
    shield: props.shield.capacity,
    shieldDelay: 0,
    cooldowns: [],
    salvage: save.player.salvage,
    destroyed: false,
    scuttled: false,
    heat: [],
    tractor: null,
    blueprint: gridToSave(starter),
    // the refined ore went to the storage as raw cargo; the bank belonged to the old ship
    refined: {},
    repair: null,
  };
  save.respawn = { stationId: id, grid: gridToSave(starter) };
  if (!save.world.discoveredStations.includes(id)) save.world.discoveredStations = [...save.world.discoveredStations, id].sort();
  // the active chunks load around the new position
  save.world.center = null;
  return id;
}
