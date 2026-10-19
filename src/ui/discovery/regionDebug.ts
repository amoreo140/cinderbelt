// Dev-only debug layer of the sector prototype (sectors design, stage 0): `?regions` (the generator's variant) or `?regions=A` / `?regions=B` on a dev build draws
// the sector borders, security fills, Guild Lanes with their corridors, seeds, fortresses, both pirate
// corners and the outlines of the sectors known at the start over the map (M). Not a player feature –
// no layer button, no i18n; the production build never calls it.
//
// It also exercises the §6.8 map path: shared label tiles (1 000 u, 50 / 100 / 200 u by zoom) built
// within a time budget per frame and cached, borders from the grid, polygons only for known sectors.
import {
  buildLabelTile,
  MAP_TILE,
  REGION_GEN,
  regionPolygon,
  regionWorld,
  securityOf,
  type LabelTile,
  type RegionVariant,
  type RegionWorld,
  type Security,
} from '../../sim/regions';
import type { Vec2 } from '../../sim/math/vec2';

/** The variant asked for in the URL, or null when the layer is off. */
export function regionDebugVariant(search: string = typeof location === 'undefined' ? '' : location.search): RegionVariant | null {
  const params = new URLSearchParams(search);
  if (!params.has('regions')) return null;
  const v = params.get('regions')?.toUpperCase();
  return v === 'A' || v === 'B' ? v : REGION_GEN.variant;
}

/** The world seed of the running game (dev handle set by Game). */
function runningSeed(): number | null {
  const w = globalThis as { __cinder?: { sim: { state: { seed: number } } } };
  return w.__cinder?.sim.state.seed ?? null;
}

const SECURITY_RGB: Record<Security, [number, number, number]> = {
  quiet: [120, 150, 190],
  guarded: [70, 200, 120],
  contested: [230, 195, 70],
  pirate: [235, 70, 60],
};

interface CachedTile {
  tile: LabelTile;
  /** Security fill, one pixel per sample. */
  canvas: HTMLCanvasElement;
  /** Border segments in world units (x0, y0, x1, y1, …) – marching squares over the samples. */
  borders: Float32Array;
}

const tiles = new Map<string, CachedTile>();
const polygons = new Map<string, { id: string; poly: Vec2[] }[]>();
/** Time budget for building tiles in one map frame (ms). */
const BUILD_BUDGET_MS = 10;

function tileArt(world: RegionWorld, t: LabelTile): CachedTile {
  const n = t.size;
  const step = t.step;
  const x0 = t.tx * MAP_TILE + step / 2;
  const y0 = t.ty * MAP_TILE + step / 2;
  // labels with one extra sample column (east) and row (north) so borders on tile edges close up
  const N = n + 1;
  const ids: string[] = new Array<string>(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      ids[j * N + i] = i < n && j < n ? t.ids[t.labels[j * n + i]!]! : world.field.regionAt(x0 + i * step, y0 + j * step).id;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  const security = t.ids.map((id) => securityOf(world, world.field.seedById(id)!));
  const known = t.ids.map((id) => world.startKnowledge.get(id));
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const l = t.labels[j * n + i]!;
      const [r, g, b] = SECURITY_RGB[security[l]!];
      const k = known[l];
      // canvas rows run top-down, the tile's rows south-north
      const o = ((n - 1 - j) * n + i) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = k === 'charted' ? 120 : k === 'reported' ? 90 : 55;
    }
  }
  ctx.putImageData(img, 0, 0);
  const seg: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = ids[j * N + i];
      const b = ids[j * N + i + 1];
      const c = ids[(j + 1) * N + i];
      const d = ids[(j + 1) * N + i + 1];
      if (a === b && a === c && a === d) continue;
      const x = x0 + i * step;
      const y = y0 + j * step;
      const h = step / 2;
      const mids: [number, number][] = [];
      if (a !== b) mids.push([x + h, y]);
      if (b !== d) mids.push([x + step, y + h]);
      if (c !== d) mids.push([x + h, y + step]);
      if (a !== c) mids.push([x, y + h]);
      if (mids.length === 2) seg.push(mids[0]![0], mids[0]![1], mids[1]![0], mids[1]![1]);
      else for (const m of mids) seg.push(m[0], m[1], x + h, y + h);
    }
  }
  return { tile: t, canvas, borders: Float32Array.from(seg) };
}

/** The sample step for a zoom: the finest level that still gives ≥ 3 px per sample. */
const stepFor = (pxPerUnit: number): number => ([50, 100, 200] as const).find((s) => s * pxPerUnit >= 3) ?? 200;

export interface DebugView {
  center: Vec2;
  /** Pixels per world unit. */
  scale: number;
  w: number;
  h: number;
}

/** Draws the layer when `?regions` is on (dev builds only). */
export function drawRegionDebug(ctx: CanvasRenderingContext2D, view: DebugView): void {
  const variant = regionDebugVariant();
  const seed = runningSeed();
  if (!variant || seed === null) return;
  const world = regionWorld(seed, variant);
  const s = view.scale;
  const toX = (x: number) => view.w / 2 + (x - view.center.x) * s;
  const toY = (y: number) => view.h / 2 - (y - view.center.y) * s;
  const halfW = view.w / 2 / s;
  const halfH = view.h / 2 / s;
  const tx0 = Math.floor((view.center.x - halfW) / MAP_TILE);
  const tx1 = Math.floor((view.center.x + halfW) / MAP_TILE);
  const ty0 = Math.floor((view.center.y - halfH) / MAP_TILE);
  const ty1 = Math.floor((view.center.y + halfH) / MAP_TILE);
  const step = stepFor(s);
  const started = performance.now();
  let missing = 0;
  const drawn: CachedTile[] = [];
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  // nearest tiles first so the view around the centre fills in before the edges
  const order: [number, number][] = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) order.push([tx, ty]);
  const cx = view.center.x / MAP_TILE - 0.5;
  const cy = view.center.y / MAP_TILE - 0.5;
  order.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
  for (const [tx, ty] of order) {
    const key = (st: number) => `${seed}:${variant}:${st}:${tx}:${ty}`;
    let cached = tiles.get(key(step));
    if (!cached && performance.now() - started < BUILD_BUDGET_MS) {
      cached = tileArt(world, buildLabelTile(world.field, tx, ty, step));
      if (tiles.size > 3000) tiles.clear();
      tiles.set(key(step), cached);
    }
    // a coarser level stands in until the right one is built
    cached ??= tiles.get(key(200)) ?? tiles.get(key(100));
    if (!cached) {
      missing++;
      continue;
    }
    drawn.push(cached);
    ctx.drawImage(cached.canvas, toX(tx * MAP_TILE), toY((ty + 1) * MAP_TILE), MAP_TILE * s, MAP_TILE * s);
  }
  ctx.strokeStyle = 'rgba(235, 242, 250, 0.85)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (const t of drawn) {
    const b = t.borders;
    for (let k = 0; k < b.length; k += 4) {
      ctx.moveTo(toX(b[k]!), toY(b[k + 1]!));
      ctx.lineTo(toX(b[k + 2]!), toY(b[k + 3]!));
    }
  }
  ctx.stroke();
  ctx.restore();

  // outlines of the sectors known at the start (polygons only for known sectors, §6.8)
  const polyKey = `${seed}:${variant}`;
  let known = polygons.get(polyKey);
  if (!known) {
    known = [...world.startKnowledge.keys()].map((id) => ({ id, poly: regionPolygon(world.field, world.field.seedById(id)!, 50) }));
    polygons.set(polyKey, known);
  }
  ctx.lineWidth = 2;
  for (const { id, poly } of known) {
    ctx.setLineDash(world.startKnowledge.get(id) === 'reported' ? [6, 4] : []);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    poly.forEach((p, i) => (i === 0 ? ctx.moveTo(toX(p.x), toY(p.y)) : ctx.lineTo(toX(p.x), toY(p.y))));
    ctx.closePath();
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Guild Lanes: corridor band and the line
  for (const lane of world.lanes) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(110, 220, 255, 0.16)';
    ctx.lineWidth = Math.max(2, 2 * REGION_GEN.lanes.corridor * s);
    ctx.beginPath();
    lane.points.forEach((p, i) => (i === 0 ? ctx.moveTo(toX(p.x), toY(p.y)) : ctx.lineTo(toX(p.x), toY(p.y))));
    ctx.stroke();
    ctx.strokeStyle = 'rgba(140, 230, 255, 0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // seeds (depth as a number when zoomed in), fortresses and the corners
  ctx.font = '600 11px monospace';
  ctx.textBaseline = 'middle';
  for (const r of world.regions) {
    const x = toX(r.seed.x);
    const y = toY(r.seed.y);
    if (x < -20 || y < -20 || x > view.w + 20 || y > view.h + 20) continue;
    ctx.fillStyle = 'rgba(10, 16, 24, 0.9)';
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    const tag = r.seed.id === world.corners.depth1 ? 'K1' : r.seed.id === world.corners.depth2 ? 'K2' : s > 0.06 ? `${r.seed.depth}` : '';
    if (tag) {
      ctx.fillStyle = tag.startsWith('K') ? '#ff8a7a' : 'rgba(230, 240, 255, 0.8)';
      ctx.fillText(tag, x + 5, y);
    }
  }
  for (const f of world.inputs.fortresses) {
    const site = f.pos;
    const x = toX(site.x);
    const y = toY(site.y);
    ctx.fillStyle = '#ff4fd8';
    ctx.beginPath();
    ctx.moveTo(x, y - 6);
    ctx.lineTo(x + 6, y);
    ctx.lineTo(x, y + 6);
    ctx.lineTo(x - 6, y);
    ctx.closePath();
    ctx.fill();
  }

  // caption
  const b = world.balance;
  const lines = [
    `SECTORS DEBUG · variant ${variant} · seed ${seed} · grid ${step} u${missing > 0 ? ` · building ${missing} tiles` : ''}`,
    `depth 2 exposure ${b[2]?.area.toFixed(2)} / cautious ${b[2]?.cautious.toFixed(2)} · depth 3 ${b[3]?.area.toFixed(2)} / ${b[3]?.cautious.toFixed(2)}`,
    'fill = security (blue quiet · green guarded · yellow contested · red pirate) · brighter = known at start · K1/K2 corners',
  ];
  ctx.font = '600 12px monospace';
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
  ctx.fillStyle = 'rgba(5, 10, 16, 0.82)';
  ctx.fillRect(8, 8, width, lines.length * 16 + 10);
  ctx.fillStyle = '#d8e6f5';
  lines.forEach((l, i) => ctx.fillText(l, 16, 21 + i * 16));
  ctx.textBaseline = 'alphabetic';
}
