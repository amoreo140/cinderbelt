// The Archive (long-term design 3.2.4): a tree of 40 nodes in 5 branches, at most 4 levels, plus the
// early docking computer (2026-10-17). Every node unlocks one concrete thing. Ordinary nodes are paid
// with Data from the fund (prices from the econ model's fund, `POOL`); key nodes have a threshold of
// collected Data ("Key node thresholds" table) – no Data is spent on them. Nodes whose content comes in
// a later milestone have `since` and cannot be bought. Hidden nodes show only after a journal entry
// (e.g. "Forge-smith frequencies" → the Echo decoder).
import type { PartId } from './parts';
import type { VariantId } from './variants';

export type ArchiveBranch = 'mining' | 'construction' | 'navigation' | 'combat' | 'logistics';
export const ARCHIVE_BRANCHES: readonly ArchiveBranch[] = ['mining', 'construction', 'navigation', 'combat', 'logistics'];

export type ArchiveLevel = 1 | 2 | 3 | 4;

/** Features (not parts) a node switches on. */
export type ArchiveFeature =
  | 'slingPlus'
  | 'instituteLicense'
  | 'echoDecoder'
  | 'dockingComputer'
  /** Ship templates, 5 slots (M4a, sim/templates/state.ts `templateCap`). */
  | 'templates'
  /** Ship templates, 20 slots (M4a). */
  | 'templates20'
  /** Hangar slot cap 2 → 4 (M4a, sim/fleet/state.ts `hangarSlotCap`). */
  | 'hangarPlus'
  /** Ore assay and a comet's composition from 2× radar range (M4b, data/sites.ts `VEIN_ANALYZER`). */
  | 'veinAnalyzer'
  /** Tractor beam range ×1.5 and `maxParts` +2 (M4b, data/salvage.ts `TRACTOR_PLUS`). */
  | 'tractorPlus'
  /** Map notes: markers with a short text on the map, shown in flight (M4d, src/sim/navigation). */
  | 'mapNotes';

export type ArchiveUnlock =
  | { kind: 'part'; part: PartId }
  | { kind: 'variant'; variant: VariantId }
  | { kind: 'feature'; feature: ArchiveFeature }
  /** Content of a later milestone (only the name in the tree). */
  | { kind: 'future' };

export type ArchiveNodeId =
  | 'veinAnalyzer' | 'battery' | 'heavyLaser' | 'refinery' | 'miningDrones' | 'crystalMetallurgy' | 'exoticMetallurgy' | 'resonantLaser'
  | 'templates' | 'largeCargo' | 'largeReactor' | 'repairModule' | 'testTrackPlus' | 'hangarPlus' | 'kovaciArmor' | 'templates20'
  | 'fuelTankPlus' | 'mapNotes' | 'cruiseDrive' | 'slingPlus' | 'shielding' | 'deepScanner' | 'warpStabilizer' | 'jumpBeacon'
  | 'cannonRapid' | 'shieldQuick' | 'pointDefense' | 'missiles' | 'largeShield' | 'railgun' | 'kovaciBeam' | 'swarmDefense'
  | 'instituteLicense' | 'tractorPlus' | 'landingModule' | 'cargoDrones' | 'refineryModule' | 'outpost' | 'orbitalDrop' | 'riftBeacon'
  | 'echoDecoder' | 'dockingComputer';

export interface ArchiveNode {
  id: ArchiveNodeId;
  branch: ArchiveBranch;
  level: ArchiveLevel;
  /** Price in Data from the fund (0 for a key node). */
  data: number;
  /** Key node: the threshold of collected Data (not a price). */
  threshold?: number;
  /** Fee in credits (processing in the Archive). */
  credits: number;
  unlock: ArchiveUnlock;
  /** The milestone that brings the node's content – it cannot be bought before. */
  since?: string;
  /** Hidden node – shown after the journal entry `revealedBy`. */
  revealedBy?: string;
}

const part = (p: PartId): ArchiveUnlock => ({ kind: 'part', part: p });
const variant = (v: VariantId): ArchiveUnlock => ({ kind: 'variant', variant: v });
const feature = (f: ArchiveFeature): ArchiveUnlock => ({ kind: 'feature', feature: f });
const FUTURE: ArchiveUnlock = { kind: 'future' };

const n = (
  id: ArchiveNodeId,
  branch: ArchiveBranch,
  level: ArchiveLevel,
  data: number,
  credits: number,
  unlock: ArchiveUnlock,
  extra: Partial<Pick<ArchiveNode, 'threshold' | 'since' | 'revealedBy'>> = {},
): ArchiveNode => ({ id, branch, level, data, credits, unlock, ...extra });

/** Nodes in the order of branches and levels (the hub draws the tree in this order). */
export const ARCHIVE_NODES: readonly ArchiveNode[] = [
  // Mining
  n('veinAnalyzer', 'mining', 1, 25, 300, feature('veinAnalyzer')),
  n('battery', 'mining', 1, 20, 200, part('battery')),
  n('heavyLaser', 'mining', 2, 120, 800, part('heavyLaser')),
  n('refinery', 'mining', 2, 150, 1000, part('refinery')),
  n('miningDrones', 'mining', 3, 0, 9000, FUTURE, { threshold: 2600, since: 'M5b' }),
  n('crystalMetallurgy', 'mining', 3, 0, 15000, FUTURE, { threshold: 1350, since: 'M5a' }),
  n('exoticMetallurgy', 'mining', 4, 0, 60000, FUTURE, { threshold: 4700, since: 'M6a' }),
  n('resonantLaser', 'mining', 4, 600, 8000, FUTURE, { since: 'M6a' }),
  // Construction
  n('templates', 'construction', 1, 40, 300, feature('templates')),
  n('largeCargo', 'construction', 1, 35, 300, part('largeCargo')),
  n('largeReactor', 'construction', 2, 200, 1500, part('largeReactor')),
  n('repairModule', 'construction', 2, 175, 1200, part('repairModule')),
  n('testTrackPlus', 'construction', 3, 400, 3000, FUTURE, { since: 'M4' }),
  n('hangarPlus', 'construction', 3, 430, 5000, feature('hangarPlus')),
  n('kovaciArmor', 'construction', 4, 700, 12000, FUTURE, { since: 'M6a' }),
  n('templates20', 'construction', 4, 650, 4000, feature('templates20')),
  // Propulsion and navigation
  n('fuelTankPlus', 'navigation', 1, 30, 250, variant('extended')),
  n('mapNotes', 'navigation', 1, 45, 150, feature('mapNotes')),
  // an extra early node outside the 40-node tree (decision 2026-10-17): the docking computer relaxes
  // the docking manoeuvre (station/dock.ts) – 12 u from the clamp, 6 u/s, any heading
  n('dockingComputer', 'navigation', 1, 25, 200, feature('dockingComputer')),
  n('cruiseDrive', 'navigation', 2, 0, 9000, FUTURE, { threshold: 2600, since: 'M5b' }),
  n('slingPlus', 'navigation', 2, 100, 600, feature('slingPlus')),
  n('shielding', 'navigation', 3, 0, 4000, FUTURE, { threshold: 900, since: 'M5a' }),
  n('deepScanner', 'navigation', 3, 0, 20000, FUTURE, { threshold: 3700, since: 'M5a' }),
  n('warpStabilizer', 'navigation', 4, 800, 15000, FUTURE, { since: 'M6b' }),
  n('jumpBeacon', 'navigation', 4, 850, 15000, FUTURE, { since: 'M6b' }),
  // Boj
  n('cannonRapid', 'combat', 1, 40, 400, variant('rapid')),
  n('shieldQuick', 'combat', 1, 50, 450, variant('quick')),
  n('pointDefense', 'combat', 2, 225, 1500, FUTURE, { since: 'M5a' }),
  n('missiles', 'combat', 2, 250, 1800, FUTURE, { since: 'M5a' }),
  n('largeShield', 'combat', 3, 470, 4000, FUTURE, { since: 'M5a' }),
  n('railgun', 'combat', 3, 550, 6000, FUTURE, { since: 'M6b' }),
  n('kovaciBeam', 'combat', 4, 900, 15000, FUTURE, { since: 'M6b' }),
  n('swarmDefense', 'combat', 4, 750, 12000, FUTURE, { since: 'M6b' }),
  // Logistics and bases (the Archive licence from the Institute 2)
  n('instituteLicense', 'logistics', 1, 60, 500, feature('instituteLicense')),
  n('tractorPlus', 'logistics', 1, 55, 400, feature('tractorPlus')),
  n('landingModule', 'logistics', 2, 0, 8000, FUTURE, { threshold: 2300, since: 'M5b' }),
  n('cargoDrones', 'logistics', 2, 300, 3000, FUTURE, { since: 'M5b' }),
  n('refineryModule', 'logistics', 3, 630, 6000, FUTURE, { since: 'M5a' }),
  n('outpost', 'logistics', 3, 0, 20000, FUTURE, { threshold: 3700, since: 'M6a' }),
  n('orbitalDrop', 'logistics', 4, 900, 15000, FUTURE, { since: 'M7' }),
  n('riftBeacon', 'logistics', 4, 880, 15000, FUTURE, { since: 'M7' }),
  // hidden node: revealed by the Echo-0 journal entry
  n('echoDecoder', 'navigation', 1, 40, 0, feature('echoDecoder'), { revealedBy: 'echo0' }),
];

export const ARCHIVE_NODE_IDS: readonly ArchiveNodeId[] = ARCHIVE_NODES.map((x) => x.id);

const BY_ID = new Map(ARCHIVE_NODES.map((x) => [x.id, x]));
export const archiveNode = (id: ArchiveNodeId): ArchiveNode => BY_ID.get(id)!;
export const isArchiveNodeId = (id: unknown): id is ArchiveNodeId => typeof id === 'string' && BY_ID.has(id as ArchiveNodeId);

/** The Logistics branch needs the Archive licence (Institute 2). */
export const LICENSED_BRANCH: ArchiveBranch = 'logistics';

/** Parts the Archive unlocks (otherwise they cannot be bought or crafted; mounting from storage always works). */
export const ARCHIVE_PARTS: ReadonlyMap<PartId, ArchiveNodeId> = new Map(
  ARCHIVE_NODES.flatMap((x) => (x.unlock.kind === 'part' ? [[x.unlock.part, x.id] as const] : [])),
);

/** Nodes M2d made available directly – they stay unlocked in old saves (V4). */
export const LEGACY_ARCHIVE_NODES: readonly ArchiveNodeId[] = ['battery', 'heavyLaser', 'largeCargo'];
