import { describe, expect, it } from 'vitest';
import { DEMAND_BONUS, DEMAND_CAP, SECTOR_EPOCH_TICKS, type SectorModifierId } from '../../data/sector';
import { fuelUnitPrice, resourcePrice, saleValue } from '../../data/economy';
import { IDLE_COMMAND } from '../commands';
import { act, dockedSim, expectOk } from '../station/testHarness';
import { createStarterShip } from '../ship/presets';
import { Simulation } from '../Simulation';
import { homeOnly } from '../station/testHarness';
import { sectorState } from './sector';
import { sectorIdAt } from '../regions/sectors';
import { stationDemand, stationFuelPrice } from './market';
import { homeStation } from '../world/stations';

/** The first epoch in which the home sector (seed 1) has the modifier. */
function epochWith(id: SectorModifierId, seed = 1): number {
  for (let e = 1; e < 5000; e++) if (sectorState(seed, sectorIdAt(seed, 0, 0), e).modifiers.some((m) => m.id === id)) return e;
  throw new Error(`no ${id}`);
}

describe('demand', () => {
  it('pays +45 % for the demanded resource up to the cap', () => {
    const sim = dockedSim();
    const epoch = epochWith('demand');
    sim.state.tick = epoch * SECTOR_EPOCH_TICKS + 10;
    const info = stationDemand(sim.state, homeStation())!;
    expect(info.left).toBe(DEMAND_CAP);
    const r = info.resource;
    const unit = resourcePrice(r, 1, 1).sell;
    sim.state.player.cargo[r] = 100;
    const before = sim.state.credits;
    expectOk(act(sim, { type: 'sellResource', resource: r, qty: 100, from: 'ship' }));
    expect(sim.state.credits - before).toBe(saleValue(100, unit * (1 + DEMAND_BONUS)));
    expect(stationDemand(sim.state, homeStation())!.left).toBe(DEMAND_CAP - 100);
    sim.state.player.cargo[r] = 100;
    const mid = sim.state.credits;
    act(sim, { type: 'sellResource', resource: r, qty: 100, from: 'ship' });
    expect(sim.state.credits - mid).toBe(saleValue(50, unit * (1 + DEMAND_BONUS)) + saleValue(50, unit));
    expect(stationDemand(sim.state, homeStation())!.left).toBe(0);
  });

  it('has no demand in the calm first half hour', () => {
    expect(stationDemand(dockedSim().state, homeStation())).toBeNull();
  });
});

describe('fuel shortage', () => {
  it('raises the fuel price of the area by half', () => {
    const sim = dockedSim();
    expect(stationFuelPrice(sim.state, homeStation())).toBe(fuelUnitPrice(1));
    sim.state.tick = epochWith('fuelShortage') * SECTOR_EPOCH_TICKS;
    expect(stationFuelPrice(sim.state, homeStation())).toBeCloseTo(fuelUnitPrice(1) * 1.5);
    sim.state.player.fuel = 0;
    sim.state.credits = 1000;
    const before = sim.state.credits;
    expectOk(act(sim, { type: 'refuel', source: 'credits', amount: 10 }));
    expect(before - sim.state.credits).toBe(Math.ceil(10 * fuelUnitPrice(1) * 1.5 - 1e-9));
  });
});

describe('sector effects in flight', () => {
  const flying = (tick: number) => {
    const sim = new Simulation({ seed: 1, generator: homeOnly, startDocked: false, grid: createStarterShip() });
    sim.state.player.body = { pos: { x: 100, y: 100 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    sim.state.tick = tick;
    return sim;
  };

  it('currents push the ship without dampers', () => {
    const tick = epochWith('currents') * SECTOR_EPOCH_TICKS;
    const sim = flying(tick);
    sim.state.player.dampers = false;
    for (let i = 0; i < 60; i++) sim.step(IDLE_COMMAND);
    expect(Math.hypot(sim.state.player.body.vel.x, sim.state.player.body.vel.y)).toBeGreaterThan(0.3);
    const calm = flying(0);
    calm.state.player.dampers = false;
    for (let i = 0; i < 60; i++) calm.step(IDLE_COMMAND);
    expect(Math.hypot(calm.state.player.body.vel.x, calm.state.player.body.vel.y)).toBe(0);
  });

  it('the ion season (more ion storms, M3.5b) never comes to the home sector (depth 1)', () => {
    for (let e = 1; e < 500; e++) expect(sectorState(1, sectorIdAt(1, 0, 0), e).modifiers.some((m) => m.id === 'ionSeason')).toBe(false);
  }, 15_000);
});
