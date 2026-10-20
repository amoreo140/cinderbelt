// Guild Training (M3.7) on the screen: the step panel (a dark band with the orange trim and the
// nine-segment training track), the highlight that clamps onto the UI element to use, suggested
// hangar cells, the "ship is ready" card and the skip confirmation. Never blocks the game: only the
// panel's own buttons take the pointer.
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { tx } from '../../i18n';
import type { TrainingCellBox, TrainingHandlers, TrainingUiData } from '../../game/training/trainingUi';
import type { TrainingGuide } from '../../game/training/trainingView';
import { formatInt } from '../format';
import { KeyHint, Lamp, Modal, Panel } from '../theme';
import './training.css';

const t = () => tx().training;

/** The nine steps as slanted segments: done (trim), current (glow), to do (outline). */
function Track({ index, total, label }: { index: number; total: number; label: string }) {
  return (
    <span class="tr-track" role="img" aria-label={label}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} class={i < index ? 'is-done' : i === index ? 'is-now' : ''} />
      ))}
    </span>
  );
}

/** A tick in a done row. */
function Check() {
  return (
    <svg class="tr-check" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 6.5 5 9.5 10.5 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" />
    </svg>
  );
}

/** Live distance to the step's target and a chevron towards it (bearing in screen space, 0 = right). */
function Heading({ target }: { target: NonNullable<TrainingGuide['target']> }) {
  const deg = (target.bearing * 180) / Math.PI;
  return (
    <span class="tr-heading" data-testid="training-distance">
      <b>
        {formatInt(Math.round(target.distance))} {tx().hud.distanceUnit}
      </b>
      <svg class="tr-chevron" viewBox="0 0 16 16" aria-hidden="true" style={{ transform: `rotate(${deg.toFixed(1)}deg)` }}>
        <path d="M2 8h10M8 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" />
      </svg>
    </span>
  );
}

function StepPanel({ g, on }: { g: TrainingGuide; on: TrainingHandlers }) {
  return (
    <Panel material="band" cut="md" trim="top" class={`tr-panel${g.completed ? ' is-completed' : ''}`} as="section" aria-label={t().title} testId="training-panel">
      <header class="tr-head">
        <span class="af-label tr-kicker">
          {t().title} ·{' '}
          <span class="tr-count" data-testid="training-step">
            {g.stepLabel}
          </span>
        </span>
        <Track index={g.completed ? g.index + 1 : g.index} total={g.total} label={g.stepLabel} />
        <button type="button" class="tr-skip" onClick={on.skip} data-testid="training-skip">
          {t().panel.skip}
        </button>
        <button type="button" class="tr-icon" onClick={on.toggle} aria-label={t().panel.hide} title={t().panel.hide} data-testid="training-hide">
          <span aria-hidden="true" />
        </button>
      </header>
      <div class="tr-titlebar">
        <h2 class="tr-title" data-testid="training-title">
          {g.title}
        </h2>
        {g.completed && (
          <span class="tr-badge" data-testid="training-completed">
            <Check /> {t().panel.completed}
          </span>
        )}
      </div>
      <p class="tr-why">{g.why}</p>
      {g.phases.length > 0 && (
        <ul class="tr-lines">
          {g.phases.map((p, i) => (
            <li key={i} class={p.state === 'done' ? 'is-done' : p.state === 'current' ? 'is-now' : 'is-todo'} data-testid="training-phase" data-state={p.state}>
              {p.state === 'done' ? <Check /> : <Lamp state={p.state === 'current' ? 'warn' : 'off'} />}
              {p.state !== 'done' && p.keys.length > 0 ? (
                <KeyHint keys={p.keys} dark>
                  {p.text}
                </KeyHint>
              ) : (
                <span class="tr-phase-text">{p.text}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {(g.hint || g.target) && (
        <div class="tr-hintrow">
          {g.hint && <p class="tr-note">{g.hint}</p>}
          {g.target && <Heading target={g.target} />}
        </div>
      )}
      {g.progress && (
        <div class="tr-progress" role="meter" aria-label={t().panel.progress} aria-valuemin={0} aria-valuemax={g.progress.max} aria-valuenow={Math.floor(g.progress.value)}>
          <span class="tr-progress-bar">
            <i style={{ width: `${Math.min(1, g.progress.value / g.progress.max) * 100}%` }} />
          </span>
          <b>
            {Math.floor(g.progress.value + 1e-9)}/{g.progress.max}
          </b>
        </div>
      )}
      {g.reward && (
        <footer class="tr-foot">
          <span class="tr-reward">{g.reward}</span>
        </footer>
      )}
    </Panel>
  );
}

/**
 * Frames clamped onto the UI elements the step needs (by CSS selector). Placed every animation frame from
 * the elements' boxes, so they follow scrolling lists and the hub opening; a hidden element hides its
 * frame. Each frame only reads (the elements are looked up once and kept while they still match); the
 * styles are written only when a box has moved or resized, so a still highlight costs no style or
 * layout work.
 */
function Highlight({ selectors }: { selectors: readonly string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const key = selectors.join('|');
  useLayoutEffect(() => {
    let frame = 0;
    const targets: (HTMLElement | null)[] = [];
    // last written box per frame: x, y, width, height (NaN = hidden, undefined = never written)
    const written: (number[] | undefined)[] = [];
    const place = () => {
      const root = ref.current;
      if (root) {
        const boxes = selectors.map((sel, i) => {
          let el = targets[i];
          if (!el || !el.isConnected || !el.matches(sel)) el = targets[i] = document.querySelector<HTMLElement>(sel);
          const r = el?.getBoundingClientRect();
          return !r || r.width === 0 || r.height === 0 ? null : [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
        });
        boxes.forEach((b, i) => {
          const box = root.children[i] as HTMLElement | undefined;
          if (!box) return;
          const last = written[i];
          if (!b) {
            if (last && Number.isNaN(last[0])) return;
            box.style.visibility = 'hidden';
            written[i] = [NaN, NaN, NaN, NaN];
            return;
          }
          if (last && last[0] === b[0] && last[1] === b[1] && last[2] === b[2] && last[3] === b[3]) return;
          if (!last || Number.isNaN(last[0])) box.style.visibility = '';
          if (!last || last[0] !== b[0] || last[1] !== b[1]) {
            box.style.transform = `translate(${b[0]}px, ${b[1]}px)`;
            box.classList.toggle('is-low', b[1]! < 28);
          }
          if (!last || last[2] !== b[2] || last[3] !== b[3]) {
            box.style.width = `${b[2]}px`;
            box.style.height = `${b[3]}px`;
          }
          written[i] = b;
        });
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [key]);
  // a palette row or a recipe far down a list scrolls into view once
  useEffect(() => {
    for (const sel of selectors) document.querySelector<HTMLElement>(sel)?.scrollIntoView?.({ block: 'nearest' });
  }, [key]);
  if (selectors.length === 0) return null;
  return (
    <div ref={ref} class="tr-hl-layer" aria-hidden="true">
      {selectors.map((s) => (
        <span key={s} class="tr-hl" data-testid="training-highlight" data-target={s}>
          <span class="tr-hl-tag">{t().panel.here}</span>
        </span>
      ))}
    </div>
  );
}

function DoneCard({ on }: { on: TrainingHandlers }) {
  return (
    <Panel material="band" cut="md" trim="top" class="tr-panel tr-done" as="section" aria-label={t().panel.doneTitle} testId="training-done">
      <header class="tr-head">
        <span class="af-label tr-kicker">{t().title}</span>
        <Track index={9} total={9} label={t().panel.doneTitle} />
      </header>
      <h2 class="tr-title">{t().panel.doneTitle}</h2>
      <p class="tr-note">{t().panel.doneText}</p>
      <footer class="tr-foot">
        <KeyHint keys={t().panel.next.keys} dark>
          {t().panel.next.text}
        </KeyHint>
        <button type="button" class="tr-skip" onClick={on.closeDone} data-testid="training-done-close">
          {t().panel.close}
        </button>
      </footer>
    </Panel>
  );
}

/**
 * In the shipyard the panel covers the lower part of the parts column (the selected part's details):
 * the palette rows above it, the hangar with the ship and the suggested cells, the properties and the
 * design check stay free. Placed from the column's box every frame: the frame reads the boxes, the panel's
 * height comes from a ResizeObserver (no layout forced after a write), and the styles are written only
 * when the place changes.
 */
function useYardAnchor(layer: { current: HTMLDivElement | null }, yard: boolean): void {
  useLayoutEffect(() => {
    if (!yard) {
      // out of the shipyard the stylesheet places the panel again
      for (const el of layer.current?.querySelectorAll<HTMLElement>('.tr-panel, .tr-tab') ?? []) el.removeAttribute('style');
      return;
    }
    let frame = 0;
    let column: HTMLElement | null = null;
    let panel: HTMLElement | null = null;
    let panelHeight = -1;
    // the column's bottom relative to the layer: the panel's top is that minus its height
    let bottom = NaN;
    let left = NaN;
    let width = NaN;
    let top = NaN;
    const writeTop = () => {
      if (!panel || Number.isNaN(bottom) || panelHeight < 0) return;
      const next = Math.round(bottom - panelHeight);
      if (next !== top) panel.style.top = `${(top = next)}px`;
    };
    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver((entries) => {
            const entry = entries[entries.length - 1];
            if (!entry || entry.target !== panel) return;
            panelHeight = entry.borderBoxSize?.[0]?.blockSize ?? (entry.target as HTMLElement).offsetHeight;
            // runs after layout, before paint: the panel lands in the same frame
            writeTop();
          })
        : null;
    const place = () => {
      const root = layer.current;
      const found = root?.querySelector<HTMLElement>('.tr-panel, .tr-tab') ?? null;
      if (found !== panel) {
        if (panel) observer?.unobserve(panel);
        panel = found;
        panelHeight = -1;
        left = width = top = NaN;
        if (panel) observer?.observe(panel);
      }
      if (!column || !column.isConnected) column = document.querySelector<HTMLElement>('[data-testid="shipyard"] aside');
      if (root && panel && column) {
        // reads first …
        const r = root.getBoundingClientRect();
        const c = column.getBoundingClientRect();
        if (panelHeight < 0 || !observer) panelHeight = panel.offsetHeight;
        bottom = c.bottom - r.top;
        // … then writes, only on a change
        const nextLeft = Math.round(c.left - r.left);
        const nextWidth = Math.round(c.width);
        if (nextLeft !== left) panel.style.left = `${(left = nextLeft)}px`;
        if (nextWidth !== width) panel.style.width = `${(width = nextWidth)}px`;
        writeTop();
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      for (const el of layer.current?.querySelectorAll<HTMLElement>('.tr-panel, .tr-tab') ?? []) el.removeAttribute('style');
    };
  }, [yard]);
}

/**
 * A suggested cell: a square of `size` centred on the cell, mapped onto the cell's projected shape
 * (orbited / tilted hangar camera) when the half-cell axes are known.
 */
function cellStyle(c: TrainingCellBox): Record<string, string> {
  const size = Math.max(1, Math.round(c.size));
  const box = { width: `${size}px`, height: `${size}px` };
  if (c.ax === undefined || c.ay === undefined || c.bx === undefined || c.by === undefined) {
    return { ...box, transform: `translate(${Math.round(c.x - c.size / 2)}px, ${Math.round(c.y - c.size / 2)}px)` };
  }
  const k = 2 / size;
  const m = [c.ax * k, c.ay * k, c.bx * k, c.by * k].map((v) => v.toFixed(4)).join(', ');
  // origin at the box corner: translate → matrix → centring compose as written
  return { ...box, transformOrigin: '0 0', transform: `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px) matrix(${m}, 0, 0) translate(-50%, -50%)` };
}

export function TrainingLayer({ d, on }: { d: TrainingUiData; on: TrainingHandlers }) {
  const g = d.guide;
  // combat dims the panel and folds it to one line (it stays on the screen)
  const collapsed = d.collapsed || !!g?.dimmed;
  const layer = useRef<HTMLDivElement>(null);
  useYardAnchor(layer, d.yard);
  return (
    <div ref={layer} class={`tr-layer${d.docked ? ' is-docked' : ''}${d.yard ? ' is-yard' : ''}`} data-testid="training">
      {g && !collapsed && <StepPanel g={g} on={on} />}
      {g && collapsed && (
        <button type="button" class={`tr-tab af-cut2${g.dimmed ? ' is-dimmed' : ''}`} onClick={on.toggle} data-testid="training-show" title={t().panel.show}>
          <Lamp state="warn" />
          <span class="tr-tab-title">{g.title}</span>
          {g.target && <Heading target={g.target} />}
        </button>
      )}
      {!g && d.done && <DoneCard on={on} />}
      {g && <Highlight selectors={g.completed ? [] : g.highlight} />}
      {d.cells.map((c, i) => (
        <span
          key={`${i}:${c.x}:${c.y}`}
          class="tr-cell"
          data-testid="training-cell"
          style={cellStyle(c)}
        />
      ))}
      {d.confirmSkip && (
        <Modal title={t().skip.title} confirmLabel={t().skip.confirm} cancelLabel={t().skip.cancel} cancelKey="Esc" onConfirm={on.confirmSkip} onCancel={on.cancelSkip}>
          {t().skip.body}
        </Modal>
      )}
    </div>
  );
}

