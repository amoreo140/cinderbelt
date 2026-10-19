// Pure formatting of the Hangar modal and the Shipyard header (M4a T5), in both languages.
import { afterEach, describe, expect, it } from 'vitest';
import type { CockpitOption, HangarView, ShipCardView } from '../../game/fleet/types';
import { setLocale } from '../../i18n';
import { formatInt } from '../format';
import { cockpitSourceLine, hangarEntries, hubHangarLine, renameValue, shipLogLine, shipWhere, slotSummary, storedHere } from './hangarFormat';

afterEach(() => setLocale('sk'));

const log = (distance: number, kills = 0, mined = 0, deaths = 0) => ({ distance, kills, mined, deaths, built: 0 });

function ship(id: number, over: Partial<ShipCardView> = {}): ShipCardView {
  return {
    id,
    name: `Ship ${id}`,
    generated: false,
    active: false,
    stationId: 'home',
    stationName: 'Základňa',
    here: true,
    tierLabel: 'kokpit T1',
    hull: { used: 10, budget: 28 },
    hpPct: 1,
    cargo: { used: 0, cap: 60 },
    fuelPct: 1,
    log: log(0),
    grid: { parts: [], nextId: 1 },
    hp: new Map(),
    silhouette: { cells: [], minX: 0, maxX: 0, minY: 0, maxY: 0, damaged: 0 },
    ...over,
  };
}

function view(over: Partial<HangarView> = {}, slots: Partial<HangarView['slots']> = {}): HangarView {
  return {
    stationId: 'home',
    slots: { here: 0, usedHere: 0, total: 0, cap: 2, nextPrice: 5000, ...slots },
    ships: [ship(1, { active: true })],
    newShip: { cockpits: [] },
    ...over,
  };
}

describe('shipLogLine', () => {
  it('an untouched ship says the log is empty', () => {
    expect(shipLogLine(log(0))).toBe('zatiaľ bez záznamu');
    setLocale('en');
    expect(shipLogLine(log(0.4))).toBe('nothing logged yet');
  });

  it('distance always, the rest only when non-zero, whole units, Slovak plurals', () => {
    expect(shipLogLine(log(12840.7))).toBe(`${formatInt(12840)} j nalietaných`);
    expect(shipLogLine(log(1284, 3, 920.6, 1))).toBe(`${formatInt(1284)} j nalietaných · 3 zostrely · 920 j vyťažených · 1 zničenie`);
    expect(shipLogLine(log(10, 1, 0, 5))).toBe('10 j nalietaných · 1 zostrel · 5 zničení');
    expect(shipLogLine(log(10, 7, 0, 2))).toBe('10 j nalietaných · 7 zostrelov · 2 zničenia');
  });

  it('English: units, separators and plurals', () => {
    setLocale('en');
    expect(shipLogLine(log(12840, 1, 5480, 2))).toBe('12,840 u flown · 1 kill · 5,480 u mined · 2 losses');
    expect(shipLogLine(log(5, 0, 0, 1))).toBe('5 u flown · 1 loss');
  });
});

describe('slots', () => {
  it('summary of the modal head', () => {
    expect(slotSummary(view({}, { here: 2, usedHere: 1, total: 3, cap: 4 }).slots)).toEqual({ here: '1 / 2 obsadené', game: 'v celej hre 3 z 4' });
    setLocale('en');
    expect(slotSummary(view({}, { here: 1, usedHere: 1, total: 1, cap: 2 }).slots)).toEqual({ here: '1 / 1 taken', game: '1 of 2 in the whole game' });
  });

  it('cards: active, ships here, ships elsewhere, free slots here, then the next slot', () => {
    const v = view(
      { ships: [ship(3, { here: false, stationName: 'Lyra-12' }), ship(1, { active: true }), ship(2)] },
      { here: 3, usedHere: 1, total: 4, cap: 4, nextPrice: null, buyReason: 'cap' },
    );
    expect(hangarEntries(v)).toEqual([
      { kind: 'ship', ship: v.ships[1] },
      { kind: 'ship', ship: v.ships[2] },
      { kind: 'ship', ship: v.ships[0] },
      { kind: 'free', index: 0 },
      { kind: 'free', index: 1 },
      { kind: 'next', price: null, reason: 'cap' },
    ]);
  });

  it('the next slot carries its price; no free slot when all slots here are used', () => {
    const entries = hangarEntries(view({}, { here: 1, usedHere: 1, nextPrice: 15000 }));
    expect(entries.filter((e) => e.kind === 'free')).toEqual([]);
    expect(entries.at(-1)).toEqual({ kind: 'next', price: 15000 });
  });
});

describe('hub overview line', () => {
  it('nothing without a slot or a ship here', () => {
    expect(hubHangarLine(view())).toBeNull();
  });

  it('ships here and free slots, Slovak plurals', () => {
    const v = view({ ships: [ship(1, { active: true }), ship(2), ship(3), ship(4, { here: false })] }, { here: 3, usedHere: 2 });
    expect(storedHere(v)).toBe(2);
    expect(hubHangarLine(v)).toBe('2 lode stoja tu · 1 voľný slot');
    expect(hubHangarLine(view({ ships: [ship(1, { active: true }), ship(2)] }, { here: 1, usedHere: 1 }))).toBe('1 loď stojí tu');
    expect(hubHangarLine(view({}, { here: 2, usedHere: 0 }))).toBe('2 voľné sloty');
    setLocale('en');
    expect(hubHangarLine(v)).toBe('2 ships stand here · 1 free slot');
  });
});

describe('ship card texts', () => {
  it('where the ship stands', () => {
    expect(shipWhere(ship(1))).toBe('stojí tu');
    expect(shipWhere(ship(2, { here: false, stationName: 'Prístav Lyra-12' }))).toBe('stojí na stanici Prístav Lyra-12');
    expect(shipWhere(ship(1, { active: true, here: false, stationId: null, stationName: null }))).toBe('v lete');
    setLocale('en');
    expect(shipWhere(ship(2, { here: false, stationName: 'Harbour Lyra-12' }))).toBe('stands at Harbour Lyra-12');
  });

  it('cockpit option: source and price, storage is free', () => {
    const o = (source: CockpitOption['source'], price: number): CockpitOption => ({ key: 'cockpit:1', source, price });
    expect(cockpitSourceLine(o('storage', 0))).toEqual({ source: 'zo skladu', price: 'zadarmo' });
    expect(cockpitSourceLine(o('buy', 1200))).toEqual({ source: 'kúpiť', price: `${formatInt(1200)} kr` });
    setLocale('en');
    expect(cockpitSourceLine(o('craft', 640))).toEqual({ source: 'craft', price: '640 cr' });
  });

  it('rename value: trimmed, empty = back to the generated name', () => {
    expect(renameValue('  Iskra II ')).toBe('Iskra II');
    expect(renameValue('   ')).toBeNull();
    expect(renameValue('')).toBeNull();
  });
});
