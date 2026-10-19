import { describe, expect, it } from 'vitest';
import { repairCost } from '../../data/economy';
import type { Simulation } from '../Simulation';
import { HOME_STATION_ID, homeStation } from '../world/stations';
import { stationStorage } from './actions';
import type { PartId } from '../../data/parts';
import { createGrid } from '../ship/grid';
import { maxHp } from '../ship/hp';
import { createStarterShip } from '../ship/presets';
import type { Rotation } from '../ship/types';
import { repairQuote } from './repair';
import { act, customStation, dockedAt, dockedSim, expectFailure, expectOk } from './testHarness';

const storage = (sim: Simulation) => stationStorage(sim.state, HOME_STATION_ID);

describe('repairCost (6.5)', () => {
  it('engine T1 at 40 % HP costs 72 credits and 4 iron', () => {
    expect(repairCost('engine:1', 10, 25, 1)).toEqual({ credits: 72, material: 'iron', amount: 4 });
  });

  it('scales with the ring service multiplier and uses titanium for T2', () => {
    expect(repairCost('engine:1', 10, 25, 2).credits).toBe(Math.ceil(0.6 * 800 * 0.15 * 1.1));
    expect(repairCost('engine:2', 22, 44, 1)).toEqual({ credits: Math.ceil(0.5 * 1900 * 0.15), material: 'titanium', amount: 3 });
  });

  it('is free at full HP', () => {
    expect(repairCost('cockpit:1', 60, 60, 1)).toEqual({ credits: 0, material: 'iron', amount: 0 });
  });
});

describe('repair action', () => {
  function damaged(): Simulation {
    const sim = dockedSim();
    sim.state.credits = 1000;
    sim.state.player.hp.set(11, 10); // engine T1 40 % → 72 cr + 4 Fe
    sim.state.player.hp.set(1, 48); // cockpit 80 % → ceil(0.2 × 2500 × 0.15) = 75 cr + ceil(0.2 × 0.25 × 50) = 3 Fe
    return sim;
  }

  it('quotes every damaged part and the total', () => {
    const sim = damaged();
    storage(sim).resources.iron = 2;
    sim.state.player.cargo.iron = 3;
    const q = repairQuote(sim.state, homeStation(), 'all', true);
    expect(q.lines.map((l) => [l.id, l.key, l.credits, l.amount])).toEqual([
      [1, 'cockpit:1', 75, 3],
      [11, 'engine:1', 72, 4],
    ]);
    expect(q.credits).toBe(147);
    expect(q.materials).toEqual({ iron: 7 });
    expect(q.missing).toEqual({ iron: 2 });
    // 2 Fe at 5.0 cr
    expect(q.autoBuyCredits).toBe(10);
    expect(q.total).toBe(157);
    expect(q.ok).toBe(true);
    expect(q.hull).toEqual({ current: 390 - 15 - 12, max: 390 });
  });

  it('repairs all parts, materials from the storage first, then the cargo', () => {
    const sim = damaged();
    storage(sim).resources.iron = 5;
    sim.state.player.cargo.iron = 10;
    const events = act(sim, { type: 'repair', partIds: 'all', autoBuy: false });
    expectOk(events);
    expect(events).toContainEqual({ type: 'creditsChanged', delta: -147, reason: 'repair' });
    expect(sim.state.player.hp.size).toBe(0);
    expect(storage(sim).resources.iron).toBe(0);
    expect(sim.state.player.cargo.iron).toBe(8);
    expect(sim.state.credits).toBe(853);
  });

  it('repairs selected parts only', () => {
    const sim = damaged();
    storage(sim).resources.iron = 10;
    expectOk(act(sim, { type: 'repair', partIds: [11], autoBuy: false }));
    expect([...sim.state.player.hp]).toEqual([[1, 48]]);
    expect(sim.state.credits).toBe(928);
  });

  it('buys the missing material at the station price when allowed', () => {
    const sim = damaged();
    expectOk(act(sim, { type: 'repair', partIds: 'all', autoBuy: true }));
    // 7 Fe × 5.0 cr = 35 cr
    expect(sim.state.credits).toBe(1000 - 147 - 35);
    expect(sim.state.player.hp.size).toBe(0);
  });

  it('reports repair errors without changes', () => {
    const sim = damaged();
    expectFailure(sim, { type: 'repair', partIds: 'all', autoBuy: false }, 'notEnoughResources');
    expectFailure(sim, { type: 'repair', partIds: [99], autoBuy: true }, 'invalidQuantity');
    expectFailure(sim, { type: 'repair', partIds: [2], autoBuy: true }, 'nothingToRepair');
    expectFailure(sim, { type: 'repair', partIds: [], autoBuy: true }, 'nothingToRepair');
    sim.state.credits = 150;
    expectFailure(sim, { type: 'repair', partIds: 'all', autoBuy: true }, 'notEnoughCredits');
    const ok = dockedSim();
    expectFailure(ok, { type: 'repair', partIds: 'all', autoBuy: true }, 'nothingToRepair');
    const noRepair = dockedAt(customStation({ services: { ...homeStation().services, repair: false } }));
    noRepair.state.player.hp.set(1, 10);
    expectFailure(noRepair, { type: 'repair', partIds: 'all', autoBuy: true }, 'serviceUnavailable');
  });
});

describe('debugDamage', () => {
  it('sets the HP of a mounted part', () => {
    const sim = dockedSim();
    expectOk(act(sim, { type: 'debugDamage', partId: 11, hp: 10 }));
    expect(sim.state.player.hp.get(11)).toBe(10);
    expectOk(act(sim, { type: 'debugDamage', partId: 11, hp: 25 }));
    expect(sim.state.player.hp.has(11)).toBe(false);
  });

  it('rejects unknown parts and impossible HP', () => {
    const sim = dockedSim();
    expectFailure(sim, { type: 'debugDamage', partId: 99, hp: 1 }, 'invalidQuantity');
    expectFailure(sim, { type: 'debugDamage', partId: 11, hp: 0 }, 'invalidQuantity');
    expectFailure(sim, { type: 'debugDamage', partId: 11, hp: 26 }, 'invalidQuantity');
    expectFailure(sim, { type: 'debugDamage', partId: 11, hp: Number.NaN }, 'invalidQuantity');
  });
});

describe('repair of shaped armour (SL2 E2 §2.3)', () => {
  /** The starter ship plus a T1 wedge (id 15) and a full T1 plate (id 16). */
  function withPlates(): Simulation {
    const starter = createStarterShip();
    const grid = createGrid([
      ...starter.parts.map((p): [PartId, number, number, Rotation] => [p.partId, p.x, p.y, p.rot]),
      ['armor', 1, 2, 0, 1, 'wedge'],
      ['armor', 1, -2, 0, 1],
    ]);
    const sim = dockedSim(grid);
    sim.state.credits = 1000;
    storage(sim).resources.iron = 10;
    return sim;
  }

  it('a wedge at 10 / 20 HP repairs for exactly the price of 10 HP of a full plate', () => {
    const sim = withPlates();
    const wedge = sim.state.player.grid.parts.find((p) => p.id === 15)!;
    expect(wedge.shape).toBe('wedge');
    expect(maxHp(wedge)).toBe(20);
    sim.state.player.hp.set(15, 10);
    sim.state.player.hp.set(16, 30);
    const q = repairQuote(sim.state, homeStation(), 'all', false);
    // both miss 10 HP of a 40 HP plate: ceil(0.25 × 200 × 0.15) = 8 cr, ceil(0.25 × 0.25 × 15) = 1 Fe
    expect(q.lines.map((l) => [l.id, l.hp, l.maxHp, l.credits, l.amount])).toEqual([
      [15, 10, 20, 8, 1],
      [16, 30, 40, 8, 1],
    ]);
    expectOk(act(sim, { type: 'repair', partIds: 'all', autoBuy: false }));
    expect(sim.state.player.hp.size).toBe(0);
    expect(sim.state.credits).toBe(1000 - 16);
    expect(storage(sim).resources.iron).toBe(8);
  });

  it('a full plate costs what it did before shapes', () => {
    const sim = withPlates();
    sim.state.player.hp.set(16, 10);
    expect(repairQuote(sim.state, homeStation(), [16], false).lines[0]).toMatchObject({ credits: 23, amount: 3 });
  });
});
