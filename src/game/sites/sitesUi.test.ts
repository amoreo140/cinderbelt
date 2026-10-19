// M4b T7: the sites game layer – terminal open exactly while berthed, handlers → actions, the berth
// approach prompt, and the toasts of the new events.
import { describe, expect, it } from 'vitest';
import { tx } from '../../i18n';
import type { GameActionInput } from '../../sim/commands';
import { ofType, run } from '../../sim/discovery/testing';
import { atClamp, findDerelict, powerRelays } from '../../sim/sites/derelictTesting';
import type { SimEvent, SimState } from '../../sim/Simulation';
import type { Simulation } from '../../sim/Simulation';
import { partName } from '../shipyardView';
import { SitesUi } from './sitesUi';

const SEED = 42;
const site = findDerelict(SEED, (d) => d.service === 'stash');

function setup(sim: Simulation): { ui: SitesUi; sent: GameActionInput[] } {
  const sent: GameActionInput[] = [];
  const ui = new SitesUi({ state: () => sim.state, send: (a) => sent.push(a), render: () => {} });
  return { ui, sent };
}

const toast = (ui: SitesUi, state: SimState, e: SimEvent) => ui.toast(state, [e]);

describe('sites UI', () => {
  it('the terminal opens with the berth, with the visit Data and log; handlers send the site actions', () => {
    const sim = atClamp(SEED, site);
    powerRelays(sim, site);
    const { ui, sent } = setup(sim);
    expect(ui.terminal(sim.state)).toBeNull();
    const events = run(sim, 1, { dock: true });
    ui.onEvents(events);
    expect(ofType(events, 'berthed')).toHaveLength(1);
    const d = ui.terminal(sim.state)!;
    expect(d.id).toBe(site.id);
    expect(d.data).not.toBeNull();
    expect(ui.berthed(sim.state)).toBe(true);
    ui.handlers.take(1);
    ui.handlers.fabricate('engine:1');
    ui.handlers.leave();
    expect(sent).toEqual([
      { type: 'derelictTake', site: site.id, item: 1 },
      { type: 'derelictTake', site: site.id, item: 0, key: 'engine:1' },
      { type: 'berthLeave' },
    ]);
    // leaving clears the visit: a later berth here shows the Data as given
    const left = run(sim, 1, { dock: true });
    ui.onEvents(left);
    expect(ofType(left, 'berthLeft')).toHaveLength(1);
    expect(ui.terminal(sim.state)).toBeNull();
  });

  it('approach prompt: a dead clamp asks for the relays, a powered one in tolerance says F', () => {
    const sim = atClamp(SEED, site);
    const { ui } = setup(sim);
    expect(ui.updateReadout(sim.state)).toBe(true);
    const dead = ui.prompt(sim.state)!;
    expect(dead).toMatchObject({ text: tx().world.map.scan.clampDark, kind: 'warn' });
    expect(dead.approach?.items).toHaveLength(3);
    powerRelays(sim, site);
    ui.updateReadout(sim.state);
    expect(ui.prompt(sim.state)).toMatchObject({ text: tx().world.derelict.berthPrompt, kind: 'ok' });
    // berthed: no prompt
    run(sim, 1, { dock: true });
    ui.updateReadout(sim.state);
    expect(ui.prompt(sim.state)).toBeNull();
  });

  it('toasts: berth refusals, relays, the defence, comets, taken parts', () => {
    const sim = atClamp(SEED, site);
    const { ui } = setup(sim);
    const st = sim.state;
    expect(toast(ui, st, { type: 'berthRejected', id: site.id, reason: 'relaysUnpowered', distance: 1, speed: 0, angle: 0 })).toMatchObject({
      text: tx().actionErrors.relaysUnpowered,
      kind: 'error',
    });
    expect(toast(ui, st, { type: 'berthRejected', id: site.id, reason: 'tooFast', distance: 1, speed: 9, angle: 0 })?.kind).toBe('error');
    expect(toast(ui, st, { type: 'relayPowered', id: 'r', site: site.id, lit: 2 })?.text).toBe(tx().world.toasts.relayPowered(2, 3));
    expect(toast(ui, st, { type: 'relayPowered', id: 'r', site: site.id, lit: 3 })?.text).toBe(tx().world.toasts.clampPowered);
    expect(toast(ui, st, { type: 'relayPowered', id: 'gr:1', site: 'gr:1', lit: 1 })).toBeNull();
    expect(toast(ui, st, { type: 'derelictWoke', id: site.id, defence: 'sentries' })).toMatchObject({ text: tx().world.toasts.woke.sentries, kind: 'error' });
    expect(toast(ui, st, { type: 'cometSighted', id: 'cm:2', pos: { x: 0, y: 0 } })?.text).toBe(tx().world.toasts.cometSighted(tx().world.comet.name(3)));
    expect(toast(ui, st, { type: 'derelictTaken', id: site.id, item: 0, what: { kind: 'part', key: 'reactor:2' } })?.text).toBe(
      tx().world.toasts.partTaken(partName('reactor:2')),
    );
    expect(toast(ui, st, { type: 'derelictTaken', id: site.id, item: 0, what: { kind: 'fragments', plan: 'rapid', count: 2 } })).toBeNull();
    expect(toast(ui, st, { type: 'eventWarning', key: 'ev:micrometeors:s@1', kind: 'micrometeors', inSeconds: 8 })?.text).toBe(
      tx().world.toasts.warning(tx().world.events.names.micrometeors, tx().world.hud.in(tx().world.hud.seconds(8))),
    );
    // the refusal wins over a relay in the same step
    expect(
      ui.toast(st, [
        { type: 'relayPowered', id: 'r', site: site.id, lit: 1 },
        { type: 'berthRejected', id: site.id, reason: 'relaysUnpowered', distance: 1, speed: 0, angle: 0 },
      ])?.text,
    ).toBe(tx().actionErrors.relaysUnpowered);
  });
});
