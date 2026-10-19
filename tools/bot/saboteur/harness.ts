// Saboteur harness: drives the real deterministic Simulation step by step through PlayerCommands and
// station actions only (never mutates the state directly), handles deaths like the game layer does
// (death screen time, then applyDeath) and offers the building blocks the exploit / softlock
// scenarios are made of: shipyard commits, liquidation, simple flight and docking, cloning via save.
import { INSTALL_FEE, partBuyPrice, partSellPrice, purchaseCost, RECIPES, resourcePrice } from '../../../src/data/economy';
import { ALL_PART_KEYS, parsePartKey, partDefOf, partKey, type PartInventory, type PartKey } from '../../../src/data/parts';
import { RESOURCE_IDS, type ResourceId } from '../../../src/data/resources';
import { IDLE_COMMAND, type GameAction, type GameActionInput, type PlayerCommand } from '../../../src/sim/commands';
import { applyDeath } from '../../../src/sim/death/death';
import type { Vec2 } from '../../../src/sim/math/vec2';
import { restoreSimulation, toSave } from '../../../src/sim/save/serialize';
import type { GameSettings } from '../../../src/sim/settings';
import { computeProperties } from '../../../src/sim/ship/properties';
import type { PlacedPart, ShipGrid } from '../../../src/sim/ship/types';
import type { EditorOp } from '../../../src/sim/shipyard/editor';
import { SIM_DT, Simulation, type SimEvent, type SimState } from '../../../src/sim/Simulation';
import { stationFuelPrice } from '../../../src/sim/sector/market';
import { stationStorage } from '../../../src/sim/station/storage';
import { towAvailable } from '../../../src/sim/station/tow';
import { stationById, type StationDef } from '../../../src/sim/world/stations';
import { creepDock, dist, dockNav, newNavMemory, steer, type NavGoal } from '../flight';
import { planFromOps } from '../shipPlan';

/** Ticks per game second. */
export const TPS = Math.round(1 / SIM_DT);

export interface DriverOptions {
  /** Game seconds the death screen takes before the respawn (the game shows a card, then applyDeath). */
  deathSeconds: number;
  /** Game seconds a human spends in the station UI per docking session (shipyard, market…). */
  uiSeconds: number;
}

export const DEFAULT_DRIVER_OPTIONS: DriverOptions = { deathSeconds: 5, uiSeconds: 10 };

/** Settings of a new game on a difficulty (the presets of the New Game screen). */
export function newGameSettings(penalty: GameSettings['deathPenalty'], seed: number): Partial<GameSettings> {
  const density = penalty === 'none' ? 'low' : penalty === 'mild' ? 'normal' : 'high';
  return { seedText: String(seed), deathPenalty: penalty, enemyDensity: density, miningYield: penalty === 'none' ? 2 : 1 };
}

export function newGame(seed: number, penalty: GameSettings['deathPenalty'] = 'mild'): Simulation {
  return new Simulation({ seed, settings: newGameSettings(penalty, seed) });
}

/** Independent copy of a simulation through the real save format (save → restore). */
export function cloneSim(sim: Simulation): Simulation {
  const save = toSave(sim, {
    gameId: 'saboteur',
    name: 'saboteur',
    createdAt: '2026-10-17T10:00:00.000Z',
    savedAt: '2026-10-17T10:00:00.000Z',
    reason: 'manual',
    gameVersion: 'bot',
  });
  return restoreSimulation(structuredClone(save));
}

export const keyOf = (p: Pick<PlacedPart, 'partId' | 'tier' | 'variant'>): PartKey => partKey(p.partId, p.tier, p.variant);
export const isMiningKey = (k: PartKey): boolean => !!partDefOf(k).mining;

export class Driver {
  readonly opts: DriverOptions;
  private reqId = 0;
  /** Event counters (guildLoan, towed, death, …). */
  readonly counts: Record<string, number> = {};
  /** Credits by reason (positive and negative). */
  readonly credits: Record<string, number> = {};
  /** Parts lent by the Guild (mounted on the hull). */
  readonly kitParts: PartInventory = {};
  /** Tick of the first sale of mined ore (cargo sold while it holds ore) – set by the scenarios. */
  firstSaleTick: number | null = null;

  constructor(
    public sim: Simulation,
    opts: Partial<DriverOptions> = {},
  ) {
    this.opts = { ...DEFAULT_DRIVER_OPTIONS, ...opts };
  }

  get state(): SimState {
    return this.sim.state;
  }

  get seconds(): number {
    return this.state.tick * SIM_DT;
  }

  private count(kind: string, n = 1): void {
    this.counts[kind] = (this.counts[kind] ?? 0) + n;
  }

  /** Optional event tap (debugging, traces in the report). */
  onEvent: ((e: SimEvent, d: Driver) => void) | null = null;

  observe(events: readonly SimEvent[]): void {
    for (const e of events) {
      this.onEvent?.(e, this);
      switch (e.type) {
        case 'creditsChanged':
          this.credits[e.reason] = (this.credits[e.reason] ?? 0) + e.delta;
          break;
        case 'guildLoan':
          this.count('guildLoan');
          for (const [k, n] of Object.entries(e.parts) as [PartKey, number][]) this.kitParts[k] = (this.kitParts[k] ?? 0) + n;
          break;
        case 'towed':
          this.count(e.cost > 0 ? 'towPaid' : 'towFree');
          if (e.cargoLost) this.count('towCargoLost');
          break;
        case 'shipScuttled':
          this.count('scuttle');
          break;
        case 'contractCompleted':
          this.count('contractCompleted');
          break;
        default:
          break;
      }
    }
  }

  /** One simulation step; a destroyed ship goes through the death screen and respawns. */
  step(cmd: PlayerCommand = IDLE_COMMAND): SimEvent[] {
    const events = this.sim.step(cmd);
    this.observe(events);
    if (this.state.player.destroyed) events.push(...this.die());
    return events;
  }

  /** Death screen (the simulation keeps running behind it), then the difficulty's death rule. */
  private die(): SimEvent[] {
    for (let i = 0; i < this.opts.deathSeconds * TPS; i++) this.observe(this.sim.step(IDLE_COMMAND));
    const outcome = applyDeath(this.sim);
    this.count('death');
    this.observe(outcome.events);
    return outcome.events;
  }

  idle(seconds: number): void {
    const n = Math.round(seconds * TPS);
    for (let i = 0; i < n; i++) this.step();
  }

  /** Idles until `until()` holds or `seconds` passed; true when the condition was met. */
  idleUntil(until: () => boolean, seconds: number): boolean {
    const end = this.state.tick + Math.round(seconds * TPS);
    while (this.state.tick < end) {
      if (until()) return true;
      this.step();
    }
    return until();
  }

  /** Station actions in one step; returns true when every action succeeded. */
  act(...actions: GameActionInput[]): boolean {
    if (actions.length === 0) return true;
    const first = this.reqId + 1;
    const list = actions.map((a) => ({ ...a, reqId: ++this.reqId }) as GameAction);
    const events = this.step({ ...IDLE_COMMAND, actions: list });
    let ok = 0;
    for (const e of events) if (e.type === 'actionResult' && e.reqId >= first && e.ok) ok++;
    return ok === actions.length;
  }

  /** One station action in one step; its result (ok, or the refusal reason). */
  attempt(action: GameActionInput): { ok: boolean; reason?: string; events: SimEvent[] } {
    const reqId = ++this.reqId;
    const events = this.step({ ...IDLE_COMMAND, actions: [{ ...action, reqId } as GameAction] });
    const result = events.find((e) => e.type === 'actionResult' && e.reqId === reqId);
    if (!result || result.type !== 'actionResult') return { ok: false, reason: 'noResult', events };
    return { ok: result.ok, ...(result.ok ? {} : { reason: String(result.reason) }), events };
  }

  docked(): StationDef | null {
    const d = this.state.player.dock;
    return d.mode === 'docked' ? this.sim.station(d.stationId) : null;
  }

  undock(): boolean {
    if (this.state.player.dock.mode !== 'docked') return this.state.player.dock.mode === 'flying';
    return this.act({ type: 'undock' });
  }

  /** Abandons the ship (pause menu): undocks first when docked; the death is applied by step(). */
  scuttle(): boolean {
    if (this.state.player.dock.mode === 'docked') this.undock();
    if (this.state.player.dock.mode !== 'flying') return false;
    const deaths = this.counts.death ?? 0;
    this.step({ ...IDLE_COMMAND, scuttle: true });
    return (this.counts.death ?? 0) > deaths;
  }

  /** Tow (H) when the ship cannot fly on. */
  tow(): boolean {
    if (this.state.player.dock.mode !== 'flying' || !towAvailable(this.state.player)) return false;
    this.step({ ...IDLE_COMMAND, emergency: true });
    return this.docked() !== null;
  }

  // ---------------------------------------------------------------- shipyard

  /** Commits editor ops at the docked station (same draft path as the shipyard UI). */
  commit(ops: readonly EditorOp[]): boolean {
    const st = this.docked();
    if (!st || ops.length === 0) return false;
    const plan = planFromOps(this.state, st, ops);
    if (!plan.report.canCommit) return false;
    return this.act({ type: 'shipyardCommit', baseHash: plan.baseHash, ops: plan.ops, acquire: {} });
  }

  /** Would these ops commit right now? */
  canCommit(ops: readonly EditorOp[]): boolean {
    const st = this.docked();
    return !!st && planFromOps(this.state, st, ops).report.canCommit;
  }

  /**
   * Removes every part it can (outermost first) while the design stays valid: what is left is the
   * smallest ship the shipyard accepts (cockpit + forward thrust). Removed parts go to storage.
   */
  stripToMinimum(keep: (p: PlacedPart) => boolean = () => false): number {
    const st = this.docked();
    if (!st?.services.shipyard) return 0;
    const grid = this.state.player.grid;
    const com = computeProperties(grid).centerOfMass;
    const order = [...grid.parts]
      .filter((p) => p.partId !== 'cockpit' && !keep(p))
      .sort((a, b) => Math.hypot(b.x - com.x, b.y - com.y) - Math.hypot(a.x - com.x, a.y - com.y) || b.id - a.id);
    const ops: EditorOp[] = [];
    // several passes: a part may only become removable after an outer one went
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      for (const p of order) {
        if (ops.some((o) => o.op === 'remove' && o.id === p.id)) continue;
        const trial: EditorOp[] = [...ops, { op: 'remove', id: p.id }];
        if (planFromOps(this.state, st, trial).report.canCommit) {
          ops.push({ op: 'remove', id: p.id });
          changed = true;
        }
      }
      if (!changed) break;
    }
    return ops.length && this.commit(ops) ? ops.length : 0;
  }

  /** Places a part from storage (or bought / crafted by the shipyard) at the best free cell. */
  placePart(key: PartKey, rot: 0 | 1 | 2 | 3 = 0, at?: { x: number; y: number }): boolean {
    const st = this.docked();
    if (!st?.services.shipyard) return false;
    const grid = this.state.player.grid;
    // engines at the stern (free exhaust), everything else at the bow
    const cells = at ? [at] : key.startsWith('engine:') ? candidateCells(grid).reverse() : candidateCells(grid);
    for (const c of cells) {
      const op: EditorOp = { op: 'place', key, x: c.x, y: c.y, rot };
      if (this.canCommit([op])) return this.commit([op]);
    }
    return false;
  }

  /**
   * Mounts a part however the station allows: from storage, bought ready-made, or crafted – buying
   * the missing recipe resources first when the credits cover resources + crafting fee + install.
   */
  acquirePart(key: PartKey, rot: 0 | 1 | 2 | 3 = 0): boolean {
    if (this.placePart(key, rot)) return true;
    const st = this.docked();
    if (!st?.services.crafting || !st.services.market) return false;
    const recipe = RECIPES[key];
    const have = stationStorage(this.state, st.id).resources;
    const buys: { r: ResourceId; qty: number }[] = [];
    let cost = recipe.credits + INSTALL_FEE;
    for (const r of RESOURCE_IDS) {
      const short = Math.ceil((recipe.resources[r] ?? 0) - have[r] - this.state.player.cargo[r] - 1e-6);
      if (short > 0) {
        buys.push({ r, qty: short });
        cost += purchaseCost(short, resourcePrice(r, st.ring, st.priceJitter[r]).buy);
      }
    }
    if (cost > this.state.credits) return false;
    for (const b of buys) this.act({ type: 'buyResource', resource: b.r, qty: b.qty });
    return this.placePart(key, rot);
  }

  // ---------------------------------------------------------------- market

  sellCargo(): number {
    const st = this.docked();
    if (!st?.services.market) return 0;
    const before = this.state.credits;
    const acts: GameActionInput[] = [];
    for (const r of RESOURCE_IDS) if (this.state.player.cargo[r] > 1e-6) acts.push({ type: 'sellResource', resource: r, qty: 'all', from: 'ship' });
    for (const r of RESOURCE_IDS) if (stationStorage(this.state, st.id).resources[r] > 1e-6) acts.push({ type: 'sellResource', resource: r, qty: 'all', from: 'storage' });
    for (const a of acts) this.act(a);
    return this.state.credits - before;
  }

  /** Sells every part in the docked station's storage (optionally only matching keys). */
  sellStorageParts(match: (k: PartKey) => boolean = () => true): number {
    const st = this.docked();
    if (!st?.services.partsMarket) return 0;
    const before = this.state.credits;
    for (const [k, n] of Object.entries(stationStorage(this.state, st.id).parts) as [PartKey, number][]) {
      if (n > 0 && match(k)) this.act({ type: 'sellPart', key: k, count: n });
    }
    return this.state.credits - before;
  }

  /**
   * Burns credits down to (almost) nothing with buy → sell round-trips (part market first, then the
   * resource market) – the worst possible spending, nothing of value is kept.
   */
  burnCredits(floor = 5): void {
    const st = this.docked();
    if (!st) return;
    for (let guard = 0; guard < 400; guard++) {
      if (st.services.partsMarket) {
        let best: { key: PartKey; price: number } | null = null;
        for (const key of ALL_PART_KEYS) {
          if (parsePartKey(key).variant) continue;
          const price = partBuyPrice(key, st.ring);
          if (price !== null && price <= this.state.credits && (!best || price > best.price)) best = { key, price };
        }
        if (best && this.act({ type: 'buyPart', key: best.key, count: 1 })) {
          this.act({ type: 'sellPart', key: best.key, count: 1 });
          continue;
        }
      }
      if (!st.services.market) return;
      const r: ResourceId = 'iron';
      const unit = resourcePrice(r, st.ring, st.priceJitter[r]).buy;
      const qty = Math.floor(this.state.credits / unit);
      if (this.state.credits <= floor || qty < 1 || purchaseCost(qty, unit) > this.state.credits) return;
      if (!this.act({ type: 'buyResource', resource: r, qty })) return;
      this.act({ type: 'sellResource', resource: r, qty: 'all', from: 'storage' });
    }
  }

  /** Refuels like a careful player: ice first, then as much as the credits buy, then the emergency ration. */
  refuel(): void {
    const st = this.docked();
    if (!st?.services.refuel) return;
    const p = this.state.player;
    const missing = (): number => p.props.fuelCapacity - p.fuel;
    if (missing() > 0.5 && stationStorage(this.state, st.id).resources.ice + p.cargo.ice > 1e-6) this.act({ type: 'refuel', source: 'ice', amount: 'full' });
    if (missing() > 0.5) {
      const units = Math.min(missing(), Math.floor(this.state.credits / stationFuelPrice(this.state, st)) - 1);
      if (units >= missing() - 1e-6) this.act({ type: 'refuel', source: 'credits', amount: 'full' });
      else if (units >= 1) this.act({ type: 'refuel', source: 'credits', amount: units });
    }
    if (missing() > 0.5) this.act({ type: 'refuel', source: 'emergency', amount: 'full' });
  }

  // ---------------------------------------------------------------- flight

  private nav = newNavMemory();

  /**
   * Flies towards `target`; stops when `until` holds, the target is reached or the time is up. The
   * speeds stay moderate: the flight helper looks ahead ∝ speed² / braking, and a weak saboteur hull
   * at full speed would make every step scan (and generate) a huge area.
   */
  flyTo(target: Vec2, opts: { maxSpeed?: number; arriveSpeed?: number; seconds?: number; until?: () => boolean; noAvoid?: boolean } = {}): boolean {
    const end = this.state.tick + Math.round((opts.seconds ?? 300) * TPS);
    while (this.state.tick < end) {
      const p = this.state.player;
      if (p.dock.mode !== 'flying' || p.destroyed) return false;
      if (opts.until?.()) return true;
      if (dist(p.body.pos, target) < 4 && Math.hypot(p.body.vel.x, p.body.vel.y) < Math.max(3, opts.arriveSpeed ?? 0)) return true;
      const nav: NavGoal = { target, arriveSpeed: opts.arriveSpeed ?? 0, maxSpeed: opts.maxSpeed ?? 35, precise: dist(p.body.pos, target) < 30, ...(opts.noAvoid ? { noAvoid: true } : {}) };
      const out = steer(this.state, nav, undefined, this.nav);
      this.step({ ...IDLE_COMMAND, flight: out.flight, toggleDampers: out.dampers !== p.dampers, aim: { ...p.body.pos } });
    }
    return opts.until?.() ?? false;
  }

  /** Flies to a (loaded or known) station and docks; false on timeout / out of fuel. */
  dockAt(st: StationDef, seconds = 300): boolean {
    const end = this.state.tick + Math.round(seconds * TPS);
    let pressed = -999;
    while (this.state.tick < end) {
      const p = this.state.player;
      if (p.dock.mode === 'docked') return p.dock.stationId === st.id;
      if (p.destroyed) return false;
      if (p.dock.mode === 'docking') {
        this.step();
        continue;
      }
      if (p.fuel <= 0) return false;
      // the docking manoeuvre: out on the dock axis, then slowly in to the clamp with the bow at the station
      // (the cockpit RCS lets the dampers stop a sideways drift, so the flight helper docks the training
      // hull too; only a ship without a reverse engine stops by flip and burn and coasts in)
      const t = p.props.thrust;
      if (t.backward <= 0) {
        const creep = creepDock(this.state, st);
        const dock = creep.ready && this.state.tick - pressed > 20;
        if (dock) pressed = this.state.tick;
        this.step({ ...IDLE_COMMAND, flight: creep.flight, toggleDampers: p.dampers, aim: { ...p.body.pos }, dock });
        continue;
      }
      const nav = dockNav(this.state, st, 40);
      const steerOut = steer(this.state, nav.nav, undefined, this.nav);
      const dock = nav.ready && this.state.tick - pressed > 20;
      if (dock) pressed = this.state.tick;
      this.step({ ...IDLE_COMMAND, flight: steerOut.flight, toggleDampers: steerOut.dampers !== p.dampers, aim: { ...p.body.pos }, dock });
    }
    return this.state.player.dock.mode === 'docked';
  }

  /** Nearest discovered station (optionally with a filter). */
  nearestStation(filter: (s: StationDef) => boolean = () => true): StationDef | null {
    const pos = this.state.player.body.pos;
    let best: StationDef | null = null;
    for (const id of this.state.world.discovered) {
      const s = this.sim.station(id) ?? stationById(this.state.seed, id);
      if (!s || !filter(s)) continue;
      if (!best || dist(s.pos, pos) < dist(best.pos, pos)) best = s;
    }
    return best;
  }
}

/** Free cells next to the ship, bow first (where a laser fires freely). */
export function candidateCells(grid: ShipGrid): { x: number; y: number }[] {
  const occupied = new Set(grid.parts.map((p) => `${p.x},${p.y}`));
  const out: { x: number; y: number }[] = [];
  for (const p of grid.parts) {
    for (const [dx, dy] of [[1, 0], [0, 1], [0, -1], [-1, 0]] as const) {
      const c = { x: p.x + dx, y: p.y + dy };
      if (!occupied.has(`${c.x},${c.y}`) && !out.some((o) => o.x === c.x && o.y === c.y)) out.push(c);
    }
  }
  return out.sort((a, b) => b.x - a.x || Math.abs(a.y) - Math.abs(b.y));
}

/** Sell value of a part (the same everywhere). */
export const sellValue = (k: PartKey): number => partSellPrice(k);
