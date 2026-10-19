// Ship paints (M4c plan §2.2, T1): where a ship can be painted, the record keeps its paint through
// switch, store and death, and a dismantled ship takes its paint with it.
import { describe, expect, it } from 'vitest';
import { PAINT_IDS, type PaintId } from '../../data/paints';
import { IDLE_COMMAND, type GameActionInput } from '../commands';
import { applyDeath } from '../death/death';
import { shipRecord } from '../fleet/actions';
import { createFleet, paintOf } from '../fleet/state';
import { fleetSnapshot, parkForNewShip, richSim } from '../fleet/testing';
import type { Simulation } from '../Simulation';
import { act, customStation, dockedAt, expectOk, resultOf } from '../station/testHarness';
import { HOME_STATION_ID } from '../world/stations';

/** A sim docked at home with the paint shop built. */
function withShop(): Simulation {
  const sim = richSim();
  expectOk(act(sim, { type: 'homeBuild', module: 'paintShop' }));
  return sim;
}

/** The action is refused with `reason` and changes nothing (fleet, credits, home). */
function expectRefused(sim: Simulation, a: GameActionInput, reason: string): void {
  const before = structuredClone({ fleet: fleetSnapshot(sim.state), home: sim.state.home });
  const events = act(sim, a);
  expect(resultOf(events), JSON.stringify(a)).toMatchObject({ ok: false, reason });
  expect(events.filter((e) => e.type !== 'actionResult')).toEqual([]);
  expect({ fleet: fleetSnapshot(sim.state), home: sim.state.home }).toEqual(before);
}

const paint = (shipId: number, p: PaintId): GameActionInput => ({ type: 'paintShip', shipId, paint: p });

describe('paintOf', () => {
  it('a record without a paint is factory; new games and new ships start factory', () => {
    expect(paintOf(createFleet(5).active)).toBe('factory');
    const sim = richSim();
    parkForNewShip(sim);
    expect(sim.state.fleet.active.id).toBe(2);
    expect(paintOf(sim.state.fleet.active)).toBe('factory');
    expect(sim.state.fleet.active).not.toHaveProperty('paint');
  });
});

describe('paintShip', () => {
  it('paints the active ship docked at home – free, with an event', () => {
    const sim = withShop();
    const credits = sim.state.credits;
    const events = act(sim, paint(1, 'navy'));
    expectOk(events);
    expect(events).toContainEqual({ type: 'shipPainted', shipId: 1, paint: 'navy' });
    expect(events.some((e) => e.type === 'creditsChanged')).toBe(false);
    expect(sim.state.credits).toBe(credits);
    expect(paintOf(sim.state.fleet.active)).toBe('navy');
    for (const p of PAINT_IDS.filter((x) => x !== 'navy')) {
      expectOk(act(sim, paint(1, p)));
      expect(paintOf(sim.state.fleet.active)).toBe(p);
    }
  });

  it('painting back to factory removes the field (one canonical form)', () => {
    const sim = withShop();
    act(sim, paint(1, 'racing'));
    expect(sim.state.fleet.active.paint).toBe('racing');
    expectOk(act(sim, paint(1, 'factory')));
    expect(sim.state.fleet.active).not.toHaveProperty('paint');
  });

  it('needs the paint shop', () => {
    const sim = richSim();
    expectRefused(sim, paint(1, 'navy'), 'noPaintShop');
  });

  it('refuses the active ship in flight and docked at another station', () => {
    const flying = withShop();
    act(flying, { type: 'undock' });
    expectRefused(flying, paint(1, 'navy'), 'shipNotHome');
    const away = dockedAt(customStation({ id: 'st:0,0', kind: 'station' }));
    away.state.home.modules.add('paintShop');
    away.step(IDLE_COMMAND); // settle the first docked step (it records the ship's capability)
    expectRefused(away, paint(1, 'navy'), 'shipNotHome');
  });

  it('paints a ship stored at home; refuses one stored elsewhere and one at home while the player is away', () => {
    const sim = withShop();
    parkForNewShip(sim);
    expect(sim.state.fleet.stored.map((s) => [s.record.id, s.stationId])).toEqual([[1, HOME_STATION_ID]]);
    const events = act(sim, paint(1, 'sand'));
    expectOk(events);
    expect(events).toContainEqual({ type: 'shipPainted', shipId: 1, paint: 'sand' });
    expect(paintOf(sim.state.fleet.stored[0]!.record)).toBe('sand');
    expect(paintOf(sim.state.fleet.active)).toBe('factory');

    sim.state.fleet.stored[0]!.stationId = 'st:3,4';
    expectRefused(sim, paint(1, 'navy'), 'shipNotHome');
    sim.state.fleet.stored[0]!.stationId = HOME_STATION_ID;

    act(sim, { type: 'undock' });
    expectRefused(sim, paint(1, 'navy'), 'notHome');
  });

  it('refuses an unknown ship and the same paint', () => {
    const sim = withShop();
    expectRefused(sim, paint(9, 'navy'), 'unknownShip');
    expectRefused(sim, paint(1, 'factory'), 'samePaint');
    act(sim, paint(1, 'graphite'));
    expectRefused(sim, paint(1, 'graphite'), 'samePaint');
  });

  it('refuses an unknown paint id', () => {
    const sim = withShop();
    const events = act(sim, paint(1, 'gold' as PaintId));
    expect(resultOf(events)).toMatchObject({ ok: false });
    expect(paintOf(sim.state.fleet.active)).toBe('factory');
  });
});

describe('the paint belongs to the ship record', () => {
  it('survives switch → store → switch back', () => {
    const sim = withShop();
    act(sim, paint(1, 'navy'));
    parkForNewShip(sim);
    act(sim, paint(2, 'racing'));
    expect(paintOf(shipRecord(sim.state, 1)!)).toBe('navy');
    expect(paintOf(sim.state.fleet.active)).toBe('racing');
    expectOk(act(sim, { type: 'hangarSwitch', shipId: 1 }));
    expect(sim.state.fleet.active.id).toBe(1);
    expect(paintOf(sim.state.fleet.active)).toBe('navy');
    expect(paintOf(shipRecord(sim.state, 2)!)).toBe('racing');
    expectOk(act(sim, { type: 'hangarSwitch', shipId: 2 }));
    expect(paintOf(sim.state.fleet.active)).toBe('racing');
    expect(paintOf(shipRecord(sim.state, 1)!)).toBe('navy');
  });

  it('survives death and respawn', () => {
    const sim = withShop();
    act(sim, paint(1, 'sand'));
    act(sim, { type: 'undock' });
    sim.step(IDLE_COMMAND);
    sim.state.player.destroyed = true;
    applyDeath(sim);
    sim.step(IDLE_COMMAND);
    expect(sim.state.fleet.active).toMatchObject({ id: 1, paint: 'sand', log: { deaths: 1 } });
  });

  it('a dismantled ship takes its record (and paint) with it', () => {
    const sim = withShop();
    act(sim, paint(1, 'graphite'));
    parkForNewShip(sim);
    expectOk(act(sim, { type: 'hangarDismantle', shipId: 1 }));
    expect(shipRecord(sim.state, 1)).toBeNull();
    expect(sim.state.fleet.stored).toEqual([]);
    expect(paintOf(sim.state.fleet.active)).toBe('factory');
    expectRefused(sim, paint(1, 'navy'), 'unknownShip');
  });
});

describe('determinism', () => {
  it('the same commands give the same fleet', () => {
    const run = () => {
      const sim = withShop();
      act(sim, paint(1, 'navy'));
      parkForNewShip(sim);
      act(sim, paint(2, 'racing'));
      act(sim, paint(1, 'factory'));
      act(sim, paint(2, 'racing'));
      for (let i = 0; i < 10; i++) sim.step(IDLE_COMMAND);
      return fleetSnapshot(sim.state);
    };
    expect(run()).toEqual(run());
  });
});
