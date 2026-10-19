// Screens loaded on first use (audit 2026-10-17, P6/P10): a rare or docked-only screen (shipyard editor,
// hangar, templates, Development, the Board, the map) is a chunk of its own, so the game's first frame
// does not download, parse or keep it. The game fetches each one in an idle moment before it can be
// opened (lazyScreens.ts) – when that has not happened yet, the screen draws nothing for the few
// milliseconds its chunk takes, then appears.
import { h, type ComponentType, type FunctionComponent } from 'preact';
import { useEffect, useState } from 'preact/hooks';

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

/** A component of a lazy module: nothing until the module is in, then the component itself. */
export function lazyComponent<M, P extends object>(module: LazyModule<M>, pick: (m: M) => ComponentType<P>): FunctionComponent<P> {
  return function Lazy(props: P) {
    const [, setReady] = useState(false);
    const m = module.loaded;
    useEffect(() => {
      if (m) return;
      let live = true;
      module.load().then(
        () => live && setReady(true),
        (e: unknown) => console.warn('Screen failed to load', e),
      );
      return () => {
        live = false;
      };
    }, [m]);
    return m ? h(pick(m) as ComponentType<object>, props) : null;
  };
}

/** Runs `job` when the main thread is idle, at the latest after `timeout` ms. */
export function whenIdle(job: () => void, timeout: number): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(job, { timeout });
  else setTimeout(job, Math.min(timeout, 200));
}
