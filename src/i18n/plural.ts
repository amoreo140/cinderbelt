// Plural forms through Intl.PluralRules. Text modules are written for one language, so they pick the
// helper of their own language (`skPlural` in sk*.ts, `enPlural` in en*.ts, `dePlural` in de*.ts); code that needs the form for
// the current language uses `plural(getLocale(), …)`.
import { INTL_TAGS, type Locale } from './locale';

/** Forms by CLDR category; `other` is required, the rest fall back to it. */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

const rules = new Map<Locale, Intl.PluralRules>();

export function pluralCategory(locale: Locale, n: number): Intl.LDMLPluralRule {
  let r = rules.get(locale);
  if (!r) {
    r = new Intl.PluralRules(INTL_TAGS[locale]);
    rules.set(locale, r);
  }
  return r.select(n);
}

export function plural(locale: Locale, n: number, forms: PluralForms): string {
  return forms[pluralCategory(locale, n)] ?? forms.other;
}

/** Slovak: 1 → `one` (diel), 2–4 → `few` (diely), 0, 5+ and fractions → `many` (dielov). */
export const skPlural = (n: number, one: string, few: string, many: string): string => plural('sk', n, { one, few, other: many });

/** English: 1 → `one` (part), everything else → `other` (parts). */
export const enPlural = (n: number, one: string, other: string): string => plural('en', n, { one, other });

/** German: 1 → `one` (Teil), everything else → `other` (Teile). */
export const dePlural = (n: number, one: string, other: string): string => plural('de', n, { one, other });
