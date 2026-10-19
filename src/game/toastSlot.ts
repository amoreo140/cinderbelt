// The game's single toast: one short message at a time, for a few seconds. A toast shown from a text
// builder (not a finished text) says the same again in the new language after a live language switch,
// like the radio's `retext` (comms/queue.ts); a finished text stays as it was shown.
import { getLocale, type Locale } from '../i18n';
import type { Toast, ToastKind } from '../ui/GameUi';

/** A finished text, or a builder called now and again after a language switch. */
export type ToastText = string | (() => string);

/**
 * A toast text builder that answers `text` (built just now) first and later rebuilds it with `again`
 * in the current language (`undefined` / null keeps `text`) – for sources whose text is already built.
 */
export function rebuilt(text: string, again: () => string | null | undefined): () => string {
  let first = true;
  return () => {
    if (first) {
      first = false;
      return text;
    }
    return again() ?? text;
  };
}

export class ToastSlot {
  private message: (Toast & { until: number; build: (() => string) | null; locale: Locale }) | null = null;

  /** Shows a toast until `clock + seconds` (replacing the one on screen). */
  show(text: ToastText, kind: ToastKind, seconds: number, clock: number): void {
    const build = typeof text === 'function' ? text : null;
    this.message = { text: build ? build() : (text as string), kind, until: clock + seconds, build, locale: getLocale() };
  }

  /** The toast on screen at `clock` (null = none), in the current language when it has a builder. */
  current(clock: number): Toast | null {
    const m = this.message;
    if (!m || m.until <= clock) return null;
    const locale = getLocale();
    if (m.build && m.locale !== locale) {
      m.text = m.build();
      m.locale = locale;
    }
    return { text: m.text, kind: m.kind };
  }
}
