// Trophies (M4c plan §2.3, T1): the derived list, the shelf fill rule and the pins.
import { describe, expect, it } from 'vitest';
import { TROPHY_PEDESTALS } from '../../data/home';
import type { PartKey } from '../../data/parts';
import { IDLE_COMMAND, type GameActionInput } from '../commands';
import { richSim } from '../fleet/testing';
import { fortressStatus } from '../pirates/fortress';
import { fortressSites } from '../pirates/sites';
import type { Simulation } from '../Simulation';
import { act, customStation, dockedAt, expectOk, resultOf } from '../station/testHarness';
import { trophiesOf, trophyShelf } from './index';
import type { TrophyId } from './types';

/** Defeats captains (career.trophies in this order) with the given replicas. */
function defeat(sim: Simulation, captain: number, parts: PartKey[] = []): void {
  sim.state.career.trophies.push({ captain, parts });
}

/** Destroys fortress number `i` of the seed `kills` times. */
function destroyFortress(sim: Simulation, i: number, kills = 1): string {
  const site = fortressSites(sim.state.seed)[i]!;
  sim.state.pirates.fortresses.set(site.id, { ...fortressStatus(sim.state, site.id), destroyed: sim.state.tick, kills });
  return site.id;
}

/** A sim at home with the hall built. */
function withHall(): Simulation {
  const sim = richSim();
  expectOk(act(sim, { type: 'homeBuild', module: 'trophyHall' }));
  return sim;
}

const pin = (id: string, pinned = true): GameActionInput => ({ type: 'trophyPin', id: id as TrophyId, pinned });

function expectRefused(sim: Simulation, a: GameActionInput, reason: string): void {
  const before = structuredClone(sim.state.home);
  const events = act(sim, a);
  expect(resultOf(events), JSON.stringify(a)).toMatchObject({ ok: false, reason });
  expect(events.filter((e) => e.type !== 'actionResult')).toEqual([]);
  expect(sim.state.home).toEqual(before);
}

const pad = (ids: (string | null)[]) => [...ids, ...Array.from({ length: TROPHY_PEDESTALS - ids.length }, () => null)];

describe('trophiesOf', () => {
  it('captains in defeat order with their replicas, then fortresses with kills ≥ 1 once each', () => {
    const sim = richSim();
    expect(trophiesOf(sim.state)).toEqual([]);
    defeat(sim, 7, ['armor:1', 'cannon:2']);
    defeat(sim, 2);
    const f1 = destroyFortress(sim, 1, 2);
    const f0 = destroyFortress(sim, 0, 1);
    // a fortress touched but never destroyed is no trophy
    const f2 = fortressSites(sim.state.seed)[2]!.id;
    sim.state.pirates.fortresses.set(f2, { ...fortressStatus(sim.state, f2), kills: 0 });
    expect(trophiesOf(sim.state)).toEqual([
      { id: 'cap:7', kind: 'captain', captain: 7, fortress: null, replicas: ['armor:1', 'cannon:2'], order: 0 },
      { id: 'cap:2', kind: 'captain', captain: 2, fortress: null, replicas: [], order: 1 },
      { id: f0, kind: 'fortress', captain: null, fortress: f0, replicas: [], order: 2 },
      { id: f1, kind: 'fortress', captain: null, fortress: f1, replicas: [], order: 3 },
    ]);
    expect(f0).toBe('fort:0');
  });

  it('a rebuilt fortress (destroyed again later) stays one trophy', () => {
    const sim = richSim();
    const f = destroyFortress(sim, 0, 1);
    sim.state.pirates.fortresses.set(f, { ...fortressStatus(sim.state, f), destroyed: null, kills: 3 });
    expect(trophiesOf(sim.state).map((t) => t.id)).toEqual([f]);
  });

  it('the trophies exist without the hall (nothing is lost)', () => {
    const sim = richSim();
    defeat(sim, 1);
    expect(trophiesOf(sim.state)).toHaveLength(1);
    expect(trophyShelf(sim.state)).toEqual(pad(['cap:1']));
  });
});

describe('trophyShelf', () => {
  it('fills with the newest captains first, then fortresses, then null', () => {
    const sim = richSim();
    expect(trophyShelf(sim.state)).toEqual(pad([]));
    defeat(sim, 4);
    defeat(sim, 9);
    defeat(sim, 1);
    const f0 = destroyFortress(sim, 0);
    expect(trophyShelf(sim.state)).toEqual(pad(['cap:1', 'cap:9', 'cap:4', f0]));
  });

  it('pins come first in pin order; more trophies than pedestals drop the oldest unpinned', () => {
    const sim = withHall();
    for (let c = 0; c < 6; c++) defeat(sim, c);
    const f0 = destroyFortress(sim, 0);
    const f1 = destroyFortress(sim, 1);
    expect(trophyShelf(sim.state)).toEqual(['cap:5', 'cap:4', 'cap:3', 'cap:2', 'cap:1', 'cap:0']);
    expectOk(act(sim, pin(f1)));
    expectOk(act(sim, pin('cap:0')));
    expect(trophyShelf(sim.state)).toEqual([f1, 'cap:0', 'cap:5', 'cap:4', 'cap:3', 'cap:2']);
    expect(trophyShelf(sim.state)).not.toContain(f0);
  });

  it('is pure and deterministic', () => {
    const build = () => {
      const sim = withHall();
      for (const c of [3, 8, 1]) defeat(sim, c);
      destroyFortress(sim, 2);
      act(sim, pin('cap:8'));
      return sim;
    };
    const a = build();
    const home = structuredClone(a.state.home);
    expect(trophyShelf(a.state)).toEqual(trophyShelf(a.state));
    expect(a.state.home).toEqual(home);
    expect(trophyShelf(build().state)).toEqual(trophyShelf(a.state));
  });
});

describe('trophyPin', () => {
  it('pins and unpins with an event', () => {
    const sim = withHall();
    defeat(sim, 3);
    let events = act(sim, pin('cap:3'));
    expectOk(events);
    expect(events).toContainEqual({ type: 'trophyPinned', id: 'cap:3', pinned: true });
    expect(sim.state.home.trophyPins).toEqual(['cap:3']);
    // pinning again changes nothing
    events = act(sim, pin('cap:3'));
    expectOk(events);
    expect(events.filter((e) => e.type === 'trophyPinned')).toEqual([]);
    expect(sim.state.home.trophyPins).toEqual(['cap:3']);
    events = act(sim, pin('cap:3', false));
    expectOk(events);
    expect(events).toContainEqual({ type: 'trophyPinned', id: 'cap:3', pinned: false });
    expect(sim.state.home.trophyPins).toEqual([]);
    expectOk(act(sim, pin('cap:3', false)));
  });

  it('refuses a 7th pin (shelfFull)', () => {
    const sim = withHall();
    for (let c = 0; c < 7; c++) defeat(sim, c);
    for (let c = 0; c < 6; c++) expectOk(act(sim, pin(`cap:${c}`)));
    expectRefused(sim, pin('cap:6'), 'shelfFull');
    expectOk(act(sim, pin('cap:2', false)));
    expectOk(act(sim, pin('cap:6')));
    expect(sim.state.home.trophyPins).toEqual(['cap:0', 'cap:1', 'cap:3', 'cap:4', 'cap:5', 'cap:6']);
  });

  it('refuses unknown trophies: never defeated, a fortress never destroyed, malformed ids', () => {
    const sim = withHall();
    defeat(sim, 3);
    for (const id of ['cap:4', 'fort:0', 'fort:99', 'cap:x', 'cap:03', '', 'hangar']) expectRefused(sim, pin(id), 'unknownTrophy');
    expectRefused(sim, pin('cap:4', false), 'unknownTrophy');
  });

  it('needs the trophy hall, and the player docked at home', () => {
    const sim = richSim();
    defeat(sim, 3);
    expectRefused(sim, pin('cap:3'), 'noTrophyHall');
    const hall = withHall();
    defeat(hall, 3);
    act(hall, { type: 'undock' });
    expectRefused(hall, pin('cap:3'), 'notHome');
    const away = dockedAt(customStation({ id: 'st:0,0', kind: 'station' }));
    away.state.home.modules.add('trophyHall');
    defeat(away, 3);
    away.step(IDLE_COMMAND);
    expectRefused(away, pin('cap:3'), 'notHome');
  });

  it('the same commands give the same pins', () => {
    const run = () => {
      const sim = withHall();
      for (let c = 0; c < 4; c++) defeat(sim, c);
      for (const a of [pin('cap:2'), pin('cap:0'), pin('cap:2', false), pin('cap:3'), pin('cap:2')]) act(sim, a);
      return { pins: [...sim.state.home.trophyPins], shelf: trophyShelf(sim.state) };
    };
    expect(run()).toEqual(run());
    expect(run().pins).toEqual(['cap:0', 'cap:3', 'cap:2']);
  });
});
