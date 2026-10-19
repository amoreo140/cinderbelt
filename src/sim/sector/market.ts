// The effect of the sector state on the station market: "Demand for X" (buy-back +45% up to a cap of 150 u per period)
// and "Fuel shortage" (fuel ×1.5). The core of the prices stays fixed.
import { DEMAND_BONUS, DEMAND_CAP } from '../../data/sector';
import { fuelUnitPrice, saleValue } from '../../data/economy';
import type { ResourceId } from '../../data/resources';
import type { SimState } from '../Simulation';
import type { StationDef } from '../world/stations';
import { demandOf, sectorAt, sectorEffects, sectorEpoch } from './sector';

export interface DemandInfo {
  resource: ResourceId;
  /** How much more the station will still buy back at the surcharge in this period. */
  left: number;
}

/** The station's demand in the current period, or null. */
export function stationDemand(state: SimState, station: StationDef): DemandInfo | null {
  const resource = demandOf(sectorAt(state.seed, station.pos, state.tick));
  if (!resource) return null;
  const sold = state.career.demandSold.get(station.id);
  const used = sold && sold.epoch === sectorEpoch(state.tick) ? sold.amount : 0;
  return { resource, left: Math.max(0, DEMAND_CAP - used) };
}

/** The sum for a sale with the demand surcharge for the part up to the cap; `demand` = how much counts towards the cap. */
export function demandSale(state: SimState, station: StationDef, resource: ResourceId, amount: number, unitSell: number): { value: number; demand: number } {
  const info = stationDemand(state, station);
  const demand = info && info.resource === resource ? Math.min(amount, info.left) : 0;
  if (demand <= 0) return { value: saleValue(amount, unitSell), demand: 0 };
  return { value: saleValue(demand, unitSell * (1 + DEMAND_BONUS)) + saleValue(amount - demand, unitSell), demand };
}

/** Records a sale within the demand (after a successful action). */
export function recordDemand(state: SimState, station: StationDef, demand: number): void {
  if (demand <= 0) return;
  const epoch = sectorEpoch(state.tick);
  const sold = state.career.demandSold.get(station.id);
  const before = sold && sold.epoch === epoch ? sold.amount : 0;
  state.career.demandSold.set(station.id, { epoch, amount: before + demand });
}

/** Price of a unit of fuel at the station (ring × sector state). */
export function stationFuelPrice(state: SimState, station: StationDef): number {
  return fuelUnitPrice(station.ring) * sectorEffects(sectorAt(state.seed, station.pos, state.tick)).fuelPriceMult;
}
