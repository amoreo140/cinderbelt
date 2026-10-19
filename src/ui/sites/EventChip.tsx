// HUD event chips (M4b plan T9): small "Hull language" (Jazyk trupu) plates under the top-left navigation stack with the
// event's glyph, name, a countdown in tabular figures and a direction arrow (micrometeor stream, ambush
// bearing); at most 2 (storm + one more). They sit below the stack Hud's NavStack measures
// (`--hud-tl-bottom`), so they never overlap NAV_ZONE (hudZones.ts) and they stay left of the sector
// entry notice. Data: `EventChipData` (src/game/sites/types.ts, built by the game layer).
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { DirectorEventKind } from '../../data/events';
import type { EventChipData, EventChipItem } from '../../game/sites/types';
import { tx } from '../../i18n';
import { Lamp } from '../theme';
import { pure } from '../pure';
import { sameChip, sameDial } from '../hudMemo';
import { getLocale } from '../../i18n/locale';
import { chipLamp, chipTime, clockHour, normDeg, visibleChips } from './chipFormat';
import './sites.css';

/** Kind glyphs, drawn on a 16 × 16 grid with the current colour (memoised: the kind never changes). */
const KindGlyph = pure(function KindGlyphView({ kind }: { kind: DirectorEventKind }) {
  switch (kind) {
    case 'micrometeors':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 6 L8 3 M3 11 L11 7 M7 14 L13 11" />
          <circle cx="9.5" cy="2.5" r="1.4" class="fill" />
          <circle cx="12.5" cy="6.5" r="1.4" class="fill" />
          <circle cx="14.2" cy="10.5" r="1.2" class="fill" />
        </svg>
      );
    case 'ambush':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 1.5 V5 M8 11 V14.5 M1.5 8 H5 M11 8 H14.5" />
          <circle cx="8" cy="8" r="4.6" />
          <circle cx="8" cy="8" r="1.4" class="fill" />
        </svg>
      );
    case 'ionStorm':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M9.5 1.5 L4 9 H8 L6.5 14.5 L12 7 H8 Z" class="fill" />
        </svg>
      );
    case 'cometFlyby':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="11" cy="5" r="2.6" class="fill" />
          <path d="M9 7.2 L2 14 M10.6 8 L5 14.5 M8.2 6.4 L1.5 11" />
        </svg>
      );
    case 'convoyFlyby':
      // M4d: a trader with its tanker in line (the radar convoy glyph), bow to the right
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6.2 4.6 H12.6 L15 8 L12.6 11.4 H6.2 Z" class="fill" />
          <path d="M1 6.4 H3.6 L4.6 8 L3.6 9.6 H1 Z" class="fill" />
        </svg>
      );
    case 'distress':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="9" r="1.5" class="fill" />
          <path d="M5 6 A4.2 4.2 0 0 0 5 12 M11 6 A4.2 4.2 0 0 1 11 12 M2.8 3.8 A7.4 7.4 0 0 0 2.8 14.2 M13.2 3.8 A7.4 7.4 0 0 1 13.2 14.2" />
        </svg>
      );
  }
});

/**
 * A dial's direction, written straight into its elements (O13): the dial turns with the ship at nearly
 * every redraw, and a re-render of its plate for that diffed the whole chip. The game UI hands every
 * chip's direction over at each redraw (`updateEventDials`); the dial's markup stays still.
 */
class LiveDial {
  private deg: number | null = null;
  private span: HTMLElement | null = null;
  private arrow: SVGGElement | null = null;
  /** What the elements show: the direction (written when it looks different) and the language. */
  private shown: { deg: number; locale: string } = { deg: NaN, locale: '' };

  set(deg: number): void {
    this.deg = deg;
    this.write();
  }

  readonly bind = (span: HTMLElement | null): void => {
    this.span = span;
    this.arrow = span?.querySelector<SVGGElement>('.ev-dir-arrow') ?? null;
    this.shown = { deg: NaN, locale: '' };
    this.write();
  };

  private write(): void {
    const { span, arrow, deg } = this;
    if (!span || !arrow || deg === null) return;
    const locale = getLocale();
    if (locale === this.shown.locale && sameDial({ deg: this.shown.deg }, { deg })) return;
    this.shown = { deg, locale };
    const label = `${tx().world.hud.direction}: ${tx().world.hud.clock(clockHour(deg))}`;
    span.setAttribute('aria-label', label);
    span.setAttribute('title', label);
    span.setAttribute('data-deg', String(Math.round(normDeg(deg))));
    arrow.style.transform = `rotate(${normDeg(deg)}deg)`;
  }
}

/** The live dials by chip key (one HUD at a time; a chip's dial lives while its event is listed). */
const dials = new Map<string, LiveDial>();

const dialOf = (key: string): LiveDial => {
  let dial = dials.get(key);
  if (!dial) dials.set(key, (dial = new LiveDial()));
  return dial;
};

/** Every chip's direction for its dial (the game UI, at each redraw – before the chips draw). */
export function updateEventDials(chips: readonly EventChipItem[]): void {
  for (const c of chips) if (c.dirDeg !== null) dialOf(c.key).set(c.dirDeg);
  if (dials.size > chips.length) for (const key of dials.keys()) if (!chips.some((c) => c.key === key && c.dirDeg !== null)) dials.delete(key);
}

/** The direction dial: an arrow from the centre, 0° = up = the ship's bow, clockwise (written by its LiveDial). */
const DirectionDial = pure(function DirectionDialView({ chipKey, deg }: { chipKey: string; deg: number }) {
  const dial = dialOf(chipKey);
  dial.set(deg);
  return (
    <span ref={dial.bind} class="ev-dir" role="img" data-testid="event-chip-dir">
      <svg viewBox="-10 -10 20 20" aria-hidden="true">
        <circle r="8.6" class="ev-dir-ring" />
        <path d="M0 -8.6 V-6.4 M8.6 0 H6.4 M0 8.6 V6.4 M-8.6 0 H-6.4" class="ev-dir-tick" />
        <g class="ev-dir-arrow">
          <path d="M0 -7 L3.2 -1.4 H1 V5 H-1 V-1.4 H-3.2 Z" />
        </g>
      </svg>
    </span>
  );
}, (a: { chipKey: string }, b: { chipKey: string }) => a.chipKey === b.chipKey);

/** One plate: redrawn only when it shows something else (hudMemo.ts: whole seconds, ~0.5° dial). */
const Chip = pure(function ChipView({ chip }: { chip: EventChipItem }) {
  const time = chipTime(chip);
  return (
    <div
      class={`ev-chip ev-chip--${chip.tone}${chip.pending ? ' is-pending' : ''}`}
      data-kind={chip.kind}
      data-testid={`event-chip-${chip.kind}`}
      role="listitem"
    >
      <Lamp state={chipLamp(chip.tone)} />
      <span class="ev-chip-icon">
        <KindGlyph kind={chip.kind} />
      </span>
      <span class="ev-chip-title">
        {chip.pending && <span class="af-sr-only">{tx().world.hud.warning}: </span>}
        {chip.title}
      </span>
      <span class={`ev-chip-time${chip.secondsLeft === null ? ' is-open' : ''}`} data-testid="event-chip-time">
        {time}
      </span>
      {chip.dirDeg !== null && <DirectionDial chipKey={chip.key} deg={chip.dirDeg} />}
    </div>
  );
}, (a: { chip: EventChipItem }, b: { chip: EventChipItem }) => sameChip(a.chip, b.chip));

/** Gap between the event chips and the Guild status chips under them (px, M4d). */
const CHIPS_GAP = 5;

/** `inline` = in the flow (UI kit) instead of under the HUD's top-left stack. */
export function EventChip({ chips, inline = false }: { chips: EventChipData; inline?: boolean }) {
  const shown = visibleChips(chips);
  const ref = useRef<HTMLDivElement>(null);
  const on = !inline && shown.length > 0;
  // M4d: the column's height (+ a gap) as `--ev-chips-h` on the UI root, so the Guild status chips
  // (guild.css) sit right under the event chips however many there are
  useLayoutEffect(() => {
    const el = ref.current;
    const root = el?.parentElement;
    if (!on || !el || !root) return;
    const publish = () => root.style.setProperty('--ev-chips-h', `${Math.round(el.getBoundingClientRect().height) + CHIPS_GAP}px`);
    publish();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(publish) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--ev-chips-h');
    };
  }, [on]);
  if (shown.length === 0) return null;
  return (
    <div ref={ref} class={`ev-chips${inline ? ' ev-chips--inline' : ''}`} role="list" aria-label={tx().world.hud.region} data-testid="event-chips">
      {shown.map((c) => (
        <Chip key={c.key} chip={c} />
      ))}
    </div>
  );
}
