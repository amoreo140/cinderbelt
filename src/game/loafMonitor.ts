// Long animation frames (Chrome's `long-animation-frame` performance entries, LoAF) for the perf guard
// (`tests/e2e/perfGuard.spec.ts`, CLAUDE.md budget: no frame > 50 ms after the warm-up). Dev builds
// expose the monitor as `window.__cinder.loaf`; the production bundle never creates it.

/** One long animation frame (times in ms of `performance.now()`). */
export interface LoafEntry {
  start: number;
  duration: number;
  /** The part of the frame that blocked input (the long-task share). */
  blocking: number;
  /** The longest scripts of the frame (at most 4), longest first. */
  scripts: { invoker: string; fn: string; source: string; char: number; duration: number; forcedLayout: number }[];
}

export interface LoafMonitor {
  /** The browser reports long animation frames (Chromium 123+); false = the list stays empty. */
  readonly supported: boolean;
  /** Every recorded frame still in the ring (oldest first). */
  entries(): LoafEntry[];
  /** Frames that started at or after `t` (`performance.now()` time). */
  since(t: number): LoafEntry[];
  clear(): void;
}

/** The entries kept (the oldest drop out): a long session must not grow the list. */
export const LOAF_CAPACITY = 256;

/** The fields of a `PerformanceLongAnimationFrameTiming` the monitor reads (not in every TS DOM lib). */
interface RawScript {
  invoker?: string;
  sourceFunctionName?: string;
  sourceURL?: string;
  sourceCharPosition?: number;
  duration: number;
  forcedStyleAndLayoutDuration?: number;
}
interface RawLoaf {
  startTime: number;
  duration: number;
  blockingDuration?: number;
  scripts?: readonly RawScript[];
}

type ObserverCtor = new (callback: (list: { getEntries(): readonly unknown[] }) => void) => {
  observe(options: { type: string; buffered?: boolean }): void;
};

/** Converts one raw entry (exported for the unit test). */
export function toLoafEntry(raw: RawLoaf): LoafEntry {
  const scripts = [...(raw.scripts ?? [])]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 4)
    .map((s) => ({
      invoker: s.invoker ?? '',
      fn: s.sourceFunctionName ?? '',
      source: s.sourceURL ?? '',
      char: s.sourceCharPosition ?? -1,
      duration: Math.round(s.duration),
      forcedLayout: Math.round(s.forcedStyleAndLayoutDuration ?? 0),
    }));
  return { start: raw.startTime, duration: raw.duration, blocking: raw.blockingDuration ?? 0, scripts };
}

/**
 * A monitor on `Observer` (the browser's `PerformanceObserver` by default). Unsupported (no observer,
 * no `long-animation-frame` entry type) gives a monitor whose list stays empty.
 */
export function createLoafMonitor(
  Observer: ObserverCtor | undefined = globalThis.PerformanceObserver as unknown as ObserverCtor | undefined,
  supportedTypes: readonly string[] = globalThis.PerformanceObserver?.supportedEntryTypes ?? [],
): LoafMonitor {
  const ring: LoafEntry[] = [];
  let supported = false;
  if (Observer && supportedTypes.includes('long-animation-frame')) {
    try {
      new Observer((list) => {
        for (const e of list.getEntries()) {
          ring.push(toLoafEntry(e as RawLoaf));
          if (ring.length > LOAF_CAPACITY) ring.shift();
        }
      }).observe({ type: 'long-animation-frame', buffered: true });
      supported = true;
    } catch {
      supported = false;
    }
  }
  return {
    supported,
    entries: () => ring.slice(),
    since: (t) => ring.filter((e) => e.start >= t),
    clear: () => {
      ring.length = 0;
    },
  };
}

let shared: LoafMonitor | null = null;

/** The page's one monitor (created on the first call; a relaunched game keeps observing into it). */
export function loafMonitor(): LoafMonitor {
  shared ??= createLoafMonitor();
  return shared;
}
