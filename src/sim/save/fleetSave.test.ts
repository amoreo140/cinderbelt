// Save V16 (M4a "Hangar and Fleet"): the fleet (active record, stored ships, slots) and the ship
// templates – migration 15 → 16, round trip, validation and repair, and the player wreck's ship.
import { describe, expect, it } from 'vitest';
import { fnv1aHex } from '../math/fnv1a';
import { createWreck, emptyLoot } from '../combat/wrecks';
import { createFleet } from '../fleet/state';
import { richSim, stock } from '../fleet/testing';
import { cargoUsed } from '../../data/resources';
import { createGrid } from '../ship/grid';
import { computeProperties } from '../ship/properties';
import { asLoan } from '../ship/loan';
import { createStarterShip } from '../ship/presets';
import { act, homeOnly, resultOf } from '../station/testHarness';
import { gridTemplateParts } from '../templates/normalize';
import { Simulation } from '../Simulation';
import { HOME_STATION_ID, stationsInArea } from '../world/stations';
import { gridToSave } from './gridSave';
import { loadSave } from './load';
import { restoreSimulation, toEnvelope, toSave } from './serialize';
import { downgradeToV15, testContext } from './testing';
import type { SaveEnvelope, SaveGame } from './types';

const ctx = testContext();

function envelopeOf(data: { version: number }): SaveEnvelope {
  const text = JSON.stringify(data);
  return { format: 'cinderbelt-save', version: data.version, checksum: fnv1aHex(text), data: text };
}

function roundTrip(sim: Simulation): Simulation {
  const result = loadSave(toEnvelope(toSave(sim, ctx)));
  if (!result.ok) throw new Error(`load failed: ${result.error} ${result.details.join('; ')}`);
  expect(result.warnings).toEqual([]);
  return restoreSimulation(result.save, { generator: homeOnly });
}

/** A station without a shipyard (an outpost) of the test world's seed. */
function outpost(save: SaveGame): string {
  const station = stationsInArea(save.seed, -12, 12, -12, 12, save.worldGen).find((s) => !s.services.shipyard);
  if (!station) throw new Error('no outpost near home');
  return station.id;
}

/** The nearest station with a shipyard other than home (seed 1, the test world). */
function farYard(sim: Simulation) {
  const yard = stationsInArea(sim.state.seed, -12, 12, -12, 12, sim.state.world.gen)
    .filter((s) => s.id !== HOME_STATION_ID && s.services.shipyard)
    .sort((a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y))[0];
  if (!yard) throw new Error('no shipyard station near home');
  return yard;
}

/**
 * A game with 4 ships stored (3 at home through the real actions, ship 1 damaged, renamed and loaded;
 * one at a far shipyard), the active ship 4 (a cockpit alone), 4 slots and 2 templates.
 */
function fleetGame(): Simulation {
  const sim = richSim(200_000);
  const s = sim.state;
  s.discovery.archive.add('hangarPlus');
  s.discovery.archive.add('templates');
  s.player.hp.set(2, 5);
  s.player.cargo.iron = 7.5;
  s.player.fuel = s.player.props.fuelCapacity * 0.6;
  expect(resultOf(act(sim, { type: 'hangarRename', shipId: 1, name: 'Lyra' }))).toMatchObject({ ok: true });
  expect(resultOf(act(sim, { type: 'templateSave', name: 'Baník', parts: gridTemplateParts(createStarterShip()) }))).toMatchObject({ ok: true });
  stock(sim, { 'cockpit:1': 3 });
  for (let i = 0; i < 3; i++) {
    expect(resultOf(act(sim, { type: 'hangarBuySlot' }))).toMatchObject({ ok: true });
    expect(resultOf(act(sim, { type: 'hangarNewShip', cockpit: 'cockpit:1' }))).toMatchObject({ ok: true });
  }
  const cockpitOnly = createGrid([['cockpit', 0, 0]]);
  expect(resultOf(act(sim, { type: 'templateSave', name: 'Iskra', parts: gridTemplateParts(cockpitOnly) }))).toMatchObject({ ok: true });
  // one more ship parked far away (as if flown there and left)
  const yard = farYard(sim);
  const grid = createStarterShip();
  const cargo = { iron: 0, copper: 4, ice: 0, titanium: 1 };
  s.fleet.stored.push({
    record: { id: s.fleet.nextShipId++, name: null, nameIdx: 7, log: { distance: 1200, kills: 2, mined: 80, deaths: 1, built: 100 } },
    stationId: yard.id,
    grid,
    blueprint: grid,
    hp: new Map([[3, 9]]),
    fuel: 4,
    cargo,
  });
  s.fleet.slots.set(yard.id, 1);
  expect(s.fleet.stored.map((x) => x.record.id)).toEqual([1, 2, 3, 5]);
  expect(s.fleet.active.id).toBe(4);
  return sim;
}

describe('save V16 – fleet and templates', () => {
  it('a new game saves the starting fleet (ship 1, its generated name) and no templates', () => {
    const sim = new Simulation({ seed: 1337 });
    const save = toSave(sim, ctx);
    expect(save.version).toBe(20);
    expect(save.fleet).toEqual({
      nextShipId: 2,
      active: { id: 1, name: null, nameIdx: createFleet(1337).active.nameIdx, log: { distance: 0, kills: 0, mined: 0, deaths: 0, built: 0 }, paint: 'factory' },
      stored: [],
      slots: [],
    });
    expect(save.templates).toEqual([]);
  });

  it('stored ships, slots, records and templates survive save and load; the save is canonical', () => {
    const sim = fleetGame();
    const save = toSave(sim, ctx);
    expect(save.fleet.stored.map((x) => x.record.id)).toEqual([1, 2, 3, 5]);
    expect(save.fleet.stored[0]!.hp).toEqual([[2, 5]]);
    expect(save.fleet.slots.map(([id]) => id)).toEqual([...save.fleet.slots.map(([id]) => id)].sort());
    const loaded = roundTrip(sim);
    expect(loaded.state.fleet).toEqual(sim.state.fleet);
    expect(loaded.state.templates).toEqual(sim.state.templates);
    expect(toSave(loaded, ctx)).toEqual(save);
    // the loaded game plays on: switch to the renamed, damaged ship 1 at home
    expect(resultOf(act(loaded, { type: 'hangarSwitch', shipId: 1 }))).toMatchObject({ ok: true });
    expect(loaded.state.fleet.active.name).toBe('Lyra');
    expect([...loaded.state.player.hp]).toEqual([[2, 5]]);
    expect(loaded.state.player.cargo.iron).toBe(7.5);
  });

  it('a player wreck keeps the ship it broke off through save and load', () => {
    const sim = fleetGame();
    const p = sim.state.player;
    const w = createWreck(sim.state.combat.nextId++, [p.grid.parts[0]!], { body: p.body, props: p.props }, { vel: { x: 0, y: 0 }, angVel: 0 }, emptyLoot(), 'default');
    w.ship = 2;
    sim.state.combat.wrecks.push(w);
    const loaded = roundTrip(sim);
    expect(loaded.state.combat.wrecks.at(-1)!.ship).toBe(2);
    const bad = toSave(sim, ctx);
    bad.combat.wrecks.at(-1)!.ship = 0;
    expect(loadSave(envelopeOf(bad))).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('migration 15 → 16: ship 1 with the whole game as its log, nothing stored, no templates; old player wrecks are ship 1', () => {
    const sim = richSim();
    sim.state.stats.distanceFlown = 5000;
    sim.state.stats.kills = 4;
    sim.state.stats.deaths = 2;
    sim.state.stats.mined.iron = 30;
    sim.state.stats.mined.ice = 12;
    const p = sim.state.player;
    sim.state.combat.wrecks.push(createWreck(50, [p.grid.parts[1]!], { body: p.body, props: p.props }, { vel: { x: 0, y: 0 }, angVel: 0 }, emptyLoot(), 'default'));
    sim.state.combat.wrecks.push(createWreck(51, [p.grid.parts[1]!], { body: p.body, props: p.props }, { vel: { x: 0, y: 0 }, angVel: 0 }, emptyLoot(), 'pirate'));
    const current = toSave(sim, ctx);
    const old = downgradeToV15(current);
    expect(old.version).toBe(15);
    expect('fleet' in old || 'templates' in old).toBe(false);
    const result = loadSave(toEnvelope(old));
    expect(result).toMatchObject({ ok: true, fromVersion: 15, warnings: [] });
    if (!result.ok) return;
    expect(result.save.fleet).toEqual({
      nextShipId: 2,
      active: { id: 1, name: null, nameIdx: createFleet(sim.state.seed).active.nameIdx, log: { distance: 5000, kills: 4, mined: 42, deaths: 2, built: 0 }, paint: 'factory' },
      stored: [],
      slots: [],
    });
    expect(result.save.templates).toEqual([]);
    expect(result.save.combat.wrecks.map((w) => w.ship)).toEqual([1, undefined]);
    expect({ ...result.save, fleet: current.fleet, combat: current.combat }).toEqual({ ...current, combat: current.combat });
  });
});

describe('save V16 – validation and repair', () => {
  const base = (): SaveGame => toSave(fleetGame(), ctx);
  const load = (save: SaveGame) => loadSave(envelopeOf(save));
  const repaired = (save: SaveGame) => {
    const result = load(save);
    if (!result.ok) throw new Error(`load failed: ${result.error} ${result.details.join('; ')}`);
    return result;
  };
  const clamped = (warnings: readonly { code: string }[]) => (warnings.find((w) => w.code === 'capacityClamped') as { paths: string[] } | undefined)?.paths ?? [];

  it('a valid save loads without warnings', () => {
    expect(repaired(base()).warnings).toEqual([]);
  });

  it('rejects a malformed fleet or templates (structure)', () => {
    const save = base();
    const bad: unknown[] = [
      { ...save, fleet: undefined },
      { ...save, templates: undefined },
      { ...save, fleet: { ...save.fleet, stored: 'none' } },
      { ...save, fleet: { ...save.fleet, nextShipId: 1 } },
      { ...save, fleet: { ...save.fleet, active: { ...save.fleet.active, id: 0 } } },
      { ...save, fleet: { ...save.fleet, active: { ...save.fleet.active, log: { ...save.fleet.active.log, kills: -1 } } } },
      { ...save, fleet: { ...save.fleet, active: { ...save.fleet.active, name: 7 } } },
      { ...save, fleet: { ...save.fleet, slots: [['home', 0]] } },
      { ...save, fleet: { ...save.fleet, slots: [['home', 1], ['home', 2]] } },
      { ...save, fleet: { ...save.fleet, stored: [{ ...save.fleet.stored[0]!, hp: [[99, 3]] }] } },
      { ...save, fleet: { ...save.fleet, stored: [{ ...save.fleet.stored[0]!, fuel: -1 }] } },
      { ...save, fleet: { ...save.fleet, stored: [{ ...save.fleet.stored[0]!, stationId: 'nowhere' }] } },
      { ...save, templates: [{ name: 'x', parts: 'none' }] },
    ];
    for (const s of bad) expect(load(s as SaveGame)).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('a stored ship that cannot stand is taken apart into its station storage with a warning, never a rejected save', () => {
    const save = base();
    const home = structuredClone(save.stations[HOME_STATION_ID]!);
    const [one, two, three] = save.fleet.stored;
    // ship 1: Guild loan parts; ship 2: a disconnected grid; ship 3: at a station without a shipyard
    one!.grid = gridToSave(asLoan(createStarterShip()));
    two!.grid = gridToSave(createGrid([['cockpit', 0, 0], ['armor', 3, 3]]));
    two!.hp = [];
    two!.blueprint = two!.grid;
    const result = repaired({ ...save, fleet: { ...save.fleet, stored: [one!, two!, { ...three!, stationId: outpost(save) }, save.fleet.stored[3]!] } });
    expect(result.warnings.filter((w) => w.code === 'storedShipDropped')).toEqual([
      { code: 'storedShipDropped', shipId: 1, stationId: HOME_STATION_ID },
      { code: 'storedShipDropped', shipId: 2, stationId: HOME_STATION_ID },
      { code: 'storedShipDropped', shipId: 3, stationId: HOME_STATION_ID },
    ]);
    expect(result.save.fleet.stored.map((s) => s.record.id)).toEqual([5]);
    // loan parts go back to the Guild; owned parts and cargo into the storage
    const parts = result.save.stations[HOME_STATION_ID]!.parts;
    expect(parts['armor:1']).toBe((home.parts['armor:1'] ?? 0) + 1);
    expect(parts['cockpit:1']).toBe((home.parts['cockpit:1'] ?? 0) + 2);
    expect(result.save.stations[HOME_STATION_ID]!.resources.iron).toBe(home.resources.iron + 7.5);
    // the slots stay bought
    expect(result.save.fleet.slots).toEqual(save.fleet.slots);
  });

  it('drops a stored ship with a duplicate id and repairs nextShipId', () => {
    const save = base();
    const twin = { ...structuredClone(save.fleet.stored[1]!), record: { ...save.fleet.stored[1]!.record, id: save.fleet.active.id } };
    const result = repaired({ ...save, fleet: { ...save.fleet, nextShipId: 3, stored: [...save.fleet.stored, twin] } });
    expect(result.warnings).toContainEqual({ code: 'storedShipDropped', shipId: save.fleet.active.id, stationId: HOME_STATION_ID });
    expect(result.save.fleet.stored.map((s) => s.record.id)).toEqual([1, 2, 3, 5]);
    expect(result.save.fleet.nextShipId).toBe(6);
    expect(clamped(result.warnings)).toContain('fleet.nextShipId');
  });

  it('sanitises names, wraps a name index past the list, clamps fuel and cargo of a stored ship', () => {
    const save = base();
    save.fleet.active.name = '  Bad\u0007  Name ';
    save.fleet.active.nameIdx = 1000;
    save.fleet.stored[1]!.record.name = '‮';
    save.fleet.stored[0]!.fuel = 1e6;
    save.fleet.stored[0]!.cargo.titanium = 1e6;
    const result = repaired(save);
    const f = result.save.fleet;
    expect(f.active.name).toBe('Bad Name');
    expect(f.active.nameIdx).toBeLessThan(48);
    expect(f.stored[1]!.record.name).toBeNull();
    const paths = clamped(result.warnings);
    expect(paths).toEqual(expect.arrayContaining(['fleet.active.name', 'fleet.active.nameIdx', 'fleet.stored[1].record.name', 'fleet.stored[0].fuel', 'fleet.stored[0].cargo']));
    const ship = restoreSimulation(result.save, { generator: homeOnly }).state.fleet.stored[0]!;
    const props = computeProperties(ship.grid);
    expect(ship.fuel).toBe(props.fuelCapacity);
    expect(cargoUsed(ship.cargo)).toBeCloseTo(props.cargoCapacity);
  });

  it('slots: at least one per stored ship, only at shipyards, free slots over the Archive cap given up', () => {
    const save = base();
    const yard = save.fleet.stored[3]!.stationId;
    // fewer slots than ships at home, slots at an outpost without a shipyard
    const few = repaired({ ...save, fleet: { ...save.fleet, slots: [['home', 1], [yard, 1], [outpost(save), 2]] } });
    expect(few.save.fleet.slots).toEqual([['home', 3], [yard, 1]].sort((a, b) => (a[0]! < b[0]! ? -1 : 1)));
    // without "Hangar +2" the cap is 2: the free slot goes, the ships stay (4 slots for 4 ships)
    const archive = save.discovery.archive.filter((n) => n !== 'hangarPlus');
    const capped = repaired({ ...save, discovery: { ...save.discovery, archive }, fleet: { ...save.fleet, slots: [['home', 4], [yard, 1]] } });
    expect(capped.save.fleet.stored).toHaveLength(4);
    expect(Object.fromEntries(capped.save.fleet.slots)).toEqual({ home: 3, [yard]: 1 });
  });

  it('templates: names sanitised, broken designs and templates over the Archive cap dropped', () => {
    const save = base();
    const good = save.templates[0]!;
    const result = repaired({
      ...save,
      templates: [
        { name: ' Baník\u0000 ', parts: good.parts },
        { name: 'two cockpits', parts: [...good.parts, ['cockpit:1', 5, 5, 0]] },
        { name: 'unknown', parts: [['warpDrive:9' as never, 0, 0, 0]] },
        { name: '', parts: good.parts },
        ...Array.from({ length: 6 }, (_, i) => ({ name: `T${i}`, parts: good.parts })),
      ],
    });
    expect(result.save.templates.map((t) => t.name)).toEqual(['Baník', 'T0', 'T1', 'T2', 'T3']);
    expect(result.save.templates[0]!.parts).toEqual(good.parts);
    expect(clamped(result.warnings)).toEqual(expect.arrayContaining(['templates[0].name', 'templates[1]', 'templates[2]', 'templates[3]', 'templates']));
  });
});
