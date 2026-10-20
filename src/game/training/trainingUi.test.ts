import { describe, expect, it, vi } from 'vitest';
import type { SimEvent } from '../../sim/Simulation';
import { trainingSim, undock } from '../../sim/training/testing';
import { TrainingUi } from './trainingUi';
import type { TrainingContext } from './trainingView';

const ctx = (patch: Partial<TrainingContext> = {}): TrainingContext => ({ tab: null, marketKind: 'resources', craftKey: null, yard: null, mapOpen: false, inCombat: false, ...patch });

function setup() {
  const sim = trainingSim(1337);
  undock(sim);
  const host = { state: () => sim.state, send: vi.fn(), render: vi.fn(), click: vi.fn() };
  return { sim, host, ui: new TrainingUi(host) };
}

const finalEvent = { type: 'trainingStep', step: 8, done: true } as unknown as SimEvent;

describe('TrainingUi', () => {
  it('holds the finished step for 2 s (all phases done, completed), then shows the live guide', () => {
    const { sim, ui } = setup();
    const first = ui.uiData(sim.state, ctx(), 10, null)!.guide!;
    expect(first.completed).toBeUndefined();
    sim.state.career.training.step = 1;
    const held = ui.uiData(sim.state, ctx(), 11, null)!.guide!;
    expect(held.index).toBe(0);
    expect(held.completed).toBe(true);
    expect(held.phases.every((p) => p.state === 'done')).toBe(true);
    expect(ui.uiData(sim.state, ctx(), 12.9, null)!.guide!.completed).toBe(true);
    const live = ui.uiData(sim.state, ctx(), 13.1, null)!.guide!;
    expect(live.index).toBe(1);
    expect(live.completed).toBeUndefined();
  });

  it('the final card stays until closed (button or Esc)', () => {
    const { sim, host, ui } = setup();
    sim.state.career.training.status = 'done';
    ui.onEvents([finalEvent]);
    expect(ui.uiData(sim.state, ctx(), 1, null)!.done).toBe(true);
    expect(ui.uiData(sim.state, ctx(), 10_000, null)!.done).toBe(true);
    expect(ui.onKey('Enter')).toBe(false);
    expect(ui.onKey('Escape')).toBe(true);
    expect(host.render).toHaveBeenCalled();
    expect(ui.uiData(sim.state, ctx(), 10_001, null)).toBeNull();
    ui.onEvents([finalEvent]);
    ui.handlers.closeDone();
    expect(ui.uiData(sim.state, ctx(), 10_002, null)).toBeNull();
  });

  it('Esc closes the skip confirmation before the done card', () => {
    const { sim, ui } = setup();
    ui.askSkip();
    sim.state.career.training.status = 'done';
    ui.onEvents([finalEvent]);
    ui.onKey('Escape');
    expect(ui.doneCardOpen).toBe(true);
  });

  it('emits no toast for steps or the end, only for a skip', async () => {
    const { trainingToast } = await import('./trainingUi');
    const { sim } = setup();
    expect(trainingToast(sim.state, { type: 'trainingStep', step: 1, credits: 50, parts: {}, done: false } as unknown as SimEvent)).toBeNull();
    expect(trainingToast(sim.state, finalEvent)).toBeNull();
  });
});
