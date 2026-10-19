// The map (M, long-term design 10.8): a plate with the display and a narrow side panel with the
// layers, targets and a legend built from the active layers. The display takes about 90 % of the
// screen (readability pass R5). The Sectors layer (sectors design §5.1, mapSectors.ts) replaces the
// ring circles. On opening the view fits the ship, the nearest sector border and the contract
// targets; the wheel zooms around the cursor, dragging pans, C (or the button) brings the view back
// to the ship. Fog of war with soft edges, remembered asteroid fields by their dominant
// resource, signals and places from the scanner, a scale bar. Labels are laid out by priority
// (mapLabels.ts) so they never overlap or get clipped; ore grades show only when zoomed in; my ship
// is always marked, with an edge arrow when it is out of view. Hovering a sector shows its card
// (sectorCardData.ts: security, threat, knowledge, route home) and outlines it; a click pins the card.
// M4d (T12, plan §2.8): the Guild layer (convoys, Guild relays, Watch ships), the player's map notes
// (N = note tool, a click places a note, a click on a note edits it), stale marks of pirates and
// comets, and the route planner – right-click (or "Trasa sem" on a pinned sector card, a target row,
// a note) plans a straight route with its readout and the range circles; Esc clears it.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { RESOURCES, type ResourceId } from '../../data/resources';
import { tx } from '../../i18n';
import { getLocale } from '../../i18n/locale';
import { formatGrade, formatInt } from '../format';
import type { Vec2 } from '../../sim/math/vec2';
import { CHUNK_SIZE } from '../../sim/world/generate';
import { isRich } from '../../sim/mining/grade';
import { drawPirateMark, drawPlace, drawShipMarker, drawSignal, drawStation, drawSurveyPoint, ECHO_COLOR, withAlpha } from '../canvasDraw';
import { drawMapComets, drawMapSites, drawCometArcSwatch, cometUnder } from './mapSites';
import { splitShortKeyLabel } from '../keyLabel';
import { autoHalfSize, legendGroups, niceScale, parseChunkKey, showGradeLabels, zoomAround, type LegendGroup, type LegendItem } from '../map';
import { edgeArrow, LABEL_PRIORITY, layoutLabels, type LabelObstacle, type LabelRequest, type LabelSide } from '../mapLabels';
import { Button, Callout, Key, KeyHint, Panel, Segmented } from '../theme';
import { FONTS, PALETTE, STATION_COLORS } from '../theme/tokens';
import { MAP_LAYERS, PENDING_MAP_LAYERS, type MapDiscovery, type MapLayer } from '../../game/discovery/exploreUi';
import type { MapPirate } from '../../game/pirates/piratesUi';
import { drawLandmarkGlyph, LANDMARK_MAP_COLORS } from './mapLandmarks';
import { drawRegionDebug } from './regionDebug';
import { drawKnowledgeSwatch, drawLaneSwatch, drawSectorHighlight, drawSectorLayer, drawSecuritySwatch, nearestSectorBorder, type MapSectorsData } from './mapSectors';
import type { Security } from '../../sim/regions/constants';
import { sectorIdAt } from '../../sim/regions/sectors';
import { ROUTE_RISKS, sectorCardData } from '../sectors/sectorCardData';
import { SectorCard } from '../sectors/SectorCard';
import { NOTE_ICONS, NOTES, type NoteIcon } from '../../data/navigation';
import type { MapGuildData, MapNoteView, MapPlanHandlers, RoutePlanData, StaleMark } from '../../game/map/types';
import { clampNoteInput, noteTextCheck } from '../../game/map/noteView';
import { letterOf } from '../../game/input';
import { formatFactor } from '../format';
import { formatClock } from '../sites/chipFormat';
import { drawMapGuild, drawMapIcon, drawMapNotes, drawMapRoute, drawStaleMarks, drawStalePirates, mapIconUrl, NOTE_PX, onMapIconLoad, relayIcon } from './mapGuild';
import { drawComet, SITE_COLORS } from '../canvasDraw';
import './map.css';

/** A station on the map (discovered). */
export interface MapStation {
  pos: Vec2;
  name: string;
  kind: 'home' | 'station' | 'outpost';
}

/** A target on the map (contract, "First Day", main objective) – even if its station is not discovered yet. */
export interface MapTarget {
  pos: Vec2;
  /** Short label (track · objective). */
  label: string;
}

/** A remembered asteroid field (explored chunk, dominant resource). */
export interface MapField {
  pos: Vec2;
  radius: number;
  resource: ResourceId;
  /** The field is mined out (faded). */
  depleted: boolean;
  /** Best ore grade of the field when the scanner assayed it (Mining 2.0). */
  grade?: number;
}

export interface MapViewProps {
  explored: readonly string[];
  stations: readonly MapStation[];
  pos: Vec2;
  angle: number;
  targets: readonly MapTarget[];
  fields: readonly MapField[];
  discovery: MapDiscovery | null;
  /** Fortresses, clan beacons and the raid target (M3.6). */
  pirates?: readonly MapPirate[];
  /** Changes when C is pressed – the view returns to the ship. */
  recenter: number;
  /** The Sectors layer (sectors design §5.1). */
  sectors?: MapSectorsData | null;
  onToggleLayer?: (layer: MapLayer) => void;
  /** M4d Guild layer (`convoys`): published convoys, known Guild relays, live Watch ships. */
  guild?: MapGuildData | null;
  /** M4d planned route (straight line from the ship) with its readout and the range circles. */
  route?: RoutePlanData | null;
  /** M4d player map notes (layer `notes`; plain text). */
  mapNotes?: readonly MapNoteView[];
  /** M4d stale marks of pirates and comets (Places layer). */
  stale?: readonly StaleMark[];
  /** The Archive node "Map markers" is not bought: the note tool shows locked. */
  notesLocked?: boolean;
  /** Route and note handlers (game layer); without them the map has no route or note tools. */
  plan?: MapPlanHandlers;
}

/** A note being written or edited in the popover (`id` = an existing note). */
interface NoteDraft {
  id?: number;
  pos: Vec2;
  icon: NoteIcon;
  text: string;
}

/** Canvas size before the first measurement (CSS px). */
const FALLBACK_SIZE = { w: 640, h: 640 };
const ALL_LAYERS: Record<MapLayer, boolean> = { stations: true, signals: true, places: true, contracts: true, fields: true, sectors: true, convoys: true, notes: true };
const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
const distText = (d: number): string => `${formatInt(d)} ${tx().hud.distanceUnit}`;

interface View {
  center: Vec2;
  /** Half of the shorter canvas side in world units. */
  half: number;
}

interface Size {
  w: number;
  h: number;
}

const autoView = (pos: Vec2, targets: readonly MapTarget[], sectors?: MapSectorsData | null): View => ({
  center: { ...pos },
  half: autoHalfSize(pos, targets.map((t) => t.pos), sectors ? nearestSectorBorder(sectors.seed, pos) : undefined),
});

/** Pixels per world unit: `half` spans half of the shorter side. */
const scaleOf = (view: View, size: Size): number => Math.min(size.w, size.h) / 2 / view.half;

/** The fog canvas is reused (the map redraws 10× a second). */
let fogCanvas: HTMLCanvasElement | null = null;
/** What the fog canvas shows now – it is redrawn only when this changes (pan, zoom, a new chunk). */
let fogDrawn = '';

/**
 * Identity of the fog layer: the view and the explored chunks. The explored list only grows within
 * a game, so its length plus both ends tell a new chunk (or another game's list) apart without
 * hashing every key.
 */
export function fogSignature(explored: readonly string[], view: { center: Vec2; half: number }): string {
  return `${view.center.x},${view.center.y},${view.half}|${explored.length}|${explored[0] ?? ''}|${explored[explored.length - 1] ?? ''}`;
}

/** Sharp lines on HiDPI for a rectangular canvas (the shared helper is square). */
function prepareRect(canvas: HTMLCanvasElement, size: Size): CanvasRenderingContext2D | null {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pw = Math.round(size.w * dpr);
  const ph = Math.round(size.h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** A label waiting for the layout: the request plus how to draw it. */
interface MapLabel extends LabelRequest {
  text: string;
  font: string;
  /** Font size (px) of the text line. */
  size: number;
  color: string;
  /** A second, smaller line under the text (sector: "[x] GUARDED"). */
  sub?: { text: string; font: string; size: number; color: string };
}

const box = (id: string, x: number, y: number, r: number): LabelObstacle => ({ id, x: x - r, y: y - r, w: r * 2, h: r * 2 });

/** A marker is "under the cursor" within this many px (right-click snapping, a click on a note). */
const PICK_PX = 14;

/** Text widths by font (the map measures the same labels 10× a second); cleared when it grows large. */
const textWidths = new Map<string, Map<string, number>>();
let textWidthCount = 0;

function measureWidth(ctx: CanvasRenderingContext2D, font: string, text: string): number {
  let byText = textWidths.get(font);
  if (!byText) {
    byText = new Map();
    textWidths.set(font, byText);
  }
  let w = byText.get(text);
  if (w === undefined) {
    if (textWidthCount >= 1000) {
      for (const m of textWidths.values()) m.clear();
      textWidthCount = 0;
    }
    ctx.font = font;
    w = ctx.measureText(text).width;
    byText.set(text, w);
    textWidthCount++;
  }
  return w;
}

/** A label request with its measured box. */
function measuredLabel(ctx: CanvasRenderingContext2D, l: Omit<MapLabel, 'w' | 'h'>): MapLabel {
  let w = measureWidth(ctx, l.font, l.text);
  if (l.sub) w = Math.max(w, measureWidth(ctx, l.sub.font, l.sub.text));
  return { ...l, w: Math.ceil(w) + 4, h: l.size + 4 + (l.sub ? l.sub.size + 2 : 0) };
}

/**
 * The still part of the map – background, grid, asteroid fields, fog and the Sectors layer (fills,
 * borders, lanes) – kept in a canvas of its own and drawn again only when the view, the size, the
 * layers or that data change (or while sector tiles are still being built); every other map frame
 * copies it (audit 2026-10-17, P1). The sector names go into the label layout with each frame.
 */
interface MapBase {
  canvas: HTMLCanvasElement | null;
  key: string;
  fields: readonly MapField[] | null;
  /** Some sector tiles were missing: the next frame draws the base again. */
  pending: boolean;
  labels: MapLabel[];
}

const mapBase: MapBase = { canvas: null, key: '', fields: null, pending: false, labels: [] };

function baseKey(p: MapViewProps, view: View, layers: Record<MapLayer, boolean>, size: Size, dpr: number): string {
  const sec = layers.sectors ? p.sectors : null;
  return `${size.w}x${size.h}@${dpr}|${view.center.x},${view.center.y},${view.half}|${layers.fields ? 1 : 0}${sec ? 1 : 0}|${fogSignature(p.explored, view)}|${sec ? `${sec.seed}|${sec.version}|${sec.explored.size}` : ''}|${getLocale()}`;
}

/** The map's still part (see MapBase) into `ctx` (CSS px transform set); returns the sector name labels. */
function drawBase(ctx: CanvasRenderingContext2D, p: MapViewProps, view: View, layers: Record<MapLayer, boolean>, size: Size): { labels: MapLabel[]; pending: boolean } {
  const W = size.w;
  const H = size.h;
  const s = scaleOf(view, size);
  const toX = (x: number) => W / 2 + (x - view.center.x) * s;
  const toY = (y: number) => H / 2 - (y - view.center.y) * s;
  const onScreen = (x: number, y: number, m: number) => x >= -m && y >= -m && x <= W + m && y <= H + m;

  // background: the explored area is lighter, the fog reveals it with a soft edge
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#13283c';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = withAlpha(PALETTE.glow, 0.05);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= W; i += 40) {
    ctx.moveTo(i + 0.5, 0);
    ctx.lineTo(i + 0.5, H);
  }
  for (let i = 0; i <= H; i += 40) {
    ctx.moveTo(0, i + 0.5);
    ctx.lineTo(W, i + 0.5);
  }
  ctx.stroke();

  // asteroid fields (under the fog – there are none outside the explored area)
  if (layers.fields) {
    for (const f of p.fields) {
      const x = toX(f.pos.x);
      const y = toY(f.pos.y);
      const r = Math.max(2.5, f.radius * s);
      if (!onScreen(x, y, r)) continue;
      const c = hex(RESOURCES[f.resource].color);
      ctx.fillStyle = withAlpha(c, f.depleted ? 0.12 : 0.34);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (!f.depleted && r > 4) {
        ctx.fillStyle = withAlpha(c, 0.8);
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // fog of war: a dark layer with soft holes around the explored chunks
  if (!fogCanvas || fogCanvas.width !== W || fogCanvas.height !== H) {
    fogCanvas ??= document.createElement('canvas');
    fogCanvas.width = W;
    fogCanvas.height = H;
    fogDrawn = '';
  }
  const fog = fogCanvas;
  const signature = fogSignature(p.explored, view);
  const f = signature === fogDrawn ? null : fog.getContext('2d');
  if (f) {
    fogDrawn = signature;
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, W, H);
    f.fillStyle = 'rgba(5, 12, 20, 0.84)';
    f.fillRect(0, 0, W, H);
    f.globalCompositeOperation = 'destination-out';
    const r = CHUNK_SIZE * 1.05 * s;
    for (const key of p.explored) {
      const { cx, cy } = parseChunkKey(key);
      const x = toX((cx + 0.5) * CHUNK_SIZE);
      const y = toY((cy + 0.5) * CHUNK_SIZE);
      if (!onScreen(x, y, r)) continue;
      const g = f.createRadialGradient(x, y, r * 0.35, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = g;
      f.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  ctx.drawImage(fog, 0, 0, W, H);
  // dev-only sector prototype layer (`?regions`, stage 0 of the sectors design)
  if (import.meta.env.DEV) drawRegionDebug(ctx, { center: view.center, scale: s, w: W, h: H });

  // sectors (§5.1): security fills, borders, Guild Lanes; their names go through the label layout
  if (!layers.sectors || !p.sectors) return { labels: [], pending: false };
  const layer = drawSectorLayer(ctx, p.sectors, { center: view.center, scale: s, w: W, h: H });
  return { labels: layer.labels.map((l) => measuredLabel(ctx, l)), pending: layer.pending };
}

/** Copies the still part of the map (see MapBase) into `ctx`, drawing it again first when it changed. */
function blitBase(ctx: CanvasRenderingContext2D, p: MapViewProps, view: View, layers: Record<MapLayer, boolean>, size: Size): MapBase {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const key = baseKey(p, view, layers, size, dpr);
  const b = mapBase;
  if (!b.canvas || b.pending || b.key !== key || b.fields !== p.fields) {
    b.canvas ??= document.createElement('canvas');
    const bc = prepareRect(b.canvas, size);
    if (bc) {
      const drawn = drawBase(bc, p, view, layers, size);
      b.key = key;
      b.fields = p.fields;
      b.pending = drawn.pending;
      b.labels = drawn.labels;
    }
  }
  ctx.drawImage(b.canvas, 0, 0, size.w, size.h);
  return b;
}

/** The map closed: let the still part's canvas go (a screen-sized surface); the next open draws it anew. */
function releaseMapBase(): void {
  if (mapBase.canvas) mapBase.canvas.width = mapBase.canvas.height = 0;
  mapBase.canvas = null;
  mapBase.key = '';
  mapBase.fields = null;
  mapBase.labels = [];
}

function drawMap(
  ctx: CanvasRenderingContext2D,
  p: MapViewProps,
  view: View,
  layers: Record<MapLayer, boolean>,
  size: Size,
  now: number,
  highlight: { id: string; security: Security } | null = null,
  /** Survey points of the sector whose card is open (on top of the ones the game always shows). */
  cardSurvey: readonly { pos: Vec2; done: boolean }[] = [],
  /** The comet under the cursor or pinned by a click (M4b): its label says when it passes near. */
  cometFocus: string | null = null,
  /** The note open in the editor (outlined), M4d. */
  noteFocus: number | null = null,
  /** Panels over the display (the route readout and the tool row): labels keep off them. */
  blocked: readonly LabelObstacle[] = [],
): { pending: boolean } {
  const W = size.w;
  const H = size.h;
  const s = scaleOf(view, size);
  const toX = (x: number) => W / 2 + (x - view.center.x) * s;
  const toY = (y: number) => H / 2 - (y - view.center.y) * s;
  const onScreen = (x: number, y: number, m: number) => x >= -m && y >= -m && x <= W + m && y <= H + m;
  const labels: MapLabel[] = [];
  const obstacles: LabelObstacle[] = [...blocked];
  const label = (l: Omit<MapLabel, 'w' | 'h'>) => {
    labels.push(measuredLabel(ctx, l));
  };

  // the still part: background, grid, fields, fog, the Sectors layer (its names go to the layout first)
  const base = blitBase(ctx, p, view, layers, size);
  for (const l of base.labels) labels.push(l);
  if (layers.sectors && p.sectors && highlight) drawSectorHighlight(ctx, p.sectors.seed, highlight.id, highlight.security, { center: view.center, scale: s, w: W, h: H });
  const proj = { toX, toY, scale: s, onScreen };

  // the planned route (M4d): range circles and the line under every marker
  if (p.route) drawMapRoute(ctx, p.route, p.pos, proj, obstacles);

  // best ore grade of assayed fields (Mining 2.0): rich ones always get a gold ring, the grade
  // labels are minor and show only when zoomed in
  if (layers.fields) {
    const grades = showGradeLabels(s);
    for (const fl of p.fields) {
      if (fl.grade === undefined || fl.depleted) continue;
      const x = toX(fl.pos.x);
      const y = toY(fl.pos.y);
      if (!onScreen(x, y, 30)) continue;
      const r = Math.max(2.5, fl.radius * s);
      const rich = isRich(fl.grade);
      if (rich) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = withAlpha(PALETTE.oreRich, 0.9);
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (!grades || (!rich && r < 9)) continue;
      label({
        id: `grade:${fl.pos.x},${fl.pos.y}`,
        priority: LABEL_PRIORITY.grade,
        anchor: { x, y },
        gap: r + 4,
        sides: ['right', 'left'],
        text: formatGrade(fl.grade),
        font: `650 11px ${FONTS.display}`,
        size: 11,
        color: rich ? PALETTE.oreRich : withAlpha(PALETTE.textDim, 0.9),
      });
    }
  }

  const d = p.discovery;
  // far landmarks (readability §2): dim silhouettes with names, under every gameplay marker
  if (d?.landmarks && layers.sectors) {
    for (const lm of d.landmarks) {
      const x = toX(lm.pos.x);
      const y = toY(lm.pos.y);
      if (!onScreen(x, y, 20)) continue;
      drawLandmarkGlyph(ctx, lm.kind, x, y, 8);
      const id = `landmark:${lm.id}`;
      obstacles.push(box(id, x, y, 8));
      label({ id, priority: LABEL_PRIORITY.ring + 0.5, anchor: { x, y }, gap: 11, text: lm.name, font: `italic 600 11px ${FONTS.display}`, size: 11, color: withAlpha(LANDMARK_MAP_COLORS[lm.kind], 0.8) });
    }
  }
  // survey points (sectors §4.1): reticles to pulse at, green dots once marked
  if (layers.sectors) {
    [...(d?.survey ?? []), ...cardSurvey].forEach((sp, i) => {
      const x = toX(sp.pos.x);
      const y = toY(sp.pos.y);
      if (!onScreen(x, y, 10)) return;
      drawSurveyPoint(ctx, x, y, 4.5, sp.done);
      obstacles.push(box(`survey:${i}`, x, y, 6));
    });
  }
  if (d && layers.signals) for (const sg of d.signals) drawSignal(ctx, toX(sg.pos.x), toY(sg.pos.y), Math.max(4, sg.radius * s));
  if (d && layers.places) {
    d.places.forEach((pl, i) => {
      const x = toX(pl.pos.x);
      const y = toY(pl.pos.y);
      if (!onScreen(x, y, 20)) return;
      drawPlace(ctx, x, y, pl.kind, pl.fresh, 5);
      const id = `place:${i}`;
      obstacles.push(box(id, x, y, 6));
      if (pl.kind === 'echo') {
        label({ id, priority: LABEL_PRIORITY.poi, anchor: { x, y }, gap: 9, text: pl.label, font: `600 11px ${FONTS.display}`, size: 11, color: ECHO_COLOR });
      }
    });
  }

  // M4b world sites (Places layer): comet tracks under the sites, derelicts with their relays, graveyards
  if (d && layers.places) {
    drawMapComets(ctx, d.comets ?? [], proj, cometFocus, label, obstacles);
    drawMapSites(ctx, d.sites ?? [], proj, label, obstacles);
  }

  // pirates (M3.6): fortresses with names, clan beacons, the raid target
  if (layers.places && p.pirates) {
    p.pirates.forEach((pp, i) => {
      const x = toX(pp.pos.x);
      const y = toY(pp.pos.y);
      if (!onScreen(x, y, 20)) return;
      const r = pp.kind === 'fortress' ? 7 : pp.kind === 'raid' ? 9 : 4;
      drawPirateMark(ctx, x, y, pp.kind, r, pp.down);
      const id = `pirate:${i}`;
      obstacles.push(box(id, x, y, r + 1));
      if (pp.kind === 'beacon') return;
      label({
        id,
        priority: LABEL_PRIORITY.poi,
        anchor: { x, y },
        gap: r + 4,
        text: pp.label,
        font: `700 12px ${FONTS.display}`,
        size: 12,
        color: pp.down ? PALETTE.textDim : PALETTE.bad,
      });
    });
  }
  // stale marks (M4d S6): where pirates / a comet were last seen, faded by age
  if (layers.places && p.stale?.length) drawStaleMarks(ctx, p.stale, proj, label, obstacles);
  // the Guild layer (M4d): Guild relays, convoys, live Watch ships
  if (layers.convoys && p.guild) drawMapGuild(ctx, p.guild, proj, label, obstacles);

  if (layers.stations) {
    p.stations.forEach((st, i) => {
      const x = toX(st.pos.x);
      const y = toY(st.pos.y);
      if (!onScreen(x, y, 20)) return;
      const home = st.kind === 'home';
      const color = STATION_COLORS[st.kind];
      const r = home ? 12 : 9;
      drawStation(ctx, x, y, r, color);
      const id = `station:${i}`;
      obstacles.push(box(id, x, y, r * 0.72 + 1));
      label({
        id,
        priority: LABEL_PRIORITY.station,
        anchor: { x, y },
        gap: r * 0.72 + 4,
        text: st.name,
        font: `${home ? 700 : 600} ${home ? 13 : 12}px ${FONTS.display}`,
        size: home ? 13 : 12,
        color,
      });
    });
  }

  // the player's notes (M4d): icon + plain text
  if (layers.notes && p.mapNotes?.length) drawMapNotes(ctx, p.mapNotes, proj, label, obstacles, noteFocus);

  // targets: a circle with a crosshair, label and distance; outside the view an arrow on the edge
  if (layers.contracts) {
    p.targets.forEach((t, i) => {
      const dist = Math.hypot(t.pos.x - p.pos.x, t.pos.y - p.pos.y);
      const x = toX(t.pos.x);
      const y = toY(t.pos.y);
      const edge = edgeArrow(x, y, W, H, 8, 18);
      const id = `target:${i}`;
      ctx.strokeStyle = PALETTE.glow;
      ctx.fillStyle = PALETTE.glow;
      ctx.lineWidth = 2;
      if (!edge) {
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.moveTo(x - 11, y);
        ctx.lineTo(x - 4, y);
        ctx.moveTo(x + 4, y);
        ctx.lineTo(x + 11, y);
        ctx.moveTo(x, y - 11);
        ctx.lineTo(x, y - 4);
        ctx.moveTo(x, y + 4);
        ctx.lineTo(x, y + 11);
        ctx.stroke();
      } else {
        ctx.save();
        ctx.translate(edge.x, edge.y);
        ctx.rotate(edge.angle);
        ctx.beginPath();
        ctx.moveTo(10, 0);
        ctx.lineTo(-6, 7);
        ctx.lineTo(-6, -7);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      const at = edge ?? { x, y };
      obstacles.push(box(id, at.x, at.y, 11));
      label({
        id,
        priority: LABEL_PRIORITY.objective,
        keep: true,
        anchor: { x: at.x, y: at.y },
        gap: 13,
        sides: edge ? inwardSides(edge.angle) : ['right', 'below', 'left', 'above'],
        text: `${t.label} · ${distText(dist)}`,
        font: `650 12px ${FONTS.display}`,
        size: 12,
        color: PALETTE.glow,
      });
    });
  }

  // you are here: a halo around the ship, or a ship badge with an arrow on the edge when out of view
  const sx = toX(p.pos.x);
  const sy = toY(p.pos.y);
  const shipEdge = edgeArrow(sx, sy, W, H, 4, 26);
  const pulse = (now % 1600) / 1600;
  const ship = shipEdge ?? { x: sx, y: sy };
  obstacles.push(box('ship', ship.x, ship.y, shipEdge ? 18 : 15));
  label({
    id: 'ship',
    priority: LABEL_PRIORITY.ship,
    keep: true,
    anchor: ship,
    gap: shipEdge ? 20 : 17,
    sides: shipEdge ? inwardSides(shipEdge.angle) : ['left', 'right', 'below', 'above'],
    text: tx().discovery.map.youAreHere,
    font: `750 13px ${FONTS.display}`,
    size: 13,
    color: PALETTE.hullHi,
  });

  // scale bar bottom left (labels keep off it)
  const units = niceScale(1 / s);
  const px = units * s;
  obstacles.push({ id: 'scale', x: 8, y: H - 28, w: px + 90, h: 24 });

  // labels by priority, over every marker but under my ship
  const placed = layoutLabels(labels, { w: W, h: H }, obstacles);
  const byId = new Map<string, MapLabel>();
  for (const l of labels) byId.set(l.id, l);
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const pl of placed) {
    const l = byId.get(pl.id)!;
    ctx.font = l.font;
    ctx.lineWidth = 3;
    ctx.strokeStyle = PALETTE.screen;
    if (l.sub) {
      // two centred lines: the name and the small line under it
      const cx = pl.x + pl.w / 2;
      const ty = pl.y + l.size / 2 + 2;
      ctx.textAlign = 'center';
      ctx.strokeText(l.text, cx, ty);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, cx, ty);
      ctx.font = l.sub.font;
      const sy = pl.y + l.size + 4 + l.sub.size / 2;
      ctx.strokeText(l.sub.text, cx, sy);
      ctx.fillStyle = l.sub.color;
      ctx.fillText(l.sub.text, cx, sy);
      ctx.textAlign = 'start';
      continue;
    }
    ctx.strokeText(l.text, pl.x + 2, pl.y + pl.h / 2);
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, pl.x + 2, pl.y + pl.h / 2);
  }
  ctx.textBaseline = 'alphabetic';

  if (shipEdge) {
    // the badge: a dark disc with the ship arrow, a white pointer out to where the ship is
    ctx.save();
    ctx.translate(shipEdge.x, shipEdge.y);
    ctx.rotate(shipEdge.angle);
    ctx.beginPath();
    ctx.moveTo(24, 0);
    ctx.lineTo(11, 8);
    ctx.lineTo(11, -8);
    ctx.closePath();
    ctx.fillStyle = PALETTE.hullHi;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = PALETTE.trim;
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(shipEdge.x, shipEdge.y, 13, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.screen;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = PALETTE.hullHi;
    ctx.stroke();
    drawShipMarker(ctx, shipEdge.x, shipEdge.y, p.angle, 7);
  } else {
    ctx.lineWidth = 2;
    ctx.strokeStyle = withAlpha(PALETTE.hullHi, 0.85);
    ctx.beginPath();
    ctx.arc(sx, sy, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = withAlpha(PALETTE.hullHi, 0.55 * (1 - pulse));
    ctx.beginPath();
    ctx.arc(sx, sy, 14 + pulse * 16, 0, Math.PI * 2);
    ctx.stroke();
    drawShipMarker(ctx, sx, sy, p.angle, 9);
  }

  ctx.strokeStyle = PALETTE.text;
  ctx.fillStyle = PALETTE.text;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(14, H - 16);
  ctx.lineTo(14 + px, H - 16);
  ctx.moveTo(14, H - 21);
  ctx.lineTo(14, H - 11);
  ctx.moveTo(14 + px, H - 21);
  ctx.lineTo(14 + px, H - 11);
  ctx.stroke();
  ctx.font = `600 12px ${FONTS.text}`;
  ctx.fillText(distText(units), 20 + px, H - 12);
  return { pending: base.pending };
}

/** For a label at an edge arrow: the sides that face into the map first. */
function inwardSides(angle: number): LabelSide[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  if (Math.abs(c) >= Math.abs(s)) return c > 0 ? ['left', 'below', 'above', 'right'] : ['right', 'below', 'above', 'left'];
  return s > 0 ? ['above', 'left', 'right', 'below'] : ['below', 'left', 'right', 'above'];
}

/** Legend: toggleable layers with their glyph. */
function LayerGlyph({ layer }: { layer: MapLayer }) {
  return <i class={`mp-glyph mp-glyph--${layer}`} aria-hidden="true" />;
}

const ICON = 16;

/** A legend symbol drawn with the same code as the map, on a small dark display swatch. */
function LegendIcon({ item }: { item: LegendItem }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const iconsLoaded = useIconsLoaded();
  const svg = legendIconName(item) !== null;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(ICON * dpr);
    if (canvas.width !== px || canvas.height !== px) canvas.width = canvas.height = px;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, ICON, ICON);
    const c = ICON / 2;
    switch (item.kind) {
      case 'ship':
        drawShipMarker(ctx, c, c, Math.PI / 4, 6);
        break;
      case 'target':
        ctx.strokeStyle = PALETTE.glow;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(c, c, 4.5, 0, Math.PI * 2);
        ctx.moveTo(c - 7, c);
        ctx.lineTo(c - 3, c);
        ctx.moveTo(c + 3, c);
        ctx.lineTo(c + 7, c);
        ctx.stroke();
        break;
      case 'station':
        drawStation(ctx, c, c, item.station === 'home' ? 9 : 8, STATION_COLORS[item.station]);
        break;
      case 'signal':
        drawSignal(ctx, c, c, 5.5);
        break;
      case 'place':
        drawPlace(ctx, c, c, item.place, true, 4);
        break;
      case 'pirate':
        drawPirateMark(ctx, c, c, item.pirate, item.pirate === 'raid' ? 4 : 5);
        break;
      case 'field':
      case 'depleted': {
        const col = item.kind === 'field' ? hex(RESOURCES[item.resource].color) : PALETTE.textDim;
        ctx.fillStyle = withAlpha(col, item.kind === 'field' ? 0.45 : 0.22);
        ctx.beginPath();
        ctx.arc(c, c, 6, 0, Math.PI * 2);
        ctx.fill();
        if (item.kind === 'field') {
          ctx.fillStyle = withAlpha(col, 0.9);
          ctx.beginPath();
          ctx.arc(c, c, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'rich':
        ctx.fillStyle = withAlpha(hex(RESOURCES.copper.color), 0.34);
        ctx.beginPath();
        ctx.arc(c, c, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = withAlpha(PALETTE.oreRich, 0.9);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(c, c, 6.2, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'security':
        drawSecuritySwatch(ctx, item.security, 1, 1, ICON - 2, ICON - 2);
        break;
      case 'knowledge':
        drawKnowledgeSwatch(ctx, item.knowledge, 1, 1, ICON - 2, ICON - 2);
        break;
      case 'lane':
        drawLaneSwatch(ctx, 1, c, ICON - 1);
        break;
      case 'survey':
        drawSurveyPoint(ctx, c, c, 4, item.done);
        break;
      case 'cometArc':
        drawCometArcSwatch(ctx, ICON);
        break;
      case 'stale':
        if (item.stale === 'pirates') drawStalePirates(ctx, c, c, 5, 0.7);
        else {
          ctx.globalAlpha = 0.6;
          drawComet(ctx, c, c, 4.5, Math.PI * 0.75, SITE_COLORS.comet);
          ctx.globalAlpha = 1;
        }
        break;
      case 'convoy':
      case 'watch':
      case 'relay':
      case 'note':
        drawMapIcon(ctx, legendIconName(item)!, c, c, ICON - 2, item.kind === 'watch' ? -Math.PI / 4 : item.kind === 'convoy' ? -Math.PI / 6 : 0);
        break;
    }
  }, [JSON.stringify(item), svg ? iconsLoaded : 0]);
  return <canvas ref={ref} class="mp-legend-icon" style={{ width: `${ICON}px`, height: `${ICON}px` }} aria-hidden="true" />;
}

/** The SVG icon of an M4d legend item (null = drawn by code). */
function legendIconName(item: LegendItem): Parameters<typeof drawMapIcon>[1] | null {
  switch (item.kind) {
    case 'convoy':
      return 'convoy';
    case 'watch':
      return 'guild_watch';
    case 'relay':
      return relayIcon(item.lit ? 'powered' : 'broken');
    case 'note':
      return `note_${item.icon}`;
    default:
      return null;
  }
}

/** Legend rows: the ship and the targets share the first row (M4d: room for the Guild and notes layers). */
function legendRows(groups: readonly LegendGroup[]): LegendGroup[] {
  const [first, second, ...rest] = groups;
  if (first?.layer === 'ship' && second?.layer === 'contracts') return [{ layer: 'ship', items: [...first.items, ...second.items] }, ...rest];
  return [...groups];
}

/** Re-renders when a map icon (SVG) finishes loading – the canvases draw it then. */
function useIconsLoaded(): number {
  const [n, setN] = useState(0);
  useEffect(() => onMapIconLoad(() => setN((v) => v + 1)), []);
  return n;
}

function legendName(item: LegendItem): string {
  const m = tx().discovery.map;
  switch (item.kind) {
    case 'ship':
      return m.legendShip;
    case 'target':
      return m.legendTarget;
    case 'station':
      return tx().stationKinds[item.station];
    case 'signal':
      return m.layers.signals;
    case 'place':
      return tx().discovery.scanKinds[item.place];
    case 'pirate':
      return tx().pirates.map[item.pirate];
    case 'field':
      return tx().resources[item.resource];
    case 'depleted':
      return m.legendDepleted;
    case 'rich':
      return m.legendRich;
    case 'security':
      return tx().sectors.security[item.security];
    case 'knowledge':
      return `${tx().sectors.glyph[item.knowledge]} ${tx().sectors.knowledge[item.knowledge]}`;
    case 'lane':
      return tx().sectors.map.legendLane;
    case 'survey':
      return item.done ? tx().sectors.survey.pointDone : tx().sectors.survey.point;
    case 'cometArc':
      return tx().world.map.passArc;
    case 'convoy':
      return tx().guild.map.legendConvoy;
    case 'watch':
      return tx().guild.map.legendWatch;
    case 'relay':
      return item.lit ? tx().guild.map.legendRelayLit : tx().guild.map.legendRelay;
    case 'note':
      return tx().guild.notes.icons[item.icon];
    case 'stale':
      return item.stale === 'pirates' ? tx().guild.map.legendStalePirates : tx().guild.map.legendStaleComet;
  }
}

/** The route readout (M4d §2.8): distance and time, fuel left or missing, risks on the way, the local fuel factor. */
export function RoutePanel({ route, onClear }: { route: RoutePlanData; onClear?: () => void }) {
  const t = tx().guild.route;
  const card = tx().sectors.card;
  const sec = tx().sectors.security;
  const risks = ROUTE_RISKS.filter((r) => route.risks[r] > 0);
  const time = Number.isFinite(route.seconds) ? formatClock(route.seconds) : '–';
  return (
    <Panel material="band" cut="md" class="mp-route" testId="map-route">
      <div class="mp-route-head">
        <span class="af-label mp-route-title">{t.title}</span>
        <span class="mp-route-label" title={route.label}>
          {route.label}
        </span>
        {onClear && (
          <button type="button" class="mp-route-clear af-focusable" data-testid="map-route-clear" onClick={onClear}>
            <Key dark>Esc</Key> {t.clear}
          </button>
        )}
      </div>
      <div class="mp-route-line">{t.line(distText(route.distance), time)}</div>
      {route.short !== null ? (
        <div class="mp-route-fuel is-short" data-testid="map-route-short">
          {t.short(formatInt(route.short))}
        </div>
      ) : (
        <div class="mp-route-fuel">{t.fuel(formatInt(Math.ceil(route.fuel)), formatInt(Math.floor(route.fuelLeft)))}</div>
      )}
      <div class="mp-route-risks">
        <span class="mp-route-key">{t.risks}:</span>
        {risks.length === 0 ? (
          <span class="mp-route-safe">{t.safe}</span>
        ) : (
          risks.map((r) => (
            <span key={r} class="sc-card-risk" data-security={r}>
              {card.count(route.risks[r], r === 'unknown' ? card.unknownWord : sec[r])}
            </span>
          ))
        )}
      </div>
      {route.fuelMult !== undefined && <div class="mp-route-mult">{t.fuelMult(formatFactor(route.fuelMult, 1))}</div>}
      <div class="mp-route-ranges" aria-hidden="true">
        <span>
          <i class="mp-range mp-range--one" /> {t.rangeOneWay} {distText(route.rangeOneWay)}
        </span>
        <span>
          <i class="mp-range mp-range--round" /> {t.rangeRound}
        </span>
      </div>
    </Panel>
  );
}

/** The note editor popover (M4d): icon picker, text ≤ 40 with a counter, Save / Route here / Delete / Cancel. */
export function NoteEditor({
  draft,
  onChange,
  onSave,
  onDelete,
  onRoute,
  onCancel,
  style,
  autoFocus = true,
}: {
  draft: NoteDraft;
  onChange: (draft: NoteDraft) => void;
  onSave: () => void;
  onDelete?: () => void;
  onRoute?: () => void;
  onCancel: () => void;
  style?: Record<string, string>;
  autoFocus?: boolean;
}) {
  const t = tx().guild.notes;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, []);
  const check = noteTextCheck(draft.text);
  return (
    <div class="mp-note-editor" style={style} data-testid="map-note-editor" onPointerDown={(e) => e.stopPropagation()}>
      <Panel material="band" cut="md" class="mp-note-panel">
        <div class="mp-note-head">
          <span class="af-label">{draft.id === undefined ? t.newTitle : t.editTitle}</span>
        </div>
        <div class="mp-note-icons" data-testid="map-note-icons">
          <Segmented
            label={t.icon}
            options={NOTE_ICONS.map((icon) => ({
              value: icon,
              label: <img class="mp-note-icon" src={mapIconUrl(`note_${icon}`)} alt={t.icons[icon]} title={t.icons[icon]} width={18} height={18} />,
            }))}
            value={draft.icon}
            onChange={(icon) => onChange({ ...draft, icon })}
          />
        </div>
        <label class="mp-note-text">
          <span class="af-label">{t.text}</span>
          <input
            ref={input}
            type="text"
            class="mp-note-input af-focusable"
            data-testid="map-note-input"
            value={draft.text}
            placeholder={t.placeholder}
            spellcheck={false}
            onInput={(e) => onChange({ ...draft, text: clampNoteInput((e.currentTarget as HTMLInputElement).value) })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && check.ok) {
                e.preventDefault();
                onSave();
              }
            }}
          />
          <span class={`mp-note-count${check.length > NOTES.textMax ? ' is-over' : ''}`} data-testid="map-note-count">
            {check.length}/{NOTES.textMax}
          </span>
        </label>
        <div class="mp-note-actions">
          <Button variant="primary" size="sm" disabled={!check.ok} reason={tx().actionErrors.invalidNote} testId="map-note-save" onClick={onSave}>
            {t.save}
          </Button>
          {onRoute && (
            <Button size="sm" testId="map-note-route" onClick={onRoute}>
              {tx().guild.route.here}
            </Button>
          )}
          {onDelete && (
            <Button variant="danger" size="sm" testId="map-note-delete" onClick={onDelete}>
              {t.remove}
            </Button>
          )}
          <Button variant="ghost" size="sm" keyHint="Esc" testId="map-note-cancel" onClick={onCancel}>
            {t.cancel}
          </Button>
        </div>
      </Panel>
    </div>
  );
}

/** What the next map frame draws (the latest render's inputs). */
interface MapFrameArgs {
  p: MapViewProps;
  view: View;
  layers: Record<MapLayer, boolean>;
  size: Size;
  highlight: { id: string; security: Security } | null;
  cardSurvey: readonly { pos: Vec2; done: boolean }[];
  cometFocus: string | null;
  noteFocus: number | null;
  panels: readonly LabelObstacle[];
}

interface MapFrame {
  raf: number;
  timer: ReturnType<typeof setTimeout> | null;
  args: MapFrameArgs | null;
}

const NO_PANELS: readonly LabelObstacle[] = [];

/** The layer switches as a short key (effect dependency). */
const layerKey = (layers: Record<MapLayer, boolean>): string => {
  let k = '';
  for (const l of MAP_LAYERS) k += layers[l] ? '1' : '0';
  return k;
};

/** Rects of the panels over the display (stage px) – read in the ResizeObserver callback, after layout. */
function panelRects(els: readonly (HTMLElement | null)[]): LabelObstacle[] {
  const out: LabelObstacle[] = [];
  els.forEach((el, i) => {
    if (el) out.push({ id: `panel:${i}`, x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
  });
  return out;
}

function sameRects(a: readonly LabelObstacle[], b: readonly LabelObstacle[]): boolean {
  return a.length === b.length && a.every((r, i) => r.id === b[i]!.id && r.x === b[i]!.x && r.y === b[i]!.y && r.w === b[i]!.w && r.h === b[i]!.h);
}

/** Where the editor popover sits next to the note's point, kept inside the display (px in the stage). */
function editorPlace(x: number, y: number, size: Size): Record<string, string> {
  const w = 300;
  const h = 170;
  const left = x + 18 + w > size.w ? Math.max(6, x - 18 - w) : x + 18;
  const top = Math.min(Math.max(6, y - 24), Math.max(6, size.h - h - 6));
  return { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` };
}

export function MapView(p: MapViewProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const zoomBar = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(() => autoView(p.pos, p.targets, p.sectors));
  const [size, setSize] = useState<Size>(FALLBACK_SIZE);
  const drag = useRef<{ x: number; y: number; center: Vec2; moved: boolean } | null>(null);
  const layers = p.discovery?.layers ?? ALL_LAYERS;
  // the sector card (§5.1): the sector under the cursor, or the one a click pinned
  // `right`: the card sits top right (the cursor is in the left half, where the card would cover it)
  const [hover, setHover] = useState<{ id: string; at: Vec2; right: boolean } | null>(null);
  const [pinned, setPinned] = useState<{ id: string; at: Vec2; right: boolean } | null>(null);
  // a comet's track under the cursor / pinned by a click (M4b): its label adds the next pass near the ship
  const [hoverComet, setHoverComet] = useState<string | null>(null);
  const [pinnedComet, setPinnedComet] = useState<string | null>(null);
  // M4d: the note tool (N) and the note editor popover
  const [noteTool, setNoteTool] = useState(false);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [lockFlash, setLockFlash] = useState(0);
  const iconsLoaded = useIconsLoaded();
  const plan = p.plan ?? null;
  const mapNotes = p.mapNotes ?? [];
  const notesFull = mapNotes.length >= NOTES.max;
  const sectors = layers.sectors ? (p.sectors ?? null) : null;
  const shown = sectors ? (pinned ?? hover) : null;
  const landmarks = p.discovery?.landmarks;
  const card = useMemo(
    () =>
      shown && sectors
        ? sectorCardData({
            seed: sectors.seed,
            id: shown.id,
            from: shown.at,
            overrides: sectors.overrides,
            knowledge: sectors.knowledge,
            coverage: sectors.coverage ?? (() => null),
            ...(sectors.chart ? { chart: sectors.chart } : {}),
            current: sectors.current,
            stations: p.stations,
            landmarks: landmarks ?? [],
          })
        : null,
    [shown?.id, sectors?.seed, sectors?.version, sectors?.current, p.explored.length, p.stations.length, landmarks?.length ?? 0],
  );

  // the open card's sector shows its survey points (a sector the player knows, not Charted yet)
  const cardSurvey = useMemo(() => (card?.known && sectors?.survey ? sectors.survey(card.id) : []), [card?.id, card?.known, sectors?.version]);

  // the display fills the space the layout gives it (about 90 % of the screen); the panels over it
  // (the zoom bar with the hint, the tool row with the route readout) are measured by the same
  // ResizeObserver, so the labels keep off them without a layout read in every map frame
  const [panels, setPanels] = useState<readonly LabelObstacle[]>(NO_PANELS);
  const observer = useRef<{ ro: ResizeObserver | null; els: (Element | null)[] }>({ ro: null, els: [] });
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const w = Math.max(160, Math.round(el.clientWidth));
      const h = Math.max(160, Math.round(el.clientHeight));
      setSize((old) => (old.w === w && old.h === h ? old : { w, h }));
      const next = panelRects([tools.current, zoomBar.current]);
      setPanels((old) => (sameRects(old, next) ? old : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    observer.current = { ro, els: [] };
    return () => {
      ro.disconnect();
      observer.current = { ro: null, els: [] };
    };
  }, []);
  // the tool row comes and goes with the planner: observe the panels that are there now
  useLayoutEffect(() => {
    const o = observer.current;
    if (!o.ro) return;
    const els = [tools.current, zoomBar.current];
    if (els.every((e, i) => e === o.els[i])) return;
    for (const e of o.els) if (e) o.ro.unobserve(e);
    for (const e of els) if (e) o.ro.observe(e);
    o.els = els;
  });

  // C / button: back to the ship (with the automatic view)
  const firstRecenter = useRef(p.recenter);
  useEffect(() => {
    if (p.recenter === firstRecenter.current) return;
    firstRecenter.current = p.recenter;
    setView(autoView(p.pos, p.targets, p.sectors));
  }, [p.recenter]);

  // the map frame: drawn in the next animation frame after a change of what it shows (renders in the
  // same frame share one draw; the game's UI redraw brings new data 10× a second), again at 10 Hz
  // while sector tiles are still being built
  const frame = useRef<MapFrame>({ raf: 0, timer: null, args: null });
  const drawFrame = useRef(() => {
    const f = frame.current;
    f.raf = 0;
    const a = f.args;
    const ctx = a && ref.current ? prepareRect(ref.current, a.size) : null;
    if (!a || !ctx) return;
    const { pending } = drawMap(ctx, a.p, a.view, a.layers, a.size, performance.now(), a.highlight, a.cardSurvey, a.cometFocus, a.noteFocus, a.panels);
    if (pending && f.timer === null) {
      f.timer = setTimeout(() => {
        f.timer = null;
        if (!f.raf) f.raf = requestAnimationFrame(drawFrame.current);
      }, 100);
    }
  });
  const cometFocus = hoverComet ?? pinnedComet;
  const noteFocus = draft?.id ?? null;
  useEffect(() => {
    const f = frame.current;
    f.args = { p, view, layers, size, highlight: card?.security ? { id: card.id, security: card.security } : null, cardSurvey, cometFocus, noteFocus, panels };
    if (!f.raf) f.raf = requestAnimationFrame(drawFrame.current);
  }, [
    p.explored,
    p.stations,
    p.pos.x,
    p.pos.y,
    p.angle,
    p.targets,
    p.fields,
    p.discovery,
    p.pirates,
    p.sectors?.seed,
    p.sectors?.version,
    p.sectors?.current,
    p.guild,
    p.route,
    p.mapNotes,
    p.stale,
    layerKey(layers),
    view,
    size,
    card?.id,
    card?.security,
    cardSurvey,
    cometFocus,
    noteFocus,
    panels,
    iconsLoaded,
    getLocale(),
  ]);
  useEffect(
    () => () => {
      const f = frame.current;
      if (f.raf) cancelAnimationFrame(f.raf);
      if (f.timer !== null) clearTimeout(f.timer);
      f.raf = 0;
      f.timer = null;
      f.args = null;
      releaseMapBase();
    },
    [],
  );

  // M4d keys while the map is open (before the game's keyboard sees them): N toggles the note tool,
  // Esc closes the note editor / the tool, else clears the route – the next Esc closes the map
  const keyState = useRef({ draft, noteTool, route: p.route ?? null, plan, locked: p.notesLocked ?? false });
  keyState.current = { draft, noteTool, route: p.route ?? null, plan, locked: p.notesLocked ?? false };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keyState.current;
      if (!k.plan || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const consume = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.code === 'Escape') {
        if (k.draft) setDraft(null);
        else if (k.noteTool) setNoteTool(false);
        else if (k.route) k.plan.clearRoute();
        else return;
        consume();
        return;
      }
      const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (letterOf(e.code, e.key) === 'n') {
        if (k.locked) setLockFlash((v) => v + 1);
        else setNoteTool((on) => !on);
        consume();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  /** The canvas point of a pointer event (CSS px of the drawn canvas). */
  const canvasAt = (e: { clientX: number; clientY: number }): Vec2 => {
    const rect = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * size.w, y: ((e.clientY - rect.top) / rect.height) * size.h };
  };
  /** World → canvas px with the current view. */
  const toCanvas = (w: Vec2): Vec2 => {
    const s = scaleOf(view, size);
    return { x: size.w / 2 + (w.x - view.center.x) * s, y: size.h / 2 - (w.y - view.center.y) * s };
  };
  /** The map point under the cursor (world coordinates). */
  const worldAt = (e: { clientX: number; clientY: number }): Vec2 => {
    const c = canvasAt(e);
    const s = scaleOf(view, size);
    return { x: view.center.x + (c.x - size.w / 2) / s, y: view.center.y - (c.y - size.h / 2) / s };
  };
  /** The nearest of `items` within PICK_PX of the cursor. */
  const pick = <T,>(e: { clientX: number; clientY: number }, items: readonly T[], posOf: (t: T) => Vec2): T | null => {
    const c = canvasAt(e);
    let best: T | null = null;
    let bestD = PICK_PX;
    for (const it of items) {
      const q = toCanvas(posOf(it));
      const d = Math.hypot(q.x - c.x, q.y - c.y);
      if (d <= bestD) {
        bestD = d;
        best = it;
      }
    }
    return best;
  };
  const noteAt = (e: PointerEvent | MouseEvent): MapNoteView | null => (layers.notes ? pick(e, mapNotes, (n) => n.pos) : null);

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setView(zoomAround(view.center, view.half, worldAt(e), e.deltaY > 0 ? 1.2 : 1 / 1.2));
  };
  const onDown = (e: PointerEvent) => {
    // the right button plans a route (contextmenu), it does not pan
    if (e.button === 2) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, center: view.center, moved: false };
  };
  /** The sector under the cursor (the card), or null without the Sectors layer. */
  const sectorUnder = (e: PointerEvent): { id: string; at: Vec2; right: boolean } | null => {
    if (!sectors) return null;
    const at = worldAt(e);
    const rect = ref.current!.getBoundingClientRect();
    return { id: sectorIdAt(sectors.seed, at.x, at.y), at, right: e.clientX - rect.left < rect.width * 0.4 };
  };
  /** The known comet whose track or nucleus is under the cursor (Places layer on), or null. */
  const cometAt = (e: PointerEvent): string | null => {
    if (!layers.places || !p.discovery?.comets?.length) return null;
    return cometUnder(p.discovery.comets, canvasAt(e), toCanvas);
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) {
      const comet = cometAt(e);
      if (comet !== hoverComet) setHoverComet(comet);
      // over a comet's track the comet speaks, not the sector card
      const under = comet ? null : sectorUnder(e);
      if (under?.id !== hover?.id || under?.right !== hover?.right) setHover(under);
      return;
    }
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
    if (!d.moved) return;
    const rect = ref.current!.getBoundingClientRect();
    const unitsPerPx = (size.w / rect.width) / scaleOf(view, size);
    setView({ half: view.half, center: { x: d.center.x - (e.clientX - d.x) * unitsPerPx, y: d.center.y + (e.clientY - d.y) * unitsPerPx } });
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    // a click (no drag) pins the card of the sector under it; a click on the pinned sector releases it
    if (!d || d.moved || e.type !== 'pointerup') return;
    // M4d: a click away closes the note editor; with the note tool a click places a new note; a click
    // on a note opens it
    if (draft) {
      setDraft(null);
      return;
    }
    if (plan) {
      const note = noteAt(e);
      if (note) {
        setDraft({ id: note.id, pos: { ...note.pos }, icon: note.icon, text: note.text });
        return;
      }
      if (noteTool && !p.notesLocked && !notesFull) {
        setDraft({ pos: worldAt(e), icon: 'star', text: '' });
        return;
      }
    }
    // a click on a comet pins its label (another click releases it); elsewhere the sector card
    const comet = cometAt(e);
    if (comet) {
      setPinnedComet(pinnedComet === comet ? null : comet);
      return;
    }
    const under = sectorUnder(e);
    setPinned(under && pinned?.id !== under.id ? under : null);
  };
  /** Right-click (M4d): a route to the marker under the cursor (station, target, note, convoy) or to the point. */
  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    if (!plan || draft) return;
    const station = layers.stations ? pick(e, p.stations, (s) => s.pos) : null;
    const target = !station && layers.contracts ? pick(e, p.targets, (t) => t.pos) : null;
    const note = !station && !target ? noteAt(e) : null;
    const convoy = !station && !target && !note && layers.convoys ? pick(e, p.guild?.convoys ?? [], (c) => c.pos) : null;
    if (station) plan.route({ ...station.pos }, station.name);
    else if (target) plan.route({ ...target.pos }, target.label);
    else if (note) plan.route({ ...note.pos }, note.text);
    else if (convoy) plan.route({ ...convoy.pos }, tx().guild.map.convoy(null));
    else plan.route(worldAt(e), tx().guild.route.point);
  };
  const saveDraft = () => {
    if (!draft || !plan) return;
    const check = noteTextCheck(draft.text);
    if (!check.ok) return;
    plan.noteSet({ ...(draft.id !== undefined ? { id: draft.id } : {}), pos: draft.pos, icon: draft.icon, text: check.clean });
    setDraft(null);
    setNoteTool(false);
  };
  const zoom = (factor: number) => setView(zoomAround(view.center, view.half, view.center, factor));
  const close = splitShortKeyLabel(tx().map.close);
  const m = tx().discovery.map;
  const discovery = p.discovery;
  const legend = legendGroups({
    layers,
    stations: p.stations,
    targets: p.targets.length,
    signals: discovery?.signals.length ?? 0,
    places: discovery?.places ?? [],
    pirates: p.pirates ?? [],
    fields: p.fields,
    survey: layers.sectors ? [...(discovery?.survey ?? []), ...cardSurvey] : [],
    sites: discovery?.sites ?? [],
    comets: discovery?.comets ?? [],
    guild: p.guild ?? null,
    notes: mapNotes,
    stale: p.stale ?? [],
  });
  // Guild Training step 8 (§6.6): callouts at world points, placed like the flight callouts
  const notes = (discovery?.notes ?? []).flatMap((n) => {
    const { x, y } = toCanvas(n.pos);
    if (x < 0 || y < 0 || x > size.w || y > size.h) return [];
    // labels lean away from the middle (the ship, the home station) but stay inside the display
    const flip = x > size.w - 260 || (x < size.w / 2 && x > 260);
    const below = y < 130 || (y > size.h / 2 && y < size.h - 120);
    return [{ id: `map-${n.id}`, x, y, title: n.title, detail: n.detail, tone: n.tone, flip, below }];
  });
  const gradesHidden = layers.fields && !showGradeLabels(scaleOf(view, size)) && p.fields.some((f) => f.grade !== undefined && !f.depleted);
  const nt = tx().guild.notes;
  const draftAt = draft ? toCanvas(draft.pos) : null;
  // the pinned card's "Trasa sem" plans the route to the sector
  const cardRoute = plan && card && pinned && card.target ? () => plan.route({ ...card.target! }, card.name) : undefined;
  return (
    <div class="hud-map" role="dialog" aria-label={tx().map.title} data-testid="map">
      <Panel material="plate" cut="lg" trim="top" bolts class="hud-map-frame mp-frame">
        <div class="hud-map-head">
          <h2 class="hud-map-title">{tx().map.title}</h2>
          {close ? <KeyHint keys={close.keys}>{close.text}</KeyHint> : <span>{tx().map.close}</span>}
        </div>
        <div class="mp-body">
          <Panel material="screen" cut="md" class="hud-map-screen mp-screen">
            <div ref={stage} class={`mp-stage${noteTool ? ' is-note-tool' : ''}`} data-icons={iconsLoaded}>
              <canvas
                ref={ref}
                class="mp-canvas"
                onWheel={onWheel}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onContextMenu={onContext}
                onPointerLeave={() => {
                  setHover(null);
                  setHoverComet(null);
                }}
                data-testid="map-canvas"
              />
              {notes.length > 0 && (
                <div class="af-callouts mp-notes" data-testid="map-notes">
                  {notes.map((n) => (
                    <Callout key={n.id} {...n} />
                  ))}
                </div>
              )}
              {/* zoom and "back to the ship" sit on the display above the scale bar (M4d: room for the new layers) */}
              <div ref={zoomBar} class="mp-zoom">
                <button type="button" class="mp-zoom-btn af-focusable" aria-label={m.zoomIn} onClick={() => zoom(1 / 1.4)}>
                  +
                </button>
                <button type="button" class="mp-zoom-btn af-focusable" aria-label={m.zoomOut} onClick={() => zoom(1.4)}>
                  −
                </button>
                <button type="button" class="mp-zoom-btn mp-zoom-ship af-focusable" data-testid="map-recenter" onClick={() => setView(autoView(p.pos, p.targets, p.sectors))}>
                  <Key>C</Key> {m.recenter}
                </button>
                <p class="mp-hint">{m.hint}</p>
              </div>
              {card && shown && <SectorCard d={card} pinned={pinned !== null} right={shown.right} {...(cardRoute ? { onRoute: cardRoute } : {})} />}
              {plan && (
                <div ref={tools} class="mp-tools" data-testid="map-tools">
                  {p.route && <RoutePanel route={p.route} onClear={plan.clearRoute} />}
                  <div class="mp-tool-row">
                    {!p.route && <span class="mp-tool-hint">{tx().guild.route.hint}</span>}
                    {p.notesLocked ? (
                      <span key={lockFlash} class={`mp-tool mp-tool--locked${lockFlash > 0 ? ' is-flash' : ''}`} data-testid="map-note-tool" aria-disabled="true">
                        <Key dark>N</Key> {nt.locked}
                      </span>
                    ) : (
                      <button
                        type="button"
                        class="mp-tool af-focusable"
                        aria-pressed={noteTool}
                        data-testid="map-note-tool"
                        disabled={notesFull && !noteTool}
                        title={notesFull ? tx().actionErrors.notesFull : undefined}
                        onClick={() => setNoteTool(!noteTool)}
                      >
                        <img class="mp-tool-icon" src={mapIconUrl('note_flag')} alt="" width={16} height={16} />
                        <Key dark>N</Key> {noteTool ? nt.toolActive : nt.tool}
                        <span class="mp-tool-count">{nt.count(mapNotes.length, NOTES.max)}</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
              {plan && draft && draftAt && (
                <NoteEditor
                  draft={draft}
                  style={editorPlace(draftAt.x, draftAt.y, size)}
                  onChange={setDraft}
                  onSave={saveDraft}
                  onCancel={() => setDraft(null)}
                  {...(draft.id !== undefined
                    ? {
                        onDelete: () => {
                          plan.noteDelete(draft.id!);
                          setDraft(null);
                        },
                        onRoute: () => {
                          plan.route({ ...draft.pos }, noteTextCheck(draft.text).clean || nt.icons[draft.icon]);
                          setDraft(null);
                        },
                      }
                    : {})}
                />
              )}
              {plan && draftAt && !draft?.id && <i class="mp-note-pin" style={{ left: `${draftAt.x}px`, top: `${draftAt.y}px`, width: `${NOTE_PX}px`, height: `${NOTE_PX}px` }} aria-hidden="true" />}
            </div>
          </Panel>
          <aside class="mp-side" aria-label={m.legend}>
            <h3 class="mp-side-title">{m.layersLabel}</h3>
            <div class="mp-layers" role="group" aria-label={m.layersLabel}>
              {MAP_LAYERS.filter((l) => !PENDING_MAP_LAYERS.has(l)).map((l, i) => (
                <button
                  type="button"
                  key={l}
                  class="mp-layer af-focusable"
                  aria-pressed={layers[l]}
                  data-testid={`map-layer-${l}`}
                  onClick={() => p.onToggleLayer?.(l)}
                >
                  <LayerGlyph layer={l} />
                  <span>{m.layers[l]}</span>
                  <Key>{String(i + 1)}</Key>
                </button>
              ))}
            </div>
            {p.targets.length > 0 && (
              <>
                <h3 class="mp-side-title">{m.targets}</h3>
                <ul class="mp-targets">
                  {p.targets.map((t, i) => (
                    <li key={i} class="mp-target-row">
                      <button type="button" class="mp-target af-focusable" title={t.label} onClick={() => setView({ center: { ...t.pos }, half: view.half })}>
                        <span class="mp-target-name">{t.label}</span>
                        <span class="mp-target-dist">{distText(Math.hypot(t.pos.x - p.pos.x, t.pos.y - p.pos.y))}</span>
                      </button>
                      {plan && (
                        <button
                          type="button"
                          class="mp-target-route af-focusable"
                          title={tx().guild.route.here}
                          aria-label={`${tx().guild.route.here}: ${t.label}`}
                          data-testid={`map-target-route-${i}`}
                          onClick={() => plan.route({ ...t.pos }, t.label)}
                        >
                          <i aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div class="mp-legend" data-testid="map-legend">
              {legendRows(legend).map((g) => (
                <div key={g.layer} class="mp-legend-group" data-layer={g.layer}>
                  {(g.layer === 'fields' || g.layer === 'sectors') && <span class="mp-legend-caption">{m.layers[g.layer]}</span>}
                  {g.layer === 'notes' && <span class="mp-legend-inline">{m.layers.notes}:</span>}
                  {g.items.map((item, i) =>
                    g.layer === 'notes' ? (
                      <span key={i} class="mp-legend-item" title={legendName(item)} aria-label={legendName(item)}>
                        <LegendIcon item={item} />
                      </span>
                    ) : (
                      <span key={i} class="mp-legend-item">
                        <LegendIcon item={item} />
                        {legendName(item)}
                      </span>
                    ),
                  )}
                </div>
              ))}
              {gradesHidden && <p class="mp-legend-note">{m.gradeZoomHint}</p>}
            </div>
          </aside>
        </div>
      </Panel>
    </div>
  );
}
