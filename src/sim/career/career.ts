// The career in the simulation (M3.5a): actions (accept, cancel, hand in, assignment, courier, "First
// Day"), the step (contract progress, captains, courier, board, log) and the F interaction at a contract target.
import { CAPTAIN_KILL_RANGE, TRAITS } from '../../data/captains';
import { INTERACT_RANGE } from '../../data/contracts';
import type { RepFactionId } from '../../data/factions';
import { ALL_PART_KEYS, partKey, type PartKey } from '../../data/parts';
import { RESOURCE_IDS } from '../../data/resources';
import { captainDef, captainIndexOf, captainLevel, createCaptainEnemy } from '../captains/captains';
import { createEnemy, huntGroupSlots } from '../combat/enemies';
import type { Enemy } from '../combat/types';
import type { GameAction } from '../commands';
import { abandon, acceptOffer, boardEpoch, ensureBoard, refillBoard } from '../contracts/board';
import { deliverShipments, sendShipment } from '../courier/courier';
import { addPoints, createRep, deliverAssignment, hasUnlock, promote, recordContract, recordDelivery } from '../factions/reputation';
import { createTraining, currentTrainingStep, skipTraining, stepTraining, trainingOnAction, trainingSeen } from '../training/training';
import { hash3 } from '../world/hash';
import { hypot, type Vec2 } from '../math/vec2';
import { hullHp } from '../ship/hp';
import type { ActionError } from '../station/actions';
import { availableResources, addParts, ensureStorage, RES_EPS, stationStorage, takeResources } from '../station/storage';
import { gainData } from '../discovery/state';
import { awardFragment } from '../discovery/plans';
import type { SimEvent, SimState } from '../Simulation';
import type { StationDef } from '../world/stations';
import { escortDeposit, escortRefund, escortSpawns, stepEscortContracts } from '../convoys/escort';
import { interactRelay, relayInteraction, relaySpawns, stepRelayContracts } from '../guild/relayChain';
import type { RelayInteraction } from '../guild/types';
import { LOG_MAX, type CareerState, type Contract, type ContractFailReason, type ContractOutcome, type LogEntry } from './types';

export function createCareer(): CareerState {
  return {
    nextId: 1,
    contracts: [],
    boards: new Map(),
    rep: createRep(),
    captains: new Map(),
    engaged: new Map(),
    shipments: [],
    training: createTraining(),
    demandSold: new Map(),
    completed: {},
    trophies: [],
    log: [],
  };
}

const CAREER_ACTIONS = new Set<GameAction['type']>([
  'acceptContract',
  'abandonContract',
  'turnInContract',
  'deliverAssignment',
  'courierSend',
  'trainingSkip',
  'trainingSeen',
]);

export const isCareerAction = (a: GameAction): boolean => CAREER_ACTIONS.has(a.type);

function log(state: SimState, entry: LogEntry): void {
  const list = state.career.log;
  list.push(entry);
  if (list.length > LOG_MAX) list.splice(0, list.length - LOG_MAX);
}

const fail = (reqId: number, reason: ActionError): SimEvent[] => [{ type: 'actionResult', reqId, ok: false, reason }];
const ok = (reqId: number): SimEvent => ({ type: 'actionResult', reqId, ok: true });

/** A career action; `station` = the station the ship is docked at (null in flight). */
export function careerAction(state: SimState, station: StationDef | null, action: GameAction): SimEvent[] {
  const { reqId } = action;
  const career = state.career;
  switch (action.type) {
    case 'acceptContract': {
      if (!station) return fail(reqId, 'notDocked');
      const result = acceptOffer(state, station, action.offerId);
      if (typeof result === 'string') return fail(reqId, result);
      log(state, { tick: state.tick, kind: 'contractAccepted', type: result.type, station: result.station });
      // the escort deposit (M4d, convoys/escort.ts)
      return [ok(reqId), { type: 'contractAccepted', contractId: result.serial }, ...escortDeposit(state, result)];
    }
    case 'abandonContract': {
      const contract = career.contracts.find((c) => c.serial === action.contractId);
      const result = abandon(state, action.contractId);
      if (!result || !contract) return fail(reqId, 'contractUnavailable');
      log(state, { tick: state.tick, kind: 'contractAbandoned', type: contract.type, station: contract.station });
      // the escort deposit back on a free cancel, else lost (M4d, convoys/escort.ts)
      return [ok(reqId), { type: 'contractAbandoned', contractId: action.contractId, refunded: result.refunded }, ...escortRefund(state, contract, result.refunded)];
    }
    case 'turnInContract': {
      if (!station) return fail(reqId, 'notDocked');
      return turnIn(state, station, action.contractId, reqId);
    }
    case 'deliverAssignment': {
      if (!station) return fail(reqId, 'notDocked');
      return deliverForAssignment(state, station, action.faction, reqId);
    }
    case 'courierSend': {
      const before = state.credits;
      const result = sendShipment(state, action.from, action.to, action.resources, action.parts, hasUnlock(career.rep, 'courier'));
      if (typeof result === 'string') return fail(reqId, result);
      return [ok(reqId), { type: 'creditsChanged', delta: state.credits - before, reason: 'courier' }];
    }
    case 'trainingSkip': {
      const skipped = skipTraining(state);
      return skipped ? [ok(reqId), skipped] : fail(reqId, 'contractUnavailable');
    }
    case 'trainingSeen':
      return trainingSeen(state, action.what) ? [ok(reqId)] : fail(reqId, 'contractUnavailable');
    default:
      return fail(reqId, 'serviceUnavailable');
  }
}

/** Can the contract be handed in at this station? (Delivery: the destination with the resources.) */
export function canTurnIn(state: SimState, station: StationDef, c: Contract): boolean {
  if (c.target.kind === 'delivery') {
    return station.id === c.target.to && availableResources(state, station.id)[c.target.resource] + RES_EPS >= c.target.amount;
  }
  // Retrieval: the part from the wreck must lie in the station storage (it moves there from the ship on docking)
  if (c.target.kind === 'retrieve') return c.ready && (stationStorage(state, station.id).parts[c.target.part] ?? 0) >= 1;
  return c.ready;
}

function turnIn(state: SimState, station: StationDef, serial: number, reqId: number): SimEvent[] {
  const career = state.career;
  const index = career.contracts.findIndex((c) => c.serial === serial);
  const c = career.contracts[index];
  if (!c) return fail(reqId, 'contractUnavailable');
  if (c.target.kind === 'delivery' && station.id !== c.target.to) return fail(reqId, 'notAtDestination');
  if (!canTurnIn(state, station, c)) {
    if (c.target.kind === 'retrieve' && c.ready) return fail(reqId, 'notEnoughParts');
    return fail(reqId, c.target.kind === 'delivery' ? 'notEnoughResources' : 'contractNotReady');
  }
  if (c.target.kind === 'delivery') takeResources(state, station.id, { [c.target.resource]: c.target.amount });
  if (c.target.kind === 'retrieve') addParts(ensureStorage(state, station.id).parts, c.target.part, -1);
  // the reward covers the chart's sale – the Guild has the chart now (sectors §4.3, §4.4)
  if (c.target.kind === 'chart') state.regions.sold.add(c.target.sector);
  career.contracts.splice(index, 1);
  state.credits += c.reward;
  if (c.part) addParts(ensureStorage(state, station.id).parts, c.part, 1);
  career.completed[c.type] = (career.completed[c.type] ?? 0) + 1;
  const events: SimEvent[] = [ok(reqId), { type: 'creditsChanged', delta: c.reward, reason: 'contract' }];
  recordContract(career.rep, c.type, c.ring);
  for (const level of addPoints(career.rep, c.faction, c.rep)) events.push({ type: 'repLevelUp', faction: c.faction, level });
  // the other faction's assignments (e.g. a hunt for the Guild, a survey for the Institute) may be met too
  const other: RepFactionId = c.faction === 'guild' ? 'institute' : 'guild';
  for (const level of promote(career.rep, other)) events.push({ type: 'repLevelUp', faction: other, level });
  // the Institute pays in Data too; a Retrieval adds a fragment of a specific blueprint (M3.5b)
  if (c.data) gainData(state, c.data, 'contract', events);
  if (c.target.kind === 'retrieve') awardFragment(state, c.target.plan, events);
  events.push({ type: 'contractCompleted', contractId: c.serial, reward: c.reward, rep: c.rep, part: c.part });
  log(state, { tick: state.tick, kind: 'contractCompleted', type: c.type, station: c.station });
  for (const e of events) if (e.type === 'repLevelUp') log(state, { tick: state.tick, kind: 'levelUp', faction: e.faction, level: e.level });
  refillBoard(state, c.station);
  return events;
}

function deliverForAssignment(state: SimState, station: StationDef, faction: RepFactionId, reqId: number): SimEvent[] {
  const rep = state.career.rep[faction];
  const a = deliverAssignment(rep, faction);
  if (!a) return fail(reqId, 'contractUnavailable');
  const missing = a.amount - (rep.assignments[a.id] ?? 0);
  const amount = Math.min(missing, Math.floor(availableResources(state, station.id)[a.resource] + RES_EPS));
  if (amount <= 0) return fail(reqId, 'notEnoughResources');
  takeResources(state, station.id, { [a.resource]: amount });
  recordDelivery(rep, a, a.resource, amount);
  const events: SimEvent[] = [ok(reqId)];
  for (const level of promote(state.career.rep, faction)) {
    events.push({ type: 'repLevelUp', faction, level });
    log(state, { tick: state.tick, kind: 'levelUp', faction, level });
  }
  return events;
}

/** A successful station action – the Guild Training (refuelling). */
export function careerOnStationAction(state: SimState, action: GameAction): void {
  trainingOnAction(state, action);
}

// ---------------------------------------------------------------------------
// the F interaction at a contract target

export type Interaction =
  | { kind: 'buoy'; contract: number; index: number; pos: Vec2 }
  | { kind: 'rescue'; contract: number; pos: Vec2; fuel: number }
  /** Repair of a broken Guild relay mast (M4d, guild/relayChain.ts). */
  | RelayInteraction;

/** Radius of the stranded ship (a trader ~13.6 u). */
export const RESCUE_SHIP_RADIUS = 7;

/** The nearest interaction in reach (a survey point, a stranded ship, a Guild relay mast), or null. */
export function careerInteraction(state: SimState): Interaction | null {
  const { player } = state;
  const pos = player.body.pos;
  const reach = player.props.boundingRadius + INTERACT_RANGE;
  let best: Interaction | null = null;
  let bestD = Infinity;
  for (const c of state.career.contracts) {
    if (c.ready) continue;
    const t = c.target;
    if (t.kind === 'survey') {
      const p = t.points[c.progress];
      const d = p ? hypot(p.x - pos.x, p.y - pos.y) : Infinity;
      if (p && d <= reach && d < bestD) {
        best = { kind: 'buoy', contract: c.serial, index: c.progress, pos: p };
        bestD = d;
      }
    } else if (t.kind === 'rescue') {
      const d = hypot(t.pos.x - pos.x, t.pos.y - pos.y) - RESCUE_SHIP_RADIUS;
      if (d <= reach && d < bestD) {
        best = { kind: 'rescue', contract: c.serial, pos: t.pos, fuel: t.fuel };
        bestD = d;
      }
    }
  }
  // the broken Guild relay mast of a relay contract (M4d) – it decides its own reach
  const relay = relayInteraction(state);
  if (relay && hypot(relay.pos.x - pos.x, relay.pos.y - pos.y) < bestD) best = relay;
  return best;
}

function markReady(c: Contract, events: SimEvent[]): void {
  if (c.ready) return;
  c.ready = true;
  events.push({ type: 'contractReady', contractId: c.serial });
}

export function interact(state: SimState, it: Interaction): SimEvent[] {
  const c = state.career.contracts.find((x) => x.serial === it.contract);
  if (!c) return [];
  if (it.kind === 'relayRepair') return interactRelay(state, it);
  const events: SimEvent[] = [];
  if (it.kind === 'buoy') {
    c.progress++;
    events.push({ type: 'buoyDeployed', contractId: c.serial, index: it.index, pos: { ...it.pos } });
    if (c.target.kind === 'survey' && c.progress >= c.target.points.length) markReady(c, events);
    return events;
  }
  if (state.player.fuel < it.fuel) return [{ type: 'interactFailed', contractId: c.serial, reason: 'notEnoughFuel' }];
  state.player.fuel -= it.fuel;
  c.progress = 1;
  events.push({ type: 'rescueFueled', contractId: c.serial, fuel: it.fuel });
  markReady(c, events);
  return events;
}

// ---------------------------------------------------------------------------
// enemies from contracts (the hunted group, a captain; M4d escort ambushes, the relay counterattack)

export interface CareerSpawn {
  id: string;
  pos: Vec2;
  create(): Enemy;
}

/** Enemies the contracts need (the spawn adds them when the player is in range). */
export function careerSpawns(state: SimState): CareerSpawn[] {
  const out: CareerSpawn[] = [];
  for (const c of state.career.contracts) {
    if (c.ready) continue;
    const t = c.target;
    if (t.kind === 'hunt') {
      // exactly the contract's group, whatever the chunk's chance is now (sectors, a fallen fortress)
      for (const slot of huntGroupSlots(state.seed, t.cx, t.cy, t.slots)) out.push({ id: slot.id, pos: slot.pos, create: () => createEnemy(slot) });
    } else if (t.kind === 'captain') {
      const def = captainDef(state.seed, t.captain);
      if (!def) continue;
      const level = captainLevel(def, state.career.captains.get(t.captain));
      out.push({ id: `cap:${t.captain}`, pos: t.pos, create: () => createCaptainEnemy(t.captain, level, t.pos, (t.captain * 0.7) % 6.28) });
    }
  }
  // M4d: the escort ambush parties and the relay hold's Rust counterattack
  out.push(...escortSpawns(state), ...relaySpawns(state));
  return out;
}

const hullFraction = (e: Enemy): number => (e.maxHull > 0 ? hullHp(e.grid, e.hp).current / e.maxHull : 1);

function captainState(state: SimState, index: number) {
  let s = state.career.captains.get(index);
  if (!s) {
    s = { promotions: 0, defeated: false, trophies: [], kills: 0 };
    state.career.captains.set(index, s);
  }
  return s;
}

/** Replicas of the player's parts for a captain's trophy (deterministic by the tick). */
function replicaParts(state: SimState, index: number, count: number): PartKey[] {
  const parts = state.player.grid.parts.filter((p) => p.partId !== 'cockpit');
  const out: PartKey[] = [];
  for (let i = 0; i < count && parts.length > 0; i++) {
    const p = parts[hash3(state.tick, index, i) % parts.length]!;
    out.push(partKey(p.partId, p.tier, p.variant));
  }
  return out;
}

function promoteCaptain(state: SimState, index: number, trophies: PartKey[], events: SimEvent[]): void {
  const def = captainDef(state.seed, index);
  if (!def) return;
  const s = captainState(state, index);
  s.promotions++;
  s.trophies.push(...trophies);
  events.push({ type: 'captainPromoted', captain: index, level: captainLevel(def, s), trophies });
  log(state, { tick: state.tick, kind: 'captainPromoted', captain: index });
}

function stepCaptains(state: SimState, events: readonly SimEvent[], out: SimEvent[]): void {
  const career = state.career;
  const destroyed = new Set(events.flatMap((e) => (e.type === 'shipDestroyed' ? [e.ref] : [])));
  const present = new Map<number, Enemy>();
  for (const e of state.combat.enemies) {
    const i = captainIndexOf(e.id);
    if (i !== null) present.set(i, e);
  }
  const playerDied = events.find((e) => e.type === 'playerDestroyed');
  // the player's death: a captain in the fight is promoted and takes a replica (the player loses nothing)
  if (playerDied && playerDied.type === 'playerDestroyed') {
    for (const [i, e] of present) {
      if (hypot(e.body.pos.x - playerDied.pos.x, e.body.pos.y - playerDied.pos.y) > CAPTAIN_KILL_RANGE) continue;
      const def = captainDef(state.seed, i);
      if (!def) continue;
      captainState(state, i).kills++;
      promoteCaptain(state, i, replicaParts(state, i, TRAITS[def.trait].replicas), out);
    }
  }
  for (const [i, fraction] of [...career.engaged]) {
    if (present.has(i)) continue;
    career.engaged.delete(i);
    const id = `cap:${i}`;
    if (destroyed.has(id)) {
      const s = captainState(state, i);
      s.defeated = true;
      career.trophies.push({ captain: i, parts: [...s.trophies] });
      out.push({ type: 'captainDefeated', captain: i });
      log(state, { tick: state.tick, kind: 'captainDefeated', captain: i });
      for (const c of career.contracts) if (c.target.kind === 'captain' && c.target.captain === i) markReady(c, out);
      continue;
    }
    const def = captainDef(state.seed, i);
    // gone from the fight with low HP = escaped → a promotion
    if (def && fraction < TRAITS[def.trait].escapeHull) promoteCaptain(state, i, [], out);
  }
  for (const [i, e] of present) career.engaged.set(i, hullFraction(e));
}

/**
 * The outcome hooks of the M4d contracts (`stepContracts`): one object, its targets set per step (no
 * closures per step – perf audit 2026-10-17, P4). Not re-entrant (the hooks never step contracts).
 */
let outcomeOut: SimEvent[] = [];
let outcomeFailed: { c: Contract; reason: ContractFailReason }[] = [];
const OUTCOME: ContractOutcome = { ready: (c) => markReady(c, outcomeOut), fail: (c, reason) => outcomeFailed.push({ c, reason }) };

function stepContracts(state: SimState, events: readonly SimEvent[], out: SimEvent[]): void {
  // mined units go to the mining contracts of a resource in accept order (I7): a contract counts only
  // what was mined after the earlier ones claimed their amount – the same ore never completes two
  let claimed: Map<string, number> | null = null;
  for (const c of state.career.contracts) {
    const t = c.target;
    if (t.kind === 'mining') {
      claimed ??= new Map();
      const start = Math.max(c.base, claimed.get(t.resource) ?? -Infinity);
      claimed.set(t.resource, start + t.amount);
      if (c.ready) continue;
      c.progress = Math.max(0, state.stats.mined[t.resource] - start);
      if (c.progress + RES_EPS >= t.amount) {
        markReady(c, out);
        // the claim survives turning this one in: later contracts of the resource start after it
        for (const d of state.career.contracts) {
          if (d !== c && d.target.kind === 'mining' && d.target.resource === t.resource && d.serial > c.serial) d.base = Math.max(d.base, start + t.amount);
        }
      }
      continue;
    }
    if (c.ready) continue;
    if (t.kind === 'hunt') {
      // the ships destroyed this step, in event order
      for (const e of events) if (e.type === 'shipDestroyed' && t.slots.includes(e.ref)) c.progress++;
      if (c.progress >= t.slots.length) markReady(c, out);
    } else if (t.kind === 'fortress') {
      // the fortress fell after the contract was accepted
      if (events.some((e) => e.type === 'fortressDestroyed' && e.fortress === t.fortress)) {
        c.progress = 1;
        markReady(c, out);
      }
    } else if (t.kind === 'chart') {
      // charted by the player (survey points or coverage) after the contract was accepted
      if (events.some((e) => e.type === 'sectorCharted' && e.id === t.sector)) {
        c.progress = 1;
        markReady(c, out);
      }
    } else if (t.kind === 'scan') {
      // Scan: an analysis of the target (also a repeated one) after the contract was accepted
      if (events.some((e) => e.type === 'analysisDone' && e.target === t.poi)) {
        c.progress = 1;
        markReady(c, out);
      }
    }
  }
  // M4d: escort (convoys/escort.ts) and Guild relay (guild/relayChain.ts) contracts decide themselves;
  // failures are applied after both hooks ran (they iterate the contract list)
  outcomeOut = out;
  const failed = outcomeFailed;
  stepEscortContracts(state, events, OUTCOME);
  stepRelayContracts(state, events, OUTCOME);
  if (failed.length > 0) {
    outcomeFailed = [];
    for (const { c, reason } of failed) failContract(state, c, reason, out);
  }
}

/** A failed contract (M4d escort): removed (no reward, no refund), `contractFailed`, a journal entry. */
function failContract(state: SimState, c: Contract, reason: ContractFailReason, out: SimEvent[]): void {
  const list = state.career.contracts;
  const i = list.indexOf(c);
  if (i < 0) return;
  list.splice(i, 1);
  out.push({ type: 'contractFailed', contractId: c.serial, reason });
  log(state, { tick: state.tick, kind: 'contractFailed', type: c.type, station: c.station });
}

const NO_EVENTS: readonly SimEvent[] = [];

/** The career step after the simulation step. Returns the new events. */
export function stepCareer(state: SimState, events: readonly SimEvent[]): SimEvent[] {
  const out: SimEvent[] = [];
  const career = state.career;
  if (career.contracts.length > 0) stepContracts(state, events, out);
  if (career.engaged.size > 0 || state.combat.enemies.some((e) => e.id.startsWith('cap:')) || events.some((e) => e.type === 'playerDestroyed')) {
    stepCaptains(state, events, out);
  }
  if (career.shipments.length > 0) {
    for (const e of deliverShipments(state)) {
      out.push(e);
      if (e.type === 'courierDelivered') log(state, { tick: state.tick, kind: 'courierDelivered', station: e.to });
    }
  }
  // the training reads this step's events and the career's own (a copy only while a step is running)
  const training = currentTrainingStep(career.training) ? stepTraining(state, [...events, ...out]) : NO_EVENTS;
  out.push(...training);
  for (const e of events) {
    if (e.type === 'stationDiscovered') log(state, { tick: state.tick, kind: 'stationDiscovered', station: e.stationId });
    else if (e.type === 'playerDestroyed') log(state, { tick: state.tick, kind: 'died' });
  }
  for (const e of training) {
    if (e.type === 'trainingStep') log(state, { tick: state.tick, kind: 'trainingStep', step: e.step });
    // level-ups from actions are logged by the actions themselves
    else if (e.type === 'repLevelUp') log(state, { tick: state.tick, kind: 'levelUp', faction: e.faction, level: e.level });
  }
  // the docked station's board is fixed within the epoch (also after the 20 min refresh)
  const dock = state.player.dock;
  if (dock.mode === 'docked') {
    const board = career.boards.get(dock.stationId);
    if (!board || board.epoch !== boardEpoch(state.tick)) {
      const station = stationOf(state, dock.stationId);
      if (station) ensureBoard(state, station);
    }
  }
  return out;
}

function stationOf(state: SimState, id: string): StationDef | null {
  return state.world.stations().find((s) => s.id === id) ?? null;
}

/** All parts and resources in the storages (a helper for tests and the overview). */
export function storageTotals(state: SimState): { resources: number; parts: number } {
  let resources = 0;
  let parts = 0;
  for (const s of state.stations.values()) {
    for (const r of RESOURCE_IDS) resources += s.resources[r];
    for (const k of ALL_PART_KEYS) parts += s.parts[k] ?? 0;
  }
  return { resources, parts };
}
