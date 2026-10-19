// Ambush (M4b T1): party table, spawn, bearing, one-shot across save/load, toll hail, end, AI budget.
import { describe, expect, it } from 'vitest';
import type { RingIndex } from '../../data/economy';
import { AMBUSH } from '../../data/events';
import { TOLL } from '../../data/pirates';
import { createEnemy } from '../combat/enemies';
import { IDLE_COMMAND, type PlayerCommand } from '../commands';
import { fnv1a32 } from '../math/fnv1a';
import { createRng } from '../math/rng';
import { dangerousSector } from '../pirates/sectors';
import { loadSave } from '../save/load';
import { restoreSimulation, toEnvelope, toSave } from '../save/serialize';
import { testContext } from '../save/testing';
import { Simulation, type SimEvent } from '../Simulation';
import { hash3 } from '../world/hash';
import { ambushBudgetOk, ambushGroup, ambushParty } from './ambush';
import { BUCKET_TICKS, rolledKey } from './director';
import { findSpot, ofType, parkedAt, steps, type Spot } from './testing';

const SEED = 4242;
const LEAD = AMBUSH.leadSeconds * 60;

const force = (kind: 'ambush' | 'micrometeors'): PlayerCommand => ({ ...IDLE_COMMAND, actions: [{ type: 'debugEvent', kind, reqId: 1 }] });

function contested(): { sim: Simulation; spot: Spot } {
  const probe = new Simulation({ seed: SEED, startDocked: false });
  const spot = findSpot(probe, 2, 'contested');
  return { sim: parkedAt(SEED, spot.pos), spot };
}

function roundTrip(sim: Simulation): Simulation {
  const result = loadSave(toEnvelope(toSave(sim, testContext())));
  if (!result.ok) throw new Error(`load failed: ${result.error} ${result.details.join('; ')}`);
  // the director state (quiet window, one-shot keys) travels in the save (V17)
  return restoreSimulation(result.save);
}

describe('ambush party', () => {
  it('by depth: Hammer + 1–2 Jackals at depth 2; 3 ships at 3 (Gunner leader ~30 %); 3–4 T2 ships at 4', () => {
    const sizes: Record<number, Set<number>> = { 2: new Set(), 3: new Set(), 4: new Set() };
    let gunners = 0;
    const n = 10_000;
    for (let b = 0; b < n; b++) {
      for (const depth of [2, 3, 4] as RingIndex[]) {
        const p = ambushParty(SEED, 'rg:A:3.3', b, depth);
        sizes[depth]!.add(p.kinds.length);
        expect(p.kinds.slice(1).every((k) => k === 'jackal')).toBe(true);
        expect(p.tier).toBe(depth === 4 ? 2 : 1);
        if (depth === 2) expect(p.kinds[0]).toBe('hammer');
        else expect(['hammer', 'gunner']).toContain(p.kinds[0]);
        if (depth === 3 && p.kinds[0] === 'gunner') gunners++;
      }
    }
    expect([...sizes[2]!].sort()).toEqual([2, 3]);
    expect([...sizes[3]!]).toEqual([3]);
    expect([...sizes[4]!].sort()).toEqual([3, 4]);
    expect(Math.abs(gunners / n - AMBUSH.gunnerLeaderChance) / AMBUSH.gunnerLeaderChance).toBeLessThan(0.1);
    // depth 1 (only a forced event) gets the depth-2 party
    expect(ambushParty(SEED, 'x', 4, 1)).toEqual(ambushParty(SEED, 'x', 4, 2));
  });

  it('the AI budget: fewer than 4 enemies within 600 u and fewer than 7 in all', () => {
    const { sim, spot } = contested();
    const add = (i: number, d: number) =>
      sim.state.combat.enemies.push(createEnemy({ id: `pr:800,${i}:0`, kind: 'jackal', tier: 1, pos: { x: spot.pos.x + d, y: spot.pos.y }, angle: 0, home: spot.pos, orbit: 1 }));
    sim.state.combat.enemies = [];
    for (let i = 0; i < 3; i++) add(i, 100 + i * 50);
    for (let i = 3; i < 6; i++) add(i, 900 + i * 50);
    expect(ambushBudgetOk(sim.state)).toBe(true);
    add(6, 200);
    expect(ambushBudgetOk(sim.state)).toBe(false);
    sim.state.combat.enemies.splice(6, 1);
    add(6, 1500);
    expect(ambushBudgetOk(sim.state)).toBe(false);
  });
});

describe('ambush in the game', () => {
  it('warns with the bearing, spawns the party 300 u away from a dangerous sector after 6 s, in attack', () => {
    const { sim, spot } = contested();
    sim.state.tick = 5 * BUCKET_TICKS + 10;
    const warn = ofType(sim.step(force('ambush')), 'eventWarning')[0]!;
    const key = rolledKey('ambush', spot.sector, 5);
    expect(warn).toMatchObject({ key, kind: 'ambush', inSeconds: AMBUSH.leadSeconds });
    const events = steps(sim, LEAD);
    const spawned = ofType(events, 'ambushSpawned');
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({ key, leader: 'hammer' });
    expect(ofType(events, 'eventStarted')).toEqual([expect.objectContaining({ key, kind: 'ambush', dir: warn.dir })]);
    const party = sim.state.combat.enemies.filter((e) => e.id.startsWith(`${ambushGroup(spot.sector, 5)}:`));
    expect(party.length).toBe(spawned[0]!.count);
    expect(party.length).toBeGreaterThanOrEqual(2);
    expect(party.every((e) => e.ai.mode === 'attack' || e.ai.mode === 'hail')).toBe(true);
    const at = spawned[0]!.pos;
    expect(Math.hypot(at.x - spot.pos.x, at.y - spot.pos.y)).toBeCloseTo(AMBUSH.spawnDistance, 0);
    expect(dangerousSector(sim.state, at)).toBe(true);
  });

  it('spawns once across save and load – before and after the spawn', () => {
    const { sim } = contested();
    sim.state.tick = 7 * BUCKET_TICKS + 30;
    sim.step(force('ambush'));
    steps(sim, 60);
    // saved during the warning: the loaded game spawns exactly like the original
    const loaded = roundTrip(sim);
    const a = steps(sim, LEAD);
    const b = steps(loaded, LEAD);
    expect(ofType(b, 'ambushSpawned')).toEqual(ofType(a, 'ambushSpawned'));
    expect(ofType(a, 'ambushSpawned')).toHaveLength(1);
    // saved after the spawn: never again
    const again = roundTrip(sim);
    const later: SimEvent[] = [...steps(sim, 600), ...steps(again, 600)];
    expect(ofType(later, 'ambushSpawned')).toEqual([]);
    expect(JSON.stringify(toSave(again, testContext()))).toBe(JSON.stringify(toSave(sim, testContext())));
    expect([...again.state.director.fired]).toEqual([...sim.state.director.fired]);
  });

  it('a Hammer-led party may hail for a toll when it closes in; the hail is decided once', () => {
    const { sim, spot } = contested();
    // a bucket whose hail roll succeeds in a Contested sector
    let bucket = 3;
    while (createRng(hash3(SEED ^ AMBUSH.salt, fnv1a32(ambushGroup(spot.sector, bucket)), 7))() >= TOLL.chance.contested) bucket++;
    sim.state.tick = bucket * BUCKET_TICKS + 5;
    sim.step(force('ambush'));
    const events = steps(sim, LEAD + 1);
    expect(ofType(events, 'ambushSpawned')).toHaveLength(1);
    // the leader closes in (attack mode); the hail comes within its aggro range
    const key = rolledKey('ambush', spot.sector, bucket);
    let toll: SimEvent[] = [];
    for (let i = 0; i < 60 * 30 && toll.length === 0; i++) toll = ofType(sim.step(IDLE_COMMAND), 'tollDemanded');
    expect(toll).toEqual([expect.objectContaining({ group: ambushGroup(spot.sector, bucket) })]);
    expect(sim.state.pirates.toll?.group).toBe(ambushGroup(spot.sector, bucket));
    expect(sim.state.director.fired.has(`${key}#hail`)).toBe(true);
    const more = steps(sim, 600);
    expect(ofType(more, 'tollDemanded').filter((e) => e.group === ambushGroup(spot.sector, bucket))).toEqual([]);
  });

  it('ends when the party is gone and opens the quiet window from then', () => {
    const { sim, spot } = contested();
    sim.state.tick = 9 * BUCKET_TICKS + 5;
    sim.step(force('ambush'));
    steps(sim, LEAD + 1);
    const key = rolledKey('ambush', spot.sector, 9);
    sim.state.combat.enemies = sim.state.combat.enemies.filter((e) => !e.id.startsWith('ab:'));
    const tick = sim.state.tick;
    const ended = ofType(sim.step(IDLE_COMMAND), 'eventEnded');
    expect(ended).toEqual([{ type: 'eventEnded', key, kind: 'ambush' }]);
    expect(sim.state.director.fired.get(`${key}#end`)).toBe(tick);
    expect(sim.state.director.last).toBe(tick);
    expect(ofType(steps(sim, 60), 'eventEnded')).toEqual([]);
  });
});
