// Hangar actions (M4a plan §2): guards, slots, new ship, switch, rename, dismantle – every refused
// action changes nothing.
import { describe, expect, it } from 'vitest';
import { HANGAR } from '../../data/economy';
import { partBuyPrice, RECIPES, repairCost } from '../../data/economy';
import { SHIP_NAME_MAX } from '../../data/fleet';
import { IDLE_COMMAND, type GameAction, type GameActionInput } from '../commands';
import { maxHp } from '../ship/hp';
import { createStarterShip } from '../ship/presets';
import { act, customStation, dockedAt, resultOf } from '../station/testHarness';
import { HOME_STATION_ID, homeStation } from '../world/stations';
import { STATION_SERVICES } from '../../data/stations';
import { isFleetAction } from './actions';
import { generatedNameIndex } from './names';
import { cockpitGrid } from './newShip';
import { freeSlotsAt } from './state';
import { fleetSnapshot, holdings, parkForNewShip, richSim, stock } from './testing';
import type { Simulation } from '../Simulation';

const FLEET: GameActionInput[] = [
  { type: 'hangarBuySlot' },
  { type: 'hangarSwitch', shipId: 2 },
  { type: 'hangarNewShip', cockpit: 'cockpit:1' },
  { type: 'hangarNewShip', cockpit: 'cockpit:2', acquire: 'buy' },
  { type: 'hangarRename', shipId: 1, name: 'Moja' },
  { type: 'hangarRename', shipId: 1, name: null },
  { type: 'hangarDismantle', shipId: 2 },
];
const DOCKED_ONLY = FLEET.filter((a) => a.type !== 'hangarRename');

/** The action is refused with `reason` and changes nothing at all. */
function expectRefused(sim: Simulation, a: GameActionInput, reason: string): void {
  const before = fleetSnapshot(sim.state);
  const events = act(sim, a);
  expect(resultOf(events), a.type).toMatchObject({ ok: false, reason });
  expect(events.filter((e) => /^(ship|hangar|credits)/.test(e.type))).toEqual([]);
  expect(fleetSnapshot(sim.state)).toEqual(before);
}

/** A sim with one stored ship (the starter, id 1) at home and the active new cockpit-only ship 2. */
function withStoredStarter(): Simulation {
  const sim = richSim();
  parkForNewShip(sim);
  return sim;
}

describe('fleet action routing', () => {
  it('recognises exactly the hangar actions', () => {
    for (const a of FLEET) expect(isFleetAction({ ...a, reqId: 1 } as GameAction), a.type).toBe(true);
    expect(isFleetAction({ type: 'undock', reqId: 1 })).toBe(false);
    expect(isFleetAction({ type: 'templateSave', name: 'x', parts: [], reqId: 1 })).toBe(false);
  });
});

describe('hangar guards', () => {
  it('in flight every hangar action but rename answers notDocked', () => {
    const sim = richSim();
    act(sim, { type: 'undock' });
    for (const a of DOCKED_ONLY) expectRefused(sim, a, 'notDocked');
  });

  it('a destroyed ship cannot use the hangar', () => {
    const sim = richSim();
    sim.state.player.destroyed = true;
    for (const a of DOCKED_ONLY) expectRefused(sim, a, 'serviceUnavailable');
  });

  it('a station without a shipyard has no hangar', () => {
    const sim = dockedAt(customStation({ services: STATION_SERVICES.outpost }));
    sim.state.credits = 100_000;
    sim.step(IDLE_COMMAND);
    for (const a of DOCKED_ONLY) expectRefused(sim, a, 'serviceUnavailable');
  });

  it('not during the Guild Training', () => {
    const sim = richSim();
    sim.state.career.training.status = 'active';
    for (const a of DOCKED_ONLY) expectRefused(sim, a, 'trainingActive');
    sim.state.career.training.status = 'done';
    expect(resultOf(act(sim, { type: 'hangarBuySlot' }))).toMatchObject({ ok: true });
  });
});

describe('hangarBuySlot', () => {
  it('prices follow the slots bought, cap 2 without the Archive', () => {
    const sim = richSim();
    const events = act(sim, { type: 'hangarBuySlot' });
    expect(resultOf(events)).toMatchObject({ ok: true });
    expect(events).toContainEqual({ type: 'creditsChanged', delta: -5000, reason: 'hangar' });
    expect(events).toContainEqual({ type: 'hangarSlotBought', stationId: HOME_STATION_ID, price: 5000, here: 1, total: 1 });
    act(sim, { type: 'hangarBuySlot' });
    expect(sim.state.credits).toBe(100_000 - 5000 - 15000);
    expect(sim.state.fleet.slots.get(HOME_STATION_ID)).toBe(2);
    expectRefused(sim, { type: 'hangarBuySlot' }, 'slotCap');
  });

  it('"Hangar +2" raises the cap to 4 (40 000 each)', () => {
    const sim = richSim();
    sim.state.discovery.archive.add('hangarPlus');
    for (let i = 0; i < 4; i++) expect(resultOf(act(sim, { type: 'hangarBuySlot' }))).toMatchObject({ ok: true });
    expect(sim.state.credits).toBe(100_000 - HANGAR.slotPrices.reduce((s, p) => s + p, 0));
    expectRefused(sim, { type: 'hangarBuySlot' }, 'slotCap');
  });

  it('not enough credits', () => {
    const sim = richSim(4999);
    expectRefused(sim, { type: 'hangarBuySlot' }, 'notEnoughCredits');
  });
});

describe('hangarNewShip', () => {
  it('needs a free slot here for the active ship', () => {
    const sim = richSim();
    stock(sim, { 'cockpit:1': 1 });
    expectRefused(sim, { type: 'hangarNewShip', cockpit: 'cockpit:1' }, 'noSlot');
  });

  it('from a storage cockpit: the old ship stands in the slot, the new one is the cockpit alone', () => {
    const sim = richSim();
    const old = createStarterShip();
    sim.state.player.cargo.iron = 7;
    sim.state.player.hp.set(3, 5);
    const fuel = sim.state.player.fuel;
    act(sim, { type: 'hangarBuySlot' });
    const credits = sim.state.credits;
    stock(sim, { 'cockpit:1': 2 });
    const before = holdings(sim.state);
    const tick = sim.state.tick;
    const events = act(sim, { type: 'hangarNewShip', cockpit: 'cockpit:1' });
    expect(resultOf(events)).toMatchObject({ ok: true });
    expect(events).toContainEqual({ type: 'shipCreated', stationId: HOME_STATION_ID, shipId: 2, parked: 1, loanReturned: {} });
    expect(events.some((e) => e.type === 'creditsChanged')).toBe(false);
    const { player, fleet } = sim.state;
    expect(sim.state.credits).toBe(credits);
    expect(player.grid).toEqual(cockpitGrid('cockpit:1'));
    expect(player.blueprint).toEqual(player.grid);
    expect(player.fuel).toBe(0);
    expect(player.energy).toBe(player.props.batteryCapacity);
    expect(player.cargo.iron).toBe(0);
    expect(player.hp.size).toBe(0);
    expect(fleet.active).toMatchObject({ id: 2, name: null, log: { distance: 0, kills: 0, mined: 0, deaths: 0, built: tick } });
    expect(fleet.active.nameIdx).not.toBe(fleet.stored[0]!.record.nameIdx);
    expect(fleet.nextShipId).toBe(3);
    expect(fleet.stored).toHaveLength(1);
    const parked = fleet.stored[0]!;
    expect(parked.record.id).toBe(1);
    expect(parked.stationId).toBe(HOME_STATION_ID);
    expect(parked.grid).toEqual(old);
    expect([...parked.hp]).toEqual([[3, 5]]);
    expect(parked.fuel).toBe(fuel);
    expect(parked.cargo.iron).toBe(7);
    expect(sim.state.stations.get(HOME_STATION_ID)!.parts['cockpit:1']).toBe(1);
    expect(freeSlotsAt(fleet, HOME_STATION_ID)).toBe(0);
    // nothing created or lost: the cockpit only moved from storage onto the new hull
    expect(holdings(sim.state)).toEqual(before);
  });

  it('the generated name follows hash(seed, id) and skips names the fleet uses', () => {
    const sim = withStoredStarter();
    const taken = new Set([generatedNameIndex(1, 1)]);
    expect(sim.state.fleet.active.nameIdx).toBe(generatedNameIndex(1, 2, taken));
  });

  it('no cockpit in storage → notEnoughParts; not a cockpit or an unknown key is refused', () => {
    const sim = richSim();
    act(sim, { type: 'hangarBuySlot' });
    expectRefused(sim, { type: 'hangarNewShip', cockpit: 'cockpit:1' }, 'notEnoughParts');
    stock(sim, { 'engine:1': 1 });
    expectRefused(sim, { type: 'hangarNewShip', cockpit: 'engine:1' }, 'invalidDesign');
    expectRefused(sim, { type: 'hangarNewShip', cockpit: 'warpCore:9' as never }, 'unknownPart');
    expectRefused(sim, { type: 'hangarNewShip', cockpit: 'cockpit:1', acquire: 'steal' as never }, 'invalidDesign');
  });

  it('a bought cockpit costs the shipyard price (no install fee) and never takes the storage copy', () => {
    const sim = richSim();
    act(sim, { type: 'hangarBuySlot' });
    stock(sim, { 'cockpit:1': 1 });
    const credits = sim.state.credits;
    const price = partBuyPrice('cockpit:1', homeStation().ring)!;
    const events = act(sim, { type: 'hangarNewShip', cockpit: 'cockpit:1', acquire: 'buy' });
    expect(resultOf(events)).toMatchObject({ ok: true });
    expect(events).toContainEqual({ type: 'creditsChanged', delta: -price, reason: 'hangar' });
    expect(sim.state.credits).toBe(credits - price);
    expect(sim.state.stations.get(HOME_STATION_ID)!.parts['cockpit:1']).toBe(1);
  });

  it('a T2 cockpit is not sold in ring 1 → notAvailableHere', () => {
    const sim = richSim();
    act(sim, { type: 'hangarBuySlot' });
    expectRefused(sim, { type: 'hangarNewShip', cockpit: 'cockpit:2', acquire: 'buy' }, 'notAvailableHere');
  });

  it('a crafted cockpit takes the recipe: credits and materials (storage first, then the cargo)', () => {
    const sim = richSim();
    act(sim, { type: 'hangarBuySlot' });
    const recipe = RECIPES['cockpit:1'];
    const storage = sim.state.stations.get(HOME_STATION_ID)!.resources;
    for (const [r, n] of Object.entries(recipe.resources)) storage[r as keyof typeof storage] = n as number;
    const credits = sim.state.credits;
    const before = holdings(sim.state);
    expect(resultOf(act(sim, { type: 'hangarNewShip', cockpit: 'cockpit:1', acquire: 'craft' }))).toMatchObject({ ok: true });
    expect(sim.state.credits).toBe(credits - recipe.credits);
    const after = holdings(sim.state);
    for (const [r, n] of Object.entries(recipe.resources)) expect(after.resources[r as keyof typeof storage]).toBeCloseTo(before.resources[r as keyof typeof storage] - (n as number));
    expect(after.parts['cockpit:1']).toBe((before.parts['cockpit:1'] ?? 0) + 1);
  });

  it('crafting without the materials or buying without the credits is atomic', () => {
    const sim = richSim();
    act(sim, { type: 'hangarBuySlot' });
    expectRefused(sim, { type: 'hangarNewShip', cockpit: 'cockpit:1', acquire: 'craft' }, 'notEnoughResources');
    sim.state.credits = partBuyPrice('cockpit:1', 1)! - 1;
    expectRefused(sim, { type: 'hangarNewShip', cockpit: 'cockpit:1', acquire: 'buy' }, 'notEnoughCredits');
  });

  it('a locked cockpit variant cannot be bought or crafted, but one in storage can be used', () => {
    const sim = richSim();
    act(sim, { type: 'hangarBuySlot' });
    expectRefused(sim, { type: 'hangarNewShip', cockpit: 'cockpit:1:combat', acquire: 'buy' }, 'notAvailableHere');
    expectRefused(sim, { type: 'hangarNewShip', cockpit: 'cockpit:1:combat', acquire: 'craft' }, 'notAvailableHere');
    stock(sim, { 'cockpit:1:combat': 1 });
    expect(resultOf(act(sim, { type: 'hangarNewShip', cockpit: 'cockpit:1:combat' }))).toMatchObject({ ok: true });
    expect(sim.state.player.grid.parts[0]).toMatchObject({ partId: 'cockpit', tier: 1, variant: 'combat' });
  });

  it('T2 cockpits are sold from ring 2', () => {
    const sim = dockedAt(customStation({ ring: 2 }));
    sim.state.credits = 100_000;
    act(sim, { type: 'hangarBuySlot' });
    expect(resultOf(act(sim, { type: 'hangarNewShip', cockpit: 'cockpit:2', acquire: 'buy' }))).toMatchObject({ ok: true });
    expect(sim.state.player.grid.parts[0]).toMatchObject({ partId: 'cockpit', tier: 2 });
  });
});

describe('hangarSwitch', () => {
  it('unknown ship, the active ship, or a ship standing elsewhere is refused', () => {
    const sim = withStoredStarter();
    expectRefused(sim, { type: 'hangarSwitch', shipId: 99 }, 'unknownShip');
    expectRefused(sim, { type: 'hangarSwitch', shipId: 2 }, 'unknownShip');
    sim.state.fleet.stored[0]!.stationId = 'st:9,9';
    expectRefused(sim, { type: 'hangarSwitch', shipId: 1 }, 'shipNotHere');
  });

  it('swaps the active ship with the stored one here – no free slot needed', () => {
    const sim = withStoredStarter();
    expect(freeSlotsAt(sim.state.fleet, HOME_STATION_ID)).toBe(0);
    const events = act(sim, { type: 'hangarSwitch', shipId: 1 });
    expect(resultOf(events)).toMatchObject({ ok: true });
    expect(events).toContainEqual({ type: 'shipSwitched', stationId: HOME_STATION_ID, from: 2, to: 1, loanReturned: {} });
    expect(sim.state.fleet.active.id).toBe(1);
    expect(sim.state.fleet.stored.map((s) => s.record.id)).toEqual([2]);
    expect(sim.state.player.grid).toEqual(createStarterShip());
  });
});

describe('hangarRename', () => {
  it('renames the active or a stored ship, anywhere; null = the generated name again', () => {
    const sim = withStoredStarter();
    expect(act(sim, { type: 'hangarRename', shipId: 1, name: '  Stará  Lyra ' })).toContainEqual({ type: 'shipRenamed', shipId: 1, name: 'Stará Lyra' });
    expect(sim.state.fleet.stored[0]!.record.name).toBe('Stará Lyra');
    act(sim, { type: 'undock' });
    expect(resultOf(act(sim, { type: 'hangarRename', shipId: 2, name: 'Iskra\u0007' }))).toMatchObject({ ok: true });
    expect(sim.state.fleet.active.name).toBe('Iskra');
    expect(act(sim, { type: 'hangarRename', shipId: 2, name: null })).toContainEqual({ type: 'shipRenamed', shipId: 2, name: null });
    expect(sim.state.fleet.active.name).toBeNull();
  });

  it('rejects empty, too long, control-only and non-string names and unknown ships', () => {
    const sim = richSim();
    sim.state.fleet.active.name = 'Moja';
    for (const name of ['', '   ', 'x'.repeat(SHIP_NAME_MAX + 1), '\u0000\u0001', 'y'.repeat(1000), 42 as never, { a: 1 } as never]) {
      expectRefused(sim, { type: 'hangarRename', shipId: 1, name }, 'invalidName');
    }
    expectRefused(sim, { type: 'hangarRename', shipId: 7, name: 'Iná' }, 'unknownShip');
    expect(resultOf(act(sim, { type: 'hangarRename', shipId: 1, name: 'z'.repeat(SHIP_NAME_MAX) }))).toMatchObject({ ok: true });
  });
});

describe('hangarDismantle', () => {
  it('parts and cargo to storage, fuel lost, the slot stays bought and becomes free', () => {
    const sim = richSim();
    sim.state.player.cargo.ice = 4;
    parkForNewShip(sim);
    const stored = sim.state.fleet.stored[0]!;
    const fuel = stored.fuel;
    const before = holdings(sim.state);
    const events = act(sim, { type: 'hangarDismantle', shipId: 1 });
    expect(resultOf(events)).toMatchObject({ ok: true });
    const e = events.find((x) => x.type === 'shipDismantled');
    expect(e).toMatchObject({ shipId: 1, fee: 0, scrapped: {}, cargo: { ice: 4 } });
    expect(sim.state.fleet.stored).toEqual([]);
    expect(sim.state.fleet.slots.get(HOME_STATION_ID)).toBe(1);
    expect(freeSlotsAt(sim.state.fleet, HOME_STATION_ID)).toBe(1);
    // the whole starter hull is in storage now, the fuel is gone
    expect(holdings(sim.state)).toEqual({ ...before, fuel: before.fuel - fuel });
  });

  it('a damaged part is repaired into storage for the fee, or scrapped at a station that does not repair', () => {
    const sim = richSim();
    const laser = createStarterShip().parts.find((p) => p.partId === 'miningLaser')!;
    sim.state.player.hp.set(laser.id, 1);
    parkForNewShip(sim);
    const fee = repairCost('miningLaser:1', 1, maxHp(laser), 1);
    sim.state.stations.get(HOME_STATION_ID)!.resources[fee.material] = 100;
    const credits = sim.state.credits;
    const events = act(sim, { type: 'hangarDismantle', shipId: 1 });
    expect(events.find((x) => x.type === 'shipDismantled')).toMatchObject({ fee: fee.credits, scrapped: {} });
    expect(events).toContainEqual({ type: 'creditsChanged', delta: -fee.credits, reason: 'repair' });
    expect(sim.state.credits).toBe(credits - fee.credits);
    expect(sim.state.stations.get(HOME_STATION_ID)!.parts['miningLaser:1']).toBe(1);

    const poor = richSim();
    poor.state.player.hp.set(laser.id, 1);
    parkForNewShip(poor);
    poor.state.credits = 0;
    const scrapped = act(poor, { type: 'hangarDismantle', shipId: 1 });
    expect(scrapped.find((x) => x.type === 'shipDismantled')).toMatchObject({ fee: 0, scrapped: { 'miningLaser:1': 1 } });
    expect(poor.state.stations.get(HOME_STATION_ID)!.parts['miningLaser:1']).toBeUndefined();
  });

  it('only a stored ship standing here; never the active ship', () => {
    const sim = withStoredStarter();
    expectRefused(sim, { type: 'hangarDismantle', shipId: 2 }, 'unknownShip');
    sim.state.fleet.stored[0]!.stationId = 'st:9,9';
    expectRefused(sim, { type: 'hangarDismantle', shipId: 1 }, 'shipNotHere');
  });
});
