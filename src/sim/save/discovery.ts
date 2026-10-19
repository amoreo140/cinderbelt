// Discoveries ↔ save (V5, since V6 also the cut-off wreck parts from POIs). Maps and sets as sorted arrays (a canonical save – the same state gives the same
// JSON), Archive nodes in tree order.
import { ARCHIVE_NODE_IDS, LEGACY_ARCHIVE_NODES } from '../../data/archive';
import { ATLAS_COLLECTIONS } from '../../data/atlas';
import { KEY_ITEMS } from '../../data/echoes';
import { FRAGMENT_SOURCES, PLAN_IDS } from '../../data/plans';
import { createDiscovery } from '../discovery/state';
import type { DiscoveryState } from '../discovery/types';
import type { SavedDiscoveryV6 } from './types';

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sortedKeys = (s: ReadonlySet<string>): string[] => [...s].sort(byString);
const sortedPairs = <V>(m: ReadonlyMap<string, V>): [string, V][] => [...m].sort((a, b) => byString(a[0], b[0]));

export function discoveryToSave(d: DiscoveryState): SavedDiscoveryV6 {
  return structuredClone({
    dataTotal: d.dataTotal,
    dataFund: d.dataFund,
    archive: ARCHIVE_NODE_IDS.filter((id) => d.archive.has(id)),
    fragments: PLAN_IDS.filter((p) => d.fragments.has(p)).map((p): [typeof p, number] => [p, d.fragments.get(p)!]),
    plans: PLAN_IDS.filter((p) => d.plans.has(p)),
    pity: FRAGMENT_SOURCES.filter((s) => (d.pity.get(s) ?? 0) > 0).map((s): [typeof s, number] => [s, d.pity.get(s)!]),
    scanned: sortedKeys(d.scanned),
    known: sortedKeys(d.known),
    signals: d.signals,
    fixes: sortedPairs(d.fixes),
    opened: sortedKeys(d.opened),
    giants: sortedPairs(d.giants),
    journal: d.journal,
    keyItems: KEY_ITEMS.filter((k) => d.keyItems.has(k)),
    buffs: d.buffs,
    anomalyUsed: sortedPairs(d.anomalyUsed),
    scanner: d.scanner,
    distressScans: sortedPairs(d.distressScans),
    pirateLogs: d.pirateLogs,
    atlas: sortedKeys(d.atlas),
    atlasDone: ATLAS_COLLECTIONS.filter((c) => d.atlasDone.has(c)),
    log: d.log,
    cut: sortedPairs(d.cut).map(([k, ids]): [string, number[]] => [k, [...ids].sort((a, b) => a - b)]),
  });
}

export function discoveryFromSave(saved: SavedDiscoveryV6): DiscoveryState {
  const s = structuredClone(saved);
  return {
    dataTotal: s.dataTotal,
    dataFund: s.dataFund,
    archive: new Set(s.archive),
    fragments: new Map(s.fragments),
    plans: new Set(s.plans),
    pity: new Map(s.pity),
    scanned: new Set(s.scanned),
    known: new Set(s.known),
    signals: s.signals,
    fixes: new Map(s.fixes),
    opened: new Set(s.opened),
    giants: new Map(s.giants),
    journal: s.journal,
    keyItems: new Set(s.keyItems),
    buffs: s.buffs,
    anomalyUsed: new Map(s.anomalyUsed),
    scanner: s.scanner,
    distressScans: new Map(s.distressScans),
    pirateLogs: s.pirateLogs,
    atlas: new Set(s.atlas),
    atlasDone: new Set(s.atlasDone),
    log: s.log,
    cut: new Map(s.cut),
  };
}

/**
 * Discoveries for an old save (V4): without Data and discoveries, but the heavy laser, big cargo and battery
 * (M2d made them available outright) stay unlocked.
 */
export function legacyDiscovery(): SavedDiscoveryV6 {
  const d = createDiscovery();
  for (const id of LEGACY_ARCHIVE_NODES) d.archive.add(id);
  return discoveryToSave(d);
}
