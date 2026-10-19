// Ram damage (M21): proportional to the impact speed above the safe threshold.
import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND } from './commands';
import { RAM_SAFE_SPEED, ramDamage } from './combat/ram';
import { createEnemy } from './combat/enemies';
import type { Vec2 } from './math/vec2';
import { hullHp } from './ship/hp';
import { Simulation, type SimEvent } from './Simulation';
import type { ChunkGenerator } from './world/generate';
import { homeStation } from './world/stations';

const rockAt = (pos: Vec2, radius = 4): ChunkGenerator => (_s, cx, cy) => ({
  cx,
  cy,
  asteroids: cx === 0 && cy === 0 ? [{ id: 'rock', pos, baseRadius: radius, resource: 'iron', initialAmount: 100, variant: 0 }] : [],
});
const emptySpace: ChunkGenerator = (_s, cx, cy) => ({ cx, cy, asteroids: [] });

/** A ship (starter, no shield) flying along +x at speed `speed` with no dampers. */
function coasting(generator: ChunkGenerator, speed: number): Simulation {
  const sim = new Simulation({ seed: 3, generator, startDocked: false });
  const p = sim.state.player;
  p.dampers = false;
  p.body = { pos: { x: 0, y: 0 }, vel: { x: speed, y: 0 }, angle: 0, angVel: 0 };
  p.prevBody = p.body;
  return sim;
}

function run(sim: Simulation, steps: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < steps; i++) events.push(...sim.step(IDLE_COMMAND));
  return events;
}

const hull = (sim: Simulation) => hullHp(sim.state.player.grid, sim.state.player.hp).current;

/** A motionless jackal without shield and cannons in front of the ship (the AI neither moves it nor fires). */
function dummyJackal(sim: Simulation) {
  const e = createEnemy({ id: 'pr:test:ram', kind: 'jackal', tier: 1, pos: { x: 12, y: 0 }, angle: Math.PI, home: { x: 12, y: 0 }, orbit: 1 });
  e.shield = 0;
  e.props = { ...e.props, weapons: [], thrust: { forward: 0, backward: 0, left: 0, right: 0 }, torque: 0 };
  sim.state.combat.enemies.push(e);
  return e;
}

function runUntilCollision(sim: Simulation, max: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < max; i++) {
    const step = sim.step(IDLE_COMMAND);
    events.push(...step);
    if (step.some((e) => e.type === 'collision')) break;
  }
  return events;
}

describe('ramDamage', () => {
  it('is zero up to the safe speed (docking speed) and grows linearly above it', () => {
    expect(ramDamage(0)).toBe(0);
    expect(ramDamage(RAM_SAFE_SPEED)).toBe(0);
    expect(ramDamage(RAM_SAFE_SPEED + 10)).toBeCloseTo(2 * ramDamage(RAM_SAFE_SPEED + 5));
    expect(ramDamage(RAM_SAFE_SPEED + 10)).toBeGreaterThan(0);
  });
});

describe('M21 – ramming an asteroid', () => {
  it('damages the cell that hit the rock in proportion to the impact speed', () => {
    const sim = coasting(rockAt({ x: 16, y: 0 }), 25);
    const before = hull(sim);
    const events = runUntilCollision(sim, 60);
    const hit = events.find((e) => e.type === 'collision');
    expect(hit).toBeDefined();
    if (hit?.type !== 'collision') return;
    expect(hit.speed).toBeGreaterThan(RAM_SAFE_SPEED);
    expect(hit.damage).toBeCloseTo(ramDamage(hit.speed));
    expect(before - hull(sim)).toBeCloseTo(ramDamage(hit.speed));
    // the front part is hit (mining laser in the middle of the bow, id 3)
    expect(sim.state.player.hp.has(3)).toBe(true);
  });

  it('a slow bump does no damage', () => {
    const sim = coasting(rockAt({ x: 16, y: 0 }), RAM_SAFE_SPEED - 1);
    const before = hull(sim);
    const events = run(sim, 180);
    expect(events.some((e) => e.type === 'collision')).toBe(true);
    expect(hull(sim)).toBe(before);
  });

  it('stations never damage the ship (docking stays safe)', () => {
    const station = { ...homeStation(), id: 'st:0,0', pos: { x: 25, y: 0 }, colliders: [{ pos: { x: 0, y: 0 }, radius: 5 }] };
    const gen: ChunkGenerator = (_s, cx, cy) => ({ cx, cy, asteroids: [], ...(cx === 0 && cy === 0 ? { station } : {}) });
    const sim = coasting(gen, 30);
    const before = hull(sim);
    const events = run(sim, 90);
    expect(events.some((e) => e.type === 'collision')).toBe(true);
    expect(hull(sim)).toBe(before);
  });
});

describe('M21 – ramming another ship', () => {
  it('damages both ships, the lighter one more', () => {
    const sim = coasting(emptySpace, 0);
    const p = sim.state.player;
    const e = dummyJackal(sim);
    p.body = { ...p.body, vel: { x: 30, y: 0 } };
    const enemyHull = () => hullHp(e.grid, e.hp).current;
    const before = { player: hull(sim), enemy: enemyHull() };
    const events = runUntilCollision(sim, 60);
    const hit = events.find((x) => x.type === 'collision');
    if (hit?.type !== 'collision') throw new Error('no collision');
    const lost = { player: before.player - hull(sim), enemy: before.enemy - enemyHull() };
    expect(lost.player).toBeGreaterThan(0);
    expect(lost.enemy).toBeGreaterThan(0);
    // the impulse is split by mass – the lighter jackal gets more
    const lighter = e.props.mass < p.props.mass ? lost.enemy : lost.player;
    const heavier = e.props.mass < p.props.mass ? lost.player : lost.enemy;
    expect(lighter).toBeGreaterThan(heavier);
  });

  it('touching at low relative speed does no damage', () => {
    const sim = coasting(emptySpace, 0);
    dummyJackal(sim);
    sim.state.player.body = { ...sim.state.player.body, vel: { x: 4, y: 0 } };
    const before = hull(sim);
    run(sim, 120);
    expect(hull(sim)).toBe(before);
  });
});
