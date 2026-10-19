import type { ComponentChildren } from 'preact';
import type { SlipData } from '../../game/board/slipView';
import { tx } from '../../i18n';
import { formatCredits, formatInt, formatPercent } from '../format';
import { ContractSlip, type SlipTag } from '../theme';

const t = () => tx().goals.slip;

/**
 * Slip tags: first chart, short ◷, depth, the Guild Lane and the escort's deposit and ambushes (M4d),
 * sector modifiers with their bonus.
 */
export function slipTags(d: SlipData): SlipTag[] {
  const tags: SlipTag[] = [];
  if (d.first) tags.push({ text: tx().sectors.charts.firstTag, tone: 'info' });
  if (d.short) tags.push({ text: `◷ ${t().short}`, tone: 'info' });
  tags.push({ text: t().depth(d.ring) });
  if (d.lane) tags.push({ text: tx().guild.relay.lane(d.lane) });
  if (d.deposit !== undefined && d.deposit > 0) tags.push({ text: tx().guild.escort.depositTag(formatCredits(d.deposit)), tone: 'warn' });
  if (d.ambushes) tags.push({ text: tx().guild.escort.ambushes(d.ambushes) });
  for (const m of d.modifiers) {
    tags.push({ text: m.bonus > 0 ? `${m.name} ${formatPercent(m.bonus, 0, true)}` : m.name, tone: m.kind === 'warning' ? 'warn' : 'plain' });
  }
  return tags;
}

/** "~7 min · 840 u" – distance from `from` (the ship) if the contract has a target. */
export function slipMeta(d: SlipData, from: { x: number; y: number } | null): string {
  const parts = [t().duration(d.minutes)];
  if (d.target && from) parts.push(t().distance(formatInt(Math.hypot(d.target.x - from.x, d.target.y - from.y))));
  return parts.join(' · ');
}

export function Slip({
  d,
  from,
  compact,
  actions,
}: {
  d: SlipData;
  from: { x: number; y: number } | null;
  compact?: boolean;
  actions?: ComponentChildren;
}) {
  const stateLabel = d.state === 'ready' ? t().ready : d.state === 'active' ? t().active : undefined;
  return (
    <ContractSlip
      title={d.title}
      typeName={d.typeName}
      factionName={d.factionName}
      faction={d.faction}
      emblem={d.emblem}
      reward={d.reward}
      rewardNote={compact ? null : d.rewardNote}
      rep={t().rep(d.rep)}
      part={d.part}
      meta={slipMeta(d, from)}
      risk={d.risk}
      riskLabel={t().risk[d.risk]}
      tags={slipTags(d)}
      state={d.state}
      {...(stateLabel ? { stateLabel } : {})}
      next={d.next}
      progress={d.progress}
      compact={compact ?? false}
      actions={actions}
      testId={d.serial !== null ? `contract-${d.serial}` : `offer-${d.offerId}`}
    />
  );
}
