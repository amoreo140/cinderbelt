// Development tab of the home station ("Rozvoj", M4c plan §1, T3; design §10.6): the Index Kovania
// gauge on top, the module rows on the left and the selected module's plate on the right – its price
// and "Build" (with a confirmation), or once built the paint shop / the trophy hall and "Show"
// (the dock camera flies to it). Keyboard: ↑/↓ move through the rows, Enter on a row builds it.
import { useRef, useState } from 'preact/hooks';
import { HOME_MODULES, type HomeModuleId } from '../../data/home';
import { RESOURCE_IDS } from '../../data/resources';
import type { DevelopmentData, DevelopmentHandlers, ModuleRow } from '../../game/home/types';
import { tx } from '../../i18n';
import { assetUrl } from '../../render/assets/url';
import { formatCredits, formatInt } from '../format';
import { Button, Gauge, Lamp, Modal, Panel, ResourceChip } from '../theme';
import { PaintShop } from './PaintShop';
import { TrophyHall, TrophyList } from './TrophyHall';
import './development.css';

export interface DevelopmentProps {
  /** View model (T2); null until the game layer provides it. */
  d: DevelopmentData | null;
  on?: DevelopmentHandlers;
  /** Click sound of the hub's buttons. */
  click?: () => void;
}

const t = () => tx().home.tab;

/** The modules that stand on the station model once built ("Show" flies the camera there). */
const SHOWN: ReadonlySet<HomeModuleId> = new Set(['paintShop', 'trophyHall']);

function ModuleIcon({ row, size = 'sm' }: { row: ModuleRow; size?: 'sm' | 'lg' }) {
  return (
    <span class={`dv-icon dv-icon--${size}`}>
      <img
        src={assetUrl(row.icon)}
        alt=""
        onError={(e) => {
          // no icon yet: the frame keeps the fallback glyph
          (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
        }}
      />
    </span>
  );
}

function RowState({ row }: { row: ModuleRow }) {
  if (row.state === 'owned')
    return (
      <span class="dv-row-state is-owned">
        <Lamp state="ok" />
        {t().owned}
      </span>
    );
  if (row.state === 'future') return <span class="dv-row-state af-label">{t().later(row.since ?? '')}</span>;
  return <span class={`dv-row-state dv-row-price${row.reason ? ' is-short' : ''}`}>{formatCredits(row.credits)}</span>;
}

function ModuleButton({ row, selected, onSelect, onEnter }: { row: ModuleRow; selected: boolean; onSelect(): void; onEnter(): void }) {
  return (
    <button
      type="button"
      class={`dv-row dv-row--${row.state} af-focusable${selected ? ' is-selected' : ''}`}
      aria-pressed={selected}
      data-testid={`dev-module-${row.id}`}
      data-state={row.state}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        onEnter();
      }}
    >
      <ModuleIcon row={row} />
      <span class="dv-row-text">
        <span class="dv-row-name">{row.name}</span>
        <span class="dv-row-effect">{row.effect}</span>
      </span>
      <RowState row={row} />
    </button>
  );
}

/** Price, Index points and the build button of a module that is not built. */
function BuildBlock({ row, onBuild }: { row: ModuleRow; onBuild(): void }) {
  const points = HOME_MODULES[row.id].forgeIndex;
  const resources = RESOURCE_IDS.filter((r) => (row.resources?.[r] ?? 0) > 0);
  return (
    <>
      <dl class="dv-facts">
        <div>
          <dt>{t().price}</dt>
          <dd class="dv-price">
            {formatCredits(row.credits)}
            {resources.map((r) => (
              <span key={r} class="dv-res">
                + {formatInt(row.resources![r]!)}
                <ResourceChip id={r} name />
              </span>
            ))}
          </dd>
        </div>
        {points !== null && points > 0 && (
          <div>
            <dt>{tx().home.forge.title}</dt>
            <dd>{t().indexPoints(points)}</dd>
          </div>
        )}
      </dl>
      {row.state === 'future' ? (
        <p class="dv-later" data-testid="dev-later">
          <Lamp state="off" />
          {row.reason ?? t().later(row.since ?? '')}
        </p>
      ) : (
        <div class="dv-actions">
          <Button
            variant="primary"
            keyHint="Enter"
            aside={formatCredits(row.credits)}
            disabled={row.reason !== undefined}
            reason={row.reason}
            testId="dev-build"
            onClick={onBuild}
          >
            {t().build}
          </Button>
        </div>
      )}
    </>
  );
}

export function Development({ d, on, click }: DevelopmentProps) {
  const [confirm, setConfirm] = useState<HomeModuleId | null>(null);
  const [focused, setFocused] = useState<HomeModuleId | null>(null);
  const list = useRef<HTMLElement>(null);
  if (!d) return <section class="hub-development" data-testid="development" />;
  const row = d.modules.find((m) => m.id === d.selected) ?? d.modules[0]!;
  const ask = (r: ModuleRow) => {
    if (r.state !== 'buyable' || r.reason !== undefined) return;
    click?.();
    setConfirm(r.id);
  };
  const select = (r: ModuleRow) => {
    if (r.id === d.selected) return;
    click?.();
    // the camera framing ends with another module (the handler returns the camera to the dock)
    if (focused !== null) setFocused(null);
    on?.select(r.id);
  };
  const onListKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = d.modules.findIndex((m) => m.id === row.id);
    const next = d.modules[(i + (e.key === 'ArrowDown' ? 1 : d.modules.length - 1)) % d.modules.length]!;
    select(next);
    list.current?.querySelector<HTMLElement>(`[data-testid="dev-module-${next.id}"]`)?.focus();
  };
  const confirmRow = confirm ? d.modules.find((m) => m.id === confirm) : undefined;
  const shown = row.state === 'owned' && SHOWN.has(row.id);
  const isFocused = focused === row.id;
  return (
    <section class="hub-development dv" data-testid="development">
      <Panel material="screen" cut="sm" class="dv-forge" testId="dev-forge">
        <Gauge kind="heat" label={tx().home.forge.title} value={d.forgeIndex} max={d.forgeMax} segments={d.forgeMax} warnAt={-1} critAt={-1} compact />
      </Panel>
      <div class="dv-grid">
        <nav class="dv-rows" ref={list} aria-label={t().title} onKeyDown={onListKey}>
          <span class="af-label dv-rows-title">{t().title}</span>
          {d.modules.map((m) => (
            <ModuleButton
              key={m.id}
              row={m}
              selected={m.id === row.id}
              onSelect={() => select(m)}
              onEnter={() => {
                select(m);
                ask(m);
              }}
            />
          ))}
        </nav>
        <Panel material="plate" cut="md" trim="top" class={`dv-detail dv-detail--${row.state}`} testId="dev-detail">
          <div class="dv-detail-body">
            <div class="dv-head">
              <ModuleIcon row={row} size="lg" />
              <div class="dv-head-text">
                <h3 class="dv-name">{row.name}</h3>
                <p class="dv-effect">{row.effect}</p>
              </div>
              {shown && (
                <Button
                  size="sm"
                  variant={isFocused ? 'secondary' : 'ghost'}
                  hint={isFocused ? undefined : t().showHint}
                  testId="dev-show"
                  onClick={() => {
                    click?.();
                    const next = isFocused ? null : row.id;
                    setFocused(next);
                    on?.focus(next);
                  }}
                >
                  {isFocused ? t().showBack : t().show}
                </Button>
              )}
            </div>
            {row.state !== 'owned' && <BuildBlock row={row} onBuild={() => ask(row)} />}
            {row.state === 'owned' && row.id === 'paintShop' && d.paintShop && on && <PaintShop d={d.paintShop} on={on} click={click} />}
            {row.state === 'owned' && row.id === 'trophyHall' && d.trophyHall && on && <TrophyHall d={d.trophyHall} on={on} click={click} />}
            {row.id === 'trophyHall' && !d.trophyHall && (d.trophiesWithoutHall?.length ?? 0) > 0 && (
              <div class="dv-waiting" data-testid="trophies-waiting">
                <p class="hub-note dv-note">{tx().home.trophies.waiting(d.trophiesWithoutHall!.length)}</p>
                <TrophyList cards={d.trophiesWithoutHall!} />
              </div>
            )}
          </div>
        </Panel>
      </div>
      {confirmRow && (
        // keys stay in the dialog (F would undock, digits switch tabs)
        <div class="dv-confirm" onKeyDown={(e) => e.stopPropagation()}>
          <Modal
            title={t().confirmTitle(confirmRow.name)}
            confirmLabel={t().confirm}
            cancelLabel={t().cancel}
            confirmKey="Enter"
            cancelKey="Esc"
            onCancel={() => setConfirm(null)}
            onConfirm={() => {
              setConfirm(null);
              click?.();
              on?.build(confirmRow.id);
            }}
          >
            <p class="dv-confirm-body">{t().confirmBody(formatCredits(confirmRow.credits))}</p>
          </Modal>
        </div>
      )}
    </section>
  );
}
