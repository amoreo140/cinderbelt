import { describe, expect, it } from 'vitest';
import { gaugeLevel, gaugeView, litSegments, sameGauge } from './gaugeMath';

describe('gauge', () => {
  it('lights at least one segment for any non-zero value', () => {
    expect(litSegments(0, 20)).toBe(0);
    expect(litSegments(0.001, 20)).toBe(1);
    expect(litSegments(0.5, 20)).toBe(10);
    expect(litSegments(1, 20)).toBe(20);
    expect(litSegments(2, 20)).toBe(20);
  });

  it('warns when low, or when high for inverted gauges', () => {
    expect(gaugeLevel(0.6, 0.25, 0.1)).toBe('ok');
    expect(gaugeLevel(0.2, 0.25, 0.1)).toBe('warn');
    expect(gaugeLevel(0.05, 0.25, 0.1)).toBe('crit');
    expect(gaugeLevel(0.5, 0.85, 0.999, true)).toBe('ok');
    expect(gaugeLevel(0.9, 0.85, 0.999, true)).toBe('warn');
    expect(gaugeLevel(1, 0.85, 0.999, true)).toBe('crit');
  });
});

describe('gauge memo (the HUD redraws only gauges that look different)', () => {
  const fmt = (v: number, d: 0 | 1) => (d > 0 ? v.toFixed(1) : String(Math.floor(v + 1e-9)));
  const fuel = (value: number, extra: object = {}) => ({ kind: 'fuel', label: 'Fuel', value, max: 100, segments: 24, compact: true, ...extra });

  it('a value change that shows the same number, segments, level and aria value is the same gauge', () => {
    expect(sameGauge(fuel(50.31), fuel(50.33), fmt)).toBe(true);
    expect(gaugeView(fuel(50.31), fmt)).toEqual(gaugeView(fuel(50.33), fmt));
  });

  it('the aria value is the number shown (whole units, tenths with a decimal place)', () => {
    expect(gaugeView(fuel(50.96), fmt).ariaNow).toBe(50);
    expect(gaugeView(fuel(50.96, { decimals: 1 }), fmt).ariaNow).toBe(51);
    expect(gaugeView(fuel(50.94, { decimals: 1 }), fmt).ariaNow).toBe(50.9);
    expect(sameGauge(fuel(50.31), fuel(50.86), fmt)).toBe(true);
    expect(sameGauge(fuel(50.31, { decimals: 1 }), fuel(50.36, { decimals: 1 }), fmt)).toBe(false);
  });

  it('redraws when the shown number, the segments or the level change', () => {
    // the integer readout changes
    expect(sameGauge(fuel(50.96), fuel(51.01), fmt)).toBe(false);
    // a segment lights up (24 segments: 50 % -> 12, 52.2 % -> 13)
    expect(sameGauge(fuel(50.1), fuel(50.2, { value: 52.2 }), fmt)).toBe(false);
    // the warning level changes (25 % of 100)
    expect(sameGauge(fuel(25.04), fuel(24.96), fmt)).toBe(false);
  });

  it('any other prop must be identical', () => {
    expect(sameGauge(fuel(50), fuel(50, { max: 120 }), fmt)).toBe(false);
    expect(sameGauge(fuel(50), fuel(50, { label: 'Palivo' }), fmt)).toBe(false);
    expect(sameGauge(fuel(50), fuel(50, { testId: 'x' }), fmt)).toBe(false);
    expect(sameGauge(fuel(50), fuel(50), fmt)).toBe(true);
  });
});
