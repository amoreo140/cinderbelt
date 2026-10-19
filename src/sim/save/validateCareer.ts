// Validation of the career in a save (V4, M3.5a; Guild relay and escort targets and the `contractFailed`
// log entry M4d / V20) – the same style as validate.ts: a clean copy, unknown fields are dropped, errors
// with paths.
import { CAPTAIN_COUNT } from '../../data/captains';
import { BOARD_MAX_OFFERS, CONTRACT_TYPES, RISKS, type ContractRisk, type ContractType } from '../../data/contracts';
import { RING_INDICES, type RingIndex } from '../../data/economy';
import { REP_FACTION_IDS, type RepFactionId, type RepLevel } from '../../data/factions';
import { isPartKey, type PartKey } from '../../data/parts';
import { RESOURCE_IDS, type Cargo, type ResourceId } from '../../data/resources';
import { PLAN_IDS, type PlanId } from '../../data/plans';
import { SECTOR_MODIFIER_IDS, type SectorModifierId } from '../../data/sector';
import { COURIER_MAX_SHIPMENTS } from '../courier/courier';
import { guildRelayId } from '../guild/relaySites';
import type { LaneId } from '../regions/lanes';
import {
  LOG_MAX,
  type BoardState,
  type CaptainState,
  type Contract,
  type ContractOffer,
  type ContractTarget,
  type LogEntry,
  type RepState,
  type Shipment,
} from '../career/types';
import type { SavedCareerV10 } from './types';
import { TRAINING_STEPS, TRAINING_STEP_COUNT, type TrainingStepId } from '../../data/training';
import type { TrainingState, TrainingStatus } from '../training/types';
import type { Checker } from './validate';

/** A margin above the game's limits (the captain's licence, later versions) – only a guard against nonsense. */
const MAX_CONTRACTS = 8;
/** At most this many ambush points on an escort stretch (bits of `EscortState.fired`, V20). */
const MAX_AMBUSHES = 30;
const LANES: readonly LaneId[] = ['A', 'B'];
export const LOG_KINDS: readonly LogEntry['kind'][] = [
  'contractAccepted',
  'contractCompleted',
  'contractAbandoned',
  'contractFailed',
  'levelUp',
  'stationDiscovered',
  'captainDefeated',
  'captainPromoted',
  'courierDelivered',
  'firstDayStep',
  'trainingStep',
  'died',
];
const TRAINING_STATUSES: readonly TrainingStatus[] = ['active', 'done', 'skipped'];
const TRAINING_STEP_IDS: readonly TrainingStepId[] = TRAINING_STEPS.map((s) => s.id);

type Obj = Record<string, unknown>;

function partialCargo(c: Checker, v: unknown, path: string): Partial<Cargo> {
  const o = c.obj(v, path) ?? {};
  const out: Partial<Cargo> = {};
  for (const [k, n] of Object.entries(o)) {
    if (!(RESOURCE_IDS as readonly string[]).includes(k)) {
      c.err(`${path}.${k}`, 'unknown resource');
      continue;
    }
    const x = c.num(n, `${path}.${k}`, 0);
    if (x > 0) out[k as ResourceId] = x;
  }
  return out;
}

function partKeys(c: Checker, v: unknown, path: string): PartKey[] {
  return (c.arr(v, path) ?? []).map((k, i) => {
    if (!isPartKey(k)) c.err(`${path}[${i}]`, 'unknown part key');
    return k as PartKey;
  });
}

function target(c: Checker, v: unknown, path: string): ContractTarget {
  const o = c.obj(v, path) ?? {};
  const kind = c.oneOf(o.kind, ['delivery', 'mining', 'hunt', 'captain', 'rescue', 'survey', 'scan', 'retrieve', 'fortress', 'chart', 'relay', 'escort'] as const, `${path}.kind`);
  switch (kind) {
    case 'delivery':
      return {
        kind,
        resource: c.oneOf(o.resource, RESOURCE_IDS, `${path}.resource`),
        amount: c.num(o.amount, `${path}.amount`, 1),
        to: c.stationId(o.to, `${path}.to`),
      };
    case 'mining':
      return { kind, resource: c.oneOf(o.resource, RESOURCE_IDS, `${path}.resource`), amount: c.num(o.amount, `${path}.amount`, 1) };
    case 'hunt': {
      const slots = (c.arr(o.slots, `${path}.slots`) ?? []).map((x, i) => c.str(x, `${path}.slots[${i}]`, true));
      if (slots.length === 0) c.err(`${path}.slots`, 'expected at least one slot');
      return { kind, cx: c.int(o.cx, `${path}.cx`), cy: c.int(o.cy, `${path}.cy`), slots, pos: c.vec(o.pos, `${path}.pos`) };
    }
    case 'captain':
      return { kind, captain: c.int(o.captain, `${path}.captain`, 0, CAPTAIN_COUNT - 1), pos: c.vec(o.pos, `${path}.pos`) };
    case 'rescue':
      return { kind, pos: c.vec(o.pos, `${path}.pos`), angle: c.num(o.angle, `${path}.angle`), fuel: c.num(o.fuel, `${path}.fuel`, 0) };
    case 'survey': {
      const points = (c.arr(o.points, `${path}.points`) ?? []).map((p, i) => c.vec(p, `${path}.points[${i}]`));
      if (points.length === 0) c.err(`${path}.points`, 'expected points');
      return { kind, points };
    }
    case 'scan':
      return { kind, poi: c.str(o.poi, `${path}.poi`, true), what: c.oneOf(o.what, ['wreck', 'anomaly', 'giant'] as const, `${path}.what`), pos: c.vec(o.pos, `${path}.pos`) };
    case 'fortress':
      return { kind, fortress: c.str(o.fortress, `${path}.fortress`, true), pos: c.vec(o.pos, `${path}.pos`) };
    case 'chart': {
      // V15 (sectors stage 2)
      const out: ContractTarget = { kind, sector: c.str(o.sector, `${path}.sector`, true), pos: c.vec(o.pos, `${path}.pos`), points: c.int(o.points, `${path}.points`, 0, 31) };
      if (o.first !== undefined) {
        if (o.first !== true) c.err(`${path}.first`, 'expected true');
        return { ...out, first: true };
      }
      return out;
    }
    case 'relay': {
      // V20 (M4d): the lane's Guild relay mast `gr:<lane>` in its sector (the site itself is checked against the seed in validateGuild.ts)
      const lane = c.oneOf<LaneId>(o.lane, LANES, `${path}.lane`);
      const relay = c.str(o.relay, `${path}.relay`, true);
      if (relay !== guildRelayId(lane)) c.err(`${path}.relay`, 'expected the Guild relay id of the lane');
      return { kind, lane, relay, sector: c.str(o.sector, `${path}.sector`, true), pos: c.vec(o.pos, `${path}.pos`) };
    }
    case 'escort': {
      // V20 (M4d): arc lengths along the lane's convoy route, from < to, the ambush points inside the stretch
      const from = c.num(o.from, `${path}.from`, 0);
      const to = c.num(o.to, `${path}.to`, 0);
      if (to <= from) c.err(`${path}.to`, 'expected an arc past `from`');
      const list = c.arr(o.ambushes, `${path}.ambushes`) ?? [];
      if (list.length > MAX_AMBUSHES) c.err(`${path}.ambushes`, 'too many ambush points');
      const ambushes = list.map((x, i) => c.num(x, `${path}.ambushes[${i}]`, from, to));
      return { kind, lane: c.oneOf<LaneId>(o.lane, LANES, `${path}.lane`), from, to, meet: c.vec(o.meet, `${path}.meet`), end: c.vec(o.end, `${path}.end`), ambushes };
    }
    case 'retrieve': {
      if (!isPartKey(o.part)) c.err(`${path}.part`, 'unknown part key');
      return {
        kind,
        pos: c.vec(o.pos, `${path}.pos`),
        angle: c.num(o.angle, `${path}.angle`),
        part: (isPartKey(o.part) ? o.part : 'armor:1') as PartKey,
        plan: c.oneOf<PlanId>(o.plan, PLAN_IDS, `${path}.plan`),
      };
    }
  }
}

function offer(c: Checker, o: Obj, path: string): ContractOffer {
  const partRaw = o.part;
  let part: PartKey | null = null;
  if (partRaw !== null) {
    if (isPartKey(partRaw)) part = partRaw;
    else c.err(`${path}.part`, 'expected a part key or null');
  }
  return {
    id: c.str(o.id, `${path}.id`, true),
    type: c.oneOf<ContractType>(o.type, CONTRACT_TYPES, `${path}.type`),
    faction: c.oneOf<RepFactionId>(o.faction, REP_FACTION_IDS, `${path}.faction`),
    station: c.stationId(o.station, `${path}.station`),
    ring: c.oneOf<RingIndex>(o.ring, RING_INDICES, `${path}.ring`),
    risk: c.oneOf<ContractRisk>(o.risk, RISKS, `${path}.risk`),
    target: target(c, o.target, `${path}.target`),
    modifiers: (c.arr(o.modifiers, `${path}.modifiers`) ?? []).map((m, i) => c.oneOf<SectorModifierId>(m, SECTOR_MODIFIER_IDS, `${path}.modifiers[${i}]`)),
    bonus: c.num(o.bonus, `${path}.bonus`, 0, 5),
    part,
  };
}

function contract(c: Checker, v: unknown, path: string): Contract {
  const o = c.obj(v, path) ?? {};
  return {
    ...offer(c, o, path),
    serial: c.int(o.serial, `${path}.serial`, 0),
    acceptedTick: c.int(o.acceptedTick, `${path}.acceptedTick`, 0),
    seconds: c.num(o.seconds, `${path}.seconds`, 0),
    reward: c.num(o.reward, `${path}.reward`, 0),
    rep: c.num(o.rep, `${path}.rep`, 0),
    ...(o.data === undefined ? {} : { data: c.num(o.data, `${path}.data`, 0) }),
    progress: c.num(o.progress, `${path}.progress`, 0),
    base: c.num(o.base, `${path}.base`, 0),
    ready: c.bool(o.ready, `${path}.ready`),
  };
}

function board(c: Checker, v: unknown, path: string): BoardState {
  const o = c.obj(v, path) ?? {};
  const offers = (c.arr(o.offers, `${path}.offers`) ?? []).map((x, i) => offer(c, c.obj(x, `${path}.offers[${i}]`) ?? {}, `${path}.offers[${i}]`));
  if (offers.length > BOARD_MAX_OFFERS * 2) c.err(`${path}.offers`, 'too many offers');
  return { epoch: c.int(o.epoch, `${path}.epoch`, 0), serial: c.int(o.serial, `${path}.serial`, 0), offers };
}

function rep(c: Checker, v: unknown, path: string): RepState {
  const o = c.obj(v, path) ?? {};
  const a = c.obj(o.assignments, `${path}.assignments`) ?? {};
  const assignments: Record<string, number> = {};
  for (const [k, n] of Object.entries(a)) assignments[k] = c.num(n, `${path}.assignments.${k}`, 0);
  return { points: c.num(o.points, `${path}.points`, 0), level: c.oneOf<RepLevel>(o.level, [0, 1, 2, 3], `${path}.level`), assignments };
}

function pairs<T>(c: Checker, v: unknown, path: string, item: (entry: unknown[], p: string) => T): T[] {
  const out: T[] = [];
  (c.arr(v, path) ?? []).forEach((entry, i) => {
    const p = `${path}[${i}]`;
    if (!Array.isArray(entry)) return c.err(p, 'expected an array');
    out.push(item(entry, p));
  });
  return out;
}

function captain(c: Checker, v: unknown, path: string): CaptainState {
  const o = c.obj(v, path) ?? {};
  return {
    promotions: c.int(o.promotions, `${path}.promotions`, 0, 100),
    defeated: c.bool(o.defeated, `${path}.defeated`),
    trophies: partKeys(c, o.trophies, `${path}.trophies`),
    kills: c.int(o.kills, `${path}.kills`, 0),
  };
}

function shipment(c: Checker, v: unknown, path: string): Shipment {
  const o = c.obj(v, path) ?? {};
  return {
    id: c.int(o.id, `${path}.id`, 0),
    from: c.stationId(o.from, `${path}.from`),
    to: c.stationId(o.to, `${path}.to`),
    resources: partialCargo(c, o.resources, `${path}.resources`),
    parts: c.parts(o.parts, `${path}.parts`),
    arrival: c.int(o.arrival, `${path}.arrival`, 0),
  };
}

function logEntry(c: Checker, v: unknown, path: string): LogEntry {
  const o = c.obj(v, path) ?? {};
  const tick = c.int(o.tick, `${path}.tick`, 0);
  const kind = c.oneOf(o.kind, LOG_KINDS, `${path}.kind`);
  switch (kind) {
    case 'contractAccepted':
    case 'contractCompleted':
    case 'contractAbandoned':
    case 'contractFailed':
      return { tick, kind, type: c.oneOf<ContractType>(o.type, CONTRACT_TYPES, `${path}.type`), station: c.stationId(o.station, `${path}.station`) };
    case 'levelUp':
      return { tick, kind, faction: c.oneOf<RepFactionId>(o.faction, REP_FACTION_IDS, `${path}.faction`), level: c.oneOf<RepLevel>(o.level, [0, 1, 2, 3], `${path}.level`) };
    case 'stationDiscovered':
    case 'courierDelivered':
      return { tick, kind, station: c.stationId(o.station, `${path}.station`) };
    case 'captainDefeated':
    case 'captainPromoted':
      return { tick, kind, captain: c.int(o.captain, `${path}.captain`, 0, CAPTAIN_COUNT - 1) };
    case 'firstDayStep':
      return { tick, kind, step: c.int(o.step, `${path}.step`, 0) };
    case 'trainingStep':
      return { tick, kind, step: c.oneOf(o.step, TRAINING_STEP_IDS, `${path}.step`) };
    case 'died':
      return { tick, kind };
  }
}

/** Guild Training (V10). */
function training(c: Checker, raw: unknown, path: string): TrainingState {
  const o = c.obj(raw, path) ?? {};
  const status = c.oneOf(o.status, TRAINING_STATUSES, `${path}.status`);
  let sites: TrainingState['sites'] = null;
  if (o.sites !== null) {
    const s = c.obj(o.sites, `${path}.sites`) ?? {};
    sites = { buoyA: c.vec(s.buoyA, `${path}.sites.buoyA`), buoyB: c.vec(s.buoyB, `${path}.sites.buoyB`), rock: c.str(s.rock, `${path}.sites.rock`), rockPos: c.vec(s.rockPos, `${path}.sites.rockPos`) };
  }
  if (status === 'active' && sites === null) c.err(`${path}.sites`, 'an active training needs its sites');
  return {
    status,
    step: c.int(o.step, `${path}.step`, 0, status === 'active' ? TRAINING_STEP_COUNT - 1 : TRAINING_STEP_COUNT),
    base: c.num(o.base, `${path}.base`, 0),
    flags: c.int(o.flags, `${path}.flags`, 0, 255),
    rewardAt: c.stationId(o.rewardAt, `${path}.rewardAt`),
    sites,
  };
}

export function validateCareer(c: Checker, raw: unknown, path: string): SavedCareerV10 {
  const o = c.obj(raw, path) ?? {};
  const contracts = (c.arr(o.contracts, `${path}.contracts`) ?? []).map((x, i) => contract(c, x, `${path}.contracts[${i}]`));
  if (contracts.length > MAX_CONTRACTS) c.err(`${path}.contracts`, 'too many contracts');
  const repRaw = c.obj(o.rep, `${path}.rep`) ?? {};
  const repTable = { guild: rep(c, repRaw.guild, `${path}.rep.guild`), institute: rep(c, repRaw.institute, `${path}.rep.institute`) };
  const completedRaw = c.obj(o.completed, `${path}.completed`) ?? {};
  const completed: Partial<Record<ContractType, number>> = {};
  for (const [k, n] of Object.entries(completedRaw)) completed[c.oneOf<ContractType>(k, CONTRACT_TYPES, `${path}.completed.${k}`)] = c.int(n, `${path}.completed.${k}`, 0);
  const shipments = (c.arr(o.shipments, `${path}.shipments`) ?? []).map((x, i) => shipment(c, x, `${path}.shipments[${i}]`));
  if (shipments.length > COURIER_MAX_SHIPMENTS) c.err(`${path}.shipments`, 'too many shipments');
  const log = (c.arr(o.log, `${path}.log`) ?? []).map((x, i) => logEntry(c, x, `${path}.log[${i}]`));
  if (log.length > LOG_MAX) c.err(`${path}.log`, 'too many entries');
  return {
    nextId: c.int(o.nextId, `${path}.nextId`, 1),
    contracts,
    boards: pairs(c, o.boards, `${path}.boards`, (e, p) => [c.stationId(e[0], p), board(c, e[1], `${p}[1]`)] as [string, BoardState]),
    rep: repTable,
    captains: pairs(c, o.captains, `${path}.captains`, (e, p) => [c.int(e[0], p, 0, CAPTAIN_COUNT - 1), captain(c, e[1], `${p}[1]`)] as [number, CaptainState]),
    engaged: pairs(c, o.engaged, `${path}.engaged`, (e, p) => [c.int(e[0], p, 0, CAPTAIN_COUNT - 1), c.num(e[1], p, 0, 1)] as [number, number]),
    shipments,
    training: training(c, o.training, `${path}.training`),
    demandSold: pairs(c, o.demandSold, `${path}.demandSold`, (e, p) => [c.stationId(e[0], p), c.int(e[1], p, 0), c.num(e[2], p, 0)] as [string, number, number]),
    completed,
    trophies: (c.arr(o.trophies, `${path}.trophies`) ?? []).map((x, i) => {
      const t = c.obj(x, `${path}.trophies[${i}]`) ?? {};
      return { captain: c.int(t.captain, `${path}.trophies[${i}].captain`, 0, CAPTAIN_COUNT - 1), parts: partKeys(c, t.parts, `${path}.trophies[${i}].parts`) };
    }),
    log,
  };
}
