// Layout of the game UI layer measured by a ResizeObserver, not read back after every HUD redraw.
// Reading a rect right after Preact patched the DOM (or after the per-frame callout writes) forces a
// synchronous style + layout pass; at 10 Hz that was about a quarter of the HUD redraw cost
// (audit 2026-10-16, issue #8). ResizeObserver callbacks run after the browser's own layout, so the
// reads there are free.

/**
 * The rect of the UI root and the flight console's top edge (for the radio's `--cm-bottom`) and right edge
 * (`--cm-right`: the workshop lamps sit beside the console, M4c).
 */
export class UiLayout {
  private rootRect: DOMRect;
  private consoleEl: Element | null = null;
  private cmBottom = '';
  private cmRight = '';
  private readonly observer: ResizeObserver | null;

  constructor(private readonly root: HTMLElement) {
    this.rootRect = root.getBoundingClientRect();
    this.observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.measure()) : null;
    this.observer?.observe(root);
  }

  /** The UI root's rect (window px) as of the last layout. */
  get rect(): DOMRect {
    // without a ResizeObserver (tests, old browsers) fall back to reading it live
    return this.observer ? this.rootRect : this.root.getBoundingClientRect();
  }

  /**
   * Watches the flight console (null when docked): the radio sits on its top edge. Called after each
   * UI redraw – only a new console element (the HUD was mounted again) is observed anew.
   */
  watchConsole(el: Element | null): void {
    if (el === this.consoleEl) return;
    if (this.consoleEl) this.observer?.unobserve(this.consoleEl);
    this.consoleEl = el;
    if (!el) {
      this.setCmBottom('');
      this.setCmRight('');
    }
    else if (this.observer) this.observer.observe(el);
    else this.measure();
  }

  dispose(): void {
    this.observer?.disconnect();
  }

  private measure(): void {
    // reads first, then the one write
    this.rootRect = this.root.getBoundingClientRect();
    const top = this.consoleEl?.isConnected ? this.consoleEl.getBoundingClientRect() : null;
    this.setCmBottom(top && top.height > 0 ? `${Math.round(this.rootRect.bottom - top.top + 10)}px` : '');
    this.setCmRight(top && top.width > 0 ? `${Math.round(top.right - this.rootRect.left)}px` : '');
  }

  private setCmRight(value: string): void {
    if (value === this.cmRight) return;
    this.cmRight = value;
    this.root.style.setProperty('--cm-right', value);
  }

  private setCmBottom(value: string): void {
    if (value === this.cmBottom) return;
    this.cmBottom = value;
    this.root.style.setProperty('--cm-bottom', value);
  }
}
