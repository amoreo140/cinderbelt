import { describe, expect, it } from 'vitest';
import type { PartKey } from '../../data/parts';
import { RESOURCE_IDS } from '../../data/resources';
import type { GameActionInput } from '../commands';
import { rotate, sub } from '../math/vec2';
import type { Simulation } from '../Simulation';
import { createGrid } from '../ship/grid';
import { stationStorage } from '../station/actions';
import { act, customStation, dockedAt, dockedSim, expectFailure, expectOk, resultOf } from '../station/testHarness';
import { HOME_STATION_ID, homeStation } from '../world/stations';
import { draftBaseHash, shipyardHash } from './commit';
import { evaluateDesign, shipyardContext } from './design';
import { applyStroke, createDraft, draftOps, rebaseDraft, setAcquire, type ShipyardDraft } from './draft';
import type { EditorOp } from './editor';

const storage = (sim: Simulation) => stationStorage(sim.state, HOME_STATION_ID);

/** A design in the editor over the current ship docked at home. */
function draftFor(sim: Simulation, ops: EditorOp[]): ShipyardDraft {
  const { player } = sim.state;
  const d = createDraft(HOME_STATION_ID, player.grid, player.hp, storage(sim).parts);
  const r = applyStroke(d, ops);
  expect(r.errors).toEqual([]);
  return r.draft;
}

const commitOf = (d: ShipyardDraft): GameActionInput => ({
  type: 'shipyardCommit',
  baseHash: draftBaseHash(d),
  ops: draftOps(d),
  acquire: d.acquire,
});

describe('shipyardHash', () => {
  it('changes with the grid, the HP and the part storage', () => {
    const g = createGrid([['cockpit', 0, 0]]);
    const h = shipyardHash(g, new Map(), { 'armor:1': 2 });
    expect(shipyardHash(createGrid([['cockpit', 0, 0]]), new Map(), { 'armor:1': 2 })).toBe(h);
    expect(shipyardHash(createGrid([['cockpit', 0, 1]]), new Map(), { 'armor:1': 2 })).not.toBe(h);
    expect(shipyardHash(g, new Map([[1, 5]]), { 'armor:1': 2 })).not.toBe(h);
    expect(shipyardHash(g, new Map(), { 'armor:1': 1 })).not.toBe(h);
    expect(shipyardHash(g, new Map(), { 'armor:1': 2, 'engine:1': 0 })).toBe(h);
  });
});

describe('shipyardCommit', () => {
  it('charges a newly installed shield in the dock like the battery (docked state stays canonical)', () => {
    const sim = dockedSim();
    storage(sim).parts['shield:1'] = 1;
    expectOk(act(sim, commitOf(draftFor(sim, [{ op: 'place', key: 'shield:1', x: 3, y: 0, rot: 0 }]))));
    const p = sim.state.player;
    expect(p.props.shield.capacity).toBeGreaterThan(0);
    expect(p.shield).toBe(p.props.shield.capacity);
    expect(p.shieldDelay).toBe(0);
  });

  it('installs a part from the storage for 10 credits', () => {
    const sim = dockedSim();
    const version = sim.state.player.gridVersion;
    const events = act(sim, commitOf(draftFor(sim, [{ op: 'place', key: 'armor:1', x: 3, y: 0, rot: 0 }])));
    expectOk(events);
    expect(events).toContainEqual({ type: 'shipRebuilt', cost: 10, cargoToStorage: 0, fuelLost: 0 });
    expect(events).toContainEqual({ type: 'creditsChanged', delta: -10, reason: 'shipyard' });
    const p = sim.state.player;
    expect(sim.state.credits).toBe(240);
    expect(storage(sim).parts).toEqual({ 'armor:1': 1, 'cannon:1': 1 });
    expect(p.grid.parts.at(-1)).toEqual({ id: 15, partId: 'armor', tier: 1, x: 3, y: 0, rot: 0 });
    expect(p.grid.nextId).toBe(16);
    expect(p.gridVersion).toBe(version + 1);
    expect(p.props.mass).toBeCloseTo(25 + 2);
  });

  it('gives the same result as the preview (craft, buy, remove, move)', () => {
    const sim = dockedSim();
    sim.state.credits = 5000;
    storage(sim).resources.iron = 20;
    sim.state.player.cargo.iron = 25;
    sim.state.player.cargo.copper = 30;
    let d = draftFor(sim, [
      { op: 'remove', id: 13 },
      { op: 'move', id: 14, x: -1, y: 2, rot: 3 },
      { op: 'place', key: 'cargo:1', x: 0, y: 2, rot: 0 },
      { op: 'place', key: 'radar:1', x: 3, y: 1, rot: 0 },
      { op: 'place', key: 'armor:1', x: 2, y: 2, rot: 0 },
    ]);
    d = setAcquire(d, 'radar:1', 'buy');
    const report = evaluateDesign(d, shipyardContext(sim.state, homeStation()));
    expect(report.errors).toEqual([]);
    expect(report.cost.craft).toEqual({ 'cargo:1': 1 });
    expect(report.cost.buy).toEqual({ 'radar:1': 1 });
    expect(report.cost.fromStorage).toEqual({ 'armor:1': 1 });
    expect(report.cost.toStorage).toEqual({ 'engine:1': 1 });

    const before = structuredClone({ credits: sim.state.credits, storage: storage(sim), cargo: sim.state.player.cargo });
    const events = act(sim, commitOf(d));
    expectOk(events);
    expect(sim.state.credits).toBe(before.credits - report.cost.credits);
    expect(sim.state.player.grid).toEqual(d.grid);
    expect(storage(sim).parts).toEqual({ 'armor:1': 1, 'cannon:1': 1, 'engine:1': 1 });
    for (const r of RESOURCE_IDS) {
      const used = report.cost.resources[r] ?? 0;
      const total = before.storage.resources[r] + before.cargo[r] - used;
      expect(storage(sim).resources[r] + sim.state.player.cargo[r]).toBeCloseTo(total);
    }
    // first from storage: 20 Fe from storage, 10 from the cargo
    expect(storage(sim).resources.iron).toBe(0);
    expect(sim.state.player.cargo.iron).toBe(15);
    expect(sim.state.player.props.cargoCapacity).toBe(190);
  });

  it('keeps the HP of moved parts and repairs removed ones', () => {
    const sim = dockedSim();
    const p = sim.state.player;
    p.hp.set(9, 5);
    p.hp.set(11, 10);
    storage(sim).resources.iron = 10;
    const d = draftFor(sim, [{ op: 'move', id: 9, x: -2, y: 0, rot: 0 }, { op: 'remove', id: 11 }]);
    const events = act(sim, commitOf(d));
    expectOk(events);
    expect([...p.hp]).toEqual([[9, 5]]);
    // move 1 × 10 cr + engine repair (40% HP) 72 cr + 4 Fe
    expect(sim.state.credits).toBe(250 - 10 - 72);
    expect(storage(sim).resources.iron).toBe(6);
    expect(storage(sim).parts['engine:1']).toBe(1);
  });

  it('moves cargo that does not fit to the storage and clips the fuel', () => {
    const sim = dockedSim();
    const p = sim.state.player;
    p.cargo.iron = 60;
    p.cargo.copper = 36;
    p.fuel = 110;
    const events = act(sim, commitOf(draftFor(sim, [{ op: 'remove', id: 5 }, { op: 'remove', id: 7 }, { op: 'remove', id: 14 }])));
    expect(events).toContainEqual({ type: 'shipRebuilt', cost: 0, cargoToStorage: 26, fuelLost: 90 });
    expect(p.cargo).toMatchObject({ iron: 34, copper: 36 });
    expect(storage(sim).resources.iron).toBe(26);
    expect(p.fuel).toBe(20);
    expect(p.energy).toBe(p.props.batteryCapacity);
  });

  it('keeps the grid origin in place when the center of mass moves', () => {
    const sim = dockedSim();
    const p = sim.state.player;
    const station = homeStation();
    const oldBody = p.body;
    const oldCom = p.props.centerOfMass;
    // a part on the port side shifts the centre of mass sideways
    act(sim, commitOf(draftFor(sim, [{ op: 'place', key: 'armor:1', x: 1, y: 2, rot: 0 }])));
    const newCom = p.props.centerOfMass;
    expect(newCom.y).toBeGreaterThan(oldCom.y);
    const dir = { x: Math.cos(station.portAngle), y: Math.sin(station.portAngle) };
    const shift = rotate(sub(newCom, oldCom), oldBody.angle);
    const lateral = (v: { x: number; y: number }) => -v.x * dir.y + v.y * dir.x;
    const radial = (v: { x: number; y: number }) => v.x * dir.x + v.y * dir.y;
    // the sideways shift matches the shift of the centre of mass (the grid origin stayed in place)…
    expect(lateral(sub(p.body.pos, oldBody.pos))).toBeCloseTo(lateral(shift));
    // …and the distance from the station matches the dock pose with the new radius
    expect(radial(sub(p.body.pos, station.pos))).toBeCloseTo(station.radius + p.props.boundingRadius + 1);
    expect(p.body.angle).toBe(oldBody.angle);
    expect(p.prevBody).toEqual(p.body);
  });

  it('rejects a stale draft without changes', () => {
    const sim = dockedSim();
    const d = draftFor(sim, [{ op: 'place', key: 'armor:1', x: 3, y: 0, rot: 0 }]);
    act(sim, { type: 'sellPart', key: 'armor:1', count: 1 });
    expectFailure(sim, commitOf(d), 'staleDraft');
  });

  it('a rebased stale draft can be committed', () => {
    const sim = dockedSim();
    const d = draftFor(sim, [{ op: 'place', key: 'armor:1', x: 3, y: 0, rot: 0 }]);
    act(sim, { type: 'sellPart', key: 'armor:1', count: 1 });
    const { player } = sim.state;
    const { draft, dropped } = rebaseDraft(d, player.grid, player.hp, storage(sim).parts);
    expect(dropped).toBe(0);
    expectOk(act(sim, commitOf(draft)));
    expect(storage(sim).parts).toEqual({ 'cannon:1': 1 });
    expect(player.grid.parts).toHaveLength(15);
  });

  it('rejects invalid designs with the first error as detail', () => {
    const sim = dockedSim();
    const events = expectFailure(sim, commitOf(draftFor(sim, [{ op: 'remove', id: 1 }])), 'invalidDesign');
    expect(resultOf(events)).toMatchObject({ detail: 'noCockpit' });
    const bad = expectFailure(
      sim,
      { type: 'shipyardCommit', baseHash: draftBaseHash(draftFor(sim, [])), ops: [{ op: 'remove', id: 99 }], acquire: {} },
      'invalidDesign',
    );
    expect(resultOf(bad)).toMatchObject({ detail: 'unknownPart' });
  });

  it('never applies a ship with loose parts, even though the editor lets them be placed (free placement)', () => {
    const sim = dockedSim();
    sim.state.credits = 1000;
    storage(sim).parts['armor:1'] = 1;
    const events = expectFailure(sim, commitOf(draftFor(sim, [{ op: 'place', key: 'armor:1', x: 5, y: 5, rot: 0 }])), 'invalidDesign');
    expect(resultOf(events)).toMatchObject({ detail: 'disconnected' });
    // a part dragged out loose and connected again in a later stroke is a valid design
    const ok = draftFor(sim, [{ op: 'place', key: 'armor:1', x: 5, y: 5, rot: 0 }, { op: 'move', id: 15, x: 3, y: 0, rot: 0 }]);
    expectOk(act(sim, commitOf(ok)));
    expect(sim.state.player.grid.parts.find((p) => p.id === 15)).toMatchObject({ x: 3, y: 0 });
  });

  it('commits a group move as one op; moved parts keep their HP and pay the mount fee once each', () => {
    const sim = dockedSim();
    sim.state.credits = 1000;
    sim.state.player.hp.set(9, 20);
    // the two side engines (13, 14) shifted one cell forward together, still attached
    const d = draftFor(sim, [{ op: 'moveGroup', moves: [{ id: 13, x: 1, y: -2, rot: 1 }, { id: 14, x: 1, y: 2, rot: 3 }, { id: 9, x: -2, y: 0, rot: 0 }] }]);
    expect(draftOps(d)).toHaveLength(1);
    const before = sim.state.credits;
    expectOk(act(sim, commitOf(d)));
    expect(sim.state.credits).toBe(before - 30);
    expect(sim.state.player.hp.get(9)).toBe(20);
    expect(sim.state.player.grid.parts.find((p) => p.id === 9)).toMatchObject({ x: -2, y: 0 });
    expect(sim.state.player.grid.parts.find((p) => p.id === 13)).toMatchObject({ x: 1, y: -2, rot: 1 });
  });

  it('maps economic errors to action errors', () => {
    const sim = dockedSim();
    const place = (key: PartKey): EditorOp => ({ op: 'place', key, x: -2, y: 0, rot: 0 });
    expectFailure(sim, commitOf(draftFor(sim, [place('engine:1')])), 'notEnoughCredits');
    expectFailure(sim, commitOf(draftFor(sim, [place('engine:2')])), 'notAvailableHere');
    sim.state.credits = 10_000;
    expectFailure(sim, commitOf(setAcquire(draftFor(sim, [place('engine:1')]), 'engine:1', 'craft')), 'notEnoughResources');
  });

  it('scraps a damaged part it cannot repair into the station storage resources (M12, M13)', () => {
    // a station with a shipyard but without repairs: a damaged engine is not repaired, it is scrapped
    const station = customStation({ services: { ...homeStation().services, repair: false } });
    const sim = dockedAt(station);
    sim.state.player.hp.set(11, 10);
    const d = createDraft(station.id, sim.state.player.grid, sim.state.player.hp, {});
    const r = applyStroke(d, [{ op: 'remove', id: 11 }]);
    expectOk(act(sim, commitOf(r.draft)));
    const st = stationStorage(sim.state, station.id);
    expect(st.parts['engine:1'] ?? 0).toBe(0);
    expect(st.resources.iron).toBe(5);
    expect(st.resources.copper).toBe(3);
    expect(sim.state.player.hp.has(11)).toBe(false);
  });

  it('needs a shipyard', () => {
    const outpost = customStation({ kind: 'outpost', services: { ...homeStation().services, shipyard: false } });
    const sim = dockedAt(outpost);
    const d = createDraft(outpost.id, sim.state.player.grid, sim.state.player.hp, {});
    expectFailure(sim, commitOf(d), 'serviceUnavailable');
  });

  it('works only when docked', () => {
    const sim = dockedSim();
    const d = draftFor(sim, []);
    act(sim, { type: 'undock' });
    expectFailure(sim, commitOf(d), 'notDocked');
  });
});
