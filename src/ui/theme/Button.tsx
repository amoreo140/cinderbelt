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
export function Segmented<T extends string | number>(p: {
  label: string;
  options: readonly { value: T; label: ComponentChildren }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <span class="af-segmented" role="group" aria-label={p.label}>
      {p.options.map((o) => (
        <button
          type="button"
          key={String(o.value)}
          class="af-segmented-opt"
          aria-pressed={p.value === o.value}
          onClick={() => p.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}
