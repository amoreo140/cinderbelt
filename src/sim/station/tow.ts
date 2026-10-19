// Towing on an empty tank or without engines (H) – replaces the emergency return from M1.
import { emergencyFuelTarget, towCost } from '../../data/economy';
import { cargoUsed, emptyCargo } from '../../data/resources';
import type { PlayerShip, SimEvent, SimState, Simulation } from '../Simulation';
import { nearestDiscoveredStation, stationById, type StationDef } from '../world/stations';
import { dockPose } from './dock';

export interface TowQuote {
  station: StationDef;
  /** Price of the tow (even if it is not paid). */
  cost: number;
  /** The player does not have enough credits → free, but loses the cargo. */
  free: boolean;
}

/** Where and for how much the ship would be towed – a pure function (also for the HUD). */
export function towQuote(state: SimState): TowQuote {
  const pos = state.player.body.pos;
  const resolve = (id: string) => state.world.stations().find((s) => s.id === id) ?? stationById(state.seed, id);
  // A ship without forward thrust needs new engines: tow it to a shipyard, never to an outpost it
  // could not leave again (bot report F1). Home always has one.
  const needsShipyard = state.player.props.thrust.forward <= 0;
  const accept = needsShipyard ? (s: StationDef) => s.services.shipyard : undefined;
  const station = nearestDiscoveredStation(state.seed, state.world.discovered, pos, resolve, accept);
  const cost = towCost(Math.hypot(station.pos.x - pos.x, station.pos.y - pos.y));
  return { station, cost, free: state.credits < cost };
}

/**
 * The ship cannot fly on, so it may be towed (C2): an empty tank, or no forward thrust
 * (destroyed engines). Thrust only backwards or sideways does not count – such a ship would be dragged
 * along and the shipyard would not let it through as a design anyway (error noForwardEngine). The HUD uses the same condition.
 */
export const towAvailable = (player: Pick<PlayerShip, 'fuel' | 'props'>): boolean =>
  player.fuel <= 0 || player.props.thrust.forward <= 0;

/**
 * Tows the ship to the nearest discovered station. Free without credits, but the player loses the cargo
 * including parts from wrecks aboard (M10 – the same as the death rules).
 */
export function towShip(sim: Simulation): SimEvent[] {
  const { state } = sim;
  const player = state.player;
  const { station, cost, free } = towQuote(state);
  const cargoLost = free && (cargoUsed(player.cargo) > 0 || Object.keys(player.salvage).length > 0);
  const paid = free ? 0 : cost;
  state.credits -= paid;
  if (free) {
    player.cargo = emptyCargo();
    player.salvage = {};
  }

  const pose = dockPose(station, player.props.boundingRadius);
  const discovered = state.world.update(pose.pos);
  const stored = sim.enterDocked(station.id, pose);
  // the Guild tops a broke player's tank up (a quarter, at least one trip's worth); a paid tow is only a tow (saboteur report X7 –
  // otherwise it was a fast travel with free fuel); fuel is bought at the station
  if (free) player.fuel = Math.max(player.fuel, emergencyFuelTarget(player.props.fuelCapacity));

  const events: SimEvent[] = discovered.map((stationId) => ({ type: 'stationDiscovered', stationId }));
  events.push({ type: 'towed', stationId: station.id, cost: paid, cargoLost });
  if (paid > 0) events.push({ type: 'creditsChanged', delta: -paid, reason: 'tow' });
  events.push({ type: 'docked', stationId: station.id }, ...stored);
  return events;
}
