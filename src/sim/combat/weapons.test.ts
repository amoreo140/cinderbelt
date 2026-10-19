import { describe, expect, it } from 'vitest';
import { add, scale } from '../math/vec2';
import { createGrid } from '../ship/grid';
import { CANNON_HALF_ARC, cannonDirection, fireWeapons, leadPoint, tickCooldowns } from './weapons';
import { combatShip } from './testing';

const ids = () => ({ nextId: 1 });

describe('cannonDirection', () => {
  it('aims anywhere within ±60° of the part facing (user decision 2026-10-17)', () => {
    expect(CANNON_HALF_ARC).toBeCloseTo(Math.PI / 3);
    const d = cannonDirection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 })!;
    expect(d.x).toBeCloseTo(Math.SQRT1_2);
    expect(d.y).toBeCloseTo(Math.SQRT1_2);
    expect(cannonDirection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1.6 })).not.toBeNull();
    expect(cannonDirection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1.8 })).toBeNull();
    expect(cannonDirection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0.2 })).toBeNull();
  });

  it('with effective arcs only fires inside them', () => {
    const arcs = [[-0.2, 0.5]] as const;
    expect(cannonDirection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10, y: 3 }, arcs)).not.toBeNull();
    expect(cannonDirection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10, y: -5 }, arcs)).toBeNull();
    expect(cannonDirection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10, y: 0 }, [])).toBeNull();
  });
});

describe('fireWeapons', () => {
  const grid = createGrid([['cockpit', 0, 0], ['cannon', 1, 0, 0], ['cannon', 0, 1, 1], ['reactor', -1, 0]]);

  it('fires every ready cannon toward the aim, spending energy and starting the cooldown', () => {
    const ship = combatShip(grid, { x: 10, y: 0 });
    ship.body = { ...ship.body, vel: { x: 3, y: 0 } };
    const counter = ids();
    const energy = ship.energy;
    const shots = fireWeapons(ship, 'player', { x: 40, y: 30 }, counter);
    expect(shots).toHaveLength(2);
    expect(counter.nextId).toBe(3);
    const [a] = shots;
    expect(a).toMatchObject({ id: 1, owner: 'player', damage: 6, tier: 1, ttl: Math.ceil((85 / 75) * 60) });
    // ship speed + 75 u/s in the aiming direction
    const dir = { x: a!.vel.x - 3, y: a!.vel.y };
    expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(75);
    expect(ship.energy).toBeCloseTo(energy - 4);
    expect(ship.cooldowns.get(2)).toBe(20);
    expect(ship.cooldowns.get(3)).toBe(20);
    // no shooting on the next step – the cannons are recharging
    expect(fireWeapons(ship, 'player', { x: 40, y: 30 }, counter)).toHaveLength(0);
  });

  it('skips cannons whose arc does not cover the aim', () => {
    const ship = combatShip(grid);
    // target straight to the lower right: cannon 2 (+x) yes, cannon 3 (+y) no
    const shots = fireWeapons(ship, 'player', { x: 10, y: -10 }, ids());
    expect(shots).toHaveLength(1);
    expect(ship.cooldowns.has(3)).toBe(false);
  });

  it('does not fire without energy', () => {
    const ship = combatShip(grid);
    ship.energy = 1.5;
    expect(fireWeapons(ship, 'player', { x: 10, y: 10 }, ids())).toHaveLength(0);
  });

  it('counts the cooldown down', () => {
    const ship = combatShip(grid);
    ship.cooldowns.set(2, 2);
    tickCooldowns(ship);
    expect(ship.cooldowns.get(2)).toBe(1);
    tickCooldowns(ship);
    expect(ship.cooldowns.has(2)).toBe(false);
  });
});

describe('leadPoint', () => {
  it('aims where a projectile meets a moving target', () => {
    const shooter = { x: 0, y: 0 };
    const target = { x: 50, y: 0 };
    const targetVel = { x: 0, y: 20 };
    const p = leadPoint(shooter, { x: 0, y: 0 }, target, targetVel, 80);
    const d = Math.hypot(p.x, p.y);
    const t = d / 80;
    const there = add(target, scale(targetVel, t));
    expect(p.x).toBeCloseTo(there.x, 4);
    expect(p.y).toBeCloseTo(there.y, 4);
  });

  it('falls back to the target position when it cannot be caught', () => {
    expect(leadPoint({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 200, y: 0 }, 80)).toEqual({ x: 50, y: 0 });
  });
});
