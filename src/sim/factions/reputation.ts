// Guild and Institute reputation (long-term design): points from contracts and a career assignment
// (1 of 2 options) per level. A level gives licences and services, not passive bonuses.
import type { ContractType } from '../../data/contracts';
import type { RingIndex } from '../../data/economy';
import {
  MAX_REP_LEVEL,
  REP_FACTION_IDS,
  REP_LEVELS,
  unlocksUpTo,
  type AssignmentDef,
  type AssignmentScanKind,
  type RepFactionId,
  type RepLevel,
  type RepLevelDef,
  type RepUnlock,
} from '../../data/factions';
import type { ResourceId } from '../../data/resources';
import type { RepState } from '../career/types';

export type RepTable = Record<RepFactionId, RepState>;

export const createRep = (): RepTable => ({
  guild: { points: 0, level: 0, assignments: {} },
  institute: { points: 0, level: 0, assignments: {} },
});

/** Definition of the next level, or null at the maximum. */
export function nextLevelDef(rep: RepState, faction: RepFactionId): RepLevelDef | null {
  return rep.level >= MAX_REP_LEVEL ? null : REP_LEVELS[faction][rep.level + 1]!;
}

const target = (a: AssignmentDef): number => (a.kind === 'deliver' ? a.amount : a.count);

export const assignmentProgress = (rep: RepState, a: AssignmentDef): number => Math.min(target(a), rep.assignments[a.id] ?? 0);
export const assignmentDone = (rep: RepState, a: AssignmentDef): boolean => assignmentProgress(rep, a) >= target(a);
export const assignmentTarget = target;

/** The assignment for the next level is done (or there is none). */
export function nextAssignmentDone(rep: RepState, faction: RepFactionId): boolean {
  const next = nextLevelDef(rep, faction);
  if (!next) return false;
  return next.assignment === null || next.assignment.some((a) => assignmentDone(rep, a));
}

/** A completed contract → progress of the next level's assignments (assignments of all factions count). */
export function recordContract(table: RepTable, type: ContractType, ring: RingIndex): void {
  for (const f of REP_FACTION_IDS) {
    const rep = table[f];
    for (const a of nextLevelDef(rep, f)?.assignment ?? []) {
      if (a.kind !== 'contracts' || a.type !== type || ring < (a.minRing ?? 1)) continue;
      rep.assignments[a.id] = (rep.assignments[a.id] ?? 0) + 1;
    }
  }
}

/** An analysis / scanner discovery (M3.5b) → progress of the next level's "scans" assignments. */
export function recordScan(table: RepTable, what: AssignmentScanKind): void {
  for (const f of REP_FACTION_IDS) {
    const rep = table[f];
    for (const a of nextLevelDef(rep, f)?.assignment ?? []) {
      if (a.kind === 'scans' && a.what === what) rep.assignments[a.id] = (rep.assignments[a.id] ?? 0) + 1;
    }
  }
}

/** A faction's "deliver X" assignment (if the next level has one): how much is still missing. */
export function deliverAssignment(rep: RepState, faction: RepFactionId): Extract<AssignmentDef, { kind: 'deliver' }> | null {
  const a = nextLevelDef(rep, faction)?.assignment?.find((x) => x.kind === 'deliver');
  return a && a.kind === 'deliver' ? a : null;
}

export function recordDelivery(rep: RepState, a: AssignmentDef, resource: ResourceId, amount: number): void {
  if (a.kind !== 'deliver' || a.resource !== resource) return;
  rep.assignments[a.id] = (rep.assignments[a.id] ?? 0) + amount;
}

/** Adds points and promotes (by several levels if need be). Returns the new levels. */
export function addPoints(table: RepTable, faction: RepFactionId, points: number): RepLevel[] {
  table[faction].points += Math.max(0, points);
  return promote(table, faction);
}

/** Promotes while both the points and the next level's assignment are satisfied. Assignment progress is reset after a promotion. */
export function promote(table: RepTable, faction: RepFactionId): RepLevel[] {
  const rep = table[faction];
  const out: RepLevel[] = [];
  for (;;) {
    const next = nextLevelDef(rep, faction);
    if (!next || rep.points < next.points || !nextAssignmentDone(rep, faction)) return out;
    rep.level = next.level;
    rep.assignments = {};
    out.push(next.level);
  }
}

/** Unlocks by the current reputation with both factions. */
export function repUnlocks(table: RepTable): Set<RepUnlock> {
  const out = new Set<RepUnlock>();
  for (const f of REP_FACTION_IDS) for (const u of unlocksUpTo(f, table[f].level)) out.add(u);
  return out;
}

export const hasUnlock = (table: RepTable, unlock: RepUnlock): boolean => repUnlocks(table).has(unlock);
