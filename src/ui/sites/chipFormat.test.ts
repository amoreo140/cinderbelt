import { afterEach, describe, expect, it } from 'vitest';
import type { EventChipItem } from '../../game/sites/types';
import { setLocale } from '../../i18n/locale';
import { chipLamp, chipTime, clockHour, formatClock, normDeg, visibleChips } from './chipFormat';

const chip = (over: Partial<EventChipItem> = {}): EventChipItem => ({
  key: over.key ?? `ev:${over.kind ?? 'micrometeors'}:s@1`,
  kind: 'micrometeors',
  title: 'Spŕška mikrometeoritov',
  secondsLeft: 30,
  dirDeg: 0,
  tone: 'warn',
  pending: false,
  ...over,
});

afterEach(() => setLocale('sk'));

describe('formatClock', () => {
  it('shows seconds under a minute, rounded up', () => {
    expect(formatClock(8)).toBe('8 s');
    expect(formatClock(7.2)).toBe('8 s');
    expect(formatClock(59.5)).toBe('1:00');
  });
  it('shows m:ss from a minute and h:mm:ss from an hour', () => {
    expect(formatClock(84)).toBe('1:24');
    expect(formatClock(180)).toBe('3:00');
    expect(formatClock(3725)).toBe('1:02:05');
  });
  it('never goes below zero', () => {
    expect(formatClock(-3)).toBe('0 s');
    expect(formatClock(Number.NaN)).toBe('0 s');
  });
});

describe('chipTime', () => {
  it('counts down to the end, or to the start during the warning lead', () => {
    expect(chipTime(chip({ secondsLeft: 84 }))).toBe('1:24');
    expect(chipTime(chip({ secondsLeft: 8, pending: true }))).toBe('o 8 s');
    setLocale('en');
    expect(chipTime(chip({ secondsLeft: 8, pending: true }))).toBe('in 8 s');
  });
  it('says "ongoing" for an open-ended event', () => {
    expect(chipTime(chip({ secondsLeft: null, kind: 'ambush' }))).toBe('prebieha');
    setLocale('en');
    expect(chipTime(chip({ secondsLeft: null, kind: 'ambush' }))).toBe('ongoing');
  });
});

describe('visibleChips', () => {
  it('keeps the order and at most two', () => {
    const list = [chip({ kind: 'ambush', key: 'a' }), chip({ kind: 'micrometeors', key: 'b' }), chip({ kind: 'cometFlyby', key: 'c' })];
    expect(visibleChips(list).map((c) => c.key)).toEqual(['a', 'b']);
  });
  it('keeps the ion storm as one of the two (storm + one more)', () => {
    const list = [
      chip({ kind: 'ambush', key: 'a' }),
      chip({ kind: 'micrometeors', key: 'b' }),
      chip({ kind: 'ionStorm', key: 's' }),
      chip({ kind: 'distress', key: 'd' }),
    ];
    expect(visibleChips(list).map((c) => c.key)).toEqual(['a', 's']);
  });
  it('one or none stays as it is', () => {
    expect(visibleChips([])).toEqual([]);
    expect(visibleChips([chip({ key: 'x' })]).map((c) => c.key)).toEqual(['x']);
  });
});

describe('direction', () => {
  it('normalises degrees into [0, 360)', () => {
    expect(normDeg(-90)).toBe(270);
    expect(normDeg(720)).toBe(0);
    expect(normDeg(45.5)).toBe(45.5);
  });
  it('reads as a clock bearing, 12 = ahead, clockwise', () => {
    expect(clockHour(0)).toBe(12);
    expect(clockHour(14)).toBe(12);
    expect(clockHour(16)).toBe(1);
    expect(clockHour(90)).toBe(3);
    expect(clockHour(150)).toBe(5);
    expect(clockHour(-90)).toBe(9);
    expect(clockHour(359)).toBe(12);
  });
});

describe('chipLamp', () => {
  it('maps the tone to a lamp state', () => {
    expect(chipLamp('info')).toBe('info');
    expect(chipLamp('warn')).toBe('warn');
    expect(chipLamp('danger')).toBe('bad');
  });
});
