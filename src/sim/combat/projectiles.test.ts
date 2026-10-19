import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../math/vec2';
import type { Circle } from '../physics/collide';
import { createGrid } from '../ship/grid';
import { shaped } from '../ship/testing';
import type { AsteroidCircle } from '../world/World';
import { cellWorld, nextLivePart, stepProjectiles, shieldRadius, type ProjectileWorld } from './projectiles';
import { combatShip } from './testing';
import type { Projectile, Wreck } from './types';

const DT = 1 / 60;

const empty: ProjectileWorld = { circlesNear: () => [], stationCirclesNear: () => [] };

function worldWith(rocks: AsteroidCircle[], stations: Circle[] = []): ProjectileWorld {
  return { circlesNear: () => rocks, stationCirclesNear: () => stations };
}

function shot(pos: Vec2, vel: Vec2, owner = 'player', ttl = 60): Projectile {
  return { id: 1, owner, pos, vel, ttl, damage: 6, tier: 1, origin: pos };
}

describe('stepProjectiles', () => {
  it('moves projectiles and expires them after their flight time', () => {
    const r = stepProjectiles([shot({ x: 0, y: 0 }, { x: 60, y: 0 }, 'player', 2)], [], [], empty, DT);
    expect(r.hits).toEqual([]);
    expect(r.alive).toHaveLength(1);
    expect(r.alive[0]!.pos.x).toBeCloseTo(1);
    expect(r.alive[0]!.ttl).toBe(1);
    expect(stepProjectiles(r.alive, [], [], empty, DT).alive).toEqual([]);
  });

  it('hits the first cell of an enemy ship (DDA in the ship frame)', () => {
    // an enemy at (10, 0) turned by 90°: cells (0,0) cockpit, (1,0) armour → the armour is at world y = +1
    const enemy = combatShip(createGrid([['cockpit', 0, 0], ['armor', 1, 0]]), { x: 10, y: 0 }, Math.PI / 2);
    const armorWorldY = enemy.body.pos.y + (1 - enemy.props.centerOfMass.x);
    const p = shot({ x: 10, y: armorWorldY + 1.0 }, { x: 0, y: -90 });
    const r = stepProjectiles([p], [{ ref: 'e1', ship: enemy }], [], empty, DT);
    expect(r.alive).toEqual([]);
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]).toMatchObject({ kind: 'ship', ref: 'e1', partId: 2, shielded: false });
    expect(r.hits[0]!.pos.y).toBeCloseTo(armorWorldY + 0.5);
  });

  it('stops at the shield bubble and still reports the part behind it', () => {
    const enemy = combatShip(createGrid([['cockpit', 0, 0], ['shield', -1, 0]]), { x: 0, y: 0 });
    const r0 = shieldRadius(enemy.props);
    const p = shot({ x: r0 + 1, y: 0 }, { x: -90, y: 0 });
    const r = stepProjectiles([p], [{ ref: 'e1', ship: enemy }], [], empty, DT);
    expect(r.hits[0]).toMatchObject({ kind: 'ship', shielded: true, partId: 1 });
    expect(r.hits[0]!.pos.x).toBeCloseTo(r0);
  });

  it('ignores the owner and lets pirates not hit each other', () => {
    const a = combatShip(createGrid([['cockpit', 0, 0]]), { x: 1, y: 0 });
    const own = stepProjectiles([shot({ x: 0, y: 0 }, { x: 60, y: 0 }, 'e1')], [{ ref: 'e1', ship: a }, { ref: 'e2', ship: a }], [], empty, DT);
    expect(own.hits).toEqual([]);
    const player = stepProjectiles([shot({ x: 0, y: 0 }, { x: 60, y: 0 }, 'e1')], [{ ref: 'player', ship: a }], [], empty, DT);
    expect(player.hits).toHaveLength(1);
  });

  it('is stopped by asteroids and stations in front of a ship', () => {
    const enemy = combatShip(createGrid([['cockpit', 0, 0]]), { x: 3, y: 0 });
    const rock: AsteroidCircle = {
      asteroid: { id: '0,0:1', pos: { x: 1, y: 0 }, baseRadius: 0.5, resource: 'iron', initialAmount: 10, variant: 0 },
      circle: { pos: { x: 1, y: 0 }, radius: 0.5 },
    };
    const r = stepProjectiles([shot({ x: 0, y: 0 }, { x: 180, y: 0 })], [{ ref: 'e1', ship: enemy }], [], worldWith([rock]), DT);
    expect(r.hits[0]).toMatchObject({ kind: 'asteroid', asteroidId: '0,0:1' });
    const s = stepProjectiles([shot({ x: 0, y: 0 }, { x: 180, y: 0 })], [], [], worldWith([], [{ pos: { x: 2, y: 0 }, radius: 1 }]), DT);
    expect(s.hits[0]).toMatchObject({ kind: 'station' });
    expect(s.hits[0]!.pos.x).toBeCloseTo(1);
  });
});

describe('shaped parts (polygon hits)', () => {
  // a row along the bow: cockpit (0,0) – armour (1,0) laid as a half plate (solid for y ∈ [−½, 0])
  const halfBow = () => shaped(createGrid([['cockpit', 0, 0], ['armor', 1, 0]]), 2, 'half');

  it('a shot through the empty half of a plate hits the part behind it, the spark on its edge', () => {
    const enemy = combatShip(halfBow(), { x: 0, y: 0 });
    enemy.shield = 0;
    const high = cellWorld(enemy, { x: 0, y: 0.3 }).y;
    const r = stepProjectiles([shot({ x: 3, y: high }, { x: -180, y: 0 })], [{ ref: 'e1', ship: enemy }], [], empty, DT);
    expect(r.hits[0]).toMatchObject({ kind: 'ship', partId: 1, shielded: false });
    expect(r.hits[0]!.pos.x).toBeCloseTo(cellWorld(enemy, { x: 0.5, y: 0 }).x);
    const low = cellWorld(enemy, { x: 0, y: -0.3 }).y;
    const r2 = stepProjectiles([shot({ x: 3, y: low }, { x: -180, y: 0 })], [{ ref: 'e1', ship: enemy }], [], empty, DT);
    expect(r2.hits[0]).toMatchObject({ kind: 'ship', partId: 2 });
    expect(r2.hits[0]!.pos.x).toBeCloseTo(cellWorld(enemy, { x: 1.5, y: 0 }).x);
  });

  it('shield overflow lands on the polygon: through the empty half to the part behind', () => {
    const enemy = combatShip(shaped(createGrid([['cockpit', 0, 0], ['armor', 1, 0], ['shield', -1, 0]]), 2, 'half'), { x: 0, y: 0 });
    const r0 = shieldRadius(enemy.props);
    const high = cellWorld(enemy, { x: 0, y: 0.3 }).y;
    const r = stepProjectiles([shot({ x: r0 + 1, y: high }, { x: -90, y: 0 })], [{ ref: 'e1', ship: enemy }], [], empty, DT);
    expect(r.hits[0]).toMatchObject({ kind: 'ship', shielded: true, partId: 1 });
    const low = cellWorld(enemy, { x: 0, y: -0.3 }).y;
    const r2 = stepProjectiles([shot({ x: r0 + 1, y: low }, { x: -90, y: 0 })], [{ ref: 'e1', ship: enemy }], [], empty, DT);
    expect(r2.hits[0]).toMatchObject({ kind: 'ship', shielded: true, partId: 2 });
  });

  it('nextLivePart goes through a destroyed wedge and past the empty half of a live plate', () => {
    // cockpit (0,0) – half plate (1,0) – wedge (2,0), the wedge destroyed
    const grid = shaped(shaped(createGrid([['cockpit', 0, 0], ['armor', 1, 0], ['armor', 2, 0]]), 2, 'half'), 3, 'wedge');
    const ship = combatShip(grid, { x: 0, y: 0 });
    ship.hp.set(3, 0);
    const vel = { x: -90, y: 0 };
    expect(nextLivePart(ship, cellWorld(ship, { x: 2.3, y: 0.3 }), vel)).toBe(1);
    expect(nextLivePart(ship, cellWorld(ship, { x: 2.3, y: -0.3 }), vel)).toBe(2);
    // without the shapes the plate in (1,0) is full
    const plain = combatShip(createGrid([['cockpit', 0, 0], ['armor', 1, 0], ['armor', 2, 0]]), { x: 0, y: 0 });
    plain.hp.set(3, 0);
    expect(nextLivePart(plain, cellWorld(plain, { x: 2.3, y: 0.3 }), vel)).toBe(2);
  });

  it('a wreck is hit on its polygon too', () => {
    const ship = combatShip(halfBow(), { x: 0, y: 0 });
    const w = { id: 7, grid: ship.grid, props: ship.props, body: ship.body } as unknown as Wreck;
    const high = cellWorld(ship, { x: 0, y: 0.3 }).y;
    const r = stepProjectiles([shot({ x: 3, y: high }, { x: -180, y: 0 })], [], [w], empty, DT);
    expect(r.hits[0]).toMatchObject({ kind: 'wreck', wreckId: 7 });
    expect(r.hits[0]!.pos.x).toBeCloseTo(cellWorld(ship, { x: 0.5, y: 0 }).x);
  });
});
