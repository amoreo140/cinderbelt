// Vein mining in the flight HUD (long-term design 2.1.1): a segmented heat bar for the hottest laser
// and a "bonus ×1.5" tag while the beam mines the active section of a vein.
import type { MiningHudData } from '../game/miningView';
import { tx } from '../i18n';
import { formatAmount } from './format';
import { Gauge } from './theme';
import './mining.css';

export function MiningHeat({ m }: { m: MiningHudData }) {
  // the bonus / cooling tag replaces the label – a half-width console row is narrow
  const label = m.overheated ? (
    <span class="hud-heat-cooling" title={tx().hud.heatHint}>
      {tx().hud.cooling}
    </span>
  ) : m.bonus !== null ? (
    <span class="hud-vein-bonus" data-testid="hud-vein-bonus" role="status">
      {tx().hud.bonus(formatAmount(m.bonus))}
    </span>
  ) : (
    <span class="hud-heat-label" title={tx().hud.heatHint}>
      {tx().hud.heatShort}
    </span>
  );
  return (
    <div class={`hud-heat${m.overheated ? ' is-cooling' : ''}${m.active ? '' : ' is-idle'}`} data-testid="hud-heat">
      <Gauge kind="heat" label={label} value={m.heat} max={m.heatMax} decimals={1} invert warnAt={0.75} critAt={0.999} compact segments={12} testId="gauge-heat" />
    </div>
  );
}
