// Paint shop ("Paint shop", M4c, T3) on the Development tab: the ships at home, the paint
// swatches and "Paint". Hovering a swatch previews it on the ship (handler `preview`, render-only
// UI state); leaving the swatches goes back to the clicked one. Enter on a swatch paints it.
// `PaintSwatch` is the paint chip shared with the Hangar card.
import { useRef } from 'preact/hooks';
import { PAINT_IDS, PAINT_SWATCH, type PaintId } from '../../data/paints';
import type { DevelopmentHandlers, PaintShopData } from '../../game/home/types';
import { tx } from '../../i18n';
import { Button, Lamp, useTip } from '../theme';

const t = () => tx().home.paintShop;

/** A paint's colour chip (its hull swatch) with the name for screen readers. */
export function PaintSwatch({ paint, size = 'sm', label = true }: { paint: PaintId; size?: 'sm' | 'lg'; label?: boolean }) {
  return (
    <span class={`dv-swatch dv-swatch--${size}`} style={{ '--paint': PAINT_SWATCH[paint] }} role={label ? 'img' : undefined} aria-label={label ? tx().home.paints[paint] : undefined} aria-hidden={label ? undefined : 'true'} />
  );
}

/** The paint chip of a Hangar card: swatch + "Lak: Grafit". */
export function PaintChip({ paint, testId }: { paint: PaintId; testId?: string }) {
  return (
    <span class="dv-paint-chip" data-testid={testId} data-paint={paint}>
      <PaintSwatch paint={paint} label={false} />
      {t().chip(tx().home.paints[paint])}
    </span>
  );
}

function SwatchOption(p: {
  paint: PaintId;
  pressed: boolean;
  current: boolean;
  onHover(): void;
  onPick(): void;
  onApply(): void;
}) {
  const tip = useTip(tx().home.paints[p.paint], 'info');
  return (
    <button
      type="button"
      class={`af-segmented-opt dv-swatch-opt af-focusable${p.current ? ' is-current' : ''}`}
      aria-pressed={p.pressed}
      data-testid={`paint-${p.paint}`}
      onClick={p.onPick}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        // Enter on a swatch picks it and paints (a click on it only picks)
        e.preventDefault();
        p.onPick();
        p.onApply();
      }}
      {...tip}
      onPointerEnter={(e) => {
        tip.onPointerEnter(e);
        p.onHover();
      }}
    >
      <PaintSwatch paint={p.paint} size="lg" />
    </button>
  );
}

export function PaintShop({ d, on, click }: { d: PaintShopData; on: DevelopmentHandlers; click?: () => void }) {
  const ship = d.ships.find((s) => s.shipId === d.selectedShip) ?? d.ships[0] ?? null;
  // the clicked paint; a hover previews another one until the pointer leaves the swatches
  const picked = useRef<PaintId | null>(d.preview);
  const hovering = useRef(false);
  if (!hovering.current) picked.current = d.preview;
  const shown = d.preview ?? ship?.paint ?? 'factory';
  const reason = !ship ? tx().actionErrors.shipNotHome : d.preview === null ? t().pick : d.preview === ship.paint ? tx().actionErrors.samePaint : undefined;
  const apply = () => {
    if (reason !== undefined) return;
    click?.();
    on.paint();
  };
  return (
    <section class="dv-paint" data-testid="paint-shop">
      <div class="dv-field">
        <span class="af-label dv-field-label">{t().ship}</span>
        <div class="dv-ships" role="group" aria-label={t().ship}>
          {d.ships.map((s) => (
            <button
              type="button"
              key={s.shipId}
              class="dv-ship af-focusable"
              aria-pressed={s.shipId === ship?.shipId}
              data-testid={`paint-ship-${s.shipId}`}
              onClick={() => {
                click?.();
                on.selectShip(s.shipId);
              }}
            >
              <PaintSwatch paint={s.shipId === ship?.shipId ? shown : s.paint} />
              <span class="dv-ship-name">{s.name}</span>
              <span class="dv-ship-where">
                <Lamp state={s.where === 'docked' ? 'ok' : 'off'} />
                {tx().home.where[s.where]}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div class="dv-field">
        <span class="af-label dv-field-label">{t().paint}</span>
        <div
          class="af-segmented dv-swatches"
          role="group"
          aria-label={t().paint}
          onPointerEnter={() => (hovering.current = true)}
          onPointerLeave={() => {
            hovering.current = false;
            on.preview(picked.current);
          }}
        >
          {PAINT_IDS.map((paint) => (
            <SwatchOption
              key={paint}
              paint={paint}
              pressed={shown === paint}
              current={ship?.paint === paint}
              onHover={() => {
                if (d.preview !== paint) on.preview(paint);
              }}
              onPick={() => {
                click?.();
                picked.current = paint;
                on.preview(paint);
              }}
              onApply={() => {
                if (ship && paint !== ship.paint) {
                  click?.();
                  on.paint();
                }
              }}
            />
          ))}
        </div>
        <p class="dv-paint-name" data-testid="paint-name">
          <b>{tx().home.paints[shown]}</b>
          {ship && shown !== ship.paint && <span class="hub-dim"> · {t().current(tx().home.paints[ship.paint])}</span>}
        </p>
      </div>
      <div class="dv-actions">
        <Button variant="primary" keyHint="Enter" aside={t().free} disabled={reason !== undefined} reason={reason} testId="paint-apply" onClick={apply}>
          {t().apply}
        </Button>
      </div>
      <p class="hub-note dv-note">{t().previewHint}</p>
    </section>
  );
}
