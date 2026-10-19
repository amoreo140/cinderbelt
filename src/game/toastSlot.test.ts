import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale, tx } from '../i18n';
import { rebuilt, ToastSlot } from './toastSlot';

const start = getLocale();
afterEach(() => setLocale(start));

describe('ToastSlot', () => {
  it('shows a toast until its time runs out', () => {
    const slot = new ToastSlot();
    expect(slot.current(0)).toBeNull();
    slot.show('Ahoj', 'ok', 3, 10);
    expect(slot.current(12.9)).toEqual({ text: 'Ahoj', kind: 'ok' });
    expect(slot.current(13)).toBeNull();
  });

  it('a toast from a text builder says it again after a live language switch', () => {
    setLocale('sk');
    const slot = new ToastSlot();
    slot.show(() => tx().messages.cargoFull, 'info', 4, 0);
    const sk = slot.current(1)!.text;
    setLocale('en');
    const en = slot.current(2)!.text;
    expect(en).toBe(tx().messages.cargoFull);
    expect(en).not.toBe(sk);
    setLocale('sk');
    expect(slot.current(3)!.text).toBe(sk);
  });

  it('a finished text stays as it was shown', () => {
    setLocale('sk');
    const slot = new ToastSlot();
    slot.show(tx().messages.cargoFull, 'info', 4, 0);
    const sk = slot.current(1)!.text;
    setLocale('en');
    expect(slot.current(2)!.text).toBe(sk);
  });

  it('builds the text once per language, not every frame', () => {
    let calls = 0;
    const slot = new ToastSlot();
    slot.show(() => `t${++calls}`, 'info', 4, 0);
    slot.current(1);
    slot.current(2);
    expect(calls).toBe(1);
  });
});

describe('rebuilt', () => {
  it('answers the text built already first, then rebuilds; null keeps the text', () => {
    let next: string | null = 'Again';
    const build = rebuilt('First', () => next);
    expect(build()).toBe('First');
    expect(build()).toBe('Again');
    next = null;
    expect(build()).toBe('First');
  });
});
