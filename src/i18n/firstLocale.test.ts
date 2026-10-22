import { describe, expect, it, vi } from 'vitest';
import { bootLanguage, BOOT_TEXTS } from './bootTexts';
import { applyFirstLocale, localeAttempts, type LocaleBackend } from './firstLocale';
import { LOCALES, type Locale } from './locale';

function backend(failing: Locale[], failures: Partial<Record<Locale, number>> = {}) {
  const calls: Locale[] = [];
  const set: Locale[] = [];
  const b: LocaleBackend = {
    async load(l) {
      calls.push(l);
      if (failing.includes(l)) throw new Error(`${l} offline`);
      const left = failures[l] ?? 0;
      if (left > 0) {
        failures[l] = left - 1;
        throw new Error(`${l} flaky`);
      }
    },
    async set(l) {
      set.push(l);
    },
  };
  return { b, calls, set };
}

describe('first language', () => {
  it('orders the attempts: the wanted language twice, then English, then the rest', () => {
    expect(localeAttempts('sk')).toEqual(['sk', 'sk', 'en', 'de']);
    expect(localeAttempts('de')).toEqual(['de', 'de', 'en', 'sk']);
    expect(localeAttempts('en')).toEqual(['en', 'en', 'sk', 'de']);
  });

  it('retries a failed download once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { b, calls, set } = backend([], { sk: 1 });
    expect(await applyFirstLocale('sk', b, 0)).toBe('sk');
    expect(calls).toEqual(['sk', 'sk']);
    expect(set).toEqual(['sk']);
  });

  it('falls back to another language when the wanted one does not load', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { b, set } = backend(['sk']);
    expect(await applyFirstLocale('sk', b, 0)).toBe('en');
    expect(set).toEqual(['en']);
  });

  it('rejects when no language loads', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { b, set } = backend([...LOCALES]);
    await expect(applyFirstLocale('de', b, 0)).rejects.toThrow('offline');
    expect(set).toEqual([]);
  });
});

describe('boot error texts', () => {
  it('has the three texts in every language', () => {
    for (const l of LOCALES) for (const v of Object.values(BOOT_TEXTS[l])) expect(v.length).toBeGreaterThan(3);
  });

  it('picks the stored language, then the browser language, then English', () => {
    expect(bootLanguage('de', 'sk-SK')).toBe('de');
    expect(bootLanguage(undefined, 'sk-SK')).toBe('sk');
    expect(bootLanguage('xx', 'fr-FR')).toBe('en');
    expect(bootLanguage(null, null)).toBe('en');
  });
});
