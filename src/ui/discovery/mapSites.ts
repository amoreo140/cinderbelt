// M4b world sites on the map (plan T10), Places layer: known derelict stations with their relays' power,
// ship graveyards, and known comets – the pass track (dashed while the comet is away, solid while it
// passes, an arrowhead in the flight direction), the nucleus with its tail away from home, and its name;
// hovering or clicking a track adds "Closest flyby near you: N min". MapView adds the names through
// the label layout (mapLabels.ts) and keeps other labels off the glyphs (obstacles).
import { GRAVEYARD } from '../../data/sites';
import type { MapSite } from '../../game/sites/siteMapView';
import type { CometMapData } from '../../game/sites/types';
import { tx } from '../../i18n';
import type { Vec2 } from '../../sim/math/vec2';
import { drawComet, drawDerelict, drawGraveyard, drawRelayMast, SITE_COLORS, withAlpha } from '../canvasDraw';
import { distToPolyline } from '../map';
import { LABEL_PRIORITY, type LabelObstacle, type LabelSide } from '../mapLabels';
import { FONTS, PALETTE } from '../theme/tokens';

/** World → canvas of the map being drawn. */
export interface MapProjection {
  toX(x: number): number;
  toY(y: number): number;
  /** Canvas px per world unit. */
  scale: number;
  onScreen(x: number, y: number, margin: number): boolean;
}

/** The label request MapView lays out (its `MapLabel` without the measured size). */
export interface SiteLabel {
  id: string;
  priority: number;
  anchor: { x: number; y: number };
  gap: number;
  keep?: boolean;
  sides?: readonly LabelSide[];
  text: string;
  font: string;
  size: number;
  color: string;
  sub?: { text: string; font: string; size: number; color: string };
}

/** Glyph radius of a site on the map (px). */
const GLYPH = 6;
/** Relays are drawn at their real places once they stand this far (px) from the derelict, else as pips. */
const RELAY_SPREAD_PX = 18;
/** A comet track is "under the cursor" within this many px. */
export const COMET_HIT_PX = 9;

const box = (id: string, x: number, y: number, r: number): LabelObstacle => ({ id, x: x - r, y: y - r, w: r * 2, h: r * 2 });

/** The line under a comet's name: the next pass near the player, now, or not soon. */
export function nextPassText(min: number | null): string {
  const m = tx().world.map;
  if (min === null) return m.passFar;
  return min <= 0 ? m.passNow : m.nextPass(String(min));
}

/** Tail direction of a comet glyph at a world point, in canvas radians (away from home; canvas y is down). */
export const tailAngle = (pos: Vec2): number => Math.atan2(-pos.y, pos.x);

/** Derelicts (with relay power) and graveyards (with their field once it is big enough to see). */
export function drawMapSites(ctx: CanvasRenderingContext2D, sites: readonly MapSite[], p: MapProjection, label: (l: SiteLabel) => void, obstacles: LabelObstacle[]): void {
  for (const site of sites) {
    const x = p.toX(site.pos.x);
    const y = p.toY(site.pos.y);
    if (!p.onScreen(x, y, 40)) continue;
    const id = `site:${site.id}`;
    if (site.kind === 'graveyard') {
      const field = GRAVEYARD.radius * p.scale;
      if (field > GLYPH * 2.5) {
        ctx.save();
        ctx.setLineDash([4, 5]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = withAlpha(SITE_COLORS.graveyard, 0.4);
        ctx.fillStyle = withAlpha(SITE_COLORS.graveyard, 0.05);
        ctx.beginPath();
        ctx.arc(x, y, field, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      drawGraveyard(ctx, x, y, GLYPH, SITE_COLORS.graveyard);
    } else {
      const relays = site.relays ?? [];
      const spread = relays.reduce((m, r) => Math.max(m, Math.hypot(p.toX(r.pos.x) - x, p.toY(r.pos.y) - y)), 0);
      if (relays.length > 0 && spread >= RELAY_SPREAD_PX) {
        // zoomed in: the masts at their places, a faint line to each
        ctx.save();
        ctx.setLineDash([2, 4]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = withAlpha(SITE_COLORS.derelict, 0.35);
        ctx.beginPath();
        for (const r of relays) {
          ctx.moveTo(x, y);
          ctx.lineTo(p.toX(r.pos.x), p.toY(r.pos.y));
        }
        ctx.stroke();
        ctx.restore();
        drawDerelict(ctx, x, y, GLYPH, SITE_COLORS.derelict);
        relays.forEach((r, i) => {
          const rx = p.toX(r.pos.x);
          const ry = p.toY(r.pos.y);
          drawRelayMast(ctx, rx, ry, 4.5, r.lit);
          obstacles.push(box(`${id}:r${i}`, rx, ry, 6));
        });
      } else {
        drawDerelict(ctx, x, y, GLYPH, SITE_COLORS.derelict, { lit: site.relaysLit ?? 0, total: relays.length || 3 });
      }
    }
    obstacles.push(box(id, x, y, GLYPH + 5));
    label({
      id,
      priority: LABEL_PRIORITY.poi,
      anchor: { x, y },
      gap: GLYPH + 6,
      text: site.label,
      font: `600 11px ${FONTS.display}`,
      size: 11,
      color: site.kind === 'graveyard' ? SITE_COLORS.graveyard : PALETTE.hull,
    });
  }
}

/** Known comets: track, direction, nucleus and name (with the next pass when focused). */
export function drawMapComets(
  ctx: CanvasRenderingContext2D,
  comets: readonly CometMapData[],
  p: MapProjection,
  focus: string | null,
  label: (l: SiteLabel) => void,
  obstacles: LabelObstacle[],
): void {
  for (const c of comets) {
    if (!c.known || c.arc.length < 2) continue;
    const pts = c.arc.map((w) => ({ x: p.toX(w.x), y: p.toY(w.y) }));
    if (!pts.some((q) => p.onScreen(q.x, q.y, 20))) continue;
    const passing = c.now !== null;
    const focused = focus === c.id;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.setLineDash(passing ? [] : [6, 5]);
    ctx.lineWidth = focused ? 2.2 : 1.5;
    ctx.strokeStyle = withAlpha(SITE_COLORS.comet, focused ? 0.95 : passing ? 0.75 : 0.5);
    ctx.beginPath();
    pts.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
    ctx.stroke();
    // the arrowhead at the end of the pass: which way the comet flies
    const end = pts[pts.length - 1]!;
    const prev = pts[Math.max(0, pts.length - 4)]!;
    const a = Math.atan2(end.y - prev.y, end.x - prev.x);
    ctx.setLineDash([]);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(end.x - Math.cos(a - 0.5) * 7, end.y - Math.sin(a - 0.5) * 7);
    ctx.lineTo(end.x, end.y);
    ctx.lineTo(end.x - Math.cos(a + 0.5) * 7, end.y - Math.sin(a + 0.5) * 7);
    ctx.stroke();
    ctx.restore();
    const id = `comet:${c.id}`;
    let anchor = pts[Math.floor(pts.length / 2)]!;
    if (c.now) {
      anchor = { x: p.toX(c.now.x), y: p.toY(c.now.y) };
      drawComet(ctx, anchor.x, anchor.y, 7, tailAngle(c.now), SITE_COLORS.comet);
      obstacles.push(box(id, anchor.x, anchor.y, 9));
    }
    label({
      id,
      priority: focused ? LABEL_PRIORITY.hover : LABEL_PRIORITY.poi,
      ...(focused ? { keep: true } : {}),
      anchor,
      gap: c.now ? 12 : 7,
      text: c.name,
      font: `650 11px ${FONTS.display}`,
      size: 11,
      color: SITE_COLORS.comet,
      ...(focused ? { sub: { text: nextPassText(c.nextPassMin), font: `600 11px ${FONTS.text}`, size: 11, color: PALETTE.text } } : {}),
    });
  }
}

/**
 * The known comet whose track or nucleus lies within `COMET_HIT_PX` of the canvas point `at` (the
 * nearest one), or null. `project` = world → canvas.
 */
export function cometUnder(comets: readonly CometMapData[], at: { x: number; y: number }, project: (w: Vec2) => { x: number; y: number }): string | null {
  let best: string | null = null;
  let bestD = COMET_HIT_PX;
  for (const c of comets) {
    if (!c.known) continue;
    const track = distToPolyline(c.arc.map(project), at);
    const n = c.now ? project(c.now) : null;
    // the nucleus glyph is bigger than the track line
    const d = Math.min(track, n ? Math.hypot(n.x - at.x, n.y - at.y) - 4 : Infinity);
    if (d <= bestD) {
      bestD = d;
      best = c.id;
    }
  }
  return best;
}

/** Legend swatch of a comet track: a dashed curve with the arrowhead. */
export function drawCometArcSwatch(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = withAlpha(SITE_COLORS.comet, 0.8);
  ctx.lineWidth = 1.4;
  ctx.setLineDash([3, 2.5]);
  ctx.beginPath();
  ctx.moveTo(1.5, size - 3);
  ctx.quadraticCurveTo(size * 0.25, size * 0.2, size - 3, 3.5);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(size - 7, 2.5);
  ctx.lineTo(size - 2.5, 3.2);
  ctx.lineTo(size - 4.2, 7.5);
  ctx.stroke();
  ctx.restore();
}
