// Hull points in ½ steps (SL2 E2): one formatter for every hull point text.
import { describe, expect, it } from 'vitest';
import { formatHullPoints, formatNumber } from './format';
import { textsFor } from './index';

describe('formatHullPoints', () => {
  it('whole and half points', () => {
    expect(formatHullPoints(31, 'sk')).toBe('31');
    expect(formatHullPoints(31.5, 'sk')).toBe('31½');
    expect(formatHullPoints(31.5, 'en')).toBe('31½');
    expect(formatHullPoints(0.5, 'en')).toBe('½');
    expect(formatHullPoints(0, 'sk')).toBe('0');
    expect(formatHullPoints(48, 'en')).toBe('48');
  });

  it('rounds to the nearest half and signs negative deltas with a true minus', () => {
    expect(formatHullPoints(31.26, 'sk')).toBe('31½');
    expect(formatHullPoints(31.74, 'sk')).toBe('31½');
    expect(formatHullPoints(31.76, 'sk')).toBe('32');
    expect(formatHullPoints(-0.5, 'sk')).toBe('−½');
    expect(formatHullPoints(-1.5, 'en')).toBe('−1½');
    expect(formatHullPoints(-0.1, 'en')).toBe('0');
  });

  it('thousands follow the locale', () => {
    expect(formatHullPoints(1240.5, 'sk')).toBe('1 240½');
    expect(formatHullPoints(1240.5, 'en')).toBe('1,240½');
  });

  it('the hull point texts print halves', () => {
    const sk = textsFor('sk');
    const en = textsFor('en');
    expect(sk.shipyard.ui.hullPoints(31.5, 48)).toBe('31½ / 48 b');
    expect(en.shipyard.ui.hullPoints(31.5, 48)).toBe('31½ / 48 pts');
    expect(sk.shipyard.ui.hullNoBudget(2.5)).toBe('2½ b');
    expect(en.shipyard.ui.hullNoBudget(2.5)).toBe('2½ pts');
    expect(sk.fleet.hangar.hullPoints(31.5, 48)).toBe('31½ / 48 b');
    expect(en.fleet.hangar.hullPoints(31.5, 48)).toBe('31½ / 48 pt');
    expect(sk.fleet.templates.hullPoints(12.5)).toBe('trup 12½ b');
    expect(en.fleet.templates.hullPoints(12.5)).toBe('hull 12½ pt');
  });
});

describe('formatNumber (cached texts)', () => {
  it('gives the same text on a repeat and keeps locales, decimals and trimming apart', () => {
    for (let round = 0; round < 2; round++) {
      expect(formatNumber(1240.5, 1, false, 'sk')).toBe('1 240,5');
      expect(formatNumber(1240.5, 1, false, 'en')).toBe('1,240.5');
      expect(formatNumber(12, 2, false, 'en')).toBe('12.00');
      expect(formatNumber(12, 2, true, 'en')).toBe('12');
      expect(formatNumber(12, 0, false, 'en')).toBe('12');
      expect(formatNumber(-3.04, 1, false, 'sk')).toBe('−3,0');
      expect(formatNumber(-0.04, 1, false, 'sk')).toBe('0,0');
    }
  });

  it('matches Intl for many values after the cache starts over', () => {
    for (let i = 0; i < 5000; i++) {
      const v = i * 7.31;
      expect(formatNumber(v, 1, true, 'en')).toBe(new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(Math.round(v * 10 + 1e-9) / 10));
    }
  });
});
