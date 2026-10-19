// Memoised components without preact/compat (its global option hooks would change how every element
// is created). The flight HUD redraws 10× per second; a part whose inputs did not change skips its
// whole subtree in the diff (audit 2026-10-16, issue #8; 2026-10-17 P7).
import { Component, type ComponentChildren } from 'preact';
import { getLocale } from '../i18n/locale';

/** Options of `pure`. */
export interface PureOptions<P = never> {
  /**
   * After a render caused by changed props, render once more on the first parent render at or after
   * each of these delays (ms): for parts whose output depends on the time since a change (a hit pulse
   * that must end on a later redraw, not when the next change comes). Only those redraws, not every
   * parent render in between.
   */
  settleAt?: readonly number[];
  /** Arms the `settleAt` deadlines only for a change this calls one (default: any change). */
  settleOn?: (prev: P, next: P) => boolean;
}

/**
 * Wraps a function component: it re-renders only when `same(prev, next)` is false or the UI language
 * changed since its last render (its texts come from `tx()`, not from props). The render function may
 * use hooks (they belong to the wrapper's instance); their state updates still re-render it.
 */
export function pure<P extends object>(render: (props: P) => ComponentChildren, same: (prev: P, next: P) => boolean = shallowEqual, options: PureOptions<P> = {}) {
  const settle = options.settleAt ?? NO_SETTLE;
  const settleOn = options.settleOn;
  return class Pure extends Component<P> {
    static displayName = `pure(${render.name || 'component'})`;
    private lang = getLocale();
    /** performance.now() times at which the part must draw again (settleAt after each change). */
    private due: number[] = [];

    shouldComponentUpdate(next: P): boolean {
      if (getLocale() !== this.lang) return true;
      if (!same(this.props, next)) {
        if (settle.length > 0 && (!settleOn || settleOn(this.props, next))) {
          const now = performance.now();
          for (const ms of settle) this.due.push(now + ms);
        }
        return true;
      }
      return this.due.length > 0 && this.settled();
    }

    /** Drops the deadlines that passed; true when any did. */
    private settled(): boolean {
      const now = performance.now();
      const due = this.due;
      let kept = 0;
      for (const t of due) if (t > now) due[kept++] = t;
      const fired = kept < due.length;
      due.length = kept;
      return fired;
    }

    render(props: P): ComponentChildren {
      this.lang = getLocale();
      return render(props);
    }
  };
}

const NO_SETTLE: readonly number[] = [];

/** The same keys with identical (===) values. */
export function shallowEqual<P extends object>(a: P, b: P): boolean {
  if (a === b) return true;
  const ka = Object.keys(a) as (keyof P)[];
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

const isPlain = (v: object): boolean => {
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
};

/**
 * Structural equality of view data: primitives by value (NaN equals NaN), arrays and plain objects by
 * content, anything else (functions, Maps, class instances, DOM nodes) by identity. The HUD's view
 * models are rebuilt every redraw; comparing their content is far cheaper than diffing the subtree.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'number') return a !== a && b !== b;
  if (typeof a !== 'object' || a === null || b === null) return false;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  if (Array.isArray(x)) {
    if (!Array.isArray(y) || x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!deepEqual(x[i], y[i])) return false;
    return true;
  }
  if (Array.isArray(y) || !isPlain(x) || !isPlain(y)) return false;
  let n = 0;
  for (const k in x) {
    if (!Object.prototype.hasOwnProperty.call(x, k)) continue;
    if (!Object.prototype.hasOwnProperty.call(y, k) || !deepEqual(x[k], y[k])) return false;
    n++;
  }
  for (const k in y) if (Object.prototype.hasOwnProperty.call(y, k)) n--;
  return n === 0;
}

/** `deepEqual` as a `pure` comparator. */
export const sameDeep = <P extends object>(a: P, b: P): boolean => deepEqual(a, b);
