// The sector state strip (long-term design 10.6): the Board tab and the hub's Overview tab.
import type { SectorView } from '../../game/board/boardView';
import { tx } from '../../i18n';
import { Lamp, Panel } from '../theme';
import './board.css';

const t = () => tx().goals.board;

/** `hideWhenCalm`: render nothing when the sector has no modifier (the strip is only news when something is going on). */
export function SectorStrip({ sector, testId, hideWhenCalm }: { sector: SectorView; testId?: string; hideWhenCalm?: boolean }) {
  if (hideWhenCalm && sector.modifiers.length === 0) return null;
  return (
    <Panel material="screen" cut="sm" class="bd-sector" testId={testId}>
      <span class="af-label bd-sector-title">{t().sector}</span>
      {sector.modifiers.length === 0 ? (
        <span class="bd-sector-calm">
          <Lamp state="ok" /> {t().calm}
        </span>
      ) : (
        <ul class="bd-sector-list">
          {sector.modifiers.map((m) => (
            <li key={m.id} class={`bd-mod bd-mod--${m.kind}`}>
              <Lamp state={m.kind === 'warning' ? 'warn' : 'info'} />
              <span class="bd-mod-name">{m.name}</span>
              <span class="af-label bd-mod-kind">{m.kindName}</span>
              {m.bonus > 0 && <span class="bd-mod-bonus">{tx().goals.sector.bonus(m.bonus)}</span>}
              <span class="bd-mod-effect">{m.effect}</span>
            </li>
          ))}
        </ul>
      )}
      <span class="bd-sector-change">{t().sectorChange(sector.minutesToChange)}</span>
    </Panel>
  );
}
