// The flight goal's mark: a ring + label on the goal while it is on screen, an edge arrow while it is
// not, and the bearing from the ship to the goal (for the training panel's "name · 97 u, bearing").
// Pure (no DOM): Game feeds it projected points, Hud draws the result.
import { tx } from '../i18n';
import { formatInt } from './format';
import { overlaps, type ScreenRect } from './edgeArrows';
import { edgeArrow, type EdgeArrow } from './stationHud';

/** The goal is "on screen" this far inside the window edge; nearer to it, or outside, it gets the edge arrow. */
export const GOAL_MARGIN = 64;

export type GoalMark = { kind: 'onScreen'; x: number; y: number } | ({ kind: 'edge' } & EdgeArrow);

/** What the HUD shows for the current goal. */
export interface GoalHud {
  /** The goal's name (no distance – the UI appends it). */
  label: string;
  /** World units from the ship to the goal. */
  distance: number;
  /** Direction from the ship to the goal on screen (rad, screen space: 0 = right, π/2 = down). */
  bearing: number;
  mark: GoalMark;
}

/**
 * The goal's mark from its projected screen point, the ship's screen point and the view size.
 * `bearing` points from the ship to the goal; a goal behind the camera is mirrored (as `edgeArrow` does).
 */
export function goalMark(
  goal: { x: number; y: number; behind?: boolean },
  ship: { x: number; y: number },
  view: { width: number; height: number },
): { mark: GoalMark; bearing: number } {
  let dx = goal.x - ship.x;
  let dy = goal.y - ship.y;
  if (goal.behind) {
    dx = 0 - dx;
    dy = 0 - dy;
  }
  const bearing = Math.atan2(dy, dx);
  const edge = edgeArrow(goal, view, GOAL_MARGIN);
  return { mark: edge ? { kind: 'edge', ...edge } : { kind: 'onScreen', x: goal.x, y: goal.y }, bearing };
}

const px = Math.round;

/** Same goal on screen: its name, the distance in whole units, the mark to whole pixels / ~0.5 degrees. */
export function sameGoalHud(a: GoalHud, b: GoalHud): boolean {
  if (a === b) return true;
  if (a.label !== b.label || px(a.distance) !== px(b.distance) || a.mark.kind !== b.mark.kind) return false;
  if (px(a.mark.x) !== px(b.mark.x) || px(a.mark.y) !== px(b.mark.y)) return false;
  return a.mark.kind !== 'edge' || b.mark.kind !== 'edge' || Math.round(a.mark.angle * (360 / Math.PI)) === Math.round(b.mark.angle * (360 / Math.PI));
}

/** "Name · 97 u" – the goal's text for the plain-text uses (the edge arrow's label). */
export function goalText(g: Pick<GoalHud, 'label' | 'distance'>): string {
  return `${g.label} · ${formatInt(Math.round(g.distance))} ${tx().hud.distanceUnit}`;
}

/** The goal's edge arrow in the shape `placeHudArrows` and the navigation arrows place around (null on screen). */
export function goalEdgeArrow(g: GoalHud): (EdgeArrow & { label: string }) | null {
  const m = g.mark;
  return m.kind === 'edge' ? { x: m.x, y: m.y, angle: m.angle, label: goalText(g) } : null;
}

/** The goal ring's diameter (px; hud.css .hud-goal-ring, 4.5rem). */
const GOAL_RING = 72;

const goalLabelRect = (x: number, y: number, chars: number, left: boolean): ScreenRect => {
  // 1rem bold, ~9 px a character, with the plate's padding
  const width = chars * 9 + 28;
  return { x: left ? x - GOAL_RING / 2 - 8 - width : x + GOAL_RING / 2 + 8, y: y - 17, width, height: 34 };
};

/**
 * Should the goal's label sit left of its ring? Yes when on the right it would run under a fixed panel
 * (`rects`, e.g. `flightHudRects`) or off the screen, and the left side is free.
 */
export function goalLabelFlips(x: number, y: number, chars: number, view: { width: number; height: number }, rects: readonly ScreenRect[]): boolean {
  const hits = (left: boolean): boolean => {
    const r = goalLabelRect(x, y, chars, left);
    return r.x < 0 || r.x + r.width > view.width || rects.some((z) => overlaps(r, z, 0));
  };
  return hits(false) && !hits(true);
}
