// Pure math of the combat HUD (M3b): ship silhouette layout, cell state by HP, placement of the
// hit indicators at the screen edge, the bearing to the attacker and the warning mode.
import type { CombatHudView, Silhouette } from '../game/combatView';
import type { PartId, Tier } from '../data/parts';
import { tx } from '../i18n';

/** Silhouette cell state: ≥ 60 % ok, ≥ 30 % warning, > 0 critical, otherwise a destroyed part. */
export type HpLevel = 'ok' | 'warn' | 'crit' | 'lost';

export function hpLevel(fraction: number): HpLevel {
  if (fraction <= 0) return 'lost';
  if (fraction < 0.3) return 'crit';
  if (fraction < 0.6) return 'warn';
  return 'ok';
}

export interface LayoutCell {
  /** Top-left corner in px (bow up, port side on the left – as in the hangar). */
  x: number;
  y: number;
  part: number;
  fraction: number;
  level: HpLevel;
  /** Lost against the blueprint (M3.8): an empty outlined cell. */
  missing: boolean;
}

/** Rectangle around the cells of one part – carries the tier brackets. */
export interface LayoutPart {
  part: number;
  partId: PartId;
  tier: Tier;
  x: number;
  y: number;
  w: number;
  h: number;
  fraction: number;
  level: HpLevel;
  cockpit: boolean;
  missing: boolean;
}

export interface SilhouetteLayout {
  /** Cell size in px. */
  cell: number;
  gap: number;
  width: number;
  height: number;
  cells: LayoutCell[];
  parts: LayoutPart[];
}

const MIN_CELL = 3;

/**
 * Lays the silhouette out in a box: bow (+x) up, port side (+y) on the left. Cells shrink so the
 * ship fits (at least 3 px).
 */
export function silhouetteLayout(
  s: Silhouette,
  box: { width: number; height: number },
  opts: { maxCell: number; gap: number },
): SilhouetteLayout {
  const { gap } = opts;
  if (s.cells.length === 0) return { cell: opts.maxCell, gap, width: 0, height: 0, cells: [], parts: [] };
  const cols = s.maxY - s.minY + 1;
  const rows = s.maxX - s.minX + 1;
  const fit = Math.min(opts.maxCell, (box.width - gap * (cols - 1)) / cols, (box.height - gap * (rows - 1)) / rows);
  const cell = Math.max(MIN_CELL, Math.floor(fit));
  const step = cell + gap;
  const cells: LayoutCell[] = [];
  const boxes = new Map<number, LayoutPart>();
  for (const c of s.cells) {
    const x = (s.maxY - c.y) * step;
    const y = (s.maxX - c.x) * step;
    const level = hpLevel(c.fraction);
    const missing = c.missing === true;
    cells.push({ x, y, part: c.part, fraction: c.fraction, level, missing });
    const b = boxes.get(c.part);
    if (!b) {
      boxes.set(c.part, { part: c.part, partId: c.partId, tier: c.tier, x, y, w: cell, h: cell, fraction: c.fraction, level, cockpit: c.partId === 'cockpit', missing });
    } else {
      const right = Math.max(b.x + b.w, x + cell);
      const bottom = Math.max(b.y + b.h, y + cell);
      b.x = Math.min(b.x, x);
      b.y = Math.min(b.y, y);
      b.w = right - b.x;
      b.h = bottom - b.y;
    }
  }
  return { cell, gap, width: cols * cell + (cols - 1) * gap, height: rows * cell + (rows - 1) * gap, cells, parts: [...boxes.values()] };
}

/** px with at most two decimals (no "-0"). */
const px = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

/**
 * The hull outline (`Silhouette.outline`: grid units, +x bow, +y port, one `M … Z` subpath per loop)
 * in the px of `silhouetteLayout` (SL2 E1 T10): bow up, port side on the left, the same cell step.
 * A cell boundary maps to the middle of the gap, so the outer edge runs gap / 2 outside the cells
 * (the SVG has `overflow: visible`). Fill it with `fill-rule: evenodd` (holes). No outline → ''.
 */
export function silhouetteOutlinePath(outline: string | undefined, s: Pick<Silhouette, 'maxX' | 'maxY'>, layout: Pick<SilhouetteLayout, 'cell' | 'gap'>): string {
  if (!outline) return '';
  const step = layout.cell + layout.gap;
  const half = layout.cell / 2;
  const tokens = outline.match(/[MLZ]|-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? [];
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === 'Z') {
      out += 'Z';
      continue;
    }
    if (t !== 'M' && t !== 'L') continue;
    const gx = Number(tokens[i + 1]);
    const gy = Number(tokens[i + 2]);
    i += 2;
    if (t === 'M' && out) out += ' ';
    out += `${t}${px((s.maxY - gy) * step + half)} ${px((s.maxX - gx) * step + half)}`;
  }
  return out;
}

/** The ship's class tier for the hull lip: the cockpit's tier (T1 without a cockpit). */
export function silhouetteTier(s: Pick<Silhouette, 'cells'>): Tier {
  return s.cells.find((c) => c.partId === 'cockpit')?.tier ?? 1;
}

/**
 * Ship status line under the silhouette (M3.8): what is missing against the design and what is
 * damaged – "1 part lost · 2 damaged" – with the lamp (missing parts or a hull under 30 % = bad).
 */
export function shipStatusLine(s: Pick<Silhouette, 'damaged' | 'missing'>, hullFraction: number): { text: string; lamp: 'ok' | 'warn' | 'bad' } {
  const missing = s.missing ?? 0;
  if (missing === 0 && s.damaged === 0) return { text: tx().flight.status.intact, lamp: 'ok' };
  const lamp = missing > 0 || hullFraction < 0.3 ? 'bad' : 'warn';
  if (missing === 0) return { text: tx().combat.damaged(s.damaged), lamp };
  const text = s.damaged > 0 ? `${tx().flight.status.missing(missing)} · ${tx().flight.status.damagedShort(s.damaged)}` : tx().flight.status.missing(missing);
  return { text, lamp };
}

/** On-screen angle to the attacker: the camera has north up and screen y goes down. */
export const screenBearing = (worldAngle: number): number => -worldAngle;

/**
 * Hit indicator on an ellipse inscribed in the screen (`inset` away from the edge) in the true
 * direction of the attacker. `rotation` = outward direction (rad, screen space).
 */
export function hitMarker(worldAngle: number, view: { width: number; height: number }, inset: number): { x: number; y: number; rotation: number } {
  const a = screenBearing(worldAngle);
  const rx = Math.max(1, view.width / 2 - inset);
  const ry = Math.max(1, view.height / 2 - inset);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const t = 1 / Math.sqrt((cos / rx) ** 2 + (sin / ry) ** 2);
  return { x: view.width / 2 + cos * t, y: view.height / 2 + sin * t, rotation: a };
}

/** Cannon pips: lit = loaded. The row is capped at `max`. */
export function cannonPips(c: CombatHudView['cannons'], max = 8): boolean[] {
  const n = Math.min(c.total, max);
  return Array.from({ length: n }, (_, i) => i < Math.min(c.ready, n));
}

/** Warning: the full band right after `enemyAlert`, then the compact one while anyone is attacking. */
export function threatMode(threat: CombatHudView['threat'], now: number, alertUntil: number): 'alert' | 'compact' | null {
  if (now < alertUntil) return 'alert';
  if (threat.attacking > 0) return 'compact';
  return null;
}
