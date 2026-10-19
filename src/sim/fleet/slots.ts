// Hangar slots (M4a plan §2): bought at a station with a shipyard, priced by the slots bought in the
// whole game (HANGAR.slotPrices), capped at 2 (4 with the Archive node "Hangar +2"), never refunded.
import type { SimEvent, SimState } from '../Simulation';
import type { ActionError } from '../station/actions';
import type { StationDef } from '../world/stations';
import { nextSlotPrice, slotsAt, slotsBought } from './state';

/** Why a slot cannot be bought now (the hangar guards are the caller's), or null. */
export function buySlotError(state: SimState): ActionError | null {
  const price = nextSlotPrice(state);
  if (price === null) return 'slotCap';
  if (state.credits < price) return 'notEnoughCredits';
  return null;
}

/** Buys the next slot at `station` (checked by `buySlotError` first). */
export function buySlot(state: SimState, station: StationDef, reqId: number): SimEvent[] {
  const error = buySlotError(state);
  if (error) return [{ type: 'actionResult', reqId, ok: false, reason: error }];
  const price = nextSlotPrice(state)!;
  const { fleet } = state;
  state.credits -= price;
  fleet.slots.set(station.id, slotsAt(fleet, station.id) + 1);
  return [
    { type: 'actionResult', reqId, ok: true },
    { type: 'creditsChanged', delta: -price, reason: 'hangar' },
    { type: 'hangarSlotBought', stationId: station.id, price, here: slotsAt(fleet, station.id), total: slotsBought(fleet) },
  ];
}
