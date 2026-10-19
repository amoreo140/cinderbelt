// The text-free core of i18n/format.ts: number formatting that needs only the locale, not the text
// modules. The text modules themselves (sk.ts, skFleet.ts, …) import from here – importing format.ts
// would close an import cycle through index.ts (format.ts reads `tx()` for units). Everyone else imports
// these functions from format.ts, which re-exports them.
import { getLocale, INTL_TAGS, type Locale } from './locale';

const formats = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: Locale, decimals: number, fixed: boolean): Intl.NumberFormat {
  const key = `${locale}:${decimals}:${fixed}`;
  let f = formats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(INTL_TAGS[locale], { minimumFractionDigits: fixed ? decimals : 0, maximumFractionDigits: decimals });
    formats.set(key, f);
  }
  return f;
}

/**
 * Recent texts by locale, decimals, trim and the rounded value. The HUD formats the same few hundred
 * numbers 10× per second and `Intl.NumberFormat.format` costs more than the lookup (perf audit
 * 2026-10-17, O12); the map starts over when it grows past `TEXT_CACHE_SIZE`.
 */
const texts = new Map<string, string>();
const TEXT_CACHE_SIZE = 4096;

/**
 * A number with `decimals` decimal places (rounded half up first, like the game always did).
 * `trim` drops trailing zeros ("12,5" and "12" instead of "12,50" and "12,00").
 */
export function formatNumber(value: number, decimals = 0, trim = false, locale: Locale = getLocale()): string {
  const scale = 10 ** decimals;
  const rounded = Math.round(Math.abs(value) * scale + 1e-9) / scale;
  const key = `${locale}${decimals}${trim ? 't' : 'f'}${rounded}`;
  let text = texts.get(key);
  if (text === undefined) {
    if (texts.size >= TEXT_CACHE_SIZE) texts.clear();
    text = numberFormat(locale, decimals, !trim).format(rounded);
    texts.set(key, text);
  }
  return value < 0 && rounded !== 0 ? `−${text}` : text;
}

/**
 * Hull points in ½ steps (SL2 E2 shapes cost ½ b): "31", "31½", "½", "−1½" (rounded to the nearest half).
 * Every text that prints hull points goes through it.
 */
export function formatHullPoints(value: number, locale: Locale = getLocale()): string {
  const halves = Math.round(Math.abs(value) * 2);
  const whole = Math.floor(halves / 2);
  const wholeText = formatNumber(whole, 0, false, locale);
  const text = halves % 2 === 0 ? wholeText : whole === 0 ? '½' : `${wholeText}½`;
  return value < 0 && halves !== 0 ? `−${text}` : text;
}
