// Service – repairs (M2, 4.8 and 6.5): list of damaged parts with prices, repair one or all of them.
import { parsePartKey } from '../../data/parts';
import type { RepairView } from '../../game/stationView';
import { tx } from '../../i18n';
import type { GameActionInput } from '../../sim/commands';
import { formatCredits, formatPercent } from '../format';
import { Gauge, Heading, Lamp, Panel, PartChip } from '../theme';
import { Act, type ClickSound } from './Act';

export interface RepairsProps {
  view: RepairView;
  /** Whether a single part can be repaired (by id). */
  rowOk: Record<number, boolean>;
  autoBuy: boolean;
  available: boolean;
  on: ClickSound & { action(action: GameActionInput): void; setAutoBuy(on: boolean): void };
}

export function Repairs(p: RepairsProps) {
  const { on, view } = p;
  const pct = Math.round(view.hull.fraction * 100);
  if (!view.damaged) {
    return (
      <section>
        <Heading>{tx().service.repairs}</Heading>
        <Panel material="screen" cut="sm" class="hub-status" testId="repairs-ok">
          <Lamp state="ok" />
          <span>{tx().service.repairsOk}</span>
          <span class="hub-status-aside">
            {view.hull.current} / {view.hull.max} HP
          </span>
        </Panel>
      </section>
    );
  }
  return (
    <section data-testid="repairs">
      <Heading aside={formatPercent(pct)}>{tx().service.repairs}</Heading>
      <Panel material="screen" cut="md" class="hub-gauges">
        <Gauge kind="hull" label={tx().service.hull} value={view.hull.current} max={view.hull.max} segments={30} warnAt={0.6} critAt={0.3} />
      </Panel>
      <table class="hub-table hub-repair-table">
        <thead>
          <tr>
            <th scope="col">{tx().service.part}</th>
            <th scope="col">{tx().service.hp}</th>
            <th scope="col" class="num">
              {tx().service.repairCost}
            </th>
            <th scope="col">
              <span class="af-sr-only">{tx().market.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r) => {
            const { partId, tier } = parsePartKey(r.key);
            const level = r.fraction < 0.3 ? 'bad' : r.fraction < 0.6 ? 'warn' : 'ok';
            return (
              <tr key={r.id} data-testid={`repair-row-${r.id}`}>
                <th scope="row">
                  <PartChip partId={partId} tier={tier} /> <span class="hub-dim hub-part-id">#{r.id}</span>
                </th>
                <td>
                  <span class={`hub-hpbar is-${level}`} aria-hidden="true">
                    <i style={{ width: `${Math.round(r.fraction * 100)}%` }} />
                  </span>
                  <span class="hub-hp-text">
                    {Math.round(r.hp)} / {r.maxHp}
                  </span>
                </td>
                <td class="num">{r.text}</td>
                <td class="hub-actions">
                  <Act
                    on={on}
                    size="sm"
                    testId={`repair-${r.id}`}
                    disabled={!p.available || !p.rowOk[r.id]}
                    reason={p.available ? tx().service.cannotRepair : tx().service.noRepairService}
                    onClick={() => on.action({ type: 'repair', partIds: [r.id], autoBuy: p.autoBuy })}
                  >
                    {tx().service.repair}
                  </Act>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div class="hub-repair-all">
        <label class="hub-check">
          <input type="checkbox" checked={p.autoBuy} onChange={(e) => p.on.setAutoBuy((e.currentTarget as HTMLInputElement).checked)} />
          <span>{tx().service.autoBuy}</span>
          {p.autoBuy && view.all.autoBuyCredits > 0 && <span class="hub-dim">{tx().service.autoBuyCost(formatCredits(view.all.autoBuyCredits))}</span>}
        </label>
        <Act
          on={on}
          variant="primary"
          testId="repair-all"
          disabled={!view.all.ok}
          reason={p.available ? tx().service.cannotRepair : tx().service.noRepairService}
          onClick={() => on.action({ type: 'repair', partIds: 'all', autoBuy: p.autoBuy })}
          aside={view.all.text}
        >
          {tx().service.repairAll}
        </Act>
      </div>
    </section>
  );
}
