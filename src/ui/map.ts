// Map maths (10.8): the automatic view (ship, nearest sector border, contract targets), the scale bar,
// zooming around the cursor, the ring name position (debug layer), the label detail level and the
// legend built from the active layers. Pure functions (tests in map.test.ts).
import { NOTE_ICONS, type NoteIcon } from '../data/navigation';
import type { ResourceId } from '../data/resources';
import { SECURITIES, type Knowledge, type Security } from '../sim/regions/constants';
import type { MapLayer, PlaceKind } from '../game/discovery/exploreUi';
import { isRich } from '../sim/mining/grade';
import type { Vec2 } from '../sim/math/vec2';
import type { SiteKind } from '../sim/sites/types';
import { CHUNK_SIZE } from '../sim/world/generate';
import { RINGS } from '../sim/world/rings';

export function parseChunkKey(key: string): { cx: number; cy: number } {
  const [cx, cy] = key.split(',').map(Number);
  return { cx: cx ?? 0, cy: cy ?? 0 };
}

export const MIN_HALF_SIZE = 300;
export const MAX_HALF_SIZE = 9000;
const MARGIN = 1.15;

/** Half-width of the shown map area (world units) so everything explored fits. */
export function mapViewHalfSize(explored: readonly string[], player: Vec2): number {
  let extent = Math.max(Math.abs(player.x), Math.abs(player.y));
  for (const key of explored) {
    const { cx, cy } = parseChunkKey(key);
    extent = Math.max(extent, Math.abs(cx * CHUNK_SIZE), Math.abs((cx + 1) * CHUNK_SIZE), Math.abs(cy * CHUNK_SIZE), Math.abs((cy + 1) * CHUNK_SIZE));
  }
  return Math.max(600, extent * MARGIN);
}

/** Distance of a point to the nearest ring border (u). */
export function nearestRingBorder(pos: Vec2): number {
  const d = Math.hypot(pos.x, pos.y);
  let best = Infinity;
  for (const r of RINGS) if (Number.isFinite(r.outer)) best = Math.min(best, Math.abs(r.outer - d));
  return best;
}

/**
 * The view around the ship: at least 600 u, with the nearest border (a sector border from the map;
 * the ring border by default) and the targets (contracts, "First Day"), at most MAX_HALF_SIZE.
 */
export function autoHalfSize(ship: Vec2, targets: readonly Vec2[], border: number = nearestRingBorder(ship)): number {
  let half = Math.max(600, border + 220);
  for (const t of targets) half = Math.max(half, Math.max(Math.abs(t.x - ship.x), Math.abs(t.y - ship.y)) * MARGIN + 60);
  return Math.min(MAX_HALF_SIZE, half);
}

/** A round scale bar length (1, 2, 5 × 10ⁿ u) that is about `px` pixels long on the canvas. */
export function niceScale(unitsPerPx: number, px = 110): number {
  const raw = unitsPerPx * px;
  const exp = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * exp >= raw * 0.75) return m * exp;
  return 10 * exp;
}

/** New zoom around the cursor point: the point under the cursor stays in place. */
export function zoomAround(center: Vec2, half: number, cursor: Vec2, factor: number): { center: Vec2; half: number } {
  const next = Math.min(MAX_HALF_SIZE, Math.max(MIN_HALF_SIZE, half * factor));
  const k = next / half;
  return { center: { x: cursor.x + (center.x - cursor.x) * k, y: cursor.y + (center.y - cursor.y) * k }, half: next };
}

/**
 * The point on the circle of `radius` (around the origin) closest to the view centre, if it is in view.
 * `half` is the horizontal half-extent of the view, `halfY` the vertical one (a wide map).
 */
export function ringLabelPoint(radius: number, center: Vec2, half: number, halfY = half): Vec2 | null {
  const d = Math.hypot(center.x, center.y);
  const a = d > 1e-6 ? Math.atan2(center.y, center.x) : Math.PI / 2;
  // first the direction to the view centre, then samples along the circle – the first point in view (with a margin)
  const inside = (p: Vec2) => Math.abs(p.x - center.x) < half * 0.92 && Math.abs(p.y - center.y) < halfY * 0.92;
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (let i = 0; i < 180; i++) {
    const t = a + (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 90);
    const p = { x: Math.cos(t) * radius, y: Math.sin(t) * radius };
    if (!inside(p)) continue;
    const dd = Math.hypot(p.x - center.x, p.y - center.y);
    if (dd < bestD) {
      bestD = dd;
      best = p;
    }
  }
  return best;
}

/**
 * Ore grade labels ("130 %") are minor: shown only when zoomed in to at least this many canvas
 * pixels per world unit (1 000 u = 250 px), when fields are big enough to carry a label. The default
 * view at home hides them.
 */
export const GRADE_LABEL_MIN_SCALE = 0.25;

export const showGradeLabels = (pxPerUnit: number): boolean => pxPerUnit >= GRADE_LABEL_MIN_SCALE - 1e-9;

/** Distance of point `p` to the polyline `pts` (a comet's pass track under the cursor); Infinity when empty. */
export function distToPolyline(pts: readonly Vec2[], p: Vec2): number {
  if (pts.length === 1) return Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

/** One legend entry – the map draws its glyph and names it. */
export type LegendItem =
  | { kind: 'ship' }
  | { kind: 'target' }
  | { kind: 'station'; station: 'home' | 'station' | 'outpost' }
  | { kind: 'signal' }
  | { kind: 'place'; place: PlaceKind }
  /** The pass track of a known comet (M4b). */
  | { kind: 'cometArc' }
  | { kind: 'pirate'; pirate: 'fortress' | 'beacon' | 'raid' }
  | { kind: 'field'; resource: ResourceId }
  | { kind: 'depleted' }
  | { kind: 'rich' }
  | { kind: 'security'; security: Security }
  | { kind: 'knowledge'; knowledge: Knowledge }
  | { kind: 'lane' }
  | { kind: 'survey'; done: boolean }
  /** M4d Guild layer: a convoy, a live Guild Watch ship, a Guild relay (lit once powered). */
  | { kind: 'convoy' }
  | { kind: 'watch' }
  | { kind: 'relay'; lit: boolean }
  /** A map note icon in use (M4d). */
  | { kind: 'note'; icon: NoteIcon }
  /** Where pirates / a comet were last seen (M4d stale marks, Places layer). */
  | { kind: 'stale'; stale: 'pirates' | 'comet' };

export interface LegendGroup {
  /** 'ship' = always shown (where am I). */
  layer: MapLayer | 'ship';
  items: LegendItem[];
}

export interface LegendInput {
  layers: Record<MapLayer, boolean>;
  stations: readonly { kind: 'home' | 'station' | 'outpost' }[];
  targets: number;
  signals: number;
  places: readonly { kind: PlaceKind }[];
  pirates: readonly { kind: 'fortress' | 'beacon' | 'raid' }[];
  fields: readonly { resource: ResourceId; depleted: boolean; grade?: number }[];
  /** Survey points on the map (sectors §4.1): the legend names a kind once one is shown. */
  survey?: readonly { done: boolean }[];
  /** Known world sites on the map (M4b): derelict stations, ship graveyards. */
  sites?: readonly { kind: SiteKind }[];
  /** Known comets on the map: the track always, the nucleus while it passes (`now`). */
  comets?: readonly { now: Vec2 | null }[];
  /** M4d Guild layer: published convoys, Guild relays (`known` ones are drawn), live Watch ships. */
  guild?: { convoys: readonly unknown[]; relays: readonly { known: boolean; stage: string }[]; watch: readonly unknown[] } | null;
  /** M4d map notes (their icons). */
  notes?: readonly { icon: NoteIcon }[];
  /** M4d stale marks. */
  stale?: readonly { kind: 'pirates' | 'comet' }[];
}

const STATION_ORDER = ['home', 'station', 'outpost'] as const;
const PLACE_ORDER: readonly PlaceKind[] = ['echo', 'wreck', 'anomaly', 'giant', 'cache', 'distress', 'derelict', 'graveyard', 'comet'];
const PIRATE_ORDER = ['fortress', 'beacon', 'raid'] as const;
const RESOURCE_ORDER: readonly ResourceId[] = ['iron', 'copper', 'ice', 'titanium'];
const KNOWLEDGE_ORDER: readonly Knowledge[] = ['charted', 'reported', 'uncharted'];

/**
 * The legend from the active layers: only what those layers can show and what is on the map now
 * (a station kind, a place kind or a field resource appears once there is one). The ship is always first.
 */
export function legendGroups(p: LegendInput): LegendGroup[] {
  const groups: LegendGroup[] = [{ layer: 'ship', items: [{ kind: 'ship' }] }];
  const add = (layer: MapLayer, items: LegendItem[]) => {
    if (p.layers[layer] && items.length > 0) groups.push({ layer, items });
  };
  add('contracts', p.targets > 0 ? [{ kind: 'target' }] : []);
  add(
    'stations',
    STATION_ORDER.filter((k) => p.stations.some((s) => s.kind === k)).map((station) => ({ kind: 'station', station })),
  );
  add('signals', p.signals > 0 ? [{ kind: 'signal' }] : []);
  // M4b sites come in their own lists: a site kind once one is on the map, the comet glyph while one
  // passes, its track once any comet is known
  const comets = p.comets ?? [];
  const shown = (k: PlaceKind): boolean =>
    p.places.some((pl) => pl.kind === k) || (p.sites ?? []).some((s) => s.kind === k) || (k === 'comet' && comets.some((c) => c.now !== null));
  add('places', [
    ...PLACE_ORDER.filter(shown).map((place): LegendItem => ({ kind: 'place', place })),
    ...(comets.length > 0 ? [{ kind: 'cometArc' } as const] : []),
    ...PIRATE_ORDER.filter((k) => p.pirates.some((pp) => pp.kind === k)).map((pirate): LegendItem => ({ kind: 'pirate', pirate })),
    ...(['pirates', 'comet'] as const).filter((k) => (p.stale ?? []).some((m) => m.kind === k)).map((stale): LegendItem => ({ kind: 'stale', stale })),
  ]);
  // M4d: the Guild layer names what is on the map now; the notes layer the icons in use
  const guild = p.guild;
  const relays = (guild?.relays ?? []).filter((r) => r.known);
  const lit = (stage: string) => stage === 'powered' || stage === 'secured';
  add('convoys', [
    ...((guild?.convoys.length ?? 0) > 0 ? [{ kind: 'convoy' } as const] : []),
    ...((guild?.watch.length ?? 0) > 0 ? [{ kind: 'watch' } as const] : []),
    // one relay entry (the map labels tell each relay's stage): lit only when every known relay is
    ...(relays.length > 0 ? [{ kind: 'relay', lit: relays.every((r) => lit(r.stage)) } as const] : []),
  ]);
  add('notes', NOTE_ICONS.filter((icon) => (p.notes ?? []).some((n) => n.icon === icon)).map((icon): LegendItem => ({ kind: 'note', icon })));
  const live = p.fields.filter((f) => !f.depleted);
  add('fields', [
    ...RESOURCE_ORDER.filter((r) => live.some((f) => f.resource === r)).map((resource): LegendItem => ({ kind: 'field', resource })),
    ...(p.fields.some((f) => f.depleted) ? [{ kind: 'depleted' } as const] : []),
    ...(live.some((f) => f.grade !== undefined && isRich(f.grade)) ? [{ kind: 'rich' } as const] : []),
  ]);
  // the Sectors layer (§5.1): the four securities (colour + pattern), the three knowledge glyphs, the lane
  add('sectors', [
    ...SECURITIES.map((security): LegendItem => ({ kind: 'security', security })),
    ...KNOWLEDGE_ORDER.map((knowledge): LegendItem => ({ kind: 'knowledge', knowledge })),
    { kind: 'lane' },
    ...[false, true].filter((done) => (p.survey ?? []).some((s) => s.done === done)).map((done): LegendItem => ({ kind: 'survey', done })),
  ]);
  return groups;
}
