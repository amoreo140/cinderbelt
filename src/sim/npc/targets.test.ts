// M4d T4: whom a pirate fights (plan §2.3 "Pirates' response") and the AI ship budget (DH §12.4).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WATCH } from '../../data/guild';
import { AGGRO_RANGE, LEASH_RANGE } from '../combat/ai';
import { createEnemy } from '../combat/enemies';
import type { Enemy, EnemyKind } from '../combat/types';
import type { NpcHitTarget } from './types';
import { Simulation } from '../Simulation';
import type { ChunkGenerator } from '../world/generate';
import { npcTarget, syntheticWatch } from './testing';
import { npcBudgetLeft, pirateTarget } from './targets';

const escorts = vi.hoisted(() => ({ list: [] as NpcHitTarget[] }));

vi.mock('../convoys', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../convoys')>();
  return { ...mod, escortHitTargets: () => escorts.list };
});

const emptySpace: ChunkGenerator = (_s, cx, cy) => ({ cx, cy, asteroids: [] });

function flying(): Simulation {
  return new Simulation({ seed: 77, startDocked: false, generator: emptySpace });
}

function pirate(sim: Simulation, pos: { x: number; y: number }, kind: EnemyKind = 'jackal', id = 'pr:test:0'): Enemy {
  const e = createEnemy({ id, kind, tier: 1, pos, angle: 0, home: pos, orbit: 1 });
  sim.state.combat.enemies.push(e);
  return e;
}

beforeEach(() => {
  escorts.list = [];
});

describe('pirateTarget', () => {
  it('without NPC ships: the flying player at any distance (the pre-M4d rule), null when docked or dead', () => {
    const sim = flying();
    const e = pirate(sim, { x: 2000, y: 0 });
    expect(pirateTarget(sim.state, e)?.pos).toBe(sim.state.player.body.pos);
    sim.state.player.destroyed = true;
    expect(pirateTarget(sim.state, e)).toBeNull();
  });

  it('the player within aggro wins over a nearer Watch ship', () => {
    const sim = flying();
    const e = pirate(sim, { x: 120, y: 0 });
    sim.state.guild.watch.push(syntheticWatch('gw:lane:A:0|0', { x: 140, y: 0 }));
    expect(pirateTarget(sim.state, e)?.pos).toBe(sim.state.player.body.pos);
  });

  it('without the player in aggro it fights the nearest live Watch ship within aggro (with its velocity)', () => {
    const sim = flying();
    const e = pirate(sim, { x: 600, y: 0 });
    const far = syntheticWatch('gw:lane:A:0|0', { x: 600, y: 120 });
    const near = syntheticWatch('gw:lane:A:0|1', { x: 600, y: -60 }, 'cutter', { x: 5, y: -3 });
    sim.state.guild.watch.push(far, near);
    const t = pirateTarget(sim.state, e)!;
    expect(t.pos).toBe(near.body.pos);
    expect(t.vel).toEqual({ x: 5, y: -3 });
    // the same when the player is docked
    sim.state.player.dock = { ...sim.state.player.dock, mode: 'docked' } as typeof sim.state.player.dock;
    expect(pirateTarget(sim.state, e)?.pos).toBe(near.body.pos);
  });

  it('a Watch ship beyond aggro is ignored by a patrolling pirate; a fighting one keeps it to the leash', () => {
    const sim = flying();
    const e = pirate(sim, { x: 2000, y: 0 });
    const w = syntheticWatch('gw:lane:A:0|0', { x: 2000 + AGGRO_RANGE.jackal + 50, y: 0 });
    sim.state.guild.watch.push(w);
    expect(pirateTarget(sim.state, e)?.pos).toBe(sim.state.player.body.pos);
    e.ai.mode = 'attack';
    expect(pirateTarget(sim.state, e)?.pos).toBe(w.body.pos);
    w.body = { ...w.body, pos: { x: 2000 + LEASH_RANGE + 10, y: 0 } };
    expect(pirateTarget(sim.state, e)?.pos).toBe(sim.state.player.body.pos);
  });

  it('a fighting pirate keeps the player when the player is the nearer opponent', () => {
    const sim = flying();
    const e = pirate(sim, { x: AGGRO_RANGE.jackal + 40, y: 0 });
    e.ai.mode = 'attack';
    sim.state.guild.watch.push(syntheticWatch('gw:lane:A:0|0', { x: AGGRO_RANGE.jackal + 40, y: 300 }));
    expect(pirateTarget(sim.state, e)?.pos).toBe(sim.state.player.body.pos);
  });

  it('a destroyed Watch ship (hull 0) is no target', () => {
    const sim = flying();
    const e = pirate(sim, { x: 600, y: 0 });
    const w = syntheticWatch('gw:lane:A:0|0', { x: 640, y: 0 });
    w.hull = 0;
    sim.state.guild.watch.push(w);
    expect(pirateTarget(sim.state, e)?.pos).toBe(sim.state.player.body.pos);
  });

  it('an escort-ambush pirate goes for its trader first – even with the player in aggro', () => {
    const sim = flying();
    const e = pirate(sim, { x: 60, y: 0 }, 'hammer', 'ea:5:0:1');
    const trader = npcTarget('es:5:trader', { x: 380, y: 0 }, { vel: { x: 10, y: 0 } });
    escorts.list = [npcTarget('es:5:tanker', { x: 368, y: 0 }), trader, npcTarget('es:6:trader', { x: 70, y: 0 })];
    const t = pirateTarget(sim.state, e)!;
    expect(t.pos).toBe(trader.pos);
    expect(t.vel).toEqual({ x: 10, y: 0 });
    // with its trader gone it follows the normal rules: the player in aggro
    escorts.list = [npcTarget('es:5:tanker', { x: 368, y: 0 })];
    expect(pirateTarget(sim.state, e)?.pos).toBe(sim.state.player.body.pos);
  });

  it('an ordinary pirate fights an escorted convoy ship within aggro like a Watch ship; a scheduled convoy ship is no target', () => {
    const sim = flying();
    const e = pirate(sim, { x: 800, y: 0 });
    const tanker = npcTarget('es:5:tanker', { x: 900, y: 0 });
    escorts.list = [npcTarget('cv:A@1:trader', { x: 820, y: 0 }, { damageable: false }), tanker];
    expect(pirateTarget(sim.state, e)?.pos).toBe(tanker.pos);
    expect(pirateTarget(sim.state, e)?.vel).toEqual({ x: 0, y: 0 });
  });

  it('scavengers, sentries, sleepers and a toll hail keep the player as their target', () => {
    const sim = flying();
    sim.state.guild.watch.push(syntheticWatch('gw:lane:A:0|0', { x: 610, y: 0 }));
    const hail = pirate(sim, { x: 600, y: 0 }, 'jackal', 'pr:test:hail');
    hail.ai.mode = 'hail';
    expect(pirateTarget(sim.state, hail)?.pos).toBe(sim.state.player.body.pos);
    const sleeper = pirate(sim, { x: 600, y: 0 }, 'jackal', 'gy:1,1:s0');
    sleeper.ai.mode = 'dormant';
    expect(pirateTarget(sim.state, sleeper)?.pos).toBe(sim.state.player.body.pos);
    const scav = pirate(sim, { x: 600, y: 0 }, 'scavenger', 'sc:test:0');
    expect(pirateTarget(sim.state, scav)?.pos).toBe(sim.state.player.body.pos);
  });

  it('is stateless: asking twice changes nothing', () => {
    const sim = flying();
    const e = pirate(sim, { x: 600, y: 0 });
    sim.state.guild.watch.push(syntheticWatch('gw:lane:A:0|0', { x: 640, y: 0 }));
    const before = JSON.stringify(e);
    expect(pirateTarget(sim.state, e)).toEqual(pirateTarget(sim.state, e));
    expect(JSON.stringify(e)).toBe(before);
  });
});

describe('npcBudgetLeft', () => {
  it('pirates + live Watch + escort convoy ships share WATCH.aiBudget', () => {
    const sim = flying();
    expect(npcBudgetLeft(sim.state)).toBe(WATCH.aiBudget);
    pirate(sim, { x: 600, y: 0 });
    pirate(sim, { x: 650, y: 0 }, 'hammer', 'pr:test:1');
    sim.state.guild.watch.push(syntheticWatch('gw:lane:A:0|0', { x: 640, y: 0 }));
    escorts.list = [npcTarget('es:5:trader', { x: 0, y: 900 }), npcTarget('es:5:tanker', { x: 0, y: 912 })];
    expect(npcBudgetLeft(sim.state)).toBe(WATCH.aiBudget - 5);
  });
});
