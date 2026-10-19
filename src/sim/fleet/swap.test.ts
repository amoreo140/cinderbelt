// What a switch does to the state (M4a plan §2): round trips, conservation, Guild loan parts,
// the dissolved loan hull, the cold start, respawn and determinism.
import { describe, expect, it } from 'vitest';
import { partBuyPrice } from '../../data/economy';
import { IDLE_COMMAND } from '../commands';
import { createStarterShip } from '../ship/presets';
import { loanStarterShip } from '../ship/loan';
import { computeProperties } from '../ship/properties';
import type { ShipGrid } from '../ship/types';
import { dockPose } from '../station/dock';
import { act, resultOf } from '../station/testHarness';
import type { Simulation } from '../Simulation';
import { HOME_STATION_ID, homeStation } from '../world/stations';
import { cockpitGrid } from './newShip';
import { leaveNote } from './swap';
import { fleetSnapshot, holdings, parkForNewShip, richSim, stock } from './testing';

/** Puts `grid` on the active ship (as a shipyard commit would). */
function setGrid(sim: Simulation, grid: ShipGrid): void {
  const { player } = sim.state;
  player.grid = grid;
  player.blueprint = grid;
  player.props = computeProperties(grid);
  player.fuel = Math.min(player.fuel, player.props.fuelCapacity);
}

/** The starter ship with the parts at the given cells lent by the Guild. */
function starterWithLoans(...cells: [number, number][]): ShipGrid {
  const grid = createStarterShip();
  return { nextId: grid.nextId, parts: grid.parts.map((p) => (cells.some(([x, y]) => p.x === x && p.y === y) ? { ...p, loan: true as const } : p)) };
}

describe('switch round trip', () => {
  it('park → switch back = the original ship (grid, blueprint, HP, fuel, cargo, record)', () => {
    const sim = richSim();
    const { player, fleet } = sim.state;
    player.hp.set(2, 7).set(5, 11);
    player.cargo.iron = 12.5;
    player.cargo.ice = 3;
    player.fuel = player.props.fuelCapacity * 0.4;
    fleet.active.name = 'Lyra';
    fleet.active.log.distance = 321;
    const original = structuredClone({ grid: player.grid, blueprint: player.blueprint, hp: [...player.hp], fuel: player.fuel, cargo: player.cargo, record: fleet.active });
    parkForNewShip(sim);
    expect(resultOf(act(sim, { type: 'hangarSwitch', shipId: 1 }))).toMatchObject({ ok: true });
    const p = sim.state.player;
    expect({ grid: p.grid, blueprint: p.blueprint, hp: [...p.hp], fuel: p.fuel, cargo: p.cargo, record: sim.state.fleet.active }).toEqual(original);
  });

  it('switch there and back = the same state (stored ships, storages, credits, records)', () => {
    const sim = richSim();
    sim.state.player.hp.set(3, 4);
    sim.state.player.cargo.copper = 6;
    parkForNewShip(sim);
    sim.step(IDLE_COMMAND);
    const before = fleetSnapshot(sim.state);
    const version = sim.state.player.gridVersion;
    act(sim, { type: 'hangarSwitch', shipId: 1 });
    act(sim, { type: 'hangarSwitch', shipId: 2 });
    expect(fleetSnapshot(sim.state)).toEqual(before);
    expect(sim.state.player.gridVersion).toBe(version + 2);
  });

  it('the new active ship starts cold at the dock pose; respawn = here with its grid', () => {
    const sim = richSim();
    parkForNewShip(sim);
    const { player } = sim.state;
    player.heat.set(1, { heat: 1, cooling: 0 });
    player.cooldowns.set(1, 0.5);
    const version = player.gridVersion;
    act(sim, { type: 'hangarSwitch', shipId: 1 });
    expect(player.gridVersion).toBe(version + 1);
    expect(player.props).toEqual(computeProperties(createStarterShip()));
    expect(player.energy).toBe(player.props.batteryCapacity);
    expect(player.shield).toBe(player.props.shield.capacity);
    expect(player.heat.size).toBe(0);
    expect(player.cooldowns.size).toBe(0);
    expect(player.tractor).toBeNull();
    expect(player.dampers).toBe(true);
    expect(player.dock).toEqual({ mode: 'docked', stationId: HOME_STATION_ID });
    expect(player.body).toEqual(dockPose(homeStation(), player.props.boundingRadius));
    expect(sim.state.respawn).toEqual({ stationId: HOME_STATION_ID, grid: player.grid });
    expect(sim.state.respawn.grid).toBe(player.grid);
  });

  it('contract quotes keep the best ship ever: a cockpit-only ship does not lower it', () => {
    const sim = richSim();
    const best = [...sim.state.stats.bestUnitsPerHour];
    expect(best[0]).toBeGreaterThan(0);
    parkForNewShip(sim);
    sim.step(IDLE_COMMAND);
    expect(sim.state.stats.bestUnitsPerHour).toEqual(best);
  });
});

describe('conservation (nothing duplicated, nothing lost)', () => {
  it('switch, new ship, park and dismantle move value but never create it', () => {
    const sim = richSim();
    sim.state.discovery.archive.add('hangarPlus');
    sim.state.player.cargo.iron = 9;
    stock(sim, { 'cockpit:1': 1, 'engine:1': 2 });
    act(sim, { type: 'hangarBuySlot' });
    act(sim, { type: 'hangarBuySlot' });
    let expected = holdings(sim.state);
    const step = (a: Parameters<typeof act>[1], change: (h: ReturnType<typeof holdings>) => void = () => {}) => {
      expect(resultOf(act(sim, a)), a.type).toMatchObject({ ok: true });
      change(expected);
      expect(holdings(sim.state), a.type).toEqual(expected);
      expected = holdings(sim.state);
    };
    step({ type: 'hangarNewShip', cockpit: 'cockpit:1' });
    step({ type: 'hangarSwitch', shipId: 1 });
    step({ type: 'hangarSwitch', shipId: 2 });
    step({ type: 'hangarSwitch', shipId: 1 });
    const price = partBuyPrice('cockpit:1', 1)!;
    step({ type: 'hangarNewShip', cockpit: 'cockpit:1', acquire: 'buy' }, (h) => {
      h.parts['cockpit:1'] = (h.parts['cockpit:1'] ?? 0) + 1;
      h.credits -= price;
    });
    step({ type: 'hangarSwitch', shipId: 2 });
    const fuel = sim.state.fleet.stored.find((s) => s.record.id === 1)!.fuel;
    step({ type: 'hangarDismantle', shipId: 1 }, (h) => {
      h.fuel -= fuel;
    });
    step({ type: 'hangarDismantle', shipId: 3 });
    expect(sim.state.fleet.stored).toEqual([]);
  });

  it('repeating switches never grows cargo, fuel or parts', () => {
    const sim = richSim();
    sim.state.player.cargo.titanium = 2;
    parkForNewShip(sim);
    const before = holdings(sim.state);
    for (let i = 0; i < 10; i++) act(sim, { type: 'hangarSwitch', shipId: i % 2 === 0 ? 1 : 2 });
    expect(holdings(sim.state)).toEqual(before);
  });
});

describe('Guild loan parts never enter the hangar', () => {
  it('switching away returns the loan parts; the owned rest is parked', () => {
    const sim = richSim();
    // the forward engine at (-1, 1) is a Guild loan
    setGrid(sim, starterWithLoans([-1, 1]));
    stock(sim, { 'cockpit:1': 1 });
    const before = holdings(sim.state);
    act(sim, { type: 'hangarBuySlot' });
    expect(leaveNote(sim.state, homeStation())).toBe('returned');
    const events = act(sim, { type: 'hangarNewShip', cockpit: 'cockpit:1' });
    expect(events).toContainEqual({ type: 'shipCreated', stationId: HOME_STATION_ID, shipId: 2, parked: 1, loanReturned: { 'engine:1': 1 } });
    const parked = sim.state.fleet.stored[0]!;
    expect(parked.grid.parts.some((p) => p.loan)).toBe(false);
    expect(parked.blueprint.parts.some((p) => p.loan)).toBe(false);
    expect(parked.grid.parts).toHaveLength(createStarterShip().parts.length - 1);
    expect(holdings(sim.state)).toEqual({ ...before, credits: before.credits - 5000 });
  });

  it('owned parts held on only by a loan part go to storage', () => {
    const sim = richSim();
    // the hold at (0, 1) is lent – the engine at (0, 2) hangs on it alone
    setGrid(sim, starterWithLoans([0, 1]));
    parkForNewShip(sim);
    const parked = sim.state.fleet.stored[0]!;
    expect(parked.grid.parts.some((p) => p.x === 0 && p.y === 2)).toBe(false);
    expect(parked.grid.parts).toHaveLength(createStarterShip().parts.length - 2);
    expect(sim.state.stations.get(HOME_STATION_ID)!.parts['engine:1']).toBe(1);
  });

  it('a hull without a cockpit of its own (Hard respawn) is dissolved – no slot needed', () => {
    const sim = richSim();
    // the loan hull with one owned part (a radar the player mounted)
    const hull = loanStarterShip();
    const radar = hull.parts.find((p) => p.partId === 'radar')!;
    const { loan, ...ownedRadar } = radar;
    expect(loan).toBe(true);
    setGrid(sim, { nextId: hull.nextId, parts: hull.parts.map((p) => (p === radar ? ownedRadar : p)) });
    sim.state.player.cargo.iron = 5;
    stock(sim, { 'cockpit:1': 1 });
    expect(leaveNote(sim.state, homeStation())).toBe('dissolved');
    const before = holdings(sim.state);
    const events = act(sim, { type: 'hangarNewShip', cockpit: 'cockpit:1' });
    expect(resultOf(events)).toMatchObject({ ok: true });
    const dissolved = events.find((e) => e.type === 'shipDissolved');
    expect(dissolved).toMatchObject({ stationId: HOME_STATION_ID, shipId: 1, parts: { 'radar:1': 1 }, cargo: { iron: 5 } });
    expect(events).toContainEqual(expect.objectContaining({ type: 'shipCreated', shipId: 2, parked: null }));
    expect(events.findIndex((e) => e.type === 'shipDissolved')).toBeLessThan(events.findIndex((e) => e.type === 'shipCreated'));
    expect(sim.state.fleet.stored).toEqual([]);
    expect(sim.state.fleet.slots.size).toBe(0);
    expect(sim.state.player.grid).toEqual(cockpitGrid('cockpit:1'));
    // the owned radar and the cargo are in storage, the fuel of the loan hull is gone
    expect(holdings(sim.state)).toEqual({ ...before, fuel: 0 });
  });

  it('switching from the loan hull to a stored ship dissolves the hull', () => {
    const sim = richSim();
    parkForNewShip(sim);
    // a Hard death later: the active ship is the Guild's loan hull
    setGrid(sim, loanStarterShip());
    const events = act(sim, { type: 'hangarSwitch', shipId: 1 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'shipDissolved', shipId: 2 }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'shipSwitched', from: 2, to: 1 }));
    expect(sim.state.fleet.active.id).toBe(1);
    expect(sim.state.fleet.stored).toEqual([]);
    expect(sim.state.player.grid).toEqual(createStarterShip());
  });
});

describe('determinism', () => {
  const run = () => {
    const sim = richSim();
    sim.state.discovery.archive.add('hangarPlus');
    stock(sim, { 'cockpit:1': 2 });
    act(sim, { type: 'hangarBuySlot' });
    act(sim, { type: 'hangarBuySlot' });
    act(sim, { type: 'hangarNewShip', cockpit: 'cockpit:1' });
    act(sim, { type: 'hangarRename', shipId: 2, name: 'Iskra' });
    act(sim, { type: 'hangarSwitch', shipId: 1 });
    act(sim, { type: 'hangarNewShip', cockpit: 'cockpit:1', acquire: 'buy' });
    act(sim, { type: 'hangarSwitch', shipId: 1 });
    act(sim, { type: 'undock' });
    for (let i = 0; i < 120; i++) sim.step({ ...IDLE_COMMAND, flight: { forward: 1, strafe: 0, turn: 0.2 } });
    return fleetSnapshot(sim.state);
  };

  it('the same actions give the same state', () => {
    expect(run()).toEqual(run());
  });
});
