// Hangar view models (M4a T4): reasons, slot prices and caps, ship cards, cockpit offers, dismantle
// quotes, the Guild loan note, the Shipyard header and the Storages ship rows.
import { describe, expect, it } from 'vitest';
import { HANGAR } from '../../data/economy';
import { tx } from '../../i18n';
import { act } from '../../sim/station/testHarness';
import { dismantleQuote } from '../../sim/fleet/dismantle';
import { cockpitQuote } from '../../sim/fleet/newShip';
import { parkForNewShip, richSim, stock } from '../../sim/fleet/testing';
import { hullBudgetOf } from '../../sim/ship/budget';
import { maxHp } from '../../sim/ship/hp';
import type { Simulation } from '../../sim/Simulation';
import { HOME_STATION_ID, homeStation } from '../../sim/world/stations';
import { shipLogLine } from '../../ui/station/hangarFormat';
import { storagesData } from '../board/storagesView';
import { hangarView, shipHeaderView, storageShipRows, tierLabel } from './hangarView';

const err = () => tx().actionErrors;

/** A sim with the starter (id 1) stored at home and the new cockpit-only ship 2 active. */
function withStoredStarter(): Simulation {
  const sim = richSim();
  parkForNewShip(sim);
  return sim;
}

describe('hangarView – slots', () => {
  it('docked at home with no slot: the first slot costs the first price, new ship needs a slot', () => {
    const sim = richSim();
    const v = hangarView(sim.state);
    expect(v.reason).toBeUndefined();
    expect(v.stationId).toBe(HOME_STATION_ID);
    expect(v.slots).toEqual({ here: 0, usedHere: 0, total: 0, cap: HANGAR.maxSlots.base, nextPrice: HANGAR.slotPrices[0] });
    expect(v.newShip.reason).toBe(err().noSlot);
  });

  it('a buy needs the credits, and the cap stops it (4 with "Hangar +2")', () => {
    const sim = richSim(100);
    expect(hangarView(sim.state).slots.buyReason).toBe(err().notEnoughCredits);
    sim.state.credits = 1_000_000;
    act(sim, { type: 'hangarBuySlot' });
    act(sim, { type: 'hangarBuySlot' });
    let v = hangarView(sim.state);
    expect(v.slots).toMatchObject({ here: 2, usedHere: 0, total: 2, cap: 2, nextPrice: null, buyReason: err().slotCap });
    expect(v.newShip.reason).toBeUndefined();
    sim.state.discovery.archive.add('hangarPlus');
    v = hangarView(sim.state);
    expect(v.slots).toMatchObject({ cap: 4, nextPrice: HANGAR.slotPrices[2] });
    expect(v.slots.buyReason).toBeUndefined();
  });
});

describe('hangarView – ships', () => {
  it('the active ship card: generated name, here, class, hull, gauges, no switch / dismantle', () => {
    const sim = richSim();
    const { state } = sim;
    const [card] = hangarView(state).ships;
    expect(card).toMatchObject({
      id: 1,
      active: true,
      here: true,
      stationId: HOME_STATION_ID,
      generated: true,
      name: tx().fleet.names[state.fleet.active.nameIdx],
      tierLabel: tierLabel(state.player.grid),
      hull: { used: hullBudgetOf(state.player.grid).used, budget: hullBudgetOf(state.player.grid).budget },
      hpPct: 1,
      cargo: { used: 0, cap: state.player.props.cargoCapacity },
    });
    expect(card!.switchReason).toBeUndefined();
    expect(card!.dismantle).toBeUndefined();
    expect(card!.loanNote).toBeUndefined();
    expect(card!.silhouette.cells.length).toBeGreaterThan(0);
    expect(card!.fuelPct).toBeCloseTo(state.player.fuel / state.player.props.fuelCapacity);
  });

  it('a stored ship here can be switched to and dismantled; damage shows the repair fee', () => {
    const sim = withStoredStarter();
    let v = hangarView(sim.state);
    expect(v.ships.map((s) => [s.id, s.active])).toEqual([
      [2, true],
      [1, false],
    ]);
    const stored = v.ships[1]!;
    expect(stored).toMatchObject({ here: true, stationId: HOME_STATION_ID, dismantle: { fee: 0, scrap: 0 } });
    expect(stored.switchReason).toBeUndefined();
    expect(stored.dismantle!.reason).toBeUndefined();
    expect(v.slots).toMatchObject({ here: 1, usedHere: 1 });
    expect(v.newShip.reason).toBe(err().noSlot);

    // damage a part of the stored ship: the card shows the shipyard's removal quote (repair fee or scrap)
    const ship = sim.state.fleet.stored[0]!;
    const part = ship.grid.parts.find((p) => p.partId === 'engine')!;
    ship.hp.set(part.id, maxHp(part) / 2);
    v = hangarView(sim.state);
    const quote = dismantleQuote(sim.state, homeStation(), ship);
    const scrapped = Object.values(quote.scrapped).reduce((a, n) => a + (n ?? 0), 0);
    expect(quote.fee + scrapped).toBeGreaterThan(0);
    expect(v.ships[1]!.dismantle).toEqual({ fee: quote.fee, scrap: scrapped });
    expect(v.ships[1]!.hpPct).toBeLessThan(1);
  });

  it('a ship standing elsewhere cannot be switched to or dismantled here', () => {
    const sim = withStoredStarter();
    sim.state.fleet.stored[0]!.stationId = 'st:99,99';
    const stored = hangarView(sim.state).ships[1]!;
    expect(stored.here).toBe(false);
    expect(stored.switchReason).toBe(err().shipNotHere);
    expect(stored.stationName).toBeTruthy();
  });

  it('in flight the whole hangar says why (not docked)', () => {
    const sim = withStoredStarter();
    act(sim, { type: 'undock' });
    const v = hangarView(sim.state);
    expect(v.reason).toBe(err().notDocked);
    expect(v.stationId).toBeNull();
    expect(v.ships[0]).toMatchObject({ active: true, here: false, stationId: null, stationName: null });
    expect(v.ships[1]!.switchReason).toBe(err().notDocked);
    expect(v.ships[1]!.dismantle?.reason).toBe(err().notDocked);
    expect(v.slots.buyReason).toBe(err().notDocked);
    expect(v.newShip).toEqual({ cockpits: [], reason: err().notDocked });
  });

  it('`detail` = false skips the cockpit offers and dismantle quotes (hub overview row)', () => {
    const sim = withStoredStarter();
    stock(sim, { 'cockpit:1': 1 });
    const v = hangarView(sim.state, homeStation(), false);
    expect(v.newShip.cockpits).toEqual([]);
    expect(v.ships[1]!.dismantle).toBeUndefined();
  });
});

describe('hangarView – new ship', () => {
  it('offers a storage cockpit for free and bought / crafted ones at the shipyard price', () => {
    const sim = richSim();
    act(sim, { type: 'hangarBuySlot' });
    stock(sim, { 'cockpit:1': 1 });
    const { cockpits, reason } = hangarView(sim.state).newShip;
    expect(reason).toBeUndefined();
    expect(cockpits[0]).toEqual({ key: 'cockpit:1', source: 'storage', price: 0 });
    const quote = cockpitQuote(sim.state, homeStation(), 'cockpit:1', 'buy');
    expect(typeof quote).toBe('object');
    expect(cockpits).toContainEqual({ key: 'cockpit:1', source: 'buy', acquire: 'buy', price: (quote as { credits: number }).credits });
    // crafting without the materials: offered with its fee and the reason
    expect(cockpits).toContainEqual(expect.objectContaining({ key: 'cockpit:1', source: 'craft', acquire: 'craft', reason: err().notEnoughResources }));
    // every offer that is not from storage carries its acquire mode
    for (const c of cockpits) expect(c.acquire).toBe(c.source === 'storage' ? undefined : c.source);
  });

  it('an offer the player cannot afford keeps its price and says why', () => {
    const sim = richSim();
    act(sim, { type: 'hangarBuySlot' });
    sim.state.credits = 0;
    const paid = hangarView(sim.state).newShip.cockpits.filter((c) => c.source !== 'storage');
    expect(paid.length).toBeGreaterThan(0);
    for (const c of paid) {
      expect(c.price).toBeGreaterThan(0);
      expect([err().notEnoughCredits, err().notEnoughResources]).toContain(c.reason);
    }
  });
});

describe('hangarView – Guild loan note', () => {
  it('loan parts on the active ship: returned; an all-loan hull: dissolved (and needs no slot)', () => {
    const sim = richSim();
    const engine = sim.state.player.grid.parts.find((p) => p.partId === 'engine')!;
    engine.loan = true;
    expect(hangarView(sim.state).ships[0]!.loanNote).toBe('returned');
    for (const p of sim.state.player.grid.parts) p.loan = true;
    const v = hangarView(sim.state);
    expect(v.ships[0]!.loanNote).toBe('dissolved');
    expect(v.newShip.reason).toBeUndefined();
  });
});

describe('shipHeaderView', () => {
  it('name, log line, hangar usable, templates locked until the Archive node', () => {
    const sim = richSim();
    const { state } = sim;
    state.fleet.active.log.distance = 1284;
    let h = shipHeaderView(state);
    expect(h).toMatchObject({ id: 1, generated: true, name: tx().fleet.names[state.fleet.active.nameIdx] });
    expect(h.logLine).toBe(shipLogLine(state.fleet.active.log));
    expect(h.hangarReason).toBeUndefined();
    expect(h.templatesReason).toBe(tx().discovery.archive.lockedPart(tx().discovery.archive.nodes.templates));
    state.discovery.archive.add('templates');
    act(sim, { type: 'hangarRename', shipId: 1, name: 'Moja' });
    h = shipHeaderView(state);
    expect(h.templatesReason).toBeUndefined();
    expect(h).toMatchObject({ name: 'Moja', generated: false });
  });
});

describe('Storages ship rows', () => {
  it('lists the active ship first, then the stored ones with their stations', () => {
    const sim = withStoredStarter();
    const rows = storageShipRows(sim.state);
    expect(rows.map((r) => [r.id, r.active, r.here, r.stationId])).toEqual([
      [2, true, true, HOME_STATION_ID],
      [1, false, true, HOME_STATION_ID],
    ]);
    expect(rows[1]!.hullPoints).toBe(hullBudgetOf(sim.state.fleet.stored[0]!.grid).used);
    expect(storagesData(sim.state).ships).toEqual(rows);
    act(sim, { type: 'undock' });
    expect(storageShipRows(sim.state)[0]).toMatchObject({ active: true, stationId: null, stationName: null, here: false });
  });
});

describe('hangarView – paint chip (M4c)', () => {
  it('every card carries its record\'s paint, factory when the record has none', () => {
    const sim = withStoredStarter();
    const stored = sim.state.fleet.stored[0]!;
    stored.record.paint = 'navy';
    const cards = hangarView(sim.state).ships;
    expect(cards.find((c) => c.active)?.paint).toBe('factory');
    expect(cards.find((c) => c.id === stored.record.id)?.paint).toBe('navy');
  });
});
