// In-memory storage – tests and a fallback when IndexedDB is unavailable (the game runs, offers an export).
import type { SlotMeta } from '../../sim/save/meta';
import type { SaveEnvelope, SlotRef } from '../../sim/save/types';
import type { DeathPenalty } from '../../sim/settings';
import { rotatedBackup, type SaveStorage, type SlotRecord } from './SaveStorage';
import { compareSlots, nextFreeSlot, slotKey } from './slots';

interface Entry {
  current: SaveEnvelope | null;
  backup: SaveEnvelope | null;
  meta: SlotMeta | null;
}

export class MemorySaveStorage implements SaveStorage {
  readonly kind = 'memory';
  private readonly slots = new Map<string, Entry>();
  /** Tests only: further writes fail (simulating a full quota). */
  failWrites = false;

  async list(): Promise<SlotMeta[]> {
    const metas = [...this.slots.values()].flatMap((e) => (e.meta ? [structuredClone(e.meta)] : []));
    return metas.sort((a, b) => compareSlots(a.slot, b.slot));
  }

  async read(slot: SlotRef): Promise<SlotRecord> {
    const e = this.slots.get(slotKey(slot));
    return e ? structuredClone(e) : { current: null, backup: null, meta: null };
  }

  async write(slot: SlotRef, envelope: SaveEnvelope, meta: SlotMeta): Promise<SlotMeta> {
    this.checkWritable();
    const old = this.slots.get(slotKey(slot)) ?? { current: null, backup: null, meta: null };
    const backup = rotatedBackup(old, meta.gameId);
    const stored: SlotMeta = { ...structuredClone(meta), slot: { ...slot }, hasBackup: backup !== null };
    this.slots.set(slotKey(slot), { current: structuredClone(envelope), backup, meta: stored });
    return structuredClone(stored);
  }

  async moveToFree(from: SlotRef, difficulty: DeathPenalty, envelope: SaveEnvelope, meta: SlotMeta): Promise<SlotMeta> {
    this.checkWritable();
    const used = [...this.slots.values()].flatMap((e) => (e.meta ? [e.meta.slot] : []));
    const to = nextFreeSlot(used, difficulty, { ignoreLimit: true })!;
    const stored: SlotMeta = { ...structuredClone(meta), slot: { ...to }, hasBackup: false };
    this.slots.delete(slotKey(from));
    this.slots.set(slotKey(to), { current: structuredClone(envelope), backup: null, meta: stored });
    return structuredClone(stored);
  }

  async replace(slot: SlotRef, record: { current: SaveEnvelope; backup: SaveEnvelope | null; meta: SlotMeta }): Promise<SlotMeta> {
    this.checkWritable();
    const stored: SlotMeta = { ...structuredClone(record.meta), slot: { ...slot }, hasBackup: record.backup !== null };
    this.slots.set(slotKey(slot), { current: structuredClone(record.current), backup: structuredClone(record.backup), meta: stored });
    return structuredClone(stored);
  }

  async delete(slot: SlotRef): Promise<void> {
    this.checkWritable();
    this.slots.delete(slotKey(slot));
  }

  private checkWritable(): void {
    if (this.failWrites) throw new Error('QuotaExceededError (simulated)');
  }
}
