import type { ComponentChildren } from 'preact';
import type { ContractType } from '../../data/contracts';
import type { SlipData } from '../../game/board/slipView';
import { tx } from '../../i18n';
import { formatInt } from '../format';
import { slipMeta } from './Slip';

/** One simple line glyph per contract kind (24 × 24, stroked). */
const GLYPH: Record<ContractType, string> = {
  delivery: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  mining: 'M12 3l7 6-7 12L5 9z',
  hunt: 'M12 4v4M12 16v4M4 12h4M16 12h4M8.5 12a3.5 3.5 0 107 0 3.5 3.5 0 10-7 0',
  rescue: 'M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z',
  survey: 'M6 7h.01M12 12h.01M18 8h.01M8 17h.01M17 16h.01M4 4h16v16H4z',
  scan: 'M4 18a9 9 0 0116 0M7.5 18a5 5 0 019 0M12 18h.01',
  escort: 'M5 6l6 6-6 6M13 6l6 6-6 6',
  retrieve: 'M12 20V8M7 13l5-5 5 5M5 4h14',
  build: 'M4 20h16M7 20V10l5-5 5 5v10M10 20v-5h4v5',
  fortress: 'M4 20V9h3v3h3V9h4v3h3V9h3v11zM9 20v-4h6v4',
  chart: 'M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2zM9 4v14M15 6v14',
  relay: 'M12 12v9M8 21h8M12 12h.01M7.5 7.5a6.4 6.4 0 000 9M16.5 7.5a6.4 6.4 0 010 9',
};

export function KindIcon({ type }: { type: ContractType }) {
  return (
    <span class="bd-kind" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <path d={GLYPH[type]} />
      </svg>
    </span>
  );
}

/** Giver · ~min · distance · risk – the row's one meta line. */
export function rowMeta(d: SlipData, from: { x: number; y: number } | null): string {
  const parts = [d.factionName, slipMeta(d, from)];
  if (d.first) parts.push(tx().sectors.charts.firstTag);
  if (d.risk > 0) parts.push(tx().goals.slip.risk[d.risk]);
  return parts.join(' · ');
}

/** A compact offer row: kind icon, title, meta, reward and the Accept button. */
export function OfferRow({ d, from, actions }: { d: SlipData; from: { x: number; y: number } | null; actions: ComponentChildren }) {
  const s = tx().goals.slip;
  return (
    <li class={`bd-row bd-row--${d.faction}`} data-testid={`offer-${d.offerId}`}>
      <KindIcon type={d.type} />
      <div class="bd-row-main">
        <span class="bd-row-title">{d.title}</span>
        <span class="bd-row-meta">{rowMeta(d, from)}</span>
      </div>
      <div class="bd-row-reward">
        <strong>
          {formatInt(d.reward)} <small>{tx().units.credits}</small>
        </strong>
        <span>{s.rep(d.rep)}</span>
      </div>
      <div class="bd-row-act">{actions}</div>
    </li>
  );
}
