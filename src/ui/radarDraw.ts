// Radar glyphs by the radar grammar (readability pass R7, radar.ts): ships filled with a dark outline,
// objects as an outline with at most a faint fill. Shared by the radar (Hud.tsx) and its legend
// (RadarLegend.tsx), so the legend always shows exactly what the radar draws.
import { COMET_LEGEND_TAIL, drawComet, drawDerelict, drawGraveyard, drawMine, drawPirateMark, drawPlace, drawRelayMast, drawSignal, drawSurveyPoint, SITE_COLORS, withAlpha } from './canvasDraw';
import { RESOURCES } from '../data/resources';
import { hexColor, RADAR_STYLES, type GuildContact, type RadarGlyph, type SiteContact } from './radar';
import { PALETTE, STATION_COLORS } from './theme/tokens';

/** Fill of hollow objects (keeps a dense asteroid field readable without reading as "ships"). */
const OBJECT_FILL = 0.22;

/**
 * A ship: a filled arrowhead in the flight direction (sim angle, canvas y down). `dim` = out of range,
 * pinned to the rim.
 */
export function drawRadarShip(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, glyph: RadarGlyph, size: number, dim = false) {
  const color = RADAR_STYLES[glyph].color ?? PALETTE.hullHi;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-angle);
  ctx.globalAlpha = dim ? 0.7 : 1;
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.75, size * 0.7);
  ctx.lineTo(-size * 0.4, 0);
  ctx.lineTo(-size * 0.75, -size * 0.7);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = PALETTE.screen;
  ctx.stroke();
  ctx.restore();
}

/** A rock: an outline in its ore colour with a faint fill; assayed rich ore gets the gold ring. */
export function drawRadarRock(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, rich = false) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = withAlpha(color, OBJECT_FILL + 0.1);
  ctx.fill();
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = color;
  ctx.stroke();
  if (rich) {
    ctx.strokeStyle = PALETTE.oreRich;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r + 2.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** A station: a hollow diamond in its kind's colour (pinned to the rim = thinner, no fill). */
export function drawRadarStation(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, edge = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  if (!edge) {
    ctx.fillStyle = withAlpha(color, OBJECT_FILL);
    ctx.fillRect(-size / 2, -size / 2, size, size);
  }
  ctx.lineWidth = edge ? 1.5 : 2;
  ctx.strokeStyle = edge ? withAlpha(color, 0.8) : color;
  ctx.strokeRect(-size / 2, -size / 2, size, size);
  ctx.restore();
}

/**
 * A live Guild Watch ship (M4d): the ship arrowhead in the friendly green with the orange Guild chevron
 * on its back (public/assets/ui/icons/guild_watch.svg).
 */
export function drawRadarWatch(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number) {
  drawRadarShip(ctx, x, y, angle, 'guildWatch', size);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-angle);
  ctx.fillStyle = PALETTE.trim;
  ctx.beginPath();
  ctx.moveTo(size * 0.2, 0);
  ctx.lineTo(-size * 0.22, size * 0.34);
  ctx.lineTo(-size * 0.38, size * 0.34);
  ctx.lineTo(-size * 0.02, 0);
  ctx.lineTo(-size * 0.38, -size * 0.34);
  ctx.lineTo(-size * 0.22, -size * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Hull outlines of the convoy glyph (public/assets/ui/icons/convoy.svg, bow +x, a 24 grid around 12, 12). */
const TRADER_HULL: readonly (readonly [number, number])[] = [
  [11, 0],
  [7.4, -5],
  [-2.8, -5],
  [-4.4, -3.2],
  [-4.4, 3.2],
  [-2.8, 5],
  [7.4, 5],
];
const TANKER_HULL: readonly (readonly [number, number])[] = [
  [2.4, 0],
  [1.2, -2.6],
  [-1.4, -2.6],
  [-2.3, -1.4],
  [-2.3, 1.4],
  [-1.4, 2.6],
  [1.2, 2.6],
];

function hullPath(ctx: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[], k: number, dx = 0) {
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(dx + px * k, py * k) : ctx.lineTo(dx + px * k, py * k)));
  ctx.closePath();
}

/**
 * A convoy ship (M4d): a long freighter hull (the trader) or a short one (the tanker), filled in the
 * neutral ship blue with the dark outline, bow in the flight direction. `size` = the trader's half length.
 */
export function drawRadarConvoy(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number, tanker = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-angle);
  const k = size / 11;
  hullPath(ctx, tanker ? TANKER_HULL : TRADER_HULL, tanker ? k * 1.6 : k);
  ctx.fillStyle = RADAR_STYLES.convoy.color!;
  ctx.fill();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = PALETTE.screen;
  ctx.stroke();
  ctx.restore();
}

/** The convoy glyph of the legend: the trader with its tanker in line (like the SVG icon). */
function drawConvoyPair(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save();
  ctx.translate(x, y);
  const k = size / 11;
  for (const [pts, dx] of [
    [TANKER_HULL, -8.8],
    [TRADER_HULL, 0],
  ] as const) {
    hullPath(ctx, pts, k, dx * k);
    ctx.fillStyle = RADAR_STYLES.convoy.color!;
    ctx.fill();
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = PALETTE.screen;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A Guild relay mast (M4d): the relay mast in Guild orange with a chevron on the pole
 * (public/assets/ui/icons/guild_relay.svg); powered = a glow lamp with a halo (guild_relay_lit.svg).
 */
export function drawGuildRelayMast(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, lit: boolean) {
  const trim = RADAR_STYLES.guildRelay.color!;
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = trim;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-size * 0.6, size);
  ctx.lineTo(size * 0.6, size);
  ctx.moveTo(0, size);
  ctx.lineTo(0, -size * 0.35);
  ctx.moveTo(-size * 0.33, size * 0.62);
  ctx.lineTo(0, size * 0.32);
  ctx.lineTo(size * 0.33, size * 0.62);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -size * 0.7, size * 0.36, 0, Math.PI * 2);
  if (lit) {
    ctx.fillStyle = SITE_COLORS.relayLit;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = withAlpha(SITE_COLORS.relayLit, 0.45);
    ctx.beginPath();
    ctx.arc(0, -size * 0.7, size * 0.62, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = withAlpha(trim, OBJECT_FILL);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** The Guild ships on the radar (M4d): `cx, cy` = the radar centre (canvas px), `s` = px per world unit. */
export function drawRadarGuild(ctx: CanvasRenderingContext2D, contacts: readonly GuildContact[], cx: number, cy: number, s: number) {
  for (const c of contacts) {
    const x = cx + c.x * s;
    const y = cy - c.y * s;
    if (c.kind === 'watch') drawRadarWatch(ctx, x, y, c.angle, 6.5);
    else drawRadarConvoy(ctx, x, y, c.angle, 6.5, c.tanker ?? false);
  }
}

/** A wreck with loot: a small amber square outline. */
export function drawRadarWreck(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.strokeStyle = withAlpha(PALETTE.warn, 0.9);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x - 3, y - 3, 6, 6);
  ctx.restore();
}

/**
 * World sites (M4b) on the radar, under the ships: `cx, cy` = the radar centre (canvas px), `s` = px per
 * world unit, `clip` = the display radius (a graveyard's field may reach past the rim).
 * A graveyard is its glyph plus a faint dashed outline of its field once the field is bigger than the
 * glyph; a derelict grows with its size; relays are small masts (lit in glow); mines red dots in a
 * ring; a comet a hollow nucleus with its tail away from home.
 */
export function drawRadarSites(ctx: CanvasRenderingContext2D, sites: readonly SiteContact[], cx: number, cy: number, s: number, clip: number) {
  if (sites.length === 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, clip, 0, Math.PI * 2);
  ctx.clip();
  for (const c of sites) {
    const x = cx + c.x * s;
    const y = cy - c.y * s;
    switch (c.kind) {
      case 'graveyard': {
        const field = c.radius * s;
        if (field > 12) {
          ctx.save();
          ctx.setLineDash([3, 4]);
          ctx.lineWidth = 1;
          ctx.strokeStyle = withAlpha(SITE_COLORS.graveyard, 0.45);
          ctx.beginPath();
          ctx.arc(x, y, field, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        drawGraveyard(ctx, x, y, 5, withAlpha(SITE_COLORS.graveyard, 0.9));
        break;
      }
      case 'derelict':
        drawDerelict(ctx, x, y, Math.min(14, Math.max(5, c.radius * s)), SITE_COLORS.derelict);
        break;
      case 'relay':
        drawRelayMast(ctx, x, y, 3.6, c.on);
        break;
      case 'guildRelay':
        drawGuildRelayMast(ctx, x, y, 4.2, c.on);
        break;
      case 'mine':
        drawMine(ctx, x, y, 3, c.on);
        break;
      case 'comet':
        // the sim angle is counter-clockwise, the canvas y points down
        drawComet(ctx, x, y, Math.max(4.5, c.radius * s), -c.angle, SITE_COLORS.comet);
        break;
    }
  }
  ctx.restore();
}

/** One sample of a glyph (the legend). */
export function drawRadarGlyph(ctx: CanvasRenderingContext2D, glyph: RadarGlyph, x: number, y: number) {
  switch (glyph) {
    case 'shipAttacking':
    case 'shipHostile':
    case 'shipNeutral':
      drawRadarShip(ctx, x, y, Math.PI / 2, glyph, 6.5);
      break;
    case 'station':
      drawRadarStation(ctx, x - 6, y, 7, STATION_COLORS.home);
      drawRadarStation(ctx, x + 6, y, 7, STATION_COLORS.station);
      break;
    case 'rock':
      drawRadarRock(ctx, x - 5, y + 1, 2.6, hexColor(RESOURCES.iron.color));
      drawRadarRock(ctx, x + 4, y - 2, 3.2, hexColor(RESOURCES.ice.color));
      break;
    case 'richRock':
      drawRadarRock(ctx, x, y, 2.8, hexColor(RESOURCES.copper.color), true);
      break;
    case 'signal':
      drawSignal(ctx, x, y, 6);
      break;
    case 'place':
      drawPlace(ctx, x, y, 'anomaly', true, 5);
      break;
    case 'wreck':
      drawRadarWreck(ctx, x, y);
      break;
    case 'pirateBase':
      drawPirateMark(ctx, x, y, 'fortress', 5.5);
      break;
    case 'survey':
      drawSurveyPoint(ctx, x - 5, y, 3.5, false);
      drawSurveyPoint(ctx, x + 6, y, 3.5, true);
      break;
    case 'derelict':
      drawDerelict(ctx, x - 3, y + 1, 5, SITE_COLORS.derelict);
      drawRelayMast(ctx, x + 6.5, y + 1.5, 3.4, true);
      break;
    case 'graveyard':
      // the graveyard and its live mines share a row (the pinned legend has to fit under the key list)
      drawGraveyard(ctx, x - 3, y, 5, SITE_COLORS.graveyard);
      drawMine(ctx, x + 6.5, y + 2, 2.6);
      break;
    case 'comet':
      drawComet(ctx, x + 2.5, y - 2.5, 4.5, COMET_LEGEND_TAIL, SITE_COLORS.comet);
      break;
    // M4d
    case 'guildWatch':
      drawRadarWatch(ctx, x, y, Math.PI / 2, 6.5);
      break;
    case 'convoy':
      drawConvoyPair(ctx, x + 2, y, 6.5);
      break;
    case 'guildRelay':
      drawGuildRelayMast(ctx, x - 4.5, y + 1, 4.2, false);
      drawGuildRelayMast(ctx, x + 5, y + 1, 4.2, true);
      break;
  }
}
