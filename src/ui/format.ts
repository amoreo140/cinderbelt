// Number formatting for the UI lives in i18n/format.ts (the current language decides separators and
// units); this module keeps the old import path.
import { formatPercent } from '../i18n/format';

export { formatAmount, formatCredits, formatFactor, formatInt, formatNumber, formatPercent, formatPrice } from '../i18n/format';

/** Ore grade in whole percent: "145 %" / "145%" (the UI adds the words). */
export const formatGrade = (grade: number): string => formatPercent(Math.round(grade * 100));
