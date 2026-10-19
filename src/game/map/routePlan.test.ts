import { describe, expect, it } from 'vitest';
import { createStarterShip } from '../../sim/ship/presets';
import { computeProperties } from '../../sim/ship/properties';
import { computeFlight } from '../../sim/ship/control';
import { flightFuel } from '../../sim/ship/fuel';
import { createBody, integrate, MAX_SPEED } from '../../sim/physics/body';
import { SIM_DT } from '../../sim/Simulation';
import { NO_SECURITY_OVERRIDES } from '../../sim/regions/world';
import { sectorIdAt, sectorSecurity } from '../../sim/regions/sectors';
import type { ShipGrid } from '../../sim/ship/types';
import { fuelRange, summarizeShip } from '../partEffect';
import { routeEstimate, routePlan, routeRanges, type RouteShip } from './routePlan';

/** Flies the ship straight along +x like a pilot: full forward until it must brake, then the dampers stop it. */
function simulateFlight(grid: ShipGrid, distance: number, cargoMass = 0): { seconds: number; fuel: number; end: number } {
  const props = computeProperties(grid);
  const mass = props.mass + cargoMass;
  const eff = { ...props, mass, inertia: (props.inertia * mass) / props.mass };
  const brake = (props.thrust.backward > 0 ? props.thrust.backward : props.rcsThrust) / mass;
  let body = createBody({ x: 0, y: 0 }, 0);
  let fuel = 0;
  let steps = 0;
  while (steps < 60 * 3600) {
    const v = body.vel.x;
    const stop = (v * v) / (2 * brake);
    const thrusting = distance - body.pos.x > stop + v * SIM_DT;
    if (!thrusting && v === 0 && steps > 0) break;
    const out = computeFlight(eff, body, { forward: thrusting ? 1 : 0, strafe: 0, turn: 0 }, true, SIM_DT);
    fuel += flightFuel(out, props.fuelUseMult, SIM_DT);
    body = integrate(body, out.force, out.torque, mass, eff.inertia, SIM_DT);
    steps++;
  }
  return { seconds: steps * SIM_DT, fuel, end: body.pos.x };
}

const starter = (): ShipGrid => createStarterShip();
const ship = (grid: ShipGrid): RouteShip => summarizeShip(grid);

describe('routeEstimate', () => {
  it.each([300, 2000, 9000])('matches a simulated straight flight of the starter ship within 10 %% (%i u)', (d) => {
    const sim = simulateFlight(starter(), d);
    expect(sim.end).toBeGreaterThan(d * 0.97);
    const est = routeEstimate(ship(starter()), d)!;
    expect(est.seconds).toBeGreaterThan(sim.seconds * 0.9);
    expect(est.seconds).toBeLessThan(sim.seconds * 1.1);
    expect(est.fuel).toBeGreaterThan(sim.fuel * 0.9);
    expect(est.fuel).toBeLessThan(sim.fuel * 1.1);
  });

  it('cargo mass slows the ship and costs more fuel on a short hop, matching the simulation', () => {
    const empty = routeEstimate(ship(starter()), 600)!;
    const loaded = routeEstimate(ship(starter()), 600, { cargoMass: 40 })!;
    expect(loaded.seconds).toBeGreaterThan(empty.seconds);
    const sim = simulateFlight(starter(), 600, 40);
    expect(loaded.seconds).toBeGreaterThan(sim.seconds * 0.9);
    expect(loaded.seconds).toBeLessThan(sim.seconds * 1.1);
    expect(loaded.fuel).toBeGreaterThan(sim.fuel * 0.9);
    expect(loaded.fuel).toBeLessThan(sim.fuel * 1.1);
  });

  it('brakes with the RCS when there are no reverse engines (slower stop)', () => {
    const s = ship(starter());
    const noReverse: RouteShip = { ...s, thrust: { ...s.thrust, backward: 0 } };
    const a = routeEstimate(s, 3000)!;
    const b = routeEstimate(noReverse, 3000)!;
    expect(b.seconds).toBeGreaterThan(a.seconds);
  });

  it('a short trip never reaches top speed; the sector multiplier scales the fuel', () => {
    const s = ship(starter());
    expect(routeEstimate(s, 50)!.peak).toBeLessThan(MAX_SPEED);
    expect(routeEstimate(s, 5000)!.peak).toBe(MAX_SPEED);
    expect(routeEstimate(s, 5000, { fuelMult: 1.3 })!.fuel).toBeCloseTo(routeEstimate(s, 5000)!.fuel * 1.3, 6);
  });

  it('is null without forward thrust', () => {
    const s = ship(starter());
    expect(routeEstimate({ ...s, thrust: { ...s.thrust, forward: 0 } }, 100)).toBeNull();
  });
});

describe('routeRanges', () => {
  it('one way = fuelRange of the tank (with the cargo), round trip = half', () => {
    const s = summarizeShip(starter());
    const r = routeRanges(s, 80);
    expect(r.oneWay).toBeCloseTo(fuelRange(80, s.thrust.forward, s.mass, s.fuelUseMult)!, 6);
    expect(r.round).toBeCloseTo(r.oneWay / 2, 9);
    expect(routeRanges(s, 80, { cargoMass: 30 }).oneWay).toBeCloseTo(fuelRange(80, s.thrust.forward, s.mass + 30, s.fuelUseMult)!, 6);
    expect(routeRanges(s, 80, { fuelMult: 2 }).oneWay).toBeCloseTo(fuelRange(40, s.thrust.forward, s.mass, s.fuelUseMult)!, 6);
  });
});

describe('routePlan', () => {
  const s = summarizeShip(starter());
  it('says how much fuel is missing when the tank does not reach ("not enough")', () => {
    const far = routePlan({ from: { x: 0, y: 0 }, to: { x: 30000, y: 0 }, label: 'Far', ship: s, fuel: 20 });
    expect(far.short).not.toBeNull();
    expect(far.short!).toBeGreaterThanOrEqual(1);
    expect(far.fuelLeft).toBe(0);
    expect(far.short!).toBe(Math.ceil(far.fuel - 20));
    const near = routePlan({ from: { x: 0, y: 0 }, to: { x: 1000, y: 0 }, label: 'Near', ship: s, fuel: 120 });
    expect(near.short).toBeNull();
    expect(near.fuelLeft).toBeCloseTo(120 - near.fuel, 9);
    expect(near.distance).toBeCloseTo(1000, 9);
    expect(near.label).toBe('Near');
    expect(near.fuelMult).toBeUndefined();
    expect(routePlan({ from: { x: 0, y: 0 }, to: { x: 1000, y: 0 }, label: 'x', ship: s, fuel: 120, options: { fuelMult: 0.7 } }).fuelMult).toBe(0.7);
  });

  it('counts the risky sectors on the way with the current security (unknown ones as unknown)', () => {
    const seed = 7;
    const from = { x: 0, y: 0 };
    const to = { x: 14000, y: 3000 };
    const known = routePlan({
      from,
      to,
      label: 'x',
      ship: s,
      fuel: 120,
      sectors: { seed, overrides: NO_SECURITY_OVERRIDES, knowledge: () => 'charted', coverage: () => null, current: null },
    });
    // the same count by hand
    const ids = new Set<string>();
    const start = sectorIdAt(seed, from.x, from.y);
    let pirate = 0;
    let contested = 0;
    for (let k = 1; k <= 1000; k++) {
      const id = sectorIdAt(seed, (to.x * k) / 1000, (to.y * k) / 1000);
      if (id === start || ids.has(id)) continue;
      ids.add(id);
      const sec = sectorSecurity(seed, id, NO_SECURITY_OVERRIDES);
      if (sec === 'pirate') pirate++;
      if (sec === 'contested') contested++;
    }
    expect(ids.size).toBeGreaterThan(2);
    expect(known.risks).toEqual({ pirate, contested, unknown: 0 });
    const blind = routePlan({
      from,
      to,
      label: 'x',
      ship: s,
      fuel: 120,
      sectors: { seed, overrides: NO_SECURITY_OVERRIDES, knowledge: () => 'uncharted', coverage: () => null, current: null },
    });
    expect(blind.risks).toEqual({ pirate: 0, contested: 0, unknown: ids.size });
  });
});
