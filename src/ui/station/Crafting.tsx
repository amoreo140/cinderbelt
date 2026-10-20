// Crafting tab (M2, 4.7; "Hull language" design system (Jazyk trupu), ch. 9): recipes on the left, the detail on a plate on the right.
import type { PartKey, Tier } from '../../data/parts';
import { partInfo } from '../../game/partInfo';
import type { CraftRow } from '../../game/stationView';
import { tx } from '../../i18n';
import { assetUrl } from '../../render/assets/url';
import type { GameActionInput } from '../../sim/commands';
import type { ShipGrid } from '../../sim/ship/types';
import { formatAmount, formatCredits, formatInt } from '../format';
import { Heading, Lamp, Panel, PartChip, ResourceChip, Segmented } from '../theme';
import { Act, type ClickSound } from './Act';
import { PartAbout, ShipEffect } from './PartInfo';
import { PartStatsLine } from './partStats';

export interface CraftingProps {
  rows: CraftRow[];
  tier: Tier;
  selected: PartKey | null;
  count: number;
  available: boolean;
  /** The player's ship – "On your ship" shows what the selected part would change on it. */
  ship?: ShipGrid;
  on: ClickSound & {
    action(action: GameActionInput): void;
    setCraft(patch: { craftTier?: Tier; craftKey?: PartKey; craftCount?: number }): void;
    openShipyard(): void;
  };
}

const whole = (v: number): string => (Math.abs(v - Math.round(v)) < 1e-9 ? formatInt(v) : formatAmount(v));

export function Crafting(p: CraftingProps) {
  const { on } = p;
  const row = p.rows.find((r) => r.key === p.selected) ?? p.rows.find((r) => r.canCraft) ?? p.rows[0]!;
  const max = Math.max(1, row.maxCount);
  const count = Math.min(Math.max(1, p.count), max);
  const missing = row.ingredients.filter((i) => !i.ok);
  const info = p.ship ? partInfo(p.ship, row.key) : null;
  const reason = !p.available
    ? tx().crafting.unavailable
    : row.locked
      ? row.locked
    : missing.length > 0
      ? tx().crafting.missing(missing.map((i) => `${whole(i.need * count - i.have)} ${i.name}`).join(', '))
      : !row.credits.ok
        ? tx().crafting.missingCredits(formatCredits(row.credits.need * count))
        : undefined;
  return (
    <div class="hub-craft">
      <div class="hub-toolbar">
        <span class="hub-toolbar-label">{tx().crafting.tier}</span>
        <Segmented
          label={tx().crafting.tier}
          options={([1, 2] as const).map((t) => ({ value: t, label: tx().tiers[t] }))}
          value={p.tier}
          onChange={(t) => {
            on.click();
            on.setCraft({ craftTier: t, craftKey: undefined, craftCount: 1 });
          }}
        />
      </div>
      <div class="hub-craft-grid">
        <nav class="hub-recipes" aria-label={tx().crafting.recipes}>
          {p.rows.map((r) => (
            <button
              type="button"
              key={r.key}
              class={`hub-recipe af-focusable${r.key === row.key ? ' is-selected' : ''}`}
              aria-pressed={r.key === row.key}
              data-testid={`recipe-${r.key}`}
              onClick={() => {
                on.click();
                on.setCraft({ craftKey: r.key, craftCount: 1 });
              }}
            >
              <PartChip partId={r.partId} tier={r.tier} {...(r.variant ? { variant: tx().discovery.variants[r.variant] } : {})} />
              <Lamp state={r.canCraft ? 'ok' : 'off'} label={r.canCraft ? tx().crafting.ready : r.locked ?? undefined} />
            </button>
          ))}
        </nav>
        <Panel material="plate" cut="md" trim="top" tier={row.tier} class="hub-craft-detail" testId="craft-detail">
          {/* the detail body scrolls on its own; the craft action stays pinned to the plate's bottom */}
          <div class="hub-craft-body" data-testid="craft-body">
            <div class={`hub-craft-title af-tier-${row.tier}`}>
              <span class="af-tier-frame hub-craft-icon">
                <img src={assetUrl(row.icon)} alt="" />
              </span>
              <div>
                <h3>
                  {row.name} <span class="af-part-tier">T{row.tier}</span>
                </h3>
                <PartStatsLine stats={row.stats} />
              </div>
            </div>
            {info && (
              <div class="hub-craft-info">
                <PartAbout info={info} />
                <ShipEffect info={info} />
              </div>
            )}
            <Panel material="screen" cut="sm" class="hub-craft-needs">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{tx().crafting.need}</th>
                    <th scope="col" class="num">
                      {count > 1 ? `${count} ×` : ''}
                    </th>
                    <th scope="col" class="num">
                      {tx().crafting.have} <small>{tx().crafting.haveHint}</small>
                    </th>
                    <th scope="col">
                      <span class="af-sr-only">{tx().crafting.status}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {row.ingredients.map((i) => {
                    const ok = i.have + 1e-9 >= i.need * count;
                    return (
                      <tr key={i.resource}>
                        <th scope="row">
                          <ResourceChip id={i.resource} name />
                        </th>
                        <td class="num">{whole(i.need * count)}</td>
                        <td class={`num${ok ? '' : ' is-short'}`}>{formatAmount(i.have)}</td>
                        <td>
                          <Lamp state={ok ? 'ok' : 'bad'} />
                        </td>
                      </tr>
                    );
                  })}
                  <tr class="hub-craft-fee">
                    <th scope="row">{tx().crafting.fee}</th>
                    <td class="num">{formatCredits(row.credits.need * count)}</td>
                    <td class={`num${row.credits.have >= row.credits.need * count ? '' : ' is-short'}`}>{formatCredits(row.credits.have)}</td>
                    <td>
                      <Lamp state={row.credits.have >= row.credits.need * count ? 'ok' : 'bad'} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </Panel>
            <dl class="hub-craft-facts">
              <div>
                <dt>{tx().crafting.marketPrice}</dt>
                <dd>{row.marketBuy === null ? <span class="hub-dim">{tx().crafting.notSold}</span> : formatCredits(row.marketBuy)}</dd>
              </div>
              <div>
                <dt>{tx().crafting.inStorage}</dt>
                <dd data-testid="craft-in-storage">{row.inStorage}</dd>
              </div>
              <div>
                <dt>{tx().crafting.onShip}</dt>
                <dd>{row.onShip}</dd>
              </div>
            </dl>
            <div class="hub-craft-foot">
              <p class="hub-note">{tx().crafting.fromStorageFirst}</p>
              <Act on={on} size="sm" variant="ghost" keyHint="3" onClick={on.openShipyard}>
                {tx().crafting.openShipyard}
              </Act>
            </div>
          </div>
          <div class="hub-craft-actions" data-testid="craft-actions">
            <span class="hub-stepper" role="group" aria-label={tx().crafting.count}>
              <span class="hub-toolbar-label">{tx().crafting.count}</span>
              <Act on={on} size="sm" variant="ghost" disabled={count <= 1} onClick={() => on.setCraft({ craftKey: row.key, craftCount: count - 1 })}>
                −
              </Act>
              <output class="hub-stepper-value" data-testid="craft-count">
                {count}
              </output>
              <Act on={on} size="sm" variant="ghost" disabled={count >= max} onClick={() => on.setCraft({ craftKey: row.key, craftCount: count + 1 })}>
                +
              </Act>
              <span class="hub-dim hub-stepper-max">{tx().crafting.max(row.maxCount)}</span>
            </span>
            <Act
              on={on}
              variant="primary"
              block
              testId="craft"
              disabled={reason !== undefined || row.maxCount < count}
              reason={reason}
              onClick={() => on.action({ type: 'craft', key: row.key, count })}
              aside={formatCredits(row.credits.need * count)}
            >
              {tx().crafting.craft}
            </Act>
          </div>
        </Panel>
      </div>
    </div>
  );
}
