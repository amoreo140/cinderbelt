// The map's route planner (M4d "Route planner", S1): a straight line from the ship to a point
// the player picked (right-click, "Route here"). For the current ship with its cargo: distance, flight
// time and fuel (run-up to top speed, cruise with the engines burning as in the simulation, braking with
// the reverse engines or the cockpit RCS – `travelFuel`, shared with `fuelRange`), the fuel left or
// missing on arrival, the risky sectors on the way (the sector card's `sectorsAlong` / `routeSummary`
// with the current security) and the range circles (one way = `fuelRange`, round trip = half).
// Pure; the game layer (T9) keeps the picked target and calls `routePlan` for the map's data.
import { fuelRange, travelFuel, type ShipSummary } from '../partEffect';
import { ASSISTED_SPEED } from '../../sim/ship/control';
import { FUEL_PER_FORCE_SECOND } from '../../sim/ship/fuel';
import type { Vec2 } from '../../sim/math/vec2';
import type { Knowledge } from '../../sim/regions/constants';
import { sectorIdAt, sectorSecurity } from '../../sim/regions/sectors';
import type { SecurityOverrides } from '../../sim/regions/world';
import { routeSummary, sectorKnown, sectorsAlong } from '../../ui/sectors/sectorCardData';
import type { RoutePlanData } from './types';

/** What the estimate needs of the ship (sums from `summarizeShip`). */
export type RouteShip = Pick<ShipSummary, 'mass' | 'thrust' | 'rcs' | 'fuelUseMult'>;

export interface RouteOptions {
  /** Mass of the cargo in the hold (`cargoMass`) – a full hold flies slower. */
  cargoMass?: number;
  /** The local condition fuel multiplier of the ship's sector (`sectorEffects(…).fuelUseMult`). */
  fuelMult?: number;
}

export interface RouteEstimate {
  /** Flight time (s) from rest to a stop at the target. */
  seconds: number;
  /** Fuel the flight burns. */
  fuel: number;
  /** The highest speed on the way (u/s): ASSISTED_SPEED unless the trip is too short to reach it. */
  peak: number;
}

/**
 * Time and fuel of a straight flight of `distance` from rest to a stop: full forward thrust up to the
 * assisted cruise cap (dampers on; the engines idle at the cap, so fuel burns only in the run-up), then braking with the
 * reverse engines – or the cockpit RCS on a ship without them (the dampers' rule, control.ts). A trip
 * too short for top speed accelerates and brakes at once. Null when the ship has no forward thrust.
 */
export function routeEstimate(ship: RouteShip, distance: number, options: RouteOptions = {}): RouteEstimate | null {
  const mass = ship.mass + (options.cargoMass ?? 0);
  const mult = options.fuelMult ?? 1;
  const travel = travelFuel(ship.thrust.forward, mass, ship.fuelUseMult, ASSISTED_SPEED);
  if (!travel) return null;
  const d = Math.max(0, distance);
  // braking: reverse engines at the engines' fuel rate, else the RCS at the base rate (fuel.ts)
  const reverse = ship.thrust.backward > 0;
  const brakeForce = reverse ? ship.thrust.backward : ship.rcs;
  const brake = brakeForce > 0 ? brakeForce / mass : 0;
  const brakeFuelMult = reverse ? ship.fuelUseMult : 1;
  // stopping from speed v burns force · time = mass · v (at FUEL_PER_FORCE_SECOND per force-second)
  const brakeFuel = (v: number) => mass * v * FUEL_PER_FORCE_SECOND * brakeFuelMult;
  if (brake <= 0) {
    // nothing brakes: the ship arrives at speed
    const t = travel.seconds(d);
    return { seconds: t, fuel: Math.min(t, travel.runUp) * travel.fuelPerSecond * mult, peak: Math.min(ASSISTED_SPEED, travel.accel * t) };
  }
  const a = travel.accel;
  const runUpDistance = travel.distance(travel.runUp);
  const brakeDistance = (ASSISTED_SPEED * ASSISTED_SPEED) / (2 * brake);
  if (d < runUpDistance + brakeDistance) {
    // a triangle: accelerate to `peak`, brake from it at once
    const peak = Math.sqrt((2 * d * a * brake) / (a + brake));
    const up = peak / a;
    return { seconds: up + peak / brake, fuel: (up * travel.fuelPerSecond + brakeFuel(peak)) * mult, peak };
  }
  const thrust = travel.seconds(d - brakeDistance);
  return { seconds: thrust + ASSISTED_SPEED / brake, fuel: (Math.min(thrust, travel.runUp) * travel.fuelPerSecond + brakeFuel(ASSISTED_SPEED)) * mult, peak: ASSISTED_SPEED };
}

/**
 * The range circles around the ship (§2.8): one way = `fuelRange` of the fuel in the tank with the
 * current cargo and the sector's fuel multiplier (dashed), round trip = half of it (solid).
 */
export function routeRanges(ship: RouteShip, fuel: number, options: RouteOptions = {}): { oneWay: number; round: number } {
  const mult = options.fuelMult ?? 1;
  const oneWay = fuelRange(Math.max(0, fuel) / (mult > 0 ? mult : 1), ship.thrust.forward, ship.mass + (options.cargoMass ?? 0), ship.fuelUseMult) ?? 0;
  return { oneWay, round: oneWay / 2 };
}

/** What the map knows about sectors (like `SectorCardInput`) for the route's risk chips. */
export interface RouteSectors {
  seed: number;
  /** Current security (`securityOverrides(state)`, T1). */
  overrides: SecurityOverrides;
  knowledge: (id: string) => Knowledge;
  coverage: (id: string) => number | null;
  /** The ship's sector. */
  current: string | null;
}

export interface RoutePlanInput {
  from: Vec2;
  to: Vec2;
  label: string;
  ship: RouteShip;
  /** Fuel in the tank. */
  fuel: number;
  options?: RouteOptions;
  /** Sector knowledge for the risk chips; absent = no chips (all zero). */
  sectors?: RouteSectors | null;
}

/** The planned route as the map draws it (`RoutePlanData`). */
export function routePlan(input: RoutePlanInput): RoutePlanData {
  const { from, to, ship, fuel } = input;
  const options = input.options ?? {};
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const est = routeEstimate(ship, distance, options);
  const need = est?.fuel ?? Infinity;
  const left = fuel - need;
  const ranges = routeRanges(ship, fuel, options);
  const sec = input.sectors;
  const risks = sec
    ? routeSummary(sectorsAlong((x, y) => sectorIdAt(sec.seed, x, y), from, to), distance, (id) =>
        sectorKnown(id, sec.knowledge(id), sec.coverage(id), sec.current) ? sectorSecurity(sec.seed, id, sec.overrides) : null,
      ).risks
    : { pirate: 0, contested: 0, unknown: 0 };
  return {
    to: { x: to.x, y: to.y },
    label: input.label,
    distance,
    seconds: est?.seconds ?? Infinity,
    fuel: need,
    fuelLeft: Math.max(0, left),
    // missing fuel in whole units (the panel says "short 14")
    short: left < 0 ? Math.max(1, Math.ceil(-left - 1e-9)) : null,
    risks,
    rangeOneWay: ranges.oneWay,
    rangeRound: ranges.round,
    ...(options.fuelMult !== undefined && options.fuelMult !== 1 ? { fuelMult: options.fuelMult } : {}),
  };
}
