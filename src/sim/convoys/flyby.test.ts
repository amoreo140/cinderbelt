// M4d T5: the convoy flyby (plan §2.5 "Flyby event") – announced 120 s before a pass comes within 1 500 u
// of the flying player, once per pass (also on its way back), never again after a reload, listed by the
// director as a derived event that never touches its quiet window.
import { describe, expect, it } from 'vitest';
import { CONVOY } from '../../data/convoys';
import { IDLE_COMMAND } from '../commands';
import { activeEvents } from '../events/director';
import { flyingAt, ofType, run } from '../discovery/testing';
import { Simulation } from '../Simulation';
import { convoyFlybyEvents, convoyFlybyKey } from './flyby';
import { convoyAt, convoyPassWindow } from './schedule';

const SEED = 3;
const T = 60;
const PASS = 'cv:A@2';
const W = convoyPassWindow(SEED, PASS)!;
/** The trader passes the watcher (200 u off its route) at this tick. */
const CLOSEST = Math.ceil(W.depart) + 300 * T;
const trader = convoyAt(SEED, PASS, CLOSEST)!;
const t0 = trader.ships[0]!;
const WATCHER = { x: t0.pos.x - Math.sin(t0.heading) * 200, y: t0.pos.y + Math.cos(t0.heading) * 200 };
/** Well before the flyby is listed: the trader ~1 500 + 1 200 + 300 u away along its route. */
const EARLY = CLOSEST - Math.round((CONVOY.flybyRadius / CONVOY.speed + CONVOY.flybyLead + 30) * T);

const watcher = (tick: number): Simulation => {
  const sim = flyingAt(SEED, WATCHER);
  sim.state.tick = tick;
  return sim;
};

/** Steps until the flyby warning (at most `max` steps); the events of those steps. */
function untilWarning(sim: Simulation, max: number) {
  for (let i = 0; i < max; i++) {
    const events = sim.step(IDLE_COMMAND);
    const w = ofType(events, 'eventWarning').filter((e) => e.kind === 'convoyFlyby');
    if (w.length) return w;
  }
  return [];
}

describe('convoy flyby', () => {
  it('is not listed while the pass is still far', () => {
    expect(convoyFlybyEvents(watcher(EARLY).state)).toEqual([]);
  });

  it('warns once, 120 s ahead, with the direction to the closest approach', () => {
    const sim = watcher(EARLY);
    const warnings = untilWarning(sim, 60 * T);
    expect(warnings).toHaveLength(1);
    const w = warnings[0]!;
    expect(w.key).toBe(convoyFlybyKey(PASS));
    expect(w.inSeconds).toBeGreaterThan(CONVOY.flybyLead - 1.5);
    expect(w.inSeconds).toBeLessThanOrEqual(CONVOY.flybyLead);
    expect(sim.state.director.fired.has(w.key)).toBe(true);
    // the key stays until the pass is over
    expect(sim.state.director.fired.get(w.key)).toBeGreaterThanOrEqual(Math.ceil(W.end) - 1);
    const listed = convoyFlybyEvents(sim.state);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ key: w.key, kind: 'convoyFlyby' });
    expect(listed[0]!.end).toBeGreaterThan(listed[0]!.start);
    expect(Math.hypot(listed[0]!.pos!.x - WATCHER.x, listed[0]!.pos!.y - WATCHER.y)).toBeLessThan(260);
    expect(activeEvents(sim.state).map((e) => e.key)).toContain(w.key);
    // the director's quiet window is untouched
    expect(sim.state.director.last).toBe(-1e9);
    // never again on the way in…
    expect(ofType(run(sim, 10 * T), 'eventWarning').filter((e) => e.kind === 'convoyFlyby')).toEqual([]);
    // …nor on the way back (once per pass)
    sim.state.tick = Math.ceil(W.back) + 10 * T;
    expect(ofType(run(sim, 30 * T), 'eventWarning').filter((e) => e.kind === 'convoyFlyby')).toEqual([]);
  });

  it('a reloaded game does not announce it again', () => {
    const sim = watcher(EARLY);
    untilWarning(sim, 60 * T);
    run(sim, 5);
    // "load": the same tick and pose, prevBody = body, the saved one-shot keys
    const loaded = watcher(sim.state.tick);
    loaded.state.director.fired = new Map(sim.state.director.fired);
    expect(ofType(run(loaded, 5 * T), 'eventWarning').filter((e) => e.kind === 'convoyFlyby')).toEqual([]);
    // even without the key, a flyby already listed at the load is not announced (edge-triggered)
    const bare = watcher(sim.state.tick);
    expect(convoyFlybyEvents(bare.state)).toHaveLength(1);
    expect(ofType(run(bare, 5 * T), 'eventWarning').filter((e) => e.kind === 'convoyFlyby')).toEqual([]);
  });

  it('a docked pilot gets no flyby', () => {
    const sim = new Simulation({ seed: SEED });
    sim.state.tick = CLOSEST - 60 * T;
    expect(convoyFlybyEvents(sim.state)).toEqual([]);
  });
});
