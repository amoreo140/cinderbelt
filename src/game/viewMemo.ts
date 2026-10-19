// One memoised view model: kept while its key list is the same (element by element, `Object.is`). The
// hub's slower views (the Board with its cartography, the hangar) were rebuilt at every 10 Hz UI redraw
// while docked, though their inputs change only with a player action, a simulation event or the clock
// (perf audit 2026-10-17, P3).

export class ViewMemo<T> {
  private key: readonly unknown[] | null = null;
  private value: T | undefined;

  /** The value made for `key`, or a new one from `make` when any key element changed. */
  get(key: readonly unknown[], make: () => T): T {
    if (this.key && sameKey(this.key, key)) return this.value as T;
    const value = make();
    this.key = key;
    this.value = value;
    return value;
  }

  /** Forgets the value (the next `get` makes a new one). */
  clear(): void {
    this.key = null;
    this.value = undefined;
  }
}

function sameKey(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

/**
 * A memoised view model whose key is written value by value into a reused tape and compared with the
 * previous tape in place – for keys of varying length (a Map's entries, every resource of every storage)
 * that would otherwise need a key array or string per call. The flight HUD rebuilds its views at 10 Hz
 * and a simulation step lies between any two redraws, so the views are keyed on what they read, not on
 * the tick (perf audit 2026-10-17, O12).
 */
export class TapeMemo<T> {
  private prev: unknown[] = [];
  private next: unknown[] = [];
  private prevLength = -1;
  private length = 0;
  private value: T | undefined;

  /** Appends one key value (compared with `Object.is`). */
  readonly push = (v: unknown): void => {
    this.next[this.length++] = v;
  };

  /**
   * The value made for the key `write` pushes, or a new one from `make` when the key differs from the
   * previous call's.
   */
  get(write: (push: (v: unknown) => void) => void, make: () => T): T {
    this.length = 0;
    write(this.push);
    const n = this.length;
    let same = n === this.prevLength;
    for (let i = 0; same && i < n; i++) if (!Object.is(this.next[i], this.prev[i])) same = false;
    if (same) return this.value as T;
    this.value = make();
    const t = this.prev;
    this.prev = this.next;
    this.next = t;
    this.prevLength = n;
    return this.value;
  }

  /** Forgets the value (the next `get` makes a new one). */
  clear(): void {
    this.prevLength = -1;
    this.value = undefined;
  }
}
