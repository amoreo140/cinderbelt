// Templates view models and the fleet UI handlers (M4a T4).
import { describe, expect, it } from 'vitest';
import { TEMPLATE_SLOTS } from '../../data/fleet';
import { tx } from '../../i18n';
import { act, customStation } from '../../sim/station/testHarness';
import { richSim } from '../../sim/fleet/testing';
import { hullPoints } from '../../sim/ship/budget';
import { createGrid } from '../../sim/ship/grid';
import { createStarterShip } from '../../sim/ship/presets';
import type { GameActionInput } from '../../sim/commands';
import type { Simulation } from '../../sim/Simulation';
import { encodeTemplate } from '../../sim/templates/codec';
import { normalizeTemplate } from '../../sim/templates/normalize';
import { homeStation } from '../../sim/world/stations';
import { FleetUi, type FleetUiHost } from './fleetUi';
import { hangarView } from './hangarView';
import { deathTemplate, savableParts, templatesView } from './templatesView';

const noYard = () => customStation({ services: { ...homeStation().services, shipyard: false } });
const STARTER = normalizeTemplate(createStarterShip())!;
const err = () => tx().actionErrors;

function withTemplates(n = 1): Simulation {
  const sim = richSim();
  sim.state.discovery.archive.add('templates');
  for (let i = 0; i < n; i++) act(sim, { type: 'templateSave', name: `T${i}`, parts: STARTER });
  return sim;
}

describe('templatesView', () => {
  it('locked before the Archive node: only the lock reason', () => {
    const v = templatesView(richSim().state);
    expect(v).toEqual({ cap: 0, items: [], lockReason: tx().discovery.archive.lockedPart(tx().discovery.archive.nodes.templates) });
  });

  it('rows: name, parts, hull points, cockpit tier, silhouette; apply only docked at a shipyard', () => {
    const sim = withTemplates();
    const v = templatesView(sim.state);
    expect(v.cap).toBe(TEMPLATE_SLOTS.base);
    expect(v.lockReason).toBeUndefined();
    expect(v.saveReason).toBeUndefined();
    expect(v.items[0]).toMatchObject({ index: 0, name: 'T0', parts: STARTER.length, hullPoints: hullPoints(createStarterShip()), cockpitTier: 1, locked: 0 });
    expect(v.items[0]!.applyReason).toBeUndefined();
    expect(v.items[0]!.silhouette!.cells.length).toBeGreaterThanOrEqual(STARTER.length);
    act(sim, { type: 'undock' });
    expect(templatesView(sim.state).items[0]!.applyReason).toBe(err().notDocked);
    expect(templatesView(sim.state, noYard()).items[0]!.applyReason).toBe(err().serviceUnavailable);
  });

  it('counts parts the player cannot get now (Archive locks)', () => {
    const sim = withTemplates(0);
    sim.state.templates.push({ name: 'Heavy', parts: [['cockpit:1', 0, 0, 0], ['heavyLaser:1', 1, 0, 0]] });
    expect(templatesView(sim.state).items[0]!.locked).toBe(1);
  });

  it('full slots: save says why', () => {
    const sim = withTemplates(TEMPLATE_SLOTS.base);
    expect(templatesView(sim.state).saveReason).toBe(err().templateCap);
  });
});

describe('savableParts', () => {
  it('a valid ship gives its normal form; a ship with loose parts or no cockpit gives null', () => {
    expect(savableParts(createStarterShip())).toEqual(STARTER);
    expect(savableParts(createGrid([['cockpit', 0, 0], ['armor', 3, 3]]))).toBeNull();
    expect(savableParts(createGrid([['armor', 0, 0]]))).toBeNull();
  });
});

describe('deathTemplate', () => {
  it('hidden without a template; respawn shipyard first, else the evacuation, else a reason', () => {
    const sim = richSim();
    const yard = homeStation();
    const bare = noYard();
    expect(deathTemplate(sim.state, yard, null)).toEqual({ view: null, evacuate: false });
    sim.state.templates.push({ name: 'A', parts: STARTER });
    expect(deathTemplate(sim.state, yard, null)).toEqual({ view: {}, evacuate: false });
    expect(deathTemplate(sim.state, bare, yard)).toEqual({ view: {}, evacuate: true });
    expect(deathTemplate(sim.state, bare, null)).toEqual({ view: { reason: err().serviceUnavailable }, evacuate: false });
  });
});

describe('FleetUi handlers', () => {
  function setup(sim: Simulation) {
    const sent: GameActionInput[] = [];
    const notes: string[] = [];
    const host: FleetUiHost = {
      state: () => sim.state,
      send: (a) => (sent.push(a), sent.length),
      render: () => {},
      click: () => {},
      notify: (text) => void notes.push(text),
      editor: () => null,
      openShipyard: () => null,
    };
    return { ui: new FleetUi(host), sent, notes };
  }

  it('hangar buttons dispatch the hangar actions; the modal opens only docked', () => {
    const sim = richSim();
    const { ui, sent } = setup(sim);
    ui.hangar.open();
    expect(ui.hangarOpen).toBe(true);
    ui.hangar.buySlot();
    ui.hangar.switch(2);
    ui.hangar.newShip('cockpit:1');
    ui.hangar.newShip('cockpit:2', 'buy');
    ui.hangar.rename(1, 'Moja');
    ui.hangar.rename(1, null);
    ui.hangar.dismantle(2);
    expect(sent).toEqual([
      { type: 'hangarBuySlot' },
      { type: 'hangarSwitch', shipId: 2 },
      { type: 'hangarNewShip', cockpit: 'cockpit:1' },
      { type: 'hangarNewShip', cockpit: 'cockpit:2', acquire: 'buy' },
      { type: 'hangarRename', shipId: 1, name: 'Moja' },
      { type: 'hangarRename', shipId: 1, name: null },
      { type: 'hangarDismantle', shipId: 2 },
    ]);
    ui.templates.open();
    expect([ui.hangarOpen, ui.templatesOpen]).toEqual([false, true]);
    ui.onEvent({ type: 'undocked' } as never);
    expect(ui.modalOpen).toBe(false);
    act(sim, { type: 'undock' });
    ui.hangar.open();
    expect(ui.hangarOpen).toBe(false);
  });

  it('templates: save the ship, export, import (and its errors), rename, delete', () => {
    const sim = withTemplates();
    const { ui, sent, notes } = setup(sim);
    ui.templates.save('Nová', 'ship');
    expect(sent.at(-1)).toEqual({ type: 'templateSave', name: 'Nová', parts: STARTER });
    // no editor: the draft source cannot be saved
    ui.templates.save('Návrh', 'draft');
    expect(notes).toEqual([err().invalidTemplate]);
    const code = ui.templates.exportCode(0);
    expect(code).toBe(encodeTemplate(sim.state.templates[0]!));
    expect(ui.templates.exportCode(9)).toBe('');
    expect(ui.templates.importCode(`  ${code} `)).toBeNull();
    expect(sent.at(-1)).toEqual({ type: 'templateSave', name: 'T0', parts: STARTER });
    expect(ui.templates.importCode('XX.abc.0000')).toBe('prefix');
    ui.templates.rename(0, 'B');
    ui.templates.delete(0);
    expect(sent.slice(-2)).toEqual([
      { type: 'templateRename', index: 0, name: 'B' },
      { type: 'templateDelete', index: 0 },
    ]);
  });

  it('templatesData only while open; the hub hangar data only on the overview or with the modal', () => {
    const sim = withTemplates();
    const { ui } = setup(sim);
    expect(ui.templatesData(sim.state)).toBeNull();
    ui.templates.open();
    expect(ui.templatesData(sim.state)).toEqual({ view: templatesView(sim.state), draft: false });
    expect(ui.hubExtras(sim.state, homeStation(), false, [1])).toEqual({ hangar: null, hangarOpen: false });
    const hangar = ui.hubExtras(sim.state, homeStation(), true, [1]).hangar;
    expect(hangar?.newShip.cockpits).toEqual([]);
    // memoised on the key (Game.hubViewKey) and the modal state
    expect(ui.hubExtras(sim.state, homeStation(), true, [1]).hangar).toBe(hangar);
    expect(ui.hubExtras(sim.state, homeStation(), true, [2]).hangar).not.toBe(hangar);
    ui.hangar.open();
    expect(ui.hubExtras(sim.state, homeStation(), false, [2])).toMatchObject({ hangar: hangarView(sim.state, homeStation(), true), hangarOpen: true });
    expect(ui.hubExtras(sim.state, noYard(), true, [2])).toEqual({ hangar: null, hangarOpen: false });
  });
});
