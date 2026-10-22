// The few texts of the boot error screen (src/bootError.ts). They cannot come from the normal language
// chunks – the screen is shown precisely when those did not load – so they are a tiny static module
// (kept out of the texts.ts typing on purpose: no import of any other i18n file but the locale type).
import { isLocale, type Locale } from './locale';

export interface BootTexts {
  title: string;
  body: string;
  reload: string;
}

export const BOOT_TEXTS: Record<Locale, BootTexts> = {
  sk: {
    title: 'Hra sa nespustila',
    body: 'Nepodarilo sa načítať súbory hry. Skontroluj pripojenie; ak je dostupná nová verzia, pomôže aj načítanie stránky znova.',
    reload: 'Načítať znova',
  },
  en: {
    title: 'The game did not start',
    body: 'The game files could not be loaded. Check your connection; if a new version is out, reloading the page helps too.',
    reload: 'Reload',
  },
  de: {
    title: 'Das Spiel wurde nicht gestartet',
    body: 'Die Spieldateien konnten nicht geladen werden. Prüf deine Verbindung; falls es eine neue Version gibt, hilft auch ein Neuladen der Seite.',
    reload: 'Neu laden',
  },
};

/** The boot screen's language: the stored setting, else the browser's language, else English. */
export function bootLanguage(stored: unknown, browser: string | null | undefined): Locale {
  if (isLocale(stored)) return stored;
  const prefix = (browser ?? '').toLowerCase().slice(0, 2);
  return isLocale(prefix) ? prefix : 'en';
}
