// Shaped armour plates (SL2 E2, shaped-parts plan §2.6, R2;
// ship-building 2 design §6.6): a shaped armour part has no GLB – its model is the
// shape's render polygon (sim/ship/shape.ts `shapePolygon(shape, 0, 'render')`) extruded with the deck
// profile of art/blender/parts/common.py, built here at runtime.
//
// Profile (numbers: shellConstants.ts "shaped plates"; reference: art/blender/mockups/ship2_geo.py
// `armor_poly`): a dark core wall (z −0.20…0.10, `PLATE_CORE_IN` in from the outline), one sloped
// plate-coloured rim face up to the flat plate top at `DECK_TOP` (`PLATE_TOP_IN` in – where the Blender
// plate's 0.012 chamfer ends), and a calm raised pad (`hull_white`) inside a flat dark groove ring in
// the `panel_line` swatch (armor.py Pad / PadGroove). Plates of at least `PLATE_CHEVRON_MIN_AREA` carry
// the armour's tier chevron (armor.py CHEVRON) in the accent swatch, always pointing to the bow. T2+
// plates (a style with a `glow` swatch) add the armor.py level 2/3 detail: a glowing seam strip across
// the pad along the bow axis, a double chevron (T2) or one bold chevron (T3). The walls follow the render
// polygon, so the shell's band and lip (outline at render detail) meet the plate edge exactly; the pad
// follows it with fewer chords (`PAD_CURVE_STEP`). Faces never seen (bottoms, the core's top under the
// rim, the outer step of the groove ring) are not built; flat shading – every face has its own vertices.
//
// Batch-neutral (plan §2.6): the geometry has exactly the attribute layout of the armour template's
// mesh (`ShellLayout`, missing attributes filled with neutral values) and is coloured purely by UVs
// into the shared palette atlas (`SwatchLookup` – never a hard-coded atlas size), so a Mesh of it on
// the armour template's AF_Palette material joins the part batch (+0 draw calls) and follows liveries.
//
// Frame: the part node's own frame at rot 0, like the part GLBs – three.js x = bow, y = up, −z = port,
// the part's footprint centre at the origin. The caller places the node at `partCenter(p)` and turns it
// by `rot · 90°` (rotation.y) exactly like every part model. Computed in the grid frame (x bow, y port,
// h up) and written as (x, h, −y) – a proper rotation, so the winding is kept.
//
// Cached for the session per (shape, style swatches, layout, swatch table, and – only for plates with
// bow-pointing detail – rot: at most 4 variants); the geometry is shared by every view and never
// disposed by one.
import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from 'three';
import type { FactionId } from '../../data/factions';
import { SHAPES, type ShapeId } from '../../data/shapes';
import type { Vec2 } from '../../sim/math/vec2';
import { polygonCentroid, shapePolygon, type Poly } from '../../sim/ship/shape';
import type { Rotation } from '../../sim/ship/types';
import {
  CHEVRON_BOLD_SCALE,
  CHEVRON_MID,
  CHEVRON_OUTLINE,
  CHEVRON_LONG_AREA,
  CHEVRON_LONG_SCALE,
  CHEVRON_PAIR_GAP,
  CHEVRON_Z,
  DECK_TOP,
  PAD_CURVE_STEP,
  PAD_GROOVE_IN,
  PAD_GROOVE_Z,
  PAD_IN,
  PAD_Z,
  PLATE_CHEVRON_MIN_AREA,
  PLATE_CORE_IN,
  PLATE_CORE_Z,
  PLATE_PLAIN_IN,
  PAD_CURVE_STEP_2X1,
  PLATE_SEAM_HALF_W,
  PLATE_SEAM_MIN_LENGTH,
  PLATE_SEAM_Z,
  PLATE_TOP_IN,
  PLATE_Z,
} from './shellConstants';
import { shellStyle, type ShellLayout, type ShellTier, type SwatchLookup } from './shellGeometry';

/** Swatch keys (art/blender/lib/palette.py) of the roles of a shaped plate. */
export interface PlateStyle {
  /** Dark core wall. */
  readonly core: string;
  /** Plate rim and flat top. */
  readonly plate: string;
  /** Raised pad top. */
  readonly pad: string;
  /** The dark groove ring around the pad (armor.py PadGroove). */
  readonly groove: string;
  /** Tier chevron. */
  readonly accent: string;
  /**
   * The glowing seam splitting the pad (armor.py PadSeamGlow, palette TIERS `glow`); null = a calm pad
   * with one chevron. With a glow, `tier` 2 draws a double chevron, 3 one bold chevron.
   */
  readonly glow: string | null;
  /** The armour part's tier (picks the tier detail; not a swatch). */
  readonly tier: ShellTier;
}

/** Player armour by part tier (palette TIERS: plate / core / accent / glow; armor.py pad `hull_white`). */
const PLAYER_PLATE: Record<ShellTier, PlateStyle> = {
  1: Object.freeze({ core: 'hull_dark', plate: 'hull_light', pad: 'hull_white', groove: 'panel_line', accent: 'accent_iron', glow: null, tier: 1 }),
  2: Object.freeze({ core: 'hull_dark_ti', plate: 'hull_ti', pad: 'hull_white', groove: 'panel_line', accent: 'accent_titanium', glow: 'tier_glow_ti', tier: 2 }),
  3: Object.freeze({ core: 'hull_dark_cr', plate: 'hull_cr', pad: 'hull_white', groove: 'panel_line', accent: 'accent_crystal', glow: 'tier_glow_cr', tier: 3 }),
};

/**
 * Swatches of a shaped plate: `tier` = the armour part's own tier (3 = the crystal tier, ready for
 * M5a), `clan` = the ShipView's clan (null = player parts; clans without a shell style fly player
 * parts). Clan plates take their shell swatches – a calm pad in the plate colour, the stripe as the
 * chevron (E2 has no shaped clan parts; E4 only passes the clan).
 */
export function plateStyle(tier: ShellTier, clan: FactionId | null): PlateStyle {
  const player = PLAYER_PLATE[tier];
  if (!clan) return player;
  const s = shellStyle(tier, clan);
  const p = shellStyle(tier, null);
  if (s.core === p.core && s.plate === p.plate && s.stripe === p.stripe) return player;
  return { core: s.core, plate: s.plate, pad: s.plate, groove: s.groove, accent: s.stripe, glow: s.glow, tier };
}

/** armor.py CHEVRON (x bow, y port), counter-clockwise (shared with the terrace's chevron). */
const CHEVRON: readonly Vec2[] = CHEVRON_OUTLINE;
/** Smallest distance the chevron keeps from the pad top's edge (otherwise it is left out). */
const CHEVRON_MARGIN = 0.01;

// ---------------------------------------------------------------------------------------------------
// polygon helpers
// ---------------------------------------------------------------------------------------------------

/**
 * A convex CCW polygon shrunk by `d` (every edge moved inward by `d`, vertices mitred). Valid while
 * `d` stays below the polygon's inradius – true for every inset used here (tests cover all shapes).
 */
function inset(poly: Poly, d: number): Vec2[] {
  const n = poly.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n]!;
    const v = poly[i]!;
    const b = poly[(i + 1) % n]!;
    // inward (left) unit normals of the edges a→v and v→b
    const l1 = Math.hypot(v.x - a.x, v.y - a.y);
    const l2 = Math.hypot(b.x - v.x, b.y - v.y);
    const n1x = -(v.y - a.y) / l1;
    const n1y = (v.x - a.x) / l1;
    const n2x = -(b.y - v.y) / l2;
    const n2y = (b.x - v.x) / l2;
    const k = d / (1 + n1x * n2x + n1y * n2y);
    out.push({ x: v.x + (n1x + n2x) * k, y: v.y + (n1y + n2y) * k });
  }
  return out;
}

/** Distance of `p` inside a convex CCW polygon (negative = outside). */
function insideDistance(p: Vec2, poly: readonly Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    d = Math.min(d, (ex * (p.y - a.y) - ey * (p.x - a.x)) / Math.hypot(ex, ey));
  }
  return d;
}

/**
 * `v` turned by −rot · 90° (exact): the direction that a node turned by rot · 90° shows as `v` – how
 * the bow-pointing detail is drawn in the part's rot-0 frame.
 */
function unturn(v: Vec2, rot: Rotation): Vec2 {
  switch (rot) {
    case 0:
      return v;
    case 1:
      return { x: v.y, y: -v.x };
    case 2:
      return { x: -v.x, y: -v.y };
    case 3:
      return { x: -v.y, y: v.x };
  }
}

/**
 * The parameter range [t0, t1] of the line `o + t · d` inside a convex CCW polygon (null = it misses).
 */
function chordAlong(poly: readonly Vec2[], o: Vec2, d: Vec2): [number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    // inward (left) normal of the edge a→b: n · (p − a) ≥ 0 inside
    const nx = -(b.y - a.y);
    const ny = b.x - a.x;
    const base = nx * (o.x - a.x) + ny * (o.y - a.y);
    const slope = nx * d.x + ny * d.y;
    if (Math.abs(slope) < 1e-12) {
      if (base < 0) return null;
    } else if (slope > 0) t0 = Math.max(t0, -base / slope);
    else t1 = Math.min(t1, -base / slope);
  }
  return t1 > t0 ? [t0, t1] : null;
}

const onHalfGrid =(v: Vec2): boolean => Math.abs(v.x * 2 - Math.round(v.x * 2)) < 1e-9 && Math.abs(v.y * 2 - Math.round(v.y * 2)) < 1e-9;

const padOutlines = new Map<ShapeId, Poly>();

/**
 * The outline the pad follows (rot 0): the render polygon with its corners (every straight-edge vertex
 * lies on the half grid, curve chords never do) and every `PAD_CURVE_STEP`-th vertex along a curve.
 * Its vertices are render vertices, so it lies inside the render polygon.
 */
function padOutline(shape: ShapeId): Poly {
  let out = padOutlines.get(shape);
  if (!out) {
    const kept: Vec2[] = [];
    const step = SHAPES[shape].size.w === 2 ? PAD_CURVE_STEP_2X1 : PAD_CURVE_STEP;
    let run = 0;
    for (const v of shapePolygon(shape, 0, 'render')) {
      if (onHalfGrid(v)) run = 0;
      else if (++run % step !== 0) continue;
      kept.push(v);
    }
    out = Object.freeze(kept);
    padOutlines.set(shape, out);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// vertex sink (grid frame in, three.js frame out)
// ---------------------------------------------------------------------------------------------------

type Uv = readonly [number, number];

class Sink {
  /** three.js frame: x, y, z per vertex. */
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uv: number[] = [];
  readonly idx: number[] = [];
  private count = 0;

  /** One vertex given in the grid frame (x, y, h) with a grid-frame normal. */
  private vertex(x: number, y: number, h: number, nx: number, ny: number, nh: number, uv: Uv): number {
    this.pos.push(x, h, -y);
    this.nrm.push(nx, nh, -ny);
    this.uv.push(uv[0], uv[1]);
    return this.count++;
  }

  /**
   * A planar polygon, counter-clockwise seen from the side it faces (grid frame, `pts` as x, y, h
   * triples), fanned from its first vertex – convex polygons only.
   */
  fan(pts: readonly (readonly [number, number, number])[], uv: Uv): void {
    const n = pts.length;
    if (n < 3) return;
    // Newell normal
    let nx = 0;
    let ny = 0;
    let nh = 0;
    for (let i = 0; i < n; i++) {
      const [x0, y0, h0] = pts[i]!;
      const [x1, y1, h1] = pts[(i + 1) % n]!;
      nx += (y0 - y1) * (h0 + h1);
      ny += (h0 - h1) * (x0 + x1);
      nh += (x0 - x1) * (y0 + y1);
    }
    const len = Math.hypot(nx, ny, nh);
    if (len < 1e-12) return;
    nx /= len;
    ny /= len;
    nh /= len;
    const first = this.count;
    for (const [x, y, h] of pts) this.vertex(x, y, h, nx, ny, nh, uv);
    for (let i = 1; i < n - 1; i++) this.idx.push(first, first + i, first + i + 1);
  }

  /** A horizontal polygon at height `h`, facing up (`poly` CCW from above). */
  cap(poly: readonly Vec2[], h: number, uv: Uv): void {
    this.fan(
      poly.map((v) => [v.x, v.y, h] as const),
      uv,
    );
  }

  /**
   * The faces between two offset rows of the same CCW outline (`lo` below / outside, `hi` above /
   * inside), one quad per edge, facing outward.
   */
  ring(lo: readonly Vec2[], hLo: number, hi: readonly Vec2[], hHi: number, uv: Uv): void {
    const n = lo.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.fan(
        [
          [lo[i]!.x, lo[i]!.y, hLo],
          [lo[j]!.x, lo[j]!.y, hLo],
          [hi[j]!.x, hi[j]!.y, hHi],
          [hi[i]!.x, hi[i]!.y, hHi],
        ],
        uv,
      );
    }
  }

  /** A non-convex horizontal polygon at height `h`, facing up (`poly` CCW from above). */
  capConcave(poly: readonly Vec2[], h: number, uv: Uv): void {
    const contour = poly.map((v) => new Vector2(v.x, v.y));
    const first = this.count;
    for (const v of poly) this.vertex(v.x, v.y, h, 0, 0, 1, uv);
    for (const [a, b, c] of ShapeUtils.triangulateShape(contour, [])) {
      const pa = poly[a!]!;
      const pb = poly[b!]!;
      const pc = poly[c!]!;
      const ccw = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x) > 0;
      if (ccw) this.idx.push(first + a!, first + b!, first + c!);
      else this.idx.push(first + a!, first + c!, first + b!);
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------------------------------

interface PlateUvs {
  core: Uv;
  plate: Uv;
  pad: Uv;
  groove: Uv;
  accent: Uv;
  glow: Uv | null;
}

/** The bow-pointing detail of a plate's pad (rot-0 frame of the part). */
interface PadDetail {
  /** The glowing seam strip across the pad (null = none). */
  readonly seam: readonly Vec2[] | null;
  /** Chevron prisms (CCW outlines). */
  readonly chevrons: readonly (readonly Vec2[])[];
}

/** The chevron outline scaled by `scale`, pointing to the bow of a plate turned by `rot`, its bbox centred on `at`. */
function chevronAt(at: Vec2, scale: number, rot: Rotation): Vec2[] {
  return CHEVRON.map((v) => {
    const d = unturn({ x: (v.x - CHEVRON_MID.x) * scale, y: (v.y - CHEVRON_MID.y) * scale }, rot);
    return { x: at.x + d.x, y: at.y + d.y };
  });
}

/** Offsets (across the bow axis) tried for the tier detail's centre when it does not fit on the centroid. */
const DETAIL_SHIFTS = [0, 0.1, -0.1, 0.2, -0.2];

/**
 * The seam and chevrons of a pad on a plate turned by `rot`: `level` 1 = one chevron, 2 = seam +
 * double chevron, 3 = seam + one bold chevron, all on the bow axis through the pad centroid. Detail
 * that does not fit there slides across the bow axis (`DETAIL_SHIFTS`, seam and chevrons together),
 * then falls back (double / bold → one plain chevron on the centroid → none); a too short seam is
 * left out.
 */
function padDetail(shape: ShapeId, pad: readonly Vec2[], level: 1 | 2 | 3, rot: Rotation): PadDetail {
  const c = polygonCentroid(pad);
  const bow = unturn({ x: 1, y: 0 }, rot);
  const port: Vec2 = { x: -bow.y, y: bow.x };
  const shifted = (o: Vec2, across: number, along = 0): Vec2 => ({
    x: o.x + port.x * across + bow.x * along,
    y: o.y + port.y * across + bow.y * along,
  });
  // the chevron set and its centre
  let centre = c;
  let chevrons: Vec2[][] = [];
  if (SHAPES[shape].area >= PLATE_CHEVRON_MIN_AREA) {
    const base = SHAPES[shape].area > CHEVRON_LONG_AREA ? CHEVRON_LONG_SCALE : 1;
    const gap = CHEVRON_PAIR_GAP * base * 0.5;
    const options: { at: Vec2; set: Vec2[][] }[] = [];
    for (const across of level >= 2 ? DETAIL_SHIFTS : []) {
      const at = shifted(c, across);
      const set =
        level === 2
          ? [chevronAt(shifted(at, 0, -gap), base, rot), chevronAt(shifted(at, 0, gap), base, rot)]
          : [chevronAt(at, base * CHEVRON_BOLD_SCALE, rot)];
      options.push({ at, set });
    }
    options.push({ at: c, set: [chevronAt(c, base, rot)] });
    if (base !== 1) options.push({ at: c, set: [chevronAt(c, 1, rot)] });
    const fit = options.find((o) => o.set.every((ch) => ch.every((v) => insideDistance(v, pad) >= CHEVRON_MARGIN)));
    if (fit) {
      centre = fit.at;
      chevrons = fit.set;
    }
  }
  // the seam: one quad between the chords of its two edges through the pad (inside it: the pad is convex)
  let seam: Vec2[] | null = null;
  if (level >= 2) {
    const oa = shifted(centre, PLATE_SEAM_HALF_W);
    const ob = shifted(centre, -PLATE_SEAM_HALF_W);
    const a = chordAlong(pad, oa, bow);
    const b = chordAlong(pad, ob, bow);
    if (a && b && Math.min(a[1] - a[0], b[1] - b[0]) >= PLATE_SEAM_MIN_LENGTH) {
      // CCW seen from above: the starboard edge aft → bow, then the port edge bow → aft
      seam = [shifted(ob, 0, b[0]), shifted(ob, 0, b[1]), shifted(oa, 0, a[1]), shifted(oa, 0, a[0])];
    }
  }
  return { seam, chevrons };
}

/** Level of a style's tier detail: 1 = calm (no glow swatch), else the tier. */
const detailLevel = (style: PlateStyle): 1 | 2 | 3 => (style.glow ? style.tier : 1);

const padDetails = new Map<string, PadDetail>();

/** `padDetail` of the shape's pad, memoised per (shape, level, rot). */
function detailOf(shape: ShapeId, level: 1 | 2 | 3, rot: Rotation): PadDetail {
  const key = `${shape}|${level}|${rot}`;
  let d = padDetails.get(key);
  if (!d) {
    d = padDetail(shape, inset(padOutline(shape), PAD_IN), level, rot);
    padDetails.set(key, d);
  }
  return d;
}

function buildPlate(shape: ShapeId, s: PlateUvs, detail: PadDetail, sink: Sink): void {
  const outline = shapePolygon(shape, 0, 'render');
  // core wall and the plate rim
  const core = inset(outline, PLATE_CORE_IN);
  const top = inset(outline, PLATE_TOP_IN);
  sink.ring(core, PLATE_CORE_Z[0], core, PLATE_CORE_Z[1], s.core);
  sink.ring(core, PLATE_Z[0], top, PLATE_Z[1], s.plate);
  sink.cap(top, DECK_TOP, s.plate);
  // the pad in its groove ring, on T2+ with the glowing seam strip along the bow axis
  const padLine = padOutline(shape);
  const groove = inset(padLine, PAD_GROOVE_IN);
  const pad = inset(padLine, PAD_IN);
  sink.ring(groove, PAD_GROOVE_Z, pad, PAD_GROOVE_Z, s.groove);
  sink.ring(pad, PAD_GROOVE_Z, pad, PAD_Z, s.pad);
  sink.cap(pad, PAD_Z, s.pad);
  if (detail.seam && s.glow) sink.cap(detail.seam, PLATE_SEAM_Z, s.glow);
  // the tier chevron(s), pointing to the bow
  for (const chevron of detail.chevrons) {
    sink.ring(chevron, CHEVRON_Z[0], chevron, CHEVRON_Z[1], s.accent);
    sink.capConcave(chevron, CHEVRON_Z[1], s.accent);
  }
}

/** Without the swatch table (plain material, colour from the part): one slab with walls and a top. */
function buildPlain(shape: ShapeId, sink: Sink): void {
  const slab = inset(shapePolygon(shape, 0, 'render'), PLATE_PLAIN_IN);
  const uv: Uv = [0, 0];
  sink.ring(slab, PLATE_CORE_Z[0], slab, DECK_TOP, uv);
  sink.cap(slab, DECK_TOP, uv);
}

/** The sink in the layout of the part meshes (missing attributes filled with neutral values). */
function toGeometry(sink: Sink, layout: ShellLayout): BufferGeometry {
  const total = sink.pos.length / 3;
  const attrs = layout.attributes.some((a) => a.name === 'position')
    ? layout.attributes
    : [...layout.attributes, { name: 'position', itemSize: 3 }];
  const geometry = new BufferGeometry();
  for (const { name, itemSize } of attrs) {
    const arr = new Float32Array(total * itemSize);
    if (name === 'position' && itemSize === 3) arr.set(sink.pos);
    else if (name === 'normal' && itemSize === 3) arr.set(sink.nrm);
    else if ((name === 'uv' || /^uv\d$/.test(name)) && itemSize === 2) arr.set(sink.uv);
    else if (name === 'color') arr.fill(1);
    else if (name === 'tangent' && itemSize === 4) for (let i = 0; i < total; i++) (arr[i * 4] = 1), (arr[i * 4 + 3] = 1);
    else if (name === 'normal') for (let i = 0; i < total; i++) arr[i * itemSize + 1] = 1;
    geometry.setAttribute(name, new BufferAttribute(arr, itemSize));
  }
  const index = total > 65535 ? new Uint32Array(sink.idx) : new Uint16Array(sink.idx);
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

const cache = new WeakMap<SwatchLookup, Map<string, BufferGeometry>>();

/**
 * The model geometry of a shaped armour plate in the part node's frame at rot 0 (see the file header:
 * place it at `partCenter(p)` and turn the node by `rot · 90°` like every part model). `rot` is the
 * part's rotation: the chevrons and the seam are drawn turned back by it, so on the placed plate they
 * point to the bow. Cached per (shape, style swatches, layout, swatch table, and rot – only for plates
 * that carry such detail) and shared: callers must not dispose it. When the swatch table has no entry
 * for `style.core` (no palette_swatches.json) the result is a plain slab of the shape for a
 * non-palette placeholder material.
 */
export function shapePlateGeometry(
  shape: ShapeId,
  style: PlateStyle,
  layout: ShellLayout,
  swatchUv: SwatchLookup,
  rot: Rotation = 0,
): BufferGeometry {
  let byTable = cache.get(swatchUv);
  if (!byTable) {
    byTable = new Map();
    cache.set(swatchUv, byTable);
  }
  const coreUv = swatchUv(style.core);
  const layoutKey = layout.attributes.map((a) => `${a.name}${a.itemSize}`).join(',');
  const level = detailLevel(style);
  const detail = coreUv ? detailOf(shape, level, rot) : null;
  // rot only matters for plates with bow-pointing detail (≤ 4 variants per shape and style)
  const turned = detail && (detail.chevrons.length > 0 || detail.seam) ? rot : 0;
  const styleKey = coreUv ? `${style.core},${style.plate},${style.pad},${style.groove},${style.accent},${style.glow ?? '-'},${level}` : 'plain';
  const key = `${shape}|${styleKey}|${layoutKey}|${turned}`;
  const hit = byTable.get(key);
  if (hit) return hit;
  const sink = new Sink();
  if (coreUv && detail) {
    const sw = (k: string): Uv => swatchUv(k) ?? coreUv;
    const uvs: PlateUvs = {
      core: coreUv,
      plate: sw(style.plate),
      pad: sw(style.pad),
      groove: sw(style.groove),
      accent: sw(style.accent),
      glow: style.glow ? sw(style.glow) : null,
    };
    buildPlate(shape, uvs, detail, sink);
  } else {
    buildPlain(shape, sink);
  }
  const geometry = toGeometry(sink, layout);
  byTable.set(key, geometry);
  return geometry;
}
