// Contract generator (long-term design 8.3): template × place × modifier in game time.
// A slip is a pure function of the seed, the station, the board's epoch, its serial and the reputation unlocks.
import {
  BOARD_MAX_OFFERS,
  BOARD_MIN_OFFERS,
  CONTRACT_DEFS,
  DELIVERY_AMOUNT,
  DELIVERY_RANGE,
  HUNT_RANGE,
  MINING_AMOUNT,
  FORTRESS_CONTRACT_RANGE,
  PART_REWARD_CHANCE,
  PLAYABLE_CONTRACT_TYPES,
  RESCUE_DISTANCE,
  RESCUE_FUEL,
  RETRIEVE_DISTANCE,
  RETRIEVE_PARTS,
  SCAN_DISTANCE,
  SURVEY_BUOYS,
  SURVEY_DISTANCE,
  SURVEY_SPREAD,
  type ContractRisk,
  type ContractType,
} from '../../data/contracts';
import type { RingIndex } from '../../data/economy';
import type { RepUnlock } from '../../data/factions';
import { partKey, type PartKey } from '../../data/parts';
import { PLAN_IDS } from '../../data/plans';
import { poisNear } from '../discovery/poi';
import { RESOURCE_IDS, type ResourceId } from '../../data/resources';
import { spawnSlots, type SpawnSlot } from '../combat/enemies';
import { TAU } from '../math/angle';
import { fnv1a32 } from '../math/fnv1a';
import { createRng, type Rng } from '../math/rng';
import { length, type Vec2 } from '../math/vec2';
import { sectorAt, sectorBonus } from '../sector/sector';
import type { EnemyDensity } from '../settings';
import { chunkCoord, CHUNK_SIZE } from '../world/chunks';
import { hash3 } from '../world/hash';
import { ringIndexAt, RINGS } from '../world/rings';
import { stationsInArea, type StationDef } from '../world/stations';
import type { BoardState, ContractOffer, ContractTarget } from '../career/types';
import type { ChartCandidate } from '../charts/charts';
import { escortAvailable, escortOffer } from '../convoys/escort';
import { relayOffer } from '../guild/relayChain';
import type { GuildRelaySite } from '../guild/types';
import type { SecurityOverrides } from '../regions';

const CONTRACT_SALT = 0xc0a7_3a17;

/** Exclusive rewards – T2 parts in ring 1 (they cannot be bought there otherwise). */
export const PART_REWARD_POOL: readonly PartKey[] = ['engine:2', 'miningLaser:2', 'cargo:2', 'gyro:2', 'fuelTank:2', 'armor:2', 'reactor:2'];
/** Chance that a hunt slip targets a named captain (with the Guild licence 3). */
export const CAPTAIN_HUNT_CHANCE = 0.35;
/** Middle of the ring where the captains fly. */
const CAPTAIN_RING_DISTANCE: Record<RingIndex, number> = { 1: 1000, 2: 2700, 3: 6000, 4: 9500 };

export interface CaptainCandidate {
  index: number;
  ring: RingIndex;
  /** The captain has destroyed the player – a hunt prefers him (revenge). */
  grudge?: boolean;
}

/** Chance that a captain hunt picks the one who destroyed the player (if any). */
export const REVENGE_CHANCE = 0.6;

export interface BoardContext {
  seed: number;
  station: StationDef;
  /** The board's epoch. */
  epoch: number;
  /** Game tick (the sector state at issue). */
  tick: number;
  unlocks: ReadonlySet<RepUnlock>;
  density: EnemyDensity;
  /** Captains a hunt can be posted on. */
  captains: readonly CaptainCandidate[];
  /** Fortresses standing now (M3.6) – only those can be a contract target. */
  fortresses?: readonly { id: string; pos: Vec2 }[];
  /** Sectors a `chart` contract can target (sectors stage 2, charts.ts `chartContractCandidates`). */
  charts?: readonly ChartCandidate[];
  /** The "First chart" target (home board after the Guild Training, until the first chart is sold). */
  firstChart?: ChartCandidate | null;
  /** Guild relay sites a relay contract may be pinned for (M4d, guild `relayContractSites`). */
  relays?: readonly GuildRelaySite[];
  /** Security overrides now (M4d escort: its stretch must cross a sector dangerous by the current security). */
  security?: SecurityOverrides;
}

const between = (rng: Rng, [lo, hi]: readonly [number, number]): number => lo + rng() * (hi - lo);
const round5 = (x: number): number => Math.max(5, Math.round(x / 5) * 5);
const polar = (center: Vec2, angle: number, d: number): Vec2 => ({ x: center.x + Math.cos(angle) * d, y: center.y + Math.sin(angle) * d });
const ringOf = (p: Vec2): RingIndex => ringIndexAt(length(p));

/** Resources mined in the ring. */
const ringResources = (ring: RingIndex): ResourceId[] => RESOURCE_IDS.filter((r) => (RINGS[ring - 1]!.weights[r] ?? 0) > 0);

function pickOne<T>(rng: Rng, list: readonly T[]): T | null {
  return list.length === 0 ? null : list[Math.min(list.length - 1, Math.floor(rng() * list.length))]!;
}

function pickWeighted(rng: Rng, types: readonly ContractType[]): ContractType | null {
  let total = 0;
  for (const t of types) total += CONTRACT_DEFS[t].weight;
  let r = rng() * total;
  for (const t of types) {
    r -= CONTRACT_DEFS[t].weight;
    if (r < 0) return t;
  }
  return types[types.length - 1] ?? null;
}

/** Is the type unlocked by reputation in this ring? */
export const typeUnlocked = (unlocks: ReadonlySet<RepUnlock>, type: ContractType, ring: RingIndex): boolean => {
  const u = CONTRACT_DEFS[type].unlock[ring];
  return u !== undefined && unlocks.has(u) && !CONTRACT_DEFS[type].since;
};

/** Types the station can post (a hunt also into the next outer ring). */
function candidateTypes(ctx: BoardContext): ContractType[] {
  const ring = ctx.station.ring;
  return PLAYABLE_CONTRACT_TYPES.filter((t) => {
    if (t === 'hunt') {
      const outer = Math.min(4, ring + 1) as RingIndex;
      return typeUnlocked(ctx.unlocks, t, ring) || typeUnlocked(ctx.unlocks, t, outer) || (ctx.unlocks.has('captainHunts') && ctx.captains.length > 0);
    }
    // a fortress slip only when a standing fortress is within reach
    if (t === 'fortress') return typeUnlocked(ctx.unlocks, t, ring) && (ctx.fortresses ?? []).some((f) => Math.hypot(f.pos.x - ctx.station.pos.x, f.pos.y - ctx.station.pos.y) <= FORTRESS_CONTRACT_RANGE);
    // a chart slip only when a sector to chart is in reach and unlocked for its depth
    if (t === 'chart') return chartCandidates(ctx).length > 0;
    // an escort only at stations near a Guild Lane (M4d); the relay contract is only pinned, never rolled
    if (t === 'escort') return typeUnlocked(ctx.unlocks, t, ring) && escortAvailable(ctx);
    if (t === 'relay') return false;
    return typeUnlocked(ctx.unlocks, t, ring);
  });
}

/** A slip before its id, faction, modifiers and part (the generators of each type; M4d relay / escort hooks). */
export interface ContractDraft {
  ring: RingIndex;
  risk: ContractRisk;
  target: ContractTarget;
  /** Where the contract takes place (sector state). */
  where: Vec2;
}

type Draft = ContractDraft;

function delivery(ctx: BoardContext, rng: Rng): Draft | null {
  const s = ctx.station;
  const reach = Math.ceil(DELIVERY_RANGE / CHUNK_SIZE);
  const cx = s.chunk.cx;
  const cy = s.chunk.cy;
  const targets = stationsInArea(ctx.seed, cx - reach, cx + reach, cy - reach, cy + reach).filter((t) => {
    if (t.id === s.id) return false;
    const d = Math.hypot(t.pos.x - s.pos.x, t.pos.y - s.pos.y);
    return d <= DELIVERY_RANGE && typeUnlocked(ctx.unlocks, 'delivery', t.ring);
  });
  const to = pickOne(rng, targets);
  const resource = pickOne(rng, ringResources(s.ring));
  if (!to || !resource) return null;
  const amount = round5(between(rng, DELIVERY_AMOUNT[resource]));
  return { ring: to.ring, risk: to.ring >= 2 ? 0.25 : 0, target: { kind: 'delivery', resource, amount, to: to.id }, where: to.pos };
}

function mining(ctx: BoardContext, rng: Rng): Draft | null {
  const resource = pickOne(rng, ringResources(ctx.station.ring));
  if (!resource) return null;
  const amount = round5(between(rng, MINING_AMOUNT));
  const ring = ctx.station.ring;
  return { ring, risk: ring >= 2 ? 0.25 : 0, target: { kind: 'mining', resource, amount }, where: ctx.station.pos };
}

function rescue(ctx: BoardContext, rng: Rng): Draft | null {
  const pos = polar(ctx.station.pos, rng() * TAU, between(rng, RESCUE_DISTANCE));
  const angle = rng() * TAU;
  const fuel = Math.round(between(rng, RESCUE_FUEL));
  const ring = ringOf(pos);
  if (!typeUnlocked(ctx.unlocks, 'rescue', ring)) return null;
  return { ring, risk: ring >= 2 ? 0.25 : 0, target: { kind: 'rescue', pos, angle, fuel }, where: pos };
}

function survey(ctx: BoardContext, rng: Rng): Draft | null {
  const center = polar(ctx.station.pos, rng() * TAU, between(rng, SURVEY_DISTANCE));
  const turn = rng() * TAU;
  const spread = between(rng, SURVEY_SPREAD);
  const points = Array.from({ length: SURVEY_BUOYS }, (_, i) => polar(center, turn + (i * TAU) / SURVEY_BUOYS, spread));
  const ring = ringOf(center);
  if (!typeUnlocked(ctx.unlocks, 'survey', ring)) return null;
  return { ring, risk: ring >= 2 ? 0.25 : 0, target: { kind: 'survey', points }, where: center };
}

/** Survey (M3.5b): scan an anomaly, a giant asteroid or a wreck near the station. */
function scan(ctx: BoardContext, rng: Rng): Draft | null {
  const s = ctx.station;
  const [lo, hi] = SCAN_DISTANCE;
  const places = poisNear(ctx.seed, s.pos, hi).filter((p) => p.kind !== 'cache' && Math.hypot(p.pos.x - s.pos.x, p.pos.y - s.pos.y) >= lo);
  const poi = pickOne(rng, places);
  if (!poi || poi.kind === 'cache') return null;
  const ring = ringOf(poi.pos);
  if (!typeUnlocked(ctx.unlocks, 'scan', ring)) return null;
  return { ring, risk: ring >= 2 ? 0.25 : 0, target: { kind: 'scan', poi: poi.id, what: poi.kind, pos: { ...poi.pos } }, where: poi.pos };
}

/** Retrieval (M3.5b): a wreck with an Institute part; the reward includes a plan fragment. */
function retrieve(ctx: BoardContext, rng: Rng): Draft | null {
  const s = ctx.station;
  const pos = polar(s.pos, rng() * TAU, between(rng, RETRIEVE_DISTANCE));
  const angle = rng() * TAU;
  const ring = ringOf(pos);
  const part = partKey(pickOne(rng, RETRIEVE_PARTS)!, ring >= 2 ? 2 : 1);
  const plan = pickOne(rng, PLAN_IDS)!;
  if (!typeUnlocked(ctx.unlocks, 'retrieve', ring)) return null;
  return { ring, risk: ring >= 2 ? 0.25 : 0, target: { kind: 'retrieve', pos, angle, part, plan }, where: pos };
}

/** Destroy the fortress (M3.6): the nearest standing fortress within reach of the station. */
function fortress(ctx: BoardContext): Draft | null {
  const s = ctx.station;
  let best: { id: string; pos: Vec2 } | null = null;
  let bestD = FORTRESS_CONTRACT_RANGE;
  for (const f of ctx.fortresses ?? []) {
    const d = Math.hypot(f.pos.x - s.pos.x, f.pos.y - s.pos.y);
    if (d <= bestD) {
      best = f;
      bestD = d;
    }
  }
  if (!best) return null;
  const ring = ringOf(best.pos);
  if (!typeUnlocked(ctx.unlocks, 'fortress', ring)) return null;
  return { ring, risk: 0.5, target: { kind: 'fortress', fortress: best.id, pos: { ...best.pos } }, where: best.pos };
}

/** Chart risk by the sector's security (Quiet / Guarded none, Contested 0.25, Pirate 0.5). */
const CHART_RISK = { quiet: 0, guarded: 0, contested: 0.25, pirate: 0.5 } as const;

const chartCandidates = (ctx: BoardContext): ChartCandidate[] =>
  (ctx.charts ?? []).filter((c) => c.depth <= 3 && typeUnlocked(ctx.unlocks, 'chart', c.depth as RingIndex));

function chartDraft(c: ChartCandidate, first: boolean): Draft {
  const target: ContractTarget = { kind: 'chart', sector: c.id, pos: { ...c.anchor }, points: c.points, ...(first ? { first: true as const } : {}) };
  return { ring: Math.min(4, c.depth) as RingIndex, risk: CHART_RISK[c.security], target, where: c.anchor };
}

/** Chart a sector (sectors stage 2): one of the candidates in reach of the station. */
function chart(ctx: BoardContext, rng: Rng): Draft | null {
  const c = pickOne(rng, chartCandidates(ctx));
  return c ? chartDraft(c, false) : null;
}

/**
 * Risk of a hunt contract on a regular group: led by a Hammer or a Gunner 0.5, Jackals only 0.25. The M4b
 * Gunner leader roll replaces slot 0 (often the Hammer), and a Gunner-led group is as dangerous.
 */
export function huntRisk(slots: readonly Pick<SpawnSlot, 'kind'>[]): ContractRisk {
  return slots.some((x) => x.kind === 'hammer' || x.kind === 'gunner') ? 0.5 : 0.25;
}

function huntGroup(ctx: BoardContext, rng: Rng): Draft | null {
  const s = ctx.station;
  for (let i = 0; i < 24; i++) {
    const p = polar(s.pos, rng() * TAU, between(rng, [300, HUNT_RANGE]));
    const cx = chunkCoord(p.x);
    const cy = chunkCoord(p.y);
    const ring = ringOf({ x: (cx + 0.5) * CHUNK_SIZE, y: (cy + 0.5) * CHUNK_SIZE });
    if (!typeUnlocked(ctx.unlocks, 'hunt', ring)) continue;
    const slots = spawnSlots(ctx.seed, cx, cy, ctx.density);
    if (slots.length === 0) continue;
    return { ring, risk: huntRisk(slots), target: { kind: 'hunt', cx, cy, slots: slots.map((x) => x.id), pos: { ...slots[0]!.home } }, where: slots[0]!.home };
  }
  return null;
}

function huntCaptain(ctx: BoardContext, rng: Rng): Draft | null {
  const grudges = ctx.captains.filter((x) => x.grudge);
  const revenge = rng() < REVENGE_CHANCE;
  const c = pickOne(rng, revenge && grudges.length > 0 ? grudges : ctx.captains);
  if (!c) return null;
  const s = ctx.station;
  const base = length(s.pos) > 1 ? Math.atan2(s.pos.y, s.pos.x) : rng() * TAU;
  const angle = base + (rng() - 0.5);
  const pos = polar({ x: 0, y: 0 }, angle, CAPTAIN_RING_DISTANCE[c.ring] + (rng() - 0.5) * 300);
  return { ring: c.ring, risk: 0.5, target: { kind: 'captain', captain: c.index, pos }, where: pos };
}

/** Slip number `serial` of the station's board in this epoch, or null (nothing unlocked fits). */
export function generateOffer(ctx: BoardContext, serial: number): ContractOffer | null {
  const rng = createRng(hash3(hash3(ctx.seed ^ CONTRACT_SALT, fnv1a32(ctx.station.id), ctx.epoch), serial, 0));
  const type = pickWeighted(rng, candidateTypes(ctx));
  if (!type) return null;
  let draft: Draft | null = null;
  switch (type) {
    case 'delivery':
      draft = delivery(ctx, rng);
      break;
    case 'mining':
      draft = mining(ctx, rng);
      break;
    case 'rescue':
      draft = rescue(ctx, rng);
      break;
    case 'survey':
      draft = survey(ctx, rng);
      break;
    case 'scan':
      draft = scan(ctx, rng);
      break;
    case 'retrieve':
      draft = retrieve(ctx, rng);
      break;
    case 'fortress':
      draft = fortress(ctx);
      break;
    case 'chart':
      draft = chart(ctx, rng);
      break;
    case 'escort':
      draft = escortOffer(ctx, rng);
      break;
    case 'hunt': {
      const captain = ctx.unlocks.has('captainHunts') && ctx.captains.length > 0 && rng() < CAPTAIN_HUNT_CHANCE;
      draft = captain ? huntCaptain(ctx, rng) : (huntGroup(ctx, rng) ?? (ctx.unlocks.has('captainHunts') ? huntCaptain(ctx, rng) : null));
      break;
    }
    default:
      draft = null;
  }
  if (!draft) return null;
  const partRoll = rng();
  const part = draft.ring === 1 && type !== 'hunt' && partRoll < PART_REWARD_CHANCE ? pickOne(rng, PART_REWARD_POOL) : null;
  return offerOf(ctx, `${ctx.station.id}@${ctx.epoch}.${serial}`, type, draft, part);
}

function offerOf(ctx: BoardContext, id: string, type: ContractType, draft: Draft, part: PartKey | null): ContractOffer {
  const sector = sectorAt(ctx.seed, draft.where, ctx.tick);
  return {
    id,
    type,
    faction: CONTRACT_DEFS[type].faction,
    station: ctx.station.id,
    ring: draft.ring,
    risk: draft.risk,
    target: draft.target,
    modifiers: sector.modifiers.map((m) => m.id),
    bonus: sectorBonus(sector),
    part,
  };
}

/** The "First chart" offer of a board (`<station>@<epoch>.first`), or null. */
export function firstChartOffer(ctx: BoardContext): ContractOffer | null {
  const c = ctx.firstChart;
  if (!c || !typeUnlocked(ctx.unlocks, 'chart', Math.min(4, c.depth) as RingIndex)) return null;
  return offerOf(ctx, `${ctx.station.id}@${ctx.epoch}.first`, 'chart', chartDraft(c, true), null);
}

/** The pinned Guild relay offer of a board (`<station>@<epoch>.relay`, M4d), or null. */
export function pinnedRelayOffer(ctx: BoardContext): ContractOffer | null {
  const draft = relayOffer(ctx);
  return draft ? offerOf(ctx, `${ctx.station.id}@${ctx.epoch}.relay`, 'relay', draft, null) : null;
}

/** A station's new board: 4–6 slips (fewer when reputation unlocks nothing else). */
export function generateBoard(ctx: BoardContext): BoardState {
  const rng = createRng(hash3(hash3(ctx.seed ^ CONTRACT_SALT, fnv1a32(ctx.station.id), ctx.epoch), 0xffff, 1));
  const count = BOARD_MIN_OFFERS + Math.floor(rng() * (BOARD_MAX_OFFERS - BOARD_MIN_OFFERS + 1));
  const offers: ContractOffer[] = [];
  const captains = new Set<number>();
  const charts = new Set<string>();
  // "First chart" leads the home board after the training (it never draws from the board's stream)
  const first = firstChartOffer(ctx);
  if (first && first.target.kind === 'chart') {
    offers.push(first);
    charts.add(first.target.sector);
  }
  // the Guild relay contract (M4d) is pinned too – never rotated away within the epoch
  const relay = pinnedRelayOffer(ctx);
  if (relay) offers.push(relay);
  let fortress = false;
  for (let serial = 0; serial < count; serial++) {
    const offer = generateOffer(ctx, serial);
    if (!offer) continue;
    // one slip per sector to chart
    if (offer.target.kind === 'chart') {
      if (charts.has(offer.target.sector)) continue;
      charts.add(offer.target.sector);
    }
    // one fortress slip per board
    if (offer.target.kind === 'fortress') {
      if (fortress) continue;
      fortress = true;
    }
    // one captain on one slip only
    if (offer.target.kind === 'captain') {
      if (captains.has(offer.target.captain)) continue;
      captains.add(offer.target.captain);
    }
    offers.push(offer);
  }
  return { epoch: ctx.epoch, serial: count, offers: offers.slice(0, BOARD_MAX_OFFERS) };
}
