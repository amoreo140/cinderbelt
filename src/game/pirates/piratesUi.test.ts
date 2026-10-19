import { describe, expect, it } from 'vitest';
import { flyingAt, run, teleport } from '../../sim/discovery/testing';
import { fortressSites } from '../../sim/pirates/sites';
import { createGrid } from '../../sim/ship/grid';
import { PiratesUi } from './piratesUi';

const SEED = 4242;
const grid = () => createGrid([['cockpit', 0, 0], ['cannon', 1, 0], ['cannon', 0, 1, 1], ['tractorBeam', 0, -1], ['reactor', -1, 0]]);

describe('PiratesUi', () => {
  const ui = new PiratesUi();

  it('stays quiet at home and shows attention, the raid and the toll in the outer belts', () => {
    const home = flyingAt(SEED, { x: 0, y: 400 }, grid());
    expect(ui.hud(home.state).attention).toBeNull();
    const f = fortressSites(SEED)[0]!;
    const sim = flyingAt(SEED, { x: f.beacon.pos.x - 30, y: f.beacon.pos.y }, grid());
    sim.state.pirates.attention = 65;
    expect(ui.hud(sim.state).attention).toMatchObject({ level: 2, value: 65, raid: null });
    sim.state.pirates.attention = 95;
    run(sim, 1);
    expect(ui.hud(sim.state).attention!.raid).toMatch(/Nájazd/);
    sim.state.pirates.toll = { group: 'pr:1,1', amount: 450, until: sim.state.tick + 600 };
    sim.state.credits = 100;
    expect(ui.hud(sim.state).toll).toMatchObject({ seconds: 10, canPay: false });
  });

  it('shows the tractor line, the fortress band near a fortress and the beacon prompt', () => {
    const f = fortressSites(SEED)[0]!;
    const sim = flyingAt(SEED, { x: f.beacon.pos.x - 6, y: f.beacon.pos.y }, grid());
    expect(ui.hud(sim.state).tractor).toMatchObject({ active: false });
    expect(ui.prompt(sim.state)).toMatchObject({ kind: 'ok' });
    teleport(sim, { x: f.pos.x - 60, y: f.pos.y });
    expect(ui.hud(sim.state).fortress).toMatchObject({ core: 1, shielded: true, gens: [true, true] });
    expect(ui.callouts(sim.state).some((c) => c.id === f.id)).toBe(true);
    expect(ui.map(sim.state).filter((m) => m.kind === 'fortress')).toHaveLength(3);
  });

  it('counts the cannons that can hit the aim point', () => {
    const sim = flyingAt(SEED, { x: 0, y: 400 }, grid());
    const p = sim.state.player.body.pos;
    expect(ui.reticle(sim.state, { x: p.x + 30, y: p.y })).toEqual({ covering: 1, total: 2 });
    expect(ui.reticle(sim.state, { x: p.x - 30, y: p.y })).toEqual({ covering: 0, total: 2 });
  });
});

describe('container toast (M20)', () => {
  const ui = new PiratesUi();
  const sim = flyingAt(4242, { x: 0, y: 400 });
  const loaded = (cargo: Record<string, number>, parts: Record<string, number>, cargoFull: boolean) =>
    ui.toast(sim.state, [{ type: 'containerLoaded', containerId: 1, pos: { x: 0, y: 0 }, cargo, parts, cargoFull }]);

  it('lists what was loaded and says when the rest stayed in the container', () => {
    expect(loaded({ iron: 12 }, { 'cannon:1': 1 }, false)).toMatchObject({ text: 'Z kontajnera: 12 Fe, 1× Kanón T1', kind: 'ok' });
    expect(loaded({ iron: 3 }, {}, true)).toMatchObject({ text: 'Z kontajnera: 3 Fe – náklad je plný, zvyšok ostal v kontajneri', kind: 'info' });
    expect(loaded({}, {}, true)).toMatchObject({ text: 'Náklad je plný – obsah ostal v kontajneri', kind: 'error' });
  });
});
