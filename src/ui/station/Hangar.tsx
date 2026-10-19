// Hangar modal (M4a T5): the player's ships as plate
// cards – silhouette, name (rename inline), class, hull points, condition, cargo, fuel, ship log and
// where the ship stands – with "Switch" / "Dismantle", the free slots here, the next slot to buy and
// "New ship" from a cockpit. Draws a `HangarView` (src/game/fleet/types.ts) and calls
// `HangarHandlers`; every disabled action shows the view model's reason.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { CockpitOption, HangarHandlers, HangarView, ShipCardView } from '../../game/fleet/types';
import { parsePartKey } from '../../data/parts';
import { SHIP_NAME_MAX } from '../../data/fleet';
import { tx } from '../../i18n';
import { formatCredits } from '../format';
import { assetUrl } from '../../render/assets/url';
import { Button, Gauge, Heading, Lamp, Modal, Panel, ShipSilhouette } from '../theme';
import { PaintChip } from './PaintShop';
import { cockpitSourceLine, hangarEntries, renameValue, shipLogLine, shipWhere, slotSummary, type HangarOn } from './hangarFormat';
// after the theme – screen rules win over the component base
import '../board/overlays.css';
import './hangar.css';

const t = () => tx().fleet.hangar;

/** Focusable controls inside `root` in tab order (for the modal's focus trap). */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.hidden && el.offsetParent !== null);
}

/** Keeps Tab / Shift+Tab inside `root` (wraps around at both ends). */
export function trapTab(e: KeyboardEvent, root: HTMLElement | null): void {
  if (e.key !== 'Tab' || !root) return;
  const items = focusables(root);
  if (items.length === 0) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !root.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

function PencilIcon() {
  return (
    <svg class="hg-pencil" viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <path d="M8.2 1.2 10.8 3.8 4.2 10.4 1 11 1.6 7.8Z M7.1 2.3 9.7 4.9" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
    </svg>
  );
}

export interface ShipNameProps {
  name: string;
  /** The name is generated: the field starts empty with it as the placeholder. */
  generated: boolean;
  /** Saves the new name; null = back to the generated name. Called only when something changed. */
  onRename(name: string | null): void;
  click?(): void;
  /** `header` = the larger name of the Shipyard header. */
  size?: 'card' | 'header';
  testId?: string;
}

/** A ship's name that turns into a text field on click (Enter saves, Esc cancels, blur saves). */
export function ShipName(p: ShipNameProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const done = useRef(false);
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  const start = () => {
    p.click?.();
    done.current = false;
    setValue(p.generated ? '' : p.name);
    setEditing(true);
  };
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    // focus back on the name, so the keyboard user stays where they were
    setTimeout(() => button.current?.focus(), 0);
    if (!save) return;
    const next = renameValue(value);
    const changed = next === null ? !p.generated : p.generated || next !== p.name;
    if (changed) p.onRename(next);
  };
  const cls = `hg-name hg-name--${p.size ?? 'card'}`;
  if (editing) {
    return (
      <span class={`${cls} is-editing`}>
        <input
          ref={input}
          class="hg-name-input af-focusable"
          type="text"
          value={value}
          maxLength={SHIP_NAME_MAX}
          placeholder={p.generated ? p.name : undefined}
          aria-label={t().renameLabel}
          title={t().renameHint}
          data-testid={p.testId ? `${p.testId}-input` : undefined}
          onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              finish(true);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              finish(false);
            }
          }}
          onBlur={() => finish(true)}
        />
        <span class="hg-name-hint">{t().renameHint}</span>
      </span>
    );
  }
  return (
    <span class={cls}>
      <button ref={button} type="button" class="hg-name-btn af-focusable" onClick={start} aria-label={t().rename(p.name)} data-testid={p.testId}>
        <span class="hg-name-text">{p.name}</span>
        <PencilIcon />
      </button>
      {p.generated && <span class="af-label hg-name-tag">{t().generated}</span>}
    </span>
  );
}

/** What the modal asks before doing it. */
type Ask =
  | { kind: 'switch'; ship: ShipCardView }
  | { kind: 'dismantle'; ship: ShipCardView }
  | { kind: 'new'; option: CockpitOption }
  | { kind: 'buy'; price: number };

// the binding lives with the static helpers: the hub binds handlers without loading this lazy module
export { bindHangar, type HangarOn } from './hangarFormat';

function ShipCard({ ship, active, on, ask }: { ship: ShipCardView; active: ShipCardView | undefined; on: HangarOn; ask(a: Ask): void }) {
  const where = shipWhere(ship);
  const cargo = ship.cargo.cap > 0;
  return (
    <Panel
      material="plate"
      cut="md"
      trim={ship.active ? 'left' : 'none'}
      class={`hg-card${ship.active ? ' is-active' : ''}${ship.here ? ' is-here' : ' is-away'}`}
      testId={`hangar-ship-${ship.id}`}
      as="section"
      aria-label={ship.name}
    >
      <Panel material="screen" cut="sm" class="hg-sil">
        <ShipSilhouette silhouette={ship.silhouette} width={84} height={84} maxCell={12} gap={1} label={`${ship.name} – ${ship.tierLabel}`} />
      </Panel>
      <div class="hg-id">
        <span class="hg-kicker">
          <span class="af-label">{ship.active ? t().active : t().stored}</span>
          <span class={`hg-where${ship.here ? ' is-here' : ''}`} data-testid={`hangar-where-${ship.id}`}>
            <Lamp state={ship.here ? 'ok' : 'off'} />
            {where}
          </span>
          {ship.paint && <PaintChip paint={ship.paint} testId={`hangar-paint-${ship.id}`} />}
        </span>
        <ShipName name={ship.name} generated={ship.generated} onRename={(name) => on.rename(ship.id, name)} click={on.click} testId={`hangar-name-${ship.id}`} />
        <span class="hg-class">
          {ship.tierLabel}
          <span class="hg-dot" aria-hidden="true">
            ·
          </span>
          <span class="af-label">{tx().shipyard.ui.hull}</span> <b>{t().hullPoints(ship.hull.used, ship.hull.budget)}</b>
        </span>
        <span class="hg-log" title={tx().fleet.log.title}>
          <span class="af-label">{tx().fleet.log.title}</span> {shipLogLine(ship.log)}
        </span>
      </div>
      <Panel material="screen" cut="sm" class="hg-meters">
        <Gauge kind="hull" compact label={t().hpPct} value={Math.round(ship.hpPct * 100)} max={100} warnAt={0.6} critAt={0.3} segments={16} />
        {cargo ? (
          <Gauge kind="cargo" compact label={tx().hud.cargo} value={ship.cargo.used} max={ship.cargo.cap} decimals={1} invert segments={16} />
        ) : (
          <div class="hg-nocargo">
            <span class="af-gauge-label">{tx().hud.cargo}</span>
            <span>—</span>
          </div>
        )}
        <Gauge kind="fuel" compact label={t().fuelPct} value={Math.round(ship.fuelPct * 100)} max={100} segments={16} />
      </Panel>
      <div class="hg-actions">
        {ship.active ? (
          <>
            <span class="hg-active-note">{t().activeNote}</span>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="secondary"
              block
              disabled={ship.switchReason !== undefined}
              reason={ship.switchReason}
              hint={t().switchHint}
              testId={`hangar-switch-${ship.id}`}
              onClick={() => {
                on.click?.();
                // a switch away from loan parts is said first; otherwise it is one click
                if (active?.loanNote) ask({ kind: 'switch', ship });
                else on.switch(ship.id);
              }}
            >
              {t().switch}
            </Button>
            {ship.dismantle && (
              <Button
                size="sm"
                variant="ghost"
                block
                disabled={ship.dismantle.reason !== undefined}
                reason={ship.dismantle.reason}
                hint={t().dismantleHint}
                testId={`hangar-dismantle-${ship.id}`}
                onClick={() => {
                  on.click?.();
                  ask({ kind: 'dismantle', ship });
                }}
              >
                {t().dismantle}
              </Button>
            )}
          </>
        )}
      </div>
      {ship.loanNote && (
        <p class="hg-loan" data-testid="hangar-loan-note">
          <Lamp state="warn" />
          {ship.loanNote === 'dissolved' ? t().loan.dissolved : t().loan.returned}
        </p>
      )}
    </Panel>
  );
}

function FreeSlot() {
  return (
    <div class="hg-slot is-free" data-testid="hangar-free-slot">
      <span class="hg-slot-mark" aria-hidden="true" />
      <span class="hg-slot-text">
        <b>{t().freeSlot}</b>
        <small>{t().freeSlotHint}</small>
      </span>
    </div>
  );
}

function NextSlot({ price, reason, on, ask }: { price: number | null; reason?: string; on: HangarOn; ask(a: Ask): void }) {
  const locked = price === null;
  return (
    <div class={`hg-slot ${locked ? 'is-locked' : 'is-next'}`} data-testid="hangar-next-slot">
      <span class="hg-slot-mark" aria-hidden="true" />
      <span class="hg-slot-text">
        <b>{locked ? t().lockedSlot : t().nextSlot}</b>
        <small>{locked ? reason : t().nextSlotHint}</small>
      </span>
      {!locked && (
        <Button
          size="sm"
          variant="secondary"
          disabled={reason !== undefined}
          reason={reason}
          aside={formatCredits(price)}
          testId="hangar-buy-slot"
          onClick={() => {
            on.click?.();
            ask({ kind: 'buy', price });
          }}
        >
          {t().buySlot}
        </Button>
      )}
    </div>
  );
}

function NewShip({ v, on, ask }: { v: HangarView; on: HangarOn; ask(a: Ask): void }) {
  const n = t().newShip;
  const all = v.newShip.reason;
  return (
    <section class="hg-new" data-testid="hangar-new-ship" aria-label={n.title}>
      <div class="hg-new-text">
        <Heading>{n.title}</Heading>
        <p>{n.lead}</p>
      </div>
      <div class="hg-new-options">
        {v.newShip.cockpits.length === 0 && <p class="hg-dim">{n.none}</p>}
        {v.newShip.cockpits.map((o) => {
          const { partId, tier } = parsePartKey(o.key);
          const line = cockpitSourceLine(o);
          const reason = all ?? o.reason;
          return (
            <Button
              key={`${o.key}:${o.source}`}
              variant="secondary"
              disabled={reason !== undefined}
              reason={reason}
              aside={line.price}
              class="hg-cockpit"
              testId={`hangar-new-${o.key.replace(':', '-')}-${o.source}`}
              onClick={() => {
                on.click?.();
                ask({ kind: 'new', option: o });
              }}
            >
              <span class={`af-tier-frame af-tier-${tier} hg-cockpit-icon`}>
                <img src={assetUrl(`assets/icons/parts/${partId}_t${tier}.png`)} alt="" />
              </span>
              <span class="hg-cockpit-name">
                {tx().parts[partId]} T{tier}
              </span>
              <span class="hg-cockpit-src">{line.source}</span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}

function Confirm({ q, v, stationName, on, close }: { q: Ask; v: HangarView; stationName: string; on: HangarOn; close(): void }) {
  const active = v.ships.find((s) => s.active);
  const loan = active?.loanNote ? (
    <p class="hg-confirm-loan">
      <Lamp state="warn" />
      {active.loanNote === 'dissolved' ? t().loan.dissolved : t().loan.returned}
    </p>
  ) : null;
  const run = (fn: () => void) => () => {
    on.click?.();
    close();
    fn();
  };
  if (q.kind === 'buy') {
    return (
      <Modal title={t().buyTitle} confirmLabel={t().buyConfirm} cancelLabel={t().back} confirmKey="Enter" cancelKey="Esc" onConfirm={run(() => on.buySlot())} onCancel={close}>
        {t().buyBody(formatCredits(q.price), stationName)}
      </Modal>
    );
  }
  if (q.kind === 'switch') {
    return (
      <Modal title={active?.loanNote ? t().loan.title : t().switchTitle(q.ship.name)} confirmLabel={t().switchConfirm} cancelLabel={t().back} confirmKey="Enter" cancelKey="Esc" onConfirm={run(() => on.switch(q.ship.id))} onCancel={close}>
        {t().switchTitle(q.ship.name)}
        {loan}
      </Modal>
    );
  }
  if (q.kind === 'new') {
    const { partId, tier } = parsePartKey(q.option.key);
    const cockpit = `${tx().parts[partId]} T${tier}`;
    const price = cockpitSourceLine(q.option);
    return (
      <Modal
        title={t().newShip.confirmTitle}
        confirmLabel={t().newShip.confirm}
        cancelLabel={t().back}
        confirmKey="Enter"
        cancelKey="Esc"
        onConfirm={run(() => on.newShip(q.option.key, q.option.acquire))}
        onCancel={close}
      >
        {t().newShip.confirmBody(cockpit, active?.name ?? '')}
        <p class="hg-confirm-cost">
          {cockpit} · {price.source} · <b>{price.price}</b>
        </p>
        {loan}
      </Modal>
    );
  }
  const d = q.ship.dismantle!;
  return (
    <Modal tone="danger" title={t().dismantleTitle(q.ship.name)} confirmLabel={t().dismantleConfirm} cancelLabel={t().back} cancelKey="Esc" onConfirm={run(() => on.dismantle(q.ship.id))} onCancel={close}>
      {t().dismantleBody}
      <ul class="hg-confirm-list">
        <li>{t().dismantleFee(formatCredits(d.fee))}</li>
        {d.scrap > 0 && <li>{t().dismantleScrap(d.scrap)}</li>}
      </ul>
    </Modal>
  );
}

export interface HangarModalProps {
  v: HangarView;
  /** The station's display name (the head and the slot purchase). */
  stationName: string;
  on: HangarOn;
  /** In the UI kit: no backdrop, no autofocus. */
  inline?: boolean;
}

/** The Hangar modal over the station hub. Esc closes it (or the open confirmation first). */
export function HangarModal({ v, stationName, on, inline = false }: HangarModalProps) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const asking = useRef(false);
  asking.current = ask !== null;
  useEffect(() => {
    if (inline) return;
    sheet.current?.querySelector<HTMLElement>('[data-hangar-close] button')?.focus({ preventScroll: true });
    // focus trap: Tab never leaves the sheet, even when focus got outside it (a click on the backdrop);
    // an open confirmation owns the keyboard
    const onKey = (e: KeyboardEvent) => {
      if (!asking.current) trapTab(e, sheet.current);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [inline]);
  const close = () => {
    on.click?.();
    on.close();
  };
  const summary = slotSummary(v.slots);
  const active = v.ships.find((s) => s.active);
  const entries = hangarEntries(v);
  const onKeyDown = (e: KeyboardEvent) => {
    if (ask) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  const body = (
    <div
      ref={sheet}
      class="co-sheet hg-sheet"
      role={inline ? 'group' : 'dialog'}
      aria-modal={inline ? undefined : 'true'}
      aria-label={t().title}
      data-testid="hangar"
      onKeyDown={onKeyDown}
    >
      <header class="co-head hg-head">
        <div class="hg-title">
          <span class="af-label co-kicker">{stationName}</span>
          <h2 class="co-title">{t().title}</h2>
        </div>
        <div class="hg-slots" data-testid="hangar-slots">
          <span class="af-label">{t().slotsLabel}</span>
          <b>{summary.here}</b>
          <small>{summary.game}</small>
        </div>
        <span data-hangar-close style={{ display: 'contents' }}>
          <Button variant="ghost" size="sm" keyHint="Esc" onClick={close} testId="hangar-close">
            {t().close}
          </Button>
        </span>
      </header>
      <div class="co-body af-on-plate hg-body">
        <p class="hg-lead">{t().lead}</p>
        {v.reason && (
          <Panel material="screen" cut="sm" class="hg-blocked" testId="hangar-blocked">
            <Lamp state="warn" />
            <span>{v.reason}</span>
          </Panel>
        )}
        <div class="hg-list">
          {entries.map((e) => (e.kind === 'ship' ? <ShipCard key={`s${e.ship.id}`} ship={e.ship} active={active} on={on} ask={setAsk} /> : null))}
        </div>
        <div class="hg-slots-row">
          {entries.map((e) =>
            e.kind === 'free' ? (
              <FreeSlot key={`f${e.index}`} />
            ) : e.kind === 'next' ? (
              <NextSlot key="next" price={e.price} reason={e.reason} on={on} ask={setAsk} />
            ) : null,
          )}
        </div>
        <NewShip v={v} on={on} ask={setAsk} />
      </div>
    </div>
  );
  // the confirmation is a fixed overlay: outside the sheet, whose clip-path and filter would confine it
  const confirm = ask && <Confirm q={ask} v={v} stationName={stationName} on={on} close={() => setAsk(null)} />;
  if (inline) {
    return (
      <>
        {body}
        {confirm}
      </>
    );
  }
  return (
    <>
      <div class="co-backdrop hg-backdrop" data-testid="hangar-backdrop">
        {body}
      </div>
      {confirm}
    </>
  );
}
