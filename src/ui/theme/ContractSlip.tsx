import type { ComponentChildren } from 'preact';
import type { PartId, Tier } from '../../data/parts';
import { assetUrl } from '../../render/assets/url';
import { tx } from '../../i18n';
import { formatInt } from '../format';
import { PartChip } from './Chips';
import { Lamp } from './Meters';
import { Panel } from './Panel';
import './slip.css';

export interface SlipTag {
  text: string;
  /** warn = sector warning / risk, info = anomaly / short, plain = the rest. */
  tone?: 'warn' | 'info' | 'plain';
}

export interface ContractSlipProps {
  title: string;
  typeName: string;
  factionName: string;
  /** The faction sets the trim colour (Guild orange, Institute azure). */
  faction: 'guild' | 'institute';
  /** Path to the SVG emblem (relative to BASE_URL). */
  emblem: string;
  reward: number;
  rewardNote?: string | null;
  /** Text under the reward ("+24 rep."). */
  rep?: string;
  part?: { partId: PartId; tier: Tier } | null;
  /** "~7 min · 840 u" */
  meta?: string;
  /** 0 no risk, 1 risk, 2 high (two slanted marks). */
  risk: 0 | 1 | 2;
  riskLabel: string;
  tags?: SlipTag[];
  state: 'offer' | 'active' | 'ready';
  stateLabel?: string;
  /** Next step of the active contract. */
  next?: string | null;
  progress?: { value: number; max: number } | null;
  compact?: boolean;
  actions?: ComponentChildren;
  testId?: string;
}

const LAMP = { offer: 'off', active: 'info', ready: 'ok' } as const;

/** Contract slip – a plate with faction trim, emblem and the reward in a recessed display (10.3). */
export function ContractSlip(p: ContractSlipProps) {
  const cls = ['af-slip', `af-slip--${p.faction}`, `is-${p.state}`, p.compact ? 'af-slip--compact' : ''].filter(Boolean).join(' ');
  const pct = p.progress && p.progress.max > 0 ? Math.min(1, p.progress.value / p.progress.max) : 0;
  return (
    <Panel material="plate" cut="md" trim="left" class={cls} testId={p.testId}>
      <div class="af-slip-head">
        <img class="af-slip-emblem" src={assetUrl(p.emblem)} alt="" />
        <div class="af-slip-kind">
          <span class="af-label af-slip-type">{p.typeName}</span>
          <span class="af-slip-faction">{p.factionName}</span>
        </div>
        <span class="af-slip-state">
          {p.stateLabel && <span class="af-label">{p.stateLabel}</span>}
          <Lamp state={LAMP[p.state]} label={p.stateLabel ?? p.state} />
        </span>
      </div>
      <p class="af-slip-title">{p.title}</p>
      {!p.compact && (
        <div class="af-slip-tags">
          <span class={`af-slip-risk af-slip-risk--${p.risk}`} title={p.riskLabel}>
            <i aria-hidden="true" />
            <i aria-hidden="true" />
            <span class="af-label">{p.riskLabel}</span>
          </span>
          {p.tags?.map((t) => (
            <span key={t.text} class={`af-label af-slip-tag af-slip-tag--${t.tone ?? 'plain'}`}>
              {t.text}
            </span>
          ))}
        </div>
      )}
      {p.next && (
        <div class="af-slip-next">
          <span>{p.next}</span>
          {p.progress && (
            <span class="af-slip-bar" role="meter" aria-valuemin={0} aria-valuemax={p.progress.max} aria-valuenow={p.progress.value}>
              <i style={{ width: `${pct * 100}%` }} />
            </span>
          )}
        </div>
      )}
      <div class="af-slip-foot">
        <div class="af-slip-reward af-cut4">
          <span class="af-slip-credits">
            {formatInt(p.reward)} <small>{tx().units.credits}</small>
          </span>
          {p.part && <PartChip partId={p.part.partId} tier={p.part.tier} compact />}
          {p.rep && <span class="af-slip-rep">{p.rep}</span>}
        </div>
        <div class="af-slip-side">
          {p.meta && <span class="af-slip-meta">{p.meta}</span>}
          {p.rewardNote && <span class="af-slip-note">{p.rewardNote}</span>}
        </div>
        {p.actions && <div class="af-slip-actions">{p.actions}</div>}
      </div>
    </Panel>
  );
}
