// Names for the career UI (stations, captains, resources, parts) – one place for the view models.
import { CAPTAIN_NAMES } from '../../data/captains';
import { parsePartKey, type PartKey } from '../../data/parts';
import type { ResourceId } from '../../data/resources';
import { tx } from '../../i18n';
import { formatInt, formatNumber } from '../../i18n/format';
import type { AssignmentDef } from '../../data/factions';
import { captainDef } from '../../sim/captains/captains';
import { sectorInfo } from '../../sim/regions';
import { stationById } from '../../sim/world/stations';
import { sectorName } from '../../ui/sectors/sectorText';
import { formatStationName } from '../../ui/stationName';

export function stationLabel(seed: number, id: string): string {
  const s = stationById(seed, id);
  return s ? formatStationName(s) : id;
}

export function captainName(seed: number, index: number): string {
  const def = captainDef(seed, index);
  if (!def) return `#${index}`;
  return tx().goals.captains.name(tx().goals.captains.nicknames[def.nickname] ?? '?', CAPTAIN_NAMES[def.name]!);
}

export const resourceName = (r: ResourceId): string => tx().resources[r];

/** Player-facing name of a sector id. */
export function sectorLabel(seed: number, id: string): string {
  const info = sectorInfo(seed, id);
  return info ? sectorName(info.name) : id;
}

/** Name of a Rust fortress from its id (`fort:<i>`). */
export function fortressLabel(id: string): string {
  const i = Number(/^fort:(\d+)$/.exec(id)?.[1] ?? NaN);
  return Number.isInteger(i) ? tx().pirates.fortressName(i) : id;
}

export function partLabel(key: PartKey): string {
  const { partId, tier, variant } = parsePartKey(key);
  return variant ? `${tx().parts[partId]} – ${tx().discovery.variants[variant]} T${tier}` : `${tx().parts[partId]} T${tier}`;
}

/** Text of a career task (contracts, delivery, scans). */
export function assignmentText(a: AssignmentDef): string {
  switch (a.kind) {
    case 'deliver':
      return tx().goals.assignments.deliver(a.amount, resourceName(a.resource));
    case 'scans':
      return tx().goals.assignments.scans[a.what](a.count);
    case 'contracts':
      return a.minRing
        ? tx().goals.assignments.contractsRing(a.count, tx().goals.contractTypes[a.type], a.minRing)
        : tx().goals.assignments.contracts(a.count, tx().goals.contractTypes[a.type]);
  }
}

/** An amount without a needless decimal part ("45", "12,5" in Slovak). */
export const amountText = (n: number): string => (Math.abs(n - Math.round(n)) < 0.05 ? formatInt(n) : formatNumber(n, 1));

/** Game time from steps (60/s): "4 min", "1 h 05 min". */
export function durationText(ticks: number): string {
  const min = Math.max(1, Math.round(ticks / 3600));
  if (min < 60) return tx().time.minutes(min);
  return tx().time.hoursMinutes(Math.floor(min / 60), String(min % 60).padStart(2, '0'));
}
