import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import { Button } from './Button';
import { Panel } from './Panel';

export interface ModalProps {
  title: ComponentChildren;
  /** danger = a warning band under the title and a destructive confirmation. */
  tone?: 'default' | 'danger';
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Keys shown on the buttons (e.g. Enter / Esc). */
  confirmKey?: string;
  cancelKey?: string;
  /** Without an overlay – as a preview in the style guide. */
  inline?: boolean;
  children: ComponentChildren;
}

/** Confirmation dialog. On a dangerous action the focus is on "Back". Esc = cancel. */
export function Modal(p: ModalProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (p.inline) return;
    const first = ref.current?.querySelector<HTMLButtonElement>(p.tone === 'danger' ? '[data-modal="cancel"] button' : '[data-modal="confirm"] button');
    first?.focus();
  }, [p.inline, p.tone]);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      p.onCancel();
    }
  };
  const dialog = (
    <div ref={ref} role={p.inline ? 'group' : 'dialog'} aria-modal={p.inline ? undefined : 'true'} aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <Panel material="plate" cut="lg" class={`af-modal${p.tone === 'danger' ? ' af-modal--danger' : ''}`}>
        <h2 class="af-modal-title" id={titleId}>
          {p.title}
        </h2>
        {p.tone === 'danger' && <div class="af-hazard" aria-hidden="true" />}
        <div class="af-modal-body">{p.children}</div>
        <div class="af-modal-actions">
          <span data-modal="cancel" style={{ display: 'contents' }}>
            <Button variant="ghost" keyHint={p.cancelKey} onClick={p.onCancel}>
              {p.cancelLabel}
            </Button>
          </span>
          <span data-modal="confirm" style={{ display: 'contents' }}>
            <Button variant={p.tone === 'danger' ? 'danger' : 'primary'} keyHint={p.confirmKey} onClick={p.onConfirm}>
              {p.confirmLabel}
            </Button>
          </span>
        </div>
      </Panel>
    </div>
  );
  if (p.inline) return dialog;
  return <div class="af-backdrop">{dialog}</div>;
}
