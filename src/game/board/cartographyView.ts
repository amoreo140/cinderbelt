// The Cartography section of a station Board (sectors design §4.2, stage 2): the player's own charts
// the Guild buys (price, depth, security, sold / under contract) and the Guild charts for sale (price,
// what a chart reveals), nearest to the station first. Pure data from the simulation (sim/charts) in the
// current language; Board.tsx draws it and asks for confirmation before a trade.
import { tx } from '../../i18n';
import { cartography, type ChartError, type ChartStatus } from '../../sim/charts/charts';
import { securityOverrides } from '../../sim/pirates/sectors';
import type { Depth, Knowledge, Security } from '../../sim/regions/constants';
import type { SecurityOverrides } from '../../sim/regions/world';
import { sectorInfo, sectorSecurity } from '../../sim/regions/sectors';
import type { SimState } from '../../sim/Simulation';
import type { StationDef } from '../../sim/world/stations';
import { RINGS } from '../../sim/world/rings';
import { formatCredits, formatInt } from '../../ui/format';
import { sectorName } from '../../ui/sectors/sectorText';

/** Guild charts shown at most (the nearest ones); the rest is a "+ n more" line. */
export const CARTOGRAPHY_BUY_LIMIT = 8;

export type ChartRowState = 'sellable' | 'sold' | 'reserved' | 'buyable' | 'blocked';

export interface ChartRow {
  id: string;
  /** The player sells this chart to the Guild, or buys it from the Guild. */
  side: 'sell' | 'buy';
  name: string;
  depth: Depth;
  /** "depth 2 · Outer belts". */
  depthLine: string;
  security: Security;
  securityWord: string;
  knowledge: Knowledge;
  glyph: string;
  price: number;
  priceText: string;
  /** "survey points 4/4" or "charted by flight" (own charts), what it reveals (Guild charts). */
  detail: string;
  /** "1 200 u from the station". */
  distance: string;
  state: ChartRowState;
  /** Why the action is refused (a disabled button's reason), or null. */
  reason: string | null;
}

export interface CartographyView {
  sell: ChartRow[];
  buy: ChartRow[];
  /** Guild charts beyond the limit (farther from the station). */
  more: number;
  /** Sellable charts right now and what they would pay together ("2 · 400 cr"). */
  sellable: { count: number; credits: number; text: string };
}

const reasonOf = (error: ChartError | null): string | null => (error ? tx().actionErrors[error] : null);

function rowOf(state: SimState, c: ChartStatus, from: { x: number; y: number }, overrides: SecurityOverrides): ChartRow {
  const info = sectorInfo(state.seed, c.id)!;
  const t = tx().sectors;
  const ch = t.charts;
  const security = sectorSecurity(state.seed, c.id, overrides);
  const ring = tx().rings[Math.min(RINGS.length, info.depth) - 1] ?? '';
  const dist = Math.hypot(info.anchor.x - from.x, info.anchor.y - from.y);
  let rowState: ChartRowState;
  if (c.trade === 'player') rowState = c.sold ? 'sold' : c.reserved ? 'reserved' : c.blocker ? 'blocked' : 'sellable';
  else rowState = c.blocker ? 'blocked' : 'buyable';
  const detail = c.trade === 'guild' ? ch.reveals : c.points.total > 0 && c.points.done >= c.points.total ? ch.points(c.points.done, c.points.total) : ch.byFlight;
  return {
    id: c.id,
    side: c.trade === 'player' ? 'sell' : 'buy',
    name: sectorName(info.name),
    depth: info.depth,
    depthLine: t.depth(info.depth, ring),
    security,
    securityWord: t.security[security],
    knowledge: c.knowledge,
    glyph: t.glyph[c.knowledge],
    price: c.price,
    priceText: formatCredits(c.price),
    detail,
    distance: ch.distance(`${formatInt(Math.round(dist))} ${tx().hud.distanceUnit}`),
    state: rowState,
    // sold / reserved rows say so in their state; only a refused trade carries a reason
    reason: rowState === 'blocked' ? reasonOf(c.blocker) : null,
  };
}

/** The Cartography section of a station's Board. */
export function cartographyView(state: SimState, station: Pick<StationDef, 'pos'>, limit = CARTOGRAPHY_BUY_LIMIT): CartographyView {
  const c = cartography(state, station);
  const overrides = securityOverrides(state);
  const sell = c.sell.map((s) => rowOf(state, s, station.pos, overrides));
  const buy = c.buy.slice(0, limit).map((s) => rowOf(state, s, station.pos, overrides));
  const sellable = sell.filter((r) => r.state === 'sellable');
  const credits = sellable.reduce((s, r) => s + r.price, 0);
  return {
    sell,
    buy,
    more: Math.max(0, c.buy.length - limit),
    sellable: { count: sellable.length, credits, text: `${sellable.length} · ${formatCredits(credits)}` },
  };
}
