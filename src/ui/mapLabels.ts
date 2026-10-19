// Map label layout (R5 of the 2026-10-16 readability research): labels are placed by priority
// (my ship > objectives > stations > places of interest > sector names > ring names > ore grades;
// zoomed out, the sector names go above the stations). Each label tries
// a few sides around its anchor, is pushed inside the map so it is never clipped, and is dropped when
// every side collides with a more important label or another object's marker – except the labels
// that must stay (my ship, objectives), which take the least crowded side. Pure functions, tested
// in mapLabels.test.ts; the map measures the text and draws what comes back.

/**
 * Lower = more important. `hover` = the object under the cursor or pinned by a click (a comet with its
 * next pass, M4b) – the player asked for it, so it goes right after the objectives.
 */
export const LABEL_PRIORITY = { ship: 0, objective: 1, hover: 1.5, station: 2, poi: 3, sector: 3.5, ring: 4, grade: 5 } as const;

export type LabelSide = 'right' | 'left' | 'above' | 'below';

export interface LabelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A marker on the map that labels should not cover (the label with the same id may). */
export interface LabelObstacle extends LabelRect {
  id: string;
}

export interface LabelRequest {
  id: string;
  priority: number;
  /** The point the label belongs to (canvas px). */
  anchor: { x: number; y: number };
  /** Text box size (canvas px). */
  w: number;
  h: number;
  /** Distance from the anchor (about the marker radius). */
  gap: number;
  /** A second, larger distance tried when every side at `gap` collides; default gap + FAR_STEP. */
  farGap?: number;
  /** Other points the label may stand at (a ring name anywhere along the visible arc), tried in order. */
  alternates?: readonly { x: number; y: number }[];
  /** Placement order to try; default right, left, above, below. */
  sides?: readonly LabelSide[];
  /** Shown even when every side collides (my ship, objectives). */
  keep?: boolean;
}

export interface PlacedLabel extends LabelRect {
  id: string;
  side: LabelSide;
}

const DEFAULT_SIDES: readonly LabelSide[] = ['right', 'left', 'above', 'below'];
/** Free space kept between two labels / a label and a marker. */
const PAD = 2;
/** How much further out the second ring of candidate positions is (clears a marker at the same spot). */
export const FAR_STEP = 14;

export function rectsOverlap(a: LabelRect, b: LabelRect, pad = 0): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

function overlapArea(a: LabelRect, b: LabelRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The box of `r` on `side` of `at` at distance `gap`, written into `out` (no allocation per candidate). */
function sideRect(out: LabelRect, r: LabelRequest, at: { x: number; y: number }, gap: number, side: LabelSide): void {
  const { x, y } = at;
  out.w = r.w;
  out.h = r.h;
  switch (side) {
    case 'right':
      out.x = x + gap;
      out.y = y - r.h / 2;
      return;
    case 'left':
      out.x = x - gap - r.w;
      out.y = y - r.h / 2;
      return;
    case 'above':
      out.x = x - r.w / 2;
      out.y = y - gap - r.h;
      return;
    case 'below':
      out.x = x - r.w / 2;
      out.y = y + gap;
      return;
  }
}

/** Pushes the rectangle inside the bounds in place; false when it does not fit at all. */
function clampInside(rect: LabelRect, bounds: { w: number; h: number }): boolean {
  if (rect.w > bounds.w || rect.h > bounds.h) return false;
  rect.x = Math.min(bounds.w - rect.w, Math.max(0, rect.x));
  rect.y = Math.min(bounds.h - rect.h, Math.max(0, rect.y));
  return true;
}

/**
 * Places the labels by priority (ties keep the input order). Returns the shown labels in placement
 * order, each fully inside `bounds`. A label takes the first candidate position – each anchor (the
 * anchor, then the alternates), near then far, each side – that collides with nothing placed before it
 * and no other object's marker. Runs 10× a second on the map: no allocation per candidate.
 */
export function layoutLabels(requests: readonly LabelRequest[], bounds: { w: number; h: number }, obstacles: readonly LabelObstacle[] = []): PlacedLabel[] {
  const order = requests.map((_, i) => i).sort((a, b) => requests[a]!.priority - requests[b]!.priority || a - b);
  const placed: PlacedLabel[] = [];
  const rect: LabelRect = { x: 0, y: 0, w: 0, h: 0 };
  for (const index of order) {
    const r = requests[index]!;
    const sides = r.sides ?? DEFAULT_SIDES;
    const alternates = r.alternates ?? [];
    let best: PlacedLabel | null = null;
    let bestCost = Infinity;
    search: for (let a = -1; a < alternates.length; a++) {
      const at = a < 0 ? r.anchor : alternates[a]!;
      for (let g = 0; g < 2; g++) {
        const gap = g === 0 ? r.gap : (r.farGap ?? r.gap + FAR_STEP);
        for (const side of sides) {
          sideRect(rect, r, at, gap, side);
          if (!clampInside(rect, bounds)) {
            if (!r.keep) continue;
            rect.x = Math.max(0, rect.x);
            rect.y = Math.max(0, rect.y);
          }
          // the cost of the overlaps with the labels placed so far, then the other objects' markers
          let cost = 0;
          for (const b of placed) {
            if (rectsOverlap(rect, b, PAD)) cost += 1 + overlapArea(rect, b);
          }
          for (const b of obstacles) {
            if (b.id !== r.id && rectsOverlap(rect, b, PAD)) cost += 1 + overlapArea(rect, b);
          }
          if (cost === 0) {
            best = { id: r.id, side, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
            break search;
          }
          if (r.keep && cost < bestCost) {
            bestCost = cost;
            best = { id: r.id, side, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
          }
        }
      }
    }
    if (best) placed.push(best);
  }
  return placed;
}

/**
 * A point outside the view (closer than `margin` to the edge counts as outside) pinned to the view's
 * edge, inset by `inset`, in its direction from the centre – where the map draws an edge arrow. Null
 * when the point is inside the view.
 */
export function edgeArrow(x: number, y: number, w: number, h: number, margin: number, inset = margin): { x: number; y: number; angle: number } | null {
  if (x >= margin && y >= margin && x <= w - margin && y <= h - margin) return null;
  const angle = Math.atan2(y - h / 2, x - w / 2);
  const c = Math.abs(Math.cos(angle)) || 1e-6;
  const s = Math.abs(Math.sin(angle)) || 1e-6;
  const k = Math.min((w / 2 - inset) / c, (h / 2 - inset) / s);
  return { x: w / 2 + Math.cos(angle) * k, y: h / 2 + Math.sin(angle) * k, angle };
}
