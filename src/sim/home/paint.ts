// Ship paints (M4c plan §2.2): `paintShip`. Painting is free (the paint shop is the price) and happens
// only at home: the active ship docked at the home station, or a ship stored in the home hangar while
// the player is docked there.
import { isPaintId, type PaintId } from '../../data/paints';
import { paintOf } from '../fleet/state';
import type { ShipId } from '../fleet/types';
import type { SimEvent, SimState } from '../Simulation';
import type { ActionError } from '../station/actions';
import { HOME_STATION_ID } from '../world/stations';
import { dockedAtHome } from './modules';

/**
 * Paints ship `shipId` (the active ship docked at home, or a ship stored at home) with `paint` – free,
 * needs the paint shop. Pushes `shipPainted`. Returns the error (nothing changed), or null.
 */
export function paintShip(state: SimState, shipId: ShipId, paint: PaintId, events: SimEvent[]): ActionError | null {
  if (!state.home.modules.has('paintShop')) return 'noPaintShop';
  const { fleet } = state;
  const stored = fleet.stored.find((s) => s.record.id === shipId) ?? null;
  const record = fleet.active.id === shipId ? fleet.active : (stored?.record ?? null);
  if (!record) return 'unknownShip';
  if (stored) {
    if (stored.stationId !== HOME_STATION_ID) return 'shipNotHome';
    // a ship in the home hangar is painted while the player is there
    if (!dockedAtHome(state)) return 'notHome';
  } else if (!dockedAtHome(state)) return 'shipNotHome';
  if (!isPaintId(paint)) return 'serviceUnavailable';
  if (paintOf(record) === paint) return 'samePaint';

  // canonical form: the factory paint is no field (records before M4c and new ships have none)
  if (paint === 'factory') delete record.paint;
  else record.paint = paint;
  events.push({ type: 'shipPainted', shipId: record.id, paint });
  return null;
}
