import type { ComponentChildren } from 'preact';
import { formatAmount } from '../format';
import { LiveSlot, type LiveText } from '../liveText';
import { pure } from '../pure';
import { gaugeView, sameGauge } from './gaugeMath';

export { gaugeLevel, litSegments, type GaugeLevel } from './gaugeMath';

export type GaugeKind = 'fuel' | 'energy' | 'cargo' | 'hull' | 'shield' | 'heat';

export interface GaugeProps {
  label: ComponentChildren;
  value: number;
  max: number;
  kind: GaugeKind;
  /** Number of segments (like the marks on the hangar platform edge). */
  segments?: number;
  /** A decimal place in the readout (cargo). */
  decimals?: 0 | 1;
  /** Ratio below which the state is a warning / critical. With `invert`, above which (full cargo). */
  warnAt?: number;
  critAt?: number;
  invert?: boolean;
  compact?: boolean;
  testId?: string;
  /** Just unlocked: highlighted for a few seconds (`is-new`, hud.css). */
  fresh?: boolean;
}

const fmt = (v: number, decimals: 0 | 1) => (decimals > 0 ? formatAmount(v) : String(Math.floor(v + 1e-9)));

/**
 * Segment gauge with quarter ticks. Memoised: it redraws only when what it shows changes – the flight
 * HUD passes fresh fuel and energy values 10× per second, and a gauge is ~35 elements.
 */
export const Gauge = pure(GaugeView, (a: GaugeProps, b: GaugeProps) => sameGaugeProps(a, b));

/** Would the two gauges look the same (the Gauge's comparator – for parts that hold several gauges)? */
export const sameGaugeProps = (a: GaugeProps, b: GaugeProps): boolean => sameGauge(a, b, fmt);

function GaugeView(p: GaugeProps) {
  const segments = p.segments ?? 20;
  const { level, lit, text, ariaNow } = gaugeView(p, fmt);
  const cls = [
    'af-gauge',
    `af-gauge--${p.kind}`,
    level !== 'ok' ? `is-${level}` : '',
    p.compact ? 'af-gauge--compact' : '',
    p.fresh ? 'is-new' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div class={cls} data-testid={p.testId} data-level={level}>
      <span class="af-gauge-label">
        {level !== 'ok' && <Lamp state={level === 'crit' ? 'bad' : 'warn'} />}
        {p.label}
      </span>
      <span class="af-gauge-value">
        {text} <small>/ {Math.floor(p.max)}</small>
      </span>
      <div
        class="af-gauge-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={p.max}
        aria-valuenow={ariaNow}
        aria-label={typeof p.label === 'string' ? p.label : undefined}
      >
        <Segments n={segments} lit={lit} />
      </div>
      <GaugeTicks />
    </div>
  );
}

/** The segments of a gauge: they change less often than its number (a whole segment is 4 % of 24). */
const Segments = pure(function GaugeSegments({ n, lit }: { n: number; lit: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} class={`af-gauge-seg${i < lit ? ' is-on' : ''}`} />
      ))}
    </>
  );
});

/** The quarter ticks: still markup (memoised – no props, it never draws again). */
const GaugeTicks = pure(function GaugeTicksView() {
  return (
    <div class="af-gauge-ticks" aria-hidden="true">
      <i style={{ left: '25%' }} />
      <i style={{ left: '50%' }} />
      <i style={{ left: '75%' }} />
    </div>
  );
});

/** A signal lamp (like the dock beacons). */
export function Lamp({ state = 'ok', label }: { state?: 'ok' | 'off' | 'bad' | 'warn' | 'info'; label?: string }) {
  return <span class={`af-lamp af-lamp--${state}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'} />;
}

/** A numeric readout with a unit (tabular figures). */
export function Readout({
  value,
  live,
  unit,
  label,
  size = 'md',
  testId,
  fresh,
}: {
  value?: ComponentChildren;
  /** A value the owner writes straight into the DOM at each redraw (liveText.ts) instead of `value`. */
  live?: LiveText;
  unit?: string;
  label?: ComponentChildren;
  size?: 'md' | 'lg';
  testId?: string;
  /** Just unlocked: highlighted for a few seconds (`is-new`, hud.css). */
  fresh?: boolean;
}) {
  return (
    <span class={`af-readout-wrap${size === 'lg' ? ' af-readout--lg' : ''}${fresh ? ' is-new' : ''}`} data-testid={testId}>
      {label !== undefined && <span class="af-readout-label">{label}</span>}
      <span class="af-readout">
        {live ? <LiveSlot class="af-readout-value" live={live} /> : <span class="af-readout-value">{value}</span>}
        {unit && <span class="af-readout-unit">{unit}</span>}
      </span>
    </span>
  );
}
