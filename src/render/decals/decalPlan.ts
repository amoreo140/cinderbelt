// Damage decals on ship parts (art batch B7, public/assets/vfx/README.md "Damage decals"): which
// decals a part shows at which damage level. Pure and deterministic – the same part at the same
// level always gets the same decals (no flicker on a rebuild, no Math.random).
import { createRng } from '../../sim/math/rng';
import { hash3 } from '../../sim/world/hash';

/** Atlas `damage_decals.png`: 4 × 4 cells. */
export const DECAL_GRID = 4;
/** Atlas rows (top → bottom). */
export const DECAL_ROW = { scorch: 0, torn: 1, holes: 2, streak: 3 } as const;
export type DecalRow = (typeof DECAL_ROW)[keyof typeof DECAL_ROW];
/** Column 3 = the "fresh" version of column 0 (hot rim) – cross-faded to column 0 as it cools. */
export const FRESH_COL = 3;

/** HP share below which a part shows its first scorch, and the heavier damage (README thresholds). */
export const DAMAGE_LIGHT = 0.7;
export const DAMAGE_HEAVY = 0.4;

/** 0 = clean, 1 = scorched (< 70 %), 2 = torn / holed (< 40 %), 3 = a wreck (always 2–3 per part). */
export type DamageLevel = 0 | 1 | 2 | 3;
export const WRECK_LEVEL: DamageLevel = 3;

/** Most decals one part can carry (big parts get one more per two extra cells). */
export const MAX_DECALS_PER_PART = 4;

/** Damage level of a part with `fraction` of its HP left. */
export function damageLevel(fraction: number): DamageLevel {
  if (!(fraction < DAMAGE_LIGHT)) return 0;
  return fraction < DAMAGE_HEAVY ? 2 : 1;
}

export interface DecalSpec {
  row: DecalRow;
  /** 0 large, 1 small, 2 variant (never the fresh column – that is an overlay). */
  col: 0 | 1 | 2;
  /** Offset from the part centre on the gameplay plane (sim frame, cells = units). */
  x: number;
  y: number;
  /** Rotation around the surface normal (rad). */
  rot: number;
  /** Quad size in units (0.4–0.9 of a cell, README). */
  size: number;
}

const ROWS_BY_LEVEL: Readonly<Record<Exclude<DamageLevel, 0>, readonly DecalRow[]>> = {
  1: [DECAL_ROW.scorch],
  2: [DECAL_ROW.scorch, DECAL_ROW.torn, DECAL_ROW.holes, DECAL_ROW.streak],
  3: [DECAL_ROW.scorch, DECAL_ROW.torn, DECAL_ROW.holes, DECAL_ROW.streak],
};

/** How many decals a part of `cells` cells gets at a level. */
export function decalCount(level: DamageLevel, cells: number, pick: number): number {
  if (level === 0) return 0;
  const extra = Math.floor(Math.max(0, cells - 1) / 2);
  const base = level === 1 ? 1 : level === 2 ? 2 + (pick < 0.35 ? 1 : 0) : 2 + (pick < 0.5 ? 1 : 0);
  return Math.min(MAX_DECALS_PER_PART, base + extra);
}

/**
 * The decals of a part at a damage level. `footprint` = its rotated size in cells. The first decal
 * of a damaged part is always a scorch blotch; a level-1 part keeps exactly the decals it had, a
 * heavier level adds to them (the list of a lower level is a prefix of the higher one).
 */
export function decalSpecs(seed: number, partId: number, level: DamageLevel, footprint: { w: number; h: number }): DecalSpec[] {
  if (level === 0) return [];
  const rng = createRng(hash3(seed >>> 0, partId, 0xdeca1));
  const cells = footprint.w * footprint.h;
  const pick = rng();
  // the count grows with the level; draw the heaviest list and cut it, so levels share a prefix
  const count = decalCount(level, cells, pick);
  const rows = ROWS_BY_LEVEL[level === 1 ? 2 : level];
  const out: DecalSpec[] = [];
  const maxCount = decalCount(WRECK_LEVEL, cells, pick);
  for (let i = 0; i < Math.max(count, maxCount); i++) {
    const r = rng();
    const row: DecalRow = i === 0 ? DECAL_ROW.scorch : rows[1 + Math.floor(r * (rows.length - 1))]!;
    const col = (rng() < 0.5 ? 0 : rng() < 0.5 ? 1 : 2) as 0 | 1 | 2;
    const hx = Math.max(0, footprint.w / 2 - 0.3);
    const hy = Math.max(0, footprint.h / 2 - 0.3);
    const x = (rng() * 2 - 1) * hx;
    const y = (rng() * 2 - 1) * hy;
    // burn streaks trail aft (no hit direction is known) – the rest any way round
    const turn = rng();
    const rot = row === DECAL_ROW.streak ? Math.PI + (turn - 0.5) * 0.7 : turn * Math.PI * 2;
    const size = (col === 1 ? 0.4 : 0.55) + rng() * (col === 1 ? 0.25 : 0.35);
    if (i < count) out.push({ row, col, x, y, rot, size });
  }
  return out;
}
