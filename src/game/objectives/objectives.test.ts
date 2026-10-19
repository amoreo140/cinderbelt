import { describe, expect, it } from 'vitest';
import { RECIPES } from '../../data/economy';
import { SHIP_GOALS } from '../../data/shipGoals';
import { isPartKey } from '../../data/parts';
import { IDLE_COMMAND } from '../../sim/commands';
import { dockedSim } from '../../sim/station/testHarness';
import { trainingSim } from '../../sim/training/testing';
import { computeObjectives, storyObjective } from './objectives';

describe('ship goals data', () => {
  it('lists valid craftable parts with positive counts', () => {
    for (const g of SHIP_GOALS) {
      expect(isPartKey(g.key)).toBe(true);
      expect(RECIPES[g.key]).toBeDefined();
      expect(g.count).toBeGreaterThan(0);
    }
  });
});

describe('computeObjectives', () => {
  it('a training game shows only the training step now (no ship or story goal), career + ring goals this week', () => {
    const sim = trainingSim(1337);
    const list = computeObjectives(sim.state);
    expect(list[0]).toMatchObject({ scale: 'now', track: 'training', id: 'training:flyBuoy', target: sim.state.career.training.sites!.buoyA });
    expect(list.filter((o) => o.scale === 'now')).toHaveLength(1);
    expect(list.some((o) => o.track === 'ship' || o.track === 'story')).toBe(false);
    expect(list.find((o) => o.id === 'career:guild')).toMatchObject({ scale: 'week' });
    expect(list.find((o) => o.id === 'main:ring2')?.target).not.toBeNull();
    for (const o of list) {
      expect(o.title.length).toBeGreaterThan(0);
      expect(o.why.length).toBeGreaterThan(0);
    }
  });

  it('a game without the training shows a ship goal today', () => {
    expect(computeObjectives(dockedSim().state).find((o) => o.track === 'ship')).toMatchObject({ scale: 'today', id: 'ship:cargo:1' });
  });

  it('without the training and contracts it suggests the board when docked', () => {
    const sim = dockedSim();
    expect(computeObjectives(sim.state)[0]).toMatchObject({ id: 'hint:board', scale: 'now' });
  });

  it('active contracts are now-objectives with a target', () => {
    const sim = dockedSim();
    sim.step(IDLE_COMMAND);
    const board = sim.state.career.boards.get('home')!;
    board.offers.push({
      id: 'home@0.77', type: 'survey', faction: 'institute', station: 'home', ring: 1, risk: 0,
      target: { kind: 'survey', points: [{ x: 300, y: 0 }, { x: 350, y: 0 }] }, modifiers: [], bonus: 0, part: null,
    });
    sim.step({ ...IDLE_COMMAND, actions: [{ type: 'acceptContract', offerId: 'home@0.77', reqId: 1 }] });
    const o = computeObjectives(sim.state).find((x) => x.track === 'contract')!;
    expect(o.target).toEqual({ x: 300, y: 0 });
    expect(o.progress).toEqual({ value: 0, max: 2 });
    expect(o.contract).toBe(1);
  });

  it('the ship goal says what is missing and moves on once the ship has it', () => {
    const sim = dockedSim();
    sim.state.credits = 0;
    const ship = computeObjectives(sim.state).find((o) => o.track === 'ship')!;
    expect(ship.title).toMatch(/Nákladný priestor T1/);
    expect(ship.title).toMatch(/Železo/);
    const grid = sim.state.player.grid;
    grid.parts.push({ id: grid.nextId++, partId: 'cargo', tier: 1, x: 3, y: 0, rot: 0 });
    expect(computeObjectives(sim.state).find((o) => o.track === 'ship')!.id).toBe('ship:miningLaser:1');
  });

  it('career objective shows the assignment once the points are there', () => {
    const sim = dockedSim();
    sim.state.career.rep.guild = { points: 300, level: 1, assignments: { 'guild2-deliveries': 1 } };
    const o = computeObjectives(sim.state).find((x) => x.id === 'career:guild')!;
    expect(o.title).toMatch(/Cech 2: 3× Dodávka \(1\/3\) ALEBO 2× Záchrana \(0\/2\)/);
  });
});

describe('story objective (Echoes, M3.5b)', () => {
  it('walks Echo-0 → decoder → Echo-1 → shard → Echo-2 and never reveals an unlocated echo', () => {
    const sim = dockedSim();
    const d = sim.state.discovery;
    const step = () => storyObjective(sim.state);
    expect(step()).toMatchObject({ id: 'story:echo0fix', target: null, progress: { value: 0, max: 3 } });
    d.known.add('echo:0');
    expect(step()?.id).toBe('story:echo0');
    expect(step()?.target).not.toBeNull();
    d.scanned.add('echo:0');
    expect(step()?.id).toBe('story:decoder');
    d.archive.add('echoDecoder');
    const listen = step()!;
    expect(listen.id).toBe('story:echo1fix');
    // smer von (2 000 j), nie poloha Ozveny-1
    expect(Math.hypot(listen.target!.x, listen.target!.y)).toBeCloseTo(2000, 6);
    d.scanned.add('echo:1');
    expect(step()?.id).toBe('story:shard');
    d.keyItems.add('shard');
    expect(step()?.id).toBe('story:echo2fix');
    d.scanned.add('echo:2');
    expect(step()).toBeNull();
    expect(computeObjectives(sim.state).some((o) => o.track === 'story')).toBe(false);
  });

});
