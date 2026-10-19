// Pure formatting of the HUD event chips (M4b plan T9): the countdown, which chips fit, the direction
// arrow as a clock bearing and the tone's lamp. The view model (`EventChipItem`) comes ordered by
// severity from the game layer (T7); the component only lays it out.
import type { EventTone } from '../../data/events';
import type { EventChipItem } from '../../game/sites/types';
import { tx } from '../../i18n';

/** At most this many chips at once (DH §5.5: an ion storm + one more). */
export const MAX_CHIPS = 2;

/** "8 s" under a minute, "1:24", "1:02:05" from an hour; whole seconds rounded up, never negative. */
export function formatClock(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : 0;
  if (s < 60) return tx().world.hud.seconds(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The chip's time: the countdown to the end, "o 8 s" during the warning lead, "prebieha" without a timer. */
export function chipTime(chip: EventChipItem): string {
  const t = tx().world.hud;
  if (chip.secondsLeft === null) return t.ongoing;
  const clock = formatClock(chip.secondsLeft);
  return chip.pending ? t.in(clock) : t.left(clock);
}

/**
 * The chips to draw: the first `MAX_CHIPS` in the given (severity) order, but an ion storm always keeps
 * its place – it lasts minutes and changes how the ship flies, so it is the "storm + one more".
 */
export function visibleChips(chips: readonly EventChipItem[], max = MAX_CHIPS): EventChipItem[] {
  const head = chips.slice(0, max);
  const storm = chips.find((c) => c.kind === 'ionStorm');
  if (!storm || head.includes(storm) || max < 2) return head;
  return [...head.slice(0, max - 1), storm];
}

/** Degrees into [0, 360). */
export const normDeg = (deg: number): number => ((deg % 360) + 360) % 360;

/** The direction as a clock bearing: 12 = ahead, 3 = right (clockwise), 6 = behind. */
export function clockHour(deg: number): number {
  const h = Math.round(normDeg(deg) / 30) % 12;
  return h === 0 ? 12 : h;
}

/** The lamp state of a tone. */
export const chipLamp = (tone: EventTone): 'info' | 'warn' | 'bad' => (tone === 'danger' ? 'bad' : tone);
