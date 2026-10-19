// M4d T4: projectiles against NPC targets – the side table decides which shots stop at a Watch ship, a
// convoy ship or the relay mast (no friendly fire: player shots fly through), the nearest target along
// the path takes the shot, the shield bubble is hit before the hull, and the owner module gets the hit.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SHIELD_MARGIN } from '../combat/projectiles';
import type { Projectile } from '../combat/types';
import { Simulation, type SimEvent } from '../Simulation';
import type { ChunkGenerator } from '../world/generate';
import { npcProjectiles } from './hits';
import { npcTarget } from './testing';
import type { NpcHit, NpcHitTarget } from './types';

const npc = vi.hoisted(() => ({
  watch: [] as NpcHitTarget[],
  convoys: [] as NpcHitTarget[],
  masts: [] as NpcHitTarget[],
  hits: [] as { target: string; hit: NpcHit }[],
}));

vi.mock('../guild', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../guild')>();
  return {
    ...mod,
    watchHitTargets: () => npc.watch,
    relayMastHitTargets: () => npc.masts,
    onWatchHit: (_s: unknown, target: NpcHitTarget, hit: NpcHit) => npc.hits.push({ target: target.id, hit }),
  };
});
vi.mock('../convoys', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../convoys')>();
  return {
    ...mod,
    convoyHitTargets: () => npc.convoys,
    onConvoyHit: (_s: unknown, target: NpcHitTarget, hit: NpcHit) => npc.hits.push({ target: target.id, hit }),
  };
});

const DT = 1 / 60;
const emptySpace: ChunkGenerator = (_s, cx, cy) => ({ cx, cy, asteroids: [] });

function shot(owner: string, x: number, vx = 300, id = 1): Projectile {
  return { id, owner, pos: { x, y: 0 }, vel: { x: vx, y: 0 }, ttl: 30, damage: 7, tier: 1, origin: { x, y: 0 } };
}

function fire(shots: Projectile[]): { sim: Simulation; events: SimEvent[] } {
  const sim = new Simulation({ seed: 77, startDocked: false, generator: emptySpace });
  sim.state.combat.projectiles = shots;
  const events: SimEvent[] = [];
  npcProjectiles(sim.state, events, DT);
  return { sim, events };
}

beforeEach(() => {
  npc.watch = [];
  npc.convoys = [];
  npc.masts = [];
  npc.hits = [];
});

describe('npcProjectiles', () => {
  it('no NPC targets: nothing changes (the same projectile array)', () => {
    const shots = [shot('player', 0)];
    const { sim } = fire(shots);
    expect(sim.state.combat.projectiles).toBe(shots);
  });

  it('player shots pass through Watch and convoy ships (no friendly fire)', () => {
    npc.watch = [npcTarget('gw:lane:A:0|0', { x: 3, y: 0 }, { shield: 60 })];
    npc.convoys = [npcTarget('cv:A@1:trader', { x: 3, y: 0 }), npcTarget('es:2:trader', { x: 3, y: 0 })];
    const { sim, events } = fire([shot('player', 0)]);
    expect(sim.state.combat.projectiles).toHaveLength(1);
    expect(npc.hits).toEqual([]);
    expect(events).toEqual([]);
  });

  it('Watch shots pass through convoy ships and other Watch ships; pirate shots pass nothing', () => {
    npc.watch = [npcTarget('gw:lane:A:0|1', { x: 3, y: 0 })];
    npc.convoys = [npcTarget('es:2:trader', { x: 3, y: 0 })];
    const { sim } = fire([shot('gw:lane:A:0|0', 0)]);
    expect(sim.state.combat.projectiles).toHaveLength(1);
    expect(npc.hits).toEqual([]);
  });

  it('a pirate shot stops at the nearest target on its path and hands the hit to the owner module', () => {
    npc.watch = [npcTarget('gw:lane:A:0|0', { x: 4, y: 0 }, { radius: 1, shield: 0 })];
    npc.convoys = [npcTarget('es:2:trader', { x: 2.5, y: 0 }, { radius: 1 })];
    const { sim } = fire([shot('pr:0,0:0', 0)]);
    expect(sim.state.combat.projectiles).toEqual([]);
    expect(npc.hits).toHaveLength(1);
    const { target, hit } = npc.hits[0]!;
    expect(target).toBe('es:2:trader');
    expect(hit.owner).toBe('pr:0,0:0');
    expect(hit.damage).toBe(7);
    expect(hit.pos.x).toBeCloseTo(1.5);
    expect(hit.from).toEqual({ x: 0, y: 0 });
  });

  it('a shield bubble is hit at radius + SHIELD_MARGIN; without a shield at the hull radius', () => {
    npc.watch = [npcTarget('gw:lane:A:0|0', { x: 4.9, y: 0 }, { radius: 3.6, shield: 60 })];
    fire([shot('pr:0,0:0', 0)]);
    expect(npc.hits[0]!.hit.pos.x).toBeCloseTo(4.9 - 3.6 - SHIELD_MARGIN);
    npc.hits = [];
    npc.watch = [npcTarget('gw:lane:A:0|0', { x: 4.9, y: 0 }, { radius: 3.6, shield: 0 })];
    fire([shot('pr:0,0:0', 0)]);
    expect(npc.hits[0]!.hit.pos.x).toBeCloseTo(4.9 - 3.6);
  });

  it('a shot that starts inside the target radius hits at once', () => {
    npc.convoys = [npcTarget('es:2:trader', { x: 0.5, y: 0 }, { radius: 3 })];
    fire([shot('pr:0,0:0', 0, -300)]);
    expect(npc.hits).toHaveLength(1);
    expect(npc.hits[0]!.hit.pos).toEqual({ x: 0, y: 0 });
  });

  it('every shot stops at the Guild relay mast (a spent structure hit – a projectileHit on a station)', () => {
    npc.masts = [npcTarget('gr:A', { x: 3, y: 0 }, { kind: 'relay', radius: 1.5, damageable: false })];
    const { sim, events } = fire([shot('player', 0, 300, 1), shot('pr:0,0:0', 0, 300, 2), shot('gw:lane:A:0|0', 0, 300, 3)]);
    expect(sim.state.combat.projectiles).toEqual([]);
    expect(events.map((e) => e.type === 'projectileHit' && [e.owner, e.target, e.site])).toEqual([
      ['player', 'station', 'gr:A'],
      ['pr:0,0:0', 'station', 'gr:A'],
      ['gw:lane:A:0|0', 'station', 'gr:A'],
    ]);
  });

  it('a shot that does not reach a target this step flies on (applyHits moves it)', () => {
    npc.watch = [npcTarget('gw:lane:A:0|0', { x: 30, y: 0 })];
    const shots = [shot('pr:0,0:0', 0)];
    const { sim } = fire(shots);
    expect(sim.state.combat.projectiles).toEqual(shots);
    expect(npc.hits).toEqual([]);
  });
});
