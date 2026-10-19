// Ship rebuild queue (SL2 E1, spec §3.8, plan T6): rebuilding a view now also rebuilds its hull
// shell, so enemies and wrecks that lose parts in a fight are rebuilt at most `perFrame` per frame,
// nearest to the camera first; the player's ship is rebuilt at once (`now`). Repeated requests for
// the same view coalesce (the latest grid wins). A pending view keeps its old look for a few frames –
// the explosion covers the lost part.
import type { ShipGrid } from '../../sim/ship/types';
import type { ShipProperties } from '../../sim/ship/properties';
import { SHELL_REBUILDS_PER_FRAME } from './shellConstants';

/** Anything rebuilt from a grid (ShipView, or a CombatLayer entry that rebuilds and dresses its view). */
export interface Rebuildable {
  rebuild(grid: ShipGrid, props: ShipProperties): void;
}

interface Pending {
  grid: ShipGrid;
  props: ShipProperties;
}

export class ShipRebuildQueue<V extends Rebuildable = Rebuildable> {
  /** Waiting views in request order (the order breaks distance ties). */
  private readonly waiting = new Map<V, Pending>();
  /** Rebuilds run by `flush` since the queue was made (tests, the perf hook). */
  flushed = 0;

  constructor(readonly perFrame = SHELL_REBUILDS_PER_FRAME) {}

  /** Rebuild right away (the player's ship); drops a pending request of the same view. */
  now(view: V, grid: ShipGrid, props: ShipProperties): void {
    this.waiting.delete(view);
    view.rebuild(grid, props);
  }

  /** Queue a rebuild (enemies, wrecks); a view already waiting keeps its place and takes the new grid. */
  request(view: V, grid: ShipGrid, props: ShipProperties): void {
    const p = this.waiting.get(view);
    if (p) {
      p.grid = grid;
      p.props = props;
    } else this.waiting.set(view, { grid, props });
  }

  /** Is a rebuild of the view waiting? */
  has(view: V): boolean {
    return this.waiting.has(view);
  }

  /**
   * Runs up to `perFrame` pending rebuilds, nearest first; call once per frame. No allocation.
   * @param distanceSq squared camera distance of a view (the order)
   * @returns rebuilds done this frame
   */
  flush(distanceSq: (view: V) => number): number {
    let done = 0;
    while (done < this.perFrame && this.waiting.size > 0) {
      let best: V | null = null;
      let bestD = Infinity;
      for (const view of this.waiting.keys()) {
        const raw = distanceSq(view);
        // NaN (a view without a pose yet) counts as the farthest
        const d = Number.isNaN(raw) ? Infinity : raw;
        // strict: the earlier request wins a tie
        if (best === null || d < bestD) {
          best = view;
          bestD = d;
        }
      }
      const p = this.waiting.get(best!)!;
      // out first: a rebuild that asks again (or cancels) sees a clean queue
      this.waiting.delete(best!);
      best!.rebuild(p.grid, p.props);
      done++;
    }
    this.flushed += done;
    return done;
  }

  /** Forget a pending request (the view was disposed). */
  cancel(view: V): void {
    this.waiting.delete(view);
  }

  /** Views waiting for a rebuild. */
  get pending(): number {
    return this.waiting.size;
  }

  /** Drop every pending request (scene change). */
  clear(): void {
    this.waiting.clear();
  }
}
