// Archive and part unlocks: buying a node, availability and what is unlocked.
// Basic T1/T2 parts are free (M2 decision); the heavy laser, big cargo and battery (M2d) and variants
// are unlocked by the Archive or a blueprint. Mounting a part that already lies in storage is always allowed.
import {
  ARCHIVE_NODES,
  ARCHIVE_PARTS,
  LICENSED_BRANCH,
  archiveNode,
  isArchiveNodeId,
  type ArchiveFeature,
  type ArchiveNode,
  type ArchiveNodeId,
} from '../../data/archive';
import { parsePartKey, type PartKey } from '../../data/parts';
import type { PlanId } from '../../data/plans';
import { VARIANTS } from '../../data/variants';
import { hasUnlock } from '../factions/reputation';
import type { SimEvent, SimState } from '../Simulation';
import type { ActionError } from '../station/actions';
import { hasJournal, logDiscovery } from './state';

/** Why a node cannot be bought (null = it can). */
export type ArchiveBlock = 'owned' | 'hidden' | 'future' | 'license' | 'prerequisite' | 'threshold' | 'data' | 'credits';

export const nodeVisible = (state: SimState, node: ArchiveNode): boolean => !node.revealedBy || hasJournal(state, node.revealedBy);

export function archiveBlock(state: SimState, node: ArchiveNode): ArchiveBlock | null {
  const d = state.discovery;
  if (d.archive.has(node.id)) return 'owned';
  if (!nodeVisible(state, node)) return 'hidden';
  if (node.since) return 'future';
  if (node.branch === LICENSED_BRANCH && !hasUnlock(state.career.rep, 'archiveLicense')) return 'license';
  if (node.level > 1 && !ARCHIVE_NODES.some((x) => x.branch === node.branch && x.level === node.level - 1 && d.archive.has(x.id))) return 'prerequisite';
  if (node.threshold !== undefined && d.dataTotal < node.threshold) return 'threshold';
  if (d.dataFund < node.data) return 'data';
  if (state.credits < node.credits) return 'credits';
  return null;
}

/** Buying an Archive node (when docked). Returns an action error, or null on success. */
export function buyArchiveNode(state: SimState, id: unknown, events: SimEvent[]): ActionError | null {
  if (!isArchiveNodeId(id)) return 'archiveLocked';
  const node = archiveNode(id);
  const block = archiveBlock(state, node);
  if (block === 'data' || block === 'threshold') return 'notEnoughData';
  if (block === 'credits') return 'notEnoughCredits';
  if (block) return 'archiveLocked';
  state.discovery.dataFund -= node.data;
  state.discovery.archive.add(node.id);
  if (node.credits > 0) {
    state.credits -= node.credits;
    events.push({ type: 'creditsChanged', delta: -node.credits, reason: 'archive' });
  }
  events.push({ type: 'archiveBought', node: node.id });
  logDiscovery(state, { tick: state.tick, kind: 'archive', node: node.id });
  return null;
}

export const hasFeature = (state: SimState, feature: ArchiveFeature): boolean =>
  ARCHIVE_NODES.some((n) => n.unlock.kind === 'feature' && n.unlock.feature === feature && state.discovery.archive.has(n.id));

/** What a part unlocks (null = a free part). */
export function partLock(key: PartKey): { node: ArchiveNodeId } | { plan: PlanId } | null {
  const { partId, variant } = parsePartKey(key);
  if (variant) {
    const src = VARIANTS[variant].source;
    return src.kind === 'plan' ? { plan: variant } : { node: src.node as ArchiveNodeId };
  }
  const node = ARCHIVE_PARTS.get(partId);
  return node ? { node } : null;
}

/** Can the part be bought and crafted? */
export function partUnlocked(state: SimState, key: PartKey): boolean {
  const lock = partLock(key);
  if (!lock) return true;
  return 'plan' in lock ? state.discovery.plans.has(lock.plan) : state.discovery.archive.has(lock.node);
}
