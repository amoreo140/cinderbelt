// The flight HUD's left column (M4d UI polish): under the top-left stack hang the event chips and the
// Guild status chips (top down), above the console the comm log (bottom up). On a short screen
// (1280 × 720) with a full column they would meet, so the column folds step by step until it ends clear
// of the log: first the Guild chips' hint lines go (the objectives band says the same), then their
// hull / step rows (the head keeps the state), then the Guild chips move up beside the event chips.
// The log (L) gets the room down to its minimum height.
// Pure decisions here; Hud applies them to the DOM (`data-left-fit`, `--gs-left` on the UI root).

/** How far the column folds: full chips, no hints, no rows, rows folded with the Guild chips beside the event chips. */
export const LEFT_FITS = ['full', 'hints', 'rows', 'beside'] as const;
export type LeftFit = (typeof LEFT_FITS)[number];

/** Free space between the chip column and the log (px). */
export const LEFT_FIT_GAP = 8;
/** The comm log keeps at least this height (px) – the chips fold for it, it does not step aside. */
export const LOG_MIN_HEIGHT = 220;

export interface FitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Does the chip column end clear of the log's claim (both rects, px; null = nothing there)? */
export function columnClear(column: FitRect | null, claim: FitRect | null, gap = LEFT_FIT_GAP): boolean {
  if (!column || !claim) return true;
  const apart = column.x + column.width + gap <= claim.x || claim.x + claim.width + gap <= column.x;
  return apart || column.y + column.height + gap <= claim.y || claim.y + claim.height + gap <= column.y;
}

/** The first fit (from `full`) at which `clear(fit)` holds – `clear` applies the fit and measures – or the last one. */
export function fitLeftColumn(clear: (fit: LeftFit) => boolean, from: LeftFit = 'full'): LeftFit {
  const start = Math.max(0, LEFT_FITS.indexOf(from));
  for (let i = start; i < LEFT_FITS.length; i++) {
    if (clear(LEFT_FITS[i]!)) return LEFT_FITS[i]!;
  }
  return LEFT_FITS[LEFT_FITS.length - 1]!;
}

/**
 * The rect the comm log claims: from its bottom up by its minimum height (its max-height follows the
 * column's bottom, so its own box would always look clear).
 */
export function logClaim(log: FitRect): FitRect {
  return { x: log.x, y: log.y + log.height - LOG_MIN_HEIGHT, width: log.width, height: LOG_MIN_HEIGHT };
}
