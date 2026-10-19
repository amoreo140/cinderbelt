// Journal: entries are unlocked by discovery events (triggers in data/journal.ts).
// Graph: unlocked nodes, "?" = a node a clue leads to that the player has not seen yet,
// "✱" = an unlocked place from which a clue leads to a locked entry.
import { JOURNAL, type JournalEntry, type JournalTrigger } from '../../data/journal';
import type { SimEvent, SimState } from '../Simulation';
import { hasJournal, unlockJournal } from './state';

function matches(t: JournalTrigger, fired: JournalTrigger): boolean {
  if (t.on !== fired.on) return false;
  switch (t.on) {
    case 'echoHeard':
    case 'echoAnalyzed':
      return fired.on === t.on && fired.echo === t.echo;
    case 'buff':
      return fired.on === 'buff' && fired.buff === t.buff;
    case 'pirateLog':
      return fired.on === 'pirateLog' && fired.n === t.n;
    case 'wreckScanned':
      return t.cls === undefined || (fired.on === 'wreckScanned' && fired.cls === t.cls);
    case 'later':
      return false;
    default:
      return true;
  }
}

/** A discovery event → unlocks all entries with this trigger. */
export function fireJournal(state: SimState, trigger: JournalTrigger, events: SimEvent[]): void {
  for (const e of JOURNAL) if (matches(e.trigger, trigger)) unlockJournal(state, e.id, events);
}

export type GraphNodeState = 'known' | 'unknown';

export interface GraphNode {
  entry: JournalEntry;
  state: GraphNodeState;
  /** ✱ – from an unlocked place a clue leads to something the player has not seen yet. */
  more: boolean;
}

/** Knowledge graph nodes: unlocked entries and "?" nodes that a clue leads to from them. */
export function knowledgeGraph(state: SimState): { nodes: GraphNode[]; edges: [string, string][] } {
  const known = new Set(state.discovery.journal.map((e) => e.id));
  const unknown = new Set<string>();
  for (const e of JOURNAL) if (known.has(e.id)) for (const l of e.links) if (!known.has(l)) unknown.add(l);
  const nodes: GraphNode[] = [];
  for (const e of JOURNAL) {
    if (known.has(e.id)) nodes.push({ entry: e, state: 'known', more: e.links.some((l) => !known.has(l)) });
    else if (unknown.has(e.id)) nodes.push({ entry: e, state: 'unknown', more: false });
  }
  const shown = new Set(nodes.map((n) => n.entry.id));
  const edges: [string, string][] = [];
  for (const e of JOURNAL) {
    if (!known.has(e.id)) continue;
    for (const l of e.links) if (shown.has(l) && !(known.has(l) && edges.some(([a, b]) => a === l && b === e.id))) edges.push([e.id, l]);
  }
  return { nodes, edges };
}

/** Chapter progress: unlocked / all entries of the chapter. */
export function chapterProgress(state: SimState, chapter: 0 | 1): { done: number; total: number } {
  const entries = JOURNAL.filter((e) => e.chapter === chapter);
  return { done: entries.filter((e) => hasJournal(state, e.id)).length, total: entries.length };
}
