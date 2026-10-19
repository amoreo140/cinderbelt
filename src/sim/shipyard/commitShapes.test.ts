// SL2 E2 S6b: shaped armour through the shipyard commit and its hash.
import { describe, expect, it } from 'vitest';
import type { GameActionInput } from '../commands';
import type { Simulation } from '../Simulation';
import { createGrid } from '../ship/grid';
import { currentHp } from '../ship/hp';
import { createStarterShip } from '../ship/presets';
import { shaped } from '../ship/testing';
import { stationStorage } from '../station/actions';
import { act, dockedSim, expectFailure, expectOk, resultOf } from '../station/testHarness';
import { HOME_STATION_ID } from '../world/stations';
import { shipyardHash } from './commit';
import type { EditorOp } from './editor';

const storage = (sim: Simulation) => stationStorage(sim.state, HOME_STATION_ID);
const commit = (sim: Simulation, ops: EditorOp[]): GameActionInput => ({
  type: 'shipyardCommit',
  baseHash: shipyardHash(sim.state.player.grid, sim.state.player.hp, storage(sim).parts),
  ops,
  acquire: {},
});
const partById = (sim: Simulation, id: number) => sim.state.player.grid.parts.find((p) => p.id === id)!;

describe('shipyardHash with shapes', () => {
  it('hashes of unshaped grids are unchanged (values recorded before SL2 E2 S6b)', () => {
    const starter = createStarterShip();
    const loan = { ...starter, parts: starter.parts.map((p) => (p.id === 3 ? { ...p, loan: true as const } : p)) };
    expect(shipyardHash(starter, new Map([[2, 7], [5, 10]]), { 'armor:1': 2, 'engine:2': 1 })).toBe('520ac1d3');
    expect(shipyardHash(loan, new Map(), {})).toBe('1b787095');
    expect(shipyardHash(createGrid([['cockpit', 0, 0], ['armor', 1, 0, 1, 2]]), new Map(), { 'armor:1': 2 })).toBe('369d7a34');
  });

  it('a shape changes the hash, and so does another shape', () => {
    const grid = createGrid([['cockpit', 0, 0], ['armor', 1, 0, 1, 2]]);
    const plain = shipyardHash(grid, new Map(), {});
    const wedge = shipyardHash(shaped(grid, 2, 'wedge'), new Map(), {});
    expect(wedge).not.toBe(plain);
    expect(shipyardHash(shaped(grid, 2, 'chamfer'), new Map(), {})).not.toBe(wedge);
    expect(shipyardHash(shaped(shaped(grid, 2, 'wedge'), 2, null), new Map(), {})).toBe(plain);
  });
});

describe('shipyardCommit with shapes', () => {
  it('installs a wedge from a plain plate in storage and keeps the shape on the ship and the blueprint', () => {
    const sim = dockedSim();
    const before = storage(sim).parts['armor:1'] ?? 0;
    expectOk(act(sim, commit(sim, [{ op: 'place', key: 'armor:1', x: 3, y: 1, rot: 0, shape: 'wedge' }])));
    const p = sim.state.player;
    expect(p.grid.parts.at(-1)).toEqual({ id: 15, partId: 'armor', tier: 1, x: 3, y: 1, rot: 0, shape: 'wedge' });
    expect(p.blueprint.parts.at(-1)?.shape).toBe('wedge');
    expect(storage(sim).parts['armor:1'] ?? 0).toBe(before - 1);
  });

  it('a reshaped full-HP part starts at the new shape’s full HP (an explicit HP entry does not carry over)', () => {
    const sim = dockedSim();
    expectOk(act(sim, commit(sim, [{ op: 'place', key: 'armor:1', x: 3, y: 1, rot: 0, shape: 'wedge' }])));
    sim.state.player.hp.set(15, 20); // the wedge's full HP, written explicitly
    const credits = sim.state.credits;
    expectOk(act(sim, commit(sim, [{ op: 'reshape', id: 15, shape: null }])));
    expect(partById(sim, 15)).not.toHaveProperty('shape');
    expect(currentHp(sim.state.player.hp, partById(sim, 15))).toBe(40);
    expect(sim.state.credits).toBe(credits - 10);
  });

  it('a damaged wing mirrored to the other wing keeps its HP', () => {
    const sim = dockedSim();
    expectOk(act(sim, commit(sim, [{ op: 'place', key: 'armor:1', x: 3, y: 1, rot: 0, shape: 'wingL' }])));
    sim.state.player.hp.set(15, 25);
    expectOk(act(sim, commit(sim, [{ op: 'reshape', id: 15, shape: 'wingR' }])));
    expect(partById(sim, 15).shape).toBe('wingR');
    expect(currentHp(sim.state.player.hp, partById(sim, 15))).toBe(25);
  });

  it('refuses a crafted reshape of a damaged part (reshapeDamaged) and changes nothing', () => {
    const sim = dockedSim();
    expectOk(act(sim, commit(sim, [{ op: 'place', key: 'armor:1', x: 3, y: 1, rot: 0 }])));
    sim.state.player.hp.set(15, 30);
    const events = expectFailure(sim, commit(sim, [{ op: 'reshape', id: 15, shape: 'wedge' }]), 'invalidDesign');
    expect(resultOf(events)).toMatchObject({ detail: 'reshapeDamaged' });
  });
});
