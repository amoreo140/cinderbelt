// Fleet state (M4a): the starting fleet and the hangar slot rules.
import { describe, expect, it } from 'vitest';
import { HANGAR } from '../../data/economy';
import { emptyCargo } from '../../data/resources';
import { loadSave } from '../save/load';
import { restoreSimulation, toEnvelope, toSave } from '../save/serialize';
import { testContext } from '../save/testing';
import { emptyStats, Simulation } from '../Simulation';
import { generatedNameIndex } from './names';
import { createFleet, emptyShipLog, freeSlotsAt, hangarSlotCap, nextSlotPrice, shipLogFromStats, slotsAt, slotsBought, storedAt } from './state';
import type { StoredShip } from './types';

describe('createFleet', () => {
  it('the starting ship is record 1 with its generated name, nothing stored, no slots', () => {
    expect(createFleet(1337)).toEqual({
      nextShipId: 2,
      active: { id: 1, name: null, nameIdx: generatedNameIndex(1337, 1), log: emptyShipLog() },
      stored: [],
      slots: new Map(),
    });
  });

  it('is deterministic in the seed and returns fresh objects', () => {
    const a = createFleet(42);
    const b = createFleet(42);
    expect(a).toEqual(b);
    expect(a.active.log).not.toBe(b.active.log);
    a.active.log.kills = 3;
    expect(createFleet(42).active.log.kills).toBe(0);
  });

  it('a given log is copied (save migration 15 → 16 builds it from the global stats)', () => {
    const stats = emptyStats();
    stats.distanceFlown = 1234.5;
    stats.kills = 4;
    stats.deaths = 2;
    stats.mined.iron = 10;
    stats.mined.ice = 2.5;
    const log = shipLogFromStats(stats);
    expect(log).toEqual({ distance: 1234.5, kills: 4, mined: 12.5, deaths: 2, built: 0 });
    const fleet = createFleet(1, log);
    expect(fleet.active.log).toEqual(log);
    expect(fleet.active.log).not.toBe(log);
  });

  it('a new game starts with createFleet(seed) and no templates', () => {
    const sim = new Simulation({ seed: 99 });
    expect(sim.state.fleet).toEqual(createFleet(99));
    expect(sim.state.templates).toEqual([]);
  });

  it('a loaded game without fleet data (saves before V16) gets createFleet(seed) and no templates', () => {
    const sim = new Simulation({ seed: 31 });
    const loaded = loadSave(toEnvelope(toSave(sim, testContext())));
    if (!loaded.ok) throw new Error(loaded.error);
    const restored = restoreSimulation(loaded.save);
    expect(restored.state.fleet).toEqual(createFleet(31));
    expect(restored.state.templates).toEqual([]);
  });
});

describe('hangar slots', () => {
  const stored = (id: number, stationId: string): StoredShip => ({
    record: { id, name: null, nameIdx: 0, log: emptyShipLog() },
    stationId,
    grid: { parts: [], nextId: 1 },
    blueprint: { parts: [], nextId: 1 },
    hp: new Map(),
    fuel: 0,
    cargo: emptyCargo(),
  });

  it('counts slots per station and in total, and free slots', () => {
    const fleet = createFleet(1);
    fleet.slots.set('home', 2).set('lyra', 1);
    fleet.stored.push(stored(2, 'home'), stored(3, 'lyra'));
    expect(slotsBought(fleet)).toBe(3);
    expect(slotsAt(fleet, 'home')).toBe(2);
    expect(slotsAt(fleet, 'nowhere')).toBe(0);
    expect(storedAt(fleet, 'home').map((s) => s.record.id)).toEqual([2]);
    expect(freeSlotsAt(fleet, 'home')).toBe(1);
    expect(freeSlotsAt(fleet, 'lyra')).toBe(0);
  });

  it('prices follow the slots bought; the cap is 2, or 4 with "Hangar +2"', () => {
    const { state } = new Simulation({ seed: 1 });
    expect(hangarSlotCap(state)).toBe(2);
    expect(nextSlotPrice(state)).toBe(HANGAR.slotPrices[0]);
    expect(HANGAR.slotPrices[0]).toBe(5000);
    state.fleet.slots.set('home', 1);
    expect(nextSlotPrice(state)).toBe(15000);
    state.fleet.slots.set('home', 2);
    expect(nextSlotPrice(state)).toBeNull();
    state.discovery.archive.add('hangarPlus');
    expect(hangarSlotCap(state)).toBe(4);
    expect(nextSlotPrice(state)).toBe(40000);
    state.fleet.slots.set('lyra', 1);
    expect(nextSlotPrice(state)).toBe(40000);
    state.fleet.slots.set('lyra', 2);
    expect(nextSlotPrice(state)).toBeNull();
  });
});
