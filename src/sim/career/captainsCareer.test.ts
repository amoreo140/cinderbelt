import { describe, expect, it } from 'vitest';
import { TRAITS } from '../../data/captains';
import { IDLE_COMMAND } from '../commands';
import { captainDef, captainLevel, createCaptainEnemy } from '../captains/captains';
import { Simulation, type SimEvent } from '../Simulation';
import { homeOnly } from '../station/testHarness';
import type { Contract } from './types';
import { stepCareer } from './career';

function flyingSim(): Simulation {
  const sim = new Simulation({ seed: 5, generator: homeOnly, startDocked: false });
  return sim;
}

function captainContract(sim: Simulation, captain: number, pos = { x: 300, y: 0 }): Contract {
  const c: Contract = {
    id: 'home@0.0',
    type: 'hunt',
    faction: 'guild',
    station: 'home',
    ring: 2,
    risk: 0.5,
    target: { kind: 'captain', captain, pos },
    modifiers: [],
    bonus: 0,
    part: null,
    serial: sim.state.career.nextId++,
    acceptedTick: 0,
    seconds: 600,
    reward: 20000,
    rep: 30,
    progress: 0,
    base: 0,
    ready: false,
  };
  sim.state.career.contracts.push(c);
  return c;
}

describe('named captains in combat', () => {
  it('a captain hunt spawns the captain near its revealed position', () => {
    const sim = flyingSim();
    captainContract(sim, 3);
    for (let i = 0; i < 31; i++) sim.step(IDLE_COMMAND);
    const e = sim.state.combat.enemies.find((x) => x.id === 'cap:3');
    expect(e).toBeDefined();
    const def = captainDef(5, 3)!;
    expect(e!.grid.parts.length).toBe(createCaptainEnemy(3, captainLevel(def, undefined), { x: 0, y: 0 }, 0).grid.parts.length);
  });

  it('destroying the captain completes the hunt and fills the trophy hall', () => {
    const sim = flyingSim();
    const c = captainContract(sim, 2);
    sim.state.career.captains.set(2, { promotions: 0, defeated: false, trophies: ['engine:2'], kills: 1 });
    sim.state.combat.enemies.push(createCaptainEnemy(2, 1, { x: 300, y: 0 }, 0));
    stepCareer(sim.state, []);
    expect(sim.state.career.engaged.has(2)).toBe(true);
    sim.state.combat.enemies = [];
    const events = stepCareer(sim.state, [{ type: 'shipDestroyed', ref: 'cap:2', kind: 'hammer', pos: { x: 300, y: 0 }, vel: { x: 0, y: 0 }, radius: 3 }]);
    expect(events).toContainEqual({ type: 'captainDefeated', captain: 2 });
    expect(events).toContainEqual({ type: 'contractReady', contractId: c.serial });
    expect(sim.state.career.captains.get(2)!.defeated).toBe(true);
    expect(sim.state.career.trophies).toEqual([{ captain: 2, parts: ['engine:2'] }]);
  });

  it('a captain that kills the player is promoted and keeps only a replica (nothing is lost)', () => {
    const sim = flyingSim();
    const def = captainDef(5, 1)!;
    const grid = structuredClone(sim.state.player.grid);
    sim.state.combat.enemies.push(createCaptainEnemy(1, 1, { x: 40, y: 0 }, 0));
    const events = stepCareer(sim.state, [{ type: 'playerDestroyed', pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, radius: 3 }]);
    const promoted = events.find((e) => e.type === 'captainPromoted');
    expect(promoted).toMatchObject({ captain: 1 });
    const s = sim.state.career.captains.get(1)!;
    expect(s.promotions).toBe(1);
    expect(s.kills).toBe(1);
    expect(s.trophies).toHaveLength(TRAITS[def.trait].replicas);
    expect(sim.state.player.grid).toEqual(grid);
  });

  it('a captain that leaves the fight badly damaged escaped and is promoted', () => {
    const sim = flyingSim();
    const e = createCaptainEnemy(4, 1, { x: 300, y: 0 }, 0);
    sim.state.combat.enemies.push(e);
    for (const p of e.grid.parts) if (p.partId !== 'cockpit') e.hp.set(p.id, 0.01);
    stepCareer(sim.state, []);
    sim.state.combat.enemies = [];
    const events: SimEvent[] = stepCareer(sim.state, []);
    expect(events.find((x) => x.type === 'captainPromoted')).toMatchObject({ captain: 4 });
  });

  it('a captain that leaves healthy (despawn) is not promoted', () => {
    const sim = flyingSim();
    sim.state.combat.enemies.push(createCaptainEnemy(4, 1, { x: 300, y: 0 }, 0));
    stepCareer(sim.state, []);
    sim.state.combat.enemies = [];
    expect(stepCareer(sim.state, [])).toEqual([]);
    expect(sim.state.career.captains.get(4)).toBeUndefined();
  });
});

describe('hunt contracts in combat', () => {
  it('a hunt contract spawns its group near the player', async () => {
    const { spawnSlots } = await import('../combat/enemies');
    // chunk with a group in ring 2 (deterministic from seed 5)
    let target: { cx: number; cy: number; ids: string[]; pos: { x: number; y: number } } | null = null;
    for (let cx = 8; cx < 20 && !target; cx++) {
      for (let cy = -6; cy <= 6 && !target; cy++) {
        const slots = spawnSlots(5, cx, cy, 'normal');
        if (slots.length > 0) target = { cx, cy, ids: slots.map((s) => s.id), pos: slots[0]!.home };
      }
    }
    expect(target).not.toBeNull();
    const sim = new Simulation({ seed: 5, generator: homeOnly, startDocked: false });
    const c: Contract = {
      id: 'home@0.1', type: 'hunt', faction: 'guild', station: 'home', ring: 2, risk: 0.25,
      target: { kind: 'hunt', cx: target!.cx, cy: target!.cy, slots: target!.ids, pos: target!.pos },
      modifiers: [], bonus: 0, part: null, serial: 1, acceptedTick: 0, seconds: 600, reward: 3000, rep: 30, progress: 0, base: 0, ready: false,
    };
    sim.state.career.contracts.push(c);
    // player 300 u from the group
    const body = { pos: { x: target!.pos.x + 300, y: target!.pos.y }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    sim.state.player.body = body;
    sim.state.player.prevBody = body;
    sim.state.tick = 0;
    sim.step(IDLE_COMMAND);
    const ids = sim.state.combat.enemies.map((e) => e.id);
    for (const id of target!.ids) expect(ids).toContain(id);
  });
});

describe('accepting a hunt', () => {
  it('brings back a recently destroyed group', async () => {
    const { dockedSim, act, expectOk } = await import('../station/testHarness');
    const sim = dockedSim();
    sim.step(IDLE_COMMAND);
    const board = sim.state.career.boards.get('home')!;
    board.offers.push({
      id: 'home@0.88', type: 'hunt', faction: 'guild', station: 'home', ring: 2, risk: 0.25,
      target: { kind: 'hunt', cx: 9, cy: 1, slots: ['pr:9,1:0', 'pr:9,1:1'], pos: { x: 1900, y: 300 } }, modifiers: [], bonus: 0, part: null,
    });
    sim.state.combat.defeated.set('pr:9,1:0', 5);
    sim.state.combat.defeated.set('pr:1,1:0', 5);
    expectOk(act(sim, { type: 'acceptContract', offerId: 'home@0.88' }));
    expect(sim.state.combat.defeated.has('pr:9,1:0')).toBe(false);
    expect(sim.state.combat.defeated.has('pr:1,1:0')).toBe(true);
  });
});
