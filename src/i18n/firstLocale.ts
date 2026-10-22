// The language before the first screen: a download that fails (offline, a deploy replaced the chunk files)
// is retried once, then another language that loads is used instead; only when none loads does the boot fail.
import { LOCALES, type Locale } from './locale';

export interface LocaleBackend {
  /** Downloads a language's texts (rejects on failure). */
  load(locale: Locale): Promise<unknown>;
  /** Switches to a language whose texts are loaded. */
  set(locale: Locale): Promise<void>;
}

/** Order of the attempts: the wanted language twice (one retry), then English, then the rest. */
export function localeAttempts(want: Locale): Locale[] {
  return [want, want, ...(['en', ...LOCALES] as Locale[]).filter((l, i, all) => l !== want && all.indexOf(l) === i)];
}

/** Applies the first language that loads; resolves with it, rejects (last error) when no language does. */
export async function applyFirstLocale(want: Locale, backend: LocaleBackend, retryDelayMs = 400): Promise<Locale> {
  let error: unknown = new Error('No language');
  const attempts = localeAttempts(want);
  for (const [i, locale] of attempts.entries()) {
    try {
      await backend.load(locale);
      await backend.set(locale);
      return locale;
    } catch (e) {
      error = e;
      console.warn(`Language "${locale}" failed to load`, e);
      if (i === 0 && retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
  throw error;
}
