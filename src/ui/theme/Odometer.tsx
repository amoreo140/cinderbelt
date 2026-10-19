// Odometer (DH §10.3, plan M4a §2): the `Credits` hull label whose changed digits roll to the new
// value in one clamp step (`--af-dur-clamp`, `--af-ease-clamp` – no overshoot, no counting up).
// Reduced motion (the system setting or the game's) = the new value at once.
//
// Cheap on the flight HUD (10 redraws a second): the component skips its render unless a prop or
// the UI language changed, and only a changed digit gets a new key (= a new span and animation).
import { Component } from 'preact';
import { tx } from '../../i18n';
import { getLocale } from '../../i18n/locale';
import { formatInt } from '../format';
import { shallowEqual } from '../pure';
import { cellsText, rollCells, rollDir, type OdoCell } from './odometerMath';

export interface OdometerProps {
  value: number;
  /**
   * Formats the value (default: a whole number with thousands separators). Pass a stable function
   * (module level), a new one every render makes the HUD re-render the odometer.
   */
  format?: (value: number) => string;
  /** Unit after the number (chip only): default the credits unit ("kr" / "cr"), null = none. */
  unit?: string | null;
  /** `chip` = the credits hull label; `bare` = only the rolling text (inside a Readout, a table cell…). */
  variant?: 'chip' | 'bare';
  testId?: string;
}

export class Odometer extends Component<OdometerProps> {
  private cells: OdoCell[] | null = null;
  private value = 0;
  private gen = 0;
  private lang = getLocale();

  shouldComponentUpdate(next: OdometerProps): boolean {
    return getLocale() !== this.lang || !shallowEqual(this.props, next);
  }

  render({ value, format = formatInt, unit, variant = 'chip', testId }: OdometerProps) {
    const lang = getLocale();
    const text = format(value);
    if (this.cells === null || lang !== this.lang) {
      // first render or another language (other separators): the value just stands there
      this.cells = rollCells(null, text, this.gen, null);
    } else if (text !== cellsText(this.cells)) {
      this.cells = rollCells(this.cells, text, ++this.gen, rollDir(this.value, value));
    }
    this.value = value;
    this.lang = lang;
    const digits = (
      <span class="af-odo" data-testid={variant === 'bare' ? testId : undefined}>
        {this.cells.map((c) => (
          <span key={`${c.pos}:${c.gen}`} class="af-odo-cell">
            <span class="af-odo-ch" data-from={c.from ?? undefined} data-dir={c.dir ?? undefined}>
              {c.ch}
            </span>
          </span>
        ))}
      </span>
    );
    const u = unit === undefined ? tx().units.credits : unit;
    if (variant === 'bare') return digits;
    return (
      <span class="af-credits af-odometer" data-testid={testId} aria-live="off">
        {digits}
        {u !== null && (
          <>
            {' '}
            <span class="af-credits-unit">{u}</span>
          </>
        )}
      </span>
    );
  }
}
