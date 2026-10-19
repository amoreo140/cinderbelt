// Guild Training (M3.7): the onboarding state machine. Every step is detected from the simulation
// state and its events, pays its reward once (the step index only moves forward), never blocks the
// game and can be skipped. Reward parts are normal parts in a station storage; when a reward the
// player needs for an install step is gone (sold, lost), the Guild mounts a loan part instead –
// a loan has no value (ship/loan.ts), so the training can never be farmed.
import { RECIPES } from '../../data/economy';
import { parsePartKey, partKey, type PartId, type PartInventory, type PartKey } from '../../data/parts';
import { RESOURCE_IDS } from '../../data/resources';
import {
  CHECK_MAP,
  CHECK_OBJECTIVES,
  CHECK_REFUEL,
  FLAG_SOLD,
  TRAINING_STEPS,
  TRAINING_STEP_COUNT,
  BRAKE_REACH,
  BRAKE_SPEED,
  BUOY_REACH,
  stepIndex,
  type TrainingStepDef,
} from '../../data/training';
import type { GameAction } from '../commands';
import { mergeInventory } from '../combat/combat';
import { addPoints } from '../factions/reputation';
import { length } from '../math/vec2';
import type { SimEvent, SimState } from '../Simulation';
import { createStarterShip } from '../ship/presets';
import { computeProperties, type ShipProperties } from '../ship/properties';
import type { PlacedPart, Rotation, ShipGrid } from '../ship/types';
import { blockedOutputs } from '../shipyard/design';
import { applyEditorOp } from '../shipyard/editor';
import { dockPose, rebuiltDockPose } from '../station/dock';
import { freeNeighbours } from '../station/guildLoan';
import { availableResources, ensureStorage, stationStorage } from '../station/storage';
import { HOME_STATION_ID, homeStation, stationById, type StationDef, type StationId } from '../world/stations';
import { discoverSectorStations } from '../charts/charts';
import { trainingChartSector } from '../regions/knowledge';
import { createTrainingHull, pickTrainingSites } from './sites';
import type { TrainingEvent, TrainingState } from './types';

/** No training (a game started with "Skip training", tests, the balance bot). */
export const createTraining = (): TrainingState => ({ status: 'skipped', step: 0, base: 0, flags: 0, rewardAt: HOME_STATION_ID, sites: null });

/** An old save (V9 and older): the player already plays – the training counts as done. */
export const legacyTraining = (): TrainingState => ({ status: 'done', step: TRAINING_STEP_COUNT, base: 0, flags: 0, rewardAt: HOME_STATION_ID, sites: null });

export const currentTrainingStep = (t: TrainingState): TrainingStepDef | null => (t.status === 'active' ? (TRAINING_STEPS[t.step] ?? null) : null);

export const trainingActive = (state: SimState): boolean => state.career.training.status === 'active';

const station = (state: SimState, id: StationId): StationDef | null => stationById(state.seed, id);

/** Counter base at the start of a step. */
function baseFor(state: SimState, step: TrainingStepDef | null): number {
  return step?.id === 'mineIron' ? state.stats.mined.iron : 0;
}

const isCargoPart = (id: PartId): boolean => id === 'cargo' || id === 'largeCargo';
const countParts = (grid: ShipGrid, match: (p: PlacedPart) => boolean): number => grid.parts.filter(match).length;
const forwardEngines = (grid: ShipGrid): number => countParts(grid, (p) => p.partId === 'engine' && p.rot === 0);
/** Engines pushing backwards (the nozzle towards the bow). */
export const reverseEngines = (grid: ShipGrid): number => countParts(grid, (p) => p.partId === 'engine' && p.rot === 2);

/** The four things the last step checks: reactor, radar, gyroscope, two forward engines. */
export function finishChecks(grid: ShipGrid): { reactor: boolean; radar: boolean; gyro: boolean; engines: boolean } {
  return {
    reactor: countParts(grid, (p) => p.partId === 'reactor') > 0,
    radar: countParts(grid, (p) => p.partId === 'radar') > 0,
    gyro: countParts(grid, (p) => p.partId === 'gyro') > 0,
    engines: forwardEngines(grid) >= 2,
  };
}

const popcount = (n: number): number => (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1);

/** Progress of the current step (0 … amount). */
export function trainingProgress(state: SimState): number {
  const t = state.career.training;
  const step = currentTrainingStep(t);
  if (!step || !t.sites) return 0;
  const { player } = state;
  const flying = player.dock.mode === 'flying' && !player.destroyed;
  const pos = player.body.pos;
  switch (step.id) {
    case 'flyBuoy':
      return flying && Math.hypot(pos.x - t.sites.buoyA.x, pos.y - t.sites.buoyA.y) <= BUOY_REACH ? 1 : 0;
    case 'mineIron':
      return Math.min(step.amount, Math.max(0, state.stats.mined.iron - t.base));
    case 'dockSell':
      return t.flags & FLAG_SOLD ? 1 : 0;
    case 'installSide':
      return (player.props.thrust.left > 0 ? 1 : 0) + (player.props.thrust.right > 0 ? 1 : 0);
    case 'brakeBuoy':
      return flying && Math.hypot(pos.x - t.sites.buoyB.x, pos.y - t.sites.buoyB.y) <= BRAKE_REACH && length(player.body.vel) <= BRAKE_SPEED ? 1 : 0;
    case 'installReverse':
      return Math.min(step.amount, reverseEngines(player.grid));
    case 'craftCargo':
      return Math.min(step.amount, countParts(player.grid, (p) => isCargoPart(p.partId)));
    case 'checklist':
      return popcount(t.flags & (CHECK_REFUEL | CHECK_MAP | CHECK_OBJECTIVES));
    case 'finishShip':
      return Object.values(finishChecks(player.grid)).filter(Boolean).length;
  }
}

/** The station a reward goes to: the dock with a shipyard, else the last one, else home. */
function rewardStation(state: SimState): StationId {
  const dock = state.player.dock;
  if (dock.mode === 'docked' && station(state, dock.stationId)?.services.shipyard) return dock.stationId;
  if (station(state, state.respawn.stationId)?.services.shipyard) return state.respawn.stationId;
  return HOME_STATION_ID;
}

function complete(state: SimState, out: SimEvent[]): void {
  const t = state.career.training;
  const step = currentTrainingStep(t)!;
  const { reward } = step;
  const at = rewardStation(state);
  const credits = reward.credits + (reward.kit?.credits ?? 0);
  if (credits > 0) {
    state.credits += credits;
    out.push({ type: 'creditsChanged', delta: credits, reason: 'contract' });
  }
  for (const level of addPoints(state.career.rep, 'guild', reward.rep)) out.push({ type: 'repLevelUp', faction: 'guild', level });
  const gives = Object.keys(reward.parts).length > 0 || reward.kit !== undefined;
  if (gives) {
    const storage = ensureStorage(state, at);
    mergeInventory(storage.parts, reward.parts);
    for (const r of RESOURCE_IDS) storage.resources[r] += reward.kit?.resources[r] ?? 0;
    t.rewardAt = at;
  }
  const index = t.step;
  t.step++;
  t.flags = 0;
  if (step.id === 'checklist') grantTrainingChart(state, out);
  const next = currentTrainingStep(t);
  if (!next) t.status = 'done';
  t.base = baseFor(state, next);
  out.push({ type: 'trainingStep', step: step.id, index, credits, parts: { ...reward.parts }, kit: reward.kit !== undefined, stationId: at, done: t.status === 'done' });
}

// ---------------------------------------------------------------------------
// loans for lost rewards

/** Parts the player owns off the hull: every station storage, salvage on board, courier shipments. */
function ownsSpare(state: SimState, match: (id: PartId) => boolean): boolean {
  const inventories: PartInventory[] = [...[...state.stations.values()].map((s) => s.parts), state.player.salvage, ...state.career.shipments.map((s) => s.parts)];
  return inventories.some((inv) => Object.entries(inv).some(([key, n]) => (n ?? 0) > 0 && match(parsePartKey(key as PartKey).partId)));
}

/**
 * Cells next to the hull where a part `key` with rotation `rot` can be placed and `works` holds –
 * the ones that block no exhaust or laser first, nearest to the middle of the ship first. The
 * shipyard guidance highlights them; a loan goes to the first one.
 */
export function placementCells(grid: ShipGrid, key: PartKey, rot: Rotation, works: (props: ShipProperties) => boolean): { x: number; y: number; clean: boolean; grid: ShipGrid }[] {
  const blockedBefore = blockedOutputs(grid).length;
  const cells = freeNeighbours(grid).sort((a, b) => Math.abs(a.x) + Math.abs(a.y) - (Math.abs(b.x) + Math.abs(b.y)) || a.x - b.x || a.y - b.y);
  const out: { x: number; y: number; clean: boolean; grid: ShipGrid }[] = [];
  for (const c of cells) {
    const r = applyEditorOp(grid, { op: 'place', key, x: c.x, y: c.y, rot });
    if (!r.ok || !works(computeProperties(r.grid))) continue;
    out.push({ x: c.x, y: c.y, clean: blockedOutputs(r.grid).length <= blockedBefore, grid: r.grid });
  }
  return [...out.filter((c) => c.clean), ...out.filter((c) => !c.clean)];
}

/** Mounts a loan part (see placementCells) – null when it fits nowhere. */
export function mountTrainingLoan(grid: ShipGrid, key: PartKey, rot: Rotation, works: (props: ShipProperties) => boolean): ShipGrid | null {
  const best = placementCells(grid, key, rot, works)[0];
  if (!best) return null;
  return { nextId: best.grid.nextId, parts: best.grid.parts.map((p) => (p.id === grid.nextId ? { ...p, loan: true as const } : p)) };
}

/** A new hull at the dock (loan or the Guild's fitting): properties, pose, tank, battery, shield. */
function applyHull(state: SimState, at: StationDef, grid: ShipGrid): void {
  const { player } = state;
  const oldCoM = player.props.centerOfMass;
  const props = computeProperties(grid);
  player.grid = grid;
  player.gridVersion++;
  player.props = props;
  player.fuel = Math.min(player.fuel, props.fuelCapacity);
  player.energy = props.batteryCapacity;
  player.shield = props.shield.capacity;
  player.body = rebuiltDockPose(at, player.body, oldCoM, props.centerOfMass, props.boundingRadius);
  player.prevBody = player.body;
  const ids = new Set(grid.parts.map((p) => p.id));
  for (const id of [...player.hp.keys()]) if (!ids.has(id)) player.hp.delete(id);
}

interface LoanNeed {
  key: PartKey;
  rot: Rotation;
  works: (props: ShipProperties) => boolean;
}

/** What the Guild lends at an install step whose reward is gone (empty = nothing). */
function loanNeeds(state: SimState, step: TrainingStepDef, at: StationDef): LoanNeed[] {
  const { player } = state;
  const t = player.props.thrust;
  const engine = (id: PartId) => id === 'engine';
  switch (step.id) {
    case 'installSide': {
      if (ownsSpare(state, engine)) return [];
      const out: LoanNeed[] = [];
      if (t.left <= 0) out.push({ key: 'engine:1', rot: 1, works: (p) => p.thrust.left > 0 });
      if (t.right <= 0) out.push({ key: 'engine:1', rot: 3, works: (p) => p.thrust.right > 0 });
      return out;
    }
    case 'installReverse': {
      if (ownsSpare(state, engine)) return [];
      const out: LoanNeed[] = [];
      for (let i = reverseEngines(player.grid); i < step.amount; i++) out.push({ key: 'engine:1', rot: 2, works: (p) => p.thrust.backward > t.backward });
      return out;
    }
    case 'craftCargo': {
      if (countParts(player.grid, (p) => isCargoPart(p.partId)) >= step.amount || ownsSpare(state, isCargoPart)) return [];
      const recipe = RECIPES['cargo:1'];
      const have = availableResources(state, at.id);
      const canCraft = at.services.crafting && state.credits >= recipe.credits && RESOURCE_IDS.every((r) => have[r] + 1e-9 >= (recipe.resources[r] ?? 0));
      return canCraft ? [] : [{ key: 'cargo:1', rot: 0, works: () => true }];
    }
    case 'finishShip': {
      const checks = finishChecks(player.grid);
      const out: LoanNeed[] = [];
      for (const id of ['reactor', 'radar', 'gyro'] as const) {
        if (!checks[id] && !ownsSpare(state, (x) => x === id)) out.push({ key: partKey(id, 1), rot: 0, works: () => true });
      }
      if (!checks.engines && !ownsSpare(state, engine)) {
        for (let i = forwardEngines(player.grid); i < 2; i++) out.push({ key: 'engine:1', rot: 0, works: () => true });
      }
      return out;
    }
    default:
      return [];
  }
}

/**
 * At an install step the reward the player needs is nowhere (sold, lost): the Guild mounts a loan
 * part while the ship is docked at a shipyard. When even a loan does not fit, the step is let go.
 */
function lendMissing(state: SimState, step: TrainingStepDef, out: SimEvent[]): 'lent' | 'stuck' | null {
  const { player } = state;
  if (player.dock.mode !== 'docked' || player.destroyed) return null;
  const at = station(state, player.dock.stationId);
  if (!at?.services.shipyard) return null;
  const needs = loanNeeds(state, step, at);
  if (needs.length === 0) return null;
  let grid = player.grid;
  const lent: PartInventory = {};
  for (const need of needs) {
    const next = mountTrainingLoan(grid, need.key, need.rot, need.works);
    if (!next) continue;
    grid = next;
    lent[need.key] = (lent[need.key] ?? 0) + 1;
  }
  if (grid === player.grid) return 'stuck';
  applyHull(state, at, grid);
  out.push({ type: 'guildLoan', stationId: at.id, parts: lent });
  return 'lent';
}

/** Called every step after the career (sim/career/career.ts): flags, loans, step completion. */
export function stepTraining(state: SimState, events: readonly SimEvent[]): SimEvent[] {
  const t = state.career.training;
  const step = currentTrainingStep(t);
  if (!step || !t.sites) return [];
  const out: SimEvent[] = [];
  const { player } = state;
  const docked = player.dock.mode === 'docked';
  if (step.id === 'dockSell') {
    if (events.some((e) => e.type === 'creditsChanged' && e.reason === 'sell' && e.delta > 0)) t.flags |= FLAG_SOLD;
    // docked with nothing to sell (towed without cargo …): the step lets go instead of blocking
    if (docked) {
      const res = availableResources(state, player.dock.mode === 'docked' ? player.dock.stationId : HOME_STATION_ID);
      if (RESOURCE_IDS.every((r) => res[r] < 0.5)) t.flags |= FLAG_SOLD;
    }
  }
  // a full tank at the dock needs no refuelling
  if (step.id === 'checklist' && docked && player.fuel >= player.props.fuelCapacity - 0.01) t.flags |= CHECK_REFUEL;
  if (trainingProgress(state) < step.amount && lendMissing(state, step, out) === 'stuck') {
    complete(state, out);
    return out;
  }
  if (trainingProgress(state) >= step.amount) complete(state, out);
  return out;
}

/** A successful station action (sim/career/career.ts → careerOnStationAction). */
export function trainingOnAction(state: SimState, action: GameAction): void {
  const step = currentTrainingStep(state.career.training);
  if (step?.id === 'checklist' && action.type === 'refuel') state.career.training.flags |= CHECK_REFUEL;
}

/** The UI reports what the player looked at: the map (M) or the objectives panel (G). */
export function trainingSeen(state: SimState, what: 'map' | 'objectives'): boolean {
  const step = currentTrainingStep(state.career.training);
  if (step?.id !== 'checklist') return false;
  state.career.training.flags |= what === 'map' ? CHECK_MAP : CHECK_OBJECTIVES;
  return true;
}

/**
 * The checklist reward (sectors §6.6, stage 2) also charts lane A's first sector: its chart was
 * withheld while the training ran (regions/knowledge.ts `trainingWithholds`); its stations become
 * discovered. Also on a skip before that step.
 */
function grantTrainingChart(state: SimState, out: SimEvent[]): void {
  const id = trainingChartSector(state.seed);
  if (!id) return;
  out.push({ type: 'chartGranted', id });
  discoverSectorStations(state, id, out);
}

// ---------------------------------------------------------------------------
// start and skip

/**
 * Turns a fresh new game into a training game: the training hull at the home dock, an empty home
 * storage (armor and the cannon come with a reward) and the sites picked from the world around home.
 */
export function beginTraining(state: SimState): void {
  const home = homeStation();
  const grid = createTrainingHull();
  const props = computeProperties(grid);
  const body = dockPose(home, props.boundingRadius);
  const { player } = state;
  player.grid = grid;
  player.gridVersion++;
  player.props = props;
  player.hp = new Map();
  player.body = body;
  player.prevBody = body;
  player.fuel = props.fuelCapacity;
  player.energy = props.batteryCapacity;
  player.shield = props.shield.capacity;
  player.dock = { mode: 'docked', stationId: home.id };
  player.blueprint = grid;
  state.respawn = { stationId: home.id, grid };
  ensureStorage(state, home.id).parts = {};
  state.world.update(body.pos);
  const sites = pickTrainingSites(home.pos, home.portAngle, state.world.asteroids(), (a) => state.world.radiusOf(a));
  state.career.training = { status: 'active', step: 0, base: 0, flags: 0, rewardAt: home.id, sites };
  state.career.training.base = baseFor(state, currentTrainingStep(state.career.training));
}

/** The parts of every reward not paid yet (the crafting kit as the cargo hold itself). */
export function remainingRewardParts(t: TrainingState): PartInventory {
  const out: PartInventory = {};
  if (t.status !== 'active') return out;
  for (const step of TRAINING_STEPS.slice(t.step)) {
    mergeInventory(out, step.reward.parts);
    if (step.reward.kit) out['cargo:1'] = (out['cargo:1'] ?? 0) + 1;
  }
  return out;
}

const keyOf = (p: PlacedPart): PartKey => partKey(p.partId, p.tier, p.variant);

/**
 * The Guild fits the starter ship from the parts on the hull and in this station's storage (damaged
 * parts are kept with their HP, parts off the hull go to the storage). Nothing happens when a part
 * is missing or a damaged part would end up in the storage.
 */
export function assembleStarter(state: SimState, at: StationDef): boolean {
  const { player } = state;
  const storage = ensureStorage(state, at.id);
  const target = createStarterShip();
  const hull = [...player.grid.parts];
  const stock: PartInventory = { ...storage.parts };
  let nextId = player.grid.nextId;
  const parts: PlacedPart[] = [];
  for (const slot of target.parts) {
    const key = keyOf(slot);
    const i = hull.findIndex((p) => keyOf(p) === key);
    if (i >= 0) {
      const [own] = hull.splice(i, 1);
      parts.push({ ...slot, id: own!.id, ...(own!.loan ? { loan: true as const } : {}) });
    } else if ((stock[key] ?? 0) > 0) {
      stock[key] = stock[key]! - 1;
      parts.push({ ...slot, id: nextId++ });
    } else return false;
  }
  // leftovers go to the storage – a damaged one would be repaired for free there
  if (hull.some((p) => !p.loan && player.hp.has(p.id))) return false;
  for (const p of hull) if (!p.loan) stock[keyOf(p)] = (stock[keyOf(p)] ?? 0) + 1;
  storage.parts = Object.fromEntries(Object.entries(stock).filter(([, n]) => (n ?? 0) > 0)) as PartInventory;
  const grid: ShipGrid = { parts, nextId };
  applyHull(state, at, grid);
  player.blueprint = grid;
  return true;
}

/**
 * Skips the rest of the training: the parts of the rewards not paid yet go to the reward station
 * (no credits – those pay the steps); docked at a shipyard, the Guild fits the starter ship at once.
 */
export function skipTraining(state: SimState): TrainingEvent | null {
  const t = state.career.training;
  if (t.status !== 'active') return null;
  const parts = remainingRewardParts(t);
  const at = rewardStation(state);
  mergeInventory(ensureStorage(state, at).parts, parts);
  const withheld = t.step <= stepIndex('checklist');
  t.status = 'skipped';
  t.flags = 0;
  t.base = 0;
  t.rewardAt = at;
  const { player } = state;
  const dockDef = player.dock.mode === 'docked' && player.dock.stationId === at ? station(state, at) : null;
  const assembled = dockDef !== null && !player.destroyed && assembleStarter(state, dockDef);
  if (withheld) {
    // the skip pays the checklist's chart too; its station discoveries go to the world (no events here)
    discoverSectorStations(state, trainingChartSector(state.seed) ?? '', []);
  }
  return { type: 'trainingSkipped', stationId: at, parts, assembled };
}

/** Storage of the reward station (for the UI: are the reward parts still there?). */
export const rewardStorage = (state: SimState): PartInventory => stationStorage(state, state.career.training.rewardAt).parts;
