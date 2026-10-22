// Screens loaded on first use (audit 2026-10-17, P6/P10): a rare or docked-only screen (shipyard editor,
// hangar, templates, Development, the Board, the map) is a chunk of its own, so the game's first frame
// does not download, parse or keep it. The game fetches each one in an idle moment before it can be
// opened (lazyScreens.ts) – when that has not happened yet, the screen draws nothing for the few
// milliseconds its chunk takes, then appears; when the download fails it shows a Retry state.
import { h, type ComponentType, type FunctionComponent } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { tx } from '../i18n';
import { Button, Lamp, Panel } from './theme';

export interface LazyModule<M> {
  /** Starts the download once (again after a failure); resolves with the module. */
  load(): Promise<M>;
  /** The module once loaded, null before. */
  readonly loaded: M | null;
}

export function lazyModule<M>(importer: () => Promise<M>): LazyModule<M> {
  let loaded: M | null = null;
  let loading: Promise<M> | null = null;
  return {
    load() {
      loading ??= importer().then(
        (m) => (loaded = m),
        (e: unknown) => {
          loading = null;
          throw e;
        },
      );
      return loading;
    },
    get loaded() {
      return loaded;
    },
  };
}

export type LazyStatus = 'loading' | 'failed' | 'ready';

/**
 * Starts (or joins) the module's download and reports its outcome; the returned function stops reporting
 * (the component went away). A failed download is retried by calling this again.
 */
export function startLoad<M>(module: LazyModule<M>, report: (status: LazyStatus) => void): () => void {
  let live = true;
  module.load().then(
    () => live && report('ready'),
    (e: unknown) => {
      console.warn('Screen failed to load', e);
      if (live) report('failed');
    },
  );
  return () => {
    live = false;
  };
}

/** Inline state of a screen whose chunk did not download: what happened and a Retry button. */
function LazyFailed({ onRetry }: { onRetry: () => void }) {
  const t = tx().loading;
  return h(
    Panel,
    { material: 'screen', cut: 'sm', class: 'lz-fail', testId: 'lazy-failed' },
    h(Lamp, { state: 'bad' }),
    h('span', { class: 'lz-fail-text', role: 'alert' }, t.screenFailed),
    h(Button, { variant: 'secondary', size: 'sm', onClick: onRetry, testId: 'lazy-retry', children: t.retry }),
  );
}

/** A component of a lazy module: nothing until the module is in, then the component itself (a failure shows Retry). */
export function lazyComponent<M, P extends object>(module: LazyModule<M>, pick: (m: M) => ComponentType<P>): FunctionComponent<P> {
  return function Lazy(props: P) {
    const [status, setStatus] = useState<LazyStatus>('loading');
    const [attempt, setAttempt] = useState(0);
    const m = module.loaded;
    useEffect(() => {
      if (m) return;
      setStatus('loading');
      return startLoad(module, setStatus);
    }, [m, attempt]);
    if (m) return h(pick(m) as ComponentType<object>, props);
    return status === 'failed' ? h(LazyFailed, { onRetry: () => setAttempt((a) => a + 1) }) : null;
  };
}

/** Runs `job` when the main thread is idle, at the latest after `timeout` ms. */
export function whenIdle(job: () => void, timeout: number): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(job, { timeout });
  else setTimeout(job, Math.min(timeout, 200));
}
