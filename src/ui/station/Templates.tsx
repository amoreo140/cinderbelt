// Templates modal (M4a T6): the player's saved
// ship designs – save the ship or the shipyard draft under a name, build one as the shipyard draft,
// rename, delete, export a share code and import one. Pure UI over `TemplatesView` /
// `TemplateHandlers` (src/game/fleet/types.ts); the game layer (T4) fills the view and runs the actions.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { SHIP_NAME_MAX, TEMPLATE_CODE_MAX } from '../../data/fleet';
import type { Silhouette } from '../../game/combatView';
import type { TemplateHandlers, TemplateItemView, TemplateSource, TemplatesView } from '../../game/fleet/types';
import { tx } from '../../i18n';
import type { TemplateDecodeError } from '../../sim/templates/types';
import { Button, Heading, KeyHint, Lamp, Modal, Panel, Segmented, ShipSilhouette, Tooltip } from '../theme';
import '../board/overlays.css';
import './templates.css';

const t = () => tx().fleet.templates;

/** A template row; `silhouette` is the drawing of the design (optional until the view model carries it). */
export interface TemplateRowView extends TemplateItemView {
  silhouette?: Silhouette;
}

/** `TemplatesView` whose rows may carry a silhouette. */
export interface TemplatesModalView extends TemplatesView {
  items: TemplateRowView[];
}

/** Transient UI state of the modal (also the initial state of the UI-kit fixtures). */
export interface TemplatesUiState {
  /** Name field of "Save". */
  name: string;
  source: TemplateSource;
  /** Row being renamed and the edited name. */
  renaming: number | null;
  renameText: string;
  /** Row whose export code is shown, and the copy feedback. */
  exporting: number | null;
  copy: 'idle' | 'copied' | 'manual';
  /** Row waiting for the delete confirmation. */
  deleting: number | null;
  /** Import field and the result of the last import. */
  importText: string;
  importResult: TemplateDecodeError | 'ok' | null;
}

const INITIAL: TemplatesUiState = {
  name: '',
  source: 'ship',
  renaming: null,
  renameText: '',
  exporting: null,
  copy: 'idle',
  deleting: null,
  importText: '',
  importResult: null,
};

export interface TemplatesProps {
  view: TemplatesModalView;
  on: TemplateHandlers;
  /** The shipyard holds a draft that differs from the ship: offer it as the source of "Save". */
  draft?: boolean;
  /** UI click sound. */
  click?: () => void;
  /** Kit: drawn in place, without the backdrop and without taking the focus. */
  inline?: boolean;
  /** Kit: the starting UI state (open export, import error, …). */
  initial?: Partial<TemplatesUiState>;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab / Shift+Tab cycle inside `root` (the game's keyboard handler must not move the focus out). */
function trapTab(e: KeyboardEvent, root: HTMLElement | null): void {
  if (!root) return;
  const list = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (list.length === 0) return;
  e.preventDefault();
  const i = list.indexOf(document.activeElement as HTMLElement);
  const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i < 0 || i === list.length - 1 ? 0 : i + 1;
  list[next]!.focus();
}

/** The Templates modal. Esc closes an open inline editor first, then the modal. */
export function Templates({ view, on, draft = false, click, inline = false, initial }: TemplatesProps) {
  const [ui, setUi] = useState<TemplatesUiState>({ ...INITIAL, ...initial });
  const patch = (p: Partial<TemplatesUiState>) => setUi((s) => ({ ...s, ...p }));
  const sheet = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const tick = () => click?.();

  // focus into the sheet so keyboard play continues inside the modal
  useEffect(() => {
    if (inline) return;
    const el = sheet.current;
    if (!el || el.contains(document.activeElement)) return;
    (el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus({ preventScroll: true });
  }, [inline]);

  // a closed rename field or confirmation took the focus with it: give it back to the button that
  // opened it (or the sheet), so keyboard play does not fall out of the modal
  const back = useRef<string | null>(null);
  useEffect(() => {
    if (inline || ui.deleting !== null || ui.renaming !== null) return;
    const el = sheet.current;
    if (!el || el.contains(document.activeElement)) return;
    const target = back.current ? el.querySelector<HTMLElement>(`[data-testid="${back.current}"]`) : null;
    back.current = null;
    (target ?? el).focus({ preventScroll: true });
  }, [inline, ui.deleting, ui.renaming]);

  // the draft source disappears when there is no draft any more
  const source: TemplateSource = draft ? ui.source : 'ship';
  const full = view.items.length >= view.cap;
  const nameOk = ui.name.trim().length > 0;
  const saveReason = view.saveReason ?? (nameOk ? undefined : t().nameMissing);
  const importReason = full ? t().full : ui.importText.trim().length === 0 ? t().importEmpty : undefined;

  const save = () => {
    if (saveReason) return;
    tick();
    on.save(ui.name.trim(), source);
    patch({ name: '' });
  };
  const runImport = () => {
    if (importReason) return;
    tick();
    const error = on.importCode(ui.importText.trim());
    patch(error ? { importResult: error } : { importResult: 'ok', importText: '' });
  };
  const openExport = (index: number) => {
    tick();
    patch(ui.exporting === index ? { exporting: null, copy: 'idle' } : { exporting: index, copy: 'idle', renaming: null });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // keys typed in the modal never reach the game (hub tabs, undock, …)
    e.stopPropagation();
    if (e.key === 'Tab' && !inline)
      trapTab(
        e,
        ui.deleting !== null
          ? (root.current?.querySelector<HTMLElement>('[role="dialog"]:not(.tp-sheet), [role="group"]:not(.tp-sheet)') ?? null)
          : sheet.current,
      );
    if (e.key !== 'Escape' || ui.deleting !== null) return;
    e.preventDefault();
    if (ui.renaming !== null) patch({ renaming: null });
    else if (ui.exporting !== null) patch({ exporting: null, copy: 'idle' });
    else on.close();
  };

  const deleting = ui.deleting === null ? null : view.items.find((i) => i.index === ui.deleting);
  const body = view.lockReason ? (
    <Panel material="screen" cut="sm" class="tp-locked" testId="templates-locked">
      <span class="tp-locked-line">
        <Lamp state="off" />
        <b>{view.lockReason}</b>
      </span>
      <span class="tp-locked-hint">{t().lockedHint}</span>
    </Panel>
  ) : (
    <div class="tp-columns">
      <section class="tp-list-col" aria-label={t().title}>
        {view.items.length === 0 ? (
          <p class="co-dim tp-empty" data-testid="templates-empty">
            {t().empty}
          </p>
        ) : (
          <ul class="tp-list">
            {view.items.map((item) => (
              <TemplateRow key={item.index} item={item} ui={ui} patch={patch} on={on} tick={tick} onExport={() => openExport(item.index)} back={back} />
            ))}
          </ul>
        )}
      </section>
      <aside class="tp-side">
        <section class="tp-box" data-testid="templates-save">
          <Heading>{t().saveTitle}</Heading>
          <label class="tp-field">
            <span class="af-label">{t().nameLabel}</span>
            <input
              class="tp-input af-focusable"
              type="text"
              value={ui.name}
              maxLength={SHIP_NAME_MAX}
              placeholder={t().namePlaceholder}
              data-autofocus
              data-testid="templates-name"
              onInput={(e) => patch({ name: (e.currentTarget as HTMLInputElement).value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
              }}
            />
          </label>
          {draft && (
            <div class="tp-field">
              <span class="af-label">{t().sourceLabel}</span>
              <Segmented
                label={t().sourceLabel}
                options={[
                  { value: 'ship', label: t().sourceShip },
                  { value: 'draft', label: t().sourceDraft },
                ]}
                value={source}
                onChange={(v) => {
                  tick();
                  patch({ source: v });
                }}
              />
            </div>
          )}
          <Button variant="primary" block disabled={saveReason !== undefined} reason={saveReason} onClick={save} testId="templates-save-btn">
            {t().save}
          </Button>
        </section>
        <section class="tp-box" data-testid="templates-import">
          <Heading>{t().importTitle}</Heading>
          <label class="tp-field">
            <span class="af-label">{t().importLabel}</span>
            <textarea
              class="tp-input tp-code af-focusable"
              rows={3}
              value={ui.importText}
              maxLength={TEMPLATE_CODE_MAX + 64}
              placeholder={t().importPlaceholder}
              spellcheck={false}
              aria-invalid={ui.importResult !== null && ui.importResult !== 'ok' ? 'true' : undefined}
              data-testid="templates-import-code"
              onInput={(e) =>
                patch({
                  importText: (e.currentTarget as HTMLTextAreaElement).value,
                  importResult: null,
                })
              }
            />
          </label>
          <Button disabled={importReason !== undefined} reason={importReason} block onClick={runImport} testId="templates-import-btn">
            {t().import}
          </Button>
          {ui.importResult && (
            <p
              class={`tp-feedback ${ui.importResult === 'ok' ? 'is-ok' : 'is-bad'}`}
              role={ui.importResult === 'ok' ? 'status' : 'alert'}
              data-testid="templates-import-result"
            >
              <Lamp state={ui.importResult === 'ok' ? 'ok' : 'bad'} />
              <span>{ui.importResult === 'ok' ? t().imported : t().errors[ui.importResult]}</span>
            </p>
          )}
        </section>
      </aside>
    </div>
  );

  const confirm = deleting && (
    <Modal
      tone="danger"
      inline={inline}
      title={t().deleteTitle(deleting.name)}
      confirmLabel={t().deleteConfirm}
      cancelLabel={t().cancel}
      cancelKey="Esc"
      onCancel={() => patch({ deleting: null })}
      onConfirm={() => {
        tick();
        on.delete(deleting.index);
        setUi((s) => ({
          ...s,
          deleting: null,
          exporting: s.exporting === deleting.index ? null : s.exporting,
          renaming: s.renaming === deleting.index ? null : s.renaming,
        }));
      }}
    >
      {t().deleteBody}
    </Modal>
  );

  const content = (
    <div
      ref={sheet}
      class="co-sheet tp-sheet"
      role={inline ? 'group' : 'dialog'}
      aria-modal={inline ? undefined : 'true'}
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="templates"
    >
      <header class="co-head">
        <div>
          <h2 class="co-title" id={titleId}>
            {t().title}
          </h2>
          {!view.lockReason && <p class="tp-lead">{t().lead}</p>}
        </div>
        {!view.lockReason && view.cap > 0 && (
          <span class={`tp-slots${full ? ' is-full' : ''}`} data-testid="templates-slots">
            <span class="af-label">{t().slotsLabel}</span>
            <b>{t().slots(view.items.length, view.cap)}</b>
          </span>
        )}
      </header>
      <div class="co-body af-on-plate tp-body">{body}</div>
      <footer class="co-foot">
        <span class="grow" />
        <Button variant="ghost" keyHint="Esc" onClick={() => on.close()} testId="templates-close">
          {t().close}
        </Button>
      </footer>
    </div>
  );
  // the confirmation sits outside the sheet: the sheet's clip-path and filter would cut it off
  return (
    <div ref={root} class={inline ? 'tp-inline' : 'co-backdrop co-backdrop--light tp-backdrop'} onKeyDown={onKeyDown}>
      {content}
      {confirm}
    </div>
  );
}

function TemplateRow({
  item,
  ui,
  patch,
  on,
  tick,
  onExport,
  back,
}: {
  item: TemplateRowView;
  ui: TemplatesUiState;
  patch: (p: Partial<TemplatesUiState>) => void;
  on: TemplateHandlers;
  tick: () => void;
  onExport: () => void;
  /** Where the focus returns when the rename field closes. */
  back: { current: string | null };
}) {
  const renaming = ui.renaming === item.index;
  const exporting = ui.exporting === item.index;
  // encode once per opened panel (and again after a rename), not on every redraw
  const code = useMemo(() => (exporting ? on.exportCode(item.index) : ''), [exporting, item.index, item.name]);
  const renameReason = ui.renameText.trim().length === 0 ? t().nameMissing : undefined;
  const commitRename = () => {
    if (renameReason) return;
    tick();
    on.rename(item.index, ui.renameText.trim());
    patch({ renaming: null });
  };
  return (
    <li class="tp-row" data-testid={`template-${item.index}`} aria-label={t().rowLabel(item.name)}>
      <Panel material="screen" cut="sm" class="tp-sil">
        {item.silhouette && item.silhouette.cells.length > 0 ? (
          <ShipSilhouette silhouette={item.silhouette} width={64} height={56} maxCell={9} gap={1} label={item.name} />
        ) : (
          <span class="tp-sil-empty" aria-hidden="true" />
        )}
      </Panel>
      <div class="tp-info">
        {renaming ? (
          <span class="tp-rename">
            <RenameInput value={ui.renameText} onInput={(v) => patch({ renameText: v })} onEnter={commitRename} label={t().rename} />
            <Button
              size="sm"
              variant="secondary"
              disabled={renameReason !== undefined}
              reason={renameReason}
              onClick={commitRename}
              testId={`template-rename-save-${item.index}`}
            >
              {t().renameSave}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => patch({ renaming: null })}>
              {t().renameCancel}
            </Button>
          </span>
        ) : (
          <strong class="tp-name">{item.name}</strong>
        )}
        <span class="tp-facts">
          <span>{t().parts(item.parts)}</span>
          <span>{t().hullPoints(item.hullPoints)}</span>
          <span>{t().cockpitTier(item.cockpitTier)}</span>
          {item.locked > 0 && (
            <Tooltip text={t().lockedHelp} tone="info">
              <span class="tp-locked-parts" tabIndex={0}>
                <Lamp state="warn" />
                {t().locked(item.locked)}
              </span>
            </Tooltip>
          )}
        </span>
        {!renaming && (
          <span class="tp-row-actions">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                tick();
                back.current = `template-rename-${item.index}`;
                patch({
                  renaming: item.index,
                  renameText: item.name,
                  exporting: null,
                  copy: 'idle',
                });
              }}
              testId={`template-rename-${item.index}`}
            >
              {t().rename}
            </Button>
            <Button size="sm" variant="ghost" onClick={onExport} testId={`template-export-${item.index}`}>
              {t().export}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                tick();
                patch({ deleting: item.index });
              }}
              testId={`template-delete-${item.index}`}
            >
              {t().delete}
            </Button>
          </span>
        )}
      </div>
      <div class="tp-apply">
        <Button
          variant="secondary"
          disabled={item.applyReason !== undefined}
          reason={item.applyReason}
          hint={t().applyHint}
          onClick={() => {
            tick();
            on.apply(item.index);
          }}
          testId={`template-apply-${item.index}`}
        >
          {t().apply}
        </Button>
      </div>
      {exporting && <ExportPanel code={code} copy={ui.copy} setCopy={(copy) => patch({ copy })} tick={tick} />}
    </li>
  );
}

/** Inline rename field: takes the focus and selects the name when it opens. */
function RenameInput({ value, onInput, onEnter, label }: { value: string; onInput: (v: string) => void; onEnter: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      class="tp-input tp-rename-input af-focusable"
      type="text"
      value={value}
      maxLength={SHIP_NAME_MAX}
      aria-label={label}
      onInput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onEnter();
      }}
    />
  );
}

/** Export code: a read-only field and "Copy" (clipboard, or select-all for Ctrl+C as a fallback). */
function ExportPanel({
  code,
  copy,
  setCopy,
  tick,
}: {
  code: string;
  copy: TemplatesUiState['copy'];
  setCopy: (c: TemplatesUiState['copy']) => void;
  tick: () => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const selectAll = () => {
    field.current?.focus({ preventScroll: true });
    field.current?.select();
  };
  const doCopy = () => {
    tick();
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clip?.writeText) {
      selectAll();
      setCopy('manual');
      return;
    }
    clip.writeText(code).then(
      () => setCopy('copied'),
      () => {
        selectAll();
        setCopy('manual');
      },
    );
  };
  return (
    <Panel material="screen" cut="sm" class="tp-export" testId="templates-export">
      <label class="tp-field">
        <span class="af-label tp-export-label">{t().exportLabel}</span>
        <textarea
          ref={field}
          class="tp-code tp-code--out af-focusable"
          readOnly
          rows={2}
          value={code}
          spellcheck={false}
          onFocus={(e) => (e.currentTarget as HTMLTextAreaElement).select()}
          data-testid="templates-export-code"
        />
      </label>
      <span class="tp-export-foot">
        <Button size="sm" onClick={doCopy} testId="templates-copy">
          {t().copy}
        </Button>
        {copy !== 'idle' && (
          <span class="tp-copy-note" role="status">
            {copy === 'copied' ? <Lamp state="ok" /> : <KeyHint keys={['Ctrl', 'C']} dark />}
            {copy === 'copied' ? t().copied : t().copyManual}
          </span>
        )}
      </span>
    </Panel>
  );
}
