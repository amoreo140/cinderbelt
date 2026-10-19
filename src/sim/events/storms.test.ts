// stormAt (M4b T1): the legacy area storm or a derelict's local storm defence (siteStorms, T4).
import { describe, expect, it, vi } from 'vitest';
import type { SiteStorm } from '../sites/types';

const storms: SiteStorm[] = [];
vi.mock('../sites/derelict', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sites/derelict')>();
  return { ...actual, siteStorms: () => storms };
});

const { ionStormAt } = await import('../discovery/events');
const { Simulation } = await import('../Simulation');
const { activeEvents } = await import('./director');
const { stormAt } = await import('./storms');

describe('stormAt', () => {
  it('is true inside a derelict storm, false outside its radius or time', () => {
    const sim = new Simulation({ seed: 3, startDocked: false });
    const pos = { x: 5000, y: -3000 };
    // a point and window without a legacy storm
    let tick = 200_000;
    while (ionStormAt(3, pos, tick) || ionStormAt(3, { x: pos.x + 390, y: pos.y }, tick) || ionStormAt(3, { x: pos.x + 410, y: pos.y }, tick)) tick += 3_000;
    storms.length = 0;
    expect(stormAt(sim.state, pos, tick)).toBe(false);
    storms.push({ id: 'dl:25,-15', pos, radius: 400, start: tick - 10, end: tick + 75 * 60 });
    expect(stormAt(sim.state, pos, tick)).toBe(true);
    expect(stormAt(sim.state, { x: pos.x + 390, y: pos.y }, tick)).toBe(true);
    expect(stormAt(sim.state, { x: pos.x + 410, y: pos.y }, tick)).toBe(false);
    expect(stormAt(sim.state, pos, tick - 11)).toBe(false);
    expect(stormAt(sim.state, pos, tick + 75 * 60)).toBe(false);
    // the director lists it as an ion storm while the ship is inside
    const body = { pos: { x: pos.x + 100, y: pos.y }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    sim.state.player.body = body;
    sim.state.tick = tick;
    expect(activeEvents(sim.state).filter((e) => e.kind === 'ionStorm')).toEqual([
      { key: `ev:ionStorm:dl:25,-15@${tick - 10}`, kind: 'ionStorm', start: tick - 10, end: tick + 75 * 60, pos },
    ]);
    storms.length = 0;
  });

  it('equals the legacy storm without derelict storms', () => {
    const sim = new Simulation({ seed: 3, startDocked: false });
    for (const pos of [{ x: 2500, y: 0 }, { x: -4000, y: 3000 }]) {
      for (let tick = 0; tick < 300_000; tick += 4_001) expect(stormAt(sim.state, pos, tick)).toBe(ionStormAt(3, pos, tick));
    }
  });
});
