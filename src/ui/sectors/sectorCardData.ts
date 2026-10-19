// The sector card on the map (sectors design, stage 1b): what
// the player knows about the sector under the cursor (or the pinned one) – name, security, threat,
// depth, environment, knowledge and flown coverage, the known stations and landmarks in it – and the
// risk of the straight route home, from sampling the sectors along the line. Pure data (the words in
// the current language); SectorCard.tsx draws it, MapView decides which sector.
//
// What the card may tell follows §3.3: a sector the player knows nothing about (Uncharted, never
// flown through) is "Unknown sector" with its depth only, and the route counts such sectors as
// "unknown" instead of telling their security.
import { tx } from '../../i18n';
import type { Vec2 } from '../../sim/math/vec2';
import type { Knowledge, Security } from '../../sim/regions/constants';
import { sectorIdAt, sectorInfo, sectorSecurity, sectorThreat } from '../../sim/regions/sectors';
import type { SecurityOverrides } from '../../sim/regions/world';
import { homeStation } from '../../sim/world/stations';
import { RINGS } from '../../sim/world/rings';
import { formatCredits, formatInt } from '../format';
import { sectorName } from './sectorText';

/** Sampling step of the route home (u) – finer than the narrowest sector neck. */
export const ROUTE_STEP = 25;

/**
 * The sectors a straight line from `from` to `to` passes through after it leaves the start sector, in
 * order, each once (a line that leaves a sector and comes back counts it once). The last one is the
 * sector of `to` unless the line never leaves the start sector.
 */
export function sectorsAlong(regionAt: (x: number, y: number) => string, from: Vec2, to: Vec2, step = ROUTE_STEP): string[] {
  const start = regionAt(from.x, from.y);
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const n = Math.max(1, Math.ceil(len / step));
  const seen = new Set<string>([start]);
  const out: string[] = [];
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const id = regionAt(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** A risk on the route home: a dangerous sector, or one the player cannot judge. */
export type RouteRisk = 'pirate' | 'contested' | 'unknown';
export const ROUTE_RISKS: readonly RouteRisk[] = ['pirate', 'contested', 'unknown'];

export interface RouteSummary {
  /** Sectors crossed after leaving this one (the home sector included). */
  sectors: number;
  /** Straight-line distance (u). */
  distance: number;
  /** How many of them are Pirate / Contested / unknown. */
  risks: Record<RouteRisk, number>;
}

/** Counts the route's risks; `security` is null for a sector the player does not know. */
export function routeSummary(ids: readonly string[], distance: number, security: (id: string) => Security | null): RouteSummary {
  const risks: Record<RouteRisk, number> = { pirate: 0, contested: 0, unknown: 0 };
  for (const id of ids) {
    const s = security(id);
    if (s === null) risks.unknown++;
    else if (s === 'pirate' || s === 'contested') risks[s]++;
  }
  return { sectors: ids.length, distance, risks };
}

/** The chart of a sector (stage 2, sim/charts `chartStatus`): survey points, who trades it, its state. */
export interface SectorChart {
  points: { done: number; total: number };
  /** 'player': the Guild buys the player's chart; 'guild': the Guild sells it; null: no trade (Origin). */
  trade: 'player' | 'guild' | null;
  price: number;
  /** The player charted it themselves. */
  own: boolean;
  bought: boolean;
  sold: boolean;
  /** An active `chart` contract covers it. */
  reserved: boolean;
}

/** What the map knows about sectors (sectorsUi.ts → MapSectorsData). */
export interface SectorCardInput {
  seed: number;
  id: string;
  /** Where the route home starts when the sector's seed point lies outside it (the cursor). */
  from: Vec2;
  overrides: SecurityOverrides;
  knowledge: (id: string) => Knowledge;
  /** Flown share 0..1 (§4.1), null when not counted. */
  coverage: (id: string) => number | null;
  /** The sector's chart (stage 2); absent = no chart lines. */
  chart?: (id: string) => SectorChart | null;
  /** The ship's sector. */
  current: string | null;
  /** Stations and landmarks the map shows (discovered / in sight). */
  stations: readonly { name: string; pos: Vec2 }[];
  landmarks: readonly { name: string; pos: Vec2 }[];
}

export interface SectorCardData {
  id: string;
  /** False: "Unknown sector" – no name, security, threat or environment. */
  known: boolean;
  name: string;
  security: Security | null;
  securityWord: string;
  /** "threat: nest". */
  threat: string;
  /** "depth 2 · Outer belts". */
  depth: string;
  /** "Environment: Rust Field" or null. */
  environment: string | null;
  knowledge: Knowledge;
  /** "[?] Reported · flown 35 %". */
  mapping: string;
  /** "Survey points 2/4" with the dots (null = none to show). */
  survey: { line: string; done: number; total: number } | null;
  /** "Chart: the Guild buys it for 250 cr" / "Chart: sold to the Guild" (null = no trade). */
  chart: string | null;
  here: boolean;
  stations: string[];
  landmarks: string[];
  /** Route home: the head line and the risk chips, or the home sector's own line. */
  route: { line: string; risks: { risk: RouteRisk; text: string }[]; clear: string | null } | { home: string };
  /** Where "Trasa sem" leads (M4d route planner): the sector's seed point, or the cursor when it lies outside. */
  target?: Vec2;
}

/** Does the player know this sector well enough to name it and its security (§3.3)? */
export function sectorKnown(id: string, knowledge: Knowledge, coverage: number | null, current: string | null): boolean {
  return knowledge !== 'uncharted' || (coverage ?? 0) > 0 || id === current;
}

/**
 * The chart lines of the card (§5.1 "survey state, map price or Sold"): survey progress while
 * the sector is not Charted (or when it was charted by its points), and what its chart is worth.
 * Only for a sector the player knows (§3.3) – the price would tell an unknown sector's security.
 */
export function chartLines(chart: SectorChart | null, knowledge: Knowledge): Pick<SectorCardData, 'survey' | 'chart'> {
  if (!chart) return { survey: null, chart: null };
  const ch = tx().sectors.charts;
  const p = chart.points;
  const survey = p.total > 0 && (knowledge !== 'charted' || p.done >= p.total) ? { line: ch.cardPoints(p.done, p.total), done: p.done, total: p.total } : null;
  const price = formatCredits(chart.price);
  let line: string | null = null;
  if (chart.trade === 'player') line = chart.sold ? ch.cardSold : chart.reserved ? ch.cardReserved : chart.own ? ch.cardSell(price) : ch.cardToChart(price);
  else if (chart.trade === 'guild') line = chart.bought ? ch.cardBought : knowledge === 'charted' ? null : ch.cardGuild(price);
  return { survey, chart: line };
}

/** The card of sector `id`, or null when it is not a sector of this seed. */
export function sectorCardData(input: SectorCardInput): SectorCardData | null {
  const { seed, id } = input;
  const info = sectorInfo(seed, id);
  if (!info) return null;
  const t = tx().sectors;
  const c = t.card;
  const knowledge = input.knowledge(id);
  const coverage = input.coverage(id);
  const known = sectorKnown(id, knowledge, coverage, input.current);
  const security = known ? sectorSecurity(seed, id, input.overrides) : null;
  const ring = tx().rings[Math.min(RINGS.length, info.depth) - 1] ?? '';
  const inside = (p: Vec2) => sectorIdAt(seed, p.x, p.y) === id;
  const names = (list: readonly { name: string; pos: Vec2 }[]) => [...new Set(list.filter((x) => inside(x.pos)).map((x) => x.name))].sort((a, b) => a.localeCompare(b));

  let route: SectorCardData['route'];
  // the sector's seed point (the label anchor) – the same route wherever the cursor is in it
  const from = inside(info.anchor) ? info.anchor : input.from;
  if (info.origin) route = { home: c.routeHome };
  else {
    const home = homeStation().pos;
    const ids = sectorsAlong((x, y) => sectorIdAt(seed, x, y), from, home);
    const sum = routeSummary(ids, Math.hypot(home.x - from.x, home.y - from.y), (other) =>
      sectorKnown(other, input.knowledge(other), input.coverage(other), input.current) ? sectorSecurity(seed, other, input.overrides) : null,
    );
    const risks = ROUTE_RISKS.filter((r) => sum.risks[r] > 0).map((risk) => ({
      risk,
      text: c.count(sum.risks[risk], risk === 'unknown' ? c.unknownWord : t.security[risk]),
    }));
    route = { line: c.route(sum.sectors, `${formatInt(Math.round(sum.distance))} ${tx().hud.distanceUnit}`), risks, clear: risks.length === 0 ? c.routeClear : null };
  }

  return {
    id,
    known,
    name: known ? sectorName(info.name) : c.unknown,
    security,
    securityWord: security ? t.security[security] : '',
    threat: security ? t.threatLine(t.threat[sectorThreat(info, security)]) : '',
    depth: t.depth(info.depth, ring),
    environment: known ? `${c.environment}: ${t.biome[info.biome]}` : null,
    knowledge,
    mapping: c.mapping(t.glyph[knowledge], t.knowledge[knowledge], coverage === null ? null : Math.floor(Math.min(1, Math.max(0, coverage)) * 100)),
    ...chartLines(known ? (input.chart?.(id) ?? null) : null, knowledge),
    here: id === input.current,
    stations: known ? names(input.stations) : [],
    landmarks: known ? names(input.landmarks) : [],
    route,
    target: { x: from.x, y: from.y },
  };
}
