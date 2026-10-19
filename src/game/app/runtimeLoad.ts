// The download of the game runtime (runtime.ts: code + models), started once – after the menu is up, or
// at once when the boot goes straight into a game. The App waits for it before a game starts and shows
// the loading overlay with its progress meanwhile.
import type { LoadProgress } from '../../render/assets/ModelLibrary';
import type { Vec2 } from '../../sim/math/vec2';
import type { SimState } from '../../sim/Simulation';
import type { GameRuntime } from './runtime';

export type { GameRuntime };

type RuntimeModule = typeof import('./runtime');

export class RuntimeLoad {
  private module: RuntimeModule | null = null;
  private promise: Promise<GameRuntime> | null = null;
  private loaded = 0;
  private total = 0;
  private readonly listeners = new Set<LoadProgress>();
  /** Zones to prefetch once the runtime's code is in (prefetchZone before it). */
  private readonly zones: { seed: number; pos: Vec2; warm: boolean }[] = [];
  /** Worlds to prewarm once the runtime's code is in (prewarmWorld before it). */
  private readonly worlds: SimState[] = [];

  /** Starts the download (again after a failure); resolves with the runtime. */
  start(): Promise<GameRuntime> {
    this.promise ??= import('./runtime')
      .then((m) => {
        // the start zone's sky first: the warm-up's first phase waits for it (the network serves the
        // requests in the order asked)
        this.module = m;
        for (const z of this.zones.splice(0)) m.prefetchZone(z.seed, z.pos, z.warm);
        for (const state of this.worlds.splice(0)) m.prewarmWorld(state);
        return m.loadGameRuntime((loaded, total) => {
          this.loaded = loaded;
          this.total = total;
          for (const fn of [...this.listeners]) fn(loaded, total);
        });
      })
      .catch((e: unknown) => {
        this.promise = null;
        throw e;
      });
    return this.promise;
  }

  /**
   * The sky and planets of the zone a game at `pos` (world `seed`) starts in download ahead of the game
   * (perf O14) – now when the runtime's code is in, else with its download (`start`). `warm`: the game
   * starts as soon as the runtime is in – its sky is also decoded and filtered ahead.
   */
  prefetchZone(seed: number, pos: Vec2, warm = false): void {
    if (this.module) this.module.prefetchZone(seed, pos, warm);
    else this.zones.push({ seed, pos: { x: pos.x, y: pos.y }, warm });
  }

  /**
   * The world tables a game in `state` reads in its first frame are computed while the runtime's models
   * download (perf O14) – now when the runtime's code is in, else with its download.
   */
  prewarmWorld(state: SimState): void {
    if (this.module) this.module.prewarmWorld(state);
    else this.worlds.push(state);
  }

  /** Models loaded so far (the loading overlay). */
  get progress(): { loaded: number; total: number } {
    return { loaded: this.loaded, total: this.total };
  }

  /** Calls `fn` on every loaded model; returns the unsubscribe function. */
  onProgress(fn: LoadProgress): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
