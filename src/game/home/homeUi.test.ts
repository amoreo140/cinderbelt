// Home UI controller (M4c T2): handlers → GameActions, preview and focus state, toasts, dev hooks.
import { describe, expect, it } from 'vitest';
import type { HomeModuleId } from '../../data/home';
import { tx } from '../../i18n';
import type { GameActionInput } from '../../sim/commands';
import { parkForNewShip, richSim } from '../../sim/fleet/testing';
import type { Simulation } from '../../sim/Simulation';
import { act, customStation, dockedAt, expectOk } from '../../sim/station/testHarness';
import { HomeUi } from './homeUi';

function setup(sim: Simulation = richSim()) {
  const sent: GameActionInput[] = [];
  const focus: (HomeModuleId | null)[] = [];
  const toasts: string[] = [];
  let renders = 0;
  const ui = new HomeUi({
    state: () => sim.state,
    send: (a) => sent.push(a),
    render: () => void renders++,
    focus: (m) => focus.push(m),
    notify: (text) => toasts.push(text()),
  });
  return { sim, ui, sent, focus, toasts, renders: () => renders };
}

describe('HomeUi', () => {
  it('build and pin send the commands', () => {
    const { ui, sent } = setup();
    ui.handlers.build('paintShop');
    ui.handlers.pin('cap:3', true);
    expect(sent).toEqual([
      { type: 'homeBuild', module: 'paintShop' },
      { type: 'trophyPin', id: 'cap:3', pinned: true },
    ]);
  });

  it('paint sends the previewed paint for the selected ship – only a real change', () => {
    const { sim, ui, sent } = setup();
    expectOk(act(sim, { type: 'homeBuild', module: 'paintShop' }));
    parkForNewShip(sim); // ship 2 active, ship 1 in the hangar
    ui.handlers.paint();
    expect(sent).toEqual([]); // no preview
    ui.handlers.selectShip(1);
    ui.handlers.preview('navy');
    expect(ui.data(sim.state)!.paintShop).toMatchObject({ selectedShip: 1, preview: 'navy' });
    expect(ui.paintPreview(sim.state)).toEqual({ shipId: 1, paint: 'navy' });
    ui.handlers.paint();
    expect(sent).toEqual([{ type: 'paintShip', shipId: 1, paint: 'navy' }]);
    // a new ship selection drops the preview; previewing the ship's own paint sends nothing
    ui.handlers.selectShip(2);
    expect(ui.data(sim.state)!.paintShop!.preview).toBeNull();
    ui.handlers.preview('factory');
    expect(ui.paintPreview(sim.state)).toBeNull();
    ui.handlers.paint();
    expect(sent).toHaveLength(1);
  });

  it('picking another module ends the paint preview', () => {
    const { sim, ui } = setup();
    expectOk(act(sim, { type: 'homeBuild', module: 'paintShop' }));
    ui.handlers.preview('graphite');
    expect(ui.paintPreview(sim.state)).toEqual({ shipId: 1, paint: 'graphite' });
    ui.handlers.select('trophyHall');
    expect(ui.paintPreview(sim.state)).toBeNull();
    ui.handlers.select('paintShop');
    expect(ui.paintPreview(sim.state)).toBeNull();
  });

  it('a painted ship ends the preview and shows a toast with the ship and the paint', () => {
    const { sim, ui, toasts } = setup();
    expectOk(act(sim, { type: 'homeBuild', module: 'paintShop' }));
    ui.handlers.preview('sand');
    const events = act(sim, { type: 'paintShip', shipId: 1, paint: 'sand' });
    for (const e of events) ui.onEvent(e, false);
    expect(ui.data(sim.state)!.paintShop!.preview).toBeNull();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toContain(tx().home.paints.sand);
  });

  it('module and pin toasts; a toast the radio already said is not shown', () => {
    const { sim, ui, toasts } = setup();
    sim.state.career.trophies.push({ captain: 2, parts: [] });
    const built = act(sim, { type: 'homeBuild', module: 'trophyHall' });
    for (const e of built) ui.onEvent(e, e.type === 'homeModuleBuilt');
    expect(toasts).toEqual([]);
    const e = built.find((x) => x.type === 'homeModuleBuilt')!;
    expect(ui.toast(sim.state, e)!.text).toBe(tx().home.toasts.built(tx().home.modules.trophyHall.name));
    for (const x of act(sim, { type: 'trophyPin', id: 'cap:2', pinned: true })) ui.onEvent(x, false);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatch(/^Na podstavci: /);
  });

  it('focus goes to the renderer and is cleared on leave; no focus away from home', () => {
    const { ui, focus } = setup();
    ui.handlers.focus('paintShop');
    expect(ui.focus).toBe('paintShop');
    ui.handlers.preview('navy');
    ui.leave();
    ui.leave();
    expect(focus).toEqual(['paintShop', null]);
    expect(ui.focus).toBeNull();
    const away = setup(dockedAt(customStation({})));
    away.ui.handlers.focus('trophyHall');
    expect(away.focus).toEqual([]);
    expect(away.ui.data(away.sim.state)).toBeNull();
  });

  it('picking another module ends the camera focus before the re-render (no render from a UI effect)', () => {
    const { ui, focus, renders } = setup();
    ui.handlers.focus('paintShop');
    const before = renders();
    ui.handlers.select('paintShop');
    expect(ui.focus).toBe('paintShop');
    ui.handlers.select('trophyHall');
    expect(ui.focus).toBeNull();
    expect(focus).toEqual(['paintShop', null]);
    // one render for the selection (the focus ends inside the same handler)
    expect(renders()).toBe(before + 2);
  });

  it('dev hooks: build through the command, set credits, read the view model', () => {
    const { sim, ui, sent } = setup();
    const hooks = ui.devHooks();
    hooks.credits!(1234);
    expect(sim.state.credits).toBe(1234);
    hooks.build!('trophyHall');
    expect(sent).toEqual([{ type: 'homeBuild', module: 'trophyHall' }]);
    expect(hooks.data!()!.modules[1]!.reason).toBeDefined();
    expect(hooks.data!()).toBe(hooks.data!());
  });
});
