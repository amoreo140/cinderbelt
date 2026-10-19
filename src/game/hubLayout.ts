// Layout of the docked hub measured by a ResizeObserver, not read back after every UI redraw (perf audit
// 2026-10-17, P3: the `.hub` and editor-view rects were read right after each 10 Hz patch, a forced style
// and layout pass each time). The same pattern as uiLayout.ts: ResizeObserver callbacks run after the
// browser's own layout, so the reads there are free.
//
// The hub slides in (`hub-in`, a translate): the rects are taken without the hub's own translation, so the
// docked view is framed for where the hub comes to rest from its first frame.

/** The hub's cover and the editor view, as handed to `onChange`. */
export interface HubRects {
  /** Window px on the right the hub covers (0 = no hub). */
  inset: number;
  /** The shipyard editor's 3D view (window px), or null. */
  yard: DOMRect | null;
}

export class HubLayout {
  private hub: Element | null = null;
  private yard: Element | null = null;
  private readonly observer: ResizeObserver | null;
  private last: HubRects = { inset: 0, yard: null };

  constructor(
    private readonly root: HTMLElement,
    private readonly onChange: (rects: HubRects) => void,
  ) {
    this.observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.measure()) : null;
    this.observer?.observe(root);
  }

  /** The last measured rects. */
  get rects(): HubRects {
    return this.last;
  }

  /**
   * After each UI redraw: the hub element and the editor's view element (null = none). Only new elements
   * are observed anew; without a ResizeObserver (tests) every call measures.
   */
  watch(hub: Element | null, yard: Element | null): void {
    if (!this.observer) {
      this.hub = hub;
      this.yard = yard;
      this.measure();
      return;
    }
    if (hub === this.hub && yard === this.yard) return;
    for (const el of [this.hub, this.yard]) if (el && el !== hub && el !== yard) this.observer.unobserve(el);
    for (const el of [hub, yard]) if (el && el !== this.hub && el !== this.yard) this.observer.observe(el);
    this.hub = hub;
    this.yard = yard;
    // gone: no layout to wait for
    if (!hub && !yard) this.measure();
  }

  dispose(): void {
    this.observer?.disconnect();
  }

  private measure(): void {
    const hub = this.hub?.isConnected ? this.hub : null;
    const yardEl = this.yard?.isConnected ? this.yard : null;
    let inset = 0;
    let yard: DOMRect | null = null;
    if (hub || yardEl) {
      // the hub's slide-in translation (none once it rests)
      const shift = hub ? translationOf(hub) : { x: 0, y: 0 };
      if (hub) {
        const rect = hub.getBoundingClientRect();
        inset = rect.width > 0 ? Math.max(0, this.root.clientWidth - (rect.left - shift.x)) : 0;
      }
      if (yardEl) {
        const rect = yardEl.getBoundingClientRect();
        yard = shift.x === 0 && shift.y === 0 ? rect : new DOMRect(rect.x - shift.x, rect.y - shift.y, rect.width, rect.height);
      }
    }
    const before = this.last;
    if (before.inset === inset && sameRect(before.yard, yard)) return;
    this.last = { inset, yard };
    this.onChange(this.last);
  }
}

function translationOf(el: Element): { x: number; y: number } {
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none' || typeof DOMMatrixReadOnly !== 'function') return { x: 0, y: 0 };
  const m = new DOMMatrixReadOnly(t);
  return { x: m.e, y: m.f };
}

function sameRect(a: DOMRect | null, b: DOMRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}
