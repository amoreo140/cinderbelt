import { describe, expect, it } from 'vitest';
import { crashReport, errorText, initialCrashSave, isBenignError, shouldEmergencySave, ToastThrottle } from './crash';

describe('emergency save decision', () => {
  it('saves only a saved game with a living ship and an intact simulation', () => {
    expect(shouldEmergencySave({ hasSession: true, dying: false, simIntact: true })).toBe(true);
    expect(shouldEmergencySave({ hasSession: false, dying: false, simIntact: true })).toBe(false);
    expect(shouldEmergencySave({ hasSession: true, dying: true, simIntact: true })).toBe(false);
    expect(shouldEmergencySave({ hasSession: true, dying: false, simIntact: false })).toBe(false);
  });

  it('tells an unsaved game from one that keeps its last save', () => {
    expect(initialCrashSave({ hasSession: false }, false)).toBe('unsaved');
    expect(initialCrashSave({ hasSession: true }, false)).toBe('kept');
    expect(initialCrashSave({ hasSession: true }, true)).toBe('saving');
  });
});

describe('crash report', () => {
  it('holds version, message and stack', () => {
    const e = new Error('boom');
    const text = crashReport('0.3.2', e, 'UA/1');
    expect(text).toContain('Cinderbelt 0.3.2');
    expect(text).toContain('UA/1');
    expect(text).toContain('Error: boom');
    expect(text.split('\n').length).toBeGreaterThan(3);
  });

  it('copes with thrown non-errors', () => {
    expect(errorText('plain')).toBe('plain');
    expect(errorText({ a: 1 })).toBe('{"a":1}');
    expect(errorText(undefined)).toBe('undefined');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(typeof errorText(cyclic)).toBe('string');
  });
});

describe('global error filter', () => {
  it('ignores ResizeObserver noise and opaque cross-origin errors', () => {
    expect(isBenignError('ResizeObserver loop completed with undelivered notifications.', null)).toBe(true);
    expect(isBenignError('ResizeObserver loop limit exceeded', undefined)).toBe(true);
    expect(isBenignError('Script error.', null)).toBe(true);
    expect(isBenignError('', undefined)).toBe(true);
    expect(isBenignError('Script error.', new Error('x'))).toBe(false);
    expect(isBenignError('x is not a function', new TypeError('x'))).toBe(false);
  });

  it('throttles toasts', () => {
    const t = new ToastThrottle(10_000);
    expect(t.take(1000)).toBe(true);
    expect(t.take(5000)).toBe(false);
    expect(t.take(11_000)).toBe(true);
    expect(t.take(12_000)).toBe(false);
  });
});
