import type { ComponentChildren } from 'preact';
import { Key } from './Button';
import { useTip } from './Tooltip';

export interface TabDef<T extends string> {
  id: T;
  label: ComponentChildren;
  /** Keyboard shortcut (the tab number). */
  keyHint?: string;
  disabled?: boolean;
  /** Why the tab is locked. */
  reason?: string;
  /** Locked by progression (not by the station): marked with data-locked. */
  locked?: boolean;
  /** A stroke icon (~20 px, currentColor); with it the tab is drawn stacked: icon over the label. */
  icon?: ComponentChildren;
  /** A call for attention: a count pill (`count`) or a dot (no count); `label` is its tooltip and accessible name. */
  badge?: TabBadge;
}

export interface TabBadge {
  count?: number;
  label: string;
}

function LockGlyph() {
  return (
    <svg class="af-tab-lock" viewBox="0 0 10 11" aria-hidden="true">
      <path d="M2.5 5V3.5a2.5 2.5 0 0 1 5 0V5" fill="none" stroke="currentColor" stroke-width="1.4" />
      <path d="M1 5h8v6H1z" fill="currentColor" />
    </svg>
  );
}

function Tab<T extends string>({ tab, active, onSelect, testIdPrefix }: { tab: TabDef<T>; active: boolean; onSelect: (id: T) => void; testIdPrefix?: string }) {
  const badge = tab.disabled ? undefined : tab.badge;
  const handlers = useTip(tab.disabled ? tab.reason : badge?.label, tab.disabled ? 'reason' : 'info', 'below');
  return (
    <button
      type="button"
      role="tab"
      class={`af-tab af-focusable${tab.icon ? ' af-tab--icon' : ''}`}
      aria-selected={active}
      aria-disabled={tab.disabled ? 'true' : undefined}
      data-locked={tab.locked ? 'true' : undefined}
      tabIndex={active ? 0 : -1}
      data-testid={testIdPrefix ? `${testIdPrefix}${tab.id}` : undefined}
      onClick={() => {
        if (!tab.disabled) onSelect(tab.id);
      }}
      {...handlers}
    >
      {tab.icon && (
        <span class="af-tab-icon" aria-hidden="true">
          {tab.icon}
        </span>
      )}
      {tab.keyHint && <Key dark={!active}>{tab.keyHint}</Key>}
      <span class="af-tab-label">{tab.label}</span>
      {tab.disabled && <LockGlyph />}
      {badge && (
        <span class="af-tab-badge" data-kind={badge.count !== undefined ? 'count' : 'dot'} role="img" aria-label={badge.label}>
          {badge.count !== undefined ? badge.count : ''}
        </span>
      )}
    </button>
  );
}

/** Tab bar; the ←/→ arrows move the focus, the active tab blends into the plate below it. */
export function TabRail<T extends string>(p: {
  tabs: readonly TabDef<T>[];
  active: T;
  onSelect: (id: T) => void;
  label: string;
  testIdPrefix?: string;
}) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const buttons = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
    next?.focus();
    e.preventDefault();
  };
  return (
    <nav class="af-tabs" role="tablist" aria-label={p.label} onKeyDown={onKeyDown}>
      {p.tabs.map((tab) => (
        <Tab key={tab.id} tab={tab} active={p.active === tab.id} onSelect={p.onSelect} testIdPrefix={p.testIdPrefix} />
      ))}
    </nav>
  );
}
