import { beforeEach, describe, expect, it } from 'vitest';
import { IDLE_COMMAND, type GameAction } from '../../sim/commands';
import type { SlotRef } from '../../sim/save/types';
import type { DifficultyChoice } from '../../sim/settings';
import { HOME_STATION_ID } from '../../sim/world/stations';
import { MemorySaveStorage } from '../storage/memoryStorage';
import { SaveService, type GameSession } from './saveService';

const undock = { ...IDLE_COMMAND, actions: [{ reqId: 1, type: 'undock' } as GameAction] };

describe('SaveService', () => {
  let storage: MemorySaveStorage;
  let service: SaveService;
  let clock: number;
  let ids: number;

  beforeEach(() => {
    storage = new MemorySaveStorage();
    clock = Date.parse('2026-10-17T10:00:00.000Z');
    ids = 0;
    service = new SaveService(storage, {
      gameVersion: '0.0.1',
      now: () => new Date((clock += 1000)),
      newId: () => `game-${++ids}`,
    });
  });

  const standard: DifficultyChoice = { deathPenalty: 'mild', enemyDensity: 'normal', miningYield: 1 };

  async function startGame(slot: SlotRef = { difficulty: 'mild', index: 0 }, choice: DifficultyChoice = standard) {
    const started = await service.newGame({ slot, seedText: '1337', choice });
    if (!started.ok) throw new Error(started.error);
    return started;
  }

  describe('new game', () => {
    it('creates a simulation from the seed text and settings and saves it', async () => {
      const { sim, session, outcome } = await startGame();
      expect(sim.state.seed).toBe(1337);
      expect(sim.state.settings).toMatchObject({ seedText: '1337', ...standard, fallenFromHardcore: false });
      expect(session).toEqual({ slot: { difficulty: 'mild', index: 0 }, gameId: 'game-1', name: '1337', createdAt: '2026-10-17T10:00:01.000Z' });
      expect(outcome).toMatchObject({ status: 'saved', meta: { saveReason: 'new', gameId: 'game-1', hasBackup: false } });
      expect(await storage.list()).toHaveLength(1);
    });

    it('hashes a text seed and keeps a custom name', async () => {
      const started = await service.newGame({ slot: { difficulty: 'none', index: 3 }, seedText: 'hviezdny-prach-42', name: 'Moja hra', choice: { ...standard, deathPenalty: 'none' } });
      expect(started.ok && started.sim.state.seed).not.toBe(false);
      expect(started.ok && started.session.name).toBe('Moja hra');
    });

    it('refuses a slot of another difficulty, an index over the limit or an empty seed', async () => {
      expect(await service.newGame({ slot: { difficulty: 'hard', index: 0 }, seedText: '1', choice: standard })).toMatchObject({ ok: false, error: 'wrongDifficulty' });
      expect(await service.newGame({ slot: { difficulty: 'mild', index: 4 }, seedText: '1', choice: standard })).toMatchObject({ ok: false, error: 'invalidSlot' });
      expect(await service.newGame({ slot: { difficulty: 'mild', index: 0 }, seedText: '  ', choice: standard })).toMatchObject({ ok: false, error: 'emptySeed' });
    });

    it('refuses to overwrite a save from a newer game version', async () => {
      const { session } = await startGame();
      const record = await storage.read(session.slot);
      const data = JSON.stringify({ version: 99 });
      const { toEnvelope } = await import('../../sim/save/serialize');
      await storage.replace(session.slot, { current: { ...toEnvelope({ version: 99 }), data }, backup: null, meta: record.meta! });
      expect(await service.newGame({ slot: session.slot, seedText: '1', choice: standard })).toMatchObject({ ok: false, error: 'slotLocked' });
    });
  });

  describe('saving', () => {
    it('snapshots the state at the moment of the call', async () => {
      const { sim, session } = await startGame();
      sim.state.credits = 777;
      const pending = service.save(sim, session, 'manual');
      sim.state.credits = 1;
      expect(await pending).toMatchObject({ status: 'saved', meta: { credits: 777, saveReason: 'manual', hasBackup: true } });
      const loaded = await service.load(session.slot);
      expect(loaded.ok && loaded.sim.state.credits).toBe(777);
    });

    it('merges saves queued behind a running write', async () => {
      const { sim, session } = await startGame();
      const a = service.save(sim, session, 'interval');
      const b = service.save(sim, session, 'interval');
      const c = service.save(sim, session, 'manual');
      expect((await a).status).toBe('saved');
      expect(await b).toEqual({ status: 'superseded' });
      expect((await c).status).toBe('saved');
    });

    it('validates the snapshot before writing and keeps the stored save when it is invalid', async () => {
      const { sim, session } = await startGame();
      await service.save(sim, session, 'manual');
      const before = await storage.read(session.slot);
      sim.state.credits = -10;
      const outcome = await service.save(sim, session, 'manual');
      expect(outcome).toMatchObject({ status: 'failed', error: expect.stringContaining('credits') });
      // neither the main record nor the backup changed (the invalid state did not get into the rotation)
      expect(await storage.read(session.slot)).toEqual(before);
    });

    it('reports a failed write and keeps the previous save', async () => {
      const { sim, session } = await startGame();
      storage.failWrites = true;
      sim.state.credits = 5;
      expect(await service.save(sim, session, 'manual')).toMatchObject({ status: 'failed' });
      storage.failWrites = false;
      const loaded = await service.load(session.slot);
      expect(loaded.ok && loaded.sim.state.credits).not.toBe(5);
    });
  });

  describe('loading', () => {
    it('restores the simulation and the session', async () => {
      const { sim, session } = await startGame();
      sim.step(undock);
      for (let i = 0; i < 20; i++) sim.step({ ...IDLE_COMMAND, flight: { forward: 1, strafe: 0, turn: 0 } });
      await service.save(sim, session, 'quit');
      const loaded = await service.load(session.slot);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      expect(loaded.session).toEqual(session);
      expect(loaded.sim.state.player.body).toEqual(sim.state.player.body);
      expect(loaded.sim.state.tick).toBe(sim.state.tick);
      expect(loaded.warnings).toEqual([]);
    });

    it('reports an empty slot', async () => {
      expect(await service.load({ difficulty: 'none', index: 0 })).toMatchObject({ ok: false, error: 'empty' });
    });

    it('loads the backup only when the main record is broken', async () => {
      const { sim, session } = await startGame();
      sim.state.credits = 900;
      await service.save(sim, session, 'manual');
      expect(await service.load(session.slot, 'backup')).toMatchObject({ ok: false, error: 'backupNotAllowed' });
      const record = await storage.read(session.slot);
      await storage.replace(session.slot, { current: { ...record.current!, data: record.current!.data + ' ' }, backup: record.backup, meta: record.meta! });
      expect(await service.load(session.slot)).toMatchObject({ ok: false, error: 'checksum' });
      const backup = await service.load(session.slot, 'backup');
      expect(backup.ok && backup.sim.state.credits).toBe(250);
    });
  });

  describe('overview', () => {
    it('describes healthy, corrupted and too new slots', async () => {
      const ok = await startGame({ difficulty: 'mild', index: 0 });
      const broken = await startGame({ difficulty: 'mild', index: 1 });
      await service.save(broken.sim, broken.session, 'manual');
      const newer = await startGame({ difficulty: 'mild', index: 2 });
      const rb = await storage.read(broken.session.slot);
      await storage.replace(broken.session.slot, { current: { ...rb.current!, checksum: '0' }, backup: rb.backup, meta: rb.meta! });
      const rn = await storage.read(newer.session.slot);
      const { toEnvelope } = await import('../../sim/save/serialize');
      await storage.replace(newer.session.slot, { current: toEnvelope({ version: 99 }), backup: null, meta: rn.meta! });

      const overview = await service.overview();
      expect(overview.map((o) => [o.slot.index, o.state.kind])).toEqual([
        [0, 'ok'],
        [1, 'corrupt'],
        [2, 'tooNew'],
      ]);
      expect(overview[0]!.state).toMatchObject({ kind: 'ok', meta: { gameId: ok.session.gameId } });
      expect(overview[1]!.state).toMatchObject({ kind: 'corrupt', error: 'checksum', backup: { savedAt: expect.any(String) } });
      expect(overview[2]!.state).toMatchObject({ kind: 'tooNew', version: 99 });
    });

    it('picks the most recently saved slot for Continue', async () => {
      expect(await service.latest()).toBeNull();
      const a = await startGame({ difficulty: 'mild', index: 0 });
      await startGame({ difficulty: 'none', index: 0 }, { ...standard, deathPenalty: 'none' });
      await service.save(a.sim, a.session, 'manual');
      expect((await service.latest())?.slot).toEqual({ difficulty: 'mild', index: 0 });
    });

    it('lists free slots for a new game', async () => {
      await startGame({ difficulty: 'mild', index: 1 });
      expect(await service.freeSlot('mild')).toEqual({ difficulty: 'mild', index: 0 });
    });
  });

  describe('hardcore fall', () => {
    it('starts the move at once – the target slot is chosen inside the write, nothing is awaited before it', async () => {
      const { sim, session } = await startGame({ difficulty: 'hardcore', index: 0 }, { ...standard, deathPenalty: 'hardcore' });
      sim.state.settings.deathPenalty = 'hard';
      sim.state.settings.fallenFromHardcore = true;
      const calls: string[] = [];
      const list = storage.list.bind(storage);
      const moveToFree = storage.moveToFree.bind(storage);
      storage.list = () => (calls.push('list'), list());
      storage.moveToFree = (...args) => (calls.push('moveToFree'), moveToFree(...args));
      const pending = service.fallFromHardcore(sim, session);
      // synchronously (closing the card right after death must not drop the move)
      expect(calls).toEqual(['moveToFree']);
      expect((await pending).session.slot).toEqual({ difficulty: 'hard', index: 0 });
    });

    it('moves the game into the hard difficulty even when it is full', async () => {
      for (let i = 0; i < 4; i++) await startGame({ difficulty: 'hard', index: i }, { ...standard, deathPenalty: 'hard' });
      const { sim, session } = await startGame({ difficulty: 'hardcore', index: 1 }, { ...standard, deathPenalty: 'hardcore' });
      sim.state.settings.deathPenalty = 'hard';
      sim.state.settings.fallenFromHardcore = true;
      const fall = await service.fallFromHardcore(sim, session);
      expect(fall.session).toEqual({ ...session, slot: { difficulty: 'hard', index: 4 } });
      expect(fall.outcome).toMatchObject({ status: 'saved', meta: { slot: { difficulty: 'hard', index: 4 }, saveReason: 'death', fallenFromHardcore: true } });
      expect((await storage.read(session.slot)).meta).toBeNull();
      const loaded = await service.load(fall.session.slot);
      expect(loaded.ok && loaded.sim.state.settings).toMatchObject({ deathPenalty: 'hard', fallenFromHardcore: true });
    });
  });

  describe('delete, export and import', () => {
    let session: GameSession;
    beforeEach(async () => {
      session = (await startGame()).session;
    });

    it('deletes a slot', async () => {
      await service.delete(session.slot);
      expect(await storage.list()).toEqual([]);
    });

    it('exports a slot and imports it into a free slot of its difficulty', async () => {
      const file = await service.exportSlot(session.slot);
      expect(file?.fileName).toMatch(/^cinderbelt-1337-\d{4}-\d{2}-\d{2}\.cinder$/);
      await service.delete(session.slot);
      const imported = await service.importFile(file!.text);
      expect(imported).toMatchObject({ ok: true, meta: { slot: { difficulty: 'mild', index: 0 }, gameId: session.gameId } });
      const loaded = await service.load(session.slot);
      expect(loaded.ok && loaded.sim.state.player.dock).toEqual({ mode: 'docked', stationId: HOME_STATION_ID });
    });

    it('refuses an import when the difficulty has no free slot', async () => {
      const file = await service.exportSlot(session.slot);
      for (let i = 1; i < 4; i++) await startGame({ difficulty: 'mild', index: i });
      expect(await service.importFile(file!.text)).toMatchObject({ ok: false, error: 'noFreeSlot' });
    });

    it('reports the version of an import saved by a newer game', async () => {
      const { toEnvelope } = await import('../../sim/save/serialize');
      const file = JSON.stringify(toEnvelope({ version: 99 }));
      expect(await service.importFile(file)).toMatchObject({ ok: false, error: 'tooNew', version: 99 });
    });

    it('reports a broken import file', async () => {
      expect(await service.importFile('{')).toMatchObject({ ok: false, error: 'json' });
    });
  });
});
