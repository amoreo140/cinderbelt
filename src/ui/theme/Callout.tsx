// Callout (long-term design 10.3): a label anchored to a point in the world with a 1 px leader line.
// At most 2 at once (the nearest objects). The game updates the position every frame via `data-callout-id`
// (a translate in the style), so the label does not trail behind the object with the 10 Hz UI redraw.
import { tx } from '../../i18n';
import { Key } from './Button';

export interface CalloutItem {
  id: string;
  /** Point on the screen (px), or null = off screen. */
  x: number;
  y: number;
  title: string;
  detail?: string | null;
  keys?: string | null;
  action?: string | null;
  tone?: 'info' | 'warn' | 'ok';
  /** Progress 0..1 (analysis). */
  progress?: number;
  /** Label to the left of the point (near the right screen edge). */
  flip?: boolean;
  /** Label below the point (near the top screen edge). */
  below?: boolean;
  /** Label slid sideways (px) off a HUD panel (calloutPlacement.ts); the leader line follows. */
  shift?: number;
}

/**
 * CSS variables of a label slid by `shift` px: the slide and the leader line from the anchor to the
 * label's near corner (24 px off the anchor) - its length and angle; 33 px at 52 degrees unshifted.
 */
export function calloutShiftStyle(shift: number): Record<string, string> {
  const dx = 19 + Math.abs(shift);
  const w = shift === 0 ? 33 : Math.round(Math.hypot(dx, 24) + 3);
  const a = shift === 0 ? 52 : Math.round((Math.atan2(24, dx) * 180) / Math.PI);
  return { '--callout-shift': `${shift}px`, '--leader-w': `${w}px`, '--leader-a': `${a}deg` };
}

/** Label offset from the anchor (px). */
export const CALLOUT_OFFSET = { x: 34, y: -46 };

export function Callout(c: CalloutItem) {
  const tone = c.tone ?? 'info';
  return (
    <div
      class={`af-callout af-callout--${tone}${c.flip ? ' is-flipped' : ''}${c.below ? ' is-below' : ''}`}
      data-callout-id={c.id}
      data-testid={`callout-${c.id}`}
      style={{
        transform: `translate(${Math.round(c.x)}px, ${Math.round(c.y)}px)`,
        ...calloutShiftStyle(c.shift ?? 0),
      }}
      role="note"
    >
      <span class="af-callout-anchor" aria-hidden="true" />
      <span class="af-callout-leader" aria-hidden="true" />
      <div class="af-callout-label">
        <span class="af-callout-title">{c.title}</span>
        {c.detail && <span class="af-callout-detail">{c.detail}</span>}
        {c.progress !== undefined && (
          <span class="af-callout-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(c.progress * 100)}>
            <span style={{ width: `${Math.round(c.progress * 100)}%` }} />
          </span>
        )}
        {c.keys && (
          <span class="af-callout-key">
            <Key dark>{c.keys}</Key>
            {c.action && <span>{c.action}</span>}
          </span>
        )}
      </div>
    </div>
  );
}

export function CalloutLayer({ items }: { items: readonly CalloutItem[] }) {
  return (
    <div class="af-callouts" aria-label={tx().hud.callouts}>
      {items.slice(0, 2).map((c) => (
        <Callout key={c.id} {...c} />
      ))}
    </div>
  );
}
