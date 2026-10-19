// The "Sectors" layer of the map (M) – sectors design §5.1, §6.8 (stage 1a). Replaces the ring circles
// (they stay in the dev debug layer `?regions`):
//  - security fill per known sector, colour + pattern (sectorStyle.ts) – Charted at full strength
//    with a light lift (the fog over it reads as a shadow), Reported fainter under the fog;
//  - borders from the shared label grid: solid where a Charted sector is involved, dashed around
//    Reported ones, and between Uncharted sectors only the pieces inside explored chunks;
//  - Guild Lanes as a faint ±250 u corridor with a double line and buoy marks (label when zoomed out);
//  - sector name labels (name + "[x] Guarded") for the layout of mapLabels.ts.
// The label tiles (1 000 u at 50 / 100 / 200 u by zoom) are plain data from the simulation
// (`buildLabelTile`); they are built nearest-first within a time budget per map frame and cached, with a
// coarser level standing in until the right one is ready. The fill is composed into a screen-size
// canvas that is redrawn only when the view, the knowledge or the set of built tiles changes.
import type { SectorChart } from '../sectors/sectorCardData';
import { tx } from '../../i18n';
import type { Vec2 } from '../../sim/math/vec2';
import { REGION_GEN, type Knowledge, type Security } from '../../sim/regions/constants';
import { buildLabelTile, MAP_TILE, regionPolygon, type LabelTile } from '../../sim/regions/grid';
import { sectorInfo, sectorLanes, sectorSecurity } from '../../sim/regions/sectors';
import { regionWorld, type SecurityOverrides } from '../../sim/regions/world';
import { CHUNK_SIZE } from '../../sim/world/chunks';
import { withAlpha } from '../canvasDraw';
import { LABEL_PRIORITY } from '../mapLabels';
import { chainSegments, organicLine } from '../sectors/polyline';
import { CHARTED_LIFT, drawSecuritySwatch, SECURITY_COLORS, securityFill } from '../sectors/sectorStyle';
import { sectorName } from '../sectors/sectorText';
import { FONTS, PALETTE } from '../theme/tokens';

/** What the map needs from the game layer (sectorsUi.ts). */
export interface MapSectorsData {
  seed: number;
  /** Security now: fortresses down (their sectors are Contested), Guild-secured sectors (Guarded). */
  overrides: SecurityOverrides;
  /** Knowledge of a sector (§3.3: the start knowledge, Charted at 70 % flown). */
  knowledge: (id: string) => Knowledge;
  /** Flown share of a sector 0..1 (§4.1) – the sector card; null / absent = not counted. */
  coverage?: (id: string) => number | null;
  /** The chart of a sector (stage 2): survey points, trade and price – the sector card; absent = none. */
  chart?: (id: string) => SectorChart | null;
  /** Survey points of a sector not Charted yet (stage 2) – drawn while its card is open. */
  survey?: (id: string) => readonly { pos: Vec2; done: boolean }[];
  /** Changes whenever a knowledge or a security changes (cache key of the tile art). */
  version: string;
  /** Explored chunk keys (borders between Uncharted sectors show only there). */
  explored: ReadonlySet<string>;
  /** The ship's sector. */
  current: string | null;
}

export interface MapSectorsView {
  center: Vec2;
  /** Pixels per world unit. */
  scale: number;
  w: number;
  h: number;
}

/** A sector name for the label layout: the name and a second line "[x] Guarded". */
export interface SectorLabel {
  id: string;
  priority: number;
  anchor: { x: number; y: number };
  alternates: { x: number; y: number }[];
  gap: number;
  sides: ('above' | 'below' | 'left' | 'right')[];
  text: string;
  font: string;
  size: number;
  color: string;
  sub?: { text: string; font: string; size: number; color: string };
}

/** Time budget for building label tiles in one map frame (ms). */
export const SECTOR_BUILD_BUDGET_MS = 8;
/** Below this zoom (px per unit) the map is "zoomed out": sector names win over object labels. */
export const SECTOR_FAR_SCALE = 0.07;

/** The sample step for a zoom: the finest level that still gives ≥ 3 px per sample. */
export const sectorStepFor = (pxPerUnit: number): number => ([50, 100, 200] as const).find((s) => s * pxPerUnit >= 3) ?? 200;

type MaskKey = 'lift' | Exclude<Security, 'quiet'>;
const MASK_KEYS: readonly MaskKey[] = ['lift', 'guarded', 'contested', 'pirate'];

// The cached tiles stay in memory for the session (the map comes back to them): the line data is kept
// in Float32Arrays (precise to well under a pixel at any zoom) and the faint pieces name their chunk by
// an index into the tile's few chunk keys – not a string per piece (audit 2026-10-17, P1 heap).
interface TileArt {
  version: string;
  masks: Partial<Record<MaskKey, HTMLCanvasElement>>;
  /** Chained, smoothed border lines (x, y, x, y …, world units). */
  solid: Float32Array[];
  dashed: Float32Array[];
  /** Borders between Uncharted sectors: segments (x0, y0, x1, y1) with the chunk of their midpoint. */
  faint: { seg: Float32Array; chunk: Uint16Array; keys: string[] };
}

interface TileBase {
  tile: LabelTile;
  /** Border segments: x0, y0, x1, y1 with the sector ids on both sides. */
  segs: Float32Array;
  pairs: string[];
  art: TileArt | null;
}

const tiles = new Map<string, TileBase>();
const MAX_TILES = 3000;

/** Build statistics of the last map frame (dev: `window.__cinderSectorStats`). */
export const sectorLayerStats = { frames: 0, built: 0, buildMs: 0, lastFrameBuildMs: 0, maxFrameMs: 0, artMs: 0, missing: 0, composeMs: 0, maxComposeMs: 0, tiles: 0 };
if (import.meta.env?.DEV) (globalThis as { __cinderSectorStats?: typeof sectorLayerStats }).__cinderSectorStats = sectorLayerStats;

/** Marching squares over a label tile plus one extra sample column / row (borders close up at tile edges). */
function tileBase(seed: number, t: LabelTile): TileBase {
  const field = regionWorld(seed).field;
  const n = t.size;
  const step = t.step;
  const x0 = t.tx * MAP_TILE + step / 2;
  const y0 = t.ty * MAP_TILE + step / 2;
  const N = n + 1;
  const ids: string[] = new Array<string>(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) ids[j * N + i] = i < n && j < n ? t.ids[t.labels[j * n + i]!]! : field.regionAt(x0 + i * step, y0 + j * step).id;
  }
  const segs: number[] = [];
  const pairs: string[] = [];
  const h = step / 2;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = ids[j * N + i]!;
      const b = ids[j * N + i + 1]!;
      const c = ids[(j + 1) * N + i]!;
      const d = ids[(j + 1) * N + i + 1]!;
      if (a === b && a === c && a === d) continue;
      const x = x0 + i * step;
      const y = y0 + j * step;
      const mids: [number, number, string, string][] = [];
      if (a !== b) mids.push([x + h, y, a, b]);
      if (b !== d) mids.push([x + step, y + h, b, d]);
      if (c !== d) mids.push([x + h, y + step, c, d]);
      if (a !== c) mids.push([x, y + h, a, c]);
      const [m0, m1] = mids;
      if (mids.length === 2 && ((m0![2] === m1![2] && m0![3] === m1![3]) || (m0![2] === m1![3] && m0![3] === m1![2]))) {
        segs.push(m0![0], m0![1], m1![0], m1![1]);
        pairs.push(m0![2], m0![3]);
      } else {
        for (const m of mids) {
          segs.push(m[0], m[1], x + h, y + h);
          pairs.push(m[2], m[3]);
        }
      }
    }
  }
  return { tile: t, segs: Float32Array.from(segs), pairs, art: null };
}

const KNOWN_RANK: Record<Knowledge, number> = { uncharted: 0, reported: 1, charted: 2 };

function tileArt(base: TileBase, data: MapSectorsData, securityOf: (id: string) => Security): TileArt {
  const t = base.tile;
  const n = t.size;
  const masks: Partial<Record<MaskKey, HTMLCanvasElement>> = {};
  const know = t.ids.map((id) => data.knowledge(id));
  const sec = t.ids.map((id) => securityOf(id));
  for (const key of MASK_KEYS) {
    const alpha = t.ids.map((_, p) => {
      const k = know[p]!;
      if (key === 'lift') return k === 'charted' ? 255 : 0;
      if (sec[p] !== key) return 0;
      return k === 'charted' ? 255 : k === 'reported' ? 140 : 0;
    });
    if (!alpha.some((a) => a > 0)) continue;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = n;
    // a CPU canvas: a GPU one costs a shared image plus a pixel upload per mask, and under software GL
    // (SwiftShader) each upload took ~25 ms – the map's first frames took seconds (audit 2026-10-17, E2)
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) continue;
    const img = ctx.createImageData(n, n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        // canvas rows run top-down, the tile's rows south → north
        const o = ((n - 1 - j) * n + i) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
        img.data[o + 3] = alpha[t.labels[j * n + i]!]!;
      }
    }
    ctx.putImageData(img, 0, 0);
    masks[key] = canvas;
  }
  const solid: number[] = [];
  const dashed: number[] = [];
  const faintSeg: number[] = [];
  const faintChunk: number[] = [];
  const chunkKeys: string[] = [];
  const chunkIndex = new Map<string, number>();
  const knowledge = new Map<string, number>();
  const rank = (id: string) => {
    let r = knowledge.get(id);
    if (r === undefined) {
      r = KNOWN_RANK[data.knowledge(id)];
      knowledge.set(id, r);
    }
    return r;
  };
  const s = base.segs;
  for (let k = 0; k < base.pairs.length / 2; k++) {
    const best = Math.max(rank(base.pairs[k * 2]!), rank(base.pairs[k * 2 + 1]!));
    const x0 = s[k * 4]!;
    const y0 = s[k * 4 + 1]!;
    const x1 = s[k * 4 + 2]!;
    const y1 = s[k * 4 + 3]!;
    if (best === 2) solid.push(x0, y0, x1, y1);
    else if (best === 1) dashed.push(x0, y0, x1, y1);
    else {
      faintSeg.push(x0, y0, x1, y1);
      const key = `${Math.floor((x0 + x1) / 2 / CHUNK_SIZE)},${Math.floor((y0 + y1) / 2 / CHUNK_SIZE)}`;
      let i = chunkIndex.get(key);
      if (i === undefined) {
        i = chunkKeys.length;
        chunkKeys.push(key);
        chunkIndex.set(key, i);
      }
      faintChunk.push(i);
    }
  }
  const lines = (segs: number[]) => chainSegments(segs).map((l) => Float32Array.from(organicLine(l, 0.3 * t.step)));
  return {
    version: data.version,
    masks,
    solid: lines(solid),
    dashed: lines(dashed),
    faint: { seg: Float32Array.from(faintSeg), chunk: Uint16Array.from(faintChunk), keys: chunkKeys },
  };
}

let layer: HTMLCanvasElement | null = null;
let scratch: HTMLCanvasElement | null = null;
let layerDrawn = '';

function screenCanvas(c: HTMLCanvasElement | null, w: number, h: number): HTMLCanvasElement {
  const canvas = c ?? document.createElement('canvas');
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return canvas;
}

/**
 * Draws the Sectors layer (fills, borders, lanes) and returns the sector name labels for the layout.
 * `pending` = some tiles are still being built (the map keeps redrawing anyway, ~10×/s).
 */
export function drawSectorLayer(ctx: CanvasRenderingContext2D, data: MapSectorsData, view: MapSectorsView): { labels: SectorLabel[]; pending: boolean } {
  const { w: W, h: H } = view;
  const s = view.scale;
  const toX = (x: number) => W / 2 + (x - view.center.x) * s;
  const toY = (y: number) => H / 2 - (y - view.center.y) * s;
  const step = sectorStepFor(s);
  const halfW = W / 2 / s;
  const halfH = H / 2 / s;
  const tx0 = Math.floor((view.center.x - halfW) / MAP_TILE);
  const tx1 = Math.floor((view.center.x + halfW) / MAP_TILE);
  const ty0 = Math.floor((view.center.y - halfH) / MAP_TILE);
  const ty1 = Math.floor((view.center.y + halfH) / MAP_TILE);
  const world = regionWorld(data.seed);
  const securities = new Map<string, Security>();
  const securityOf = (id: string): Security => {
    let v = securities.get(id);
    if (!v) {
      v = sectorSecurity(data.seed, id, data.overrides);
      securities.set(id, v);
    }
    return v;
  };

  // tiles nearest to the centre first, built within the budget; a coarser level stands in meanwhile
  const order: [number, number][] = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) order.push([tx, ty]);
  const cx = view.center.x / MAP_TILE - 0.5;
  const cy = view.center.y / MAP_TILE - 0.5;
  order.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
  const started = performance.now();
  let built = 0;
  let missing = 0;
  const keyOf = (st: number, tx: number, ty: number) => `${data.seed}:${st}:${tx}:${ty}`;
  const build = (st: number, tx: number, ty: number): TileBase => {
    const base = tileBase(data.seed, buildLabelTile(world.field, tx, ty, st));
    // the art too, inside the budget (only a knowledge / security change rebuilds it outside)
    base.art = tileArt(base, data, securityOf);
    if (tiles.size >= MAX_TILES) tiles.clear();
    tiles.set(keyOf(st, tx, ty), base);
    built++;
    return base;
  };
  const coarse = (tx: number, ty: number) => tiles.get(keyOf(200, tx, ty)) ?? tiles.get(keyOf(100, tx, ty)) ?? tiles.get(keyOf(50, tx, ty));
  // first every tile gets something (the cheap 200 u level), then the right level, nearest first
  for (const [tx, ty] of order) {
    if (tiles.has(keyOf(step, tx, ty)) || coarse(tx, ty)) continue;
    if (performance.now() - started >= SECTOR_BUILD_BUDGET_MS) break;
    build(200, tx, ty);
  }
  const shown: { base: TileBase; tx: number; ty: number }[] = [];
  for (const [tx, ty] of order) {
    let base = tiles.get(keyOf(step, tx, ty));
    if (!base && performance.now() - started < SECTOR_BUILD_BUDGET_MS) base = build(step, tx, ty);
    if (!base) {
      missing++;
      base = coarse(tx, ty);
    }
    if (!base) continue;
    if (base.art?.version !== data.version) {
      const a0 = performance.now();
      base.art = tileArt(base, data, securityOf);
      sectorLayerStats.artMs += performance.now() - a0;
    }
    shown.push({ base, tx, ty });
  }
  const buildMs = performance.now() - started;
  sectorLayerStats.frames++;
  sectorLayerStats.built += built;
  sectorLayerStats.buildMs += buildMs;
  sectorLayerStats.lastFrameBuildMs = buildMs;
  sectorLayerStats.missing = missing;
  sectorLayerStats.tiles = tiles.size;

  // fills: one mask pass per kind into a screen canvas, then the colour / pattern only where the mask is
  const composeStart = performance.now();
  const signature = `${data.version}|${view.center.x},${view.center.y},${s}|${W}x${H}|${shown.map((t) => `${t.base.tile.step}`).join('')}|${missing}`;
  layer = screenCanvas(layer, W, H);
  if (signature !== layerDrawn) {
    layerDrawn = signature;
    scratch = screenCanvas(scratch, W, H);
    const l = layer.getContext('2d');
    const sc = scratch.getContext('2d');
    if (l && sc) {
      l.clearRect(0, 0, W, H);
      for (const key of MASK_KEYS) {
        if (!shown.some((t) => t.base.art?.masks[key])) continue;
        sc.globalCompositeOperation = 'source-over';
        sc.clearRect(0, 0, W, H);
        sc.imageSmoothingEnabled = true;
        for (const { base, tx, ty } of shown) {
          const m = base.art?.masks[key];
          if (!m) continue;
          // integer edges shared by neighbouring tiles: no seams, no overlaps
          const x0 = Math.round(toX(tx * MAP_TILE));
          const x1 = Math.round(toX((tx + 1) * MAP_TILE));
          const y0 = Math.round(toY((ty + 1) * MAP_TILE));
          const y1 = Math.round(toY(ty * MAP_TILE));
          sc.drawImage(m, x0, y0, x1 - x0, y1 - y0);
        }
        sc.globalCompositeOperation = 'source-in';
        const fill = key === 'lift' ? CHARTED_LIFT : securityFill(sc, key, toX(0), toY(0));
        if (!fill) continue;
        sc.fillStyle = fill;
        sc.fillRect(0, 0, W, H);
        l.drawImage(scratch, 0, 0);
      }
    }
  }
  ctx.drawImage(layer, 0, 0, W, H);
  sectorLayerStats.composeMs = performance.now() - composeStart;
  sectorLayerStats.maxComposeMs = Math.max(sectorLayerStats.maxComposeMs, sectorLayerStats.composeMs);
  sectorLayerStats.maxFrameMs = Math.max(sectorLayerStats.maxFrameMs, performance.now() - started);

  // borders: pale grey-blue; dashed around Reported sectors; faint pieces between Uncharted ones only
  // where the player has flown
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const path = (lines: readonly Float32Array[]) => {
    for (const line of lines) {
      ctx.moveTo(toX(line[0]!), toY(line[1]!));
      for (let k = 2; k < line.length; k += 2) ctx.lineTo(toX(line[k]!), toY(line[k + 1]!));
    }
  };
  ctx.beginPath();
  for (const { base } of shown) {
    const f = base.art!.faint;
    for (let k = 0; k < f.chunk.length; k++) {
      if (!data.explored.has(f.keys[f.chunk[k]!]!)) continue;
      ctx.moveTo(toX(f.seg[k * 4]!), toY(f.seg[k * 4 + 1]!));
      ctx.lineTo(toX(f.seg[k * 4 + 2]!), toY(f.seg[k * 4 + 3]!));
    }
  }
  ctx.strokeStyle = withAlpha(PALETTE.quiet, 0.35);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  for (const { base } of shown) path(base.art!.dashed);
  ctx.setLineDash([7, 5]);
  ctx.strokeStyle = withAlpha(PALETTE.quiet, 0.75);
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const { base } of shown) path(base.art!.solid);
  ctx.strokeStyle = 'rgba(5, 12, 20, 0.55)';
  ctx.lineWidth = 3.2;
  ctx.stroke();
  ctx.strokeStyle = withAlpha(PALETTE.quiet, 0.9);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  drawLanes(ctx, data.seed, s, toX, toY);
  const labels = sectorMapLabels(data, view, securityOf);
  // the lane names only when zoomed out (§5.1), at the middle of the line
  if (s < SECTOR_FAR_SCALE) {
    for (const lane of sectorLanes(data.seed)) {
      const p = lane.points[Math.floor(lane.points.length / 2)];
      if (!p) continue;
      const x = toX(p.x);
      const y = toY(p.y);
      if (x < 0 || y < 0 || x > W || y > H) continue;
      labels.push({
        id: `lane:${lane.id}`,
        priority: LABEL_PRIORITY.grade,
        anchor: { x, y },
        alternates: [],
        gap: 6,
        sides: ['right', 'left', 'above', 'below'],
        text: tx().sectors.map.lane(lane.id),
        font: `italic 600 11px ${FONTS.display}`,
        size: 11,
        color: withAlpha(PALETTE.hull, 0.85),
      });
    }
  }
  return { labels, pending: missing > 0 };
}

/** Guild Lanes (§5.1): a faint corridor band, a double thin line and buoy marks along it. */
function drawLanes(ctx: CanvasRenderingContext2D, seed: number, s: number, toX: (x: number) => number, toY: (y: number) => number): void {
  const lanes = sectorLanes(seed);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const lane of lanes) {
    ctx.beginPath();
    lane.points.forEach((p, i) => (i === 0 ? ctx.moveTo(toX(p.x), toY(p.y)) : ctx.lineTo(toX(p.x), toY(p.y))));
    ctx.strokeStyle = withAlpha(PALETTE.hull, 0.06);
    ctx.lineWidth = Math.max(3, 2 * REGION_GEN.lanes.corridor * s);
    ctx.stroke();
    // double line: a wide pale stroke with a dark core
    ctx.strokeStyle = withAlpha(PALETTE.hull, 0.8);
    ctx.lineWidth = 4.6;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(10, 21, 33, 0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // buoys about every 120 px along the line
    const every = 120;
    let carry = every / 2;
    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1]!;
      const b = lane.points[i]!;
      const ax = toX(a.x);
      const ay = toY(a.y);
      const len = Math.hypot(toX(b.x) - ax, toY(b.y) - ay);
      let d = carry;
      while (d <= len) {
        const t = d / len;
        drawBuoy(ctx, ax + (toX(b.x) - ax) * t, ay + (toY(b.y) - ay) * t);
        d += every;
      }
      carry = d - len;
    }
  }
  ctx.restore();
}

/** A Guild buoy: a small hull-white diamond with a blue strobe. */
export function drawBuoy(ctx: CanvasRenderingContext2D, x: number, y: number, r = 4): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fillStyle = PALETTE.hull;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = PALETTE.screen;
  ctx.stroke();
  ctx.fillStyle = PALETTE.titan;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.38, 0, Math.PI * 2);
  ctx.fill();
}

/** The double lane line for the legend. */
export function drawLaneSwatch(ctx: CanvasRenderingContext2D, x0: number, y: number, x1: number): void {
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.strokeStyle = withAlpha(PALETTE.hull, 0.85);
  ctx.lineWidth = 4.6;
  ctx.stroke();
  ctx.strokeStyle = PALETTE.screen;
  ctx.lineWidth = 2;
  ctx.stroke();
  drawBuoy(ctx, (x0 + x1) / 2, y, 3.5);
}

/** Knowledge legend swatch: Charted = lifted area, solid border; Reported = dashed; Uncharted = faint. */
export function drawKnowledgeSwatch(ctx: CanvasRenderingContext2D, k: Knowledge, x: number, y: number, w: number, h: number): void {
  if (k === 'charted') {
    ctx.fillStyle = 'rgba(176, 204, 232, 0.22)';
    ctx.fillRect(x, y, w, h);
  }
  ctx.setLineDash(k === 'reported' ? [3, 2] : []);
  ctx.strokeStyle = withAlpha(PALETTE.quiet, k === 'uncharted' ? 0.4 : 0.95);
  ctx.lineWidth = k === 'uncharted' ? 1 : 1.5;
  ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
  ctx.setLineDash([]);
}

export { drawSecuritySwatch };

/**
 * Name labels of the known sectors (Charted, Reported) whose anchor is in view – the inputs of the
 * label layout (mapLabels.ts): below the stations near home, above them when zoomed out. Pure.
 */
export function sectorMapLabels(
  data: Pick<MapSectorsData, 'seed' | 'knowledge' | 'overrides'>,
  view: MapSectorsView,
  securityOf: (id: string) => Security = (id) => sectorSecurity(data.seed, id, data.overrides),
): SectorLabel[] {
  const { w: W, h: H } = view;
  const s = view.scale;
  const toX = (x: number) => W / 2 + (x - view.center.x) * s;
  const toY = (y: number) => H / 2 - (y - view.center.y) * s;
  const regions = regionWorld(data.seed).regions;
  const t = tx().sectors;
  const far = s < SECTOR_FAR_SCALE;
  const out: SectorLabel[] = [];
  for (const r of regions) {
    // the view first: the knowledge of a sector far off screen would cache its chunk list for nothing
    const x = toX(r.seed.x);
    const y = toY(r.seed.y);
    if (x < -40 || y < -20 || x > W + 40 || y > H + 20) continue;
    const k = data.knowledge(r.seed.id);
    if (k === 'uncharted') continue;
    const info = sectorInfo(data.seed, r.seed.id);
    if (!info) continue;
    const security = securityOf(r.seed.id);
    const size = far ? 12 : 13;
    const h = size + 4 + 13;
    out.push({
      id: `sector:${r.seed.id}`,
      // below the stations near home, above everything when zoomed out (only sector names stay)
      priority: far ? LABEL_PRIORITY.station - 0.5 : LABEL_PRIORITY.sector,
      anchor: { x, y },
      alternates: [
        { x, y: y + h + 2 },
        { x, y: y - h - 2 },
      ],
      gap: -h / 2,
      sides: ['below'],
      text: sectorName(info.name),
      font: `${k === 'charted' ? 750 : 650} ${size}px ${FONTS.display}`,
      size,
      color: withAlpha(PALETTE.text, k === 'charted' ? 0.95 : 0.78),
      sub: {
        text: `${t.glyph[k]} ${t.security[security].toLocaleUpperCase()}`,
        font: `700 10.5px ${FONTS.display}`,
        size: 11,
        color: SECURITY_COLORS[security],
      },
    });
  }
  return out;
}

/** Distance from `pos` to the nearest sector border (the automatic map view shows it, §5.1). */
export function nearestSectorBorder(seed: number, pos: Vec2, maxDistance = 1600): number {
  const field = regionWorld(seed).field;
  const here = field.regionAt(pos.x, pos.y).id;
  let best = maxDistance;
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    for (let d = 50; d < best; d += 50) {
      if (field.regionAt(pos.x + dx * d, pos.y + dy * d).id !== here) {
        best = d;
        break;
      }
    }
  }
  return best;
}

/** Outlines of highlighted sectors (the sector card), at the 50 u grid – a few are kept. */
const outlines = new Map<string, Vec2[]>();

/** The outline of a sector (world units, cached; empty for an unknown id). */
export function sectorOutline(seed: number, id: string): readonly Vec2[] {
  const key = `${seed}|${id}`;
  let poly = outlines.get(key);
  if (!poly) {
    const field = regionWorld(seed).field;
    const s = field.seedById(id);
    poly = s ? regionPolygon(field, s, 50) : [];
    if (outlines.size >= 16) outlines.delete(outlines.keys().next().value!);
    outlines.set(key, poly);
  }
  return poly;
}

/**
 * The sector under the card (§5.1): its outline in the security colour over the layer, with a soft
 * halo – only for a sector the player knows (an Uncharted one would give its shape away, §3.3).
 */
export function drawSectorHighlight(ctx: CanvasRenderingContext2D, seed: number, id: string, security: Security, view: MapSectorsView): void {
  const poly = sectorOutline(seed, id);
  if (poly.length < 3) return;
  const toX = (x: number) => view.w / 2 + (x - view.center.x) * view.scale;
  const toY = (y: number) => view.h / 2 - (y - view.center.y) * view.scale;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(toX(poly[0]!.x), toY(poly[0]!.y));
  for (let k = 1; k < poly.length; k++) ctx.lineTo(toX(poly[k]!.x), toY(poly[k]!.y));
  ctx.closePath();
  ctx.lineJoin = 'round';
  const color = SECURITY_COLORS[security];
  ctx.strokeStyle = withAlpha(color, 0.25);
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.strokeStyle = withAlpha(color, 0.95);
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.restore();
}
