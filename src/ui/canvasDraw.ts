// Drawing on the radar and map canvases (shared by the HUD and the map): the ship, stations, discovery
// places, signals, survey points and the M4b world sites (derelicts with relays, graveyards, mines, comets).
import type { PlaceKind } from '../game/discovery/exploreUi';
import { RESOURCES } from '../data/resources';
import { PALETTE } from './theme/tokens';

/** The ship arrow: the sim angle is counter-clockwise, the canvas y points down → rotate by -angle. */
export function drawShipMarker(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.7, size * 0.62);
  ctx.lineTo(-size * 0.35, 0);
  ctx.lineTo(-size * 0.7, -size * 0.62);
  ctx.closePath();
  ctx.fillStyle = PALETTE.hullHi;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = PALETTE.trim;
  ctx.stroke();
  ctx.restore();
}

/** A station diamond (filled = in range, outline = pinned to the rim). */
export function drawStation(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, hollow = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.lineWidth = 2;
  if (hollow) {
    ctx.strokeStyle = color;
    ctx.strokeRect(-size / 2, -size / 2, size, size);
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.strokeStyle = PALETTE.screen;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-size / 2, -size / 2, size, size);
  }
  ctx.restore();
}

/** `rgba()` strings by colour and alpha – the map and the radar ask for the same few every frame. */
const rgbaCache = new Map<string, Map<number, string>>();

export const withAlpha = (hex: string, alpha: number): string => {
  let byAlpha = rgbaCache.get(hex);
  if (!byAlpha) {
    if (rgbaCache.size >= 64) rgbaCache.clear();
    byAlpha = new Map();
    rgbaCache.set(hex, byAlpha);
  }
  let rgba = byAlpha.get(alpha);
  if (rgba === undefined) {
    // fades (stale marks, the ship's pulse) bring many alphas: keep the cache small
    if (byAlpha.size >= 64) byAlpha.clear();
    const n = Number.parseInt(hex.slice(1), 16);
    rgba = `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    byAlpha.set(alpha, rgba);
  }
  return rgba;
};

/** Canvas pixel density (crisp lines on HiDPI too). */
export function prepareCanvas(canvas: HTMLCanvasElement, size: number): CanvasRenderingContext2D | null {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const px = Math.round(size * dpr);
  if (canvas.width !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** A discovery place on the radar / map: its shape by kind (anomaly a double ring, giant a circle, cache a triangle…). */
export function drawPlace(ctx: CanvasRenderingContext2D, x: number, y: number, kind: PlaceKind, fresh: boolean, size = 5) {
  ctx.save();
  ctx.lineWidth = 1.5;
  const color = kind === 'distress' ? PALETTE.warn : kind === 'echo' ? ECHO_COLOR : fresh ? PALETTE.glow : withAlpha(PALETTE.glow, 0.55);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  switch (kind) {
    case 'anomaly':
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.moveTo(x + size * 0.45, y);
      ctx.arc(x, y, size * 0.45, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'giant':
      ctx.arc(x, y, size + 1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'cache':
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size, y + size * 0.8);
      ctx.lineTo(x - size, y + size * 0.8);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'echo':
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * (size + 2), y + Math.sin(a) * (size + 2));
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'distress':
      ctx.moveTo(x - size, y);
      ctx.lineTo(x + size, y);
      ctx.moveTo(x, y - size);
      ctx.lineTo(x, y + size);
      ctx.stroke();
      break;
    case 'derelict':
      drawDerelict(ctx, x, y, size + 1, fresh ? SITE_COLORS.derelict : withAlpha(SITE_COLORS.derelict, 0.6));
      break;
    case 'graveyard':
      drawGraveyard(ctx, x, y, size + 1, fresh ? SITE_COLORS.graveyard : withAlpha(SITE_COLORS.graveyard, 0.6));
      break;
    case 'comet':
      drawComet(ctx, x, y, size + 1, COMET_LEGEND_TAIL, fresh ? SITE_COLORS.comet : withAlpha(SITE_COLORS.comet, 0.6));
      break;
    default:
      ctx.strokeRect(x - size * 0.7, y - size * 0.7, size * 1.4, size * 1.4);
  }
  ctx.restore();
}

/**
 * Survey point (sectors §4.1): a surveyor's reticle – a ring with four ticks outside – in hull white
 * while it waits for a pulse; a marked one is a filled green dot in a thin ring (shape + colour).
 */
export function drawSurveyPoint(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, done: boolean) {
  ctx.save();
  ctx.lineWidth = 1.5;
  if (done) {
    ctx.strokeStyle = withAlpha(PALETTE.ok, 0.7);
    ctx.fillStyle = PALETTE.ok;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, size * 0.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = PALETTE.hullHi;
    ctx.beginPath();
    ctx.arc(x, y, size * 0.7, 0, Math.PI * 2);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      ctx.moveTo(x + dx * size * 0.7, y + dy * size * 0.7);
      ctx.lineTo(x + dx * size * 1.35, y + dy * size * 1.35);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** A signal: a dashed amber circle of uncertainty (10.8). */
export function drawSignal(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = withAlpha(PALETTE.warn, 0.85);
  ctx.fillStyle = withAlpha(PALETTE.warn, 0.08);
  ctx.beginPath();
  ctx.arc(x, y, Math.max(3, r), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** The Forge-smiths' ember colour (Echoes) – from the `kov_ember` swatch. */
export const ECHO_COLOR = '#ff8a5c';

/** Pirate places (M3.6): fortress = notched red square with a claw cross, beacon = triangle, raid = double ring, container = violet box. */
export function drawPirateMark(ctx: CanvasRenderingContext2D, x: number, y: number, kind: 'fortress' | 'beacon' | 'raid' | 'container', size: number, down = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 2;
  const red = down ? withAlpha(PALETTE.textDim, 0.8) : PALETTE.bad;
  if (kind === 'fortress') {
    ctx.strokeStyle = red;
    ctx.fillStyle = withAlpha(red, down ? 0.1 : 0.25);
    ctx.beginPath();
    const s = size;
    const c = size * 0.35;
    ctx.moveTo(-s + c, -s);
    ctx.lineTo(s, -s);
    ctx.lineTo(s, s - c);
    ctx.lineTo(s - c, s);
    ctx.lineTo(-s, s);
    ctx.lineTo(-s, -s + c);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.45, -s * 0.45);
    ctx.lineTo(s * 0.45, s * 0.45);
    ctx.moveTo(s * 0.45, -s * 0.45);
    ctx.lineTo(-s * 0.45, s * 0.45);
    ctx.stroke();
  } else if (kind === 'beacon') {
    // objects are hollow (radar grammar R7) – a filled red shape would read as an attacking ship
    ctx.fillStyle = withAlpha(red, 0.25);
    ctx.strokeStyle = red;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.85, size * 0.6);
    ctx.lineTo(-size * 0.85, size * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (kind === 'raid') {
    ctx.strokeStyle = PALETTE.bad;
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, size * 1.6, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = withAlpha(PALETTE.tractor, 0.3);
    ctx.strokeStyle = PALETTE.tractor;
    ctx.lineWidth = 1.25;
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.strokeRect(-size / 2, -size / 2, size, size);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// M4b world sites (T10): objects, so hollow (radar grammar R7)

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/**
 * Site colours: a dead station is pale hull grey (its powered relays light up in glow), a graveyard
 * amber like the wrecks on the radar, a live mine red, a comet in the colour of its ice.
 */
export const SITE_COLORS = {
  derelict: PALETTE.hullShade,
  graveyard: PALETTE.warn,
  mine: PALETTE.bad,
  comet: hex(RESOURCES.ice.color),
  relayLit: PALETTE.glow,
} as const;

/** The tail direction of a comet glyph without a world direction (legend, places list): down left. */
export const COMET_LEGEND_TAIL = (Math.PI * 3) / 4;

/**
 * A derelict station: a broken wheel – a rim with a gap, a hub and three spokes, one of them snapped.
 * `relays` adds the relay pips around it (map): lit ones filled in glow, dark ones hollow.
 */
export function drawDerelict(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, relays?: { lit: number; total: number }) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.fillStyle = withAlpha(PALETTE.hullShade, 0.16);
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, Math.PI * 2);
  ctx.fill();
  // the rim, broken at the upper right
  ctx.beginPath();
  ctx.arc(0, 0, size, -Math.PI * 0.12, Math.PI * 1.62);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.3, 0, Math.PI * 2);
  for (const [i, a] of [Math.PI / 2, (Math.PI * 7) / 6, -Math.PI / 6].entries()) {
    const reach = i === 2 ? 0.62 : 1;
    ctx.moveTo(Math.cos(a) * size * 0.3, Math.sin(a) * size * 0.3);
    ctx.lineTo(Math.cos(a) * size * reach, Math.sin(a) * size * reach);
  }
  ctx.stroke();
  if (relays) {
    const r = Math.max(1.6, size * 0.28);
    for (let i = 0; i < relays.total; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / relays.total;
      const px = Math.cos(a) * (size + r + 2.5);
      const py = Math.sin(a) * (size + r + 2.5);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      if (i < relays.lit) {
        ctx.fillStyle = SITE_COLORS.relayLit;
        ctx.fill();
      } else {
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = withAlpha(PALETTE.hullShade, 0.75);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** A ship graveyard: two hulls crossed over each other. */
export function drawGraveyard(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = withAlpha(PALETTE.warn, 0.14);
  for (const rot of [0.62, -0.62]) {
    ctx.save();
    ctx.rotate(rot);
    const w = size * 0.34;
    ctx.beginPath();
    ctx.moveTo(size * 1.05, 0);
    ctx.lineTo(size * 0.45, w);
    ctx.lineTo(-size, w);
    ctx.lineTo(-size, -w);
    ctx.lineTo(size * 0.45, -w);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/** A comet: a hollow nucleus with a fanned tail stroke. `tail` = the tail direction in canvas radians. */
export function drawComet(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, tail: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = 'round';
  const n = size * 0.5;
  for (const [k, alpha, len] of [
    [-0.32, 0.45, 1.8],
    [0, 0.85, 2.4],
    [0.32, 0.45, 1.8],
  ] as const) {
    ctx.strokeStyle = withAlpha(color, alpha);
    ctx.lineWidth = k === 0 ? 1.6 : 1.1;
    ctx.beginPath();
    ctx.moveTo(Math.cos(tail + k) * n, Math.sin(tail + k) * n);
    ctx.lineTo(Math.cos(tail + k) * size * len, Math.sin(tail + k) * size * len);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, n, 0, Math.PI * 2);
  ctx.fillStyle = withAlpha(color, 0.3);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

/** A relay mast: a pole on a foot with the lamp on top – lit = a glowing lamp, dark = a hollow one. */
export function drawRelayMast(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, lit: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = lit ? withAlpha(SITE_COLORS.relayLit, 0.9) : SITE_COLORS.derelict;
  ctx.beginPath();
  ctx.moveTo(-size * 0.55, size);
  ctx.lineTo(size * 0.55, size);
  ctx.moveTo(0, size);
  ctx.lineTo(0, -size * 0.45);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -size * 0.8, size * 0.38, 0, Math.PI * 2);
  if (lit) {
    ctx.fillStyle = SITE_COLORS.relayLit;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = withAlpha(SITE_COLORS.relayLit, 0.4);
    ctx.beginPath();
    ctx.arc(0, -size * 0.8, size * 0.75, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
}

/** A live mine: a red dot in a ring; armed = a heavier ring and a second, outer one. */
export function drawMine(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, armed = false) {
  ctx.save();
  ctx.strokeStyle = withAlpha(SITE_COLORS.mine, armed ? 1 : 0.8);
  ctx.lineWidth = armed ? 2 : 1.3;
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.stroke();
  if (armed) {
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, size * 1.7, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = SITE_COLORS.mine;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(1.2, size * 0.4), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
