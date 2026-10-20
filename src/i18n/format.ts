// Numbers for the player in the current language through Intl.NumberFormat: Slovak "1 240,5"
// (non-breaking space, decimal comma), English "1,240.5". Units come from the text modules
// (`tx().units`). Negative numbers get a true minus sign (−) in both languages.
import { tx } from './index';
import { getLocale, type Locale } from './locale';
import { formatNumber } from './numberFormat';

// the text-free formatters live in numberFormat.ts (the text modules use them without an import cycle)
export { formatHullPoints, formatNumber } from './numberFormat';

/** Whole number with thousands separators: "1 240" / "1,240". */
export const formatInt = (value: number): string => formatNumber(value, 0);

/** One decimal place (amounts of material, prices): "12,5" / "12.5". */
export const formatAmount = (value: number): string => formatNumber(value, 1);

export const formatPrice = formatAmount;

/** Whole credits with the unit: "1 240 kr" / "1,240 cr". */
export const formatCredits = (value: number): string => `${formatNumber(value, 0)} ${tx().units.credits}`;

/** Between a number and "%": a non-breaking space in Slovak and German ("45 %"), nothing in English ("45%"). */
const PERCENT_GAP: Record<Locale, string> = { sk: ' ', en: '', de: ' ' };

/**
 * A percentage already multiplied by 100: "45 %" / "45%" (up to `decimals` places, trailing zeros
 * dropped). `signed` adds "+" to positive values (negative ones always get "−").
 */
export function formatPercent(value: number, decimals = 0, signed = false, locale: Locale = getLocale()): string {
  const text = formatNumber(value, decimals, true, locale);
  return `${signed && text !== '0' && value > 0 ? '+' : ''}${text}${PERCENT_GAP[locale]}%`;
}

/** A multiplier: "×1,5" / "×1.5" (up to `decimals` places, trailing zeros dropped). */
export const formatFactor = (value: number, decimals = 2): string => `×${formatNumber(value, decimals, true)}`;
