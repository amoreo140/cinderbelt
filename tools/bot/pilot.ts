// The balance bot "pilot": plays the real simulation through PlayerCommand only (flight inputs, aim,
// mining, dock key and station actions). The state is only read – never mutated by the bot.
//
// Loop: undock → pick an asteroid (value per time, ring rules, away from pirate spawn areas) → fly
// there (velocity controller + PD heading) → hover and mine (aim at the active vein segment, back
// off the vein to let the lasers cool) → return when the hold is full or fuel runs low → dock →
// sell / refuel / buy the next goal of the econ model's main path → undock.
import { purchaseCost, RECIPES, resourcePrice, RESOURCE_BASE_PRICE, RING_RESOURCE_MULT, SELL_SPREAD } from '../../src/data/economy';
import { parsePartKey, partKey, type PartInventory, type PartKey } from '../../src/data/parts';
import { cargoUsed, RESOURCE_IDS, type Cargo, type ResourceId } from '../../src/data/resources';
import { canTurnIn } from '../../src/sim/career/career';
import { spawnSlots } from '../../src/sim/combat/enemies';
import { REGION_GEN, regionWorld, sectorIdAt, sectorKnowledge, sectorSecurity, surveyPoints, type SurveyPoint } from '../../src/sim/regions';
import { cartography, chartTrade } from '../../src/sim/charts/charts';
import { securityOverrides } from '../../src/sim/pirates/sectors';
import { IDLE_COMMAND, type GameAction, type GameActionInput, type PlayerCommand } from '../../src/sim/commands';
import { currentBoard } from '../../src/sim/contracts/board';
import { type Vec2 } from '../../src/sim/math/vec2';
import { damagedParts } from '../../src/sim/ship/hp';
import { SIM_DT, type SimEvent, type SimState, type Simulation } from '../../src/sim/Simulation';
import { stationStorage } from '../../src/sim/station/storage';
import { towAvailable } from '../../src/sim/station/tow';
import { chunkCoord, type Asteroid } from '../../src/sim/world/generate';
import { CHUNK_SIZE } from '../../src/sim/world/chunks';
import { GRAVEYARD } from '../../src/data/sites';
import { graveyardState } from '../../src/sim/sites/graveyardState';
import { sitesNear } from '../../src/sim/sites/placement';
import type { GraveyardSite } from '../../src/sim/sites/types';
import { SiteVisitor, type SiteHost } from './sites';
import { stationById, type StationDef } from '../../src/sim/world/stations';
import { anomalyPull } from '../../src/sim/discovery/anomalies';
import { chooseAim, clearance, dist, dockNav, freeDirection, newNavMemory, norm, pathClear, shipMass, steer, type NavGoal } from './flight';
import type { BotGoal } from './goals';
import { crippled, goalSatisfied, personaGoals, planFromOps, planGoalOps, restoreOps, stripOps, type DraftPlan } from './shipPlan';
import { archiveNode } from '../../src/data/archive';
import type { EditorOp } from '../../src/sim/shipyard/editor';
import type { ShipGrid } from '../../src/sim/ship/types';

export interface BotOptions {
  /** Seconds spent in the station UI per docking (the bot itself acts instantly). */
  dwellSeconds: number;
  /** Take mining contracts from station boards. */
  contracts: boolean;
  /** Mount the 2 armor plates from the starting storage (the former "First Day" step). */
  firstDay: boolean;
  /**
   * Guild Training (M3.7): 'skip' = a game started with "Skip training" (the starter ship, the
   * default); 'play' = the training played through first (scripted, sim/training/testing.ts), the
   * bot then goes on with the ship the training left.
   */
  training?: 'skip' | 'play';
  /** No progress for this long = stuck (logged with seed + tick). */
  stuckMinutes: number;
  /**
   * Cap of the fuel reserve as a share of the tank (unset = no cap). The saboteur's recovery oracle sets it:
   * a broke player with a tiny tank flies out on half a tank like a human would, instead of waiting for
   * fuel he cannot buy.
   */
  reserveShare?: number;
  /**
   * Who plays (sectors design §6.4): 'standard' avoids pirate spawn areas only; 'cautious' (the
   * "cautious miner") also never flies into a Pirate sector – it mines in Contested and Guarded
   * sectors and inside the Guild Lane corridors. 'explorer' (sectors §6.4 item 6) mines like the
   * standard bot but spends up to `EXPLORER_SHARE` of its flight time charting sectors by their survey
   * points (fly to the point, scanner pulse) – every persona sells its own charts when docked. 'refiner'
   * (M4c) mines like the standard bot but builds the on-board workshop (a refinery + a repair module,
   * `REFINER_WORKSHOP` in shipPlan.ts) in place of the M3 weapons; the runner gives it the Data of the
   * workshop's Archive nodes (an explorer's Data – the miner earns ~6 D/h).
   */
  persona?: 'standard' | 'cautious' | 'explorer' | 'refiner';
  /**
   * M4b world sites (tools/bot/sites.ts): between rocks in ring 2 take a cheap detour to a known derelict
   * without sentries or a graveyard's first wreck analysis (default on; `--sites=0` switches it off).
   */
  sites?: boolean;
}

export const DEFAULT_BOT_OPTIONS: BotOptions = { dwellSeconds: 15, contracts: true, firstDay: true, stuckMinutes: 3 };

export interface BotNote {
  tick: number;
  kind: string;
  detail: string;
}

/** What the pilot reports to the run recorder. */
export class BotLog {
  /** Goal id → tick when the refit was committed (or found already satisfied). */
  readonly goals = new Map<string, number>();
  readonly notes: BotNote[] = [];
  readonly stuck: BotNote[] = [];
  readonly failures: BotNote[] = [];
  readonly counts: Record<string, number> = {};
  /** Ticks with at least one beam on rock / on an active vein segment. */
  miningTicks = 0;
  veinTicks = 0;
  /** Ticks the bot wanted the vein but no vein point was reachable. */
  veinMissTicks = 0;
  /** Fuel burned and ticks spent per pilot mode. */
  readonly fuelByMode: Record<string, number> = {};
  readonly ticksByMode: Record<string, number> = {};
  count(kind: string, n = 1): void {
    this.counts[kind] = (this.counts[kind] ?? 0) + n;
  }
  note(tick: number, kind: string, detail: string, limit = 40): void {
    this.count(kind);
    if (this.notes.filter((n) => n.kind === kind).length < limit) this.notes.push({ tick, kind, detail });
  }
}

type Mode = 'docked' | 'seek' | 'explore' | 'approach' | 'mine' | 'return' | 'flee' | 'survey' | 'site';

type Business = Generator<GameActionInput[], void, SimEvent[]>;

/** Sell price at the home station (ring 1) – what the bot gets for a unit. */
export const homeSellPrice = (r: ResourceId): number => RESOURCE_BASE_PRICE[r] * RING_RESOURCE_MULT[1][r] * SELL_SPREAD;

const P1_LIMIT = 1300;
const P2_MIN = 1250;
const P2_MAX = 2600;
const PIRATE_MARGIN = 320;
/** Length of the straight lane into a hover point. */
const LANE = 18;
/** Share of the flight time the explorer persona spends on survey points (the econ model's P2 explore share). */
const EXPLORER_SHARE = 0.3;
/** A survey pulse is fired this close to the point (the pulse marks points within 150 u). */
const SURVEY_REACH = 140;
/** A graveyard with a pirate party is avoided within its field radius plus the sleepers' wake range + margin. */
const GRAVEYARD_DANGER = GRAVEYARD.radius + GRAVEYARD.wakeRange + 20;
/** A scanner pulse in ring 2 at most this often (ticks). */
const PULSE_EVERY = 120 * 60;

export class Pilot {
  /** Any mode but 'docked' at start, so the first docked tick opens the station routine. */
  mode: Mode = 'return';
  goalIndex = 0;
  /** The persona's goals (the econ model's main path, the refiner's workshop in place of the weapons). */
  readonly goals: readonly BotGoal[];
  lastProgressTick = 0;
  private reqId = 0;
  private script: Business | null = null;
  private lastEvents: SimEvent[] = [];
  private target: { id: string; dir: Vec2; since: number } | null = null;
  private waypoint: Vec2 | null = null;
  private exploreCount = 0;
  private blacklist = new Map<string, number>();
  private danger: { pos: Vec2; radius: number; until: number }[] = [];
  private tiSpot: Vec2 | null = null;
  private heatMode: 'vein' | 'cool' = 'vein';
  private yieldMark = { cargo: 0, tick: 0 };
  private navMark = { target: { x: NaN, y: NaN }, best: Infinity };
  private dockPressTick = -999;
  private stuckLevel = 0;
  private pirateCache = new Map<string, Vec2[]>();
  /** Chunk → in a Pirate sector (cautious persona; a destroyed fortress is not expected in the bot's runs). */
  private sectorCache = new Map<string, boolean>();
  private lastCargo = 0;
  private lastCredits = 0;
  ring2 = false;
  /** Last design committed in a shipyard – parts lost in flight are restored to it. */
  private design: ShipGrid | null = null;
  /** Set when the run cannot continue (soft-lock); the runner stops. */
  aborted: string | null = null;
  private soldThisDock = false;
  /** Explorer: the survey point flown to, when it was picked, and the scan key held (tap = 2 ticks). */
  private survey: { point: SurveyPoint; since: number; hold: number; tries: number } | null = null;
  private surveyTicks = 0;
  private flightTicks = 0;
  private surveySkip = new Map<string, number>();
  private tows: number[] = [];
  private flees: number[] = [];
  private safeUntil = 0;
  /** M4b: opportunistic site visits (tools/bot/sites.ts) and the pilot as their host. */
  private readonly visitor = new SiteVisitor();
  private readonly host: SiteHost;
  private berthLeaveTick = -999;
  private lastPulse = -PULSE_EVERY;
  private pulseHold = 0;
  /** Chunk → graveyards whose field (plus the sleepers' wake range) reaches into the chunk. */
  private graveyardCache = new Map<string, GraveyardSite[]>();

  constructor(
    private readonly sim: Simulation,
    private readonly opts: BotOptions,
    readonly log: BotLog,
  ) {
    this.lastCredits = sim.state.credits;
    this.design = cloneGrid(sim.state.player.grid);
    this.goals = personaGoals(opts.persona);
    const pilot = this;
    this.host = {
      get state() {
        return pilot.state;
      },
      log,
      fly: (nav, ignoreId) => this.fly(nav, ignoreId),
      navProgress: (target) => this.navProgress(target),
      unsafe: (p, ignoreSite) => this.unsafe(p, ignoreSite),
      send: (actions) => this.send(actions),
    };
  }

  private get state(): SimState {
    return this.sim.state;
  }

  private progress(): void {
    this.lastProgressTick = this.state.tick;
    this.stuckLevel = 0;
  }

  // ---------------------------------------------------------------- commands

  command(): PlayerCommand {
    const state = this.state;
    const player = state.player;
    this.trackProgress();
    if (player.destroyed) return IDLE_COMMAND;
    if (player.dock.mode === 'docking') return IDLE_COMMAND;
    if (player.dock.mode === 'docked') return this.dockedCommand();
    if (this.mode === 'docked') {
      this.mode = 'seek';
      this.target = null;
    }
    this.flightTicks++;
    if (this.mode === 'survey') this.surveyTicks++;
    this.checkStuck();
    // out of fuel → tow (H)
    if (towAvailable(player)) {
      this.log.note(state.tick, 'outOfFuel', `pos ${fmt(player.body.pos)} cargo ${cargoUsed(player.cargo).toFixed(0)}`);
      return { ...IDLE_COMMAND, emergency: true };
    }
    if (state.tick % 15 === 0) this.checkThreats();
    // a visit was interrupted (a flight, a return): drop it, and never stay berthed at a derelict
    if (this.mode !== 'site' && this.visitor.visit) this.visitor.end(this.host, `interrupted (${this.mode})`);
    if (this.mode !== 'site' && state.sites.berth !== null && state.tick - this.berthLeaveTick > 30) {
      this.berthLeaveTick = state.tick;
      return this.send([{ type: 'berthLeave' }]);
    }
    return this.withPulse(this.modeCommand());
  }

  private modeCommand(): PlayerCommand {
    switch (this.mode) {
      case 'site':
        return this.siteCommand();
      case 'seek':
        return this.seek();
      case 'explore':
        return this.explore();
      case 'approach':
      case 'mine':
        return this.mineCommand();
      case 'return':
      case 'flee':
        return this.returnCommand();
      case 'survey':
        return this.surveyCommand();
      default:
        return IDLE_COMMAND;
    }
  }

  /**
   * M4b: in ring 2 the bot taps a scanner pulse every `PULSE_EVERY` while travelling (not mining, not on a
   * survey point), like a player looking for signals – the sites it may visit (tools/bot/sites.ts) come from
   * these signals and the radar.
   */
  private withPulse(cmd: PlayerCommand): PlayerCommand {
    const s = this.state;
    if (this.pulseHold > 0) {
      this.pulseHold--;
      return { ...cmd, scan: true };
    }
    if (this.opts.sites === false || !this.inRing2() || cmd.scan || cmd.mining) return cmd;
    if (this.mode !== 'seek' && this.mode !== 'explore' && this.mode !== 'approach') return cmd;
    if (s.tick - this.lastPulse < PULSE_EVERY || s.discovery.scanner.cooldown > 0 || s.player.energy < 60) return cmd;
    this.lastPulse = s.tick;
    this.pulseHold = 1;
    this.log.count('pulses');
    return { ...cmd, scan: true };
  }

  onEvents(events: SimEvent[]): void {
    this.lastEvents = events;
    const tick = this.state.tick;
    for (const e of events) {
      switch (e.type) {
        case 'actionResult':
          if (!e.ok) this.log.failures.push({ tick, kind: e.reason, detail: `req ${e.reqId}${e.detail ? ` ${e.detail}` : ''}` });
          break;
        case 'cargoFull':
          if (this.mode === 'mine' || this.mode === 'approach') this.mode = 'return';
          break;
        case 'dockRejected':
          this.log.count(`dockRejected:${e.reason}`);
          break;
        case 'docked':
          this.progress();
          break;
        case 'undocked':
          this.progress();
          break;
        case 'towed':
          this.log.note(tick, 'towed', `to ${e.stationId} cost ${e.cost} cargoLost ${e.cargoLost}`);
          this.tows = [...this.tows.filter((t) => tick - t < 10 * 3600), tick];
          if (this.tows.length >= 5 && !this.aborted) this.abort(`tow loop: 5 tows within 10 min (last to ${e.stationId}), fuel ${this.state.player.fuel.toFixed(0)}, credits ${this.state.credits}`);
          break;
        case 'collision':
          if (e.damage) {
            this.log.count('ramDamage', e.damage);
            this.log.count(`ramDamage:${this.mode}`, e.damage);
            this.log.note(tick, 'ram', `${this.mode} impact ${e.speed.toFixed(1)} u/s damage ${e.damage.toFixed(1)} at ${fmt(this.state.player.body.pos)}`, 25);
          }
          break;
        case 'projectileHit':
          if (e.ref === 'player' && this.mode !== 'flee' && this.mode !== 'docked') this.startFlee('hit by a projectile');
          break;
        default:
          break;
      }
    }
  }

  private send(actions: GameActionInput[]): PlayerCommand {
    const list = actions.map((a) => ({ ...a, reqId: ++this.reqId }) as GameAction);
    return { ...IDLE_COMMAND, actions: list };
  }

  private lastFuel = -1;
  private lastMode = '';

  private trackProgress(): void {
    const s = this.state;
    const p = s.player;
    const modeKey = p.dock.mode === 'flying' ? this.mode : p.dock.mode;
    if (this.lastMode) {
      this.log.ticksByMode[this.lastMode] = (this.log.ticksByMode[this.lastMode] ?? 0) + 1;
      if (this.lastFuel > p.fuel) this.log.fuelByMode[this.lastMode] = (this.log.fuelByMode[this.lastMode] ?? 0) + this.lastFuel - p.fuel;
    }
    this.lastFuel = p.fuel;
    this.lastMode = modeKey;
    const cargo = cargoUsed(s.player.cargo);
    if (cargo > this.lastCargo + 1e-6 || s.credits !== this.lastCredits) this.progress();
    this.lastCargo = cargo;
    this.lastCredits = s.credits;
  }

  private navProgress(target: Vec2): void {
    const pos = this.state.player.body.pos;
    if (!(dist(target, this.navMark.target) <= 5)) this.navMark = { target: { ...target }, best: dist(pos, target) };
    const d = dist(pos, target);
    if (d < this.navMark.best - 2) {
      this.navMark.best = d;
      this.progress();
    }
  }

  private checkStuck(): void {
    const s = this.state;
    const limit = this.opts.stuckMinutes * 60 * 60;
    if (s.tick - this.lastProgressTick < limit) return;
    this.stuckLevel++;
    const p = s.player;
    this.log.stuck.push({
      tick: s.tick,
      kind: `stuck:${this.mode}`,
      detail: `pos ${fmt(p.body.pos)} vel ${fmt(p.body.vel)} fuel ${p.fuel.toFixed(1)} cargo ${cargoUsed(p.cargo).toFixed(1)}/${p.props.cargoCapacity} target ${this.target?.id ?? '-'} waypoint ${this.waypoint ? fmt(this.waypoint) : '-'} level ${this.stuckLevel}`,
    });
    if (this.target) this.blacklist.set(this.target.id, s.tick + 20 * 3600);
    this.target = null;
    this.waypoint = null;
    this.mode = 'return';
    this.lastProgressTick = s.tick;
  }

  // ---------------------------------------------------------------- threats

  private checkThreats(): void {
    if (this.mode === 'flee') return;
    const pos = this.state.player.body.pos;
    for (const e of this.state.combat.enemies) {
      if (e.ai.mode === 'attack' && dist(e.body.pos, pos) < 450) {
        this.startFlee(`${e.kind} ${e.id} attacking at ${dist(e.body.pos, pos).toFixed(0)} u`);
        this.danger.push({ pos: { ...e.home }, radius: 450, until: this.state.tick + 30 * 3600 });
        return;
      }
    }
  }

  /** Titanium trips to ring 2 – unless the bot was chased away twice recently (then ring 1 for a while). */
  private inRing2(): boolean {
    return this.ring2 && this.state.tick >= this.safeUntil;
  }

  /** Does the straight flight a→b pass a pirate spawn area or a place where the bot was attacked? */
  private pathUnsafe(a: Vec2, b: Vec2): boolean {
    const L = dist(a, b);
    const n = Math.ceil(L / 80);
    for (let i = 1; i < n; i++) if (this.unsafe({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n })) return true;
    return false;
  }

  private startFlee(why: string): void {
    const now = this.state.tick;
    this.flees = [...this.flees.filter((t) => now - t < 15 * 3600), now];
    if (this.flees.length >= 2) {
      this.safeUntil = now + 20 * 3600;
      this.log.count('retreatToRing1');
    }
    this.log.note(this.state.tick, 'flee', `${why} at ${fmt(this.state.player.body.pos)}`);
    if (this.target) this.blacklist.set(this.target.id, this.state.tick + 30 * 3600);
    this.target = null;
    this.mode = 'flee';
  }

  private pirateHomes(cx: number, cy: number): Vec2[] {
    const key = `${cx},${cy}`;
    let homes = this.pirateCache.get(key);
    if (!homes) {
      homes = spawnSlots(this.state.seed, cx, cy, this.state.settings.enemyDensity, 1.5).map((s) => s.home);
      this.pirateCache.set(key, homes);
    }
    return homes;
  }

  /** The point lies in a Pirate sector right now (the cautious miner never goes there). */
  private pirateSector(p: Vec2): boolean {
    const s = this.state;
    const key = `${chunkCoord(p.x)},${chunkCoord(p.y)}`;
    let hit = this.sectorCache.get(key);
    if (hit === undefined) {
      hit = sectorSecurity(s.seed, sectorIdAt(s.seed, p.x, p.y), securityOverrides(s)) === 'pirate';
      if (this.sectorCache.size > 4096) this.sectorCache.clear();
      this.sectorCache.set(key, hit);
    }
    return hit;
  }

  /** Close to a pirate spawn area, a graveyard with a pirate party (or a place where the bot was attacked)? */
  unsafe(p: Vec2, ignoreSite?: string): boolean {
    const now = this.state.tick;
    if (this.danger.some((d) => d.until > now && dist(d.pos, p) < d.radius)) return true;
    // M4b: a graveyard whose pirate party is not cleared yet (its sleepers wake within 60 u)
    for (const g of this.graveyardsAround(p)) {
      if (g.id === ignoreSite || dist(g.pos, p) > GRAVEYARD_DANGER) continue;
      if (graveyardState(this.state, g.id).party !== 'cleared') return true;
    }
    // no pirates ever spawn this close to home (the depth-1 pirate corner starts beyond it)
    if (Math.hypot(p.x, p.y) < REGION_GEN.corner.pirateFreeRadius) return false;
    if (this.opts.persona === 'cautious' && this.pirateSector(p)) return true;
    const cx = chunkCoord(p.x);
    const cy = chunkCoord(p.y);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (const h of this.pirateHomes(cx + dx, cy + dy)) if (dist(h, p) < PIRATE_MARGIN) return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- target selection

  private miningRate(): number {
    return this.state.player.props.lasers.reduce((s, l) => s + l.rate, 0) * 1.15;
  }

  private freeCargo(): number {
    const p = this.state.player;
    return p.props.cargoCapacity - cargoUsed(p.cargo);
  }

  private fuelReserve(): number {
    const st = this.homeLike();
    const d = st ? dist(st.pos, this.state.player.body.pos) : 0;
    const reserve = 0.003 * shipMass(this.state) * 260 + 6 + d * 0.004;
    const share = this.opts.reserveShare;
    return share === undefined ? reserve : Math.min(reserve, share * this.state.player.props.fuelCapacity);
  }

  private pickAsteroid(): Asteroid | null {
    const s = this.state;
    const pos = s.player.body.pos;
    const free = this.freeCargo();
    const rate = this.miningRate();
    const now = s.tick;
    let best: Asteroid | null = null;
    let bestScore = 0;
    let titaniumSeen = false;
    for (const a of s.world.asteroids()) {
      const until = this.blacklist.get(a.id);
      if (until !== undefined && until > now) continue;
      const r0 = Math.hypot(a.pos.x, a.pos.y);
      if (this.inRing2() ? r0 < P2_MIN || r0 > P2_MAX : r0 > P1_LIMIT) continue;
      const left = s.world.remaining(a);
      if (left < 1) continue;
      if (this.unsafe(a.pos) || this.pathUnsafe(pos, a.pos)) continue;
      const units = Math.min(left, free);
      const d = dist(a.pos, pos);
      const t = d / 25 + units / rate + 4;
      const score = (units * homeSellPrice(a.resource)) / t;
      if (a.resource === 'titanium') titaniumSeen = true;
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    if (this.inRing2() && !titaniumSeen && cargoUsed(s.player.cargo) < 0.5 * s.player.props.cargoCapacity) return null;
    return best;
  }

  private seek(): PlayerCommand {
    const s = this.state;
    if (s.player.fuel < this.fuelReserve() || s.player.props.lasers.length === 0) {
      this.mode = 'return';
      return this.returnCommand();
    }
    if (this.freeCargo() < 0.5) {
      this.mode = 'return';
      return this.returnCommand();
    }
    if (this.opts.persona === 'explorer' && this.surveyTicks < EXPLORER_SHARE * this.flightTicks && s.player.fuel > 1.5 * this.fuelReserve()) {
      const point = this.pickSurveyPoint();
      if (point) {
        this.survey = { point, since: s.tick, hold: 0, tries: 0 };
        this.mode = 'survey';
        return this.surveyCommand();
      }
    }
    // M4b: a cheap detour to a known site between two rocks in ring 2
    if (this.opts.sites !== false && this.inRing2() && s.player.fuel > 1.6 * this.fuelReserve() && this.visitor.pick(this.host)) {
      this.mode = 'site';
      this.target = null;
      return this.siteCommand();
    }
    const a = this.pickAsteroid();
    if (!a) {
      this.waypoint = this.nextWaypoint();
      this.mode = 'explore';
      return this.explore();
    }
    const dir = this.standoffDir(a);
    if (!dir) {
      this.blacklist.set(a.id, s.tick + 10 * 3600);
      this.log.count('noStandoff');
      return IDLE_COMMAND;
    }
    this.target = { id: a.id, dir, since: s.tick };
    if (a.resource === 'titanium') this.tiSpot = { ...a.pos };
    this.heatMode = 'vein';
    this.yieldMark = { cargo: cargoUsed(s.player.cargo), tick: s.tick };
    this.mode = 'approach';
    return this.mineCommand();
  }

  /** A site visit (tools/bot/sites.ts); back to mining when it ends or fuel runs low. */
  private siteCommand(): PlayerCommand {
    const s = this.state;
    if (s.player.fuel < this.fuelReserve() && s.sites.berth === null) {
      this.visitor.end(this.host, 'fuel');
      this.mode = 'return';
      return this.returnCommand();
    }
    const cmd = this.visitor.command(this.host);
    if (cmd) return cmd;
    this.mode = 'seek';
    return IDLE_COMMAND;
  }

  /** Graveyards whose field (plus the wake range of their sleepers) reaches into the point's chunk. */
  private graveyardsAround(p: Vec2): GraveyardSite[] {
    const cx = chunkCoord(p.x);
    const cy = chunkCoord(p.y);
    const key = `${cx},${cy}`;
    let list = this.graveyardCache.get(key);
    if (!list) {
      const centre = { x: (cx + 0.5) * CHUNK_SIZE, y: (cy + 0.5) * CHUNK_SIZE };
      list = sitesNear(this.state.seed, centre, CHUNK_SIZE * 0.75 + GRAVEYARD_DANGER).filter((x): x is GraveyardSite => x.kind === 'graveyard' && x.sleepers.length > 0);
      if (this.graveyardCache.size > 4096) this.graveyardCache.clear();
      this.graveyardCache.set(key, list);
    }
    return list;
  }

  private nextWaypoint(): Vec2 {
    const pos = this.state.player.body.pos;
    if (this.inRing2()) {
      if (this.tiSpot && dist(this.tiSpot, pos) > 150 && !this.unsafe(this.tiSpot) && !this.pathUnsafe(pos, this.tiSpot)) return this.tiSpot;
      this.tiSpot = null;
      const base = Math.atan2(pos.y, pos.x);
      for (let i = 0; i < 24; i++) {
        this.exploreCount++;
        const ang = base + ((this.exploreCount % 2 ? 1 : -1) * Math.ceil(this.exploreCount / 2) * 0.25);
        const r = 1650 + (this.exploreCount % 3) * 150;
        const p = { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
        if (!this.unsafe(p) && !this.pathUnsafe(pos, p)) return p;
      }
      // every titanium direction passes pirates → mine ring 1 for a while
      this.safeUntil = this.state.tick + 10 * 3600;
      this.log.count('noSafeRing2Route');
    }
    this.exploreCount++;
    const ang = this.exploreCount * 2.4;
    const r = 250 + (this.exploreCount % 4) * 250;
    return { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
  }

  private explore(): PlayerCommand {
    const s = this.state;
    if (s.player.fuel < this.fuelReserve()) {
      this.mode = 'return';
      return this.returnCommand();
    }
    if (s.tick % 30 === 0) {
      const a = this.pickAsteroid();
      if (a) {
        this.mode = 'seek';
        return this.seek();
      }
    }
    const wp = this.waypoint ?? (this.waypoint = this.nextWaypoint());
    if (dist(wp, s.player.body.pos) < 40) {
      this.log.count('exploreArrived');
      this.waypoint = this.nextWaypoint();
    }
    this.navProgress(this.waypoint!);
    return this.fly({ target: this.waypoint!, arriveSpeed: 20, maxSpeed: 60, precise: false });
  }

  // ---------------------------------------------------------------- survey points (explorer)

  /**
   * Nearest safe, unmarked survey point of a sector the Guild buys charts of and the bot has not charted
   * (never in a Pirate sector; beyond ring 1 only once the bot is armed).
   */
  private pickSurveyPoint(): SurveyPoint | null {
    const s = this.state;
    const pos = s.player.body.pos;
    const maxR = this.inRing2() ? P2_MAX : P1_LIMIT + 200;
    let best: SurveyPoint | null = null;
    let bestD = Infinity;
    for (const r of regionWorld(s.seed).regions) {
      const id = r.seed.id;
      if (Math.hypot(r.seed.x, r.seed.y) > maxR + 600 || chartTrade(s.seed, id) !== 'player' || s.regions.sold.has(id)) continue;
      if (sectorKnowledge(s, id) === 'charted') continue;
      const mask = s.regions.points.get(id) ?? 0;
      for (const p of surveyPoints(s.seed, id)) {
        if (mask & (1 << p.index)) continue;
        const key = `${id}#${p.index}`;
        if ((this.surveySkip.get(key) ?? -1) > s.tick) continue;
        const r = Math.hypot(p.pos.x, p.pos.y);
        if (r > maxR || this.unsafe(p.pos) || this.pathUnsafe(pos, p.pos) || this.pirateSector(p.pos)) continue;
        // beyond ring 1 only with the cannons and the shield (an explorer is not a target)
        if (r > P1_LIMIT && !this.log.goals.has('weapons')) continue;
        const d = dist(pos, p.pos);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
    }
    return best;
  }

  private surveyCommand(): PlayerCommand {
    const s = this.state;
    const sv = this.survey;
    const done = (skip: boolean): PlayerCommand => {
      if (skip && sv) this.surveySkip.set(`${sv.point.sector}#${sv.point.index}`, s.tick + 30 * 3600);
      this.survey = null;
      this.mode = 'seek';
      return this.seek();
    };
    if (!sv) return done(false);
    if (s.player.fuel < this.fuelReserve()) {
      this.survey = null;
      this.mode = 'return';
      return this.returnCommand();
    }
    const marked = ((s.regions.points.get(sv.point.sector) ?? 0) & (1 << sv.point.index)) !== 0;
    if (marked || sectorKnowledge(s, sv.point.sector) === 'charted') {
      this.log.count('surveyPoints');
      this.progress();
      return done(false);
    }
    // a point the bot cannot reach in 2 min (rocks, a pull) is left for later
    if (s.tick - sv.since > 120 * 60 || sv.tries > 4) {
      this.log.count('surveySkipped');
      return done(true);
    }
    const pos = s.player.body.pos;
    const d = dist(pos, sv.point.pos);
    this.navProgress(sv.point.pos);
    const cmd = this.fly({ target: sv.point.pos, arriveSpeed: 4, maxSpeed: 60, precise: false });
    if (d > SURVEY_REACH) return cmd;
    // in reach: tap Tab (held 2 ticks, released) once the pulse is charged
    if (sv.hold === 0 && (s.discovery.scanner.cooldown > 0 || s.player.energy < 40)) return cmd;
    sv.hold++;
    if (sv.hold <= 2) return { ...cmd, scan: true };
    sv.hold = 0;
    sv.tries++;
    return cmd;
  }

  /** Front of the lasers relative to the centre of mass (local +x). */
  private laserReachFront(): number {
    const lasers = this.state.player.props.lasers;
    return lasers.length ? Math.max(...lasers.map((l) => l.offset.x)) : 1;
  }

  private standoffPoint(a: Asteroid, dir: Vec2): Vec2 {
    const r = this.state.world.radiusOf(a);
    const d = r + Math.max(1, this.laserReachFront()) + 2.2;
    return { x: a.pos.x + dir.x * d, y: a.pos.y + dir.y * d };
  }

  /** Free side of the rock to hover at (towards the ship first). */
  private standoffDir(a: Asteroid): Vec2 | null {
    const s = this.state;
    const base = norm({ x: s.player.body.pos.x - a.pos.x, y: s.player.body.pos.y - a.pos.y });
    const br = s.player.props.boundingRadius;
    for (let k = 0; k < 15; k++) {
      const ang = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.42;
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      const dir = { x: base.x * c - base.y * sn, y: base.x * sn + base.y * c };
      const p = this.standoffPoint(a, dir);
      let ok = true;
      for (const o of s.world.circlesNear(p, br + 8)) {
        if (o.asteroid.id === a.id) continue;
        if (dist(p, o.circle.pos) - o.circle.radius - br < 0.8) {
          ok = false;
          break;
        }
      }
      if (ok) for (const st of s.world.stationCirclesNear(p, br + 8)) if (dist(p, st.pos) - st.radius - br < 1) ok = false;
      // a clear lane into the hover point from outside (the last metres are flown straight)
      if (ok && !pathClear(s, { x: p.x + dir.x * LANE, y: p.y + dir.y * LANE }, p, a.id, 0.3)) ok = false;
      if (ok) return dir;
    }
    return null;
  }

  private mineCommand(): PlayerCommand {
    const s = this.state;
    const p = s.player;
    const t = this.target;
    const a = t ? s.world.findAsteroid(t.id) : null;
    if (!t || !a || s.world.remaining(a) <= 0 || s.world.radiusOf(a) <= 0) {
      this.target = null;
      this.mode = 'seek';
      return this.seek();
    }
    if (p.fuel < this.fuelReserve() * 0.8 || this.freeCargo() < 0.5) {
      this.mode = 'return';
      return this.returnCommand();
    }
    const stand = this.standoffPoint(a, t.dir);
    const dStand = dist(p.body.pos, stand);
    const face = Math.atan2(a.pos.y - p.body.pos.y, a.pos.x - p.body.pos.x);
    if (this.mode === 'approach') {
      this.navProgress(stand);
      if (dStand < 3 && Math.hypot(p.body.vel.x, p.body.vel.y) < 3) {
        this.mode = 'mine';
        // the lane in is the way out (it was clear when the rock was chosen)
        this.exit = { to: { x: stand.x + t.dir.x * LANE, y: stand.y + t.dir.y * LANE }, start: -1 };
        this.yieldMark = { cargo: cargoUsed(p.cargo), tick: s.tick };
      } else if (s.tick - t.since > 90 * 60) {
        this.log.note(s.tick, 'approachTimeout', `${a.id} ${a.resource} at ${fmt(a.pos)} from ${fmt(p.body.pos)} d ${dStand.toFixed(1)}`);
        this.blacklist.set(a.id, s.tick + 60 * 3600);
        this.target = null;
        this.mode = 'seek';
        return IDLE_COMMAND;
      }
    }
    const near = dStand < 6;
    // two stages: route to the lane entry outside the cluster, then straight in along the lane
    const entry = { x: stand.x + t.dir.x * LANE, y: stand.y + t.dir.y * LANE };
    const inLane = dist(p.body.pos, entry) < 5 || dStand < LANE - 2;
    const nav: NavGoal = near
      ? { target: stand, arriveSpeed: 0, maxSpeed: 6, face, precise: true, noAvoid: true }
      : inLane
        ? { target: stand, arriveSpeed: 0, maxSpeed: 7, face, precise: true, noAvoid: true }
        : { target: entry, arriveSpeed: 4, maxSpeed: 60, face: dStand < 40 ? face : undefined, precise: false };
    const cmd = this.fly(nav, a.id);
    if (!near) return cmd;

    // heat: on the vein until the hottest laser is near overheating, then off the vein until it cools
    let hot = 0;
    let cooling = false;
    for (const l of p.props.lasers) {
      const h = p.heat.get(l.partId);
      if (h) {
        hot = Math.max(hot, h.heat);
        if (h.cooling > 0) cooling = true;
      }
    }
    if (this.heatMode === 'vein' && (hot >= 3.3 || cooling)) this.heatMode = 'cool';
    else if (this.heatMode === 'cool' && hot <= 0.8 && !cooling) this.heatMode = 'vein';
    const aim = chooseAim(s, a, this.heatMode === 'vein');
    if (this.heatMode === 'vein' && !aim.vein && aimHasVeins(a)) this.log.veinMissTicks++;

    // no yield for a while → give up on this rock
    const cargo = cargoUsed(p.cargo);
    if (cargo > this.yieldMark.cargo + 1e-6) this.yieldMark = { cargo, tick: s.tick };
    else if (this.mode === 'mine' && s.tick - this.yieldMark.tick > 8 * 60) {
      const beams = p.beams.map((b) => `${b.asteroidId ?? 'none'}${b.vein ? '/vein' : ''}`).join(',');
      this.log.note(s.tick, 'noYield', `${a.id} ${a.resource} left ${s.world.remaining(a).toFixed(1)} r ${s.world.radiusOf(a).toFixed(2)} reach ${aim.reach} energy ${p.energy.toFixed(1)} beams [${beams}] d ${dStand.toFixed(2)}`);
      this.blacklist.set(a.id, s.tick + 10 * 3600);
      this.target = null;
      this.mode = 'seek';
      return IDLE_COMMAND;
    }
    return { ...cmd, mining: aim.reach > 0, aim: aim.aim };
  }

  // ---------------------------------------------------------------- return and dock

  private discoveredStations(): StationDef[] {
    const s = this.state;
    const out: StationDef[] = [];
    for (const id of s.world.discovered) {
      const st = s.world.stations().find((x) => x.id === id) ?? stationById(s.seed, id);
      if (st) out.push(st);
    }
    return out;
  }

  /** Nearest discovered station with a shipyard and a market (home is always known). */
  private homeLike(): StationDef | null {
    const pos = this.state.player.body.pos;
    let best: StationDef | null = null;
    for (const st of this.discoveredStations()) {
      if (!st.services.shipyard || !st.services.market) continue;
      if (!best || dist(st.pos, pos) < dist(best.pos, pos)) best = st;
    }
    return best;
  }

  private nearestAny(): StationDef | null {
    const pos = this.state.player.body.pos;
    let best: StationDef | null = null;
    for (const st of this.discoveredStations()) if (!best || dist(st.pos, pos) < dist(best.pos, pos)) best = st;
    return best;
  }

  private returnCommand(): PlayerCommand {
    const s = this.state;
    const p = s.player;
    const st = (this.mode === 'flee' ? this.nearestAny() : this.homeLike()) ?? this.nearestAny();
    if (!st) return IDLE_COMMAND;
    // the docking manoeuvre: out on the dock axis, then slowly in to the clamp with the bow at the station
    const dock = dockNav(s, st, 60);
    this.navProgress(dock.nav.target);
    const cmd = this.fly({ ...dock.nav, ...(this.stuckLevel >= 2 && !dock.final ? { noAvoid: true } : {}) });
    if (dock.ready && s.tick - this.dockPressTick > 20) {
      this.dockPressTick = s.tick;
      return { ...cmd, dock: true };
    }
    return cmd;
  }

  private navMem = newNavMemory();
  private stall = { tick: 0, best: Infinity, target: { x: NaN, y: NaN } };
  private escape: { until: number; dir: Vec2; pump: boolean } | null = null;
  private exit: { to: Vec2; start: number } | null = null;

  /** Recent positions (newest last) – breadcrumbs for backing out of dead ends. */
  private crumbs: Vec2[] = [];

  private fly(nav: NavGoal, ignoreId?: string): PlayerCommand {
    const s = this.state;
    const pos = s.player.body.pos;
    // leaving a mined rock: first back out along its lane
    if (this.exit && this.mode !== 'mine') {
      if (this.exit.start < 0) this.exit.start = s.tick;
      const de = dist(pos, this.exit.to);
      if (de < 3 || de > 30 || s.tick - this.exit.start > 8 * 60) this.exit = null;
      else nav = { target: this.exit.to, arriveSpeed: 3, maxSpeed: 7, precise: false, noAvoid: true };
    }
    if (s.tick % 30 === 0) {
      const last = this.crumbs[this.crumbs.length - 1];
      if (!last || dist(last, pos) > 3) this.crumbs.push({ ...pos });
      if (this.crumbs.length > 30) this.crumbs.shift();
    }
    // stalled far from the target (pocket of rocks, oscillation) → back out along the freest direction
    const d = dist(pos, nav.target);
    if (!(dist(nav.target, this.stall.target) <= 5)) this.stall = { tick: s.tick, best: d, target: { ...nav.target } };
    if (d < this.stall.best - 1.5 || d < 6) this.stall = { ...this.stall, tick: s.tick, best: Math.min(d, this.stall.best) };
    else if (!this.escape && s.tick - this.stall.tick > 240 && (Math.hypot(s.player.body.vel.x, s.player.body.vel.y) < 2 || s.tick - this.stall.tick > 1200)) {
      const open = !(clearance(s, pos, 15) < 6);
      const pull = anomalyPull(s, pos);
      if (open && Math.hypot(pull.x, pull.y) < 1e-6) {
        // open space and nothing pulls: the ship is only slow (a laden hull reversing its drift by the side
        // thrusters next to a dock) – a new baseline, no escape. Pumping here used to fling a laden ship past
        // the staging point again and again until the tank ran dry (seed 3: two tows in the first hour).
        this.stall = { tick: s.tick, best: d, target: { ...nav.target } };
        this.log.count('slowStall');
      } else {
        // retrace the own path (the way in is a way out), else the freest direction
        let back: Vec2 | null = null;
        for (let i = this.crumbs.length - 1; i >= 0 && !back; i--) if (dist(this.crumbs[i]!, pos) > 12) back = this.crumbs[i]!;
        const dir = back ? norm({ x: back.x - pos.x, y: back.y - pos.y }) : freeDirection(s, nav.target);
        // no rock around: a gravity anomaly holds the ship – pump energy by burning along the current
        // velocity for a few seconds (repeated stalls swing it out)
        this.escape = { until: s.tick + (open ? 300 : 150), dir, pump: open };
        if (open) this.log.count('pumpEscape');
        this.stall.tick = s.tick;
        this.log.count('escape');
        this.log.count(`escape:${this.mode}`);
      }
    }
    if (this.escape && s.tick < this.escape.until) {
      const v = s.player.body.vel;
      const e = this.escape.pump && Math.hypot(v.x, v.y) > 1 ? norm(v) : this.escape.dir;
      nav = this.escape.pump
        ? { target: { x: pos.x + e.x * 80, y: pos.y + e.y * 80 }, arriveSpeed: 30, maxSpeed: 30, precise: false }
        : { target: { x: pos.x + e.x * 20, y: pos.y + e.y * 20 }, arriveSpeed: 4, maxSpeed: 7, precise: false, noAvoid: true };
    } else this.escape = null;
    const out = steer(s, nav, ignoreId, this.navMem);
    const toggle = out.dampers !== this.state.player.dampers;
    return { ...IDLE_COMMAND, flight: out.flight, toggleDampers: toggle, aim: { ...this.state.player.body.pos } };
  }

  // ---------------------------------------------------------------- docked business

  private dockedCommand(): PlayerCommand {
    const s = this.state;
    if (s.player.dock.mode !== 'docked') return IDLE_COMMAND;
    if (this.mode !== 'docked') {
      this.mode = 'docked';
      this.target = null;
      this.waypoint = null;
      this.script = this.business(s.player.dock.stationId);
      this.exit = null;
      this.soldThisDock = false;
      this.crumbs = [];
      this.lastEvents = [];
    }
    if (!this.script) return IDLE_COMMAND;
    const r = this.script.next(this.lastEvents);
    if (r.done) {
      this.script = null;
      return IDLE_COMMAND;
    }
    return r.value.length ? this.send(r.value) : IDLE_COMMAND;
  }

  /** Result of the last action batch (the reqIds are consecutive). */
  private lastOk(events: readonly SimEvent[]): boolean {
    return events.some((e) => e.type === 'actionResult' && e.ok && e.reqId === this.reqId);
  }

  private completeGoal(goal: BotGoal): void {
    if (!this.log.goals.has(goal.id)) this.log.goals.set(goal.id, this.state.tick);
    if (goal.unlocksRing2) this.ring2 = true;
    this.goalIndex++;
  }

  /** Resources to craft every part of the plan that is not in storage. */
  private recipeNeeds(missing: PartInventory): Partial<Cargo> {
    const need: Partial<Cargo> = {};
    for (const [key, n] of Object.entries(missing) as [PartKey, number][]) {
      for (const r of RESOURCE_IDS) {
        const q = (RECIPES[key].resources[r] ?? 0) * n;
        if (q > 0) need[r] = (need[r] ?? 0) + q;
      }
    }
    return need;
  }

  /** Sell cargo and storage beyond `keep`; the kept part of the cargo goes to storage. */
  private *sellSurplus(st: StationDef, keep: Partial<Cargo>): Business {
    const s = this.state;
    this.soldThisDock = true;
    const actions: GameActionInput[] = [];
    const storage = stationStorage(s, st.id).resources;
    for (const r of RESOURCE_IDS) {
      const want = keep[r] ?? 0;
      const fromStorage = Math.min(storage[r], want);
      const keepCargo = Math.min(s.player.cargo[r], Math.max(0, want - fromStorage));
      const sellCargo = s.player.cargo[r] - keepCargo;
      if (keepCargo > 1e-6) actions.push({ type: 'transfer', resource: r, qty: keepCargo, to: 'storage' });
      if (sellCargo > 1e-6 && st.services.market) actions.push({ type: 'sellResource', resource: r, qty: sellCargo, from: 'ship' });
      const sellStorage = storage[r] - fromStorage;
      if (sellStorage > 1e-6 && st.services.market) actions.push({ type: 'sellResource', resource: r, qty: sellStorage, from: 'storage' });
    }
    if (actions.length) yield actions;
  }

  /** Credits kept back for fuel and a tow. */
  private reserve(): number {
    return 150 + this.state.player.props.fuelCapacity;
  }

  /** Parts the shipyard has to craft or buy for a draft. */
  private missingParts(plan: DraftPlan): PartInventory {
    const cost = plan.report.cost;
    const missing: PartInventory = {};
    for (const inv of [cost.craft, cost.buy, cost.missing]) {
      for (const [k, n] of Object.entries(inv) as [PartKey, number][]) missing[k] = (missing[k] ?? 0) + n;
    }
    return missing;
  }

  /**
   * Pays for a draft and commits it: sells the cargo not needed for crafting (the rest goes to storage),
   * buys missing resources, crafts the missing parts (into storage) and commits the shipyard draft.
   * 'poor' = not affordable yet (resources for it are kept), 'failed' = the shipyard refused.
   */
  private *commitOps(st: StationDef, ops: EditorOp[], label: string, reserve: number, updateDesign = true): Generator<GameActionInput[], 'ok' | 'poor' | 'failed', SimEvent[]> {
    const s = this.state;
    let plan = planFromOps(s, st, ops);
    const missing = this.missingParts(plan);
    const need = this.recipeNeeds(missing);
    yield* this.sellSurplus(st, need);
    const storage = stationStorage(s, st.id).resources;
    let buyCost = 0;
    const buys: GameActionInput[] = [];
    for (const r of RESOURCE_IDS) {
      const short = Math.ceil((need[r] ?? 0) - storage[r] - s.player.cargo[r] - 1e-6);
      if (short > 0) {
        buyCost += purchaseCost(short, resourcePrice(r, st.ring, st.priceJitter[r]).buy);
        buys.push({ type: 'buyResource', resource: r, qty: short });
      }
    }
    let fees = plan.report.cost.installCredits + plan.report.cost.repairCredits;
    for (const [k, n] of Object.entries(missing) as [PartKey, number][]) fees += RECIPES[k].credits * n;
    if (s.credits < fees + buyCost + reserve) return 'poor';
    if (buys.length) {
      yield buys;
      this.log.count('resourcesBought', buys.length);
    }
    for (const [k, n] of Object.entries(missing) as [PartKey, number][]) {
      const events = yield [{ type: 'craft', key: k, count: n }];
      if (!this.lastOk(events)) this.log.note(s.tick, 'craftFailed', `${label} ${k} x${n}`);
    }
    plan = planFromOps(s, st, ops);
    if (!plan.report.canCommit) {
      this.log.note(s.tick, 'commitBlocked', `${label}: ${plan.report.errors.map((e) => e.code).join(',')}`);
      return 'failed';
    }
    const events = yield [{ type: 'shipyardCommit', baseHash: plan.baseHash, ops: plan.ops, acquire: {} }];
    if (!this.lastOk(events)) {
      this.log.note(s.tick, 'commitFailed', label);
      return 'failed';
    }
    if (updateDesign) this.design = cloneGrid(s.player.grid);
    yield* this.sellSpareParts(st, false);
    return 'ok';
  }

  /** Broke and unable to earn: strip weapons, shields, armour and radar (as long as the ship stays valid). */
  private *strip(st: StationDef, deep: boolean): Business {
    const s = this.state;
    const valid: EditorOp[] = [];
    for (const op of stripOps(s.player.grid, deep)) {
      const plan = planFromOps(s, st, [...valid, op]);
      if (plan.report.errors.every((e) => e.code === 'unaffordable' || e.code === 'missingResources' || e.code === 'missingParts')) valid.push(op);
    }
    if (!valid.length) return;
    const plan = planFromOps(s, st, valid);
    if (!plan.report.canCommit) return;
    const events = yield [{ type: 'shipyardCommit', baseHash: plan.baseHash, ops: plan.ops, acquire: {} }];
    if (this.lastOk(events)) this.log.note(s.tick, 'stripped', `${valid.length} parts to pay for repairs`);
  }

  private *business(stationId: string): Business {
    const s = this.state;
    const st = this.sim.station(stationId);
    if (!st) {
      yield [{ type: 'undock' }];
      return;
    }
    // contracts ready to turn in
    if (this.opts.contracts) {
      const ready = s.career.contracts.filter((c) => canTurnIn(s, st, c));
      if (ready.length) yield ready.map((c) => ({ type: 'turnInContract', contractId: c.serial }) as GameActionInput);
    }
    // own sector charts (sectors stage 2): the Guild buys each once
    const charts = cartography(s, st).sell.filter((c) => c.blocker === null);
    if (charts.length) {
      const events = yield charts.map((c) => ({ type: 'chartSell', sector: c.id }) as GameActionInput);
      this.log.count('chartsSold', events.filter((e) => e.type === 'chartSold').length);
    }
    // repairs
    if (st.services.repair && damagedParts(s.player.grid, s.player.hp).length > 0) {
      yield [{ type: 'repair', partIds: 'all', autoBuy: true }];
    }
    // refuel: ice first (cheaper than buying fuel), then credits, then the emergency ration
    const cap = s.player.props.fuelCapacity;
    if (st.services.refuel && s.player.fuel < cap - 0.5) {
      if (stationStorage(s, st.id).resources.ice + s.player.cargo.ice > 1e-6) yield [{ type: 'refuel', source: 'ice', amount: 'full' }];
      if (s.player.fuel < cap - 0.5 && s.credits >= 1) yield [{ type: 'refuel', source: 'credits', amount: 'full' }];
      if (s.player.fuel < cap * 0.25) yield [{ type: 'refuel', source: 'emergency', amount: 'full' }];
    }

    // parts lost in flight (pirates, ramming) are put back first
    if (st.services.shipyard && this.design) {
      const ops = restoreOps(s.player.grid, this.design);
      if (ops.length) {
        const keys = ops.map((o) => (o.op === 'place' ? o.key : '')).join(',');
        let r = yield* this.commitOps(st, ops, 'restore', crippled(s.player.grid) ? 0 : this.reserve());
        if (r !== 'ok' && crippled(s.player.grid)) {
          // cannot earn without engines / lasers: sell spare parts, strip extras, restore the essentials
          yield* this.sellSpareParts(st, true);
          yield* this.strip(st, crippled(s.player.grid) && s.player.props.lasers.length === 0);
          yield* this.sellSpareParts(st, true);
          // only what is missing to earn again, one part at a time: a laser when none is left, forward
          // engines when there is no forward thrust; a T1 part where the T2 one is too expensive
          const props = s.player.props;
          const essential = restoreOps(s.player.grid, this.design).filter(
            (o): o is Extract<EditorOp, { op: 'place' }> =>
              o.op === 'place' &&
              ((props.lasers.length === 0 && /^(miningLaser|heavyLaser):/.test(o.key)) || (props.thrust.forward <= 0 && o.key.startsWith('engine:') && o.rot === 0)),
          );
          for (const op of essential) {
            if (/^(miningLaser|heavyLaser):/.test(op.key) && s.player.props.lasers.length > 0) continue;
            if (op.key.startsWith('engine:') && s.player.props.thrust.forward > 0) continue;
            let one = yield* this.commitOps(st, [op], 'restore essential', 0, false);
            const { partId, tier } = parsePartKey(op.key);
            if (one !== 'ok' && tier === 2) one = yield* this.commitOps(st, [{ ...op, key: partKey(partId, 1) }], 'restore essential T1', 0, false);
            if (one === 'ok') r = 'ok';
          }
        }
        if (r !== 'ok' && !crippled(s.player.grid)) {
          // piecemeal: what earns first (lasers, engines, holds, reactors, tanks), each while affordable
          const rank = (k: string): number => ['miningLaser', 'heavyLaser', 'engine', 'cargo', 'largeCargo', 'reactor', 'fuelTank', 'gyro'].findIndex((x) => k.startsWith(`${x}:`)) >>> 0;
          const pieces = restoreOps(s.player.grid, this.design)
            .filter((o): o is Extract<EditorOp, { op: 'place' }> => o.op === 'place')
            .sort((x, y) => rank(x.key) - rank(y.key));
          for (const op of pieces) {
            const one = yield* this.commitOps(st, [op], 'restore part', this.reserve(), false);
            if (one === 'poor') break;
            if (one === 'ok') this.log.count('restoredParts');
          }
        }
        this.log.note(s.tick, r === 'ok' ? 'restored' : 'restorePending', `${keys}`);
      }
    }
    // soft-lock: the ship cannot earn and cannot be repaired here
    if (crippled(s.player.grid)) {
      const props = s.player.props;
      if (props.thrust.forward <= 0 && !st.services.shipyard) {
        this.abort(`no forward thrust, docked at ${st.id} (${st.kind}, no shipyard) – every tow returns here; scuttling respawns with the same layout on the ${s.settings.deathPenalty} penalty`);
      } else if (st.services.shipyard) {
        this.abort(`ship without ${props.lasers.length === 0 ? 'mining lasers' : 'forward engines'} at ${st.id} and ${s.credits} kr – cannot pay the restore even after selling spare and stripped parts`);
      }
      if (this.aborted) {
        yield [];
        return;
      }
    }

    // goals of the econ model's main path
    while (this.goalIndex < this.goals.length) {
      const goal = this.goals[this.goalIndex]!;
      if (goal.id === 'firstDayArmor' && !this.opts.firstDay) {
        this.goalIndex++;
        continue;
      }
      if (goalSatisfied(s.player.grid, goal)) {
        this.completeGoal(goal);
        continue;
      }
      if (!st.services.shipyard || crippled(s.player.grid)) break;
      // Archive nodes of the goal's parts first (Data from the fund, the credit fee now)
      const locked = (goal.archive ?? []).filter((n) => !s.discovery.archive.has(n));
      if (locked.length) {
        const fees = locked.reduce((sum, n) => sum + archiveNode(n).credits, 0);
        if (s.credits < fees + this.reserve()) break;
        const events = yield locked.map((node) => ({ type: 'archiveBuy', node }) as GameActionInput);
        const bought = events.filter((e) => e.type === 'archiveBought').length;
        this.log.count('archiveBought', bought);
        if (bought < locked.length) {
          this.log.note(s.tick, 'archiveFailed', `${goal.id}: ${locked.filter((n) => !s.discovery.archive.has(n)).join(',')}`);
          this.goalIndex++;
          continue;
        }
      }
      const planned = planGoalOps(s.player.grid, goal);
      if (planned.ops.length === 0 || !goalSatisfied(planned.grid, goal)) {
        this.log.note(s.tick, 'goalSkipped', `${goal.id}: ${planned.skipped.join('; ') || 'no ops'}`);
        this.goalIndex++;
        continue;
      }
      for (const why of planned.skipped) this.log.note(s.tick, 'goalPartial', why);
      const r = yield* this.commitOps(st, planned.ops, goal.id, this.reserve());
      if (r !== 'ok') break;
      this.completeGoal(goal);
    }
    if (!this.soldThisDock) yield* this.sellSurplus(st, {});
    // a refit may have added tanks – top up
    if (st.services.refuel && s.player.fuel < s.player.props.fuelCapacity - 0.5) {
      if (stationStorage(s, st.id).resources.ice > 1e-6) yield [{ type: 'refuel', source: 'ice', amount: 'full' }];
      if (s.player.fuel < s.player.props.fuelCapacity - 0.5 && s.credits >= 1) yield [{ type: 'refuel', source: 'credits', amount: 'full' }];
    }

    // mining contracts
    if (this.opts.contracts && st.services.market) {
      const allowed: ResourceId[] = this.ring2 ? ['titanium', 'iron', 'copper', 'ice'] : ['iron', 'copper', 'ice'];
      const board = currentBoard(s, st);
      for (const offer of board.offers) {
        if (s.career.contracts.length >= 3) break;
        const t = offer.target;
        if (t.kind !== 'mining' || !allowed.includes(t.resource)) continue;
        const events = yield [{ type: 'acceptContract', offerId: offer.id }];
        if (this.lastOk(events)) this.log.count('contractsAccepted');
      }
    }

    // time in the station UI
    const dwell = Math.round(this.opts.dwellSeconds / SIM_DT);
    for (let i = 0; i < dwell; i++) yield [];
    yield [{ type: 'undock' }];
  }

  private abort(reason: string): void {
    this.aborted = reason;
    this.log.stuck.push({ tick: this.state.tick, kind: 'softlock', detail: reason });
  }

  /** Parts in storage that no remaining goal uses (removed by upgrades) are sold for 40 %; `all` = sell everything. */
  private *sellSpareParts(st: StationDef, all: boolean): Business {
    if (!st.services.partsMarket) return;
    const s = this.state;
    const wanted = new Set<string>();
    if (!all) for (const g of this.goals.slice(this.goalIndex)) for (const r of g.reqs) wanted.add(partKey(r.part, r.tier));
    const actions: GameActionInput[] = [];
    for (const [key, n] of Object.entries(stationStorage(s, st.id).parts) as [PartKey, number][]) {
      if (!n || wanted.has(key) || parsePartKey(key).variant) continue;
      actions.push({ type: 'sellPart', key, count: n });
    }
    if (actions.length) yield actions;
  }
}

const cloneGrid = (g: ShipGrid): ShipGrid => ({ parts: g.parts.map((p) => ({ ...p })), nextId: g.nextId });

const aimHasVeins = (a: Asteroid): boolean => a.resource !== 'ice';

const fmt = (v: Vec2): string => `(${v.x.toFixed(1)}, ${v.y.toFixed(1)})`;

