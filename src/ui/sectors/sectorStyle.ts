// How a sector's security looks (sectors design §5.1): colour AND pattern, so the map passes a
// black-and-white / colour-blind check – Quiet: no fill, grey-blue; Guarded: green solid fill (cyan
// belongs to my ship and shields); Contested: yellow-amber dots (the radar's "hostile, calm");
// Pirate: red diagonal hatching. Shared by the map layer, its legend, the HUD and the radar arc.
import type { Security } from '../../sim/regions/constants';
import { withAlpha } from '../canvasDraw';
import { PALETTE } from '../theme/tokens';

export const SECURITY_COLORS: Readonly<Record<Security, string>> = {
  quiet: PALETTE.quiet,
  guarded: PALETTE.ok,
  contested: PALETTE.warn,
  pirate: PALETTE.bad,
};

/** Light lift of a Charted sector's area: the fog over it reads as a shadow only (§5.1). */
export const CHARTED_LIFT = 'rgba(176, 204, 232, 0.10)';

/** Pattern cell (px) of the dotted and hatched fills. */
const DOT_CELL = 7;
const HATCH_CELL = 9;

function cell(size: number, draw: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d');
  if (c) draw(c);
  return canvas;
}

let tiles: Partial<Record<Security, HTMLCanvasElement | null>> | null = null;

/** The pattern tile of a security (null = a flat fill or none). */
function patternTile(security: Security): HTMLCanvasElement | null {
  tiles ??= {};
  if (tiles[security] !== undefined) return tiles[security]!;
  const color = SECURITY_COLORS[security];
  let tile: HTMLCanvasElement | null = null;
  if (security === 'contested') {
    tile = cell(DOT_CELL, (c) => {
      c.fillStyle = withAlpha(color, 0.07);
      c.fillRect(0, 0, DOT_CELL, DOT_CELL);
      c.fillStyle = withAlpha(color, 0.75);
      c.beginPath();
      c.arc(DOT_CELL / 2, DOT_CELL / 2, 1.25, 0, Math.PI * 2);
      c.fill();
    });
  } else if (security === 'pirate') {
    tile = cell(HATCH_CELL, (c) => {
      c.fillStyle = withAlpha(color, 0.09);
      c.fillRect(0, 0, HATCH_CELL, HATCH_CELL);
      c.strokeStyle = withAlpha(color, 0.7);
      c.lineWidth = 1.6;
      c.beginPath();
      // the diagonal plus the two corner pieces, so neighbouring cells join into continuous lines
      c.moveTo(-1, HATCH_CELL + 1);
      c.lineTo(HATCH_CELL + 1, -1);
      c.moveTo(-1, 1);
      c.lineTo(1, -1);
      c.moveTo(HATCH_CELL - 1, HATCH_CELL + 1);
      c.lineTo(HATCH_CELL + 1, HATCH_CELL - 1);
      c.stroke();
    });
  }
  tiles[security] = tile;
  return tile;
}

/**
 * The fill of a security on `ctx`: a pattern anchored at the world origin's screen position
 * (`anchorX`, `anchorY`) so it moves with the map, a flat colour, or null (Quiet: no fill).
 */
export function securityFill(ctx: CanvasRenderingContext2D, security: Security, anchorX = 0, anchorY = 0): string | CanvasPattern | null {
  if (security === 'quiet') return null;
  if (security === 'guarded') return withAlpha(SECURITY_COLORS.guarded, 0.17);
  const tile = patternTile(security);
  const pattern = tile ? ctx.createPattern(tile, 'repeat') : null;
  if (!pattern) return withAlpha(SECURITY_COLORS[security], 0.16);
  const size = security === 'contested' ? DOT_CELL : HATCH_CELL;
  const m = typeof DOMMatrix === 'undefined' ? null : new DOMMatrix().translateSelf(((anchorX % size) + size) % size, ((anchorY % size) + size) % size);
  if (m) pattern.setTransform(m);
  return pattern;
}

/** A small swatch of a security (legend): its fill, pattern and border. */
export function drawSecuritySwatch(ctx: CanvasRenderingContext2D, security: Security, x: number, y: number, w: number, h: number): void {
  const fill = securityFill(ctx, security);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }
  ctx.strokeStyle = withAlpha(SECURITY_COLORS[security], 0.95);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
}
