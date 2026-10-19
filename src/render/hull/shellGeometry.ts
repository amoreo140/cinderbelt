// Hull shell geometry (SL2 E1, spec §3.2 step 6, §3.3–3.7, §3.11): the meshes built from a
// `HullOutline` (src/sim/ship/outline.ts) – side band, trim lip, corner guards, seam strips, soot on
// torn edges, terraces (v2: the low inner spine) and (hangar / shipyard on High) panel grooves and clan
// lip decorations.
// Reference: art/blender/mockups/ship2_geo.py (`Shell.build`, `_seg`, `_guards`, `_seams`, `_grooves`,
// `_torn`, `terrace`). Numbers: shellConstants.ts.
//
// Batch-neutral by construction (plan §2): the result is one geometry per **owner part**; ShipView
// (plan T4) adds each as a child Mesh of that part's node with the part's own AF_Palette material, and
// the geometry has exactly the attribute layout of the part meshes (`ShellLayout`), so `bakeHull`
// merges it into the existing batches (+0 draw calls). Colours come from UVs into the shared palette
// atlas (`SwatchLookup`, from palette_swatches.json) – never from a hard-coded atlas size.
//
// Construction: every outline loop becomes a closed polygon (bevelled player armour corners cut
// `BEVEL`, split at owner changes so each piece has one owner), with a mitre vector per vertex. The
// band and the lip are one **profile** – a polyline in the (out, height) plane – swept along each
// straight segment between the mitred vertex offsets, so consecutive segments join without gaps and
// a run of one owner is a single quad strip. Faces that are never visible (the band's inner face and
// bottom, the lip's bottom) are not built. Flat shading: every quad has its own four vertices.
//
// Shaped parts (SL2 E2 R3, shaped-parts plan): `shaped`
// runs (diagonals, curve chords – the outline at `detail: 'render'`) get the band and the lip like raw
// ones; shaped armour is never bevelled and gets no guards (outline.ts decides). Acute vertices (nose
// tips, free wing tips, notches beside them, curve cusps of enclosed cuts) are bevelled once the mitre
// would exceed `MITRE_LIMIT` × the offset (`polyOf`), so nothing spikes out of the hull.
//
// Frame: computed in the grid frame (x bow, y port, h up) and written in the hull-local three.js
// frame of `simToWorld` – (x, h, −y). That map is a proper rotation, so the winding is kept.
import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from 'three';
import type { FactionId } from '../../data/factions';
import type { PartId, Tier } from '../../data/parts';
import type { Vec2 } from '../../sim/math/vec2';
import type { EdgeKind, HullOutline } from '../../sim/ship/outline';
import type { ShipGrid } from '../../sim/ship/types';
import type { GraphicsQuality } from '../quality';
import {
  BAND_CORE_Z,
  BAND_IN,
  BAND_OUT,
  BAND_PLATE_Z,
  BEVEL,
  DECK_TOP,
  EMBER_IN,
  EMBER_TOOTH,
  EMBER_Z,
  GLOW_OUT,
  GLOW_Z,
  GROOVE_IN,
  GROOVE_W,
  GUARD_ARM,
  GUARD_CAP,
  GUARD_OUT,
  GUARD_T,
  GUARD_Z,
  LIP_CHAMFER,
  LIP_W,
  LIP_Z,
  SEAM_CROSS_LIFT,
  SEAM_LINE_W,
  SEAM_W,
  SEAM_Z,
  SHELL_MAX_TRIANGLES,
  SOOT_IN,
  SOOT_SIDE_OUT,
  SOOT_SIDE_Z,
  SOOT_Z,
  STRIPE_OUT,
  STRIPE_Z,
  CHEVRON_MID,
  CHEVRON_OUTLINE,
  CHEVRON_Z,
  TERRACE_BASE_Z,
  TERRACE_GROOVE_LIFT,
  TERRACE_GROOVE_W,
  TERRACE_INSET,
  TERRACE_LINE_W,
  TERRACE_MIN_CELLS,
  TERRACE_SLOPE,
  TERRACE_TOP_Z,
} from './shellConstants';
import { hullTerraceEnabled } from './setting';

/** UV of a palette swatch's centre in the shared atlas, or null when the key is unknown (ModelLibrary.swatchUv). */
export type SwatchLookup = (key: string) => readonly [number, number] | null;

/** Where a ship is shown (ShipViewOptions.mode): grooves and clan lip decorations only off-flight on High. */
export type ShellMode = 'flight' | 'hangar' | 'shipyard';

/**
 * Tier of the shell style: the cockpit's tier. 3 = the crystal tier (M5a art: `*_cr` swatches) – the
 * part data has no T3 yet, the style is ready for it.
 */
export type ShellTier = Tier | 3;

/**
 * Swatch keys (art/blender/lib/palette.py) for each role of the shell of one ship. Player ships take
 * the tier of their **cockpit** (lip = the tier accent: T1 orange, T2 blue, T3 violet); clan ships
 * their clan's swatches (art/README §2.7.21, §3.1).
 */
export interface ShellStyle {
  /** Dark core layer of the band; also the guards' body. */
  core: string;
  /** Plate-coloured upper band layer. */
  plate: string;
  /** Tier stripe of the band; guard caps, the terrace's top-edge line and its chevron. */
  stripe: string;
  /** Glow line of the band (T2+), null = none. */
  glow: string | null;
  /** Trim lip. */
  lip: string;
  /** Seam strips between parts (clans: their seam swatch; player: the core); clan lip decorations. */
  seam: string;
  /** Seam strip width (the Slanted Star: a thin gold line). */
  seamW: number;
  /** Terrace top and sides (player: the matte `hull_mid`, darker than every tier plate – no glare). */
  terraceSide: string;
  /** Panel grooves. */
  groove: string;
  /**
   * Torn edges (spec §3.7): the main soot patches (60 %) – dark char on light hulls, light ash on dark
   * clan hulls, so they contrast with the deck – and the other patches (40 %).
   */
  soot: string;
  sootAlt: string;
  /** Charred exposed side of a torn edge. */
  char: string;
  /** Glowing rim along a torn edge (an emissive swatch). */
  ember: string;
  /** Clan decoration along the lip (High, hangar / shipyard only): Slanted Star slashes, Rust welds. */
  deco: 'slashes' | 'welds' | null;
}

const PLAYER_TIER_STYLE: Record<ShellTier, Pick<ShellStyle, 'core' | 'plate' | 'stripe' | 'glow' | 'lip'>> = {
  1: { core: 'hull_dark', plate: 'hull_light', stripe: 'accent_iron', glow: null, lip: 'accent_iron' },
  2: { core: 'hull_dark_ti', plate: 'hull_ti', stripe: 'accent_titanium', glow: 'tier_glow_ti', lip: 'accent_titanium' },
  3: { core: 'hull_dark_cr', plate: 'hull_cr', stripe: 'accent_crystal', glow: 'tier_glow_cr', lip: 'accent_crystal' },
};

/**
 * Torn-edge swatches (art/README §3.1). Light and mid-tone decks (player hulls, the Rust's worn plates):
 * dark char patches. Dark decks (the Slanted Star's lacquer, the Cauldron's iron): matte light `ash` patches. The
 * torn rim is `ember`, except on the Cauldron, whose orange paint needs the hotter yellow-white `hot_edge`.
 */
const CHAR_SOOT = { soot: 'char_black', sootAlt: 'scorch', char: 'char_black', ember: 'ember' } as const;
const ASH_SOOT = { soot: 'ash', sootAlt: 'char_black', char: 'char_black', ember: 'ember' } as const;
const HOT_ASH_SOOT = { ...ASH_SOOT, ember: 'hot_edge' } as const;

/** Clan shell swatches (mock-up `style()`; the Cauldron by the same pattern; art/README §3.1 table). */
const CLAN_STYLE: Partial<Record<FactionId, (tier: ShellTier) => ShellStyle>> = {
  slantedStar: (tier) => ({
    core: 'sst_lacquer', plate: 'sst_lacquer', stripe: 'sst_gold_dark', glow: tier >= 2 ? 'sst_glow' : null,
    lip: 'sst_lacquer', seam: 'sst_gold', seamW: SEAM_LINE_W, terraceSide: 'sst_lacquer', groove: 'panel_line',
    ...ASH_SOOT, deco: 'slashes',
  }),
  rust: (tier) => ({
    core: 'pir_gunmetal_dark', plate: 'pir_gunmetal', stripe: 'pir_rust', glow: tier >= 2 ? 'pir_glow_red' : null,
    lip: 'pir_rust_patch', seam: 'pir_weld', seamW: SEAM_W, terraceSide: 'pir_gunmetal', groove: 'panel_line',
    ...CHAR_SOOT, deco: 'welds',
  }),
  cauldron: (tier) => ({
    core: 'kot_iron_dark', plate: 'kot_iron', stripe: 'kot_paint', glow: tier >= 2 ? 'kot_furnace' : null,
    lip: 'kot_copper', seam: 'kot_iron_dark', seamW: SEAM_W, terraceSide: 'kot_iron', groove: 'panel_line',
    ...HOT_ASH_SOOT, deco: null,
  }),
};

/**
 * Shell swatches of a ship: `tier` = the cockpit's tier, `clan` = the ShipView's clan (null = player
 * parts, also for clans without a style – they fly player parts).
 */
export function shellStyle(tier: ShellTier, clan: FactionId | null): ShellStyle {
  const byClan = clan ? CLAN_STYLE[clan] : undefined;
  if (byClan) return byClan(tier);
  const t = PLAYER_TIER_STYLE[tier];
  return {
    ...t, seam: t.core, seamW: SEAM_W, terraceSide: 'hull_mid', groove: 'panel_line',
    ...CHAR_SOOT, deco: null,
  };
}

/**
 * Vertex attribute layout of a reference part mesh (name → item size, sorted by name, as
 * `shipBatch.batchKey` keys it). The shell geometry carries exactly these attributes – missing ones
 * filled with neutral values (normal up, colour white, uv at the swatch) – so it joins the part batch.
 */
export interface ShellLayout {
  readonly attributes: ReadonlyArray<{ readonly name: string; readonly itemSize: number }>;
}

/** The layout of a part mesh's geometry (the first `MeshStandardMaterial` mesh of a part template). */
export function shellLayoutOf(geometry: BufferGeometry): ShellLayout {
  const names = Object.keys(geometry.attributes).sort();
  return { attributes: names.map((name) => ({ name, itemSize: geometry.getAttribute(name).itemSize })) };
}

/** The layout of the shipped part GLBs (POSITION, NORMAL, TEXCOORD_0) – tests and fallbacks. */
export const PART_LAYOUT: ShellLayout = {
  attributes: [
    { name: 'normal', itemSize: 3 },
    { name: 'position', itemSize: 3 },
    { name: 'uv', itemSize: 2 },
  ],
};

export interface ShellBuildInput {
  outline: HullOutline;
  style: ShellStyle;
  layout: ShellLayout;
  swatchUv: SwatchLookup;
  quality: GraphicsQuality;
  mode: ShellMode;
  /**
   * The grid the outline was computed from – only needed for the panel grooves (which run over flat
   * parts only); without it there are no grooves.
   */
  grid?: ShipGrid;
  /** Build the outline's terraces (v2)? Default: `hullTerraceEnabled()` (TERRACE_ENABLED or the dev override). */
  terraces?: boolean;
}

/** Parts whose deck is flat enough for a panel groove (mock-up `FLAT`). */
const FLAT_PARTS: ReadonlySet<PartId> = new Set<PartId>(['armor', 'cargo', 'largeCargo', 'battery']);

// ---------------------------------------------------------------------------------------------------
// vertex sink: one scratch for the whole build, a piece per owner
// ---------------------------------------------------------------------------------------------------

/**
 * Build scratch shared by every piece of a build (module-level, grown on demand, reused – a build is
 * synchronous): vertices in build order (three.js frame: x, y, z, nx, ny, nz, u, v), the owner slot of
 * each vertex and the triangles as global vertex numbers. `toGeometries` sorts them out per owner.
 */
const scratch = {
  v: new Float32Array(8 * 4096),
  slot: new Uint16Array(4096),
  tri: new Uint32Array(6 * 4096),
  local: new Uint32Array(4096),
  nv: 0,
  ni: 0,
};

function reserve(vertices: number, indices: number): void {
  const needV = scratch.nv + vertices;
  if (needV > scratch.slot.length) {
    const cap = Math.max(needV, scratch.slot.length * 2);
    const v = new Float32Array(cap * 8);
    v.set(scratch.v);
    scratch.v = v;
    const slot = new Uint16Array(cap);
    slot.set(scratch.slot);
    scratch.slot = slot;
    scratch.local = new Uint32Array(cap);
  }
  const needI = scratch.ni + indices;
  if (needI > scratch.tri.length) {
    const t = new Uint32Array(Math.max(needI, scratch.tri.length * 2));
    t.set(scratch.tri);
    scratch.tri = t;
  }
}

/** The shell piece of one owner part: writes its vertices and triangles into the build scratch. */
class Piece {
  /** Vertices and triangle corners of this piece. */
  count = 0;
  indices = 0;
  constructor(readonly slot: number) {}

  private vertex(x: number, y: number, h: number, nx: number, ny: number, nh: number, uv: Uv): void {
    const o = scratch.nv * 8;
    const v = scratch.v;
    v[o] = x;
    v[o + 1] = h;
    v[o + 2] = -y;
    v[o + 3] = nx;
    v[o + 4] = nh;
    v[o + 5] = -ny;
    v[o + 6] = uv[0];
    v[o + 7] = uv[1];
    scratch.slot[scratch.nv++] = this.slot;
  }

  private corners(a: number, b: number, c: number): void {
    const t = scratch.tri;
    t[scratch.ni++] = a;
    t[scratch.ni++] = b;
    t[scratch.ni++] = c;
  }

  /**
   * A planar quad p0…p3 (grid frame: x, y, h) facing (nx, ny, nh) – unit length. The winding is chosen
   * from the quad's own normal ((p2 − p0) × (p3 − p1)), so callers may list the corners either way.
   */
  quad(
    x0: number, y0: number, h0: number,
    x1: number, y1: number, h1: number,
    x2: number, y2: number, h2: number,
    x3: number, y3: number, h3: number,
    nx: number, ny: number, nh: number,
    uv: Uv,
  ): void {
    const ax = x2 - x0;
    const ay = y2 - y0;
    const ah = h2 - h0;
    const bx = x3 - x1;
    const by = y3 - y1;
    const bh = h3 - h1;
    const flip = (ay * bh - ah * by) * nx + (ah * bx - ax * bh) * ny + (ax * by - ay * bx) * nh < 0;
    reserve(4, 6);
    const b = scratch.nv;
    this.vertex(x0, y0, h0, nx, ny, nh, uv);
    this.vertex(x1, y1, h1, nx, ny, nh, uv);
    this.vertex(x2, y2, h2, nx, ny, nh, uv);
    this.vertex(x3, y3, h3, nx, ny, nh, uv);
    if (flip) {
      this.corners(b, b + 2, b + 1);
      this.corners(b, b + 3, b + 2);
    } else {
      this.corners(b, b + 1, b + 2);
      this.corners(b, b + 2, b + 3);
    }
    this.count += 4;
    this.indices += 6;
  }

  /** A horizontal triangle at height h facing up. */
  triUp(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, h: number, uv: Uv): void {
    reserve(3, 3);
    const b = scratch.nv;
    this.vertex(x0, y0, h, 0, 0, 1, uv);
    this.vertex(x1, y1, h, 0, 0, 1, uv);
    this.vertex(x2, y2, h, 0, 0, 1, uv);
    if ((x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0) < 0) this.corners(b, b + 2, b + 1);
    else this.corners(b, b + 1, b + 2);
    this.count += 3;
    this.indices += 3;
  }

  /** A vertical wall from (ax, ay) to (bx, by), h0…h1, facing (nx, ny) (horizontal unit). */
  wall(ax: number, ay: number, bx: number, by: number, h0: number, h1: number, nx: number, ny: number, uv: Uv): void {
    this.quad(ax, ay, h0, bx, by, h0, bx, by, h1, ax, ay, h1, nx, ny, 0, uv);
  }

  /** A horizontal convex quad at height h facing up. */
  flat(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, h: number, uv: Uv): void {
    this.quad(x0, y0, h, x1, y1, h, x2, y2, h, x3, y3, h, 0, 0, 1, uv);
  }

  /** A box-like prism over a convex CCW-or-CW quad footprint: top + the four sides. */
  prism4(xs: readonly number[], ys: readonly number[], h0: number, h1: number, uv: Uv): void {
    this.flat(xs[0]!, ys[0]!, xs[1]!, ys[1]!, xs[2]!, ys[2]!, xs[3]!, ys[3]!, h1, uv);
    const ccw = (xs[1]! - xs[0]!) * (ys[2]! - ys[0]!) - (ys[1]! - ys[0]!) * (xs[2]! - xs[0]!) > 0 ? 1 : -1;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) & 3;
      const dx = xs[j]! - xs[i]!;
      const dy = ys[j]! - ys[i]!;
      const l = Math.hypot(dx, dy) || 1;
      this.wall(xs[i]!, ys[i]!, xs[j]!, ys[j]!, h0, h1, (ccw * dy) / l, (-ccw * dx) / l, uv);
    }
  }
}

type Uv = readonly [number, number];

// ---------------------------------------------------------------------------------------------------
// polygons with mitres
// ---------------------------------------------------------------------------------------------------

/**
 * A closed polygon with the solid on the left of travel: vertex i starts segment i (to i + 1).
 * `mx/my` = mitre vector at a vertex for offsets on the outward side (a point offset `d ≥ 0` is
 * `p + d·m`), `ix/iy` the one for inward offsets (`d < 0`) – the same vector except at a split acute
 * vertex; `tx/ty` = unit direction of segment i; its outward normal is (ty, −tx).
 *
 * Mitre limit (E2 shaped edges: wing tips, nose tips, wedge tips, curve cusps of enclosed cuts): where
 * the mitre would be longer than `MITRE_LIMIT` × the offset (the corner is sharper than 60°), the vertex
 * is split in two at the same point and joined by a zero-length **bevel segment** (`bev` ≠ 0): on the
 * side where the offsets fly apart (outward at a convex tip, inward at a concave notch) each copy is
 * offset along its own segment's normal and the bevel segment closes the gap; on the other side, where
 * the offsets converge, both copies share the true mitre.
 */
interface Poly {
  n: number;
  px: number[];
  py: number[];
  mx: number[];
  my: number[];
  ix: number[];
  iy: number[];
  tx: number[];
  ty: number[];
  len: number[];
  /** Segment i is the bevel join of a split vertex, on the outward (+1) or inward (−1) side; 0 = an edge. */
  bev: number[];
  /** Input vertex of segment i (`polyOf`'s argument index); a bevel join: the vertex it replaces. */
  src: number[];
}

/**
 * Mitre limit: the longest mitre as a multiple of the offset (SVG `stroke-miterlimit` 2 – corners
 * sharper than 60° are bevelled). Right angles (√2) and the shaved armour corners never reach it.
 */
const MITRE_LIMIT = 2;
/** 1 + n1·n2 below this ⇔ the mitre is longer than MITRE_LIMIT (|m| = √(2 / (1 + n1·n2))). */
const MITRE_K_MIN = 2 / (MITRE_LIMIT * MITRE_LIMIT);
/**
 * Longest converging mitre at a split vertex (× the offset) – only a guard against a full U-turn. The
 * converging offsets keep the true mitre (it stays on both offset lines, so rails at different offsets
 * never cross); where it runs past a short neighbouring edge (the cusp where a curve meets a cell side
 * tangentially) `sweep` collapses the reversed rail instead.
 */
const MITRE_CONVERGE_MAX = 64;

/** Fills tangents, lengths and mitres of a polygon from its points (mock-up `offset_point`). */
function polyOf(px0: readonly number[], py0: readonly number[]): Poly {
  const n0 = px0.length;
  const tx0: number[] = new Array<number>(n0);
  const ty0: number[] = new Array<number>(n0);
  const len0: number[] = new Array<number>(n0);
  for (let i = 0; i < n0; i++) {
    const j = i + 1 === n0 ? 0 : i + 1;
    const dx = px0[j]! - px0[i]!;
    const dy = py0[j]! - py0[i]!;
    const l = Math.hypot(dx, dy);
    len0[i] = l;
    tx0[i] = l > 0 ? dx / l : 0;
    ty0[i] = l > 0 ? dy / l : 0;
  }
  const P: Poly = { n: 0, px: [], py: [], mx: [], my: [], ix: [], iy: [], tx: [], ty: [], len: [], bev: [], src: [] };
  const push = (i: number, mx: number, my: number, ix: number, iy: number, tx: number, ty: number, len: number, bev: number): void => {
    P.px.push(px0[i]!);
    P.py.push(py0[i]!);
    P.mx.push(mx);
    P.my.push(my);
    P.ix.push(ix);
    P.iy.push(iy);
    P.tx.push(tx);
    P.ty.push(ty);
    P.len.push(len);
    P.bev.push(bev);
    P.src.push(i);
  };
  for (let i = 0; i < n0; i++) {
    const p = i === 0 ? n0 - 1 : i - 1;
    const n1x = ty0[p]!;
    const n1y = -tx0[p]!;
    const n2x = ty0[i]!;
    const n2y = -tx0[i]!;
    const k = 1 + n1x * n2x + n1y * n2y;
    if (k >= MITRE_K_MIN) {
      const mx = (n1x + n2x) / k;
      const my = (n1y + n2y) / k;
      push(i, mx, my, mx, my, tx0[i]!, ty0[i]!, len0[i]!, 0);
      continue;
    }
    // split: s = +1 at a convex tip (left turn), −1 at a concave notch
    const s = tx0[p]! * ty0[i]! - ty0[p]! * tx0[i]! > 0 ? 1 : -1;
    let bx = n1x + n2x;
    let by = n1y + n2y;
    const bl = Math.hypot(bx, by);
    if (bl > 1e-9) {
      bx /= bl;
      by /= bl;
    } else {
      // a full U-turn: the join faces along the way in (convex) or back along it (concave)
      bx = s * tx0[p]!;
      by = s * ty0[p]!;
    }
    const f = k > 0 ? Math.min(MITRE_CONVERGE_MAX, Math.sqrt(2 / k)) : MITRE_CONVERGE_MAX;
    const cx = bx * f;
    const cy = by * f;
    // the bevel join's outward normal is the bisector, so its direction is the bisector turned left
    if (s > 0) {
      push(i, n1x, n1y, cx, cy, -by, bx, 0, 1);
      push(i, n2x, n2y, cx, cy, tx0[i]!, ty0[i]!, len0[i]!, 0);
    } else {
      push(i, cx, cy, n1x, n1y, -by, bx, 0, -1);
      push(i, cx, cy, n2x, n2y, tx0[i]!, ty0[i]!, len0[i]!, 0);
    }
  }
  P.n = P.px.length;
  return P;
}

/**
 * Sweeps one profile edge (d0, h0) → (d1, h1) along segment i of a polygon: a quad between the
 * mitred offsets at both ends. Its normal lies in the (outward normal, up) plane: ∝ Δh·n − Δd·up –
 * list the profile so that this points out of the solid.
 */
function sweep(piece: Piece, P: Poly, i: number, d0: number, h0: number, d1: number, h1: number, uv: Uv): void {
  // a bevel join is a single point on its converging side: nothing to build there
  const bev = P.bev[i]!;
  if (bev !== 0 && d0 * bev <= 0 && d1 * bev <= 0) return;
  const j = i + 1 === P.n ? 0 : i + 1;
  const ax = P.px[i]!;
  const ay = P.py[i]!;
  const bx = P.px[j]!;
  const by = P.py[j]!;
  const a0x = d0 < 0 ? P.ix[i]! : P.mx[i]!;
  const a0y = d0 < 0 ? P.iy[i]! : P.my[i]!;
  const b0x = d0 < 0 ? P.ix[j]! : P.mx[j]!;
  const b0y = d0 < 0 ? P.iy[j]! : P.my[j]!;
  const a1x = d1 < 0 ? P.ix[i]! : P.mx[i]!;
  const a1y = d1 < 0 ? P.iy[i]! : P.my[i]!;
  const b1x = d1 < 0 ? P.ix[j]! : P.mx[j]!;
  const b1y = d1 < 0 ? P.iy[j]! : P.my[j]!;
  const dh = h1 - h0;
  const dd = d1 - d0;
  const inv = 1 / (Math.hypot(dh, dd) || 1);
  const tx = P.tx[i]!;
  const ty = P.ty[i]!;
  const nx = dh * ty * inv;
  const ny = -dh * tx * inv;
  const nh = -dd * inv;
  let x0 = ax + d0 * a0x;
  let y0 = ay + d0 * a0y;
  let x1 = bx + d0 * b0x;
  let y1 = by + d0 * b0y;
  let x2 = bx + d1 * b1x;
  let y2 = by + d1 * b1y;
  let x3 = ax + d1 * a1x;
  let y3 = ay + d1 * a1y;
  // an offset rail running backwards (a short curve chord next to a sharp corner, offset further than
  // the chord is long) would fold the quad over: collapse that rail to its middle
  if ((x1 - x0) * tx + (y1 - y0) * ty < 0) {
    x0 = x1 = (x0 + x1) / 2;
    y0 = y1 = (y0 + y1) / 2;
  }
  if ((x2 - x3) * tx + (y2 - y3) * ty < 0) {
    x2 = x3 = (x2 + x3) / 2;
    y2 = y3 = (y2 + y3) / 2;
  }
  piece.quad(x0, y0, h0, x1, y1, h0, x2, y2, h1, x3, y3, h1, nx, ny, nh, uv);
}

/**
 * End cap of a ribbon at vertex v of polygon P (the plane of its mitre): the rectangle d0…d1 × h0…h1,
 * facing away from segment `seg` (`atStart` = the segment starts at v).
 */
function cap(piece: Piece, P: Poly, v: number, seg: number, atStart: boolean, d0: number, d1: number, h0: number, h1: number, uv: Uv): void {
  const x = P.px[v]!;
  const y = P.py[v]!;
  const m0x = d0 < 0 ? P.ix[v]! : P.mx[v]!;
  const m0y = d0 < 0 ? P.iy[v]! : P.my[v]!;
  const m1x = d1 < 0 ? P.ix[v]! : P.mx[v]!;
  const m1y = d1 < 0 ? P.iy[v]! : P.my[v]!;
  // the cap's plan direction: the mitre (one vector), or from end to end at a split vertex
  const split = m0x !== m1x || m0y !== m1y;
  const qx = split ? d1 * m1x - d0 * m0x : m0x;
  const qy = split ? d1 * m1y - d0 * m0y : m0y;
  const l = Math.hypot(qx, qy) || 1;
  let nx = -qy / l;
  let ny = qx / l;
  const along = nx * P.tx[seg]! + ny * P.ty[seg]!;
  if ((atStart && along > 0) || (!atStart && along < 0)) {
    nx = -nx;
    ny = -ny;
  }
  piece.quad(
    x + d0 * m0x, y + d0 * m0y, h0,
    x + d1 * m1x, y + d1 * m1y, h0,
    x + d1 * m1x, y + d1 * m1y, h1,
    x + d0 * m0x, y + d0 * m0y, h1,
    nx, ny, 0, uv,
  );
}

// ---------------------------------------------------------------------------------------------------
// the build
// ---------------------------------------------------------------------------------------------------

/** Resolved swatch UVs of a style (missing keys fall back to the core swatch). */
interface Swatches {
  core: Uv;
  plate: Uv;
  stripe: Uv;
  glow: Uv | null;
  lip: Uv;
  seam: Uv;
  terraceSide: Uv;
  groove: Uv;
  soot: Uv;
  sootAlt: Uv;
  char: Uv;
  ember: Uv;
}

/** One profile edge: d0, h0, d1, h1 and the swatch. */
type Face = readonly [number, number, number, number, Uv];

/** Kinds that carry the side band / the lip (spec §3.2 step 3); shaped edges (E2) as raw ones. */
const banded = (k: EdgeKind): boolean => k === 'raw' || k === 'shaped' || k === 'muzzle';
const lipped = (k: EdgeKind): boolean => k === 'raw' || k === 'shaped';

/** How much a kind builds: the bevel join of a split vertex takes the richer of its two edges. */
const KIND_RANK: Record<EdgeKind, number> = { raw: 3, shaped: 3, muzzle: 2, torn: 1, nozzle: 0 };

/** Tolerance of "two run directions are the same" (unit vectors; outline.ts DIR_EPS). */
const DIR_EPS = 1e-9;

/** Inner edge of the band's top face on band-only (muzzle) runs: just inside the part models' margin. */
const MUZZLE_TOP_IN = -0.01;
/** Clan decorations (mock-up `_slashes`, `_welds`). */
const SLASH_MIN_LEN = 0.45;
const SLASH_W = 0.035;
const SLASH_SKEW = 0.05;
const WELD_STEP = 0.22;
const WELD_R = 0.022;
const WELD_IN = 0.035;
/** Torn edges: soot patches per unit of length (stable per edge, mock-up `_torn`). */
const SOOT_STEP = 0.25;

/**
 * The shell of one ship, one geometry per owner part id, in the **hull-local frame** (sim → world via
 * `simToWorld`, the hull group's origin = grid origin; ShipView parents each piece under its owner's
 * node, so it applies the inverse of that node's transform). Nothing is added in nozzle runs, only the
 * band in muzzle runs, only soot in torn runs, band and lip in raw and shaped runs (spec §3.2–3.7, §2.6
 * of SL2). ≤ SHELL_MAX_TRIANGLES per ship.
 * Deterministic: the same input gives the same geometries in the same (map) order. Unknown swatch keys
 * fall back to the core swatch; no core swatch (no table) → an empty map.
 * The caller owns (and disposes) the returned geometries.
 */
export function buildShell(input: ShellBuildInput): Map<number, BufferGeometry> {
  if (input.quality === 'low') return build(input, true);
  const full = build(input, false);
  if (shellTriangles(full) <= SHELL_MAX_TRIANGLES) return full;
  for (const g of full.values()) g.dispose();
  return build(input, true);
}

/**
 * One build. `lean` (Low, or a full build over the triangle budget – very ragged hulls): flush stripe
 * and glow line, no lip chamfers, no clan decorations.
 */
function build(input: ShellBuildInput, lean: boolean): Map<number, BufferGeometry> {
  const { outline, style, quality, mode } = input;
  const out = new Map<number, BufferGeometry>();
  if (outline.loops.length === 0) return out;
  const core = input.swatchUv(style.core);
  if (!core) return out;
  const sw = (key: string): Uv => input.swatchUv(key) ?? core;
  const S: Swatches = {
    core,
    plate: sw(style.plate),
    stripe: sw(style.stripe),
    glow: style.glow ? sw(style.glow) : null,
    lip: sw(style.lip),
    seam: sw(style.seam),
    terraceSide: sw(style.terraceSide),
    groove: sw(style.groove),
    soot: sw(style.soot),
    sootAlt: sw(style.sootAlt),
    char: sw(style.char),
    ember: sw(style.ember),
  };

  scratch.nv = 0;
  scratch.ni = 0;
  const pieces = new Map<number, Piece>();
  const piece = (owner: number): Piece => {
    let p = pieces.get(owner);
    if (!p) {
      p = new Piece(pieces.size);
      pieces.set(owner, p);
    }
    return p;
  };

  const showcase = quality === 'high' && mode !== 'flight';
  const bandFaces = bandProfile(S, lean);
  const lipFaces = lipProfile(S, !lean);
  const muzzleTop: Face = [BAND_OUT, BAND_PLATE_Z[1], MUZZLE_TOP_IN, BAND_PLATE_Z[1], S.plate];
  const flat = showcase && input.grid ? flatOwners(input.grid) : null;
  const deco = showcase && !lean ? style.deco : null;

  // --- outline loops: band, lip, caps, soot, grooves, clan decorations; corner guards ---------------------
  let ci = 0;
  for (const loop of outline.loops) {
    const runs = loop.runs;
    const nr = runs.length;
    const px: number[] = [];
    const py: number[] = [];
    const kinds: EdgeKind[] = [];
    const owners: number[] = [];
    for (let r = 0; r < nr; r++) {
      const run = runs[r]!;
      const prev = runs[r === 0 ? nr - 1 : r - 1]!;
      // axis unit vectors of the run and the previous one (bevels and guards sit on axis corners only)
      const dx = Math.sign(run.b.x - run.a.x);
      const dy = Math.sign(run.b.y - run.a.y);
      const qx = Math.sign(prev.b.x - prev.a.x);
      const qy = Math.sign(prev.b.y - prev.a.y);
      // a corner wherever the direction changes (outline.ts lists exactly those – shaped runs included)
      const ux = run.b.x - run.a.x;
      const uy = run.b.y - run.a.y;
      const vx = prev.b.x - prev.a.x;
      const vy = prev.b.y - prev.a.y;
      const lengths = Math.hypot(ux, uy) * Math.hypot(vx, vy);
      const turns = Math.abs(ux * vy - uy * vx) > DIR_EPS * lengths || ux * vx + uy * vy <= 0;
      const corner = turns ? outline.corners[ci++] : undefined;
      let owner = run.edges[0]!.owner;
      if (corner && corner.kind === 'bevel') {
        // the shaved armour corner (spec §3.3): the outline cuts across it, band and lip follow
        px.push(run.a.x - qx * BEVEL);
        py.push(run.a.y - qy * BEVEL);
        kinds.push('raw');
        owners.push(corner.owner);
        px.push(run.a.x + dx * BEVEL);
        py.push(run.a.y + dy * BEVEL);
      } else {
        px.push(run.a.x);
        py.push(run.a.y);
        if (corner && corner.kind === 'guard') guard(piece(corner.owner), run.a, qx, qy, dx, dy, S);
      }
      kinds.push(run.kind);
      owners.push(owner);
      for (let e = 1; e < run.edges.length; e++) {
        const edge = run.edges[e]!;
        if (edge.owner === owner) continue;
        owner = edge.owner;
        px.push(edge.a.x);
        py.push(edge.a.y);
        kinds.push(run.kind);
        owners.push(owner);
      }
    }

    const P = polyOf(px, py);
    const n = P.n;
    // kinds and owners per polygon segment (a bevel join takes the richer of its two edges)
    const segKind: EdgeKind[] = new Array<EdgeKind>(n);
    const segOwner: number[] = new Array<number>(n);
    const m = px.length;
    for (let i = 0; i < n; i++) {
      const v = P.src[i]!;
      if (P.bev[i] === 0) {
        segKind[i] = kinds[v]!;
        segOwner[i] = owners[v]!;
      } else {
        const w = v === 0 ? m - 1 : v - 1;
        const fromPrev = KIND_RANK[kinds[w]!] >= KIND_RANK[kinds[v]!];
        segKind[i] = fromPrev ? kinds[w]! : kinds[v]!;
        segOwner[i] = fromPrev ? owners[w]! : owners[v]!;
      }
    }
    for (let i = 0; i < n; i++) {
      const kind = segKind[i]!;
      if (kind === 'nozzle') continue;
      const pc = piece(segOwner[i]!);
      if (kind === 'torn') {
        if (P.bev[i] === 0) soot(pc, P, i, S);
        continue;
      }
      for (const f of bandFaces) sweep(pc, P, i, f[0], f[1], f[2], f[3], f[4]);
      const lip = lipped(kind);
      if (lip) for (const f of lipFaces) sweep(pc, P, i, f[0], f[1], f[2], f[3], f[4]);
      else sweep(pc, P, i, muzzleTop[0], muzzleTop[1], muzzleTop[2], muzzleTop[3], muzzleTop[4]);
      // free ends: the neighbour segment has no band / no lip
      const j = i + 1 === n ? 0 : i + 1;
      const prevKind = segKind[i === 0 ? n - 1 : i - 1]!;
      const nextKind = segKind[j]!;
      if (!banded(prevKind)) bandCap(pc, P, i, i, true, S);
      if (!banded(nextKind)) bandCap(pc, P, j, i, false, S);
      if (lip && !lipped(prevKind)) cap(pc, P, i, i, true, -LIP_W, BAND_OUT, LIP_Z[0], LIP_Z[1], S.lip);
      if (lip && !lipped(nextKind)) cap(pc, P, j, i, false, -LIP_W, BAND_OUT, LIP_Z[0], LIP_Z[1], S.lip);
      if (lip && flat?.has(segOwner[i]!)) {
        const h = DECK_TOP + 0.003;
        sweep(pc, P, i, -GROOVE_IN + GROOVE_W / 2, h, -GROOVE_IN - GROOVE_W / 2, h, S.groove);
      }
      if (lip && P.bev[i] === 0 && deco === 'slashes') slashes(pc, P, i, S.seam);
      else if (lip && P.bev[i] === 0 && deco === 'welds') welds(pc, P, i, S.seam);
    }
  }

  // --- seams (spec §3.4): one strip per seam run, owned by its lower part id ---------------------------
  const sw2 = style.seamW / 2;
  for (const s of outline.seams) {
    const pc = piece(s.owners[0]);
    if (s.a.x === s.b.x) {
      const h = SEAM_Z[1] + SEAM_CROSS_LIFT;
      pc.flat(s.a.x - sw2, s.a.y, s.a.x + sw2, s.a.y, s.b.x + sw2, s.b.y, s.b.x - sw2, s.b.y, h, S.seam);
    } else {
      const h = SEAM_Z[1];
      pc.flat(s.a.x, s.a.y - sw2, s.b.x, s.b.y - sw2, s.b.x, s.b.y + sw2, s.a.x, s.a.y + sw2, h, S.seam);
    }
  }

  // --- terraces (v2, plan 2026-10-20 §2.8): owned by the group's lowest part id ------------------------------
  const terraceGrooves = quality === 'high' || mode !== 'flight';
  for (const t of (input.terraces ?? hullTerraceEnabled()) ? outline.terraces : []) {
    if (t.cells.length >= TERRACE_MIN_CELLS) terrace(piece(t.owner), t.cells, S, terraceGrooves);
  }

  return toGeometries(pieces, input.layout);
}

/**
 * Outer profile of the side band (mock-up layers: core, stripe, glow, plate) as one polyline. `flush`:
 * stripe and glow line painted on the band face instead of standing out (lean builds).
 */
function bandProfile(S: Swatches, flush: boolean): Face[] {
  const bo = BAND_OUT;
  const so = STRIPE_OUT;
  if (flush) {
    const faces: Face[] = [
      [bo, BAND_CORE_Z[0], bo, STRIPE_Z[0], S.core],
      [bo, STRIPE_Z[0], bo, STRIPE_Z[1], S.stripe],
    ];
    if (S.glow) {
      faces.push(
        [bo, STRIPE_Z[1], bo, GLOW_Z[0], S.core],
        [bo, GLOW_Z[0], bo, GLOW_Z[1], S.glow],
        [bo, GLOW_Z[1], bo, BAND_PLATE_Z[0], S.core],
      );
    } else faces.push([bo, STRIPE_Z[1], bo, BAND_PLATE_Z[0], S.core]);
    faces.push([bo, BAND_PLATE_Z[0], bo, BAND_PLATE_Z[1], S.plate]);
    return faces;
  }
  const faces: Face[] = [
    [bo, BAND_CORE_Z[0], bo, STRIPE_Z[0], S.core],
    [bo, STRIPE_Z[0], so, STRIPE_Z[0], S.stripe],
    [so, STRIPE_Z[0], so, STRIPE_Z[1], S.stripe],
    [so, STRIPE_Z[1], bo, STRIPE_Z[1], S.stripe],
  ];
  if (S.glow) {
    const go = GLOW_OUT;
    faces.push(
      [bo, STRIPE_Z[1], bo, GLOW_Z[0], S.core],
      [bo, GLOW_Z[0], go, GLOW_Z[0], S.glow],
      [go, GLOW_Z[0], go, GLOW_Z[1], S.glow],
      [go, GLOW_Z[1], bo, GLOW_Z[1], S.glow],
      [bo, GLOW_Z[1], bo, BAND_PLATE_Z[0], S.core],
    );
  } else faces.push([bo, STRIPE_Z[1], bo, BAND_PLATE_Z[0], S.core]);
  faces.push([bo, BAND_PLATE_Z[0], bo, BAND_PLATE_Z[1], S.plate]);
  return faces;
}

/** Trim lip profile: outer face, top, inner face; chamfered top edges unless `chamfer` is false (lean). */
function lipProfile(S: Swatches, chamfer: boolean): Face[] {
  const bo = BAND_OUT;
  const [z0, z1] = LIP_Z;
  if (!chamfer) {
    return [
      [bo, z0, bo, z1, S.lip],
      [bo, z1, -LIP_W, z1, S.lip],
      [-LIP_W, z1, -LIP_W, z0, S.lip],
    ];
  }
  const c = LIP_CHAMFER;
  return [
    [bo, z0, bo, z1 - c, S.lip],
    [bo, z1 - c, bo - c, z1, S.lip],
    [bo - c, z1, -LIP_W + c, z1, S.lip],
    [-LIP_W + c, z1, -LIP_W, z1 - c, S.lip],
    [-LIP_W, z1 - c, -LIP_W, z0, S.lip],
  ];
}

/** End cap of the band (core and plate parts) at vertex v of segment `seg`. */
function bandCap(pc: Piece, P: Poly, v: number, seg: number, atStart: boolean, S: Swatches): void {
  cap(pc, P, v, seg, atStart, BAND_IN, BAND_OUT, BAND_CORE_Z[0], BAND_PLATE_Z[0], S.core);
  cap(pc, P, v, seg, atStart, BAND_IN, BAND_OUT, BAND_PLATE_Z[0], BAND_PLATE_Z[1], S.plate);
}

/**
 * Corner guard (spec §3.3): an L of two `GUARD_ARM` arms along the corner's edges, `GUARD_T` thick
 * inward from `GUARD_OUT`, core body with a stripe-coloured cap. (qx, qy) = direction of the edge
 * into the corner, (dx, dy) = out of it (axis unit vectors).
 */
function guard(pc: Piece, v: Vec2, qx: number, qy: number, dx: number, dy: number, S: Swatches): void {
  const n1x = qy;
  const n1y = -qx;
  const n2x = dy;
  const n2y = -dx;
  const ax = v.x - qx * GUARD_ARM;
  const ay = v.y - qy * GUARD_ARM;
  const bx = v.x + dx * GUARD_ARM;
  const by = v.y + dy * GUARD_ARM;
  const o = GUARD_OUT;
  const i = GUARD_OUT - GUARD_T;
  // outer and inner L polylines (a – corner – b); a convex axis corner's mitre is n1 + n2
  const oax = ax + n1x * o;
  const oay = ay + n1y * o;
  const ovx = v.x + (n1x + n2x) * o;
  const ovy = v.y + (n1y + n2y) * o;
  const obx = bx + n2x * o;
  const oby = by + n2y * o;
  const iax = ax + n1x * i;
  const iay = ay + n1y * i;
  const ivx = v.x + (n1x + n2x) * i;
  const ivy = v.y + (n1y + n2y) * i;
  const ibx = bx + n2x * i;
  const iby = by + n2y * i;
  const zc = GUARD_Z[1] - GUARD_CAP;
  for (const [h0, h1, uv, inner0] of [
    [GUARD_Z[0], zc, S.core, DECK_TOP],
    [zc, GUARD_Z[1], S.stripe, zc],
  ] as const) {
    pc.wall(oax, oay, ovx, ovy, h0, h1, n1x, n1y, uv);
    pc.wall(ovx, ovy, obx, oby, h0, h1, n2x, n2y, uv);
    // inner faces only show above the deck
    pc.wall(iax, iay, ivx, ivy, inner0, h1, -n1x, -n1y, uv);
    pc.wall(ivx, ivy, ibx, iby, inner0, h1, -n2x, -n2y, uv);
    pc.wall(oax, oay, iax, iay, h0, h1, -qx, -qy, uv);
    pc.wall(obx, oby, ibx, iby, h0, h1, dx, dy, uv);
  }
  pc.flat(oax, oay, ovx, ovy, ivx, ivy, iax, iay, GUARD_Z[1], S.stripe);
  pc.flat(ovx, ovy, obx, oby, ibx, iby, ivx, ivy, GUARD_Z[1], S.stripe);
}

/**
 * A torn edge (spec §3.7, mock-up `_torn`; readability pass 2026-10-16): per patch of `SOOT_STEP` a
 * ragged soot pentagon `SOOT_IN` deep (± a stable per-edge jitter) at `SOOT_Z` and a jagged ember rim
 * with one tooth at `EMBER_Z` over its outer part; the exposed side is charred with a hot top strip.
 */
function soot(pc: Piece, P: Poly, i: number, S: Swatches): void {
  const j = i + 1 === P.n ? 0 : i + 1;
  const ax = P.px[i]!;
  const ay = P.py[i]!;
  const tx = P.tx[i]!;
  const ty = P.ty[i]!;
  const nx = ty;
  const ny = -tx;
  const L = P.len[i]!;
  const k = Math.max(1, Math.round(L / SOOT_STEP));
  let h = Math.imul(Math.round(ax * 2), 73856093) ^ Math.imul(Math.round(ay * 2), 19349663) ^ Math.imul(Math.round(P.px[j]! * 2), 83492791) ^ Math.imul(Math.round(P.py[j]! * 2), 2654435761 | 0);
  const out = SOOT_SIDE_OUT;
  for (let s = 0; s < k; s++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    const r = (h & 1023) / 1023;
    // a second, independent jitter for the ember rim (higher bits of the same hash)
    const q = ((h >>> 10) & 1023) / 1023;
    const depth = SOOT_IN * (0.7 + 0.6 * r);
    const u0 = (s / k) * L;
    const u1 = ((s + 1) / k) * L;
    const um = u0 + (u1 - u0) * (0.3 + 0.4 * q);
    const z = SOOT_Z + 0.004 * r;
    const uv = r > 0.4 ? S.soot : S.sootAlt;
    // pentagon: two points on the edge, three ragged ones inside
    const x0 = ax + tx * u0 + nx * out;
    const y0 = ay + ty * u0 + ny * out;
    const x1 = ax + tx * u1 + nx * out;
    const y1 = ay + ty * u1 + ny * out;
    const x2 = ax + tx * u1 - nx * depth * 0.8;
    const y2 = ay + ty * u1 - ny * depth * 0.8;
    const x3 = ax + tx * um - nx * depth;
    const y3 = ay + ty * um - ny * depth;
    const x4 = ax + tx * u0 - nx * depth * 0.7;
    const y4 = ay + ty * u0 - ny * depth * 0.7;
    pc.flat(x0, y0, x1, y1, x2, y2, x4, y4, z, uv);
    pc.triUp(x4, y4, x2, y2, x3, y3, z, uv);
    // ember rim: a strip with a ragged inner side and one tooth
    const e0 = EMBER_IN * (0.6 + 0.4 * q);
    const e1 = EMBER_IN * (0.6 + 0.4 * r);
    const et = EMBER_TOOTH * (0.7 + 0.6 * q);
    const ex0 = ax + tx * u0 - nx * e0;
    const ey0 = ay + ty * u0 - ny * e0;
    const ex1 = ax + tx * u1 - nx * e1;
    const ey1 = ay + ty * u1 - ny * e1;
    pc.flat(x0, y0, x1, y1, ex1, ey1, ex0, ey0, EMBER_Z, S.ember);
    pc.triUp(ex0, ey0, ex1, ey1, ax + tx * um - nx * et, ay + ty * um - ny * et, EMBER_Z, S.ember);
  }
  const bx = P.px[j]!;
  const by = P.py[j]!;
  const sx0 = ax + nx * out;
  const sy0 = ay + ny * out;
  const sx1 = bx + nx * out;
  const sy1 = by + ny * out;
  pc.wall(sx0, sy0, sx1, sy1, SOOT_SIDE_Z[0], SOOT_SIDE_Z[1], nx, ny, S.char);
  pc.wall(sx0, sy0, sx1, sy1, SOOT_SIDE_Z[1], EMBER_Z, nx, ny, S.ember);
}

/** The Slanted Star: one raked gold bar across the lip in the middle of each longer segment. */
function slashes(pc: Piece, P: Poly, i: number, uv: Uv): void {
  const L = P.len[i]!;
  if (L < SLASH_MIN_LEN) return;
  const tx = P.tx[i]!;
  const ty = P.ty[i]!;
  const nx = ty;
  const ny = -tx;
  const cx = P.px[i]! + tx * L * 0.5;
  const cy = P.py[i]! + ty * L * 0.5;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [u, v] of [
    [-SLASH_W - SLASH_SKEW, BAND_OUT],
    [SLASH_W - SLASH_SKEW, BAND_OUT],
    [SLASH_W + SLASH_SKEW, -LIP_W],
    [-SLASH_W + SLASH_SKEW, -LIP_W],
  ] as const) {
    xs.push(cx + tx * u + nx * v);
    ys.push(cy + ty * u + ny * v);
  }
  pc.prism4(xs, ys, LIP_Z[1] - 0.004, LIP_Z[1] + 0.008, uv);
}

/** The Rust: weld beads along the lip. */
function welds(pc: Piece, P: Poly, i: number, uv: Uv): void {
  const L = P.len[i]!;
  const tx = P.tx[i]!;
  const ty = P.ty[i]!;
  const nx = ty;
  const ny = -tx;
  const k = Math.max(1, Math.floor(L / WELD_STEP));
  for (let s = 0; s < k; s++) {
    const u = ((s + 0.5) / k) * L;
    const cx = P.px[i]! + tx * u - nx * WELD_IN;
    const cy = P.py[i]! + ty * u - ny * WELD_IN;
    const r = WELD_R;
    pc.prism4([cx - r, cx + r, cx + r, cx - r], [cy - r, cy - r, cy + r, cy + r], LIP_Z[1] - 0.004, LIP_Z[1] + 0.012, uv);
  }
}

/** Owner ids of the flat parts of a grid (panel grooves). */
function flatOwners(grid: ShipGrid): Set<number> {
  const out = new Set<number>();
  for (const p of grid.parts) if (FLAT_PARTS.has(p.partId)) out.add(p.id);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// terrace v2 – the low inner spine (plan 2026-10-20 §2.8, art/README §3.2)
// ---------------------------------------------------------------------------------------------------

const DX = [1, 0, -1, 0] as const;
const DY = [0, 1, 0, -1] as const;

/**
 * Boundary loops of a set of cells (solid on the left: outer loops counter-clockwise, holes clockwise),
 * corner points only, in grid units. Same edge walk as outline.ts on full cell sides; at a pinch
 * vertex the left turn keeps every loop simple.
 */
export function cellSetLoops(cells: readonly Vec2[]): { x: number[]; y: number[] }[] {
  const OFF = 2048;
  const key = (x: number, y: number): number => (x + OFF) * 8192 + (y + OFF);
  const set = new Set<number>();
  for (const c of cells) set.add(key(c.x, c.y));
  const ex: number[] = [];
  const ey: number[] = [];
  const ed: number[] = [];
  const byStart = new Map<number, number[]>();
  for (const c of cells) {
    for (let d = 0; d < 4; d++) {
      const nx = DY[d];
      const ny = -DX[d];
      if (set.has(key(c.x + nx, c.y + ny))) continue;
      const sx = 2 * c.x + nx - DX[d];
      const sy = 2 * c.y + ny - DY[d];
      const k = key(sx, sy);
      const list = byStart.get(k);
      if (list) list.push(ex.length);
      else byStart.set(k, [ex.length]);
      ex.push(sx);
      ey.push(sy);
      ed.push(d);
    }
  }
  const used = new Uint8Array(ex.length);
  const loops: { x: number[]; y: number[] }[] = [];
  for (let e0 = 0; e0 < ex.length; e0++) {
    if (used[e0]) continue;
    const chain: number[] = [];
    let cur = e0;
    while (cur >= 0 && !used[cur]) {
      used[cur] = 1;
      chain.push(cur);
      const d = ed[cur]!;
      const next = byStart.get(key(ex[cur]! + 2 * DX[d]!, ey[cur]! + 2 * DY[d]!)) ?? [];
      let pick = -1;
      for (const c of next) {
        if (used[c]) continue;
        if (pick < 0 || ed[c] === (d + 1) % 4) pick = c;
      }
      cur = pick;
    }
    const x: number[] = [];
    const y: number[] = [];
    const m = chain.length;
    for (let q = 0; q < m; q++) {
      const e = chain[q]!;
      const p = chain[q === 0 ? m - 1 : q - 1]!;
      if (ed[p] === ed[e]) continue;
      x.push(ex[e]! / 2);
      y.push(ey[e]! / 2);
    }
    if (x.length >= 3) loops.push({ x, y });
  }
  return loops;
}

const signedArea = (x: readonly number[], y: readonly number[]): number => {
  let a = 0;
  for (let i = 0, n = x.length; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    a += x[i]! * y[j]! - x[j]! * y[i]!;
  }
  return a / 2;
};

/** Inset of the flat top inside the accent line (from the group's edge): the grooves stop here. */
const TERRACE_TOP_IN = TERRACE_INSET + TERRACE_SLOPE + TERRACE_LINE_W;
/** Height of the chevron prism (the shaped plates' `CHEVRON_Z` thickness). */
const TERRACE_CHEVRON_H = CHEVRON_Z[1] - CHEVRON_Z[0];

/**
 * Terrace v2 over a group of inner full armour cells (outline.ts): a low slab – base at `TERRACE_BASE_Z`
 * `TERRACE_INSET` in from the group's edge, ≈ 45° sides up to `TERRACE_TOP_Z` another `TERRACE_SLOPE`
 * in – in the matte terrace swatch, the tier-accent line along the top edge, per-cell panel grooves
 * continuing the cell grid (`grooves`) and one tier chevron on the bow-most cell, pointing to the bow.
 */
function terrace(pc: Piece, cells: readonly Vec2[], S: Swatches, grooves: boolean): void {
  const top = TERRACE_TOP_Z;
  const dBase = -TERRACE_INSET;
  const dTop = -(TERRACE_INSET + TERRACE_SLOPE);
  const dLine = dTop - TERRACE_LINE_W;
  const outers: Vector2[][] = [];
  const holes: Vector2[][] = [];
  for (const loop of cellSetLoops(cells)) {
    const P = polyOf(loop.x, loop.y);
    for (let i = 0; i < P.n; i++) {
      sweep(pc, P, i, dBase, TERRACE_BASE_Z, dTop, top, S.terraceSide);
      sweep(pc, P, i, dTop, top, dLine, top, S.stripe);
    }
    const ring: Vector2[] = [];
    for (let i = 0; i < P.n; i++) ring.push(new Vector2(P.px[i]! + dLine * P.ix[i]!, P.py[i]! + dLine * P.iy[i]!));
    (signedArea(loop.x, loop.y) > 0 ? outers : holes).push(ring);
  }
  for (const contour of outers) {
    const hs = outers.length === 1 ? holes : [];
    const all = contour.concat(...hs);
    for (const [a, b, c] of ShapeUtils.triangulateShape(contour, hs)) {
      const pa = all[a!]!;
      const pb = all[b!]!;
      const pq = all[c!]!;
      pc.triUp(pa.x, pa.y, pb.x, pb.y, pq.x, pq.y, top, S.terraceSide);
    }
  }

  const has = new Set<string>();
  for (const c of cells) has.add(`${c.x},${c.y}`);
  const inGroup = (x: number, y: number): boolean => has.has(`${x},${y}`);

  // per-cell grooves: one strip along every cell side inside the group, stopping at the accent line
  // where the side ends on the group's edge (it runs on where the next side inside the group continues it)
  if (grooves) {
    const h = top + TERRACE_GROOVE_LIFT;
    const w = TERRACE_GROOVE_W / 2;
    for (const c of cells) {
      // +x neighbour: the side x = c.x + ½ along y; +y neighbour: the side y = c.y + ½ along x
      for (const [ax, ay] of [[1, 0], [0, 1]] as const) {
        if (!inGroup(c.x + ax, c.y + ay)) continue;
        const tx = ay;
        const ty = ax; // along the side
        const runsOn = (s: 1 | -1): boolean => inGroup(c.x + s * tx, c.y + s * ty) && inGroup(c.x + ax + s * tx, c.y + ay + s * ty);
        const u0 = runsOn(-1) ? -0.5 : -0.5 + TERRACE_TOP_IN;
        const u1 = runsOn(1) ? 0.5 : 0.5 - TERRACE_TOP_IN;
        const mx = c.x + ax / 2;
        const my = c.y + ay / 2;
        pc.flat(
          mx + tx * u0 - ax * w, my + ty * u0 - ay * w,
          mx + tx * u1 - ax * w, my + ty * u1 - ay * w,
          mx + tx * u1 + ax * w, my + ty * u1 + ay * w,
          mx + tx * u0 + ax * w, my + ty * u0 + ay * w,
          h, S.groove,
        );
      }
    }
  }

  // one tier chevron on the bow-most cell (ties: nearest the group's middle row, then starboard)
  let meanY = 0;
  for (const c of cells) meanY += c.y;
  meanY /= cells.length;
  let bow = cells[0]!;
  for (const c of cells) {
    if (c.x > bow.x || (c.x === bow.x && Math.abs(c.y - meanY) < Math.abs(bow.y - meanY) - 1e-9)) bow = c;
  }
  terraceChevron(pc, bow.x - CHEVRON_MID.x, bow.y - CHEVRON_MID.y, top, S.stripe);
}

/** The armor.py chevron prism (pointing to +x = the bow) centred on (cx, cy), on top of a terrace at `h`. */
function terraceChevron(pc: Piece, cx: number, cy: number, h: number, uv: Uv): void {
  const R = CHEVRON_OUTLINE;
  const n = R.length;
  const h1 = h + TERRACE_CHEVRON_H;
  for (let i = 0; i < n; i++) {
    const a = R[i]!;
    const b = R[(i + 1) % n]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    // counter-clockwise outline: the outward normal is the direction turned clockwise
    pc.wall(cx + a.x, cy + a.y, cx + b.x, cy + b.y, h, h1, (b.y - a.y) / l, -(b.x - a.x) / l, uv);
  }
  // the top as its two convex arms (outline order: tail port, notch, tail starboard, …, tip, …)
  for (const [i, j, k, m] of [[0, 5, 4, 1], [1, 4, 3, 2]] as const) {
    pc.flat(cx + R[i]!.x, cy + R[i]!.y, cx + R[j]!.x, cy + R[j]!.y, cx + R[k]!.x, cy + R[k]!.y, cx + R[m]!.x, cy + R[m]!.y, h1, uv);
  }
}

// ---------------------------------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------------------------------

/**
 * The scratch sorted out per owner, in the layout of the part meshes (missing attributes filled with
 * neutral values). All pieces share one buffer per attribute (and one index buffer); each geometry's
 * attributes are views of its own range – a handful of allocations per ship instead of four per part.
 */
function toGeometries(pieces: ReadonlyMap<number, Piece>, layout: ShellLayout): Map<number, BufferGeometry> {
  const out = new Map<number, BufferGeometry>();
  const list = [...pieces.values()];
  const n = list.length;
  const vOff = new Uint32Array(n + 1);
  const iOff = new Uint32Array(n + 1);
  let wide = false;
  for (let k = 0; k < n; k++) {
    vOff[k + 1] = vOff[k]! + list[k]!.count;
    iOff[k + 1] = iOff[k]! + list[k]!.indices;
    if (list[k]!.count > 65535) wide = true;
  }
  const total = vOff[n]!;
  if (total === 0) return out;
  // local vertex number of every scratch vertex within its piece
  const cursor = new Uint32Array(n);
  const { v, slot, tri, local } = scratch;
  const nv = scratch.nv;
  for (let g = 0; g < nv; g++) local[g] = cursor[slot[g]!]!++;

  const attrs = layout.attributes.some((a) => a.name === 'position')
    ? layout.attributes
    : [...layout.attributes, { name: 'position', itemSize: 3 }];
  let pos: Float32Array | null = null;
  let nrm: Float32Array | null = null;
  const uvs: Float32Array[] = [];
  const arrays = attrs.map(({ name, itemSize }) => {
    const arr = new Float32Array(total * itemSize);
    if (name === 'position' && itemSize === 3) pos = arr;
    else if (name === 'normal' && itemSize === 3) nrm = arr;
    else if ((name === 'uv' || /^uv\d$/.test(name)) && itemSize === 2) uvs.push(arr);
    else if (name === 'color') arr.fill(1);
    else if (name === 'tangent' && itemSize === 4) for (let i = 0; i < total; i++) (arr[i * 4] = 1), (arr[i * 4 + 3] = 1);
    else if (name === 'normal') for (let i = 0; i < total; i++) arr[i * itemSize + 1] = 1;
    return arr;
  });
  const P = pos as Float32Array | null;
  const N = nrm as Float32Array | null;
  const U = uvs[0] ?? null;
  for (let g = 0; g < nv; g++) {
    const d = vOff[slot[g]!]! + local[g]!;
    const s = g * 8;
    if (P) {
      P[d * 3] = v[s]!;
      P[d * 3 + 1] = v[s + 1]!;
      P[d * 3 + 2] = v[s + 2]!;
    }
    if (N) {
      N[d * 3] = v[s + 3]!;
      N[d * 3 + 1] = v[s + 4]!;
      N[d * 3 + 2] = v[s + 5]!;
    }
    if (U) {
      U[d * 2] = v[s + 6]!;
      U[d * 2 + 1] = v[s + 7]!;
    }
  }
  for (let k = 1; k < uvs.length; k++) uvs[k]!.set(U!);
  const index = wide ? new Uint32Array(iOff[n]!) : new Uint16Array(iOff[n]!);
  const iCur = iOff.slice(0, n);
  for (let k = 0, ni = scratch.ni; k < ni; k++) {
    const g = tri[k]!;
    index[iCur[slot[g]!]!++] = local[g]!;
  }

  let k = 0;
  for (const [owner, p] of pieces) {
    if (p.count > 0) {
      const geometry = new BufferGeometry();
      for (let a = 0; a < attrs.length; a++) {
        const size = attrs[a]!.itemSize;
        geometry.setAttribute(attrs[a]!.name, new BufferAttribute(arrays[a]!.subarray(vOff[k]! * size, vOff[k + 1]! * size), size));
      }
      geometry.setIndex(new BufferAttribute(index.subarray(iOff[k]!, iOff[k + 1]!), 1));
      out.set(owner, geometry);
    }
    k++;
  }
  return out;
}

/** Total triangles of a built shell (budget checks, the perf dev hook). */
export function shellTriangles(shell: ReadonlyMap<number, BufferGeometry>): number {
  let t = 0;
  for (const g of shell.values()) t += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  return t;
}
