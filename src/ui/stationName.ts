import { tx } from '../i18n';
import type { StationDef } from '../sim/world/stations';

/** Station name (in the current language) from the indices the simulation generated. */
export function formatStationName(station: StationDef): string {
  if (station.kind === 'home') return tx().stationNames.home;
  const star = tx().stationNames.stars[station.name.star] ?? tx().stationNames.stars[0];
  const prefix = station.kind === 'outpost' ? tx().stationNames.outpost : (tx().stationNames.prefixes[station.name.prefix] ?? tx().stationNames.prefixes[0]);
  const base = `${prefix} ${star}`;
  return station.name.number === null ? base : `${base}-${station.name.number}`;
}
