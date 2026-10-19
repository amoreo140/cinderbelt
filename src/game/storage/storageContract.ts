// Shared tests for all SaveStorage implementations (the game does not use them).
import { beforeEach, describe, expect, it } from 'vitest';
import { slotMetaFor, type SlotMeta } from '../../sim/save/meta';
import { toEnvelope, toSave } from '../../sim/save/serialize';
import { testContext } from '../../sim/save/testing';
import type { SaveEnvelope, SlotRef } from '../../sim/save/types';
import { dockedSim } from '../../sim/station/testHarness';
import type { SaveStorage } from './SaveStorage';

export function fakeSave(gameId: string, credits: number, savedAt = '2026-10-17T12:00:00.000Z'): { envelope: SaveEnvelope; meta: SlotMeta } {
  const sim = dockedSim();
  sim.state.credits = credits;
  const save = toSave(sim, { ...testContext('manual', savedAt), gameId });
  return { envelope: toEnvelope(save), meta: slotMetaFor(save, { difficulty: 'none', index: 0 }, false) };
}

const creditsOf = (env: SaveEnvelope | null): number | null => (env ? (JSON.parse(env.data) as { credits: number }).credits : null);

export function describeSaveStorage(name: string, create: () => Promise<SaveStorage>): void {
  describe(`${name} – SaveStorage contract`, () => {
    let storage: SaveStorage;
    const slot: SlotRef = { difficulty: 'mild', index: 1 };

    beforeEach(async () => {
      storage = await create();
    });

    it('starts empty', async () => {
      expect(await storage.list()).toEqual([]);
      expect(await storage.read(slot)).toEqual({ current: null, backup: null, meta: null });
    });

    it('writes the first save without a backup and fills the slot into the meta', async () => {
      const { envelope, meta } = fakeSave('g1', 100);
      const stored = await storage.write(slot, envelope, meta);
      expect(stored).toEqual({ ...meta, slot, hasBackup: false });
      expect(await storage.read(slot)).toEqual({ current: envelope, backup: null, meta: stored });
      expect(await storage.list()).toEqual([stored]);
    });

    it('rotates the previous save of the same game into the backup', async () => {
      const first = fakeSave('g1', 100);
      const second = fakeSave('g1', 200);
      await storage.write(slot, first.envelope, first.meta);
      const stored = await storage.write(slot, second.envelope, second.meta);
      expect(stored.hasBackup).toBe(true);
      const record = await storage.read(slot);
      expect(creditsOf(record.current)).toBe(200);
      expect(creditsOf(record.backup)).toBe(100);
      const third = fakeSave('g1', 300);
      await storage.write(slot, third.envelope, third.meta);
      const after = await storage.read(slot);
      expect([creditsOf(after.current), creditsOf(after.backup)]).toEqual([300, 200]);
    });

    it('keeps the good backup when the current record is corrupted', async () => {
      const first = fakeSave('g1', 100);
      const second = fakeSave('g1', 200);
      await storage.write(slot, first.envelope, first.meta);
      await storage.write(slot, second.envelope, second.meta);
      const record = await storage.read(slot);
      await storage.replace(slot, { current: { ...record.current!, checksum: 'deadbeef' }, backup: record.backup, meta: record.meta! });
      const third = fakeSave('g1', 300);
      await storage.write(slot, third.envelope, third.meta);
      const after = await storage.read(slot);
      expect([creditsOf(after.current), creditsOf(after.backup)]).toEqual([300, 100]);
    });

    it('keeps the last valid backup when the current record is intact but fails validation', async () => {
      const first = fakeSave('g1', 100);
      const second = fakeSave('g1', 200);
      await storage.write(slot, first.envelope, first.meta);
      await storage.write(slot, second.envelope, second.meta);
      const record = await storage.read(slot);
      // the checksum matches, but the content does not pass validation (e.g. a write from an older faulty version)
      const invalid = toEnvelope({ ...(JSON.parse(record.current!.data) as { version: number }), credits: -5 } as { version: number });
      await storage.replace(slot, { current: invalid, backup: record.backup, meta: record.meta! });
      const third = fakeSave('g1', 300);
      await storage.write(slot, third.envelope, third.meta);
      const after = await storage.read(slot);
      expect([creditsOf(after.current), creditsOf(after.backup)]).toEqual([300, 100]);
    });

    it('drops the backup when a different game is written into the slot', async () => {
      const a1 = fakeSave('g1', 100);
      const a2 = fakeSave('g1', 200);
      await storage.write(slot, a1.envelope, a1.meta);
      await storage.write(slot, a2.envelope, a2.meta);
      const b = fakeSave('g2', 5);
      const stored = await storage.write(slot, b.envelope, b.meta);
      expect(stored.hasBackup).toBe(false);
      expect((await storage.read(slot)).backup).toBeNull();
    });

    it('keeps slots independent and lists them in slot order', async () => {
      const a = fakeSave('a', 1);
      const b = fakeSave('b', 2);
      const c = fakeSave('c', 3);
      await storage.write({ difficulty: 'hardcore', index: 0 }, a.envelope, a.meta);
      await storage.write({ difficulty: 'none', index: 3 }, b.envelope, b.meta);
      await storage.write({ difficulty: 'none', index: 1 }, c.envelope, c.meta);
      expect((await storage.list()).map((m) => [m.slot.difficulty, m.slot.index, m.gameId])).toEqual([
        ['none', 1, 'c'],
        ['none', 3, 'b'],
        ['hardcore', 0, 'a'],
      ]);
    });

    it('deletes the current record, the backup and the meta', async () => {
      const a = fakeSave('g1', 1);
      await storage.write(slot, a.envelope, a.meta);
      await storage.write(slot, a.envelope, a.meta);
      await storage.delete(slot);
      expect(await storage.read(slot)).toEqual({ current: null, backup: null, meta: null });
      expect(await storage.list()).toEqual([]);
    });

    it('moves a game into the lowest free slot of a difficulty (chosen inside the write, even over the limit) without its backup', async () => {
      const from: SlotRef = { difficulty: 'hardcore', index: 2 };
      const to: SlotRef = { difficulty: 'hard', index: 4 };
      for (let index = 0; index < 4; index++) {
        const other = fakeSave(`h${index}`, index);
        await storage.write({ difficulty: 'hard', index }, other.envelope, other.meta);
      }
      const a = fakeSave('g1', 1);
      await storage.write(from, a.envelope, a.meta);
      await storage.write(from, a.envelope, a.meta);
      const moved = fakeSave('g1', 7);
      const stored = await storage.moveToFree(from, 'hard', moved.envelope, moved.meta);
      expect(stored).toMatchObject({ slot: to, hasBackup: false });
      expect(await storage.read(from)).toEqual({ current: null, backup: null, meta: null });
      const record = await storage.read(to);
      expect(creditsOf(record.current)).toBe(7);
      expect(record.backup).toBeNull();
    });

    it('replaces a whole slot (import)', async () => {
      const a = fakeSave('g1', 1);
      const b = fakeSave('g1', 2);
      const stored = await storage.replace(slot, { current: b.envelope, backup: a.envelope, meta: b.meta });
      expect(stored).toEqual({ ...b.meta, slot, hasBackup: true });
      const record = await storage.read(slot);
      expect([creditsOf(record.current), creditsOf(record.backup)]).toEqual([2, 1]);
    });

    it('returns copies that do not alias the stored data', async () => {
      const a = fakeSave('g1', 1);
      await storage.write(slot, a.envelope, a.meta);
      const record = await storage.read(slot);
      record.meta!.name = 'changed';
      record.current!.data = 'changed';
      const again = await storage.read(slot);
      expect(again.meta!.name).toBe(a.meta.name);
      expect(again.current!.data).toBe(a.envelope.data);
    });
  });
}
