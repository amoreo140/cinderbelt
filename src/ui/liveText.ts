// Live texts (perf audit 2026-10-17, O13): a few HUD values change at nearly every 10 Hz redraw in
// flight – the speed, the position, the distance to the nearest station. Re-rendering their markup for
// that diffs a handful of elements each time; a live text instead writes the new string straight into
// its one DOM text node, and the markup around it stays a memoised part that skips the diff.
//
// The owner (the HUD) calls `set()` on every redraw; `LiveSlot` is the element that holds the node.
// Preact never sees the text (the slot renders no children), so its old virtual text cannot go stale.
import { Component, h } from 'preact';

/** A string shown in the slots bound to it; `set` writes the DOM only when the string changed. */
export class LiveText {
  private value: string;
  private readonly nodes = new Set<Text>();

  constructor(initial = '') {
    this.value = initial;
  }

  get text(): string {
    return this.value;
  }

  set(text: string): void {
    if (text === this.value) return;
    this.value = text;
    for (const node of this.nodes) node.data = text;
  }

  /** A slot's text node shows this text from now on (LiveSlot). */
  bind(node: Text): void {
    this.nodes.add(node);
    if (node.data !== this.value) node.data = this.value;
  }

  unbind(node: Text): void {
    this.nodes.delete(node);
  }
}

export interface LiveSlotProps {
  /** The live text, or a sequence of live texts and fixed strings (one DOM text node each). */
  live: LiveText | readonly (LiveText | string)[];
  class?: string;
  /** The element (a `<span>` by default). */
  tag?: 'span' | 'dd' | 'b';
}

const partsOf = (live: LiveSlotProps['live']): readonly (LiveText | string)[] => (live instanceof LiveText ? [live] : live);

/**
 * An element whose content is live text nodes (it never re-renders for a new text). A sequence keeps one
 * text node per part, as JSX children would (`{x}, {y}` is three nodes – the text shapes the same).
 */
export class LiveSlot extends Component<LiveSlotProps> {
  private nodes: Text[] | null = null;

  /** The element's ref: the text nodes go into it (once; again after a tag change). */
  private readonly attach = (el: HTMLElement | null): void => {
    if (!el) return;
    if (!this.nodes) {
      this.nodes = partsOf(this.props.live).map((part) => {
        const node = document.createTextNode(typeof part === 'string' ? part : part.text);
        if (typeof part !== 'string') part.bind(node);
        return node;
      });
    }
    for (const node of this.nodes) if (node.parentNode !== el) el.appendChild(node);
  };

  private unbind(): void {
    const parts = partsOf(this.props.live);
    this.nodes?.forEach((node, i) => {
      const part = parts[i];
      if (part && typeof part !== 'string') part.unbind(node);
    });
  }

  shouldComponentUpdate(next: LiveSlotProps): boolean {
    if (next.live !== this.props.live) {
      // other texts: new nodes (the ref adds them when the element draws again)
      this.unbind();
      this.nodes?.forEach((node) => node.remove());
      this.nodes = null;
      return true;
    }
    return next.class !== this.props.class || next.tag !== this.props.tag;
  }

  componentDidUpdate(): void {
    // a new sequence: the ref did not run again for the same element
    if (!this.nodes && this.el) this.attach(this.el);
  }

  componentWillUnmount(): void {
    this.unbind();
    this.nodes = null;
  }

  private el: HTMLElement | null = null;
  private readonly ref = (el: HTMLElement | null): void => {
    this.el = el;
    this.attach(el);
  };

  render({ class: cls, tag = 'span' }: LiveSlotProps) {
    return h(tag, { class: cls, ref: this.ref });
  }
}
