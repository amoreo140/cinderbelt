// Save storage interface (M2, 9.1). Implementations: IndexedDB (the game) and memory (tests,
// a fallback when IndexedDB is unavailable). The storage does not understand the save content – only envelopes and meta.
import { loadSave } from '../../sim/save/load';
import type { SlotMeta } from '../../sim/save/meta';
import type { SaveEnvelope, SlotRef } from '../../sim/save/types';
import type { DeathPenalty } from '../../sim/settings';

export interface SlotRecord {
  current: SaveEnvelope | null;
  backup: SaveEnvelope | null;
  meta: SlotMeta | null;
}

export interface SaveStorage {
  readonly kind: 'indexedDB' | 'memory';
  /** Meta of all slots (ordered by difficulty and index). */
  list(): Promise<SlotMeta[]>;
  /** A whole slot; missing parts are null. */
  read(slot: SlotRef): Promise<SlotRecord>;
  /**
   * In one transaction: a valid current record of the same game → backup, the new record → current,
   * the meta (the storage fills in slot and hasBackup). Returns the saved meta.
   */
  write(slot: SlotRef, envelope: SaveEnvelope, meta: SlotMeta): Promise<SlotMeta>;
  /**
   * In one transaction: picks the lowest free slot of the difficulty (even beyond the limit of 4 slots),
   * deletes the source slot and writes the game into the target one (without a backup). Returns the saved meta (with the target slot).
   */
  moveToFree(from: SlotRef, difficulty: DeathPenalty, envelope: SaveEnvelope, meta: SlotMeta): Promise<SlotMeta>;
  /** Overwrites a whole slot at once (import). */
  replace(slot: SlotRef, record: { current: SaveEnvelope; backup: SaveEnvelope | null; meta: SlotMeta }): Promise<SlotMeta>;
  /** Deletes the current record, the backup and the meta of a slot. */
  delete(slot: SlotRef): Promise<void>;
  /** The storage was closed (a newer version of the game in another tab) – further writes fail. */
  onClosed?(listener: () => void): void;
}

/**
 * Backup rotation on write (a common rule of the implementations): the old current record becomes
 * the backup only if it can be loaded (checksum, migration and validation) and belongs to the same game;
 * an invalid one leaves the existing (last valid) backup; a different game in the slot (a new game) drops the backup.
 */
export function rotatedBackup(
  old: { current: SaveEnvelope | null; backup: SaveEnvelope | null; meta: SlotMeta | null },
  gameId: string,
): SaveEnvelope | null {
  if (!old.meta || old.meta.gameId !== gameId) return null;
  if (old.current && loadSave(old.current).ok) return old.current;
  return old.backup;
}
