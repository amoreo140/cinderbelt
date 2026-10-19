// Sector charts as a commodity (sectors design §4.2–4.4, stage 2): who trades which chart, prices,
// the Cartography section of a station Board, and the buy / sell actions. Credits only – Data are
// never bought or sold; a bought chart reveals a sector (Charted, its stations discovered, its
// neighbours Reported) but never caches, Echoes or wreck contents, and pays no Data.
//
// Trade rules:
//  - the Guild SELLS (the player may buy) the charts of Guarded sectors and of sectors a Guild Lane
//    runs through;
//  - the Guild BUYS (the player may sell) only the player's own chart (charted by flight coverage or by
//    survey points) of every other finite sector (Quiet, Contested, Pirate; depth 1–3), once per game –
//    `regions.sold` is saved; a `chart` contract covers the sale (its sector is marked sold);
//  - a bought chart can never be sold (the two sets of sectors never overlap), Origin is never traded.
import { CHART_CONTRACT_RANGE, CHART_PRICES } from '../../data/charts';
import { MIN_REFERENCE_INCOME } from '../../data/contracts';
import type { RingIndex } from '../../data/economy';
import type { Vec2 } from '../math/vec2';
import { securityOverrides } from '../pirates/sectors';
import {
  ownChart,
  regionWorld,
  sectorChunkKeys,
  sectorInfo,
  sectorKnowledge,
  sectorSecurity,
  surveyPoints,
  type Depth,
  type Knowledge,
  type Security,
  type SecurityOverrides,
} from '../regions';
import type { SimEvent, SimState } from '../Simulation';
import { stationAt, type StationDef, type StationId } from '../world/stations';

/** Who sells a sector's chart: the Guild ('guild') or the player ('player'); null = no trade. */
export type ChartTrade = 'guild' | 'player';

/** Why a chart action is refused. */
export type ChartError =
  /** Not a tradeable chart (unknown id, Origin, depth 4+, the wrong side of the trade). */
  | 'chartUnavailable'
  /** Sell: the sector is not charted by the player yet. Buy: the sector is Charted already. */
  | 'chartNotCharted'
  | 'chartAlreadyCharted'
  /** Sold once already (or through a `chart` contract). */
  | 'chartSold'
  /** An active `chart` contract covers this sector – the contract pays its sale. */
  | 'chartReserved'
  | 'notEnoughCredits';

/** Rounded to 50 cr, a half down (the design table: 2 125 → 2 100), at least 50. */
const round50 = (x: number): number => Math.max(CHART_PRICES.round, Math.ceil(x / CHART_PRICES.round - 0.5) * CHART_PRICES.round);

const incomeOf = (depth: Depth): number => MIN_REFERENCE_INCOME[Math.min(4, depth) as RingIndex];

/** Who trades a sector's chart (null: unknown, Origin, depth 4+ or outside the rastered world). */
export function chartTrade(seed: number, id: string): ChartTrade | null {
  const info = sectorInfo(seed, id);
  if (!info || info.origin || info.depth > CHART_PRICES.maxDepth || !regionWorld(seed).info(id)) return null;
  return info.security === 'guarded' || info.onLane ? 'guild' : 'player';
}

const meanArea = new WeakMap<object, Map<Depth, number>>();

/** Size multiplier of a sector's sale price: its area / the average area of its depth, clamped. */
export function chartSizeMultiplier(seed: number, id: string): number {
  const world = regionWorld(seed);
  const r = world.info(id);
  if (!r) return 1;
  let means = meanArea.get(world);
  if (!means) {
    means = new Map();
    for (const d of [1, 2, 3] as const) {
      const list = world.regions.filter((x) => x.seed.depth === d);
      means.set(d, list.reduce((s, x) => s + x.area, 0) / Math.max(1, list.length));
    }
    meanArea.set(world, means);
  }
  const mean = means.get(r.seed.depth) ?? r.area;
  const [lo, hi] = CHART_PRICES.size;
  return mean > 0 ? Math.min(hi, Math.max(lo, r.area / mean)) : 1;
}

/** Sale price of a player-traded chart (0 for any other sector); the security is the current one. */
export function chartSellPrice(seed: number, id: string, overrides?: SecurityOverrides): number {
  if (chartTrade(seed, id) !== 'player') return 0;
  const info = sectorInfo(seed, id)!;
  const security: Security = sectorSecurity(seed, id, overrides);
  return round50(CHART_PRICES.sellHours * incomeOf(info.depth) * CHART_PRICES.security[security] * chartSizeMultiplier(seed, id));
}

/** Price of a Guild chart (0 for a sector the Guild does not sell). */
export function chartBuyPrice(seed: number, id: string): number {
  if (chartTrade(seed, id) !== 'guild') return 0;
  return round50(CHART_PRICES.buyHours * incomeOf(sectorInfo(seed, id)!.depth));
}

/** Sectors an active `chart` contract targets. */
export function reservedCharts(state: SimState): Set<string> {
  return new Set(state.career.contracts.flatMap((c) => (c.target.kind === 'chart' ? [c.target.sector] : [])));
}

/** Why the player cannot sell this chart now, or null. */
export function chartSellBlocker(state: SimState, id: string): ChartError | null {
  if (chartTrade(state.seed, id) !== 'player') return 'chartUnavailable';
  if (state.regions.sold.has(id)) return 'chartSold';
  if (!ownChart(state, id)) return 'chartNotCharted';
  if (reservedCharts(state).has(id)) return 'chartReserved';
  return null;
}

/** Why the player cannot buy this chart now, or null. */
export function chartBuyBlocker(state: SimState, id: string): ChartError | null {
  if (chartTrade(state.seed, id) !== 'guild') return 'chartUnavailable';
  if (sectorKnowledge(state, id) === 'charted') return 'chartAlreadyCharted';
  if (state.credits < chartBuyPrice(state.seed, id)) return 'notEnoughCredits';
  return null;
}

/** The status of a sector's chart for the map card and the Cartography list. */
export interface ChartStatus {
  id: string;
  depth: Depth;
  knowledge: Knowledge;
  trade: ChartTrade | null;
  /** Sale price (player charts) or purchase price (Guild charts); 0 = no trade. */
  price: number;
  /** The player charted it themselves (sellable unless sold / reserved). */
  own: boolean;
  bought: boolean;
  sold: boolean;
  /** An active `chart` contract covers it. */
  reserved: boolean;
  /** Survey points of the sector and how many are marked. */
  points: { done: number; total: number };
  /** The sell or buy action would succeed now (null) or why not. */
  blocker: ChartError | null;
}

/** Marked survey points of a sector (popcount of its mask). */
export function surveyProgress(state: SimState, id: string): { done: number; total: number } {
  const total = surveyPoints(state.seed, id).length;
  let mask = (state.regions.points.get(id) ?? 0) & ((1 << total) - 1);
  let done = 0;
  while (mask) {
    done += mask & 1;
    mask >>>= 1;
  }
  return { done, total };
}

/** Chart status of one sector (null for an unknown id). */
export function chartStatus(state: SimState, id: string): ChartStatus | null {
  const info = sectorInfo(state.seed, id);
  if (!info) return null;
  const trade = chartTrade(state.seed, id);
  const price = trade === 'player' ? chartSellPrice(state.seed, id, securityOverrides(state)) : trade === 'guild' ? chartBuyPrice(state.seed, id) : 0;
  return {
    id,
    depth: info.depth,
    knowledge: sectorKnowledge(state, id),
    trade,
    price,
    own: ownChart(state, id),
    bought: state.regions.bought.has(id),
    sold: state.regions.sold.has(id),
    reserved: reservedCharts(state).has(id),
    points: surveyProgress(state, id),
    blocker: trade === 'player' ? chartSellBlocker(state, id) : trade === 'guild' ? chartBuyBlocker(state, id) : 'chartUnavailable',
  };
}

/** The Cartography section of a station Board. */
export interface Cartography {
  /** The player's own charts the Guild buys (sellable ones first, then reserved; sold ones last). */
  sell: ChartStatus[];
  /** Guild charts of sectors the player has not Charted yet, nearest to the station first. */
  buy: ChartStatus[];
}

const anchorDistance = (seed: number, id: string, from: Vec2): number => {
  const a = sectorInfo(seed, id)?.anchor ?? { x: 0, y: 0 };
  return Math.hypot(a.x - from.x, a.y - from.y);
};

/** Cartography of a station (any station with a Board – every station has one). */
export function cartography(state: SimState, station: Pick<StationDef, 'pos'>): Cartography {
  const sell: ChartStatus[] = [];
  const buy: ChartStatus[] = [];
  for (const r of regionWorld(state.seed).regions) {
    const id = r.seed.id;
    const trade = chartTrade(state.seed, id);
    if (trade === 'player') {
      if (!ownChart(state, id)) continue;
      sell.push(chartStatus(state, id)!);
    } else if (trade === 'guild') {
      if (sectorKnowledge(state, id) === 'charted') continue;
      buy.push(chartStatus(state, id)!);
    }
  }
  const rank = (c: ChartStatus) => (c.sold ? 2 : c.reserved ? 1 : 0);
  const near = (a: ChartStatus, b: ChartStatus) => anchorDistance(state.seed, a.id, station.pos) - anchorDistance(state.seed, b.id, station.pos) || (a.id < b.id ? -1 : 1);
  sell.sort((a, b) => rank(a) - rank(b) || near(a, b));
  buy.sort(near);
  return { sell, buy };
}

/**
 * The stations of a sector become discovered (a bought chart, the training chart). Returns their ids
 * and pushes a `stationDiscovered` event for each new one.
 */
export function discoverSectorStations(state: SimState, id: string, events: SimEvent[]): StationId[] {
  const field = regionWorld(state.seed).field;
  const out: StationId[] = [];
  for (const key of sectorChunkKeys(state.seed, id)) {
    const comma = key.indexOf(',');
    const s = stationAt(state.seed, Number(key.slice(0, comma)), Number(key.slice(comma + 1)), state.world.gen);
    if (!s || field.regionAt(s.pos.x, s.pos.y).id !== id || state.world.discovered.has(s.id)) continue;
    state.world.discovered.add(s.id);
    events.push({ type: 'stationDiscovered', stationId: s.id });
    out.push(s.id);
  }
  return out;
}

/** Sell the player's own chart of a sector to the Guild (docked). */
export function sellChart(state: SimState, id: string, events: SimEvent[]): ChartError | null {
  const blocker = chartSellBlocker(state, id);
  if (blocker) return blocker;
  const credits = chartSellPrice(state.seed, id, securityOverrides(state));
  state.regions.sold.add(id);
  state.credits += credits;
  events.push({ type: 'creditsChanged', delta: credits, reason: 'chart' }, { type: 'chartSold', id, credits });
  return null;
}

/** Buy a Guild chart (docked): the sector is Charted, its stations discovered, its neighbours Reported. */
export function buyChart(state: SimState, id: string, events: SimEvent[]): ChartError | null {
  const blocker = chartBuyBlocker(state, id);
  if (blocker) return blocker;
  const credits = chartBuyPrice(state.seed, id);
  state.credits -= credits;
  state.regions.bought.add(id);
  events.push({ type: 'creditsChanged', delta: -credits, reason: 'chart' }, { type: 'chartBought', id, credits });
  discoverSectorStations(state, id, events);
  return null;
}

/** A sector a `chart` contract can target. */
export interface ChartCandidate {
  id: string;
  depth: Depth;
  anchor: Vec2;
  security: Security;
  points: number;
}

const candidateOf = (state: SimState, id: string): ChartCandidate => {
  const info = sectorInfo(state.seed, id)!;
  return { id, depth: info.depth, anchor: { ...info.anchor }, security: sectorSecurity(state.seed, id, securityOverrides(state)), points: surveyPoints(state.seed, id).length };
};

/** Player-traded sectors not Charted, not sold and not under contract, anchor within reach of a station (id order). */
export function chartContractCandidates(state: SimState, from: Vec2, range = CHART_CONTRACT_RANGE): ChartCandidate[] {
  const reserved = reservedCharts(state);
  const out: ChartCandidate[] = [];
  for (const r of regionWorld(state.seed).regions) {
    const id = r.seed.id;
    if (chartTrade(state.seed, id) !== 'player' || state.regions.sold.has(id) || reserved.has(id)) continue;
    if (Math.hypot(r.seed.x - from.x, r.seed.y - from.y) > range || sectorKnowledge(state, id) === 'charted') continue;
    out.push(candidateOf(state, id));
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The target of "First chart" (§4.3, §6.6): the nearest depth-1 sector the player can chart and sell
 * (not the pirate corner), Uncharted ones first, then Reported; a depth-2 one when depth 1 has none.
 * Null once the player has sold any chart, while the training runs, or when nothing fits.
 */
export function firstChartTarget(state: SimState): ChartCandidate | null {
  if (state.career.training.status === 'active' || state.regions.sold.size > 0) return null;
  const world = regionWorld(state.seed);
  const reserved = reservedCharts(state);
  let best: { id: string; rank: number; d: number } | null = null;
  for (const r of world.regions) {
    const id = r.seed.id;
    if (r.seed.depth > 2 || chartTrade(state.seed, id) !== 'player' || r.fixed === 'corner1' || r.fixed === 'corner2' || reserved.has(id)) continue;
    const k = sectorKnowledge(state, id);
    if (k === 'charted') continue;
    const rank = (r.seed.depth - 1) * 2 + (k === 'uncharted' ? 0 : 1);
    const d = Math.hypot(r.seed.x, r.seed.y);
    if (!best || rank < best.rank || (rank === best.rank && (d < best.d || (d === best.d && id < best.id)))) best = { id, rank, d };
  }
  return best ? candidateOf(state, best.id) : null;
}
