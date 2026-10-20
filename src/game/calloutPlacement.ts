// Where a world callout's label goes (long-term design 10.3): beside its anchor, never cut off by the
// screen edge and clear of the edge-arrow labels (the hostile pirates', the scanner finds'). Pure –
// Game asks it at the UI redraw and on every frame while it moves the labels.
import type { EdgeArrow } from '../ui/stationHud';
import { BOTTOM_RIGHT_ZONE, CONSOLE_ZONE_DEFAULT, chipsBesideZone, currentHudZones, topLeftZone } from '../ui/hudZones';
import { calloutShiftStyle } from '../ui/theme/Callout';

/** A screen rectangle (px, UI-root coordinates). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The label's offset from the anchor (CSS: 24 px from the anchor to the label's edge). */
const GAP = 24;
/** The safe margin along the screen edge: an anchor closer to it has no label. */
const SAFE = 8;
/** A label's usual size (a title, a detail line, the key line). */
export const CALLOUT_LABEL = { w: 240, h: 96 };
/** How far a label may slide sideways off a HUD panel (px) - further, the leader line would get long. */
const MAX_SHIFT = 90;
/** Room between a slid label and the panel (px). */
const SHIFT_GAP = 6;

/** The side of a label; `shift` (px, only when non-zero) slides it sideways, away from its anchor. */
export interface CalloutPlace {
  flip: boolean;
  below: boolean;
  shift?: number;
}

const hits = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function labelBox(x: number, y: number, flip: boolean, below: boolean, w: number, h: number): Box {
  return { x: flip ? x - GAP - w : x + GAP, y: below ? y + GAP : y - GAP - h, w, h };
}

/**
 * The side of the label: left of the anchor near the right edge, below it when it would not fit above,
 * the other vertical side when an edge-arrow label or a HUD panel is in the way; when both sides are
 * in the way, the label slides a little sideways off it (a find next to the objectives band). Null =
 * the anchor is off screen or on its very edge – no label (it would be cut off).
 */
export function calloutSide(
  x: number,
  y: number,
  view: { width: number; height: number },
  avoid: readonly Box[] = [],
  height = CALLOUT_LABEL.h,
): CalloutPlace | null {
  if (x < SAFE || x > view.width - SAFE || y < SAFE || y > view.height - SAFE) return null;
  const w = CALLOUT_LABEL.w;
  const flip = x > view.width - (w + 40);
  const fits = (below: boolean): boolean => {
    const b = labelBox(x, y, flip, below, w, height);
    return b.y >= SAFE && b.y + b.h <= view.height - SAFE;
  };
  let below = !fits(false) && fits(true);
  const blocked = (side: boolean): boolean => avoid.some((a) => hits(labelBox(x, y, flip, side, w, height), a));
  if (blocked(below) && fits(!below) && !blocked(!below)) below = !below;
  const box = labelBox(x, y, flip, below, w, height);
  const blockers = avoid.filter((a) => hits(box, a));
  if (blockers.length === 0) return { flip, below };
  // away from the anchor: right of the panels for a label on the right, left of them for a flipped one
  const dx = flip ? Math.min(...blockers.map((a) => a.x - SHIFT_GAP - (box.x + box.w))) : Math.max(...blockers.map((a) => a.x + a.w + SHIFT_GAP - box.x));
  const moved = { ...box, x: box.x + dx };
  const ok = (flip ? dx < 0 : dx > 0) && Math.abs(dx) <= MAX_SHIFT && moved.x >= SAFE && moved.x + moved.w <= view.width - SAFE && !avoid.some((a) => hits(moved, a));
  return ok ? { flip, below, shift: Math.round(dx) } : { flip, below };
}

/** Puts a label's slide on its element (the game moves the labels every frame, without a redraw). */
export function applyCalloutShift(el: HTMLElement, shift: number): void {
  for (const [k, v] of Object.entries(calloutShiftStyle(shift))) el.style.setProperty(k, v);
}

/** The screen area an edge arrow takes: its head at the edge and its label towards the centre (EdgeArrowLayer). */
export function edgeArrowBox(a: EdgeArrow): Box {
  const c = Math.cos(a.angle);
  const lx = a.x - c * (26 + 58 * Math.abs(c));
  const ly = a.y - Math.sin(a.angle) * 26;
  const left = Math.min(a.x - 22, lx - 75);
  const top = Math.min(a.y - 22, ly - 15);
  const right = Math.max(a.x + 22, lx + 75);
  const bottom = Math.max(a.y + 22, ly + 15);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * The top HUD panels and the left column as boxes (the navigation band with the objectives band and
 * the event chips under them, the credits with the controls help, the radio panel), as Hud measured
 * them last (the bottom corners when the view height is given): a label next to them takes the other side of its anchor or slides off them.
 */
export function hudPanelBoxes(view: { width: number; height?: number }): Box[] {
  const zones = currentHudZones();
  const tl = topLeftZone(zones);
  const out: Box[] = [{ x: 0, y: 0, w: tl.width, h: tl.height }];
  const tr = zones.topRight;
  if (tr.width > 0) out.push({ x: view.width - tr.width, y: 0, w: tr.width, h: tr.height });
  const beside = chipsBesideZone(zones);
  if (beside) out.push({ x: beside.x, y: beside.y, w: beside.width, h: beside.height });
  if (zones.radio) out.push({ x: zones.radio.x, y: zones.radio.y, w: zones.radio.width, h: zones.radio.height });
  // the bottom corners: the console (measured) and the radar with the scanner and K chips
  if (view.height !== undefined) {
    const c = zones.console ?? CONSOLE_ZONE_DEFAULT;
    out.push({ x: 0, y: view.height - c.height, w: c.width, h: c.height });
    out.push({ x: view.width - BOTTOM_RIGHT_ZONE.width, y: view.height - BOTTOM_RIGHT_ZONE.height, w: BOTTOM_RIGHT_ZONE.width, h: BOTTOM_RIGHT_ZONE.height });
  }
  return out;
}
