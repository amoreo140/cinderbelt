// Save V19 (M4c "Home and Workshop"): the home station (built modules, trophy pins), ship paints and the
// on-board workshop (refined ore, the repair bank) – the 18 → 19 migration, the round trip, the "death gap"
// and the validation (each bad case rejected, tunable limits repaired).
import { describe, expect, it } from 'vitest';
import { emptyCargo } from '../../data/resources';
import { emptyShipLog } from '../fleet/state';
import { richSim } from '../fleet/testing';
import { fnv1aHex } from '../math/fnv1a';
import { fortressStatus } from '../pirates/fortress';
import { fortressSites } from '../pirates/sites';
import { createStarterShip } from '../ship/presets';
import { computeProperties } from '../ship/properties';
import { repairMaterialPerHp } from '../ship/workshop';
import type { Simulation } from '../Simulation';
import { act, expectOk, homeOnly } from '../station/testHarness';
import { HOME_STATION_ID } from '../world/stations';
import { loadSave } from './load';
import { v18ToV19 } from './migrations';
import { restoreSimulation, toEnvelope, toSave } from './serialize';
import { downgradeToV18, downgradeToV19, testContext } from './testing';
import type { SaveEnvelope, SaveGame } from './types';

const ctx = testContext();

function envelopeOf(data: unknown): SaveEnvelope {
  const text = JSON.stringify(data);
  return { format: 'cinderbelt-save', version: (data as { version: number }).version, checksum: fnv1aHex(text), data: text };
}

function load(data: unknown) {
  const result = loadSave(envelopeOf(data));
  if (!result.ok) throw new Error(`load failed: ${result.error} ${result.details.join('; ')}`);
  return result;
}

const roundTrip = (sim: Simulation): Simulation => restoreSimulation(load(toSave(sim, ctx)).save, { generator: homeOnly });

/** The part of the player's ship the repair bank belongs to in `homeGame` (the first with a material cost). */
const bankPart = (sim: Simulation) => sim.state.player.grid.parts.find((p) => repairMaterialPerHp(p).perHp > 0)!;

/**
 * Docked at home: both modules built, captains 7 and 3 defeated, the first fortress destroyed, two trophies
 * pinned, the active ship painted racing; a stored ship at home painted navy with refined iron; refined
 * iron and titanium aboard and a repair bank worth half a unit.
 */
function homeGame(): Simulation {
  const sim = richSim();
  const s = sim.state;
  expectOk(act(sim, { type: 'homeBuild', module: 'trophyHall' }));
  expectOk(act(sim, { type: 'homeBuild', module: 'paintShop' }));
  s.career.trophies.push({ captain: 7, parts: ['armor:1'] }, { captain: 3, parts: [] });
  const fort = fortressSites(s.seed)[0]!.id;
  s.pirates.fortresses.set(fort, { ...fortressStatus(s, fort), destroyed: s.tick, kills: 1 });
  expectOk(act(sim, { type: 'trophyPin', id: 'cap:7', pinned: true }));
  expectOk(act(sim, { type: 'trophyPin', id: fort as `fort:${string}`, pinned: true }));
  expectOk(act(sim, { type: 'paintShip', shipId: 1, paint: 'racing' }));
  s.fleet.slots.set(HOME_STATION_ID, 2);
  const stored = (id: number, paint?: 'navy') => {
    const grid = createStarterShip();
    s.fleet.stored.push({
      record: { id, name: null, nameIdx: id, log: emptyShipLog(), ...(paint ? { paint } : {}) },
      stationId: HOME_STATION_ID,
      grid,
      blueprint: grid,
      hp: new Map(),
      fuel: 10,
      cargo: { ...emptyCargo(), iron: 10, copper: 2 },
      ...(paint ? { refined: { ...emptyCargo(), iron: 4.25 } } : {}),
    });
  };
  stored(s.fleet.nextShipId++, 'navy');
  stored(s.fleet.nextShipId++);
  const p = s.player;
  p.cargo = { ...emptyCargo(), iron: 20, titanium: 5, ice: 3 };
  p.refined = { ...emptyCargo(), iron: 7.5, titanium: 5 };
  p.repair = { part: bankPart(sim).id, bank: 0.5 / repairMaterialPerHp(bankPart(sim)).perHp };
  return sim;
}

describe('save V19 – migration 18 → 19', () => {
  it('adds the M4c defaults and nothing else', () => {
    const save = toSave(richSim(), ctx);
    const old = downgradeToV18(save);
    expect(old.version).toBe(18);
    expect('home' in old).toBe(false);
    expect(v18ToV19(old)).toEqual(downgradeToV19(save));
  });

  it('a V18 save loads as the same game: every record factory paint, nothing refined, no bank, nothing built', () => {
    const sim = homeGame();
    const s = sim.state;
    // the M4c state taken back to what a V18 game could have had
    s.home.modules.clear();
    s.home.trophyPins = [];
    delete s.fleet.active.paint;
    for (const x of s.fleet.stored) {
      delete x.record.paint;
      delete x.refined;
    }
    s.player.refined = emptyCargo();
    s.player.repair = null;
    const save = toSave(sim, ctx);
    const result = load(downgradeToV18(save));
    expect(result.fromVersion).toBe(18);
    expect(result.warnings).toEqual([]);
    expect(result.save).toEqual(save);
    expect(result.save.fleet.stored.map((x) => [x.record.paint, x.refined])).toEqual([['factory', {}], ['factory', {}]]);
    expect(result.save.home).toEqual({ modules: [], trophyPins: [] });
  });

  it('rejects data that is not a version 18 save', () => {
    expect(() => v18ToV19(null)).toThrow();
    expect(() => v18ToV19({ version: 18 })).toThrow();
  });
});

describe('save V19 – round trip', () => {
  it('home, paints, refined ore and the repair bank survive save and load; the save is canonical', () => {
    const sim = homeGame();
    const save = toSave(sim, ctx);
    const fort = fortressSites(sim.state.seed)[0]!.id;
    expect(save.version).toBe(20);
    expect(save.home).toEqual({ modules: ['paintShop', 'trophyHall'], trophyPins: ['cap:7', fort] });
    expect(save.fleet.active.paint).toBe('racing');
    expect(save.fleet.stored.map((x) => x.record.paint)).toEqual(['navy', 'factory']);
    expect(save.fleet.stored.map((x) => x.refined)).toEqual([{ iron: 4.25 }, {}]);
    expect(save.player.refined).toEqual({ iron: 7.5, titanium: 5 });
    expect(save.player.repair).toEqual(sim.state.player.repair);

    const loaded = roundTrip(sim);
    const again = toSave(loaded, ctx);
    expect(again).toEqual(save);
    expect(JSON.stringify(again)).toBe(JSON.stringify(save));
    const s = loaded.state;
    expect([...s.home.modules].sort()).toEqual(['paintShop', 'trophyHall']);
    expect(s.home.trophyPins).toEqual(['cap:7', fort]);
    expect(s.fleet.active.paint).toBe('racing');
    expect(s.fleet.stored[0]!.record.paint).toBe('navy');
    // the in-memory form of an unpainted ship and of a stored ship without refined ore has no field
    expect(s.fleet.stored[1]!.record).not.toHaveProperty('paint');
    expect(s.fleet.stored[1]).not.toHaveProperty('refined');
    expect(s.fleet.stored[0]!.refined).toEqual({ ...emptyCargo(), iron: 4.25 });
    expect(s.player.refined).toEqual({ ...emptyCargo(), iron: 7.5, titanium: 5 });
    expect(s.player.repair).toEqual(sim.state.player.repair);
  });

  it('a new game saves an empty home, factory paint, nothing refined and no bank', () => {
    const save = toSave(richSim(), ctx);
    expect(save.home).toEqual({ modules: [], trophyPins: [] });
    expect(save.fleet.active.paint).toBe('factory');
    expect(save.player.refined).toEqual({});
    expect(save.player.repair).toBeNull();
  });

  it('the death gap: refined above the cargo is clamped and a bank of a lost part dropped – in the save, not in the game', () => {
    const sim = homeGame();
    const p = sim.state.player;
    // a death applied between two steps took cargo and parts without the step's clamp
    p.cargo.iron = 2;
    p.cargo.titanium = 0;
    p.repair = { part: 999, bank: 3 };
    const save = toSave(sim, ctx);
    expect(save.player.refined).toEqual({ iron: 2 });
    expect(save.player.repair).toBeNull();
    expect(p.refined.iron).toBe(7.5);
    expect(p.repair).toEqual({ part: 999, bank: 3 });
    expect(load(save).warnings).toEqual([]);
    sim.state.fleet.stored[0]!.cargo.iron = 1;
    expect(toSave(sim, ctx).fleet.stored[0]!.refined).toEqual({ iron: 1 });
  });
});

describe('save V19 – validation', () => {
  const base = (): SaveGame => toSave(homeGame(), ctx);
  const rejected = (save: unknown): string[] => {
    const result = loadSave(envelopeOf(save));
    if (result.ok) throw new Error('the save was accepted');
    return result.details;
  };

  it.each<[string, (s: SaveGame) => void, RegExp]>([
    ['no home', (s) => delete (s as Partial<SaveGame>).home, /^home: expected an object/],
    ['an unknown module', (s) => (s.home.modules as string[]).push('shipyard2'), /^home\.modules\[2\]/],
    ['a module of a later milestone', (s) => s.home.modules.push('observatory'), /module not available yet/],
    ['a module twice', (s) => s.home.modules.push('paintShop'), /duplicate module/],
    ['more pins than pedestals', (s) => s.home.trophyPins.push('cap:1', 'cap:2', 'cap:4', 'cap:5', 'cap:6'), /more than 6 pins/],
    ['a pin twice', (s) => s.home.trophyPins.push('cap:7'), /duplicate pin/],
    ['a malformed pin', (s) => (s.home.trophyPins as string[]).push('boss:1'), /expected a trophy id/],
    ['an unknown paint', (s) => ((s.fleet.active as { paint: string }).paint = 'gold'), /^fleet\.active\.paint/],
    ['a stored ship without a paint', (s) => delete (s.fleet.stored[0]!.record as { paint?: string }).paint, /^fleet\.stored\[0\]\.record\.paint/],
    ['refined ore of an unknown resource', (s) => ((s.player.refined as Record<string, number>).gold = 1), /^player\.refined\.gold: unknown resource/],
    ['negative refined ore', (s) => (s.player.refined.iron = -1), /^player\.refined\.iron: out of range/],
    ['refined ice', (s) => (s.player.refined.ice = 1), /ice is never refined/],
    ['more refined than in the cargo', (s) => (s.player.refined.iron = 20.5), /^player\.refined\.iron: more refined than in the cargo/],
    ['a stored ship with more refined than cargo', (s) => (s.fleet.stored[0]!.refined.iron = 11), /^fleet\.stored\[0\]\.refined\.iron/],
    ['no refined field', (s) => delete (s.player as Partial<SaveGame['player']>).refined, /^player\.refined: expected an object/],
    ['a bank of a part that is not there', (s) => (s.player.repair = { part: 999, bank: 1 }), /^player\.repair\.part: no part with id 999/],
    ['a negative bank', (s) => (s.player.repair!.bank = -0.5), /^player\.repair\.bank: out of range/],
    ['a bank that is not an object', (s) => ((s.player as { repair: unknown }).repair = 5), /^player\.repair: expected an object/],
  ])('rejects %s', (_what, edit, error) => {
    const save = structuredClone(base());
    edit(save);
    expect(rejected(save).some((e) => error.test(e))).toBe(true);
  });

  it('modules in any order load in the canonical order', () => {
    const save = base();
    save.home.modules = ['trophyHall', 'paintShop'];
    expect(load(save).save.home.modules).toEqual(['paintShop', 'trophyHall']);
  });

  it('a pin whose trophy this save does not have is dropped with a warning (fortress placement is tunable)', () => {
    const save = base();
    save.home.trophyPins.unshift('cap:12', 'fort:999');
    const result = load(save);
    expect(result.save.home.trophyPins).toEqual(base().home.trophyPins);
    expect(result.warnings).toContainEqual({ code: 'sitesRepaired', paths: ['home.trophyPins[0]', 'home.trophyPins[1]'] });
  });

  it('a bank worth more than one unit of material (a tuned recipe) is clamped to one unit', () => {
    const sim = homeGame();
    const perHp = repairMaterialPerHp(bankPart(sim)).perHp;
    const save = toSave(sim, ctx);
    save.player.repair!.bank = 3 / perHp;
    const result = load(save);
    expect(result.save.player.repair!.bank).toBeCloseTo(1 / perHp, 9);
    expect(result.warnings).toContainEqual({ code: 'capacityClamped', paths: ['player.repair.bank'] });
    // up to rounding it stays as it is
    save.player.repair!.bank = (1 + 1e-9) / perHp;
    expect(load(save).warnings).toEqual([]);
  });

  it('refined ore follows a cargo the validation scaled down to the capacity', () => {
    const sim = homeGame();
    const save = toSave(sim, ctx);
    const capacity = computeProperties(sim.state.player.grid).cargoCapacity;
    save.player.cargo = { ...emptyCargo(), iron: capacity * 2 };
    save.player.refined = { iron: capacity * 1.5 };
    const result = load(save);
    expect(result.save.player.cargo.iron).toBeCloseTo(capacity, 9);
    expect(result.save.player.refined.iron).toBeCloseTo(capacity, 9);
  });

  it('a replaced ship loses its refined ore and its bank (the cargo goes to the storage raw)', () => {
    const save = base();
    // two cockpits: an invalid ship
    save.player.grid.parts.push({ ...save.player.grid.parts.find((p) => p.partId === 'cockpit')!, id: 900, x: 9, y: 0 });
    save.player.grid.nextId = 901;
    const result = load(save);
    expect(result.warnings.some((w) => w.code === 'shipReplaced')).toBe(true);
    expect(result.save.player.refined).toEqual({});
    expect(result.save.player.repair).toBeNull();
  });
});
