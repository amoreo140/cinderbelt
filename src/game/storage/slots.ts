// Saved game slots: 4 per difficulty (M2, 15.7).
import type { SlotRef } from '../../sim/save/types';
import { DEATH_PENALTIES, type DeathPenalty } from '../../sim/settings';

export type { SlotRef } from '../../sim/save/types';

export const SLOTS_PER_DIFFICULTY = 4;

export const slotKey = (slot: SlotRef): string => `${slot.difficulty}/${slot.index}`;

export function parseSlotKey(key: string): SlotRef | null {
  const m = /^([a-z]+)\/(\d+)$/.exec(key);
  if (!m || !(DEATH_PENALTIES as readonly string[]).includes(m[1]!)) return null;
  return { difficulty: m[1] as DeathPenalty, index: Number(m[2]) };
}

export const sameSlot = (a: SlotRef, b: SlotRef): boolean => a.difficulty === b.difficulty && a.index === b.index;

export const compareSlots = (a: SlotRef, b: SlotRef): number =>
  DEATH_PENALTIES.indexOf(a.difficulty) - DEATH_PENALTIES.indexOf(b.difficulty) || a.index - b.index;

/**
 * The lowest free slot of a difficulty. A new game has only indexes 0–3 available (null = full);
 * a game moved after death in hardcore (`ignoreLimit`) is always placed.
 */
export function nextFreeSlot(used: readonly SlotRef[], difficulty: DeathPenalty, options: { ignoreLimit?: boolean } = {}): SlotRef | null {
  const taken = new Set(used.filter((s) => s.difficulty === difficulty).map((s) => s.index));
  for (let index = 0; ; index++) {
    if (!options.ignoreLimit && index >= SLOTS_PER_DIFFICULTY) return null;
    if (!taken.has(index)) return { difficulty, index };
  }
}

/** Items grouped by difficulty (all four groups), ordered by index. */
export function slotsByDifficulty<T extends { slot: SlotRef }>(items: readonly T[]): Record<DeathPenalty, T[]> {
  const groups = { none: [], mild: [], hard: [], hardcore: [] } as Record<DeathPenalty, T[]>;
  for (const item of items) groups[item.slot.difficulty].push(item);
  for (const d of DEATH_PENALTIES) groups[d].sort((a, b) => a.slot.index - b.slot.index);
  return groups;
}
