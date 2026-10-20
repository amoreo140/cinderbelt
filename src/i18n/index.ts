// The text accessor: `tx()` returns every text of the current language. Game, UI and render code read
// texts only through it and only when they need them (at render / event time) – never keep a text or a
// sub-object from module load, or a language switch would not reach it.
//
//   tx().hud.speed                 core texts (sk.ts / en.ts) sit at the top level
//   tx().pirates.toll.pay           the other modules under their name (skPirates.ts / enPirates.ts)
//
// Only the active language is loaded (audit 2026-10-17, P6/P10): each language is one bundle
// (textsSk.ts / textsEn.ts / textsDe.ts) fetched with `import()` the first time it is needed. `setLocale` (locale.ts)
// switches once the new bundle is in, so `tx()` stays synchronous and always has the current language.
// The boot awaits the first language before anything renders; tests and the UI kit register both
// languages up front (allTexts.ts).
//
// Adding a text module: write `skFoo.ts` with an exported interface and `enFoo.ts` / `deFoo.ts` typed by it,
// then add it to `Texts` (texts.ts) and every bundle (the parity test checks every pair).
import { getLocale, setLocaleLoader, type Locale } from './locale';
import type { Texts } from './texts';

export * from './locale';
export type { Texts, TextModule } from './texts';

const loaded: Partial<Record<Locale, Texts>> = {};
const loading: Partial<Record<Locale, Promise<Texts>>> = {};

const IMPORTS: Record<Locale, () => Promise<Texts>> = {
  sk: () => import('./textsSk').then((m) => m.skTexts),
  en: () => import('./textsEn').then((m) => m.enTexts),
  de: () => import('./textsDe').then((m) => m.deTexts),
};

/** Makes a language available without a download (tests, the UI kit – allTexts.ts). */
export function registerTexts(locale: Locale, texts: Texts): void {
  loaded[locale] = texts;
}

/** The texts of a language, downloaded once; a failed download can be retried by the next call. */
export function loadTexts(locale: Locale): Promise<Texts> {
  const ready = loaded[locale];
  if (ready) return Promise.resolve(ready);
  return (loading[locale] ??= IMPORTS[locale]().then(
    (texts) => {
      loaded[locale] = texts;
      return texts;
    },
    (e: unknown) => {
      delete loading[locale];
      throw e;
    },
  ));
}

// setLocale waits for the language's bundle; nothing to wait for once it is loaded
setLocaleLoader((locale) => (loaded[locale] ? null : loadTexts(locale)));

/** Every text of a loaded language (throws for a language that is not loaded yet). */
export function textsFor(locale: Locale): Texts {
  const texts = loaded[locale];
  if (!texts) throw new Error(`Texts of "${locale}" are not loaded yet (await loadTexts / setLocale first)`);
  return texts;
}

/** Every text of the current language (cheap – call it where the text is used). */
export function tx(): Texts {
  return textsFor(getLocale());
}
