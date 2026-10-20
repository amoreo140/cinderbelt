// Contract slip for the UI (ContractSlip): what, where, how much, risk and next step – pure data from state.
import { SHORT_CONTRACT_SECONDS, type ContractType } from '../../data/contracts';
import { ESCORT } from '../../data/convoys';
import { RELAY_CHAIN } from '../../data/guild';
import { RESOURCE_IDS, type Cargo, type ResourceId } from '../../data/resources';
import type { RelayStage } from '../../sim/guild/types';
import type { LaneId } from '../../sim/regions/lanes';
import { emblemPath, type RepFactionId } from '../../data/factions';
import { parsePartKey, type PartId, type Tier } from '../../data/parts';
import { SECTOR_MODIFIERS, type SectorModifierKind } from '../../data/sector';
import { tx } from '../../i18n';
import { canTurnIn } from '../../sim/career/career';
import type { Contract, ContractOffer } from '../../sim/career/types';
import { cancelIsFree, quoteOffer } from '../../sim/contracts/board';
import { formatCredits, formatInt, formatPercent } from '../../ui/format';
import type { Vec2 } from '../../sim/math/vec2';
import type { SimState } from '../../sim/Simulation';
import { availableResources } from '../../sim/station/storage';
import { stationById, type StationDef } from '../../sim/world/stations';
import { amountText, captainName, fortressLabel, partLabel, resourceName, sectorLabel, stationLabel } from './names';
import { surveyProgress } from '../../sim/charts/charts';
import { surveyMarks } from '../sectors/surveyUi';
import { surveyPoints } from '../../sim/regions/survey';
import { escortShips } from '../../sim/convoys/escort';

/** The unmarked survey point of a sector nearest to the ship (null when all are marked or it has none). */
export function nextSurveyPoint(state: SimState, sector: string): Vec2 | null {
  const { mask } = surveyMarks(state, sector);
  const at = state.player.body.pos;
  let best: { pos: Vec2; d: number } | null = null;
  for (const p of surveyPoints(state.seed, sector)) {
    if (mask & (1 << p.index)) continue;
    const d = Math.hypot(p.pos.x - at.x, p.pos.y - at.y);
    if (!best || d < best.d) best = { pos: p.pos, d };
  }
  return best ? { ...best.pos } : null;
}

export type SlipState = 'offer' | 'active' | 'ready';

export interface SlipModifier {
  name: string;
  kind: SectorModifierKind;
  /** Bonus in percent (0 = none). */
  bonus: number;
}

export interface SlipAction {
  enabled: boolean;
  reason?: string;
}

export interface SlipData {
  key: string;
  /** Index of the accepted contract (null for a slip from the offer). */
  serial: number | null;
  offerId: string;
  type: ContractType;
  typeName: string;
  faction: RepFactionId;
  factionName: string;
  emblem: string;
  title: string;
  why: string;
  reward: number;
  rewardNote: string | null;
  rep: number;
  part: { partId: PartId; tier: Tier } | null;
  minutes: number;
  short: boolean;
  /** 0 no risk, 1 risk, 2 high. */
  risk: 0 | 1 | 2;
  ring: number;
  modifiers: SlipModifier[];
  state: SlipState;
  /** Where to fly (null = anywhere). */
  target: Vec2 | null;
  progress: { value: number; max: number } | null;
  next: string | null;
  accept?: SlipAction;
  turnIn?: SlipAction;
  /** Cancelling: free within 2 min (the slip returns), then "give up". */
  abandon?: { free: boolean };
  /** The "First chart" offer after the Guild Training (sectors §4.3) – a tag on the slip. */
  first?: boolean;
  /** M4d relay / escort: the Guild Lane (a tag on the slip). */
  lane?: LaneId;
  /** M4d escort: the deposit taken on acceptance (credits; a tag on the slip, the note says when it is lost). */
  deposit?: number;
  /** M4d escort: the number of ambushes on the stretch (a tag). */
  ambushes?: number;
  /** A delivery offer: how much of the goods the ship and this station together still lack (omitted when covered). */
  needs?: { resource: ResourceId; amount: number };
}

const RISK_INDEX = { 0: 0, 0.25: 1, 0.5: 2 } as const;

function titleOf(state: SimState, o: ContractOffer): string {
  const t = o.target;
  const p = tx().goals.task;
  switch (t.kind) {
    case 'delivery':
      return p.delivery(amountText(t.amount), resourceName(t.resource), stationLabel(state.seed, t.to));
    case 'mining':
      return p.mining(amountText(t.amount), resourceName(t.resource));
    case 'hunt':
      return p.hunt(t.slots.length);
    case 'captain':
      return p.captain(captainName(state.seed, t.captain));
    case 'rescue':
      return p.rescue(t.fuel);
    case 'survey':
      return p.survey(t.points.length);
    case 'scan':
      return p.scan(tx().goals.scanWhat[t.what]);
    case 'retrieve':
      return p.retrieve(partLabel(t.part));
    case 'fortress':
      return p.fortress(fortressLabel(t.fortress));
    case 'chart':
      return p.chart(sectorLabel(state.seed, t.sector), t.points);
    // M4d
    case 'relay':
      return p.relay(sectorLabel(state.seed, t.sector));
    case 'escort':
      return p.escort(t.lane);
  }
}

/** The "why" line of a slip (also the objective of an active contract). */
export function contractWhy(state: SimState, o: Pick<ContractOffer, 'target'>): string {
  const why = tx().goals.why;
  if (o.target.kind === 'captain' && (state.career.captains.get(o.target.captain)?.kills ?? 0) > 0) return why.revenge;
  if (o.target.kind === 'chart' && o.target.first) return why.chartFirst;
  // M4d escort: when the deposit is lost (the objective shows it while the escort runs)
  if (o.target.kind === 'escort') return tx().guild.escort.rules;
  return why[o.target.kind];
}

const whyOf = (state: SimState, o: ContractOffer): string => contractWhy(state, o);

/** The contract's target in the world (for the arrow and distance), or null. */
export function contractTarget(state: SimState, c: ContractOffer & { progress?: number; ready?: boolean }): Vec2 | null {
  const t = c.target;
  if (c.ready) return null;
  switch (t.kind) {
    case 'delivery':
      return stationById(state.seed, t.to)?.pos ?? null;
    case 'mining':
      return null;
    case 'hunt':
    case 'captain':
    case 'rescue':
    case 'scan':
    case 'retrieve':
    case 'fortress':
      return t.pos;
    case 'chart':
      // an accepted contract leads to the sector's next unmarked survey point, an offer to the sector
      return 'serial' in c ? (nextSurveyPoint(state, t.sector) ?? t.pos) : t.pos;
    case 'survey':
      return t.points[c.progress ?? 0] ?? t.points[0] ?? null;
    // M4d: the Guild relay mast; the escort's meeting point, then the trader once the convoy departed
    case 'relay':
      return t.pos;
    case 'escort': {
      const serial = 'serial' in c && typeof c.serial === 'number' ? c.serial : null;
      const e = serial !== null ? state.convoys.escorts.get(serial) : undefined;
      if (serial === null || !e || e.departed === null) return t.meet;
      const trader = escortShips(state, serial, e, t).find((s) => s.index === 0);
      return trader ? { ...trader.pos } : t.end;
    }
  }
}

/** Next step and progress of an active contract. */
export function contractNext(state: SimState, c: Contract): { next: string; progress: { value: number; max: number } | null } {
  const t = c.target;
  const n = tx().goals.next;
  if (c.ready) return { next: n.ready, progress: null };
  switch (t.kind) {
    case 'delivery': {
      const have = Math.min(t.amount, state.player.cargo[t.resource]);
      const name = stationLabel(state.seed, t.to);
      const dock = state.player.dock;
      const atDest = dock.mode === 'docked' && dock.stationId === t.to;
      const total = atDest ? availableResources(state, t.to)[t.resource] : have;
      if (total + 1e-9 >= t.amount) return { next: n.deliveryReady(name), progress: { value: t.amount, max: t.amount } };
      return { next: n.delivery(amountText(Math.min(t.amount, total)), amountText(t.amount), resourceName(t.resource), name), progress: { value: Math.min(t.amount, total), max: t.amount } };
    }
    case 'mining':
      return { next: n.mining(amountText(c.progress), amountText(t.amount), resourceName(t.resource)), progress: { value: Math.min(c.progress, t.amount), max: t.amount } };
    case 'hunt':
      return { next: n.hunt(c.progress, t.slots.length), progress: { value: c.progress, max: t.slots.length } };
    case 'captain':
      return { next: n.captain(captainName(state.seed, t.captain)), progress: null };
    case 'rescue':
      return { next: n.rescue(t.fuel), progress: null };
    case 'survey':
      return { next: n.survey(c.progress, t.points.length), progress: { value: c.progress, max: t.points.length } };
    case 'scan':
      return { next: n.scan(tx().goals.scanWhat[t.what]), progress: null };
    case 'retrieve':
      return { next: n.retrieve(partLabel(t.part)), progress: null };
    case 'fortress':
      return { next: n.fortress(fortressLabel(t.fortress)), progress: null };
    case 'chart': {
      const p = surveyProgress(state, t.sector);
      return { next: n.chart(sectorLabel(state.seed, t.sector), p.done, p.total), progress: p.total > 0 ? { value: p.done, max: p.total } : null };
    }
    // M4d: the relay chain's stage (repair → power → hold), the escort convoy's state
    case 'relay': {
      const r = relayStageView(state, t.lane, t.sector);
      return { next: r.hint, progress: { value: RELAY_STEP[r.stage], max: 3 } };
    }
    case 'escort': {
      const e = state.convoys.escorts.get(c.serial);
      const length = Math.abs(t.to - t.from);
      return {
        next: escortNext(state, t.meet, e?.state ?? null),
        progress: e && e.departed !== null && length > 0 ? { value: Math.min(length, Math.round(e.progress)), max: Math.round(length) } : null,
      };
    }
  }
}

/** Steps of the relay chain done at a stage (the slip's progress bar: repair, power, hold). */
const RELAY_STEP: Readonly<Record<'broken' | RelayStage, number>> = { broken: 0, repaired: 1, powered: 2, secured: 3 };

/** The relay repair materials as symbols: "60 Fe, 40 Cu, 10 Ti". */
export function relayMaterials(cargo: Readonly<Partial<Cargo>> = RELAY_CHAIN.repair): string {
  const sym = tx().resourceSymbols;
  return RESOURCE_IDS.filter((r) => (cargo[r] ?? 0) > 0)
    .map((r) => `${formatInt(Math.ceil((cargo[r] ?? 0) - 1e-9))} ${sym[r]}`)
    .join(', ');
}

/** What the ship's cargo lacks for the relay repair (empty = it has everything). */
export function relayMissing(cargo: Readonly<Cargo>): Partial<Cargo> {
  const out: Partial<Cargo> = {};
  for (const r of RESOURCE_IDS) {
    const need = RELAY_CHAIN.repair[r] ?? 0;
    if (cargo[r] + 1e-9 < need) out[r] = need - cargo[r];
  }
  return out;
}

/**
 * The Guild relay chain of a lane for the player (M4d §2.2): its stage and the next-step hint – the slip,
 * the objective and (T9) the HUD relay chip read the same text.
 */
export function relayStageView(state: SimState, lane: LaneId, sector: string): { stage: 'broken' | RelayStage; hint: string } {
  const h = tx().guild.relay.hints;
  const rec = state.guild.relays.get(lane);
  if (!rec) return { stage: 'broken', hint: h.repair(relayMaterials()) };
  switch (rec.stage) {
    case 'repaired':
      return { stage: 'repaired', hint: h.power };
    case 'powered': {
      const hold = state.guild.hold?.lane === lane ? state.guild.hold : null;
      return { stage: 'powered', hint: hold?.phase === 'warning' ? h.holdWarning : hold?.phase === 'idle' ? h.holdIdle : h.hold };
    }
    case 'secured':
      return { stage: 'secured', hint: h.secured(sectorLabel(state.seed, sector)) };
  }
}

/** The escort's next step by the convoy's state (null = no convoy record yet: fly to the meeting point). */
export function escortNext(state: SimState, meet: Vec2, convoy: 'waiting' | 'moving' | 'stopped' | 'done' | null): string {
  const n = tx().guild.escort.next;
  switch (convoy) {
    case null:
      return n.meet;
    case 'waiting': {
      const p = state.player.body.pos;
      return Math.hypot(meet.x - p.x, meet.y - p.y) > ESCORT.departRadius * 2 ? n.meet : n.waiting;
    }
    case 'moving':
      return n.follow;
    case 'stopped':
      return n.stopped;
    case 'done':
      return n.done;
  }
}

/** The deposit of an escort contract with this reward (credits; T6 takes the same amount on acceptance). */
export const escortDepositOf = (reward: number): number => Math.round(reward * ESCORT.deposit);

function base(state: SimState, o: ContractOffer, quote: { seconds: number; reward: number; rep: number; bounty: number; goods: number; data?: number }): Omit<SlipData, 'key' | 'serial' | 'state' | 'progress' | 'next'> {
  const part = o.part ? parsePartKey(o.part) : null;
  const data = 'data' in quote && quote.data ? quote.data : 0;
  const deposit = o.target.kind === 'escort' ? escortDepositOf(quote.reward) : 0;
  const note =
    o.target.kind === 'chart' ? tx().sectors.charts.includesSale
    : o.target.kind === 'escort' ? tx().guild.escort.deposit(formatPercent(Math.round(ESCORT.deposit * 100)), formatCredits(deposit))
    : o.target.kind === 'relay' ? tx().guild.relay.slipNote
    : quote.bounty > 0 ? tx().goals.slip.bounty(formatCredits(quote.bounty))
    : quote.goods > 0 ? tx().goals.slip.goods(formatCredits(quote.goods))
    : data > 0 ? tx().discovery.slipData(data)
    : null;
  return {
    offerId: o.id,
    type: o.type,
    typeName: tx().goals.contractTypes[o.type],
    faction: o.faction,
    factionName: tx().goals.factionShort[o.faction],
    emblem: emblemPath(o.faction),
    title: titleOf(state, o),
    why: whyOf(state, o),
    reward: quote.reward,
    rewardNote: note,
    rep: quote.rep,
    part,
    minutes: Math.max(1, Math.round(quote.seconds / 60)),
    short: quote.seconds <= SHORT_CONTRACT_SECONDS,
    risk: RISK_INDEX[o.risk],
    ring: o.ring,
    modifiers: o.modifiers.map((id) => ({ name: tx().goals.sector.names[id], kind: SECTOR_MODIFIERS[id].kind, bonus: Math.round(SECTOR_MODIFIERS[id].bonus * 100) })),
    target: contractTarget(state, o),
    ...(o.target.kind === 'chart' && o.target.first ? { first: true } : {}),
    ...(o.target.kind === 'relay' || o.target.kind === 'escort' ? { lane: o.target.lane } : {}),
    ...(o.target.kind === 'escort' ? { deposit, ambushes: o.target.ambushes.length } : {}),
  };
}

/** A slip from the board offer (reward based on the current ship). */
export function offerSlip(state: SimState, o: ContractOffer, canAccept: SlipAction): SlipData {
  return { ...base(state, o, quoteOffer(state, o)), ...offerNeeds(state, o), key: o.id, serial: null, state: 'offer', progress: null, next: null, accept: canAccept };
}

/** The goods a delivery offer still needs beyond the hold and the docked station's storage. */
function offerNeeds(state: SimState, o: ContractOffer): { needs?: { resource: ResourceId; amount: number } } {
  if (o.target.kind !== 'delivery') return {};
  const dock = state.player.dock;
  const stored = dock.mode === 'docked' ? availableResources(state, dock.stationId)[o.target.resource] : 0;
  const missing = Math.ceil(o.target.amount - state.player.cargo[o.target.resource] - stored - 1e-9);
  return missing > 0 ? { needs: { resource: o.target.resource, amount: missing } } : {};
}

/** An accepted contract (frozen reward, progress, hand-in at the `docked` station). */
export function contractSlip(state: SimState, c: Contract, docked: StationDef | null): SlipData {
  const quote = { seconds: c.seconds, reward: c.reward, rep: c.rep, bounty: 0, goods: 0, data: c.data ?? 0 };
  const { next, progress } = contractNext(state, c);
  let turnIn: SlipAction | undefined;
  if (docked) {
    if (c.target.kind === 'delivery' && docked.id !== c.target.to) turnIn = { enabled: false, reason: tx().goals.slip.notHere(stationLabel(state.seed, c.target.to)) };
    else if (canTurnIn(state, docked, c)) turnIn = { enabled: true };
    else if (c.target.kind === 'delivery') {
      const missing = c.target.amount - availableResources(state, docked.id)[c.target.resource];
      turnIn = { enabled: false, reason: tx().goals.slip.missing(amountText(missing), resourceName(c.target.resource)) };
    } else turnIn = { enabled: false, reason: tx().goals.slip.notReady };
  }
  const ready = c.ready || (docked !== null && c.target.kind === 'delivery' && canTurnIn(state, docked, c));
  return {
    ...base(state, c, quote),
    target: contractTarget(state, c),
    key: `c${c.serial}`,
    serial: c.serial,
    state: ready ? 'ready' : 'active',
    progress,
    next,
    ...(turnIn ? { turnIn } : {}),
    abandon: { free: cancelIsFree(state, c) },
  };
}
