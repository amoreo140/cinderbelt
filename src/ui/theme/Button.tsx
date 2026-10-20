import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';
import { useTip } from './Tooltip';

export type ButtonVariant = 'secondary' | 'primary' | 'ghost' | 'danger';

export interface ButtonProps {
  onClick?: (e: MouseEvent) => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  /** Unavailable button – stays focusable so the reason can be read. */
  disabled?: boolean;
  /** Why the action cannot be performed (tooltip on an unavailable button). */
  reason?: string;
  /** Additional tooltip on an available button. */
  hint?: string;
  /** Keyboard shortcut shown as a keycap before the text. */
  keyHint?: string;
  /** A readout aligned to the right (price, profit). */
  aside?: ComponentChildren;
  block?: boolean;
  testId?: string;
  class?: string;
  children: ComponentChildren;
}

export function Button(p: ButtonProps) {
  const describedId = useId();
  const tip = p.disabled ? p.reason : p.hint;
  const handlers = useTip(tip, p.disabled ? 'reason' : 'info');
  const cls = [
    'af-btn',
    'af-focusable',
    `af-btn--${p.variant ?? 'secondary'}`,
    p.size && p.size !== 'md' ? `af-btn--${p.size}` : '',
    p.block ? 'af-btn--block' : '',
    p.class ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const onClick = (e: MouseEvent) => {
    if (p.disabled) {
      e.preventDefault();
      return;
    }
    p.onClick?.(e);
  };
  return (
    <>
      <button
        type="button"
        class={cls}
        aria-disabled={p.disabled ? 'true' : undefined}
        aria-describedby={tip ? describedId : undefined}
        data-testid={p.testId}
        onClick={onClick}
        {...handlers}
      >
        {p.keyHint && <Key>{p.keyHint}</Key>}
        <span class="af-btn-label">{p.children}</span>
        {p.aside !== undefined && <span class="af-btn-aside">{p.aside}</span>}
      </button>
      {tip && (
        <span id={describedId} hidden>
          {tip}
        </span>
      )}
    </>
  );
}

/** Key keycap. */
export function Key({ children, dark }: { children: ComponentChildren; dark?: boolean }) {
  return <kbd class={`af-key${dark ? ' af-key-dark' : ''}`}>{children}</kbd>;
}

/** Key + description ("F depart"). */
export function KeyHint({ keys, children, dark }: { keys: string | readonly string[]; children?: ComponentChildren; dark?: boolean }) {
  const list = typeof keys === 'string' ? [keys] : keys;
  return (
    <span class="af-keyhint">
      {list.map((k) => (
        <Key key={k} dark={dark}>
          {k}
        </Key>
      ))}
      {children !== undefined && <span>{children}</span>}
    </span>
  );
}

/** Switch of several choices (quantity, sale source). */
export interface SegmentedOption<T> {
  value: T;
  label: ComponentChildren;
  /** Not selectable (stays focusable so the reason can be read). */
  disabled?: boolean;
  /** Why the option is disabled (tooltip). */
  reason?: string;
  /** Locked by progression: marked with data-locked and a lock glyph. */
  locked?: boolean;
}

function SegmentedOpt<T extends string | number>({ o, active, testIdPrefix, onPick }: { o: SegmentedOption<T>; active: boolean; testIdPrefix?: string; onPick: (value: T) => void }) {
  const handlers = useTip(o.disabled ? o.reason : undefined, 'reason', 'below');
  return (
    <button
      type="button"
      class="af-segmented-opt"
      aria-pressed={active}
      aria-disabled={o.disabled ? 'true' : undefined}
      data-locked={o.locked ? 'true' : undefined}
      data-testid={testIdPrefix ? `${testIdPrefix}${String(o.value)}` : undefined}
      onClick={() => {
        if (!o.disabled) onPick(o.value);
      }}
      {...handlers}
    >
      {o.label}
      {o.locked && (
        <svg class="af-tab-lock" viewBox="0 0 10 11" aria-hidden="true">
          <path d="M2.5 5V3.5a2.5 2.5 0 0 1 5 0V5" fill="none" stroke="currentColor" stroke-width="1.4" />
          <path d="M1 5h8v6H1z" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}

export function Segmented<T extends string | number>(p: {
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Stable test ids: `<prefix><value>` on each option. */
  testIdPrefix?: string;
}) {
  return (
    <span class="af-segmented" role="group" aria-label={p.label}>
      {p.options.map((o) => (
        <SegmentedOpt key={String(o.value)} o={o} active={p.value === o.value} testIdPrefix={p.testIdPrefix} onPick={p.onChange} />
      ))}
    </span>
  );
}
