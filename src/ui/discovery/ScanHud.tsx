// The scanner in the flight HUD (M3.5b): pulse charge and Data by the radar, the pulse across the
// screen (VFX), anomaly bonuses and the ion storm notice. Object labels live in Callout (theme).
// M4b (T10): the site readout plate beside the scanner – a relay's charge, a derelict's relays, defence
// and dock clamp, a comet's composition, a graveyard sleeper's "active reactor".
import { tx } from '../../i18n';
import { formatPercent } from '../format';
import { Key, Lamp, Readout } from '../theme';
import type { ScanHudData } from '../../game/discovery/exploreUi';
import type { ScanReadout } from '../../game/sites/scanReadout';
import './discovery.css';

/** Scanner band above the radar: [Tab] pulse, charge, Data in the fund. */
export function ScanWidget({ d }: { d: ScanHudData }) {
  const s = tx().discovery.scanner;
  return (
    <>
      {d.readout && <SiteReadout r={d.readout} />}
      <div class={`ds-scan${d.ready ? ' is-ready' : ''}`} data-testid="scan-widget" aria-label={s.title}>
        <div class="ds-scan-row">
          <Key dark>Tab</Key>
          <span class="af-label ds-scan-label">{s.title}</span>
          <span class="ds-scan-state">{d.analysis ? `${s.analyzing} ${formatPercent(Math.round(d.analysis.progress * 100))}` : d.ready ? s.ready : s.charging(d.cooldown)}</span>
        </div>
        <span class="ds-scan-bar" role="meter" aria-label={s.pulse} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(d.charge * 100)}>
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} class={i < Math.floor(d.charge * 10 + 1e-6) ? 'is-on' : ''} />
          ))}
        </span>
        <div class="ds-scan-data">
          <Readout label={tx().discovery.data} value={d.dataFund} unit={tx().discovery.dataUnit} />
        </div>
      </div>
    </>
  );
}

const READOUT_LAMP = { info: 'info', ok: 'ok', warn: 'warn' } as const;

/** What the scanner tells about a site object, beside the scanner widget (left of it, bottom-aligned). */
export function SiteReadout({ r }: { r: ScanReadout }) {
  const tone = r.lines.some((l) => l.tone === 'warn') ? 'warn' : r.lines.every((l) => l.tone === 'ok') ? 'ok' : 'info';
  return (
    <div class={`ds-readout is-${tone}`} role="status" data-testid="scan-readout" data-key={r.key}>
      <div class="ds-readout-head">
        <Lamp state={READOUT_LAMP[tone]} />
        <span class="af-label ds-readout-title">{r.title}</span>
      </div>
      <ul class="ds-readout-lines">
        {r.lines.map((l, i) => (
          <li key={i} class={`is-${l.tone}`}>
            {l.text}
          </li>
        ))}
      </ul>
      {r.charge !== null && (
        <span class="ds-scan-bar ds-readout-bar" role="meter" aria-label={r.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.charge * 100)}>
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} class={i < Math.floor(r.charge! * 10 + 1e-6) ? 'is-on' : ''} />
          ))}
        </span>
      )}
    </div>
  );
}

export function BuffStrip({ d }: { d: ScanHudData }) {
  if (d.buffs.length === 0) return null;
  return (
    <div class="ds-buffs" role="status">
      {d.buffs.map((b) => (
        <span key={b.kind} class="ds-buff" data-testid={`buff-${b.kind}`}>
          <Lamp state="ok" />
          <strong>{b.name}</strong>
          <span>{b.effect}</span>
          <span class="ds-buff-time">{b.seconds} s</span>
        </span>
      ))}
    </div>
  );
}

export function StormBanner({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <div class="ds-storm" role="alert" data-testid="ion-storm">
      <span>{tx().discovery.toasts.storm}</span>
    </div>
  );
}
