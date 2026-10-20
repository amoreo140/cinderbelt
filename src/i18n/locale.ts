// The current UI language: Slovak, English or German. The game and the UI read texts through `tx()` (index.ts),
// which follows this setting; the simulation never sees it (it emits ids and events, text is chosen
// in game/ui). Switching is live: listeners re-render what does not redraw on its own. Only the active
// language's texts are loaded – a switch to the other one waits for its download (index.ts).

export type Locale = 'sk' | 'en' | 'de';

export const LOCALES: readonly Locale[] = ['sk', 'en', 'de'];

/** Language names in their own language (a language picker never translates them). */
export const LOCALE_NAMES: Record<Locale, string> = { sk: 'Slovenčina', en: 'English', de: 'Deutsch' };

/** BCP 47 tags for Intl (numbers, plurals). */
export const INTL_TAGS: Record<Locale, string> = { sk: 'sk-SK', en: 'en-GB', de: 'de-DE' };

export const isLocale = (value: unknown): value is Locale => value === 'sk' || value === 'en' || value === 'de';

let current: Locale = 'sk';
/** The language of the last setLocale call (a slower earlier download must not switch back to its language). */
let requested: Locale = current;
const listeners = new Set<(locale: Locale) => void>();
/** Loads a language's texts (index.ts): null = already loaded. */
let loader: (locale: Locale) => Promise<unknown> | null = () => null;

export function getLocale(): Locale {
  return current;
}

/** Called once by index.ts: setLocale waits for the language's texts through it. */
export function setLocaleLoader(load: (locale: Locale) => Promise<unknown> | null): void {
  loader = load;
}

function apply(locale: Locale): void {
  // The page starts as lang="en" while `current` starts as 'sk': always sync the attribute, even when the
  // language does not change (a Slovak boot).
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  if (locale === current) return;
  current = locale;
  for (const fn of [...listeners]) fn(locale);
}

/**
 * Switches the language once its texts are loaded (at once when they already are – the switch is then
 * synchronous); listeners run only when it really changes. A failed download keeps the current language.
 */
export function setLocale(locale: Locale): Promise<void> {
  requested = locale;
  const pending = loader(locale);
  if (!pending) {
    apply(locale);
    return Promise.resolve();
  }
  return pending.then(
    () => {
      if (requested === locale) apply(locale);
    },
    (e: unknown) => console.warn(`Language "${locale}" failed to load`, e),
  );
}

/** Calls `fn` after every language switch; returns the unsubscribe function. */
export function onLocaleChange(fn: (locale: Locale) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
