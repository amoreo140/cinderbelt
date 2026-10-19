// The station board and a contract's life cycle: slip → acceptance (the reward freezes) → progress →
// hand-in. The board is stored on docking and on every action; from then on it is fixed for the epoch.
import {
  BOARD_MAX_OFFERS,
  BOARD_REFRESH_TICKS,
  CONTRACT_OVERHEAD_SECONDS,
  CRUISE_SPEED,
  FREE_CANCEL_TICKS,
  FORTRESS_FIGHT_SECONDS,
  HUNT_SECONDS_PER_ENEMY,
  MAX_ACTIVE_CONTRACTS,
} from '../../data/contracts';
import { partSellPrice, resourcePrice, round5, type RingIndex } from '../../data/economy';
import type { PartKey } from '../../data/parts';
import { RING_TRIP } from '../../data/incomeModel';
import { INSTITUTE_DATA_RATE } from '../../data/poi';
import { hasFeature } from '../discovery/archive';
import { fortressAlive, fortressStatus } from '../pirates/fortress';
import { fortressSites } from '../pirates/sites';
import type { ShipGrid } from '../ship/types';
import { captainBounty, captainDef, captainDefs, captainLevel } from '../captains/captains';
import { computeProperties, type ShipProperties } from '../ship/properties';
import type { SimState } from '../Simulation';
import { repUnlocks } from '../factions/reputation';
import type { RepUnlock } from '../../data/factions';
import { HOME_STATION_ID, stationById, type StationDef, type StationId } from '../world/stations';
import { CHART_SECONDS_PER_POINT } from '../../data/charts';
import { chartContractCandidates, chartSellPrice, firstChartTarget, reservedCharts } from '../charts/charts';
import { securityOverrides } from '../pirates/sectors';
import { sectorKnowledge } from '../regions';
import type { BoardState, Contract, ContractOffer } from '../career/types';
import { generateBoard, generateOffer, type BoardContext, type CaptainCandidate } from './generate';
import { relayContractSites, relayOfferAvailable, relaySeconds } from '../guild/relayChain';
import { escortSeconds, escortUnderway } from '../convoys/escort';
import { clampSeconds, contractRep, contractReward, incomeOfUnits, miningUnitsPerHour, referenceIncome, referenceUnitsPerHour } from './reward';

export const boardEpoch = (tick: number): number => Math.floor(tick / BOARD_REFRESH_TICKS);
/** The tick the board refreshes. */
export const nextBoardRefresh = (tick: number): number => (boardEpoch(tick) + 1) * BOARD_REFRESH_TICKS;

/** Captains a hunt can be posted for (alive and nobody is hunting them right now). */
export function huntableCaptains(state: SimState): CaptainCandidate[] {
  const targeted = new Set(state.career.contracts.flatMap((c) => (c.target.kind === 'captain' ? [c.target.captain] : [])));
  // the captain leading a raid is busy (M6 – one kill must not pay a raid and a contract)
  const raid = state.pirates.raid?.captain;
  if (raid !== null && raid !== undefined) targeted.add(raid);
  return captainDefs(state.seed)
    .filter((d) => !state.career.captains.get(d.index)?.defeated && !targeted.has(d.index))
    .map((d) => ({ index: d.index, ring: d.ring, grudge: (state.career.captains.get(d.index)?.kills ?? 0) > 0 }));
}

/** Fortresses that stand now and nobody holds a contract for (M3.6). */
function standingFortresses(state: SimState): { id: string; pos: { x: number; y: number } }[] {
  const taken = new Set(state.career.contracts.flatMap((c) => (c.target.kind === 'fortress' ? [c.target.fortress] : [])));
  return fortressSites(state.seed)
    .filter((f) => fortressAlive(fortressStatus(state, f.id)) && !taken.has(f.id))
    .map((f) => ({ id: f.id, pos: f.pos }));
}

/** Licences for the board: reputation + the Archive licence for Retrievals (M3.5b). */
function boardUnlocks(state: SimState): Set<RepUnlock> {
  const out = repUnlocks(state.career.rep);
  if (hasFeature(state, 'instituteLicense')) out.add('retrieveContracts');
  return out;
}

export function boardContext(state: SimState, station: StationDef): BoardContext {
  return {
    seed: state.seed,
    station,
    epoch: boardEpoch(state.tick),
    tick: state.tick,
    unlocks: boardUnlocks(state),
    density: state.settings.enemyDensity,
    captains: huntableCaptains(state),
    fortresses: standingFortresses(state),
    charts: chartContractCandidates(state, station.pos),
    firstChart: station.id === HOME_STATION_ID && !state.career.contracts.some((c) => c.target.kind === 'chart' && c.target.first) ? firstChartTarget(state) : null,
    relays: relayContractSites(state),
    security: securityOverrides(state),
  };
}

/** The station's board in the current epoch (the stored one, or a preview of a new one – the state does not change). */
export function currentBoard(state: SimState, station: StationDef): BoardState {
  const stored = state.career.boards.get(station.id);
  if (stored && stored.epoch === boardEpoch(state.tick)) return stored;
  return generateBoard(boardContext(state, station));
}

/** The station's board stored into the state (from now on fixed for the epoch). */
export function ensureBoard(state: SimState, station: StationDef): BoardState {
  const board = currentBoard(state, station);
  state.career.boards.set(station.id, board);
  return board;
}

/** A slip's epoch from its id (`station@epoch.index`). */
export const offerEpoch = (id: string): number => Number(/@(\d+)\./.exec(id)?.[1] ?? -1);

// ---------------------------------------------------------------------------
// reward

const gridProps = new WeakMap<ShipGrid, ShipProperties>();

const propsOf = (grid: ShipGrid): ShipProperties => {
  let props = gridProps.get(grid);
  if (!props) {
    props = computeProperties(grid);
    gridProps.set(grid, props);
  }
  return props;
};

/**
 * The player's ships: the flying one, the layout at the respawn point, the blueprint (the layout at
 * the last shipyard commit) and the ships stored in hangar slots (M4a; design: the best ship in all the
 * player's hangars sets the reference income).
 */
export function playerShips(state: SimState): ShipProperties[] {
  const ships = [state.player.props];
  for (const grid of [state.respawn.grid, state.player.blueprint, ...state.fleet.stored.map((s) => s.grid)]) {
    if (grid && grid !== state.player.grid && grid.parts.length > 0) ships.push(propsOf(grid));
  }
  return ships;
}

/**
 * High-water mark of the player's mining capability (units/h per ring at the game's yield), updated
 * whenever the docked layout changes. A contract is quoted from the best ship the player has had, never
 * from a ship crippled just before accepting (saboteur report X2).
 */
export function recordShipCapability(state: SimState): void {
  const best = state.stats.bestUnitsPerHour;
  for (const ring of [1, 2, 3, 4] as const) {
    const u = miningUnitsPerHour(state.player.props, ring, state.settings.miningYield);
    if (u > (best[ring - 1] ?? 0)) best[ring - 1] = u;
  }
}

/**
 * Units/h the duration estimate assumes: the best of the player's ships and of the high-water mark,
 * never below the ring's reference ship (the starter hull).
 */
export function quoteUnitsPerHour(state: SimState, ring: RingIndex): number {
  const yieldMult = state.settings.miningYield;
  let best = Math.max(referenceUnitsPerHour(ring, yieldMult), state.stats.bestUnitsPerHour[ring - 1] ?? 0);
  for (const s of playerShips(state)) best = Math.max(best, miningUnitsPerHour(s, ring, yieldMult));
  return best;
}

/**
 * Reference income of a quote: the best of the player's ships and of the high-water mark (never below
 * the ring's minimum) – shared by contract quotes and the distress reward (M19).
 */
export function quoteRefIncome(state: SimState, ring: RingIndex, ships: readonly ShipProperties[] = playerShips(state)): number {
  return Math.max(referenceIncome(ships, ring, state.settings.miningYield), incomeOfUnits(state.stats.bestUnitsPerHour[ring - 1] ?? 0, ring));
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

export interface ContractQuote {
  seconds: number;
  reward: number;
  rep: number;
  /** The captain's bounty (part of the reward). */
  bounty: number;
  /** Value of the goods (part of a Delivery's reward). */
  goods: number;
  /** Data for the Archive (Institute contracts, M3.5b). */
  data: number;
  /** The exclusive part the contract pays (null when the offer has none or it is worth more than the reward). */
  part: PartKey | null;
}

/** A slip's duration estimate, reward and reputation by the player's current ships (frozen on acceptance). */
export function quoteOffer(state: SimState, offer: ContractOffer): ContractQuote {
  const from = stationById(state.seed, offer.station);
  const origin = from?.pos ?? { x: 0, y: 0 };
  const ships = playerShips(state);
  const yieldMult = state.settings.miningYield;
  const uph = quoteUnitsPerHour(state, offer.ring);
  const t = offer.target;
  let seconds = CONTRACT_OVERHEAD_SECONDS;
  let goods = 0;
  let bounty = 0;
  switch (t.kind) {
    case 'delivery': {
      const to = stationById(state.seed, t.to);
      seconds += (to ? dist(origin, to.pos) : 0) / CRUISE_SPEED + (t.amount / uph) * 3600;
      goods = Math.floor(t.amount * resourcePrice(t.resource, to?.ring ?? offer.ring, 1).sell);
      break;
    }
    case 'mining':
      seconds += (t.amount / uph) * 3600 + RING_TRIP[offer.ring].travel;
      break;
    case 'hunt':
      seconds += (2 * dist(origin, t.pos)) / CRUISE_SPEED + t.slots.length * HUNT_SECONDS_PER_ENEMY;
      break;
    case 'captain': {
      const def = captainDef(state.seed, t.captain);
      const level = def ? captainLevel(def, state.career.captains.get(t.captain)) : 1;
      seconds += (2 * dist(origin, t.pos)) / CRUISE_SPEED + (2 + level) * HUNT_SECONDS_PER_ENEMY;
      bounty = def ? captainBounty(def, level) : 0;
      break;
    }
    case 'rescue':
      seconds += (2 * dist(origin, t.pos)) / CRUISE_SPEED;
      break;
    case 'survey': {
      const p = t.points;
      const around = p.reduce((s, q, i) => s + dist(q, p[(i + 1) % p.length]!), 0);
      seconds += (2 * dist(origin, p[0]!)) / CRUISE_SPEED + around / CRUISE_SPEED + p.length * 20;
      break;
    }
    case 'scan':
      seconds += (2 * dist(origin, t.pos)) / CRUISE_SPEED + 30;
      break;
    case 'retrieve':
      seconds += (2 * dist(origin, t.pos)) / CRUISE_SPEED + 60;
      break;
    case 'fortress':
      seconds += (2 * dist(origin, t.pos)) / CRUISE_SPEED + FORTRESS_FIGHT_SECONDS;
      break;
    case 'chart':
      seconds += (2 * dist(origin, t.pos)) / CRUISE_SPEED + t.points * CHART_SECONDS_PER_POINT;
      break;
    // M4d: the Guild relay (guild/relayChain.ts) and the escort (convoys/escort.ts) quote themselves
    case 'relay':
      seconds += relaySeconds(origin, t);
      break;
    case 'escort':
      seconds += escortSeconds(origin, t);
      break;
  }
  seconds = Math.round(clampSeconds(seconds));
  const refIncome = quoteRefIncome(state, offer.ring, ships);
  let reward = contractReward({ type: offer.type, seconds, risk: offer.risk, bonus: offer.bonus, refIncome, extra: goods + bounty });
  // The exclusive part replaces credits worth its sale value, down to nothing (saboteur report X6: a
  // 30 % credit floor paid more than the credit-only reward). A part worth more than the whole reward
  // is not offered – the contract pays credits only.
  let part = offer.part;
  if (part && partSellPrice(part) > reward) part = null;
  if (part) reward = Math.max(0, round5(reward - partSellPrice(part)));
  // a chart contract covers the chart's sale: never less than selling the chart (sectors §4.3)
  if (t.kind === 'chart') reward = Math.max(reward, chartSellPrice(state.seed, t.sector, securityOverrides(state)));
  return { seconds, reward, rep: contractRep(seconds), bounty, goods, data: contractData(offer, seconds), part };
}

/** Data paid for an Institute contract (Survey, Exploration, Retrieval – 3.2.2: the endless floor). */
export const contractData = (offer: Pick<ContractOffer, 'faction' | 'ring'>, seconds: number): number =>
  offer.faction === 'institute' ? Math.round((INSTITUTE_DATA_RATE[offer.ring] * seconds) / 3600) : 0;

// ---------------------------------------------------------------------------
// acceptance and cancellation

export type AcceptError = 'contractUnavailable' | 'tooManyContracts';

export function acceptOffer(state: SimState, station: StationDef, offerId: string): Contract | AcceptError {
  const career = state.career;
  if (career.contracts.length >= MAX_ACTIVE_CONTRACTS) return 'tooManyContracts';
  const board = ensureBoard(state, station);
  const index = board.offers.findIndex((o) => o.id === offerId);
  if (index < 0) return 'contractUnavailable';
  const offer = board.offers[index]!;
  if (offer.target.kind === 'captain') {
    const c = offer.target.captain;
    if (career.captains.get(c)?.defeated || career.contracts.some((x) => x.target.kind === 'captain' && x.target.captain === c)) {
      return 'contractUnavailable';
    }
  }
  // a fortress pays one contract at a time, and an offer older than its fall is stale (I8)
  if (offer.target.kind === 'fortress') {
    const id = offer.target.fortress;
    if (!fortressAlive(fortressStatus(state, id)) || career.contracts.some((x) => x.target.kind === 'fortress' && x.target.fortress === id)) {
      return 'contractUnavailable';
    }
  }
  // a chart contract needs a sector still to chart and to sell, under no other contract
  if (offer.target.kind === 'chart') {
    const id = offer.target.sector;
    if (state.regions.sold.has(id) || reservedCharts(state).has(id) || sectorKnowledge(state, id) === 'charted') return 'contractUnavailable';
  }
  // a Guild relay slip (M4d) of a lane secured since, or while another relay contract is active, is stale
  if (offer.target.kind === 'relay' && !relayOfferAvailable(state, offer.target)) return 'contractUnavailable';
  const quote = quoteOffer(state, offer);
  board.offers.splice(index, 1);
  const contract: Contract = {
    ...structuredClone(offer),
    serial: career.nextId++,
    acceptedTick: state.tick,
    seconds: quote.seconds,
    reward: quote.reward,
    part: quote.part,
    rep: quote.rep,
    ...(quote.data > 0 ? { data: quote.data } : {}),
    progress: 0,
    base: offer.target.kind === 'mining' ? state.stats.mined[offer.target.resource] : 0,
    ready: false,
  };
  // the hunted group appears at once (even if the player scattered it recently)
  if (offer.target.kind === 'hunt') for (const id of offer.target.slots) state.combat.defeated.delete(id);
  career.contracts.push(contract);
  return contract;
}

/** A slip from a contract (to put back on the board). */
function offerOf(c: Contract): ContractOffer {
  return {
    id: c.id,
    type: c.type,
    faction: c.faction,
    station: c.station,
    ring: c.ring,
    risk: c.risk,
    target: c.target,
    modifiers: c.modifiers,
    bonus: c.bonus,
    part: c.part,
  };
}

/**
 * Would a cancel of this contract be free now? Within 2 min of the acceptance, unless it was already fought:
 * a hunt with kills counted or an escort under way never goes back on the board – accept → kill → cancel →
 * accept would respawn the group for its loot again and again (M12, saboteur G2).
 */
export function cancelIsFree(state: SimState, c: Contract): boolean {
  const fought = (c.target.kind === 'hunt' && c.progress > 0) || (c.target.kind === 'escort' && escortUnderway(state, c.serial));
  return state.tick - c.acceptedTick <= FREE_CANCEL_TICKS && !fought;
}

/** Cancels a contract. Free (`cancelIsFree` – the slip goes back on the board), else "give up" without a penalty. */
export function abandon(state: SimState, serial: number): { refunded: boolean } | null {
  const career = state.career;
  const i = career.contracts.findIndex((c) => c.serial === serial);
  if (i < 0) return null;
  const c = career.contracts[i]!;
  // asked before the removal (the escort record is read, not the contract list)
  const refunded = cancelIsFree(state, c);
  career.contracts.splice(i, 1);
  const board = career.boards.get(c.station);
  if (refunded && board && board.epoch === offerEpoch(c.id) && board.offers.length < BOARD_MAX_OFFERS) board.offers.push(offerOf(c));
  return { refunded };
}

/** A new slip on the station board after a contract is done (refresh on completion, 8.3). */
export function refillBoard(state: SimState, stationId: StationId): void {
  const board = state.career.boards.get(stationId);
  const station = stationById(state.seed, stationId);
  if (!board || !station || board.epoch !== boardEpoch(state.tick) || board.offers.length >= BOARD_MAX_OFFERS) return;
  const offer = generateOffer(boardContext(state, station), board.serial++);
  const dup = (kind: 'captain' | 'fortress') => offer?.target.kind === kind && board.offers.some((o) => o.target.kind === kind);
  const t = offer?.target;
  const dupChart = t?.kind === 'chart' && board.offers.some((o) => o.target.kind === 'chart' && o.target.sector === t.sector);
  if (offer && !dup('captain') && !dup('fortress') && !dupChart) board.offers.push(offer);
}
