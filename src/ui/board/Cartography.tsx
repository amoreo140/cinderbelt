// Cartography on the station Board (sectors design §4.2, stage 2): the player's own charts the Guild
// buys and the Guild charts for sale, each a row with the sector's security swatch (colour + pattern,
// the same as the map), knowledge glyph, depth, what it is worth and one action. A trade asks for
// confirmation first; the toast comes with the simulation's event. The rules the player must not
// misread stay on screen: a chart never shows caches, Echoes or wreck contents, Data are not for sale.
import { useState } from 'preact/hooks';
import type { CartographyView, ChartRow } from '../../game/board/cartographyView';
import { tx } from '../../i18n';
import type { GameActionInput } from '../../sim/commands';
import { Heading, Lamp, Modal, Panel } from '../theme';
import { Act, type ClickSound } from '../station/Act';
import '../sectors/sectors.css';
import './cartography.css';

export interface CartographyHandlers extends ClickSound {
  action(action: GameActionInput): void;
}

const t = () => tx().sectors.charts;

function Row({ r, onTrade, on }: { r: ChartRow; onTrade: (r: ChartRow) => void; on: ClickSound }) {
  const own = r.side === 'sell';
  const done = r.state === 'sold' || r.state === 'reserved';
  return (
    <li class={`ct-row is-${r.state}`} data-security={r.security} data-testid={`chart-${r.id}`} data-state={r.state}>
      <span class="ct-swatch" aria-hidden="true" />
      <div class="ct-id">
        <span class="ct-name">
          <span class="sc-glyph" data-knowledge={r.knowledge}>
            {r.glyph}
          </span>{' '}
          {r.name}
        </span>
        <span class="ct-sub">
          <span class="ct-sec">{r.securityWord}</span> · {r.depthLine} · {r.distance}
        </span>
        <span class="ct-detail">{r.detail}</span>
      </div>
      <div class="ct-trade">
        {done ? (
          <span class="ct-stamp af-label">{r.state === 'sold' ? t().sold : t().reserved}</span>
        ) : (
          <>
            <strong class="ct-price">{r.priceText}</strong>
            <Act
              on={on}
              size="sm"
              variant={own ? 'primary' : 'secondary'}
              disabled={r.state === 'blocked'}
              {...(r.reason ? { reason: r.reason } : {})}
              testId={`chart-${own ? 'sell' : 'buy'}-${r.id}`}
              onClick={() => onTrade(r)}
            >
              {own ? t().sell : t().buy}
            </Act>
          </>
        )}
      </div>
    </li>
  );
}

export function Cartography({ d, on }: { d: CartographyView; on: CartographyHandlers }) {
  const [confirm, setConfirm] = useState<{ kind: 'sell' | 'buy'; row: ChartRow } | null>(null);
  const c = t();
  const trade = (row: ChartRow) => setConfirm({ kind: row.side, row });
  return (
    <div class="ct" data-testid="cartography" aria-label={c.tab}>
      <Panel material="screen" cut="sm" class="ct-rules">
        <span class="ct-rule">
          <Lamp state="info" /> {c.intro}
        </span>
        <span class="ct-rule ct-rule--never" data-testid="cartography-never">
          <Lamp state="warn" /> {c.never}
        </span>
      </Panel>
      <section class="bd-section">
        <Heading aside={d.sellable.count > 0 ? d.sellable.text : undefined}>{c.sellTitle}</Heading>
        <p class="bd-empty">{c.sellNote}</p>
        {d.sell.length === 0 ? (
          <p class="ct-empty" data-testid="cartography-empty-sell">
            {c.emptySell}
          </p>
        ) : (
          <ul class="ct-list">
            {d.sell.map((r) => (
              <Row key={r.id} r={r} on={on} onTrade={trade} />
            ))}
          </ul>
        )}
      </section>
      <section class="bd-section">
        <Heading>{c.buyTitle}</Heading>
        <p class="bd-empty">{c.buyNote}</p>
        {d.buy.length === 0 ? (
          <p class="ct-empty" data-testid="cartography-empty-buy">
            {c.emptyBuy}
          </p>
        ) : (
          <ul class="ct-list">
            {d.buy.map((r) => (
              <Row key={r.id} r={r} on={on} onTrade={trade} />
            ))}
          </ul>
        )}
        {d.more > 0 && <p class="bd-empty">{c.more(d.more)}</p>}
      </section>
      {confirm && (
        <Modal
          title={confirm.kind === 'sell' ? c.confirmSell(confirm.row.name) : c.confirmBuy(confirm.row.name)}
          confirmLabel={`${confirm.kind === 'sell' ? c.sell : c.buy} · ${confirm.row.priceText}`}
          cancelLabel={c.cancel}
          cancelKey="Esc"
          onCancel={() => {
            on.click();
            setConfirm(null);
          }}
          onConfirm={() => {
            on.click();
            const sector = confirm.row.id;
            setConfirm(null);
            on.action(confirm.kind === 'sell' ? { type: 'chartSell', sector } : { type: 'chartBuy', sector });
          }}
        >
          <p data-testid="chart-confirm-body">{confirm.kind === 'sell' ? c.confirmSellBody(confirm.row.priceText) : c.confirmBuyBody(confirm.row.priceText)}</p>
        </Modal>
      )}
    </div>
  );
}
