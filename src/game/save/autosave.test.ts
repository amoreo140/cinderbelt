import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../sim/Simulation';
import { AUTOSAVE_INTERVAL_TICKS, AutosaveScheduler } from './autosave';

const docked: SimEvent[] = [{ type: 'docked', stationId: 'home' }];

describe('AutosaveScheduler', () => {
  it('saves every 2 minutes of game time (7200 steps)', () => {
    expect(AUTOSAVE_INTERVAL_TICKS).toBe(7200);
    const s = new AutosaveScheduler(100);
    expect(s.afterStep(100 + 7199, [], 'flying')).toBeNull();
    expect(s.afterStep(100 + 7200, [], 'flying')).toBe('interval');
    expect(s.afterStep(100 + 7201, [], 'flying')).toBeNull();
    expect(s.afterStep(100 + 14400, [], 'docked')).toBe('interval');
  });

  it('counts only simulated time – pauses do not advance the interval', () => {
    const s = new AutosaveScheduler(0, { intervalTicks: 10 });
    // pause: no steps, the tick does not change
    expect(s.afterStep(5, [], 'flying')).toBeNull();
    expect(s.afterStep(9, [], 'flying')).toBeNull();
    expect(s.afterStep(10, [], 'flying')).toBe('interval');
  });

  it('saves when the ship docks (also after a tow) and restarts the interval', () => {
    const s = new AutosaveScheduler(0, { intervalTicks: 10 });
    expect(s.afterStep(4, docked, 'docked')).toBe('dock');
    expect(s.afterStep(13, [], 'docked')).toBeNull();
    expect(s.afterStep(14, [], 'docked')).toBe('interval');
  });

  it('postpones the interval save while docking is in progress', () => {
    const s = new AutosaveScheduler(0, { intervalTicks: 10 });
    expect(s.afterStep(10, [], 'docking')).toBeNull();
    expect(s.afterStep(30, [], 'docking')).toBeNull();
    // docking ends with a docked event → saved as "dock"
    expect(s.afterStep(31, docked, 'docked')).toBe('dock');
    expect(s.afterStep(32, [], 'docked')).toBeNull();
  });

  it('serves on-demand requests at the next step, even while docking', () => {
    const s = new AutosaveScheduler(0, { intervalTicks: 100 });
    s.request('manual');
    expect(s.afterStep(1, [], 'docking')).toBe('manual');
    expect(s.afterStep(2, [], 'docking')).toBeNull();
  });

  it('prefers a dock save over a pending request and drops the request (one save per step)', () => {
    const s = new AutosaveScheduler(0, { intervalTicks: 100 });
    s.request('manual');
    expect(s.afterStep(1, docked, 'docked')).toBe('dock');
    expect(s.afterStep(2, [], 'docked')).toBeNull();
  });

  it('takes a pending request immediately (e.g. when the tab is hidden)', () => {
    const s = new AutosaveScheduler(0);
    expect(s.takeRequest()).toBeNull();
    s.request('interval');
    expect(s.takeRequest()).toBe('interval');
    expect(s.takeRequest()).toBeNull();
  });

  it('restarts the interval after a save made outside the scheduler', () => {
    const s = new AutosaveScheduler(0, { intervalTicks: 10 });
    s.markSaved(8);
    expect(s.afterStep(10, [], 'flying')).toBeNull();
    expect(s.afterStep(18, [], 'flying')).toBe('interval');
  });

  it('can be reset for a newly loaded game', () => {
    const s = new AutosaveScheduler(0, { intervalTicks: 10 });
    s.request('manual');
    s.reset(500);
    expect(s.afterStep(505, [], 'flying')).toBeNull();
    expect(s.afterStep(510, [], 'flying')).toBe('interval');
  });
});
