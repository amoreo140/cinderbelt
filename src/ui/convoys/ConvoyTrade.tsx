// The convoy trade window "Obchod konvoja" (M4d plan T11, §1, §2.6): open while the ship is linked to a
// convoy trader (`GameUiData.convoyTrade`). Like the derelict terminal it is the career-overlay sheet (a
// hull plate in a dark frame, never glass): the rare goods of the pass on the left (a plan fragment, a
// variant part, a T2 part in ring 1 – each once per pass, with the reason when it cannot be bought), the
// cargo sale and the tanker's fuel on the right, "Disconnect" (F) in the foot. Keyboard: the focus stays in
// the sheet (Tab and the arrow keys walk the buttons, Enter presses), F or Esc unlinks; keys pressed in
// the window never reach the game. Data: `ConvoyTradeData` (src/game/convoys/types.ts, the game layer).
import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { REFINED_BONUS } from '../../data/workshop';
import { parsePartKey } from '../../data/parts';
import type { ConvoySellRow, ConvoyTradeData, ConvoyTradeHandlers, ConvoyTradeItem } from '../../game/convoys/types';
import { tx } from '../../i18n';
import { formatCredits, formatInt, formatPercent, formatPrice } from '../format';
import { Button, Credits, Heading, KeyHint, Lamp, PartChip, ResourceChip, Segmented } from '../theme';
import '../board/overlays.css';
import { arrowStep, fuelButtons, fuelPrice, itemRows, sellAmount, sellValue, TRADE_QTY, type TradeQty } from './tradeLayout';
import './convoys.css';
import { pure, sameDeep } from '../pure';

const t = () => tx().guild.trade;

const FOCUSABLE = 'button, [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/** Tab / Shift+Tab and the arrow keys cycle inside `root` (the game's own keys must not fire). */
function moveFocus(e: KeyboardEvent, root: HTMLElement | null, dir: 1 | -1): void {
  const list = focusables(root);
  e.preventDefault();
  const next = arrowStep(list.length, list.indexOf(document.activeElement as HTMLElement), dir);
  if (next >= 0) list[next]!.focus();
}

/** The first thing to focus: a buyable item, a sell or fuel button, else "Disconnect". */
function firstFocus(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>('.cv-act:not([aria-disabled="true"])') ?? root.querySelector<HTMLElement>('.cv-leave');
}

/** A plan-fragment glyph (a rolled blueprint), the same as the derelict terminal's. */
function PlanGlyph() {
  return (
    <span class="cv-glyph" aria-hidden="true">
      <svg viewBox="0 0 20 20">
        <rect x="3" y="4" width="14" height="12" />
        <path d="M6 8 H14 M6 11 H11 M6 13.5 H9" />
      </svg>
    </span>
  );
}

function ItemRow({ item, on }: { item: ConvoyTradeItem; on: ConvoyTradeHandlers }) {
  const part = item.part ? parsePartKey(item.part) : null;
  const sold = item.state === 'sold';
  return (
    <li class={`cv-item is-${item.state}`} data-testid={`convoy-item-${item.slot}`} data-state={item.state}>
      <span class="cv-item-icon">{part ? <PartChip partId={part.partId} tier={part.tier} compact /> : <PlanGlyph />}</span>
      <span class="cv-item-text">
        <span class="cv-item-title">{item.title}</span>
        <span class="cv-item-detail">{item.detail}</span>
      </span>
      <span class="cv-item-price">{formatCredits(item.price)}</span>
      {sold ? (
        <span class="cv-sold" data-testid={`convoy-sold-${item.slot}`}>
          <Lamp state="ok" />
          {t().sold}
        </span>
      ) : (
        <Button
          size="sm"
          class="cv-act"
          disabled={item.state !== 'buyable'}
          {...(item.reason ? { reason: item.reason } : {})}
          onClick={() => on.buy(item.slot)}
          testId={`convoy-buy-${item.slot}`}
        >
          {t().buy}
        </Button>
      )}
      {!sold && item.state !== 'buyable' && item.reason && <span class="cv-reason">{item.reason}</span>}
    </li>
  );
}

function SellRow({ row, qty, capLeft, on }: { row: ConvoySellRow; qty: TradeQty; capLeft: number; on: ConvoyTradeHandlers }) {
  const amount = capLeft >= 1 ? sellAmount(qty, row) : null;
  const value = amount === null ? 0 : sellValue(row, amount);
  const refined = Math.floor(row.refined + 1e-9);
  const reason = capLeft < 1 ? t().capReached : t().nothingToSell;
  return (
    <li class="cv-sell-row" data-testid={`convoy-sell-${row.resource}`}>
      <span class="cv-sell-res">
        <ResourceChip id={row.resource} name />
        {refined >= 1 && (
          <span class="af-label cv-refined" title={t().refinedTip(formatPercent(Math.round(REFINED_BONUS * 100), 0, true))}>
            {t().refined(formatInt(refined))}
          </span>
        )}
      </span>
      <span class="cv-sell-have">
        {formatInt(Math.floor(row.max + 1e-9))} {tx().units.unit}
      </span>
      <span class="cv-sell-unit">{t().unitPrice(formatPrice(row.unit))}</span>
      <Button
        size="sm"
        class="cv-act"
        disabled={amount === null}
        reason={reason}
        {...(amount !== null ? { hint: t().sellQuote(formatCredits(value)) } : {})}
        aside={amount !== null ? formatCredits(value) : undefined}
        onClick={() => amount !== null && on.sell(row.resource, amount)}
        testId={`convoy-sell-${row.resource}-act`}
      >
        {t().sellAction}
      </Button>
    </li>
  );
}

function FuelRow({ fuel, on }: { fuel: NonNullable<ConvoyTradeData['fuel']>; on: ConvoyTradeHandlers }) {
  const b = fuelButtons(fuel);
  const none = b.full === null;
  return (
    <div class="cv-fuel" data-testid="convoy-fuel">
      <span class="cv-fuel-line">
        <span class="cv-fuel-unit">{t().unitPrice(formatPrice(fuel.unit))}</span>
        <span class="cv-fuel-max">{t().fuelMax(`${formatInt(Math.floor(fuel.max + 1e-9))} ${tx().units.unit}`)}</span>
      </span>
      <span class="cv-fuel-acts">
        {b.step !== null && (
          <Button size="sm" class="cv-act" onClick={() => on.fuel(b.step!)} aside={formatCredits(fuelPrice(fuel.unit, b.step))} testId="convoy-fuel-step">
            {t().refuel(`${b.step} ${tx().units.unit}`)}
          </Button>
        )}
        <Button
          size="sm"
          class="cv-act"
          disabled={none}
          reason={fuel.reason ?? t().reasons.fuelCap}
          aside={none ? undefined : formatCredits(fuelPrice(fuel.unit, fuel.max))}
          onClick={() => !none && on.fuel('full')}
          testId="convoy-fuel-full"
        >
          {t().refuelFull}
        </Button>
      </span>
      {none && fuel.reason && <span class="cv-reason">{fuel.reason}</span>}
    </div>
  );
}

/**
 * The window's body: the rare goods, the cargo sale and the tanker. Memoised (audit 2026-10-17 P7): the
 * game rebuilds the trade data 10× per second while linked, the body redraws only when it changed; the
 * window around it keeps its focus check on every redraw.
 */
function TradeBodyView({ d, on, qty, setQty }: { d: ConvoyTradeData; on: ConvoyTradeHandlers; qty: TradeQty; setQty: (q: TradeQty) => void }) {
  const tt = t();
  const capLeft = Math.max(0, Math.floor(d.capLeft + 1e-9));
  return (
    <div class="co-body af-on-plate cv-body">
      <section class="cv-col cv-rare" aria-label={tt.rare} data-testid="convoy-rare">
        <Heading>{tt.rare}</Heading>
        <ul class="cv-items">
          {itemRows(d.items).map((item) => (
            <ItemRow key={item.slot} item={item} on={on} />
          ))}
        </ul>
      </section>
      <div class="cv-col cv-right">
        <section aria-label={tt.sell} data-testid="convoy-sell">
          <Heading
            aside={
              <span class={`cv-cap${capLeft < 1 ? ' is-full' : ''}`} data-testid="convoy-cap">
                {capLeft < 1 && <Lamp state="warn" />}
                {capLeft < 1 ? tt.capReached : tt.capLeft(`${formatInt(capLeft)} ${tx().units.unit}`)}
              </span>
            }
          >
            {tt.sell}
          </Heading>
          {d.sell.length === 0 ? (
            <p class="cv-note">{tt.noCargo}</p>
          ) : (
            <>
              {capLeft >= 1 && (
                <div class="cv-qty">
                  <span class="af-label">{tt.quantity}</span>
                  <Segmented label={tt.quantity} options={TRADE_QTY.map((q) => ({ value: q, label: q === 'max' ? tt.max : String(q) }))} value={qty} onChange={setQty} />
                </div>
              )}
              <ul class="cv-sell-rows">
                {d.sell.map((row) => (
                  <SellRow key={row.resource} row={row} qty={qty} capLeft={capLeft} on={on} />
                ))}
              </ul>
            </>
          )}
        </section>
        <section aria-label={tt.tanker} data-testid="convoy-tanker">
          <Heading>{tt.tanker}</Heading>
          {d.fuel ? <FuelRow fuel={d.fuel} on={on} /> : <p class="cv-note" data-testid="convoy-no-tanker">{tt.noTanker}</p>}
        </section>
      </div>
    </div>
  );
}

const TradeBody = pure(TradeBodyView, sameDeep);

export interface ConvoyTradeProps {
  d: ConvoyTradeData;
  on: ConvoyTradeHandlers;
  /** Kit: drawn in place, without the backdrop and without taking the focus. */
  inline?: boolean;
}

export function ConvoyTrade({ d, on, inline = false }: ConvoyTradeProps) {
  const sheet = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [qty, setQty] = useState<TradeQty>('max');
  const tt = t();

  // the focus goes into the sheet on open and comes back when the focused button went away (an item
  // bought) – right after the commit, so a key pressed next still lands in the window
  useLayoutEffect(() => {
    if (inline) return;
    const el = sheet.current;
    if (!el || el.contains(document.activeElement)) return;
    (firstFocus(el) ?? el).focus({ preventScroll: true });
  });

  const onKeyDown = (e: KeyboardEvent) => {
    // keys typed in the window never reach the game (thrust, scanner Tab, map…)
    e.stopPropagation();
    if (inline) return;
    if (e.key === 'Tab') return moveFocus(e, sheet.current, e.shiftKey ? -1 : 1);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') return moveFocus(e, sheet.current, 1);
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') return moveFocus(e, sheet.current, -1);
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape' || e.code === 'KeyF') {
      e.preventDefault();
      on.unlink();
    }
  };

  const content = (
    <div
      ref={sheet}
      class="co-sheet cv-sheet"
      role={inline ? 'group' : 'dialog'}
      aria-modal={inline ? undefined : 'true'}
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="convoy-trade"
      data-pass={d.pass}
      onKeyDown={inline ? undefined : onKeyDown}
    >
      <header class="co-head">
        <div class="cv-head-what">
          <span class="af-label co-kicker">
            {tt.title} · {tt.ring(d.ring)}
          </span>
          <h2 class="co-title cv-title" id={titleId}>
            {d.trader}
          </h2>
        </div>
        <div class="cv-credits">
          <span class="af-label">{tt.credits}</span>
          <Credits value={d.credits} testId="convoy-credits" />
        </div>
      </header>
      <TradeBody d={d} on={on} qty={qty} setQty={setQty} />
      <footer class="co-foot">
        <KeyHint keys={['F', 'Esc']}>{tt.unlinkHint}</KeyHint>
        <span class="grow" />
        <Button variant="primary" keyHint="F" class="cv-leave" onClick={() => on.unlink()} testId="convoy-unlink">
          {tt.unlink}
        </Button>
      </footer>
    </div>
  );

  if (inline) return <div class="cv-inline">{content}</div>;
  // a click on the dark frame keeps the focus in the sheet
  return (
    <div
      class="co-backdrop co-backdrop--light cv-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
      }}
    >
      {content}
    </div>
  );
}
