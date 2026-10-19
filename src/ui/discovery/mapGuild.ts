// M4d map drawing (plan §2.8, T12): the Guild layer (published convoys, known Guild relays, live Guild
// Watch ships), the player's map notes, the stale marks of pirates and comets (S6) and the planned route
// with the range circles. The glyphs of convoys, the Watch, Guild relays and notes are the SVG icons of
// `public/assets/ui/icons/` (art/README §2.7.26), drawn as images – the canvas map, the legend and the
// note picker share them. Player note text goes to the canvas as plain text (fillText), never markup.
import { NOTE_ICONS, type NoteIcon } from '../../data/navigation';
import type { MapGuildData, MapNoteView, RoutePlanData, StaleMark } from '../../game/map/types';
import { tx } from '../../i18n';
import { assetUrl } from '../../render/assets/url';
import { formatClock } from '../sites/chipFormat';
import { drawComet, SITE_COLORS, withAlpha } from '../canvasDraw';
import { LABEL_PRIORITY, type LabelObstacle } from '../mapLabels';
import { FONTS, PALETTE } from '../theme/tokens';
import { tailAngle, type MapProjection, type SiteLabel } from './mapSites';

/** The M4d map icons (file names in public/assets/ui/icons without `.svg`). */
export type MapIconName = 'convoy' | 'guild_watch' | 'guild_relay' | 'guild_relay_lit' | `note_${NoteIcon}`;

/** URL of a map icon (legend, note picker). */
export const mapIconUrl = (name: MapIconName): string => assetUrl(`assets/ui/icons/${name}.svg`);

const MAP_ICONS: readonly MapIconName[] = ['convoy', 'guild_watch', 'guild_relay', 'guild_relay_lit', ...NOTE_ICONS.map((i) => `note_${i}` as const)];
const images = new Map<MapIconName, HTMLImageElement>();
const waiting = new Set<() => void>();
/** All icons requested (on the first use) / decoded. */
let iconsRequested = false;
let iconsReady = false;

/**
 * Loads and decodes every map icon at once on the first use; the map and the legend hear about it
 * once, when all are ready (one redraw instead of one per icon – audit 2026-10-17, E2).
 */
function requestIcons(): void {
  if (iconsRequested || typeof Image === 'undefined') return;
  iconsRequested = true;
  const decoded = MAP_ICONS.map((name) => {
    const img = new Image();
    img.decoding = 'async';
    const done = new Promise<void>((resolve) => {
      img.onload = img.onerror = () => resolve();
    });
    img.src = mapIconUrl(name);
    images.set(name, img);
    return typeof img.decode === 'function' ? img.decode().catch(() => done) : done;
  });
  void Promise.all(decoded).then(() => {
    iconsReady = true;
    for (const fn of [...waiting]) fn();
  });
}

/** The icon as a loaded image, or null while the icons load (the map draws again then – `onMapIconLoad`). */
export function mapIcon(name: MapIconName): HTMLImageElement | null {
  requestIcons();
  if (!iconsReady) return null;
  const img = images.get(name);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

/** Calls `fn` once the map icons are loaded; returns the unsubscribe function. */
export function onMapIconLoad(fn: () => void): () => void {
  waiting.add(fn);
  return () => waiting.delete(fn);
}

/** Draws an icon centred at (x, y), `size` px wide, turned by `angle` (canvas radians; icons point +X). */
export function drawMapIcon(ctx: CanvasRenderingContext2D, name: MapIconName, x: number, y: number, size: number, angle = 0, alpha = 1): void {
  const img = mapIcon(name);
  if (!img) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
}

const box = (id: string, x: number, y: number, r: number): LabelObstacle => ({ id, x: x - r, y: y - r, w: r * 2, h: r * 2 });

/** The relay icon of a stage: lit once powered. */
export const relayIcon = (stage: MapGuildData['relays'][number]['stage']): MapIconName => (stage === 'powered' || stage === 'secured' ? 'guild_relay_lit' : 'guild_relay');

const CONVOY_PX = 20;
const WATCH_PX = 15;
const RELAY_PX = 16;
export const NOTE_PX = 18;

/** The Guild layer: known relays, convoys (turned by their heading, "near in 2:10"), live Watch ships. */
export function drawMapGuild(ctx: CanvasRenderingContext2D, guild: MapGuildData, p: MapProjection, label: (l: SiteLabel) => void, obstacles: LabelObstacle[]): void {
  const t = tx().guild.map;
  guild.relays.forEach((r, i) => {
    if (!r.known) return;
    const x = p.toX(r.pos.x);
    const y = p.toY(r.pos.y);
    if (!p.onScreen(x, y, 30)) return;
    const id = `relay:${r.lane}:${i}`;
    drawMapIcon(ctx, relayIcon(r.stage), x, y, RELAY_PX, 0, r.stage === 'broken' ? 0.6 : 1);
    obstacles.push(box(id, x, y, RELAY_PX / 2));
    label({
      id,
      priority: LABEL_PRIORITY.poi,
      anchor: { x, y },
      gap: RELAY_PX / 2 + 3,
      text: t.relay(r.lane, r.stage),
      font: `600 11px ${FONTS.display}`,
      size: 11,
      color: r.stage === 'broken' ? withAlpha(PALETTE.trim, 0.75) : PALETTE.trim,
    });
  });
  guild.convoys.forEach((c, i) => {
    const x = p.toX(c.pos.x);
    const y = p.toY(c.pos.y);
    if (!p.onScreen(x, y, 30)) return;
    const id = `convoy:${c.pass}:${i}`;
    // world heading → canvas (y is down)
    drawMapIcon(ctx, 'convoy', x, y, CONVOY_PX, -c.heading, c.open ? 1 : 0.6);
    obstacles.push(box(id, x, y, CONVOY_PX / 2));
    label({
      id,
      priority: LABEL_PRIORITY.poi,
      anchor: { x, y },
      gap: CONVOY_PX / 2 + 3,
      text: c.open ? t.convoy(c.eta !== undefined ? formatClock(c.eta) : null) : t.convoyDone,
      font: `650 11px ${FONTS.display}`,
      size: 11,
      color: c.open ? PALETTE.shield : withAlpha(PALETTE.shield, 0.65),
    });
  });
  guild.watch.forEach((w, i) => {
    const x = p.toX(w.pos.x);
    const y = p.toY(w.pos.y);
    if (!p.onScreen(x, y, 20)) return;
    drawMapIcon(ctx, 'guild_watch', x, y, w.kind === 'frigate' ? WATCH_PX + 3 : WATCH_PX, -Math.PI / 2);
    obstacles.push(box(`watch:${i}`, x, y, WATCH_PX / 2));
  });
}

/** Player notes: the icon and the player's text (plain text), an outline on the one being edited. */
export function drawMapNotes(
  ctx: CanvasRenderingContext2D,
  notes: readonly MapNoteView[],
  p: MapProjection,
  label: (l: SiteLabel) => void,
  obstacles: LabelObstacle[],
  selected: number | null = null,
): void {
  for (const n of notes) {
    const x = p.toX(n.pos.x);
    const y = p.toY(n.pos.y);
    if (!p.onScreen(x, y, 30)) continue;
    const id = `note:${n.id}`;
    if (n.id === selected) {
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = PALETTE.hullHi;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(x, y, NOTE_PX / 2 + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    drawMapIcon(ctx, `note_${n.icon}`, x, y, NOTE_PX);
    obstacles.push(box(id, x, y, NOTE_PX / 2));
    label({
      id,
      priority: LABEL_PRIORITY.poi,
      anchor: { x, y },
      gap: NOTE_PX / 2 + 3,
      sides: ['right', 'left', 'below', 'above'],
      text: n.text,
      font: `italic 650 12px ${FONTS.text}`,
      size: 12,
      color: PALETTE.hullHi,
    });
  }
}

/** A faded pirate mark (S6): a dashed red ring around a dot – a group seen here a while ago. */
export function drawStalePirates(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, alpha: number): void {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.strokeStyle = PALETTE.bad;
  ctx.fillStyle = PALETTE.bad;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(x, y, size * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Stale marks: where pirates / a comet nucleus were last seen, faded by age, "Pirates · 3 min ago". */
export function drawStaleMarks(ctx: CanvasRenderingContext2D, marks: readonly StaleMark[], p: MapProjection, label: (l: SiteLabel) => void, obstacles: LabelObstacle[]): void {
  const t = tx().guild.map;
  marks.forEach((m, i) => {
    const x = p.toX(m.pos.x);
    const y = p.toY(m.pos.y);
    if (!p.onScreen(x, y, 20)) return;
    const id = `stale:${i}`;
    if (m.kind === 'pirates') drawStalePirates(ctx, x, y, 7, m.alpha);
    else {
      ctx.save();
      ctx.globalAlpha *= m.alpha;
      drawComet(ctx, x, y, 6, tailAngle(m.pos), SITE_COLORS.comet);
      ctx.restore();
    }
    obstacles.push(box(id, x, y, 8));
    const color = m.kind === 'pirates' ? PALETTE.bad : SITE_COLORS.comet;
    label({
      id,
      priority: LABEL_PRIORITY.poi + 0.5,
      anchor: { x, y },
      gap: 10,
      text: `${m.kind === 'pirates' ? t.stalePirates : t.staleComet} · ${t.ago(m.ageSeconds)}`,
      font: `600 11px ${FONTS.display}`,
      size: 11,
      color: withAlpha(color, Math.max(0.55, m.alpha)),
    });
  });
}

/**
 * The planned route (§2.8): the range circles around the ship (one way dashed, round trip solid, in
 * the fuel colour), the straight line to the target – the part beyond the one-way range red when the
 * fuel does not reach – and the target flag (its name and distance are in the route readout).
 */
export function drawMapRoute(ctx: CanvasRenderingContext2D, route: RoutePlanData, ship: { x: number; y: number }, p: MapProjection, obstacles: LabelObstacle[]): void {
  const sx = p.toX(ship.x);
  const sy = p.toY(ship.y);
  const tx2 = p.toX(route.to.x);
  const ty = p.toY(route.to.y);
  ctx.save();
  // range circles
  ctx.strokeStyle = withAlpha(PALETTE.fuel, 0.55);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([7, 6]);
  ctx.beginPath();
  ctx.arc(sx, sy, route.rangeOneWay * p.scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = withAlpha(PALETTE.fuel, 0.4);
  ctx.beginPath();
  ctx.arc(sx, sy, route.rangeRound * p.scale, 0, Math.PI * 2);
  ctx.stroke();

  // the line: glow while the fuel reaches, red dashes beyond the one-way range
  const reach = route.distance > 0 ? Math.min(1, route.rangeOneWay / route.distance) : 1;
  const mx = sx + (tx2 - sx) * reach;
  const my = sy + (ty - sy) * reach;
  ctx.lineCap = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = withAlpha(PALETTE.screen, 0.8);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(tx2, ty);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = PALETTE.glow;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(mx, my);
  ctx.stroke();
  if (route.short !== null && reach < 1) {
    ctx.strokeStyle = PALETTE.bad;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(tx2, ty);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // chevrons along the line (direction of travel)
  const len = Math.hypot(tx2 - sx, ty - sy);
  if (len > 80) {
    const ux = (tx2 - sx) / len;
    const uy = (ty - sy) / len;
    ctx.fillStyle = withAlpha(PALETTE.glow, 0.85);
    for (let d = 60; d < len - 30; d += 90) {
      const cx = sx + ux * d;
      const cy = sy + uy * d;
      if (route.short !== null && d / len > reach) ctx.fillStyle = withAlpha(PALETTE.bad, 0.85);
      ctx.beginPath();
      ctx.moveTo(cx + ux * 5, cy + uy * 5);
      ctx.lineTo(cx - ux * 3 - uy * 4, cy - uy * 3 + ux * 4);
      ctx.lineTo(cx - ux * 3 + uy * 4, cy - uy * 3 - ux * 4);
      ctx.closePath();
      ctx.fill();
    }
  }
  // the target: a flag post
  const color = route.short !== null ? PALETTE.bad : PALETTE.glow;
  ctx.strokeStyle = color;
  ctx.fillStyle = withAlpha(color, 0.35);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(tx2, ty, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tx2, ty - 5);
  ctx.lineTo(tx2, ty - 20);
  ctx.lineTo(tx2 + 11, ty - 16);
  ctx.lineTo(tx2, ty - 12);
  ctx.stroke();
  ctx.restore();
  if (p.onScreen(tx2, ty, 10)) obstacles.push({ id: 'route', x: tx2 - 6, y: ty - 21, w: 18, h: 27 });
}
