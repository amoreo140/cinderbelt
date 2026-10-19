// Factions and reputation (long-term design 8.1 and 8.2). Content as data – the texts are in skGoals.ts,
// the emblems in public/assets/ui/emblems/<emblem>.svg. M3.5a has reputation 0–3 (levels 4–5 come later).
import type { ResourceId } from './resources';

export type FactionId = 'guild' | 'institute' | 'rust' | 'cauldron' | 'slantedStar' | 'wardens' | 'freeTraders';
/** Factions with reputation and contracts. */
export type RepFactionId = 'guild' | 'institute';

export const FACTION_IDS: readonly FactionId[] = ['guild', 'institute', 'freeTraders', 'rust', 'cauldron', 'slantedStar', 'wardens'];
export const REP_FACTION_IDS: readonly RepFactionId[] = ['guild', 'institute'];

export type FactionRelation = 'friendly' | 'neutral' | 'hostile';

export interface FactionDef {
  id: FactionId;
  /** Emblem file without the extension (public/assets/ui/emblems). */
  emblem: string;
  relation: FactionRelation;
  /** A Rust clan (pirates, named captains). */
  clan: boolean;
  /** Has reputation and offers contracts. */
  reputation: boolean;
}

export const FACTIONS: Record<FactionId, FactionDef> = {
  guild: { id: 'guild', emblem: 'cech', relation: 'friendly', clan: false, reputation: true },
  institute: { id: 'institute', emblem: 'institut', relation: 'friendly', clan: false, reputation: true },
  freeTraders: { id: 'freeTraders', emblem: 'volni_obchodnici', relation: 'neutral', clan: false, reputation: false },
  rust: { id: 'rust', emblem: 'hrdza', relation: 'hostile', clan: true, reputation: false },
  cauldron: { id: 'cauldron', emblem: 'kotol', relation: 'hostile', clan: true, reputation: false },
  slantedStar: { id: 'slantedStar', emblem: 'sikma_hviezda', relation: 'hostile', clan: true, reputation: false },
  wardens: { id: 'wardens', emblem: 'straznici', relation: 'hostile', clan: false, reputation: false },
};

export const CLAN_IDS: readonly FactionId[] = FACTION_IDS.filter((id) => FACTIONS[id].clan);

export const emblemPath = (faction: FactionId): string => `assets/ui/emblems/${FACTIONS[faction].emblem}.svg`;

// ---------------------------------------------------------------------------
// reputation

export type RepLevel = 0 | 1 | 2 | 3;
export const MAX_REP_LEVEL: RepLevel = 3;

/**
 * What a level unlocks. `since` on an unlock of a later milestone: shown, but does nothing yet.
 * contractsBasic = Delivery and Mining in ring 1 (for the start, so a game without "First Day" never gets stuck).
 */
export type RepUnlock =
  | 'contractsBasic'
  | 'contractsRing1'
  | 'contractsRing2'
  | 't2PartsRing1'
  | 'courier'
  | 'captainHunts'
  | 'surveyRing1'
  | 'surveyRing2'
  | 'archiveLicense'
  | 'surveyRing3'
  /** Scan contracts (Institute 1, M3.5b). */
  | 'scanContracts'
  /** Retrievals – unlocked by the Archive node "Institute contract licence", not by a reputation level. */
  | 'retrieveContracts'
  /** The Guild relay contract (M4d, Guild 2): secure a Contested lane sector with a Guild relay. */
  | 'guildRelay';

/** Unlocks of later milestones (shown with a "soon" tag). */
export const FUTURE_UNLOCKS: Partial<Record<RepUnlock, string>> = {};

/** Contract types the assignments count (the types themselves are in data/contracts.ts). */
export type AssignmentContractType = 'delivery' | 'rescue' | 'hunt' | 'survey';

/** What a "scans" assignment counts (M3.5b): anomaly analyses, found caches, analysed Echoes. */
export type AssignmentScanKind = 'anomaly' | 'cache' | 'echo';

/** A career assignment – one of two options to choose from (8.2). */
export type AssignmentDef =
  | { id: string; kind: 'contracts'; type: AssignmentContractType; count: number; minRing?: 1 | 2 | 3 | 4 }
  | { id: string; kind: 'deliver'; resource: ResourceId; amount: number }
  | { id: string; kind: 'scans'; what: AssignmentScanKind; count: number };

export interface RepLevelDef {
  level: RepLevel;
  /** Points needed for the level (since the start of the game). */
  points: number;
  unlocks: readonly RepUnlock[];
  /** The assignment to meet besides the points (null = the points are enough). */
  assignment: readonly [AssignmentDef, AssignmentDef] | null;
}

export const REP_LEVELS: Record<RepFactionId, readonly [RepLevelDef, RepLevelDef, RepLevelDef, RepLevelDef]> = {
  guild: [
    { level: 0, points: 0, unlocks: ['contractsBasic'], assignment: null },
    { level: 1, points: 60, unlocks: ['contractsRing1'], assignment: null },
    {
      level: 2,
      points: 250,
      unlocks: ['contractsRing2', 't2PartsRing1', 'courier', 'guildRelay'],
      assignment: [
        { id: 'guild2-deliveries', kind: 'contracts', type: 'delivery', count: 3 },
        { id: 'guild2-rescues', kind: 'contracts', type: 'rescue', count: 2 },
      ],
    },
    {
      level: 3,
      points: 700,
      unlocks: ['captainHunts'],
      assignment: [
        { id: 'guild3-hunts', kind: 'contracts', type: 'hunt', count: 2 },
        { id: 'guild3-titanium', kind: 'deliver', resource: 'titanium', amount: 300 },
      ],
    },
  ],
  institute: [
    { level: 0, points: 0, unlocks: ['surveyRing1'], assignment: null },
    { level: 1, points: 60, unlocks: ['surveyRing2', 'scanContracts'], assignment: null },
    {
      level: 2,
      points: 250,
      unlocks: ['archiveLicense'],
      // M3.5b: scanner assignments (8.2) – 5 anomaly scans or 1 cache
      assignment: [
        { id: 'inst2-anomalies', kind: 'scans', what: 'anomaly', count: 5 },
        { id: 'inst2-cache', kind: 'scans', what: 'cache', count: 1 },
      ],
    },
    {
      level: 3,
      points: 700,
      unlocks: ['surveyRing3'],
      // "Survey the nebula (3 buoys)" needs ring 3 (M5a) – until then 2 surveys from ring 2 or 3 Echoes
      assignment: [
        { id: 'inst3-surveys', kind: 'contracts', type: 'survey', count: 2, minRing: 2 },
        { id: 'inst3-echoes', kind: 'scans', what: 'echo', count: 3 },
      ],
    },
  ],
};

/** All of a faction's unlocks up to level `level` inclusive. */
export function unlocksUpTo(faction: RepFactionId, level: RepLevel): Set<RepUnlock> {
  const out = new Set<RepUnlock>();
  for (const def of REP_LEVELS[faction]) if (def.level <= level) for (const u of def.unlocks) out.add(u);
  return out;
}
