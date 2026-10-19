// The derelict terminal (M4b plan T9): the career-overlay sheet (a hull plate in a dark frame, like the
// hub modals) with the station log on a recessed screen, the Data line, the one-time service – item rows
// with `Button` + reason (parts stash, plan fragments) or the fabricator list (materials from the ship's
// cargo, the missing ones in warn) – and "Disconnect" (F). Keyboard: the focus stays in the sheet (Tab
// cycles), Esc and F leave the berth exactly like "Disconnect" (a berthed ship with no terminal open is
// never a state). Keys pressed in the terminal never reach the game. Data: `DerelictTerminalData`
// (src/game/sites/types.ts, built by the game layer).
import { useEffect, useId, useRef } from 'preact/hooks';
import { parsePartKey } from '../../data/parts';
import type { DerelictTerminalData, FabOption, TerminalHandlers, TerminalItem } from '../../game/sites/types';
import { tx } from '../../i18n';
import { formatInt } from '../format';
import { Button, Heading, KeyHint, Lamp, Panel, PartChip, ResourceIcon } from '../theme';
import '../board/overlays.css';
import { materialList, terminalLayout } from './terminal';
import './sites.css';

const t = () => tx().world.derelict;

const FOCUSABLE = 'button, [tabindex]:not([tabindex="-1"])';

/** Tab / Shift+Tab cycle inside `root` (the game's own Tab – the scanner pulse – must not fire). */
function trapTab(e: KeyboardEvent, root: HTMLElement | null): void {
  if (!root) return;
  const list = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (list.length === 0) return;
  e.preventDefault();
  const i = list.indexOf(document.activeElement as HTMLElement);
  const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i < 0 || i === list.length - 1 ? 0 : i + 1;
  list[next]!.focus();
}

/** The first thing to focus: an available take / fabricate button, else "Disconnect". */
function firstFocus(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>('.dt-act:not([aria-disabled="true"])') ?? root.querySelector<HTMLElement>('.dt-leave');
}

/** A plan-fragment glyph (a rolled blueprint) for item rows without a part. */
function PlanGlyph() {
  return (
    <span class="dt-glyph" aria-hidden="true">
      <svg viewBox="0 0 20 20">
        <rect x="3" y="4" width="14" height="12" />
        <path d="M6 8 H14 M6 11 H11 M6 13.5 H9" />
      </svg>
    </span>
  );
}

/** `made` = the fabricator's row: once used it reads as made, not taken. */
function ItemRow({ item, on, made }: { item: TerminalItem; on: TerminalHandlers; made: boolean }) {
  const part = item.key ? parsePartKey(item.key) : null;
  return (
    <li class={`dt-row${item.taken ? ' is-taken' : ''}`} data-testid={`terminal-item-${item.index}`}>
      <span class="dt-row-what">
        {part ? <PartChip partId={part.partId} tier={part.tier} compact /> : <PlanGlyph />}
        <span class="dt-row-label">{item.label}</span>
      </span>
      {item.taken ? (
        <span class="dt-taken" data-testid={`terminal-taken-${item.index}`}>
          <Lamp state="ok" />
          {made ? t().terminal.made : t().terminal.taken}
        </span>
      ) : (
        <Button
          size="sm"
          class="dt-act"
          disabled={item.reason !== undefined}
          reason={item.reason}
          onClick={() => on.take(item.index)}
          testId={`terminal-take-${item.index}`}
        >
          {t().terminal.take}
        </Button>
      )}
      {!item.taken && item.reason && <span class="dt-reason">{item.reason}</span>}
    </li>
  );
}

function FabRow({ option, on }: { option: FabOption; on: TerminalHandlers }) {
  const part = parsePartKey(option.key);
  return (
    <li class="dt-row dt-row--fab" data-testid={`terminal-fab-${option.key}`}>
      <span class="dt-row-what">
        <PartChip partId={part.partId} tier={part.tier} compact />
        <span class="dt-row-label">{option.label}</span>
      </span>
      <span class="dt-mats" role="group" aria-label={t().terminal.materials}>
        {materialList(option.materials).map((m) => (
          <span key={m.id} class="af-res af-res--tag">
            <ResourceIcon id={m.id} />
            <span class="af-res-amount">{formatInt(m.amount)}</span>
            <span class="af-sr-only">{tx().resources[m.id]}</span>
          </span>
        ))}
      </span>
      <Button
        size="sm"
        class="dt-act"
        disabled={option.reason !== undefined}
        reason={option.reason}
        onClick={() => on.fabricate(option.key)}
        testId={`terminal-fabricate-${option.key}`}
      >
        {t().terminal.fabricate}
      </Button>
      {option.reason && <span class="dt-reason">{option.reason}</span>}
    </li>
  );
}

export interface DerelictTerminalProps {
  d: DerelictTerminalData;
  on: TerminalHandlers;
  /** Kit: drawn in place, without the backdrop and without taking the focus. */
  inline?: boolean;
}

export function DerelictTerminal({ d, on, inline = false }: DerelictTerminalProps) {
  const sheet = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const layout = terminalLayout(d);
  const tt = t().terminal;

  // the focus goes into the sheet on open and comes back when the focused button went away (an item
  // taken, the fabricator used), so keyboard play never falls out of the terminal
  useEffect(() => {
    if (inline) return;
    const el = sheet.current;
    if (!el || el.contains(document.activeElement)) return;
    (firstFocus(el) ?? el).focus({ preventScroll: true });
  });

  const onKeyDown = (e: KeyboardEvent) => {
    // keys typed in the terminal never reach the game (scanner Tab, map, journal, thrust…)
    e.stopPropagation();
    if (inline) return;
    if (e.key === 'Tab') {
      trapTab(e, sheet.current);
      return;
    }
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape' || e.code === 'KeyF') {
      e.preventDefault();
      on.leave();
    }
  };

  const serviceName = layout.service ? t().service[layout.service] : tt.serviceTitle;
  const holdLine = (
    <span class={`dt-hold${layout.holdFull ? ' is-full' : ''}`} data-testid="terminal-hold">
      {layout.holdFull && <Lamp state="warn" />}
      {tt.holdFree(formatInt(Math.max(0, d.holdFree)))}
    </span>
  );

  const content = (
    <div
      ref={sheet}
      class="co-sheet dt-sheet"
      role={inline ? 'group' : 'dialog'}
      aria-modal={inline ? undefined : 'true'}
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="derelict-terminal"
      data-model={d.model}
    >
      <header class="co-head">
        <div>
          <span class="af-label co-kicker">{tt.title}</span>
          <h2 class="co-title" id={titleId}>
            {d.name}
          </h2>
        </div>
        <div class={`dt-data${d.data === null ? ' is-done' : ''}`} data-testid="terminal-data">
          <span class="af-label">{tt.dataLabel}</span>
          {d.data === null ? <span class="dt-data-done">{tt.dataDone}</span> : <b class="dt-data-value">{tt.data(formatInt(d.data))}</b>}
        </div>
      </header>
      <div class="co-body af-on-plate dt-body">
        <Panel material="screen" cut="sm" class="dt-log" testId="terminal-log">
          <span class="dt-log-head">
            <span class="af-label">{tt.log}</span>
            {d.log && (
              <span class="dt-log-saved">
                <Lamp state="ok" />
                {tt.logSaved}
              </span>
            )}
          </span>
          {d.log ? <p class="dt-log-text">{d.log}</p> : <p class="dt-log-text is-read">{tt.logRead}</p>}
        </Panel>

        <section class="dt-service" aria-label={serviceName} data-testid="terminal-service" data-service={layout.service ?? ''}>
          <Heading aside={holdLine}>{serviceName}</Heading>
          {layout.holdFull && !layout.used && (
            <p class="dt-note dt-note--warn" data-testid="terminal-hold-full">
              <Lamp state="warn" />
              {tt.holdFull}
            </p>
          )}
          {layout.fabricator !== null && (
            <>
              <p class="dt-lead">{tt.fabricatorLead}</p>
              <ul class="dt-rows">
                {layout.fabricator.map((o) => (
                  <FabRow key={o.key} option={o} on={on} />
                ))}
              </ul>
            </>
          )}
          {layout.rows.length > 0 && (
            <ul class="dt-rows">
              {layout.rows.map((item) => (
                <ItemRow key={item.index} item={item} on={on} made={layout.service === 'fabricator'} />
              ))}
            </ul>
          )}
          {layout.used && (
            <p class="dt-note" data-testid="terminal-used">
              <Lamp state="off" />
              {layout.service === 'fabricator' ? tt.fabricated : tt.serviceUsed}
            </p>
          )}
        </section>
      </div>
      <footer class="co-foot">
        <KeyHint keys={['F', 'Esc']}>{tt.leaveHint}</KeyHint>
        <span class="grow" />
        <Button variant="primary" keyHint="F" class="dt-leave" onClick={() => on.leave()} testId="terminal-leave">
          {tt.leave}
        </Button>
      </footer>
    </div>
  );

  if (inline) return <div class="dt-inline">{content}</div>;
  // a click on the dark frame keeps the focus in the sheet
  return (
    <div
      class="co-backdrop co-backdrop--light dt-backdrop"
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
      }}
    >
      {content}
    </div>
  );
}
