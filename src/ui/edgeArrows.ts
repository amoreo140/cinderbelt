// Screen-edge arrows for things out of view (readability pass): where the arrows sit, how they slide out
// of the HUD panels and how arrows merge – by screen distance into one arrow with a count
// (`placeEdgeArrows`, the scanner's finds, R6) or by direction into an arc with a count once a pack is
// big enough (`groupEdgeArrows`, the hostile pirates, R2) – and how a target's proximity sizes its arrow.
// Pure (no DOM): feed it projected points, render the result with `EdgeArrowLayer` (EdgeArrowLayer.tsx).
import type { NoteIcon } from '../data/navigation';
import { tx } from '../i18n';
import type { EdgeArrowMark } from './EdgeArrowLayer';
import { formatInt } from './format';
import { edgeArrow, type EdgeArrow } from './stationHud';
import { BOTTOM_RIGHT_ZONE, chipsBesideZone, CONSOLE_ZONE_DEFAULT, currentHudZones, topLeftZone, type HudZones } from './hudZones';
import { formatClock } from './sites/chipFormat';
import { PALETTE } from './theme/tokens';

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgeArrowInput<T> {
  /** The projected point (px within the view); `behind` = behind the camera. */
  screen: { x: number; y: number; behind?: boolean };
  item: T;
  /** Higher wins a slot and leads a merged arrow (default 0). */
  priority?: number;
}

export interface EdgeArrowCluster<T> extends EdgeArrow {
  /** Items in this arrow, the leading (highest priority) one first. */
  items: T[];
}

export interface EdgeArrowOptions<T = unknown> {
  /** Distance of the arrow from the screen edge (px). */
  margin: number;
  /** Screen rects the arrows must not sit in (HUD panels) – an arrow slides along the edge out of them. */
  avoid?: readonly ScreenRect[];
  /** Arrows closer than this (px) merge into one (default 0 = never). */
  mergePx?: number;
  /** At most this many arrows, by priority (default unlimited). */
  max?: number;
  /**
   * May `item` join the arrow `lead` leads (default: always)? An arrow that may not join a near one
   * steps along the screen edge beside it instead (M4d: the route never merges with a note).
   */
  mergeIf?: (lead: T, item: T) => boolean;
  /**
   * The screen box an arrow of `item` takes with its label (M4d): when given, an arrow whose box would
   * overlap an earlier arrow's box or one of `obstacles` slides along its edge until it is clear.
   */
  footprint?: (arrow: EdgeArrow, item: T) => ScreenRect;
  /** Boxes the labels must keep clear of (with `footprint`; e.g. the station and goal arrows). */
  obstacles?: readonly ScreenRect[];
}

const inside = (p: { x: number; y: number }, r: ScreenRect): boolean => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

/**
 * Moves an edge arrow out of the rects: along a side edge up or down, along the top/bottom edge sideways –
 * to the rect's border nearer the screen centre (the arrow keeps pointing the same way). When the edge
 * has no free slot there, the arrow steps into the screen past the rects it sits in instead.
 */
export function slideOutOf(arrow: EdgeArrow, rects: readonly ScreenRect[], view: { width: number; height: number }, gap = 12): EdgeArrow {
  let a = alongEdge(arrow, rects, view, gap);
  if (!rects.some((r) => inside(a, r))) return a;
  // no free slot along the edge (a full left column: the chips reach down to the radio panel) – the
  // arrow steps into the screen past the panels instead, keeping its place along the edge
  a = arrow;
  const side = Math.min(a.x, view.width - a.x) <= Math.min(a.y, view.height - a.y);
  for (let pass = 0; pass < 2; pass++) {
    for (const r of rects) {
      if (!inside(a, r)) continue;
      if (side) a = { ...a, x: a.x < view.width / 2 ? r.x + r.width + gap : r.x - gap };
      else a = { ...a, y: a.y < view.height / 2 ? r.y + r.height + gap : r.y - gap };
    }
  }
  return a;
}

/** `slideOutOf` along the screen edge only (two passes; the result may still sit in a rect). */
function alongEdge(arrow: EdgeArrow, rects: readonly ScreenRect[], view: { width: number; height: number }, gap: number): EdgeArrow {
  let a = arrow;
  // the border nearer the centre first, the other one when the nearer lands on another panel
  const pick = (moves: EdgeArrow[]): EdgeArrow => {
    const sorted = moves.sort((p, q) => Math.hypot(p.x - view.width / 2, p.y - view.height / 2) - Math.hypot(q.x - view.width / 2, q.y - view.height / 2));
    return sorted.find((m) => !rects.some((r) => inside(m, r))) ?? sorted[0]!;
  };
  // two passes: sliding out of one panel may land in a neighbouring one
  for (let pass = 0; pass < 2; pass++) {
    for (const r of rects) {
      if (!inside(a, r)) continue;
      // on a side edge (left / right) rather than the top or bottom one – by position, not by angle
      const side = Math.min(a.x, view.width - a.x) <= Math.min(a.y, view.height - a.y);
      const clampY = (y: number) => Math.min(view.height - gap, Math.max(gap, y));
      const clampX = (x: number) => Math.min(view.width - gap, Math.max(gap, x));
      a = side
        ? pick([{ ...a, y: clampY(r.y - gap) }, { ...a, y: clampY(r.y + r.height + gap) }])
        : pick([{ ...a, x: clampX(r.x - gap) }, { ...a, x: clampX(r.x + r.width + gap) }]);
    }
  }
  return a;
}

/**
 * Edge arrows for the points out of view (visible points get none). Higher priority first; an arrow
 * within `mergePx` of an earlier one joins it (count = items.length).
 */
export function placeEdgeArrows<T>(inputs: readonly EdgeArrowInput<T>[], view: { width: number; height: number }, opts: EdgeArrowOptions<T>): EdgeArrowCluster<T>[] {
  const sorted = inputs.map((input, i) => ({ input, i })).sort((a, b) => (b.input.priority ?? 0) - (a.input.priority ?? 0) || a.i - b.i);
  const out: EdgeArrowCluster<T>[] = [];
  const boxes: ScreenRect[] = [...(opts.obstacles ?? [])];
  const merge = opts.mergePx ?? 0;
  for (const { input } of sorted) {
    const raw = edgeArrow(input.screen, view, opts.margin);
    if (!raw) continue;
    let arrow = opts.avoid?.length ? slideOutOf(raw, opts.avoid, view) : raw;
    const isNear = (c: EdgeArrow) => Math.hypot(c.x - arrow.x, c.y - arrow.y) < merge;
    const join = merge > 0 ? out.find((c) => isNear(c) && (!opts.mergeIf || opts.mergeIf(c.items[0]!, input.item))) : undefined;
    if (join) {
      join.items.push(input.item);
      continue;
    }
    if (opts.max !== undefined && out.length >= opts.max) continue;
    if (merge > 0 && out.some(isNear)) {
      arrow = stepAside(arrow, out, merge, view);
      // stepping aside may land on a panel
      if (opts.avoid?.length) arrow = slideOutOf(arrow, opts.avoid, view);
    }
    if (opts.footprint) {
      const box = opts.footprint;
      const item = input.item;
      arrow = slideAlongEdge(arrow, view, opts.margin, (a) => !opts.avoid?.some((r) => inside(a, r)) && !boxes.some((b) => overlaps(box(a, item), b)));
      boxes.push(box(arrow, item));
    }
    out.push({ ...arrow, items: [input.item] });
  }
  return out;
}

/**
 * Moves an arrow along its screen edge (towards the centre of that edge) until it is `gap` px from every
 * placed arrow – at most a few steps, so a crowded edge still gets an arrow.
 */
function stepAside(arrow: EdgeArrow, placed: readonly EdgeArrow[], gap: number, view: { width: number; height: number }): EdgeArrow {
  const side = Math.min(arrow.x, view.width - arrow.x) <= Math.min(arrow.y, view.height - arrow.y);
  const dir = side ? (arrow.y < view.height / 2 ? 1 : -1) : arrow.x < view.width / 2 ? 1 : -1;
  let a = arrow;
  for (let i = 0; i < 4 && placed.some((p) => Math.hypot(p.x - a.x, p.y - a.y) < gap); i++) {
    a = side ? { ...a, y: a.y + dir * gap } : { ...a, x: a.x + dir * gap };
  }
  return a;
}

/** The space kept between two arrow labels (px). */
const LABEL_GAP = 4;
/** The step and the reach of the search for a free slot along the edge (px). */
const SLOT_STEP = 6;
const SLOT_STEPS = 90;

/** Two boxes overlap (with `gap` px to spare). */
export function overlaps(a: ScreenRect, b: ScreenRect, gap = LABEL_GAP): boolean {
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
}

/**
 * The nearest spot along the arrow's screen edge where `free` holds – the side towards the centre of the
 * edge first – within `margin` of the corners; the arrow itself when it is free or no spot is.
 */
function slideAlongEdge(arrow: EdgeArrow, view: { width: number; height: number }, margin: number, free: (a: EdgeArrow) => boolean): EdgeArrow {
  if (free(arrow)) return arrow;
  const side = Math.min(arrow.x, view.width - arrow.x) <= Math.min(arrow.y, view.height - arrow.y);
  const length = side ? view.height : view.width;
  const at = side ? arrow.y : arrow.x;
  const toCentre = at < length / 2 ? 1 : -1;
  for (let k = 1; k <= SLOT_STEPS; k++) {
    for (const dir of [toCentre, -toCentre]) {
      const v = at + dir * k * SLOT_STEP;
      if (v < margin || v > length - margin) continue;
      const c = side ? { ...arrow, y: v } : { ...arrow, x: v };
      if (free(c)) return c;
    }
  }
  return arrow;
}

/** The first spot from the arrow into the screen (away from its edge) where `free` holds; else the arrow. */
function slideInward(arrow: EdgeArrow, view: { width: number; height: number }, free: (a: EdgeArrow) => boolean): EdgeArrow {
  const side = Math.min(arrow.x, view.width - arrow.x) <= Math.min(arrow.y, view.height - arrow.y);
  const dir = side ? (arrow.x < view.width / 2 ? 1 : -1) : arrow.y < view.height / 2 ? 1 : -1;
  for (let k = 1; k <= SLOT_STEPS; k++) {
    const c = side ? { ...arrow, x: arrow.x + dir * k * SLOT_STEP } : { ...arrow, y: arrow.y + dir * k * SLOT_STEP };
    if (free(c)) return c;
  }
  return arrow;
}

/** How far an arrow's label reaches from its head towards the centre (EdgeArrowLayer: ~150 × 30 px). */
const LABEL_REACH = { x: 80, y: 20 };
/** How far an arrow's head and label reach sideways from its tip (px): the top-centre zone is grown by it. */
const TOP_CENTRE_PAD = 150;

/**
 * The flight HUD's panels (console, radar with the scanner, the top-left navigation and objectives
 * bands with the event chips under them, the credits with the controls help top right, the radio
 * panel on the left) as screen rects. All but the bottom corners come from Hud's measurements
 * (`zones`, hudZones.ts) and are grown by an arrow label's reach, so a label at the edge does not run
 * over the objectives band, a chip, the radio or the help.
 */
export function flightHudRects(view: { width: number; height: number }, zones: HudZones = currentHudZones()): ScreenRect[] {
  const tl = topLeftZone(zones);
  const rects: ScreenRect[] = [
    { x: 0, y: view.height - consoleZone(zones).height, width: consoleZone(zones).width, height: consoleZone(zones).height },
    { x: view.width - BOTTOM_RIGHT_ZONE.width, y: view.height - BOTTOM_RIGHT_ZONE.height, width: BOTTOM_RIGHT_ZONE.width, height: BOTTOM_RIGHT_ZONE.height },
    { x: 0, y: 0, width: tl.width + LABEL_REACH.x, height: tl.height + LABEL_REACH.y },
  ];
  const tr = zones.topRight;
  if (tr.width > 0 && tr.height > 0) {
    rects.push({ x: view.width - tr.width - LABEL_REACH.x, y: 0, width: tr.width + LABEL_REACH.x, height: tr.height + LABEL_REACH.y });
  }
  const beside = chipsBesideZone(zones);
  if (beside) rects.push({ x: 0, y: beside.y - LABEL_REACH.y, width: beside.width + LABEL_REACH.x, height: beside.height + 2 * LABEL_REACH.y });
  const top = zones.topCentre;
  if (top) rects.push({ x: top.x - TOP_CENTRE_PAD, y: 0, width: top.width + 2 * TOP_CENTRE_PAD, height: top.y + top.height + LABEL_REACH.y });
  if (zones.training) rects.push(zones.training);
  const radio = zones.log;
  if (radio) {
    rects.push({ x: 0, y: radio.y - LABEL_REACH.y, width: radio.x + radio.width + LABEL_REACH.x, height: radio.height + 2 * LABEL_REACH.y });
  }
  return rects;
}

/** Goal arrow (Hud.tsx, hud.css): head ±22 px, the label 1rem bold at ~9 px a character plus 24 px padding, 34 px high. */
const GOAL_HEAD_HALF = 22;
const GOAL_LABEL_H = 34;
const goalLabelWidth = (label: string | undefined): number => 9 * (label?.length ?? 24) + 24;

/**
 * Where the goal arrow's label centre sits relative to the arrow's tip (px): towards the screen centre,
 * far enough that the plate clears the 44 px head also when the arrow points straight along the edge
 * (the offset includes the plate's half width, scaled by cos; diagonal arrows may still touch the head's bounding box).
 */
export function goalLabelOffset(angle: number, label: string | undefined): { x: number; y: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: -c * (GOAL_HEAD_HALF + 10 + goalLabelWidth(label) / 2),
    y: -s * (GOAL_HEAD_HALF + 10 + (GOAL_LABEL_H / 2) * Math.abs(s)),
  };
}

/**
 * The station or goal arrow of the HUD (Hud.tsx: the head, the label beside it towards the centre,
 * ~7 px per character; `goal`: the bolder goal arrow, see `goalLabelOffset`) – the box it takes on screen.
 */
export function hudArrowFootprint(arrow: EdgeArrow & { label?: string }, goal = false): ScreenRect {
  if (goal) {
    const o = goalLabelOffset(arrow.angle, arrow.label);
    const w = goalLabelWidth(arrow.label);
    const left = Math.min(arrow.x - GOAL_HEAD_HALF, arrow.x + o.x - w / 2);
    const right = Math.max(arrow.x + GOAL_HEAD_HALF, arrow.x + o.x + w / 2);
    const top = Math.min(arrow.y - GOAL_HEAD_HALF, arrow.y + o.y - GOAL_LABEL_H / 2);
    const bottom = Math.max(arrow.y + GOAL_HEAD_HALF, arrow.y + o.y + GOAL_LABEL_H / 2);
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
  const c = Math.cos(arrow.angle);
  const lx = arrow.x - c * (34 + 72 * Math.abs(c));
  const ly = arrow.y - Math.sin(arrow.angle) * 32;
  const half = 20 + 3.5 * (arrow.label?.length ?? 24);
  const left = Math.min(arrow.x - 22, lx - half);
  const right = Math.max(arrow.x + 22, lx + half);
  const top = Math.min(arrow.y - 22, ly - 13);
  const bottom = Math.max(arrow.y + 22, ly + 13);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * `hudArrowFootprint` grown by a navigation arrow label's reach – the route, note, convoy and relay
 * arrows (`navArrows`) slide off it like off a panel, so two arrows never stack (M4d).
 */
export function hudArrowRect(arrow: EdgeArrow & { label?: string }, goal = false): ScreenRect {
  const b = hudArrowFootprint(arrow, goal);
  return { x: b.x - LABEL_REACH.x, y: b.y - LABEL_REACH.y, width: b.width + 2 * LABEL_REACH.x, height: b.height + 2 * LABEL_REACH.y };
}

/** The bottom corners hold the console (left, measured by Hud: it grows with its rows) and the radar (right) – the arrow moves above them. */
const consoleZone = (zones: HudZones): { width: number; height: number } => zones.console ?? CONSOLE_ZONE_DEFAULT;
/** The radar, the scanner widget left of it (M3.5b) and the K chip above that. */
const RADAR_ZONE = BOTTOM_RIGHT_ZONE;
/** The radar legend pinned above the radar while the controls help is open (radarLegend.css). */
const LEGEND_ZONE = { width: 330, top: 400, bottom: 200 };
/** Half the height of the station / goal arrow with its label beside it (px). */
const ARROW_HALF = 22;


/**
 * An arrow on the top edge under the threat band / the radio line (top centre): slides along the edge to the
 * side nearer to it, the other side when that lands on the top-left stack or the credits, else below the band.
 */
function avoidTopCentre(a: EdgeArrow, view: { width: number }, zones: HudZones, tl: { width: number; height: number }): EdgeArrow {
  const z = zones.topCentre;
  if (!z) return a;
  const left = z.x - TOP_CENTRE_PAD;
  const right = z.x + z.width + TOP_CENTRE_PAD;
  if (a.y > z.y + z.height + 40 || a.x < left || a.x > right) return a;
  const tr = zones.topRight;
  const candidates = [left, right].sort((p, q) => Math.abs(p - a.x) - Math.abs(q - a.x));
  for (const x of candidates) {
    const inTl = x < tl.width && a.y < tl.height;
    const inTr = tr.width > 0 && a.y < tr.height && x > view.width - tr.width;
    if (x > 0 && !inTl && !inTr) return { ...a, x };
  }
  return { ...a, y: z.y + z.height + 24 };
}

/** An arrow plate reaches this far along the edge from its tip (the goal's label is ~180 px wide). */
const TRAINING_PAD = 110;

/**
 * An arrow on the bottom edge under the training panel: slides along the edge to the side nearer to it
 * (the console and radar rules then lift it off their corners).
 */
function avoidTraining(a: EdgeArrow, view: { width: number }, zones: HudZones): EdgeArrow {
  const z = zones.training;
  if (!z || a.y < z.y - ARROW_HALF) return a;
  const left = z.x - TRAINING_PAD;
  const right = z.x + z.width + TRAINING_PAD;
  if (a.x < left || a.x > right) return a;
  const candidates = [left, right].filter((x) => x > 0 && x < view.width).sort((p, q) => Math.abs(p - a.x) - Math.abs(q - a.x));
  return candidates[0] === undefined ? { ...a, y: z.y - ARROW_HALF - 4 } : { ...a, x: candidates[0] };
}

/**
 * Moves the station or goal arrow (Hud) off the HUD panels: above the console, below the top-left
 * block (the navigation stack and the event chips – moving right would hit the toast in the centre),
 * above the radio panel (or right of it when the left column is full), above the radar, beside the
 * credits and the help, beside the pinned radar legend.
 */
export function avoidHudPanels(arrow: EdgeArrow, view: { width: number; height: number }, helpOpen: boolean, zones: HudZones = currentHudZones()): EdgeArrow {
  const tl = topLeftZone(zones);
  const console = consoleZone(zones);
  let a = avoidTraining(arrow, view, zones);
  let left = false;
  if (a.x < console.width && a.y > view.height - console.height) {
    a = { ...a, y: view.height - console.height };
    left = true;
  } else if (a.x < tl.width && a.y < tl.height) {
    a = { ...a, y: tl.height + 24 };
    left = true;
  }
  const radio = zones.log;
  if (radio && a.x < radio.x + radio.width && a.y > radio.y - ARROW_HALF && a.y < radio.y + radio.height + ARROW_HALF) {
    const above = radio.y - ARROW_HALF - 4;
    a = above >= tl.height + 24 ? { ...a, y: above } : { ...a, x: radio.x + radio.width + 24 };
    left = true;
  }
  if (left) return a;
  a = avoidTopCentre(a, view, zones, tl);
  if (a.x > view.width - RADAR_ZONE.width && a.y > view.height - RADAR_ZONE.height) a = { ...a, y: view.height - RADAR_ZONE.height };
  // on the top edge: left of the credits and the help; on the right edge: below them
  const tr = zones.topRight;
  if (a.x > view.width - tr.width && a.y < tr.height) {
    a = a.y < 80 ? { ...a, x: view.width - tr.width - 24 } : { ...a, y: tr.height + 24 };
  }
  // the pinned radar legend: beside it, towards the centre (also after the moves above landed on it)
  if (helpOpen && a.x > view.width - LEGEND_ZONE.width && a.y > view.height - LEGEND_ZONE.top && a.y < view.height - LEGEND_ZONE.bottom) {
    a = { ...a, x: view.width - LEGEND_ZONE.width - 24 };
  }
  return a;
}

/**
 * The goal arrow's head (±22 px) and its label extend past the tip that `avoidHudPanels` put on a
 * corner zone's border: lifts the arrow until its plate (`hudArrowFootprint`) is above the console and
 * the radar block.
 */
function liftOffCorners(arrow: EdgeArrow & { label: string }, view: { width: number; height: number }, zones: HudZones): EdgeArrow {
  const console = consoleZone(zones);
  const corners: ScreenRect[] = [
    { x: 0, y: view.height - console.height, width: console.width, height: console.height },
    { x: view.width - RADAR_ZONE.width, y: view.height - RADAR_ZONE.height, width: RADAR_ZONE.width, height: RADAR_ZONE.height },
  ];
  let a: EdgeArrow = arrow;
  for (const zone of corners) {
    const plate = hudArrowFootprint({ ...a, label: arrow.label }, true);
    if (overlaps(plate, zone, 0)) a = { ...a, y: a.y - (plate.y + plate.height - zone.y) - 4 };
  }
  return a;
}

/**
 * The station and the goal arrow of the HUD placed together: each off the HUD panels (`avoidHudPanels`),
 * and the goal arrow slid along its edge off the station arrow and its label when the two would stack.
 */
export function placeHudArrows<A extends EdgeArrow & { label: string }>(
  station: A | null | undefined,
  goal: A | null | undefined,
  view: { width: number; height: number },
  helpOpen: boolean,
  zones: HudZones = currentHudZones(),
): { station: A | null; goal: A | null } {
  const s = station ? { ...station, ...avoidHudPanels(station, view, helpOpen, zones) } : null;
  let g = goal ? { ...goal, ...avoidHudPanels(goal, view, helpOpen, zones) } : null;
  if (s && g) {
    const taken = hudArrowFootprint(s);
    const label = g.label;
    // a candidate counts where the panels put it (moving off a panel may land it back on the station)
    const settle = (a: EdgeArrow): EdgeArrow => avoidHudPanels(a, view, helpOpen, zones);
    const free = (a: EdgeArrow) => !overlaps(hudArrowFootprint({ ...settle(a), label }, true), taken);
    let slid = slideAlongEdge(g, view, ARROW_HALF, free);
    // no free spot along the edge (a full left column: every spot settles beside the radio panel) – the
    // goal arrow steps into the screen past the station arrow's label instead
    if (!free(slid)) slid = slideInward(g, view, free);
    g = { ...g, ...settle(slid) };
  }
  // the goal's head and label reach past the arrow's tip: lift the whole plate clear of the corners
  if (g) g = { ...g, ...liftOffCorners(g, view, zones) };
  return { station: s, goal: g };
}

// ───────────── grouping by direction (hostile pirates, R2) ─────────────

export interface EdgeArrowGroup<T> extends EdgeArrow {
  /** Items in this arrow, the leading (highest priority) one first. */
  items: T[];
  /** Angular width of a merged pack (rad) – drawn as an arc; 0 = a single arrow. */
  span: number;
}

export interface EdgeGroupOptions {
  margin: number;
  avoid?: readonly ScreenRect[];
  /** This many items in a similar direction merge into one arc (R2: 4). */
  mergeAt?: number;
  /** Directions closer than this (rad) belong to one pack. */
  mergeAngle?: number;
}

export const MERGE_AT = 4;
export const MERGE_ANGLE = 0.42;
/** A merged pack's arc spans at least this much (rad), so a tight pack still reads as an arc. */
const MIN_ARC_SPAN = 0.3;
const TAU = Math.PI * 2;
const wrap = (a: number): number => ((a % TAU) + TAU) % TAU;

/** Size and opacity by proximity (0 = far at the edge of interest, 1 = next to the ship). */
export function proximityStyle(proximity: number): { scale: number; opacity: number } {
  const p = Math.min(1, Math.max(0, proximity));
  return { scale: 0.85 + 0.5 * p, opacity: 0.55 + 0.45 * p };
}

/**
 * Groups directions (rad) that follow each other with gaps ≤ `maxGap`, around the full circle.
 * Returns groups of indices into `angles`.
 */
export function clusterAngles(angles: readonly number[], maxGap: number): number[][] {
  if (angles.length === 0) return [];
  const order = angles.map((a, i) => ({ a: wrap(a), i })).sort((p, q) => p.a - q.a);
  const groups: { a: number; i: number }[][] = [[order[0]!]];
  for (let k = 1; k < order.length; k++) {
    const cur = order[k]!;
    const group = groups[groups.length - 1]!;
    if (cur.a - group[group.length - 1]!.a <= maxGap) group.push(cur);
    else groups.push([cur]);
  }
  // the first and the last group touch across 0 / 2π
  if (groups.length > 1) {
    const first = groups[0]!;
    const last = groups[groups.length - 1]!;
    if (first[0]!.a + TAU - last[last.length - 1]!.a <= maxGap) {
      groups[0] = [...last, ...first];
      groups.pop();
    }
  }
  return groups.map((g) => g.map((p) => p.i));
}

const meanAngle = (angles: readonly number[]): number =>
  Math.atan2(
    angles.reduce((s, a) => s + Math.sin(a), 0),
    angles.reduce((s, a) => s + Math.cos(a), 0),
  );

/**
 * Edge arrows for the points out of view, one each – unless `mergeAt` or more point a similar way:
 * then one arrow at their mean direction with `span` > 0 (an arc with the count).
 */
export function groupEdgeArrows<T>(inputs: readonly EdgeArrowInput<T>[], view: { width: number; height: number }, opts: EdgeGroupOptions): EdgeArrowGroup<T>[] {
  const { margin, mergeAt = MERGE_AT, mergeAngle = MERGE_ANGLE } = opts;
  const off: { input: EdgeArrowInput<T>; arrow: EdgeArrow }[] = [];
  for (const input of inputs) {
    const arrow = edgeArrow(input.screen, view, margin);
    if (arrow) off.push({ input, arrow });
  }
  const place = (a: EdgeArrow): EdgeArrow => (opts.avoid?.length ? slideOutOf(a, opts.avoid, view) : a);
  const byPriority = (list: typeof off) => [...list].sort((a, b) => (b.input.priority ?? 0) - (a.input.priority ?? 0)).map((m) => m.input.item);
  const out: EdgeArrowGroup<T>[] = [];
  for (const group of clusterAngles(
    off.map((o) => o.arrow.angle),
    mergeAngle,
  )) {
    const members = group.map((i) => off[i]!);
    if (members.length >= mergeAt) {
      const angle = meanAngle(members.map((m) => m.arrow.angle));
      const spread = Math.max(...members.map((m) => Math.abs(Math.atan2(Math.sin(m.arrow.angle - angle), Math.cos(m.arrow.angle - angle)))));
      // the edge point in the mean direction
      const far = Math.max(view.width, view.height) * 4;
      const at = edgeArrow({ x: view.width / 2 + Math.cos(angle) * far, y: view.height / 2 + Math.sin(angle) * far }, view, margin)!;
      out.push({ ...place(at), items: byPriority(members), span: Math.max(MIN_ARC_SPAN, 2 * spread) });
    } else {
      for (const m of members) out.push({ ...place(m.arrow), items: [m.input.item], span: 0 });
    }
  }
  return out;
}

// ───────────── navigation marks in flight (M4d T11: route, map notes, convoys, Guild relays) ─────────────

export type NavMarkKind = 'route' | 'note' | 'convoy' | 'relay';

/** A thing the flight HUD points to while it is out of view (and pins while it is in view). */
export interface NavMark {
  key: string;
  kind: NavMarkKind;
  /**
   * The label's head: "Trasa" / the route's label, the note's text (the player's own text – drawn as
   * plain text, never translated), "Convoy", "Guild relay".
   */
  title: string;
  /** The note's icon (kind `note`). */
  icon?: NoteIcon;
  /** A powered Guild relay (kind `relay`). */
  lit?: boolean;
  /** Distance from the ship (u). */
  distance: number;
  /** Time to get there (s) – the route's ETA; null / absent = not shown. */
  seconds?: number | null;
}

/** Which wins a slot and leads a merged arrow: the planned route, then the relay, convoys, notes. */
export const NAV_MARK_PRIORITY: Readonly<Record<NavMarkKind, number>> = { route: 3, relay: 2, convoy: 1, note: 0 };

/** The colour of the map notes' icons (public/assets/ui/icons/note_*.svg, art README §2.7.26). */
const NOTE_COLORS: Readonly<Record<NoteIcon, string>> = {
  star: PALETTE.fuel,
  warning: PALETTE.warn,
  ore: PALETTE.hullShade,
  pirate: PALETTE.bad,
  flag: PALETTE.glow,
};

/** The chevron's colour: the route in the live glow, a note in its icon's colour, a convoy neutral blue, the relay Guild orange. */
export function navMarkColor(m: Pick<NavMark, 'kind' | 'icon'>): string {
  switch (m.kind) {
    case 'route':
      return PALETTE.glow;
    case 'note':
      return NOTE_COLORS[m.icon ?? 'flag'];
    case 'convoy':
      return PALETTE.shield;
    case 'relay':
      return PALETTE.trim;
  }
}

/** The icon beside the label (an asset path under public/), null = the chevron alone (the route). */
export function navMarkIcon(m: Pick<NavMark, 'kind' | 'icon' | 'lit'>): string | null {
  switch (m.kind) {
    case 'route':
      return null;
    case 'note':
      return `assets/ui/icons/note_${m.icon ?? 'flag'}.svg`;
    case 'convoy':
      return 'assets/ui/icons/convoy.svg';
    case 'relay':
      return m.lit ? 'assets/ui/icons/guild_relay_lit.svg' : 'assets/ui/icons/guild_relay.svg';
  }
}

/** "Trasa · 1 240 j · 0:52", "rich Ti · 820 j". */
export function navMarkLabel(m: Pick<NavMark, 'title' | 'distance' | 'seconds'>): string {
  const parts = [m.title, `${formatInt(Math.max(0, Math.round(m.distance)))} ${tx().units.unit}`];
  if (m.seconds !== undefined && m.seconds !== null && Number.isFinite(m.seconds)) parts.push(formatClock(m.seconds));
  return parts.filter((p) => p.length > 0).join(' · ');
}

export interface NavArrowOptions {
  /** HUD panels to slide out of (default: `flightHudRects(view)`). */
  avoid?: readonly ScreenRect[];
  /** Boxes the arrow labels keep clear of – the station and goal arrows (`hudArrowFootprint`). */
  obstacles?: readonly ScreenRect[];
  /** At most this many edge arrows (default 5); pins in view are not limited. */
  max?: number;
}

/** Average width of a label character (px; --af-fs-xs bold) and the label text's cap (16em, edgeArrows.css). */
const NAV_CHAR_PX = 6.2;
const NAV_TEXT_MAX = 176;

/**
 * The box a navigation edge arrow takes on screen: the chevron and the label plate towards the centre
 * (EdgeArrowLayer `labelOffset`; padding, the icon, a note's room for a merge count, the text).
 */
export function navArrowFootprint(arrow: EdgeArrow, m: NavMark, label: string = navMarkLabel(m)): ScreenRect {
  const c = Math.cos(arrow.angle);
  const lx = arrow.x - c * (26 + 58 * Math.abs(c));
  const ly = arrow.y - Math.sin(arrow.angle) * 26;
  const text = Math.min(NAV_TEXT_MAX, label.length * NAV_CHAR_PX);
  const half = (14 + (navMarkIcon(m) ? 19 : 0) + (m.kind === 'note' ? 22 : 0) + text) / 2;
  const left = Math.min(arrow.x - 11, lx - half);
  const right = Math.max(arrow.x + 11, lx + half);
  const top = Math.min(arrow.y - 11, ly - 9);
  const bottom = Math.max(arrow.y + 11, ly + 9);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Arrows sit this far from the screen edge (px); a mark nearer the edge than this is out of view. */
const NAV_MARGIN = 40;
const inView = (p: { x: number; y: number; behind?: boolean }, view: { width: number; height: number }): boolean =>
  !p.behind && p.x >= NAV_MARGIN && p.x <= view.width - NAV_MARGIN && p.y >= NAV_MARGIN && p.y <= view.height - NAV_MARGIN;

/**
 * Edge arrows to the navigation marks out of view (higher priority first, the nearer first within a
 * kind; notes within 46 px merge with a count, other marks step aside along the edge) and pins at the marks in view (in front of the camera,
 * inside the view by `NAV_MARGIN`). `screen` = the mark's projected point (the renderer's projection).
 */
export function navArrows(inputs: readonly EdgeArrowInput<NavMark>[], view: { width: number; height: number }, opts: NavArrowOptions = {}): EdgeArrowMark[] {
  // each mark's label once (the slot search measures a footprint per tried spot – up to 180 a mark)
  const labels = new Map<NavMark, string>();
  const labelOf = (m: NavMark): string => {
    let label = labels.get(m);
    if (label === undefined) labels.set(m, (label = navMarkLabel(m)));
    return label;
  };
  const prioritised = inputs.map((i) => ({ ...i, priority: NAV_MARK_PRIORITY[i.item.kind] * 1e6 - Math.min(i.item.distance, 1e6 - 1) }));
  const out: EdgeArrowMark[] = [];
  for (const i of prioritised) {
    const p = i.screen;
    if (!inView(p, view)) continue;
    const icon = navMarkIcon(i.item);
    out.push({
      key: `pin:${i.item.key}`,
      x: p.x,
      y: p.y,
      angle: 0,
      color: navMarkColor(i.item),
      label: labelOf(i.item),
      ...(icon ? { icon } : {}),
      pin: true,
      testId: `nav-pin-${i.item.kind}`,
    });
  }
  const placed = placeEdgeArrows(
    prioritised.filter((i) => !inView(i.screen, view)),
    view,
    // only notes merge (with notes, a count on the leading one); the route, a relay or a convoy keeps its
    // own arrow, its label clear of the other labels and of the station and goal arrows
    {
      margin: NAV_MARGIN,
      avoid: opts.avoid ?? flightHudRects(view),
      mergePx: 46,
      max: opts.max ?? 5,
      mergeIf: (lead, item) => lead.kind === 'note' && item.kind === 'note',
      footprint: (a, m) => navArrowFootprint(a, m, labelOf(m)),
      ...(opts.obstacles ? { obstacles: opts.obstacles } : {}),
    },
  );
  for (const a of placed) {
    const m = a.items[0]!;
    const icon = navMarkIcon(m);
    out.push({
      key: m.key,
      x: a.x,
      y: a.y,
      angle: a.angle,
      color: navMarkColor(m),
      label: labelOf(m),
      count: a.items.length,
      small: m.kind === 'note',
      ...(icon ? { icon } : {}),
      testId: `nav-arrow-${m.kind}`,
    });
  }
  return out;
}
