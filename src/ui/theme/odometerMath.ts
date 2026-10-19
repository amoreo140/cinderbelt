// Digit-roll math of the `Odometer` (plan M4a §2 "Odometer", DH §10.3): which characters of a
// formatted number changed, what they roll from and in which direction. Pure, no DOM – the
// component keeps the previous cells and turns them into keyed spans.

/** Roll direction: `up` = the value grew (the new digit drops in from above), `down` = it shrank (rises from below). */
export type RollDir = 'up' | 'down';

/** One character position of the shown text. */
export interface OdoCell {
  /** Position from the right (0 = the last character) – stable while the number grows or shrinks. */
  pos: number;
  /** The character shown now. */
  ch: string;
  /** The character it rolls from ('' = the position was empty); null = no roll (first render). */
  from: string | null;
  dir: RollDir | null;
  /** Generation of the change that last touched this position – keys the span, so a change restarts its animation. */
  gen: number;
}

/** Direction of a change from `prev` to `next` (null = no change). */
export function rollDir(prev: number, next: number): RollDir | null {
  return next > prev ? 'up' : next < prev ? 'down' : null;
}

/**
 * Cells of `text` after `prev` (left to right). A position whose character changed rolls from its
 * old character with generation `gen`; an unchanged position keeps its previous cell object as it is
 * (same identity, its animation – finished or not – is left alone). `prev === null` = first render,
 * nothing rolls. Positions are aligned from the right, so units stay units when the number gets longer.
 */
export function rollCells(prev: readonly OdoCell[] | null, text: string, gen: number, dir: RollDir | null): OdoCell[] {
  const chars = [...text];
  const n = chars.length;
  const old = prev ?? [];
  const cells: OdoCell[] = new Array<OdoCell>(n);
  for (let i = 0; i < n; i++) {
    const pos = n - 1 - i;
    const ch = chars[i]!;
    const was = old.length - 1 - pos >= 0 ? old[old.length - 1 - pos]! : null;
    if (prev === null) cells[i] = { pos, ch, from: null, dir: null, gen: 0 };
    else if (was && was.ch === ch) cells[i] = was;
    else cells[i] = { pos, ch, from: was?.ch ?? '', dir, gen };
  }
  return cells;
}

/** The text the cells show (what a screen reader and `textContent` read). */
export const cellsText = (cells: readonly OdoCell[]): string => cells.map((c) => c.ch).join('');
