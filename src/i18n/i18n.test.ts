import { afterEach, describe, expect, it } from 'vitest';
import { CAPTAIN_NICKNAME_COUNT } from '../data/captains';
import { formatAmount, formatCredits, formatFactor, formatInt, formatNumber, formatPercent } from './format';
import { getLocale, LOCALES, onLocaleChange, setLocale, setLocaleLoader, textsFor, tx } from './index';
import { enPlural, plural, skPlural } from './plural';
import { formatGrade } from '../ui/format';

afterEach(() => setLocale('sk'));

describe('locale', () => {
  it('starts in Slovak and tx() follows setLocale', () => {
    expect(getLocale()).toBe('sk');
    expect(tx()).toBe(textsFor('sk'));
    setLocale('en');
    expect(tx()).toBe(textsFor('en'));
    expect(tx().docking.readout.title).toBe('Docking');
  });

  it('notifies listeners only on a real change and unsubscribes', () => {
    const seen: string[] = [];
    const off = onLocaleChange((l) => seen.push(l));
    setLocale('sk');
    setLocale('en');
    setLocale('en');
    off();
    setLocale('sk');
    expect(seen).toEqual(['en']);
  });

  it('switches only once the language is loaded; the last request wins, a failed one keeps the language', async () => {
    const pending = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
    setLocaleLoader((locale) => new Promise<void>((resolve, reject) => pending.set(locale, { resolve, reject })));
    const seen: string[] = [];
    const off = onLocaleChange((l) => seen.push(l));
    try {
      const toEn = setLocale('en');
      expect(getLocale()).toBe('sk');
      const backToSk = setLocale('sk');
      pending.get('en')!.resolve();
      await toEn;
      // the newer request (Slovak) wins over the slower English download
      expect(getLocale()).toBe('sk');
      pending.get('sk')!.resolve();
      await backToSk;
      expect(seen).toEqual([]);

      const warn = console.warn;
      console.warn = () => {};
      const failed = setLocale('en');
      pending.get('en')!.reject(new Error('offline'));
      await failed;
      console.warn = warn;
      expect(getLocale()).toBe('sk');

      const ok = setLocale('en');
      pending.get('en')!.resolve();
      await ok;
      expect(getLocale()).toBe('en');
      expect(seen).toEqual(['en']);
    } finally {
      off();
      // both languages are registered in tests (allTexts.ts): nothing to wait for
      setLocaleLoader(() => null);
    }
  });
});

describe('plural', () => {
  it('Slovak: 1 / 2–4 / the rest (0, 5+, fractions)', () => {
    const f = (n: number) => skPlural(n, 'diel', 'diely', 'dielov');
    expect([0, 1, 2, 4, 5, 11, 22, 1.5].map(f)).toEqual(['dielov', 'diel', 'diely', 'diely', 'dielov', 'dielov', 'dielov', 'dielov']);
  });

  it('English: 1 / the rest', () => {
    expect([0, 1, 2, 1.5].map((n) => enPlural(n, 'part', 'parts'))).toEqual(['parts', 'part', 'parts', 'parts']);
    expect(plural('en', 3, { one: 'x', other: 'y' })).toBe('y');
  });
});

describe('number format', () => {
  it('Slovak: non-breaking space thousands, decimal comma, true minus', () => {
    expect(formatInt(1234567)).toBe('1 234 567');
    expect(formatAmount(52.34)).toBe('52,3');
    expect(formatAmount(0.05)).toBe('0,1');
    expect(formatCredits(-300)).toBe('−300 kr');
    expect(formatNumber(12.5, 2, true)).toBe('12,5');
    expect(formatFactor(1.25)).toBe('×1,25');
    expect(formatFactor(2)).toBe('×2');
    expect(formatPercent(45)).toBe('45 %');
    expect(formatPercent(7.5, 1, true)).toBe('+7,5 %');
    expect(formatPercent(-30, 0, true)).toBe('−30 %');
    expect(formatGrade(1.45)).toBe('145 %');
  });

  it('English: comma thousands, decimal point', () => {
    setLocale('en');
    expect(formatInt(1234567)).toBe('1,234,567');
    expect(formatAmount(52.34)).toBe('52.3');
    expect(formatFactor(0.5)).toBe('×0.5');
    expect(formatCredits(1240)).toBe(`1,240 ${textsFor('en').units.credits}`);
    expect(formatPercent(45)).toBe('45%');
    expect(formatPercent(25, 0, true)).toBe('+25%');
    expect(formatPercent(0, 0, true)).toBe('0%');
    expect(formatGrade(0.9)).toBe('90%');
  });
});

/** Every static string of a text tree (functions are skipped). */
function strings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (node && typeof node === 'object') for (const v of Object.values(node)) strings(v, out);
  return out;
}

describe('English consistency', () => {
  it('no space before a percent sign', () => {
    expect(strings(textsFor('en')).filter((s) => /\d[  ]%/.test(s))).toEqual([]);
  });

  it('one name for the Forge-smith Echo', () => {
    const en = textsFor('en');
    expect(en.comms.speakers.echoNamed).toBe(en.discovery.scanKinds.echo);
    expect(strings(en).filter((s) => /Echo of the Forge/.test(s))).toEqual([]);
  });

  it('part variant names match the explanations', () => {
    for (const locale of ['en', 'de'] as const) {
      const t = textsFor(locale);
      for (const [id, name] of Object.entries(t.discovery.variants)) {
        expect(t.partInfo.variants[id as keyof typeof t.partInfo.variants].startsWith(`${name}:`), `${locale} ${id}`).toBe(true);
      }
    }
  });
});

describe('content lists', () => {
  it('captain nicknames: one per sim index, all different, in every language', () => {
    for (const l of LOCALES) {
      const nicks = textsFor(l).goals.captains.nicknames;
      expect(nicks.length, l).toBe(CAPTAIN_NICKNAME_COUNT);
      expect(new Set(nicks).size, l).toBe(nicks.length);
    }
  });

  it('help: the laser and journal line indices point at those lines', () => {
    for (const l of LOCALES) {
      const h = textsFor(l).help;
      expect(h.lines[h.laserLine], l).toBeDefined();
      expect(h.lines[h.journalLine], l).toBeDefined();
    }
    expect(textsFor('sk').help.lines[textsFor('sk').help.laserLine]).toContain('laser');
    expect(textsFor('sk').help.lines[textsFor('sk').help.journalLine]).toMatch(/^J /);
  });
});

describe('part variant names', () => {
  it('every variant has its own name in both languages (survey radar ≠ scout cockpit)', () => {
    for (const locale of LOCALES) {
      const names = Object.values(textsFor(locale).discovery.variants).map((n) => n.toLowerCase());
      expect(new Set(names).size, locale).toBe(names.length);
    }
  });
});
