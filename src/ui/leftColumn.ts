// The flight HUD's left column (M4d UI polish): under the top-left stack hang the event chips and the
// Guild status chips (top down), above the console the radio panel or the comm log (bottom up). On a
// short screen (1280 × 720) with a full column they would meet, so the column folds step by step until
// it ends clear of the radio: first the Guild chips' hint lines go (the objectives band says the same),
// then their hull / step rows (the head keeps the state), then the Guild chips move up beside the event
// chips, and last (the chips back under each other) the radio panel steps aside, right of the column.
// The comm log (L) never steps aside – it gets the room down to its minimum height.
// Pure decisions here; Hud applies them to the DOM (`data-left-fit`, `--gs-left`, `--cm-left` on the UI root).

/**
 * How far the column folds: full chips, no hints, no rows, rows folded with the Guild chips beside the
 * event chips, rows folded with the radio aside.
 */
export const LEFT_FITS = ['full', 'hints', 'rows', 'beside', 'aside'] as const;
export type LeftFit = (typeof LEFT_FITS)[number];

/** Free space between the chip column and the radio (px). */
export const LEFT_FIT_GAP = 8;
/** The comm log keeps at least this height (px) – the chips fold for it, it does not step aside. */
export const LOG_MIN_HEIGHT = 220;

export interface FitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Does the chip column end clear of the radio (both rects, px; null = nothing there)? */
export function columnClear(column: FitRect | null, radio: FitRect | null, gap = LEFT_FIT_GAP): boolean {
  if (!column || !radio) return true;
  const apart = column.x + column.width + gap <= radio.x || radio.x + radio.width + gap <= column.x;
  return apart || column.y + column.height + gap <= radio.y || radio.y + radio.height + gap <= column.y;
}

/**
 * The first fit (from `full`) at which `clear(fit)` holds – `clear` applies the fit and measures – or
 * the last allowed one. `aside` only for the radio panel (`allowAside`), never for the comm log.
 */
export function fitLeftColumn(clear: (fit: LeftFit) => boolean, allowAside: boolean, from: LeftFit = 'full'): LeftFit {
  const fits: readonly LeftFit[] = allowAside ? LEFT_FITS : LEFT_FITS.filter((f) => f !== 'aside');
  const start = Math.max(0, fits.indexOf(from));
  for (let i = start; i < fits.length; i++) {
    if (clear(fits[i]!)) return fits[i]!;
  }
  return fits[fits.length - 1]!;
}

/**
 * The rect the comm log claims: from its bottom up by its minimum height (its max-height follows the
 * column's bottom, so its own box would always look clear).
 */
export function logClaim(log: FitRect): FitRect {
  return { x: log.x, y: log.y + log.height - LOG_MIN_HEIGHT, width: log.width, height: LOG_MIN_HEIGHT };
}
