// Paint shop view model (M4c T2): the ships that can be painted now – the active ship
// docked at home and the ships stored in the home hangar – with their paints, the selected ship and the
// previewed paint. The preview is UI state: it never reaches the simulation or the save.
import type { PaintId } from '../../data/paints';
import { tx } from '../../i18n';
import { shipDisplayName } from '../../sim/fleet/names';
import { paintOf } from '../../sim/fleet/state';
import type { ShipId } from '../../sim/fleet/types';
import { dockedAtHome } from '../../sim/home/modules';
import type { SimState } from '../../sim/Simulation';
import { HOME_STATION_ID } from '../../sim/world/stations';
import type { PaintShopData, PaintShopShip } from './types';

/** The paint shop's UI state (Game keeps it; never saved). */
export interface PaintShopUi {
  selectedShip: ShipId | null;
  preview: PaintId | null;
}

/** Ships at home: the active ship (docked there) first, then the home hangar by id. */
export function paintShopShips(state: SimState): PaintShopShip[] {
  if (!dockedAtHome(state)) return [];
  const names = tx().fleet.names;
  const { active, stored } = state.fleet;
  const out: PaintShopShip[] = [{ shipId: active.id, name: shipDisplayName(active, names), where: 'docked', paint: paintOf(active) }];
  for (const s of stored) {
    if (s.stationId !== HOME_STATION_ID) continue;
    out.push({ shipId: s.record.id, name: shipDisplayName(s.record, names), where: 'hangar', paint: paintOf(s.record) });
  }
  return out;
}

/** The ship the paint shop works on: the selected one while it is at home, else the first one. */
export function paintShopShip(ships: readonly PaintShopShip[], selected: ShipId | null): PaintShopShip | null {
  return ships.find((s) => s.shipId === selected) ?? ships[0] ?? null;
}

/** The paint shop section (null until the paint shop is built). */
export function paintShopView(state: SimState, ui: PaintShopUi): PaintShopData | null {
  if (!state.home.modules.has('paintShop')) return null;
  const ships = paintShopShips(state);
  return { ships, selectedShip: paintShopShip(ships, ui.selectedShip)?.shipId ?? null, preview: ui.preview };
}
