// Discovery state: creation and small helper functions (Data, journal, entries) used by
// the other modules of the folder.
import { journalEntry } from '../../data/journal';
import type { SimEvent, SimState } from '../Simulation';
import { DISCOVERY_LOG_MAX, type DataSource, type DiscoveryLogEntry, type DiscoveryState } from './types';

export function createDiscovery(): DiscoveryState {
  return {
    dataTotal: 0,
    dataFund: 0,
    archive: new Set(),
    fragments: new Map(),
    plans: new Set(),
    pity: new Map(),
    scanned: new Set(),
    known: new Set(),
    signals: [],
    fixes: new Map(),
    opened: new Set(),
    cut: new Map(),
    giants: new Map(),
    journal: [],
    keyItems: new Set(),
    buffs: [],
    anomalyUsed: new Map(),
    scanner: { cooldown: 0, held: 0, target: null },
    distressScans: new Map(),
    pirateLogs: 0,
    atlas: new Set(),
    atlasDone: new Set(),
    log: [],
  };
}

/** Adds Data (also to the collected total). */
export function gainData(state: SimState, amount: number, source: DataSource, events: SimEvent[]): void {
  const n = Math.round(amount);
  if (n <= 0) return;
  state.discovery.dataTotal += n;
  state.discovery.dataFund += n;
  events.push({ type: 'dataGained', amount: n, source });
}

export function logDiscovery(state: SimState, entry: DiscoveryLogEntry): void {
  const list = state.discovery.log;
  list.push(entry);
  if (list.length > DISCOVERY_LOG_MAX) list.splice(0, list.length - DISCOVERY_LOG_MAX);
}

export const hasJournal = (state: SimState, id: string): boolean => state.discovery.journal.some((e) => e.id === id);

/** Unlocks a journal entry (once). */
export function unlockJournal(state: SimState, id: string, events: SimEvent[]): void {
  if (!journalEntry(id) || hasJournal(state, id)) return;
  state.discovery.journal.push({ id, tick: state.tick });
  events.push({ type: 'journalEntry', id });
  logDiscovery(state, { tick: state.tick, kind: 'journal', entry: id });
}
