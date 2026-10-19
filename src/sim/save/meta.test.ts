import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND, type GameAction } from '../commands';
import { dockedSim } from '../station/testHarness';
import { toSave } from './serialize';
import { slotMetaFor } from './meta';
import { testContext } from './testing';

describe('slotMetaFor', () => {
  it('summarises a docked save for the slot list', () => {
    const sim = dockedSim();
    for (let i = 0; i < 120; i++) sim.step(IDLE_COMMAND);
    const save = toSave(sim, testContext('dock'));
    const meta = slotMetaFor(save, { difficulty: 'mild', index: 2 }, true);
    expect(meta).toEqual({
      slot: { difficulty: 'mild', index: 2 },
      gameId: 'game-1',
      name: 'Testovacia hra',
      version: 20,
      createdAt: '2026-10-17T10:00:00.000Z',
      savedAt: '2026-10-17T12:00:00.000Z',
      saveReason: 'dock',
      playTimeTicks: 120,
      seed: 1,
      seedText: '',
      deathPenalty: 'mild',
      enemyDensity: 'normal',
      miningYield: 1,
      fallenFromHardcore: false,
      credits: sim.state.credits,
      location: { kind: 'docked', stationId: 'home', ring: 1 },
      partCount: sim.state.player.grid.parts.length,
      hasBackup: true,
    });
  });

  it('reports the ring when the ship is in space', () => {
    const sim = dockedSim();
    sim.step({ ...IDLE_COMMAND, actions: [{ reqId: 1, type: 'undock' } as GameAction] });
    sim.state.player.body = { ...sim.state.player.body, pos: { x: 2500, y: 0 } };
    const meta = slotMetaFor(toSave(sim, testContext()), { difficulty: 'hard', index: 0 }, false);
    expect(meta.location).toEqual({ kind: 'space', ring: 2, pos: { x: 2500, y: 0 } });
  });
});
