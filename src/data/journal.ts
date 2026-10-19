// Journal – Knowledge (long-term design 5.6): entries are graph nodes (places, topics, observations)
// and links are clues ("this leads to that"). The journal never gives away the solution, it only
// collects what the player has seen. Content is data-driven (12.3): entry ≤ 60 words, tone brief,
// human, no pathos; every entry has at least one link. Validation lives in src/data/journal.test.ts.
import type { BuffKind } from './poi';
import type { EchoIndex } from './echoes';
import type { WreckClass } from './poi';
import type { DerelictModel } from './sites';

export type JournalKind = 'place' | 'topic' | 'observation';

/** What unlocks an entry (a discovery event). */
export type JournalTrigger =
  | { on: 'firstPulse' }
  | { on: 'echoHeard'; echo: EchoIndex }
  | { on: 'echoAnalyzed'; echo: EchoIndex }
  | { on: 'anomalyScanned' }
  | { on: 'buff'; buff: BuffKind }
  | { on: 'cacheSignal' }
  | { on: 'cacheFound' }
  | { on: 'wreckScanned'; cls?: WreckClass }
  | { on: 'pirateLog'; n: 1 | 2 | 3 }
  | { on: 'fragmentFound' }
  | { on: 'planComplete' }
  | { on: 'giantDiscovered' }
  | { on: 'giantBroken' }
  | { on: 'distressHeard' }
  | { on: 'distressTrap' }
  | { on: 'shardFound' }
  /**
   * The terminal of a derelict station of this model, first berth (M4b, sim/sites/terminal.ts). The
   * terminal unlocks its entry directly by id (`derelictLogId`) – never through `fireJournal`.
   */
  | { on: 'derelictLog'; model: DerelictModel }
  /** Content of a later milestone – stays "?" in M3.5b. */
  | { on: 'later'; since: string };

/** Ids of the journal entries; their titles and texts live in the i18n modules (skJournal.ts). */
export type JournalId =
  | 'scanner'
  | 'echo0Heard'
  | 'echo0'
  | 'decoder'
  | 'anomalies'
  | 'ruleSling'
  | 'ruleCharge'
  | 'ruleRadiation'
  | 'ruleTime'
  | 'caches'
  | 'cacheFound'
  | 'wrecks'
  | 'plans'
  | 'giants'
  | 'giantCore'
  | 'distress'
  | 'trap'
  | 'echo1'
  | 'pirateLog1'
  | 'pirateLog2'
  | 'pirateLog3'
  | 'shard'
  | 'ruleResonance'
  | 'echo2'
  | 'fortress'
  | 'derelictLog_a'
  | 'derelictLog_b'
  | 'derelictLog_c'
  | 'derelictLog_d';

export interface JournalEntry {
  id: JournalId;
  kind: JournalKind;
  /** Story chapter (5.7.2): 0 Signal, 1 The Rust. */
  chapter: 0 | 1;
  /** Clues – ids of the entries this one leads to. */
  links: readonly JournalId[];
  trigger: JournalTrigger;
  /** Position of the node in the graph (column, row). */
  at: readonly [number, number];
}

export const JOURNAL: readonly JournalEntry[] = [
  // --- Chapter 0: Signal ---
  {
    id: 'scanner',
    kind: 'topic',
    chapter: 0,
    links: ['echo0Heard', 'anomalies', 'wrecks'],
    trigger: { on: 'firstPulse' },
    at: [0, 1],
  },
  {
    id: 'echo0Heard',
    kind: 'topic',
    chapter: 0,
    links: ['echo0'],
    trigger: { on: 'echoHeard', echo: 0 },
    at: [1, 0],
  },
  {
    id: 'echo0',
    kind: 'place',
    chapter: 0,
    links: ['decoder', 'echo1'],
    trigger: { on: 'echoAnalyzed', echo: 0 },
    at: [2, 0],
  },
  {
    id: 'decoder',
    kind: 'topic',
    chapter: 0,
    links: ['echo1'],
    trigger: { on: 'echoAnalyzed', echo: 0 },
    at: [3, 0],
  },
  {
    id: 'anomalies',
    kind: 'topic',
    chapter: 0,
    links: ['ruleSling', 'ruleCharge', 'ruleRadiation', 'ruleTime'],
    trigger: { on: 'anomalyScanned' },
    at: [1, 2],
  },
  {
    id: 'ruleSling',
    kind: 'observation',
    chapter: 0,
    links: ['anomalies'],
    trigger: { on: 'buff', buff: 'sling' },
    at: [2, 1],
  },
  {
    id: 'ruleCharge',
    kind: 'observation',
    chapter: 0,
    links: ['anomalies'],
    trigger: { on: 'buff', buff: 'charge' },
    at: [2, 2],
  },
  {
    id: 'ruleRadiation',
    kind: 'observation',
    chapter: 0,
    links: ['anomalies'],
    trigger: { on: 'buff', buff: 'irradiated' },
    at: [2, 3],
  },
  {
    id: 'ruleTime',
    kind: 'observation',
    chapter: 0,
    links: ['anomalies'],
    trigger: { on: 'buff', buff: 'echo' },
    at: [2, 4],
  },
  {
    id: 'caches',
    kind: 'topic',
    chapter: 0,
    links: ['cacheFound'],
    trigger: { on: 'cacheSignal' },
    at: [0, 3],
  },
  {
    id: 'cacheFound',
    kind: 'place',
    chapter: 0,
    links: ['plans', 'pirateLog1'],
    trigger: { on: 'cacheFound' },
    at: [1, 3],
  },
  {
    id: 'wrecks',
    kind: 'topic',
    chapter: 0,
    links: ['plans'],
    trigger: { on: 'wreckScanned' },
    at: [0, 4],
  },
  {
    id: 'plans',
    kind: 'topic',
    chapter: 0,
    links: ['wrecks'],
    trigger: { on: 'fragmentFound' },
    at: [1, 4],
  },
  {
    id: 'giants',
    kind: 'place',
    chapter: 0,
    links: ['giantCore'],
    trigger: { on: 'giantDiscovered' },
    at: [3, 3],
  },
  {
    id: 'giantCore',
    kind: 'observation',
    chapter: 0,
    links: ['giants'],
    trigger: { on: 'giantBroken' },
    at: [4, 3],
  },
  {
    id: 'distress',
    kind: 'topic',
    chapter: 0,
    links: ['trap'],
    trigger: { on: 'distressHeard' },
    at: [3, 4],
  },
  {
    id: 'trap',
    kind: 'observation',
    chapter: 0,
    links: ['distress'],
    trigger: { on: 'distressTrap' },
    at: [4, 4],
  },
  // --- Chapter 1: The Rust ---
  {
    id: 'echo1',
    kind: 'place',
    chapter: 1,
    links: ['pirateLog1', 'shard'],
    trigger: { on: 'echoAnalyzed', echo: 1 },
    at: [4, 0],
  },
  {
    id: 'pirateLog1',
    kind: 'topic',
    chapter: 1,
    links: ['shard', 'pirateLog2'],
    trigger: { on: 'pirateLog', n: 1 },
    at: [4, 1],
  },
  {
    id: 'pirateLog2',
    kind: 'topic',
    chapter: 1,
    links: ['fortress'],
    trigger: { on: 'pirateLog', n: 2 },
    at: [5, 1],
  },
  {
    id: 'pirateLog3',
    kind: 'topic',
    chapter: 1,
    links: ['fortress'],
    trigger: { on: 'pirateLog', n: 3 },
    at: [5, 2],
  },
  {
    id: 'shard',
    kind: 'topic',
    chapter: 1,
    links: ['echo2'],
    trigger: { on: 'shardFound' },
    at: [4, 2],
  },
  {
    id: 'ruleResonance',
    kind: 'observation',
    chapter: 1,
    links: ['echo2'],
    trigger: { on: 'echoHeard', echo: 2 },
    at: [5, 3],
  },
  {
    id: 'echo2',
    kind: 'place',
    chapter: 1,
    links: ['fortress'],
    trigger: { on: 'echoAnalyzed', echo: 2 },
    at: [5, 4],
  },
  {
    id: 'fortress',
    kind: 'place',
    chapter: 1,
    links: ['echo2'],
    trigger: { on: 'later', since: 'M3.6' },
    at: [6, 2],
  },
  // --- M4b: the logs of the abandoned stations (one per model, the first berth at one) ---
  {
    id: 'derelictLog_a',
    kind: 'place',
    chapter: 1,
    links: ['derelictLog_b'],
    trigger: { on: 'derelictLog', model: 'a' },
    at: [6, 0],
  },
  {
    id: 'derelictLog_b',
    kind: 'place',
    chapter: 1,
    links: ['derelictLog_c'],
    trigger: { on: 'derelictLog', model: 'b' },
    at: [6, 1],
  },
  {
    id: 'derelictLog_c',
    kind: 'place',
    chapter: 1,
    links: ['derelictLog_d'],
    trigger: { on: 'derelictLog', model: 'c' },
    at: [6, 3],
  },
  {
    id: 'derelictLog_d',
    kind: 'place',
    chapter: 1,
    links: ['derelictLog_a'],
    trigger: { on: 'derelictLog', model: 'd' },
    at: [6, 4],
  },
];

export const JOURNAL_IDS: readonly string[] = JOURNAL.map((e) => e.id);
const BY_ID = new Map<string, JournalEntry>(JOURNAL.map((e) => [e.id, e]));
export const journalEntry = (id: string): JournalEntry | undefined => BY_ID.get(id);
export const isJournalId = (id: unknown): id is JournalId => typeof id === 'string' && BY_ID.has(id);

/** Maximum number of words in an entry (12.3). */
export const JOURNAL_MAX_WORDS = 60;
export const wordCount = (text: string): number => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
