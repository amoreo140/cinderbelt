// Pure gauge logic (testable without a DOM).

export type GaugeLevel = 'ok' | 'warn' | 'crit';

/** Warning level for a fill ratio. */
export function gaugeLevel(ratio: number, warnAt: number, critAt: number, invert = false): GaugeLevel {
  if (invert) {
    if (ratio >= critAt) return 'crit';
    if (ratio >= warnAt) return 'warn';
    return 'ok';
  }
  if (ratio <= critAt) return 'crit';
  if (ratio <= warnAt) return 'warn';
  return 'ok';
}

/** Number of lit segments – the first one lights up at any non-zero value. */
export function litSegments(ratio: number, segments: number): number {
  if (ratio <= 0) return 0;
  return Math.min(segments, Math.max(1, Math.round(ratio * segments)));
}

/** Inputs of a segment gauge (the Gauge component's numeric props). */
export interface GaugeInputs {
  value: number;
  max: number;
  segments?: number;
  decimals?: 0 | 1;
  warnAt?: number;
  critAt?: number;
  invert?: boolean;
}

/** What a gauge shows: warning level, lit segments, the number text and the meter's aria value. */
export interface GaugeView {
  level: GaugeLevel;
  lit: number;
  text: string;
  ariaNow: number;
}

export function gaugeView(p: GaugeInputs, format: (value: number, decimals: 0 | 1) => string): GaugeView {
  return { ...gaugeState(p), text: format(p.value, p.decimals ?? 0), ariaNow: ariaValue(p.value, p.decimals ?? 0) };
}

/** The meter's aria value: the number the readout shows (whole units, or tenths with a decimal place). */
const ariaValue = (value: number, decimals: 0 | 1): number => (decimals > 0 ? Math.round(value * 10) / 10 : Math.floor(value + 1e-9));

function gaugeState(p: GaugeInputs): { level: GaugeLevel; lit: number } {
  const ratio = p.max > 0 ? Math.min(1, Math.max(0, p.value / p.max)) : 0;
  const level = p.invert ? gaugeLevel(ratio, p.warnAt ?? 0.85, p.critAt ?? 0.999, true) : gaugeLevel(ratio, p.warnAt ?? 0.25, p.critAt ?? 0.1);
  return { level, lit: litSegments(ratio, p.segments ?? 20) };
}

/**
 * Would the gauge look the same? Every prop but `value` must be identical; a new value counts only
 * when it changes what is shown – the number, the lit segments, the level (the HUD passes a fresh
 * fuel/energy value 10× per second).
 */
export function sameGauge<P extends GaugeInputs>(a: P, b: P, format: (value: number, decimals: 0 | 1) => string): boolean {
  const keys = Object.keys(a) as (keyof P)[];
  if (keys.length !== Object.keys(b).length) return false;
  for (const k of keys) if (k !== 'value' && a[k] !== b[k]) return false;
  if (a.value === b.value) return true;
  // the cheap parts first; the number text (Intl formatting) only when everything else matches
  const decimals = a.decimals ?? 0;
  if (ariaValue(a.value, decimals) !== ariaValue(b.value, decimals)) return false;
  const va = gaugeState(a);
  const vb = gaugeState(b);
  return va.level === vb.level && va.lit === vb.lit && format(a.value, decimals) === format(b.value, decimals);
}
