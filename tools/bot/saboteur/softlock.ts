// Softlock search: adversarial and random command sequences (sell, strip, burn credits, fly off, run
// the tank dry, ram rocks, sit at a station, abandon ship…), then a recovery oracle that tries every
// safety net on independent copies of the state (save → restore). A state is STUCK when no strategy
// gets the ship back to selling mined ore within the time budget.
import { INSTALL_FEE, partBuyPrice } from '../../../src/data/economy';
import { cargoUsed } from '../../../src/data/resources';
import type { PartKey } from '../../../src/data/parts';
import { IDLE_COMMAND } from '../../../src/sim/commands';
import type { DeathPenalty } from '../../../src/sim/settings';
import type { Simulation } from '../../../src/sim/Simulation';
import { LOAN_ENGINE_KEY, LOAN_LASER_KEY } from '../../../src/sim/station/guildLoan';
import { towAvailable } from '../../../src/sim/station/tow';
import type { PlacedPart } from '../../../src/sim/ship/types';
import { guaranteedStationChunks, HOME_STATION_ID, homeStation, stationAt, type StationDef } from '../../../src/sim/world/stations';
import { cloneSim, Driver, isMiningKey, keyOf, newGame, TPS } from './harness';
import { runPilot } from './pilotLoop';
import { liquidate } from './scenarios';
import { ram } from './ram';

// ------------------------------------------------------------------------------------------------
// recovery oracle

export interface Attempt {
  strategy: 'nets' | 'scuttle';
  ok: boolean;
  /** Game seconds until ore was sold again (or the budget). */
  seconds: number;
  note: string;
}

export interface OracleResult {
  stuck: boolean;
  attempts: Attempt[];
}

const canMine = (d: Driver): boolean => {
  const p = d.state.player.props;
  return p.lasers.length > 0 && p.thrust.forward > 0 && p.cargoCapacity > 0;
};

const homeLike = (d: Driver): StationDef | null => d.nearestStation((s) => s.services.shipyard && s.services.market);

const storageParts = (d: Driver, id: string): [PartKey, number][] =>
  (Object.entries(d.state.stations.get(id)?.parts ?? {}) as [PartKey, number][]).filter(([, n]) => n > 0);

/** Thrust forward until the tank is empty (so the tow becomes available). */
function burnTank(d: Driver, seconds = 400): void {
  const end = d.state.tick + seconds * TPS;
  while (d.state.tick < end && d.state.player.dock.mode === 'flying' && d.state.player.fuel > 0) {
    d.step({ ...IDLE_COMMAND, flight: { forward: 1, strafe: 0, turn: 0.2 } });
  }
}

/**
 * Plays the safety nets like a determined player: tow when stranded, fly / tow to a shipyard, sell
 * cargo and spare parts, mount spares, buy what is affordable, strip the hull and sell it when that
 * is all there is (the Guild lends the missing part to a player who cannot buy it), refuel (credits,
 * ice, ration).
 */
function playNets(d: Driver, budget: number): string {
  const end = d.state.tick + budget * TPS;
  let lastStation = '';
  let sameStationTows = 0;
  for (let guard = 0; guard < 400 && d.state.tick < end; guard++) {
    const p = d.state.player;
    if (p.dock.mode === 'docking') {
      d.step();
      continue;
    }
    if (p.dock.mode === 'flying') {
      if (towAvailable(p)) {
        d.tow();
        const st = d.docked();
        if (st && st.id === lastStation) sameStationTows++;
        continue;
      }
      // the Guild lends at every shipyard – the nearest one with a market will do
      const target = homeLike(d) ?? homeStation();
      if (!d.dockAt(target, 300) && d.state.player.dock.mode === 'flying') burnTank(d);
      continue;
    }
    const st = d.docked()!;
    lastStation = st.id;
    if (sameStationTows >= 2) return `every tow returns to ${st.id} (${st.kind}) and the ship cannot fly from there`;
    if (st.services.market) d.sellCargo();
    d.refuel();
    // too little fuel for a trip and no money: sell what the ship can mine without (gyro, radar, …)
    if (canMine(d) && lowOnFuel(d) && st.services.shipyard && stripAndSell(d, keepForMining)) d.refuel();
    if (canMine(d) && d.state.player.fuel > 0) return 'ready';
    if (!st.services.shipyard) {
      d.undock();
      continue;
    }
    const props = d.state.player.props;
    let acted = false;
    if (props.thrust.forward <= 0) {
      const spare = storageParts(d, st.id).find(([k]) => k.startsWith('engine:'));
      acted = d.acquirePart(spare ? spare[0] : LOAN_ENGINE_KEY, 0);
      // fund it: sell spare parts here, then strip the hull (a removal-only draft works without engines)
      if (!acted) acted = d.sellStorageParts((k) => !k.startsWith('engine:')) > 0;
      if (!acted && spare && d.state.credits < INSTALL_FEE) acted = d.sellStorageParts((k) => k === spare[0]) > 0;
      if (!acted) acted = stripAndSell(d);
      // nothing left to raise money with: the Guild lends an engine in the next step
      if (!acted) acted = waitForLoan(d);
      if (!acted) {
        // nothing works here: undock and ask for a tow (it goes to the nearest shipyard)
        d.undock();
        continue;
      }
      continue;
    }
    if (props.lasers.length === 0) {
      const spare = storageParts(d, st.id).find(([k]) => isMiningKey(k));
      if (spare && d.state.credits >= INSTALL_FEE) acted = d.placePart(spare[0], 0);
      else if (spare) acted = d.sellStorageParts(isMiningKey) > 0;
      else if (d.acquirePart(LOAN_LASER_KEY, 0)) acted = true;
      else if (waitForLoan(d)) acted = true;
      else if (d.sellStorageParts() > 0 || stripAndSell(d)) acted = true;
      else {
        d.undock();
        continue;
      }
    }
    if (!acted) d.idle(5);
  }
  const p = d.state.player;
  return `budget spent: ${p.dock.mode} ${p.dock.mode === 'docked' ? p.dock.stationId : `at (${p.body.pos.x.toFixed(0)}, ${p.body.pos.y.toFixed(0)})`}, credits ${d.state.credits}, ship ${p.grid.parts.map((x) => keyOf(x)).join(',')}`;
}

/** A trip needs fuel: under 40 % of the tank (or 12 units) the honest pilot will not leave. */
const lowOnFuel = (d: Driver): boolean => d.state.player.fuel < Math.max(12, 0.4 * d.state.player.props.fuelCapacity);

/** Parts a mining trip needs: lasers, holds, forward engines and whatever the Guild lent. */
const keepForMining = (p: PlacedPart): boolean =>
  !!p.loan || isMiningKey(keyOf(p)) || p.partId === 'cargo' || p.partId === 'largeCargo' || p.partId === 'reactor' || (p.partId === 'engine' && p.rot === 0);

/** Strips the hull to the minimum (keeping what `keep` says) and sells what came off (removal-only – valid without engines). */
function stripAndSell(d: Driver, keep?: (p: PlacedPart) => boolean): boolean {
  const removed = d.stripToMinimum(keep);
  const sold = d.sellStorageParts();
  return removed > 0 || sold > 0;
}

/** A short wait docked at a shipyard: the Guild lends what a poor player lacks right away. */
function waitForLoan(d: Driver): boolean {
  const loans = d.counts.guildLoan ?? 0;
  return d.idleUntil(() => (d.counts.guildLoan ?? 0) > loans, 3);
}

/** Debug tap for the oracle's copies (null = off). */
export const oracleTap: { onEvent: Driver['onEvent'] } = { onEvent: null };

function attempt(base: Simulation, strategy: Attempt['strategy'], budget: number, pilotSeconds: number): Attempt {
  const d = new Driver(cloneSim(base));
  d.onEvent = oracleTap.onEvent;
  const t0 = d.state.tick;
  const end = t0 + budget * TPS;
  if (strategy === 'scuttle' && !d.scuttle()) return { strategy, ok: false, seconds: 0, note: 'cannot scuttle' };
  let note = '';
  // a few rounds: the honest pilot may lose the ship again (pirates, rocks) – the player just retries
  for (let round = 0; round < 3 && d.state.tick < end; round++) {
    note = playNets(d, Math.max(60, (end - d.state.tick) / TPS));
    if (note !== 'ready') {
      if (strategy === 'scuttle' && d.scuttle()) continue;
      break;
    }
    const start = d.state.tick;
    // a broke player flies out on what is in the tank (the default reserve would keep a tiny tank docked)
    const run = runPilot(d, pilotSeconds, {}, { reserveShare: 0.4 });
    if (run.firstOreSale !== null) return { strategy, ok: true, seconds: (start - t0) / TPS + run.firstOreSale, note: round ? `ore sold (round ${round + 1})` : 'ore sold' };
    note = `ship ready but no ore sold in ${pilotSeconds} s${run.aborted ? ` (${run.aborted})` : ''}`;
    if (strategy === 'scuttle') d.scuttle();
  }
  return { strategy, ok: false, seconds: (d.state.tick - t0) / TPS, note };
}

/** Can the player get back to selling mined ore from this state? Every strategy runs on its own copy. */
export function oracle(sim: Simulation, budget = 40 * 60, pilotSeconds = 12 * 60): OracleResult {
  const attempts: Attempt[] = [];
  for (const s of ['nets', 'scuttle'] as const) {
    const a = attempt(sim, s, budget, pilotSeconds);
    attempts.push(a);
    if (a.ok) break;
  }
  return { stuck: attempts.every((a) => !a.ok), attempts };
}

// ------------------------------------------------------------------------------------------------
// adversarial moves

/** Small deterministic RNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type MoveId =
  | 'sellCargo'
  | 'stripPart'
  | 'sellStorage'
  | 'burnCredits'
  | 'flyAway'
  | 'runDry'
  | 'ramNose'
  | 'ramStern'
  | 'gotoStation'
  | 'scuttle'
  | 'tow'
  | 'wait'
  | 'dockHome';

export const MOVES: readonly MoveId[] = ['sellCargo', 'stripPart', 'sellStorage', 'burnCredits', 'flyAway', 'runDry', 'ramNose', 'ramStern', 'gotoStation', 'scuttle', 'tow', 'wait', 'dockHome'];

/** One adversarial move (each bounded in game time); returns what happened. */
export function move(d: Driver, id: MoveId, rand: () => number): string {
  const p = () => d.state.player;
  switch (id) {
    case 'sellCargo':
      return `sold cargo for ${d.sellCargo()} kr`;
    case 'stripPart': {
      if (!d.docked()?.services.shipyard) return 'no shipyard';
      const parts = p().grid.parts.filter((x) => x.partId !== 'cockpit');
      const order = parts.map((x) => ({ x, k: rand() })).sort((a, b) => a.k - b.k);
      for (const { x } of order) if (d.commit([{ op: 'remove', id: x.id }])) return `removed ${keyOf(x)}`;
      return 'nothing removable';
    }
    case 'sellStorage':
      return `sold parts for ${d.sellStorageParts()} kr`;
    case 'burnCredits':
      d.burnCredits();
      return `credits ${d.state.credits}`;
    case 'flyAway': {
      d.undock();
      const ang = rand() * Math.PI * 2;
      const r = 300 + rand() * 2200;
      const target = { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
      d.flyTo(target, { seconds: 150 });
      return `flew towards (${target.x.toFixed(0)}, ${target.y.toFixed(0)})`;
    }
    case 'runDry':
      d.undock();
      burnTank(d, 300);
      return `fuel ${p().fuel.toFixed(1)}`;
    case 'ramNose':
    case 'ramStern':
      return ram(d, id === 'ramStern', 45) ? `rammed: ${p().grid.parts.length} parts left` : 'no ram';
    case 'gotoStation': {
      d.undock();
      const st = d.nearestStation((s) => s.id !== HOME_STATION_ID);
      if (!st) return 'no other station known';
      return d.dockAt(st, 240) ? `docked at ${st.id} (${st.kind})` : `could not reach ${st.id}`;
    }
    case 'scuttle':
      return d.scuttle() ? `scuttled → ${d.docked()?.id}` : 'no scuttle';
    case 'tow':
      d.undock();
      return d.tow() ? `towed to ${d.docked()?.id}` : 'no tow';
    case 'wait':
      d.idle(60 + rand() * 240);
      return 'waited';
    case 'dockHome':
      d.undock();
      return d.dockAt(homeStation(), 240) ? 'home' : 'could not reach home';
    default:
      return '';
  }
}

export interface ChaosResult {
  seed: number;
  penalty: DeathPenalty;
  run: number;
  moves: string[];
  /** Tick when the oracle ran (the reproduction anchor). */
  tick: number;
  stuck: boolean;
  attempts: Attempt[];
  state: string;
}

const describe = (d: Driver): string => {
  const p = d.state.player;
  const where = p.dock.mode === 'docked' ? `docked at ${p.dock.stationId}` : `${p.dock.mode} at (${p.body.pos.x.toFixed(0)}, ${p.body.pos.y.toFixed(0)})`;
  return `${where}, credits ${d.state.credits}, fuel ${p.fuel.toFixed(1)}/${p.props.fuelCapacity}, cargo ${cargoUsed(p.cargo).toFixed(0)}, fwd thrust ${p.props.thrust.forward}, lasers ${p.props.lasers.length}, ship ${p.grid.parts.map((x) => keyOf(x)).join(',')}`;
};

/** A random adversarial sequence (always starting with a liquidation – the worst start) + the oracle. */
export function chaosRun(seed: number, penalty: DeathPenalty, run: number, length = 6, oracleBudget = 40 * 60): ChaosResult {
  const rand = rng(seed * 7919 + run * 104729 + penalty.length);
  const d = new Driver(newGame(seed, penalty));
  const moves: string[] = [];
  if (rand() < 0.7) {
    liquidate(d);
    moves.push(`liquidate → credits ${d.state.credits}`);
  }
  for (let i = 0; i < length; i++) {
    const id = MOVES[Math.floor(rand() * MOVES.length)]!;
    moves.push(`${id}: ${move(d, id, rand)}`);
  }
  // the oracle starts from a quiet moment
  if (d.state.player.dock.mode === 'docking') d.idle(2);
  const o = oracle(d.sim, oracleBudget);
  return { seed, penalty, run, moves, tick: d.state.tick, stuck: o.stuck, attempts: o.attempts, state: describe(d) };
}

// ------------------------------------------------------------------------------------------------
// targeted: lose the engines next to a station that has a shipyard but no emergency kit

export interface TargetedResult extends ChaosResult {
  /** The ship reached the target state (engineless, docked at a non-home shipyard). */
  reached: boolean;
}

export function enginelessAtStation(seed: number, penalty: DeathPenalty, oracleBudget = 40 * 60): TargetedResult {
  const d = new Driver(newGame(seed, penalty));
  const moves: string[] = [];
  liquidate(d);
  moves.push(`liquidate at home → credits ${d.state.credits}, ship ${d.state.player.grid.parts.map((x) => keyOf(x)).join(',')}`);
  d.refuel();
  const [g1] = guaranteedStationChunks(seed);
  const st = stationAt(seed, g1.cx, g1.cy);
  if (!st) return { seed, penalty, run: 0, moves, tick: d.state.tick, stuck: false, attempts: [], state: 'no G1', reached: false };
  d.undock();
  const docked = d.dockAt(st, 300);
  moves.push(docked ? `flew to ${st.id} (${st.kind}) and docked` : `could not reach ${st.id}: ${describe(d)}`);
  if (docked) d.refuel();
  for (let i = 0; i < 6 && d.state.player.props.thrust.forward > 0 && d.state.player.dock.mode !== 'docking'; i++) {
    const hit = ram(d, true, 45);
    moves.push(`ram stern first: ${hit ? 'hit' : 'missed'} → ${d.state.player.grid.parts.map((x) => keyOf(x)).join(',')}`);
    if (d.state.player.dock.mode === 'docked') break;
  }
  const engineLoans = d.kitParts[LOAN_ENGINE_KEY] ?? 0;
  const engineless = d.state.player.props.thrust.forward <= 0;
  if (d.state.player.dock.mode === 'flying' && towAvailable(d.state.player)) {
    d.tow();
    moves.push(`tow → ${d.docked()?.id}`);
  }
  const at = d.docked();
  // the state is reached when the ship arrived there without a forward engine (the Guild may have lent
  // one in the arrival step already)
  const lent = (d.kitParts[LOAN_ENGINE_KEY] ?? 0) > engineLoans;
  if (lent) moves.push(`Guild loan at ${at?.id}: ${JSON.stringify(d.kitParts)}`);
  const reached = !!at && at.id !== HOME_STATION_ID && at.services.shipyard && engineless && (d.state.player.props.thrust.forward <= 0 || lent);
  const o = oracle(d.sim, oracleBudget);
  return { seed, penalty, run: 0, moves, tick: d.state.tick, stuck: o.stuck, attempts: o.attempts, state: describe(d), reached };
}

// ------------------------------------------------------------------------------------------------
// targeted: a spare engine stored at another station blocks the home emergency kit

export function spareEngineElsewhere(seed: number, penalty: DeathPenalty, oracleBudget = 40 * 60): TargetedResult {
  const d = new Driver(newGame(seed, penalty));
  const moves: string[] = [];
  const [g1] = guaranteedStationChunks(seed);
  const st = stationAt(seed, g1.cx, g1.cy);
  if (!st) return { seed, penalty, run: 0, moves, tick: d.state.tick, stuck: false, attempts: [], state: 'no G1', reached: false };
  d.undock();
  if (!d.dockAt(st, 300)) return { seed, penalty, run: 0, moves: ['could not reach G1'], tick: d.state.tick, stuck: false, attempts: [], state: describe(d), reached: false };
  // leave one forward engine in the G1 storage
  const fwd = d.state.player.grid.parts.filter((p) => p.partId === 'engine' && p.rot === 0);
  const left = fwd.length > 1 && d.commit([{ op: 'remove', id: fwd[0]!.id }]);
  moves.push(`at ${st.id}: ${left ? 'stored a forward engine' : 'could not store an engine'}`);
  d.refuel();
  d.undock();
  const home = d.dockAt(homeStation(), 300);
  moves.push(home ? 'flew home' : `could not fly home: ${describe(d)}`);
  // sell everything else at home (the stored engine stays at G1) and burn the credits
  liquidate(d);
  d.refuel();
  moves.push(`liquidated at home → credits ${d.state.credits}, ship ${d.state.player.grid.parts.map((x) => keyOf(x)).join(',')}`);
  for (let i = 0; i < 6 && d.state.player.props.thrust.forward > 0 && d.state.player.dock.mode !== 'docking'; i++) {
    const hit = ram(d, true, 45);
    moves.push(`ram stern first: ${hit ? 'hit' : 'missed'} → ${d.state.player.grid.parts.map((x) => keyOf(x)).join(',')}`);
    if (d.state.player.dock.mode === 'docked') break;
  }
  const engineless = d.state.player.props.thrust.forward <= 0;
  if (d.state.player.dock.mode === 'flying' && towAvailable(d.state.player)) {
    d.tow();
    moves.push(`tow → ${d.docked()?.id}`);
  }
  // the Guild lends in the first docked step
  d.idle(2);
  const at = d.docked();
  const spareLeft = (d.state.stations.get(st.id)?.parts['engine:1'] ?? 0) > 0;
  const reached = at?.id === HOME_STATION_ID && engineless && spareLeft;
  moves.push(`engine loans at home with the spare engine still at ${st.id}: ${d.kitParts[LOAN_ENGINE_KEY] ?? 0}`);
  const o = oracle(d.sim, oracleBudget);
  return { seed, penalty, run: 0, moves, tick: d.state.tick, stuck: o.stuck, attempts: o.attempts, state: describe(d), reached };
}
