// Journal (J) for the UI: Knowledge (graph), Atlas, Log and Manual – pure data from state.
import { trainingManual } from '../training/trainingView';
import { ARCHIVE_NODES } from '../../data/archive';
import { isJournalId, JOURNAL, journalEntry, type JournalKind } from '../../data/journal';
import { PLAN_IDS, FRAGMENTS_PER_PLAN } from '../../data/plans';
import { VARIANTS } from '../../data/variants';
import { tx } from '../../i18n';
import type { ResourceId } from '../../data/resources';
import { atlasProgress } from '../../sim/discovery/atlas';
import { chapterProgress, knowledgeGraph } from '../../sim/discovery/journal';
import type { SimState } from '../../sim/Simulation';
import { durationText } from '../board/names';
import { partBaseName } from './names';
import { partKey } from '../../data/parts';

export type JournalTab = 'knowledge' | 'atlas' | 'log' | 'manual';
export const JOURNAL_TABS: readonly JournalTab[] = ['knowledge', 'atlas', 'log', 'manual'];

export interface GraphNodeView {
  id: string;
  title: string;
  kind: JournalKind;
  /** false = "?" (a clue leads to it, the player has not seen it yet). */
  known: boolean;
  /** ✱ – there is still something here. */
  more: boolean;
  col: number;
  row: number;
  chapter: 0 | 1;
}

export interface EntryView {
  id: string;
  title: string;
  kind: JournalKind;
  text: string;
  /** When (game time since the start). */
  when: string;
  /** Clues: where the entry leads (a title or "?"). */
  leads: { id: string; title: string; known: boolean }[];
}

export interface AtlasView {
  id: string;
  name: string;
  found: number;
  total: number;
  reward: number;
  done: boolean;
  items: { id: string; label: string; found: boolean }[];
}

export interface JournalData {
  tab: JournalTab;
  nodes: GraphNodeView[];
  edges: [string, string][];
  chapters: { chapter: 0 | 1; name: string; done: number; total: number }[];
  selected: EntryView | null;
  atlas: AtlasView[];
  log: { when: string; text: string }[];
  plans: { name: string; fragments: number; done: boolean }[];
  keyItems: string[];
  data: { total: number; fund: number };
  manual: readonly { title: string; text: string }[];
  /** The Guild Training steps (manual). */
  trainingSteps: { title: string; keys: string; text: string }[];
}


/** Title of a journal entry in the current language (the id when the entry is unknown). */
export function journalTitle(id: string): string {
  return isJournalId(id) ? tx().journal[id].title : id;
}

function entryView(state: SimState, id: string): EntryView | null {
  const e = journalEntry(id);
  const got = state.discovery.journal.find((x) => x.id === id);
  if (!e || !got) return null;
  const known = new Set(state.discovery.journal.map((x) => x.id));
  return {
    id,
    title: journalTitle(id),
    kind: e.kind,
    text: tx().journal[e.id].text,
    when: durationText(got.tick),
    leads: e.links.map((l) => ({ id: l, title: known.has(l) ? journalTitle(l) : '?', known: known.has(l) })),
  };
}

function atlasLabel(collection: string, item: string): string {
  const a = tx().discovery;
  switch (collection) {
    case 'asteroids':
    case 'giants':
      return tx().resources[item as ResourceId] ?? item;
    case 'anomalies':
      return a.anomalies[item as keyof typeof a.anomalies] ?? item;
    case 'wrecks':
      return a.wreckClasses[item as keyof typeof a.wreckClasses] ?? item;
    case 'echoes':
      return tx().discovery.echoName(Number(item));
    case 'variants': {
      const v = VARIANTS[item as keyof typeof VARIANTS];
      return v ? partBaseName(partKey(v.base, 1, v.id)) : item;
    }
    case 'captains':
      return `#${Number(item) + 1}`;
    default:
      return item;
  }
}

function logText(e: SimState['discovery']['log'][number]): string {
  const o = tx().discovery;
  const log = o.journalUi.logEntry;
  switch (e.kind) {
    case 'poi':
      return log.analysed(o.scanKinds[e.poi]);
    case 'echo':
      return log.echoLocated(o.echoName(e.echo));
    case 'journal':
      return log.journal(journalTitle(e.entry));
    case 'plan':
      return log.planDone(partBaseName(partKey(VARIANTS[e.plan].base, 1, e.plan)));
    case 'archive':
      return log.archive(o.archive.nodes[e.node]);
  }
}

export function journalData(state: SimState, tab: JournalTab, selected: string | null): JournalData {
  const graph = knowledgeGraph(state);
  const d = state.discovery;
  const first = selected && d.journal.some((x) => x.id === selected) ? selected : (d.journal.at(-1)?.id ?? null);
  return {
    tab,
    nodes: graph.nodes.map((n) => ({
      id: n.entry.id,
      title: n.state === 'known' ? journalTitle(n.entry.id) : '?',
      kind: n.entry.kind,
      known: n.state === 'known',
      more: n.more,
      col: n.entry.at[0],
      row: n.entry.at[1],
      chapter: n.entry.chapter,
    })),
    edges: graph.edges,
    chapters: ([0, 1] as const).map((c) => ({ chapter: c, name: tx().discovery.journalUi.chapters[c], ...chapterProgress(state, c) })),
    selected: first ? entryView(state, first) : null,
    atlas: atlasProgress(state).map((p) => ({
      id: p.collection,
      name: tx().discovery.atlas.collections[p.collection],
      found: p.found,
      total: p.total,
      reward: p.reward,
      done: p.done,
      items: p.items.map((i) => ({ id: i.id, label: i.found ? atlasLabel(p.collection, i.id) : tx().discovery.atlas.unknown, found: i.found })),
    })),
    log: [...d.log].reverse().map((e) => ({ when: durationText(e.tick), text: logText(e) })),
    plans: PLAN_IDS.filter((p) => d.plans.has(p) || d.fragments.has(p)).map((p) => ({
      name: partBaseName(partKey(VARIANTS[p].base, 1, p)),
      fragments: d.plans.has(p) ? FRAGMENTS_PER_PLAN : (d.fragments.get(p) ?? 0),
      done: d.plans.has(p),
    })),
    keyItems: [...d.keyItems].map((k) => (k === 'shard' ? tx().discovery.archive.shard : k)),
    data: { total: d.dataTotal, fund: d.dataFund },
    manual: tx().discovery.manual,
    trainingSteps: trainingManual(),
  };
}

/** Number of Archive nodes that can be bought in this version (for the overview). */
export const BUYABLE_NODES = ARCHIVE_NODES.filter((n) => !n.since).length;
export { JOURNAL };
