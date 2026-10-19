import { useMemo, useRef, useState } from 'preact/hooks';
import type { SlotState } from '../../game/save/saveService';
import { formatPlayTime, formatSavedAt, slotColumns, type SlotCell } from '../../game/save/slotView';
import { sameSlot } from '../../game/storage/slots';
import { tx } from '../../i18n';
import type { SlotMeta } from '../../sim/save/meta';
import type { SlotRef } from '../../sim/save/types';
import { sectorInfoAt } from '../../sim/regions';
import { DEATH_PENALTIES } from '../../sim/settings';
import { stationById } from '../../sim/world/stations';
import { formatCredits, formatFactor } from '../format';
import { formatStationName } from '../stationName';
import { Button, Lamp, Modal, Panel } from '../theme';
import { Sheet } from './Sheet';
import type { OverlayData, OverlayHandlers } from './types';

const t = () => tx().app.load;
const now = () => new Date();

export function slotTitle(slot: SlotRef): string {
  return t().slotName(tx().saves.difficulties[slot.difficulty], slot.index);
}

export function locationText(meta: SlotMeta): string {
  if (meta.location.kind === 'docked') {
    const station = stationById(meta.seed, meta.location.stationId);
    return t().docked(station ? formatStationName(station) : meta.location.stationId);
  }
  // the depth of the sector the ship is in (sectors §6.2) – derived from the seed, not saved
  const { pos } = meta.location;
  return t().space(sectorInfoAt(meta.seed, pos.x, pos.y).depth);
}

const partsText = (n: number) => t().parts(n);
const yieldText = (y: number) => formatFactor(y);

function SlotTile(p: { cell: SlotCell; selected: boolean; current: boolean; onSelect: () => void; onOpen: () => void }) {
  const { cell } = p;
  const s = cell.state;
  const common = {
    type: 'button' as const,
    'aria-pressed': p.selected,
    'data-testid': `slot-${cell.slot.difficulty}-${cell.slot.index}`,
    onClick: p.onSelect,
    onDblClick: p.onOpen,
    onKeyDown: (e: KeyboardEvent) => {
      // the first Enter selects the slot, the second loads it
      if (e.key === 'Enter' && p.selected) {
        e.preventDefault();
        p.onOpen();
      }
    },
  };
  if (!s) {
    return (
      <button {...common} class="ld-slot is-empty">
        <span>{tx().saves.emptySlot}</span>
      </button>
    );
  }
  const meta = s.meta;
  return (
    <button {...common} class="ld-slot">
      <span class="ld-slot-top">
        <span class="ld-slot-no">{cell.slot.index + 1}</span>
        {s.kind !== 'ok' && <Lamp state="bad" label={s.kind === 'tooNew' ? tx().saves.loadErrors.tooNew(s.version ?? 0) : tx().saves.corrupt} />}
        <span class="ld-slot-name">{meta?.name ?? tx().saves.corrupt}</span>
      </span>
      {meta ? (
        <>
          <span class="ld-slot-line">{s.kind === 'ok' ? locationText(meta) : s.kind === 'tooNew' ? t().cantLoad : tx().saves.corrupt}</span>
          <span class="ld-slot-line">
            {formatSavedAt(meta.savedAt, now(), t())} · <b>{formatCredits(meta.credits)}</b>
          </span>
          {(meta.fallenFromHardcore || p.current) && (
            <span class={`af-label ${p.current ? 'ld-current' : 'ld-fallen'}`}>{p.current ? t().current : tx().saves.fallenFromHardcore}</span>
          )}
        </>
      ) : (
        <span class="ld-slot-line">{tx().saves.corrupt}</span>
      )}
    </button>
  );
}

function Detail(p: {
  cell: SlotCell | null;
  inMenu: boolean;
  current: boolean;
  on: OverlayHandlers;
  onDelete: () => void;
}) {
  const { cell, on } = p;
  if (!cell) {
    return (
      <Panel material="screen" cut="md" class="ld-detail" testId="load-detail">
        <p class="ld-detail-text">{t().pick}</p>
      </Panel>
    );
  }
  const s: SlotState | null = cell.state;
  if (!s) {
    return (
      <Panel material="screen" cut="md" class="ld-detail" testId="load-detail">
        <div>
          <h3 class="ld-detail-title">
            <Lamp state="off" />
            {slotTitle(cell.slot)}
          </h3>
          <p class="ld-detail-text">{tx().saves.emptySlot}</p>
        </div>
        <div class="ld-actions">
          {p.inMenu && cell.slot.index < 4 && (
            <Button variant="primary" onClick={() => on.newGameInto(cell.slot)} testId="load-new-here">
              {t().newHere}
            </Button>
          )}
        </div>
      </Panel>
    );
  }
  const meta = s.meta;
  const exportBtn = (raw: boolean) => (
    <Button variant="secondary" onClick={() => on.exportSlot(cell.slot)} testId="load-export">
      {raw ? t().exportRaw : t().export}
    </Button>
  );
  const deleteBtn = (
    <Button variant="danger" onClick={p.onDelete} testId="load-delete" disabled={p.current} reason={t().deleteCurrent}>
      {t().delete}
    </Button>
  );
  return (
    <Panel material="screen" cut="md" class="ld-detail" testId="load-detail">
      <div>
        <h3 class="ld-detail-title">
          <Lamp state={s.kind === 'ok' ? 'ok' : 'bad'} />
          {meta?.name ?? slotTitle(cell.slot)}
          {meta?.fallenFromHardcore && <span class="af-label" style={{ color: 'var(--af-bad)' }}>{tx().saves.fallenFromHardcore}</span>}
        </h3>
        {s.kind === 'ok' && meta ? (
          <dl class="ld-facts">
            <div>
              <dt>{t().savedAt}</dt>
              <dd>
                {formatSavedAt(meta.savedAt, now(), t())} ({tx().saves.reasons[meta.saveReason]})
              </dd>
            </div>
            <div>
              <dt>{t().where}</dt>
              <dd>{locationText(meta)}</dd>
            </div>
            <div>
              <dt>{t().playTime}</dt>
              <dd>{formatPlayTime(meta.playTimeTicks)}</dd>
            </div>
            <div>
              <dt>{t().credits}</dt>
              <dd>{formatCredits(meta.credits)}</dd>
            </div>
            <div>
              <dt>{t().ship}</dt>
              <dd>{partsText(meta.partCount)}</dd>
            </div>
            <div>
              <dt>{t().seed}</dt>
              <dd>{meta.seedText}</dd>
            </div>
            <div>
              <dt>{t().yield}</dt>
              <dd>{yieldText(meta.miningYield)}</dd>
            </div>
          </dl>
        ) : s.kind === 'tooNew' ? (
          <p class="ld-detail-text">{tx().saves.loadErrors.tooNew(s.version ?? 0)}</p>
        ) : (
          <p class="ld-detail-text">
            {s.kind === 'corrupt' ? `${tx().saves.loadErrors[s.error]} ` : ''}
            {s.kind === 'corrupt' && !s.backup ? tx().saves.unrecoverable : ''}
          </p>
        )}
      </div>
      <div class="ld-actions">
        {s.kind === 'ok' && (
          <>
            <Button variant="primary" onClick={() => on.loadSlot(cell.slot, 'current')} testId="load-load" keyHint="Enter">
              {t().load}
            </Button>
            {exportBtn(false)}
            {deleteBtn}
          </>
        )}
        {s.kind === 'corrupt' && (
          <>
            {s.backup && (
              <Button variant="primary" onClick={() => on.loadSlot(cell.slot, 'backup')} testId="load-backup">
                {tx().saves.loadBackup(formatSavedAt(s.backup.savedAt, now(), t()))}
              </Button>
            )}
            {exportBtn(true)}
            {deleteBtn}
          </>
        )}
        {s.kind === 'tooNew' && (
          <>
            {exportBtn(true)}
            {deleteBtn}
          </>
        )}
      </div>
    </Panel>
  );
}

/** Arrow keys between slots: up/down within a column, left/right between difficulties. */
function gridKeys(e: KeyboardEvent): void {
  const dirs: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  const d = dirs[e.key];
  const el = document.activeElement as HTMLElement | null;
  const id = el?.dataset.testid;
  const m = id ? /^slot-([a-z]+)-(\d+)$/.exec(id) : null;
  if (!d || !m) return;
  const col = DEATH_PENALTIES.indexOf(m[1] as (typeof DEATH_PENALTIES)[number]) + d[0];
  if (col < 0 || col >= DEATH_PENALTIES.length) return;
  const root = e.currentTarget as HTMLElement;
  const column = (difficulty: string) => [...root.querySelectorAll<HTMLElement>(`[data-testid^="slot-${difficulty}-"]`)];
  const pos = column(m[1]!).indexOf(el!);
  const tiles = column(DEATH_PENALTIES[col]!);
  const index = d[1] === 0 ? Math.min(pos, tiles.length - 1) : pos + d[1];
  const next = tiles[index];
  if (!next) return;
  e.preventDefault();
  next.focus();
}

export function LoadScreen({ data, on }: { data: OverlayData; on: OverlayHandlers }) {
  const columns = useMemo(() => slotColumns(data.slots ?? []), [data.slots]);
  const firstFilled = useMemo(() => {
    const all = DEATH_PENALTIES.flatMap((d) => columns[d]);
    const best = all
      .filter((c) => c.state?.kind === 'ok')
      .sort((a, b) => ((b.state?.meta?.savedAt ?? '') > (a.state?.meta?.savedAt ?? '') ? 1 : -1))[0];
    return best?.slot ?? all.find((c) => c.state)?.slot ?? null;
  }, [columns]);
  const [selected, setSelected] = useState<SlotRef | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SlotRef | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inMenu = data.state.kind === 'menu';

  const sel = selected ?? firstFilled;
  const cell = sel ? (DEATH_PENALTIES.flatMap((d) => columns[d]).find((c) => sameSlot(c.slot, sel)) ?? null) : null;
  const isCurrent = (slot: SlotRef) => data.currentSlot !== null && sameSlot(slot, data.currentSlot);
  const deleteMeta = confirmDelete ? (DEATH_PENALTIES.flatMap((d) => columns[d]).find((c) => sameSlot(c.slot, confirmDelete))?.state?.meta ?? null) : null;

  const open = (c: SlotCell) => {
    if (c.state?.kind === 'ok') on.loadSlot(c.slot, 'current');
  };

  return (
    <Sheet
      title={t().title}
      onBack={on.back}
      testId="load-game"
      footer={
        <>
          <Button variant="ghost" onClick={() => fileRef.current?.click()} testId="load-import">
            {t().import}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".cinder,.astra,.json,application/json"
            hidden
            data-testid="load-import-file"
            onChange={(e) => {
              const input = e.currentTarget as HTMLInputElement;
              const file = input.files?.[0];
              if (file) on.importFile(file);
              input.value = '';
            }}
          />
          <span class="sheet-note">{t().fileHint}</span>
        </>
      }
      bodyClass="ld-body"
    >
      <div class="ld-columns" onKeyDown={gridKeys}>
        {DEATH_PENALTIES.map((d) => {
          const used = columns[d].filter((c) => c.state).length;
          return (
            <section class="ld-col" key={d} aria-label={tx().saves.difficulties[d]} data-testid={`load-col-${d}`}>
              <header class="ld-col-head">
                <span class="ld-col-name">{tx().saves.difficulties[d]}</span>
                <span class="ld-col-count">{t().count(used)}</span>
              </header>
              {columns[d].map((c) => (
                <SlotTile
                  key={c.slot.index}
                  cell={c}
                  selected={sel !== null && sameSlot(c.slot, sel)}
                  current={isCurrent(c.slot)}
                  onSelect={() => {
                    on.click();
                    setSelected(c.slot);
                  }}
                  onOpen={() => open(c)}
                />
              ))}
            </section>
          );
        })}
      </div>
      <Detail cell={cell} inMenu={inMenu} current={cell ? isCurrent(cell.slot) : false} on={on} onDelete={() => cell && setConfirmDelete(cell.slot)} />

      {confirmDelete && (
        <Modal
          tone="danger"
          title={t().deleteTitle}
          confirmLabel={t().deleteConfirm}
          cancelLabel={tx().app.menu.back}
          cancelKey="Esc"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            on.deleteSlot(confirmDelete);
            setConfirmDelete(null);
            setSelected(null);
          }}
        >
          {t().deleteBody(slotTitle(confirmDelete), deleteMeta?.name ?? tx().saves.corrupt)}
        </Modal>
      )}
    </Sheet>
  );
}
