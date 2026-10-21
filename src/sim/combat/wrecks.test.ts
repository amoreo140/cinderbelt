import { describe, expect, it } from 'vitest';
import { emptyCargo } from '../../data/resources';
import type { PartInventory } from '../../data/parts';
import { createGrid } from '../ship/grid';
import { combatShip } from './testing';
import {
  createWreck,
  emptyLoot,
  lootEmpty,
  partsInventory,
  salvageTarget,
  salvageWreck,
  SALVAGE_RANGE,
  stepWreck,
  WRECK_FADE_TICKS,
  WRECK_KEEP_RANGE,
  wreckKept,
  WRECK_TTL,
} from './wrecks';

const DT = 1 / 60;

describe('createWreck', () => {
  it('places the wreck exactly where the parts were on the ship', () => {
    const ship = combatShip(createGrid([['cockpit', 0, 0], ['armor', 1, 0], ['cannon', 2, 0]]), { x: 50, y: -20 }, Math.PI);
    const piece = ship.grid.parts.slice(2);
    const w = createWreck(7, piece, ship, { vel: { x: 1, y: 2 }, angVel: 0.5 }, emptyLoot(), 'pirate');
    // cannon (2, 0) is 2 − CoM.x ahead of the centre of mass; the ship points along −x
    expect(w.body.pos.x).toBeCloseTo(50 - (2 - ship.props.centerOfMass.x));
    expect(w.body.pos.y).toBeCloseTo(-20);
    expect(w.body.angle).toBe(Math.PI);
    expect(w.body.vel).toEqual({ x: 1, y: 2 });
    expect(w.grid.parts).toEqual(piece);
    expect(w.grid.parts[0]).not.toBe(piece[0]);
    expect(w.ttl).toBe(WRECK_TTL);
    expect(w).toMatchObject({ id: 7, livery: 'pirate' });
  });
});

describe('stepWreck', () => {
  it('drifts, slows down and counts down its lifetime', () => {
    const ship = combatShip(createGrid([['armor', 0, 0]]));
    const w = createWreck(1, ship.grid.parts, ship, { vel: { x: 6, y: 0 }, angVel: 1 }, emptyLoot(), 'default');
    stepWreck(w, [], DT);
    expect(w.body.pos.x).toBeCloseTo(0.1, 2);
    expect(w.body.vel.x).toBeLessThan(6);
    expect(w.body.angVel).toBeLessThan(1);
    expect(w.ttl).toBe(WRECK_TTL - 1);
    expect(w.prevBody.pos.x).toBe(0);
  });
});

describe('wrecks near the player', () => {
  const wreckAt = (x: number, ttl: number) => {
    const ship = combatShip(createGrid([['armor', 0, 0]]), { x, y: 0 });
    const w = createWreck(1, ship.grid.parts, ship, { vel: { x: 0, y: 0 }, angVel: 0 }, emptyLoot(), 'default');
    w.ttl = ttl;
    return w;
  };

  it('a wreck near the player never reaches its fade, a far one expires', () => {
    const near = wreckAt(WRECK_KEEP_RANGE - 10, 200);
    const far = wreckAt(WRECK_KEEP_RANGE + 50, 200);
    expect(wreckKept(near, { x: 0, y: 0 })).toBe(true);
    expect(wreckKept(far, { x: 0, y: 0 })).toBe(false);
    for (let i = 0; i < 1000; i++) {
      stepWreck(near, [], DT, wreckKept(near, { x: 0, y: 0 }));
      stepWreck(far, [], DT, wreckKept(far, { x: 0, y: 0 }));
    }
    expect(near.ttl).toBe(WRECK_FADE_TICKS + 1);
    expect(far.ttl).toBeLessThanOrEqual(0);
  });

  it('keeps counting down normally above the fade and resumes once the player leaves', () => {
    const w = wreckAt(0, WRECK_FADE_TICKS + 5);
    for (let i = 0; i < 50; i++) stepWreck(w, [], DT, true);
    expect(w.ttl).toBe(WRECK_FADE_TICKS + 1);
    for (let i = 0; i < 200; i++) stepWreck(w, [], DT, false);
    expect(w.ttl).toBeLessThanOrEqual(0);
  });
});

describe('salvage', () => {
  const make = (pos = { x: 0, y: 0 }) => {
    const ship = combatShip(createGrid([['armor', 0, 0]]), pos);
    const loot = { cargo: { ...emptyCargo(), iron: 30, titanium: 4 }, parts: { 'cannon:1': 1 } as PartInventory };
    return createWreck(1, ship.grid.parts, ship, { vel: { x: 0, y: 0 }, angVel: 0 }, loot, 'pirate');
  };

  it('finds the nearest wreck with loot within range', () => {
    const w = make({ x: 10, y: 0 });
    expect(salvageTarget([w], { x: 10 - 1 - SALVAGE_RANGE - w.props.boundingRadius + 0.5, y: 0 }, 1)).toBe(w);
    expect(salvageTarget([w], { x: -10, y: 0 }, 1)).toBeNull();
    w.loot = emptyLoot();
    expect(salvageTarget([w], { x: 8, y: 0 }, 1)).toBeNull();
  });

  it('loads resources up to the free cargo and all parts into the salvage hold', () => {
    const w = make();
    const cargo = { ...emptyCargo(), ice: 50 };
    const salvage: PartInventory = { 'cannon:1': 2 };
    const r = salvageWreck(w, cargo, 70, salvage);
    expect(r).toEqual({ cargo: { iron: 20 }, parts: { 'cannon:1': 1 }, cargoFull: true });
    expect(cargo).toEqual({ ...emptyCargo(), ice: 50, iron: 20 });
    expect(salvage).toEqual({ 'cannon:1': 3 });
    expect(w.loot.cargo.iron).toBe(10);
    expect(w.loot.cargo.titanium).toBe(4);
    expect(lootEmpty(w.loot)).toBe(false);
    const again = salvageWreck(w, cargo, 200, salvage);
    expect(again).toEqual({ cargo: { iron: 10, titanium: 4 }, parts: {}, cargoFull: false });
    expect(lootEmpty(w.loot)).toBe(true);
  });

  it('counts parts as an inventory', () => {
    const g = createGrid([['armor', 0, 0], ['armor', 1, 0, 0, 2], ['cannon', 2, 0]]);
    expect(partsInventory(g.parts)).toEqual({ 'armor:1': 1, 'armor:2': 1, 'cannon:1': 1 });
  });
});
