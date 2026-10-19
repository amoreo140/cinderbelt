import { describe, expect, it } from 'vitest';
import { escortLamp, hullBar, relayLamp, relaySteps } from './guildLayout';

describe('relaySteps', () => {
  it('walks repair → power → hold', () => {
    expect(relaySteps('broken')).toEqual(['current', 'todo', 'todo']);
    expect(relaySteps('repaired')).toEqual(['done', 'current', 'todo']);
    expect(relaySteps('powered')).toEqual(['done', 'done', 'current']);
    expect(relaySteps('secured')).toEqual(['done', 'done', 'done']);
  });

  it('lamps: the hold warns, a secured relay is done', () => {
    expect(relayLamp('broken')).toBe('info');
    expect(relayLamp('powered')).toBe('warn');
    expect(relayLamp('secured')).toBe('ok');
    expect(escortLamp('waiting')).toBe('info');
    expect(escortLamp('moving')).toBe('ok');
    expect(escortLamp('stopped')).toBe('warn');
  });
});

describe('hullBar', () => {
  it('lights segments by the hull share, rounded up', () => {
    expect(hullBar(1)).toEqual({ lit: 8, level: 'ok', percent: 100 });
    expect(hullBar(0.99).lit).toBe(8);
    expect(hullBar(0.5)).toEqual({ lit: 4, level: 'warn', percent: 50 });
    expect(hullBar(0.01).lit).toBe(1);
    expect(hullBar(0.2).level).toBe('crit');
    expect(hullBar(0)).toEqual({ lit: 0, level: 'crit', percent: 0 });
  });

  it('clamps bad input', () => {
    expect(hullBar(1.4).lit).toBe(8);
    expect(hullBar(Number.NaN).lit).toBe(0);
  });
});
