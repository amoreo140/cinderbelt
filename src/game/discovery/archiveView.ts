// Archive tab in the hub (3.2.4): the node tree by branches and tiers, Data, blueprints and key items.
import { ARCHIVE_BRANCHES, ARCHIVE_NODES, LICENSED_BRANCH, type ArchiveBranch, type ArchiveNodeId } from '../../data/archive';
import { FRAGMENTS_PER_PLAN, PLAN_IDS } from '../../data/plans';
import { VARIANTS } from '../../data/variants';
import { partKey } from '../../data/parts';
import { tx } from '../../i18n';
import { archiveBlock, nodeVisible, type ArchiveBlock } from '../../sim/discovery/archive';
import { hasUnlock } from '../../sim/factions/reputation';
import type { SimState } from '../../sim/Simulation';
import { partBaseName } from './names';

export type ArchiveNodeState = 'owned' | 'ready' | 'locked' | 'future' | 'hidden';

export interface ArchiveNodeView {
  id: ArchiveNodeId;
  name: string;
  level: number;
  state: ArchiveNodeState;
  /** Price in Data (0 for a key node), threshold, credits. */
  data: number;
  threshold: number | null;
  credits: number;
  /** What the node unlocks (a sentence), or "comes in M…". */
  effect: string;
  /** The milestone a future node comes in ("M4"), or null. */
  since: string | null;
  /** Why it cannot be bought (null = it can / already owned). */
  reason: string | null;
  block: ArchiveBlock | null;
  key: boolean;
}

export interface ArchiveBranchView {
  id: ArchiveBranch;
  name: string;
  /** The branch requires a licence the player does not have. */
  licensed: boolean;
  nodes: ArchiveNodeView[];
}

export interface ArchiveData {
  dataTotal: number;
  dataFund: number;
  branches: ArchiveBranchView[];
  selected: ArchiveNodeView | null;
  plans: { name: string; fragments: number; done: boolean }[];
  keyItems: string[];
}

function stateOf(block: ArchiveBlock | null): ArchiveNodeState {
  if (block === 'owned') return 'owned';
  if (block === 'hidden') return 'hidden';
  if (block === 'future') return 'future';
  return block === null ? 'ready' : 'locked';
}

export function archiveData(state: SimState, selected: ArchiveNodeId | null): ArchiveData {
  const a = tx().discovery.archive;
  const licensed = hasUnlock(state.career.rep, 'archiveLicense');
  const views = new Map<ArchiveNodeId, ArchiveNodeView>();
  for (const n of ARCHIVE_NODES) {
    if (!nodeVisible(state, n)) continue;
    const block = archiveBlock(state, n);
    views.set(n.id, {
      id: n.id,
      name: a.nodes[n.id],
      level: n.level,
      state: stateOf(block),
      data: n.data,
      threshold: n.threshold ?? null,
      credits: n.credits,
      effect: n.since ? a.soon(n.since) : (a.effects[n.id] ?? ''),
      since: n.since ?? null,
      reason: block && block !== 'owned' ? a.blocks[block] : null,
      block,
      key: n.threshold !== undefined,
    });
  }
  const branches = ARCHIVE_BRANCHES.map((b) => ({
    id: b,
    name: a.branches[b],
    licensed: b === LICENSED_BRANCH && !licensed,
    nodes: ARCHIVE_NODES.filter((n) => n.branch === b && views.has(n.id)).map((n) => views.get(n.id)!),
  }));
  const pick = (selected && views.get(selected)) || [...views.values()].find((v) => v.state === 'ready') || [...views.values()][0] || null;
  const d = state.discovery;
  return {
    dataTotal: d.dataTotal,
    dataFund: d.dataFund,
    branches,
    selected: pick,
    plans: PLAN_IDS.map((p) => ({
      name: partBaseName(partKey(VARIANTS[p].base, 1, p)),
      fragments: d.plans.has(p) ? FRAGMENTS_PER_PLAN : (d.fragments.get(p) ?? 0),
      done: d.plans.has(p),
    })),
    keyItems: [...d.keyItems].map((k) => (k === 'shard' ? a.shard : k)),
  };
}
