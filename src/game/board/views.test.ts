import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND } from '../../sim/commands';
import { dockedSim } from '../../sim/station/testHarness';
import { homeStation } from '../../sim/world/stations';
import type { Simulation } from '../../sim/Simulation';
import { boardData } from './boardView';
import { resumeData } from './resumeView';
import { courierOffer, filterStorageRows, storagesData } from './storagesView';

function sim(): Simulation {
  const s = dockedSim();
  s.step(IDLE_COMMAND);
  return s;
}

describe('boardData', () => {
  it('lists offers with rewards, reputation and sector state', () => {
    const s = sim();
    const d = boardData(s.state, homeStation());
    expect(d.offers.length).toBeGreaterThan(0);
    for (const o of d.offers) {
      expect(o.state).toBe('offer');
      expect(o.reward).toBeGreaterThan(0);
      expect(o.title.length).toBeGreaterThan(0);
      expect(o.emblem).toMatch(/emblems\/(cech|institut)\.svg$/);
      expect(o.accept).toEqual({ enabled: true });
    }
    expect(d.factions.map((f) => f.id)).toEqual(['guild', 'institute']);
    expect(d.factions[0]).toMatchObject({ level: 0, nextPoints: 60, assignment: null });
    expect(d.sector.modifiers).toEqual([]);
    expect(d.captains).toHaveLength(6);
    expect(d.refreshMinutes).toBeGreaterThan(0);
  });

  it('shows an accepted contract with turn-in and cancel state', () => {
    const s = sim();
    const offer = s.state.career.boards.get('home')!.offers[0]!;
    s.step({ ...IDLE_COMMAND, actions: [{ type: 'acceptContract', offerId: offer.id, reqId: 1 }] });
    const d = boardData(s.state, homeStation());
    expect(d.active).toHaveLength(1);
    expect(d.active[0]).toMatchObject({ serial: 1, abandon: { free: true } });
    expect(d.active[0]!.turnIn).toBeDefined();
    expect(d.active[0]!.next).toBeTruthy();
  });
});

describe('resumeData', () => {
  it('describes where the player is and the journal', () => {
    const s = sim();
    s.state.player.cargo.iron = 12;
    s.state.career.log.push({ tick: 0, kind: 'stationDiscovered', station: 'home' });
    const r = resumeData(s.state);
    expect(r.activity[0]).toMatch(/zadokovaný/);
    expect(r.activity.at(-1)).toMatch(/12 Železo/);
    expect(r.journal[0]!.text).toMatch(/Objavená stanica/);
    expect(r.next).not.toBeNull();
  });
});

describe('storagesData', () => {
  it('lists non-empty storages, filters and searches', () => {
    const s = sim();
    s.state.stations.get('home')!.resources.titanium = 40;
    const all = storagesData(s.state);
    expect(all.rows).toHaveLength(1);
    expect(all.rows[0]).toMatchObject({ stationId: 'home', here: true, resources: { titanium: 40 }, parts: { 'armor:1': 2, 'cannon:1': 1 } });
    expect(filterStorageRows(all.rows, { query: 'kanon', ring: null })[0]!.parts).toEqual({ 'cannon:1': 1 });
    expect(filterStorageRows(all.rows, { query: 'titán', ring: null })[0]!.resources).toEqual({ titanium: 40 });
    expect(filterStorageRows(all.rows, { query: 'základňa', ring: null })[0]!.parts).toEqual({ 'armor:1': 2, 'cannon:1': 1 });
    expect(filterStorageRows(all.rows, { query: 'xyz', ring: null })).toEqual([]);
    expect(filterStorageRows(all.rows, { query: '', ring: 2 })).toEqual([]);
    expect(all.courier).toBe(false);
  });

  it('quotes the courier', () => {
    const s = sim();
    const q = courierOffer(s.state, 'home', 'home', { iron: 10 }, {});
    expect(q?.fee).toBeGreaterThanOrEqual(200);
    expect(q?.time).toMatch(/min/);
  });
});
