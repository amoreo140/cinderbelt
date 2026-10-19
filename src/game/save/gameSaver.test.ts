import { beforeEach, describe, expect, it } from 'vitest';
import { RESOURCE_IDS } from '../../data/resources';
import { applyDeath } from '../../sim/death/death';
import type { SlotRef } from '../../sim/save/types';
import type { DifficultyChoice } from '../../sim/settings';
import { MemorySaveStorage } from '../storage/memoryStorage';
import { GameSaver } from './gameSaver';
import { SaveService } from './saveService';

const resource = RESOURCE_IDS[0]!;

describe('GameSaver', () => {
  let storage: MemorySaveStorage;
  let service: SaveService;
  let writes: string[];

  beforeEach(() => {
    storage = new MemorySaveStorage();
    let ids = 0;
    service = new SaveService(storage, { gameVersion: '0.0.1', newId: () => `game-${++ids}` });
    writes = [];
    const write = storage.write.bind(storage);
    const moveToFree = storage.moveToFree.bind(storage);
    storage.write = (...args) => (writes.push(`write ${args[0].difficulty}/${args[0].index}`), write(...args));
    storage.moveToFree = (...args) => (writes.push(`move ${args[0].difficulty}/${args[0].index} → ${args[1]}`), moveToFree(...args));
  });

  async function start(difficulty: DifficultyChoice['deathPenalty']) {
    const slot: SlotRef = { difficulty, index: 0 };
    const started = await service.newGame({ slot, seedText: '1337', choice: { deathPenalty: difficulty, enemyDensity: 'normal', miningYield: 1 } });
    if (!started.ok) throw new Error(started.error);
    writes.length = 0;
    return { sim: started.sim, saver: new GameSaver(service, started.session) };
  }

  const slots = async () => (await storage.list()).map((m) => `${m.slot.difficulty}/${m.slot.index}`);

  it('saves a destroyed ship only as a death snapshot, written at once, so the next start applies the penalty', async () => {
    const { sim, saver } = await start('mild');
    sim.state.player.cargo[resource] = 10;
    sim.state.player.destroyed = true;
    expect(await saver.save(sim, 'interval')).toBeNull();
    expect(writes).toEqual([]);

    const pending = saver.save(sim, 'death');
    // the write started synchronously – reloading the page during the death sequence does not drop it
    expect(writes).toEqual(['write mild/0']);
    expect(await pending).toMatchObject({ status: 'saved', meta: { saveReason: 'death' } });

    // next start: destroyed ship → death card → penalty
    const loaded = await service.load(saver.session.slot);
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.sim.state.player.destroyed).toBe(true);
    applyDeath(loaded.sim);
    await new GameSaver(service, loaded.session).save(loaded.sim, 'death');
    const after = await service.load(saver.session.slot);
    if (!after.ok) throw new Error(after.error);
    expect(after.sim.state.player.destroyed).toBe(false);
    expect(after.sim.state.stats.deaths).toBe(1);
    expect(after.sim.state.player.cargo[resource]).toBe(0);
  });

  it('hardcore: saves after the penalty wait for the move and never recreate the hardcore slot', async () => {
    const { sim, saver } = await start('hardcore');
    sim.state.player.destroyed = true;
    await saver.save(sim, 'death');
    expect(await slots()).toEqual(['hardcore/0']);

    applyDeath(sim);
    const death = saver.save(sim, 'death');
    expect(saver.moving).toBe(true);
    const autosave = saver.save(sim, 'dock');
    expect(writes).toEqual(['write hardcore/0', 'move hardcore/0 → hard']);
    expect(await death).toMatchObject({ status: 'saved', meta: { slot: { difficulty: 'hard', index: 0 }, fallenFromHardcore: true } });
    expect(await autosave).toMatchObject({ status: 'saved', meta: { slot: { difficulty: 'hard', index: 0 }, saveReason: 'dock' } });
    expect(saver.moving).toBe(false);
    expect(saver.session.slot).toEqual({ difficulty: 'hard', index: 0 });
    expect(await slots()).toEqual(['hard/0']);
  });

  it('a failed move keeps the hardcore slot (with the destroyed ship) and the next save retries it', async () => {
    const { sim, saver } = await start('hardcore');
    sim.state.player.destroyed = true;
    await saver.save(sim, 'death');
    applyDeath(sim);
    storage.failWrites = true;
    expect(await saver.save(sim, 'death')).toMatchObject({ status: 'failed' });
    expect(saver.session.slot).toEqual({ difficulty: 'hardcore', index: 0 });
    const kept = await service.load({ difficulty: 'hardcore', index: 0 });
    expect(kept.ok && kept.sim.state.player.destroyed).toBe(true);

    storage.failWrites = false;
    expect(await saver.save(sim, 'interval')).toMatchObject({ status: 'saved', meta: { slot: { difficulty: 'hard', index: 0 } } });
    expect(saver.session.slot).toEqual({ difficulty: 'hard', index: 0 });
    expect(await slots()).toEqual(['hard/0']);
  });
});
