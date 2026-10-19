// Comet flyby – the derived director event (M4b T2, plan §2.2): announced once per comet pass when the
// pass comes within COMET_FLYBY.range of the player in the next COMET_FLYBY.leadSeconds, listed for the
// event chip with the ETA, and the comet becomes a scanner signal.
import { describe, expect, it } from 'vitest';
import { COMET_FLYBY } from '../../data/events';
import { IDLE_COMMAND } from '../commands';
import { cometAt, cometDefs, cometPassWindow } from '../sites/comets';
import { Simulation, type SimEvent } from '../Simulation';
import { loadSave } from '../save/load';
import { restoreSimulation, toEnvelope, toSave } from '../save/serialize';
import { testContext } from '../save/testing';
import type { ChunkGenerator } from '../world/generate';
import { cometFlybyEvents, cometFlybyKey, stepCometFlyby } from './cometFlyby';

const SEED = 7;
const empty: ChunkGenerator = (_s, cx, cy) => ({ cx, cy, asteroids: [] });
const LEAD = COMET_FLYBY.leadSeconds * 60;

/** A ship parked 600 u off the middle of comet `n`'s arc, `before` ticks ahead of that point of the pass. */
function waiting(n: number, before: number): { sim: Simulation; id: string; pass: number; meet: number } {
  const sim = new Simulation({ seed: SEED, startDocked: false, generator: empty });
  const id = cometDefs(SEED)[n]!.id;
  const w = cometPassWindow(SEED, id, 100_000)!;
  const meet = w.start + Math.floor((w.end - w.start) / 2);
  const mid = cometAt(SEED, id, meet)!.pos;
  const r = Math.hypot(mid.x, mid.y);
  sim.state.player.body = { pos: { x: mid.x * (1 + 600 / r), y: mid.y * (1 + 600 / r) }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
  sim.state.player.prevBody = sim.state.player.body;
  sim.state.tick = meet - before;
  return { sim, id, pass: w.pass, meet };
}

const warnings = (events: readonly SimEvent[]) => events.filter((e): e is Extract<SimEvent, { type: 'eventWarning' }> => e.type === 'eventWarning' && e.kind === 'cometFlyby');

describe('comet flyby', () => {
  it('is listed while the pass is coming within range in the lead window, with the ETA and the closest point', () => {
    const { sim, id, pass } = waiting(2, 60 * 60);
    const list = cometFlybyEvents(sim.state);
    const e = list.find((x) => x.key === cometFlybyKey(id, pass))!;
    expect(e).toBeDefined();
    expect(e.kind).toBe('cometFlyby');
    expect(e.start).toBeGreaterThanOrEqual(sim.state.tick);
    expect(e.start - sim.state.tick).toBeLessThanOrEqual(LEAD);
    expect(e.end).toBeGreaterThan(e.start);
    // the nucleus is within range exactly from `start` until `end`
    const p = sim.state.player.body.pos;
    const d = (t: number): number => Math.hypot(cometAt(SEED, id, t)!.pos.x - p.x, cometAt(SEED, id, t)!.pos.y - p.y);
    expect(d(e.start)).toBeLessThanOrEqual(COMET_FLYBY.range);
    if (e.start > sim.state.tick && cometAt(SEED, id, e.start - 1)) expect(d(e.start - 1)).toBeGreaterThan(COMET_FLYBY.range);
    expect(d(e.end - 1)).toBeLessThanOrEqual(COMET_FLYBY.range);
    expect(Math.hypot(e.pos!.x - p.x, e.pos!.y - p.y)).toBeCloseTo(600, -1);
    expect(e.sector).toMatch(/^rg:/);
  });

  it('is announced once per pass (eventWarning + a scanner signal) and again on the next pass', () => {
    const { sim, id, pass, meet } = waiting(2, 60 * 60);
    const enter = cometFlybyEvents(sim.state).find((e) => e.key === cometFlybyKey(id, pass))!.start;
    // just before the lead window: nothing yet
    sim.state.tick = enter - LEAD - 30;
    const events: SimEvent[] = [];
    for (let i = 0; i < 29; i++) events.push(...sim.step(IDLE_COMMAND));
    expect(warnings(events)).toEqual([]);
    // the window opens: one warning with the ETA
    for (let i = 0; i < 600; i++) events.push(...sim.step(IDLE_COMMAND));
    const w = warnings(events);
    expect(w).toHaveLength(1);
    expect(w[0]!.key).toBe(cometFlybyKey(id, pass));
    expect(w[0]!.inSeconds).toBeCloseTo(COMET_FLYBY.leadSeconds, 0);
    expect(sim.state.director.fired.has(cometFlybyKey(id, pass))).toBe(true);
    expect(sim.state.discovery.signals.some((s) => s.id === id && s.kind === 'comet') || sim.state.discovery.known.has(id)).toBe(true);
    // the whole pass: still once
    const more: SimEvent[] = [];
    for (let i = 0; i < 60 * 60; i++) more.push(...sim.step(IDLE_COMMAND));
    expect(warnings(more)).toEqual([]);
    // the next pass of the same comet is a new flyby
    const def = cometDefs(SEED)[2]!;
    sim.state.tick = enter + def.periodTicks - LEAD - 30;
    const next: SimEvent[] = [];
    for (let i = 0; i < 60; i++) next.push(...sim.step(IDLE_COMMAND));
    expect(warnings(next).map((e) => e.key)).toEqual([cometFlybyKey(id, pass + 1)]);
    expect(meet).toBeGreaterThan(enter);
  });

  it('a game saved and loaded during a flyby does not announce it again', () => {
    const { sim, id, pass } = waiting(2, 60 * 60);
    const enter = cometFlybyEvents(sim.state).find((e) => e.key === cometFlybyKey(id, pass))!.start;
    sim.state.tick = enter - LEAD - 30;
    for (let i = 0; i < 120; i++) sim.step(IDLE_COMMAND);
    const result = loadSave(toEnvelope(toSave(sim, testContext())));
    if (!result.ok) throw new Error('load failed');
    const loaded = restoreSimulation(result.save, { generator: empty });
    const a: SimEvent[] = [];
    const b: SimEvent[] = [];
    for (let i = 0; i < 600; i++) {
      a.push(...sim.step(IDLE_COMMAND));
      b.push(...loaded.step(IDLE_COMMAND));
    }
    expect(warnings(b)).toEqual(warnings(a));
    expect(warnings(b)).toEqual([]);
  });

  it('a pass that stays farther than the range is never announced', () => {
    const { sim } = waiting(2, 60 * 60);
    const p = sim.state.player.body.pos;
    const r = Math.hypot(p.x, p.y);
    sim.state.player.body = { ...sim.state.player.body, pos: { x: p.x * (1 + 2_500 / r), y: p.y * (1 + 2_500 / r) } };
    const near = cometFlybyEvents(sim.state).filter((e) => e.key.startsWith(`ev:comet:${cometDefs(SEED)[2]!.id}@`));
    expect(near).toEqual([]);
  });

  it('waits while docked or destroyed', () => {
    const { sim, id, pass } = waiting(2, 60 * 60);
    sim.state.player.dock = { mode: 'docked', stationId: 'home' } as typeof sim.state.player.dock;
    const events: SimEvent[] = [];
    stepCometFlyby(sim.state, events);
    expect(events).toEqual([]);
    expect(sim.state.director.fired.has(cometFlybyKey(id, pass))).toBe(false);
  });
});
