// Market – parts (M2, 4.5): bought parts go to station storage, only parts from storage can be sold.
// A part row opens to its explanation: what it does and what it would change on the player's ship.
import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import type { PartKey, Tier } from '../../data/parts';
import { partInfo } from '../../game/partInfo';
import type { PartMarketRow } from '../../game/stationView';
import { tx } from '../../i18n';
import type { GameActionInput } from '../../sim/commands';
import type { ShipGrid } from '../../sim/ship/types';
import { formatCredits } from '../format';
import { PartChip } from '../theme';
import { Act, type ClickSound } from './Act';
import { PartAbout, ShipEffect } from './PartInfo';
import type { QtyMode } from './trade';

export interface PartsMarketProps {
  rows: PartMarketRow[];
  ring: number;
  qty: QtyMode;
  tier: Tier;
  /** The player's ship – the opened row shows what the part would change on it. */
  ship?: ShipGrid;
  on: ClickSound & { action(action: GameActionInput): void };
}

/** The explanation row under an opened part. */
function PartInfoRow({ partKey, ship }: { partKey: PartKey; ship: ShipGrid }) {
  const info = partInfo(ship, partKey);
  return (
    <tr class="hub-part-info" id={`part-info-${partKey}`} data-testid={`part-info-${partKey}`}>
      <td colSpan={5}>
        <div class="hub-part-info-body">
          <PartAbout info={info} />
          <ShipEffect info={info} />
        </div>
      </td>
    </tr>
  );
}

/** How many pieces to buy / sell at the selected quantity (Max = as many as possible). */
const pieces = (qty: QtyMode, limit: number): number => Math.max(0, Math.min(qty === 'max' ? limit : qty, limit));

export function PartsMarket(p: PartsMarketProps) {
  const { on } = p;
  const [open, setOpen] = useState<PartKey | null>(null);
  return (
    <>
      {p.ship && <p class="hub-note hub-parts-hint">{tx().partInfo.market.hint}</p>}
      <table class="hub-table hub-parts-table">
        <thead>
          <tr>
            <th scope="col">{tx().market.part}</th>
            <th scope="col" class="num">
              {tx().market.inStorage}
            </th>
            <th scope="col" class="num">
              {tx().market.buyPrice}
            </th>
            <th scope="col" class="num">
              {tx().market.sellPrice}
            </th>
            <th scope="col">
              <span class="af-sr-only">{tx().market.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {p.rows.map((r) => {
            const buy = pieces(p.qty, r.maxBuy);
            const sell = pieces(p.qty, r.inStorage);
            const opened = open === r.key && p.ship !== undefined;
            return (
              <Fragment key={r.key}>
              <tr data-testid={`part-${r.key}`} class={opened ? 'is-open' : undefined}>
                <th scope="row">
                  {p.ship ? (
                    <button
                      type="button"
                      class="hub-part-toggle af-focusable"
                      aria-expanded={opened}
                      aria-controls={opened ? `part-info-${r.key}` : undefined}
                      data-testid={`part-toggle-${r.key}`}
                      onClick={() => {
                        on.click();
                        setOpen(opened ? null : r.key);
                      }}
                    >
                      <PartChip partId={r.partId} tier={r.tier} />
                      <span class="hub-part-chevron" aria-hidden="true" />
                    </button>
                  ) : (
                    <PartChip partId={r.partId} tier={r.tier} />
                  )}
                </th>
                <td class={`num${r.inStorage === 0 ? ' is-zero' : ''}`}>{r.inStorage}</td>
                <td class="num hub-price-buy">
                  {r.buy === null ? <span class="hub-not-sold">{tx().market.notSoldHere(p.ring)}</span> : formatCredits(r.buy)}
                </td>
                <td class="num hub-price-sell">{formatCredits(r.sell)}</td>
                <td class="hub-actions">
                  <span class="hub-action-pair">
                    <Act
                      on={on}
                      size="sm"
                      testId={`buy-part-${r.key}`}
                      disabled={r.buy === null || buy === 0 || r.locked !== null}
                      reason={r.locked ?? (r.buy === null ? tx().market.notSoldHere(p.ring) : tx().market.notEnoughCredits)}
                      onClick={() => on.action({ type: 'buyPart', key: r.key, count: buy })}
                      aside={buy > 1 ? `×${buy}` : undefined}
                    >
                      {tx().market.buy}
                    </Act>
                    <Act
                      on={on}
                      size="sm"
                      testId={`sell-part-${r.key}`}
                      disabled={!r.canSell || sell === 0}
                      reason={tx().market.noPartsToSell}
                      onClick={() => on.action({ type: 'sellPart', key: r.key, count: sell })}
                      aside={sell > 1 ? `×${sell}` : undefined}
                    >
                      {tx().market.sell}
                    </Act>
                  </span>
                </td>
              </tr>
              {opened && <PartInfoRow partKey={r.key} ship={p.ship!} />}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <p class="hub-note">{tx().market.partsNote}</p>
    </>
  );
}
