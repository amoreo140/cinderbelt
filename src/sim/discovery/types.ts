// The player's "discovery" state (M3.5b): Data, Archive, fragments and blueprints, scanner and signals, discovered
// and analysed places, triangulations (caches, Echoes), giant asteroids, journal, key items
// and short anomaly bonuses. Everything is saved (save V5) – the simulation stays deterministic.
import type { ArchiveNodeId } from '../../data/archive';
import type { AtlasCollection } from '../../data/atlas';
import type { EchoIndex, KeyItemId } from '../../data/echoes';
import type { DistressKind } from '../../data/events';
import type { PartInventory } from '../../data/parts';
import type { FragmentSource, PlanId } from '../../data/plans';
import type { BuffKind, PoiKind } from '../../data/poi';
import type { Cargo } from '../../data/resources';
import type { Vec2 } from '../math/vec2';

/** Kind of a signal (a question mark) after a pulse; M4b adds the world sites and comets (`poiDiscovered` covers them). */
export type SignalKind = PoiKind | 'echo' | 'distress' | 'derelict' | 'graveyard' | 'comet';
export const SIGNAL_KINDS: readonly SignalKind[] = ['wreck', 'anomaly', 'cache', 'giant', 'echo', 'distress', 'derelict', 'graveyard', 'comet'];

/** A signal after a pulse: a position estimate and an uncertainty circle (not the answer – only arriving gives that). */
export interface Signal {
  /** Place id (POI, `echo:<i>`, `ds:<…>`). */
  id: string;
  kind: SignalKind;
  /** Centre of the uncertainty circle. */
  pos: Vec2;
  radius: number;
  /** Step of the last interception. */
  tick: number;
}

/** Triangulation (cache, Echo): the places of the pulses that caught it, and the current uncertainty circle. */
export interface Fix {
  pulses: Vec2[];
  radius: number;
}

export interface Buff {
  kind: BuffKind;
  /** Step when the bonus ends. */
  until: number;
}

/** Scanner state (Tab): pulse charging and holding (steps). */
export interface ScannerState {
  cooldown: number;
  /** How many steps Tab has been held (0 = released). */
  held: number;
  /** The analysed object (while holding), or null. */
  target: string | null;
}

/** Wreck contents (determined at the first analysis or loading – by the bad-luck protection). */
export interface WreckContents {
  fragment: PlanId | null;
  /** Glowing shard of the Forge-smiths (key item, Echo-2). */
  shard: boolean;
}

export type DiscoveryLogEntry =
  | { tick: number; kind: 'poi'; poi: PoiKind }
  | { tick: number; kind: 'echo'; echo: EchoIndex }
  | { tick: number; kind: 'journal'; entry: string }
  | { tick: number; kind: 'plan'; plan: PlanId }
  | { tick: number; kind: 'archive'; node: ArchiveNodeId };

export interface DiscoveryState {
  /** Collected Data (thresholds of key nodes) and the pool to spend. */
  dataTotal: number;
  dataFund: number;
  /** Purchased Archive nodes. */
  archive: Set<ArchiveNodeId>;
  /** Fragments of blueprints in progress (0–2). */
  fragments: Map<PlanId, number>;
  plans: Set<PlanId>;
  /** Bad-luck protection: sources without a fragment since the last one. */
  pity: Map<FragmentSource, number>;
  /** Analysed objects (Data for the first analysis). */
  scanned: Set<string>;
  /** Discovered places (on the map). */
  known: Set<string>;
  signals: Signal[];
  fixes: Map<string, Fix>;
  /** Opened caches, solved distress signals, looted wrecks, loaded containers from POIs. */
  opened: Set<string>;
  /** Wrecks being salvaged from POIs (M3.6): POI key → ids of the parts cut off (sorted). */
  cut: Map<string, number[]>;
  /** Remaining shell of giant asteroids (missing = whole, 0 = broken). */
  giants: Map<string, number>;
  /** Journal entries in unlock order. */
  journal: { id: string; tick: number }[];
  keyItems: Set<KeyItemId>;
  buffs: Buff[];
  /** Anomaly → step when its core was last used. */
  anomalyUsed: Map<string, number>;
  scanner: ScannerState;
  /** Number of distress-signal analyses (the trap is revealed at the 2nd). */
  distressScans: Map<string, number>;
  /** Analysed pirate wrecks (pirate logs I–III). */
  pirateLogs: number;
  /** Atlas entries `collection:item` (asteroid types, anomalies, wreck classes, giants, Echoes). */
  atlas: Set<string>;
  /** Completed Atlas collections (reward only once). */
  atlasDone: Set<AtlasCollection>;
  log: DiscoveryLogEntry[];
}

export const DISCOVERY_LOG_MAX = 16;

/**
 * What an analysis examined (also the name of a map place). M4b (T3): a derelict (defence hint), a relay
 * (its charge), a comet nucleus (composition and budget), a graveyard (the field as a place; its wrecks
 * are analysed as 'wreck'). A graveyard sleeper is analysed as a 'wreck' ("active reactor").
 */
export type ScanKind = 'wreck' | 'anomaly' | 'giant' | 'cache' | 'echo' | 'distress' | 'asteroid' | 'derelict' | 'relay' | 'comet' | 'graveyard';

/** Where Data came from (statistics, toast). */
export type DataSource = 'scan' | 'cache' | 'echo' | 'fragment' | 'contract' | 'atlas' | 'salvage' | 'chart' | 'derelict';

export type DiscoveryEvent =
  | { type: 'scanPulse'; pos: Vec2; range: number; found: number }
  | { type: 'scanFailed'; reason: 'energy' | 'cooldown' | 'noTarget' }
  | { type: 'analysisStarted'; target: string; kind: ScanKind; pos: Vec2 }
  | { type: 'analysisCancelled' }
  | { type: 'analysisDone'; target: string; kind: ScanKind; data: number; first: boolean }
  | { type: 'dataGained'; amount: number; source: DataSource }
  /**
   * The player charted a sector (sectors §4.1): by flight coverage (stage 1b) or by its last survey
   * point (stage 2); its flat Data come with it. The chart may now be sold when the Guild buys it.
   */
  | { type: 'sectorCharted'; id: string; depth: number; data: number; via: 'coverage' | 'survey' }
  /** A scanner pulse marked a survey point of a sector not Charted yet (stage 2). */
  | { type: 'surveyPointMarked'; sector: string; index: number; pos: Vec2; done: number; total: number }
  /** Cartography (stage 2): the player sold their chart of a sector / bought a Guild chart. */
  | { type: 'chartSold'; id: string; credits: number }
  | { type: 'chartBought'; id: string; credits: number }
  /** The Guild Training's checklist reward charted lane A's first sector (sectors §6.6). */
  | { type: 'chartGranted'; id: string }
  | { type: 'poiDiscovered'; id: string; kind: SignalKind }
  | { type: 'cacheLocated'; id: string; pos: Vec2 }
  | { type: 'cacheOpened'; id: string; credits: number; cargo: Partial<Cargo>; parts: PartInventory }
  | { type: 'echoHeard'; echo: EchoIndex; fixes: number; located: boolean }
  | { type: 'fragmentFound'; plan: PlanId; count: number; complete: boolean; duplicate: boolean }
  | { type: 'keyItemFound'; item: KeyItemId }
  | { type: 'journalEntry'; id: string }
  | { type: 'buffGained'; buff: BuffKind; seconds: number }
  | { type: 'giantBroken'; id: string; pos: Vec2 }
  | { type: 'distressHeard'; id: string; kind: DistressKind; pos: Vec2 }
  | { type: 'distressResolved'; id: string; reward: number }
  | { type: 'distressAmbush'; id: string; pos: Vec2 }
  | { type: 'archiveBought'; node: ArchiveNodeId }
  | { type: 'atlasComplete'; collection: AtlasCollection; data: number }
  | { type: 'ionStorm'; active: boolean };
