// Ship rebuild queue (SL2 E1 T6): the player at once, enemies and wrecks at most `perFrame` per frame,
// nearest first, repeated requests coalesced.
import { describe, expect, it } from 'vitest';
import { createStarterShip } from '../../sim/ship/presets';
import { computeProperties } from '../../sim/ship/properties';
import type { ShipGrid } from '../../sim/ship/types';
import { ShipRebuildQueue } from './rebuildQueue';

const gridA = createStarterShip();
const propsA = computeProperties(gridA);
const gridB: ShipGrid = { ...gridA, parts: gridA.parts.slice(1) };
const propsB = computeProperties(gridB);

/** A view at a distance that logs its rebuilds into `log`. */
function fake(name: string, dist: number, log: string[]) {
  const builds: ShipGrid[] = [];
  return {
    name,
    dist,
    builds,
    rebuild(grid: ShipGrid) {
      builds.push(grid);
      log.push(name);
    },
  };
}
type Fake = ReturnType<typeof fake>;
const byDist = (v: Fake) => v.dist * v.dist;

describe('ShipRebuildQueue', () => {
  it('runs at most one queued rebuild per frame, nearest first', () => {
    const log: string[] = [];
    const q = new ShipRebuildQueue<Fake>(1);
    const far = fake('far', 80, log);
    const near = fake('near', 10, log);
    const mid = fake('mid', 40, log);
    q.request(far, gridA, propsA);
    q.request(near, gridA, propsA);
    q.request(mid, gridA, propsA);
    expect(log).toEqual([]);
    expect(q.pending).toBe(3);
    expect(q.flush(byDist)).toBe(1);
    expect(log).toEqual(['near']);
    expect(q.flush(byDist)).toBe(1);
    expect(q.flush(byDist)).toBe(1);
    expect(log).toEqual(['near', 'mid', 'far']);
    expect(q.flush(byDist)).toBe(0);
    expect(q.pending).toBe(0);
    expect(q.flushed).toBe(3);
  });

  it('honours a larger cap and re-reads distances every frame', () => {
    const log: string[] = [];
    const q = new ShipRebuildQueue<Fake>(2);
    const views = [fake('a', 30, log), fake('b', 20, log), fake('c', 10, log)];
    for (const v of views) q.request(v, gridA, propsA);
    expect(q.flush(byDist)).toBe(2);
    expect(log).toEqual(['c', 'b']);
    views[0]!.dist = 1;
    expect(q.flush(byDist)).toBe(1);
    expect(log).toEqual(['c', 'b', 'a']);
  });

  it('coalesces repeated requests: one rebuild with the latest grid, the first place kept', () => {
    const log: string[] = [];
    const q = new ShipRebuildQueue<Fake>(1);
    const a = fake('a', 10, log);
    const b = fake('b', 10, log);
    q.request(a, gridA, propsA);
    q.request(b, gridA, propsA);
    q.request(a, gridB, propsB);
    expect(q.pending).toBe(2);
    // equal distance: the earlier request goes first
    q.flush(byDist);
    expect(log).toEqual(['a']);
    expect(a.builds).toEqual([gridB]);
    q.flush(byDist);
    expect(log).toEqual(['a', 'b']);
  });

  it('rebuilds the player at once, outside the cap, dropping its pending request', () => {
    const log: string[] = [];
    const q = new ShipRebuildQueue<Fake>(1);
    const player = fake('player', 0, log);
    const pirate = fake('pirate', 5, log);
    q.request(pirate, gridA, propsA);
    q.request(player, gridA, propsA);
    q.now(player, gridB, propsB);
    expect(log).toEqual(['player']);
    expect(player.builds).toEqual([gridB]);
    expect(q.has(player)).toBe(false);
    expect(q.flush(byDist)).toBe(1);
    expect(log).toEqual(['player', 'pirate']);
  });

  it('cancel and clear forget pending views; NaN distances go last', () => {
    const log: string[] = [];
    const q = new ShipRebuildQueue<Fake>(1);
    const gone = fake('gone', 1, log);
    const lost = fake('lost', Number.NaN, log);
    const kept = fake('kept', 50, log);
    q.request(lost, gridA, propsA);
    q.request(gone, gridA, propsA);
    q.request(kept, gridA, propsA);
    q.cancel(gone);
    expect(q.has(gone)).toBe(false);
    q.flush(byDist);
    expect(log).toEqual(['kept']);
    q.clear();
    expect(q.pending).toBe(0);
    expect(q.flush(byDist)).toBe(0);
  });

  it('a rebuild that asks again waits for the next frame', () => {
    const q = new ShipRebuildQueue(1);
    let n = 0;
    const view = {
      rebuild() {
        if (++n === 1) q.request(view, gridA, propsA);
      },
    };
    q.request(view, gridA, propsA);
    expect(q.flush(() => 0)).toBe(1);
    expect(q.pending).toBe(1);
    expect(q.flush(() => 0)).toBe(1);
    expect(n).toBe(2);
  });
});
