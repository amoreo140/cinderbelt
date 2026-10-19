import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';

// A single tooltip layer above the whole UI – panels with cut corners (clip-path) and scrolling
// areas would clip a tooltip, so it is drawn in <TooltipLayer/> outside them (position: fixed).

export interface TipState {
  text: string;
  tone: 'reason' | 'info';
  /** Preferred placement (flips when there is not enough room). */
  placement: 'above' | 'below';
  /** The host rectangle in window coordinates. */
  rect: { left: number; top: number; width: number; bottom: number };
  owner: object;
}

type Listener = (tip: TipState | null) => void;
let current: TipState | null = null;
const listeners = new Set<Listener>();

function publish(tip: TipState | null): void {
  current = tip;
  for (const l of listeners) l(tip);
}

export function showTip(owner: object, el: Element, text: string, tone: TipState['tone'], placement: TipState['placement'] = 'above'): void {
  const r = el.getBoundingClientRect();
  publish({ text, tone, placement, owner, rect: { left: r.left, top: r.top, width: r.width, bottom: r.bottom } });
}

export function hideTip(owner: object): void {
  if (current?.owner === owner) publish(null);
}

/** Props for an element that should show the tooltip on hover and on focus. */
export function useTip(text: string | undefined, tone: TipState['tone'] = 'reason', placement: TipState['placement'] = 'above') {
  const owner = useRef({}).current;
  const el = useRef<HTMLElement | null>(null);
  // a text change while it is shown (e.g. the button was unlocked meanwhile)
  useEffect(() => {
    if (current?.owner !== owner) return;
    if (!text || !el.current) hideTip(owner);
    else if (current.text !== text) showTip(owner, el.current, text, tone, placement);
  }, [text, tone, placement, owner]);
  useEffect(() => () => hideTip(owner), [owner]);
  const show = (e: Event) => {
    el.current = e.currentTarget as HTMLElement;
    if (text) showTip(owner, el.current, text, tone, placement);
  };
  const hide = () => hideTip(owner);
  return { onPointerEnter: show, onPointerLeave: hide, onFocus: show, onBlur: hide };
}

/** Wrapper for any content with a tooltip. */
export function Tooltip({ text, tone = 'info', children }: { text?: string; tone?: TipState['tone']; children: ComponentChildren }) {
  const handlers = useTip(text, tone);
  return (
    <span class="af-tip-host" {...handlers}>
      {children}
    </span>
  );
}

/**
 * A technical term with its plain-language explanation: dotted underline, the explanation in the
 * info tooltip on hover and focus (keyboard reachable), and for screen readers as its description.
 */
export function Term({ tip, children, class: cls }: { tip?: string; children: ComponentChildren; class?: string }) {
  const handlers = useTip(tip, 'info');
  const id = useId();
  if (!tip) return <span class={cls}>{children}</span>;
  return (
    <span class={`af-term af-focusable${cls ? ` ${cls}` : ''}`} tabIndex={0} aria-describedby={id} {...handlers}>
      {children}
      <span id={id} class="af-sr-only">
        {tip}
      </span>
    </span>
  );
}

const GAP = 8;

/** Renders the active tooltip; belongs once in the UI root. */
export function TooltipLayer() {
  const [tip, setTip] = useState<TipState | null>(current);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    listeners.add(setTip);
    return () => listeners.delete(setTip);
  }, []);
  useEffect(() => {
    const box = ref.current;
    if (!tip || !box) {
      setPos(null);
      return;
    }
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const vw = window.innerWidth;
    let left = tip.rect.left + tip.rect.width / 2 - w / 2;
    left = Math.max(GAP, Math.min(vw - w - GAP, left));
    const above = tip.rect.top - h - GAP;
    const below = tip.rect.bottom + GAP;
    let top = tip.placement === 'below' ? below : above;
    if (top < GAP) top = below;
    if (top + h > window.innerHeight - GAP) top = above;
    setPos({ left, top });
  }, [tip]);
  if (!tip) return null;
  return (
    <div
      ref={ref}
      role="tooltip"
      class={`af-tip-layer${tip.tone === 'info' ? ' is-info' : ''}`}
      style={pos ? { left: `${pos.left}px`, top: `${pos.top}px` } : { left: '-9999px', top: '0px' }}
    >
      {tip.text}
    </div>
  );
}
