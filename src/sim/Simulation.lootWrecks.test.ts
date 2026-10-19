// Loot and wrecks (I3, I7, M20): dumped cargo without a wreck, damaged own parts, pirates without debris.
import { describe, expect, it } from 'vitest';
import { scrapResources } from '../data/economy';
import { IDLE_COMMAND } from './commands';
import { createEnemy } from './combat/enemies';
import { cellWorld } from './combat/projectiles';
import type { Projectile } from './combat/types';
import { lootEmpty } from './combat/wrecks';
import { cellOwners } from './combat/geometry';
import { createGrid } from './ship/grid';
import { computeProperties } from './ship/properties';
import type { ShipGrid } from './ship/types';
import { Simulation, type SimEvent } from './Simulation';
import type { ChunkGenerator } from './world/generate';

const emptySpace: ChunkGenerator = (_s, cx, cy) => ({ cx, cy, asteroids: [] });

function flyingSim(grid: ShipGrid): Simulation {
  const sim = new Simulation({ seed: 5, grid, startDocked: false, generator: emptySpace });
  const body = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
  sim.state.player.body = body;
  sim.state.player.prevBody = body;
  sim.state.player.shield = 0;
  return sim;
}

/** A projectile that hits cell `cell` of ship `ship` from below in a few steps (direction +y). */
function shotAt(ship: { body: Simulation['state']['player']['body']; props: Simulation['state']['player']['props'] }, cell: { x: number; y: number }, owner: string, damage = 1000): Projectile {
  const target = cellWorld(ship, cell);
  const pos = { x: target.x, y: target.y - 4 };
  return { id: 999, owner, pos, vel: { x: 0, y: 60 }, ttl: 30, damage, tier: 1, origin: pos };
}

function runUntil(sim: Simulation, done: (events: SimEvent[]) => boolean, max = 30): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < max; i++) {
    const events = sim.step(IDLE_COMMAND);
    all.push(...events);
    if (done(events)) break;
  }
  return all;
}

describe('I3 – spilled cargo from a destroyed cargo hold forms a loot wreck', () => {
  it('puts the cargo over the new capacity into a wreck at the destroyed hold', () => {
    // the cargo bay hangs only on the cockpit – after its destruction nothing breaks off
    const sim = flyingSim(createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ['cargo', 0, -1]]));
    const p = sim.state.player;
    p.cargo.iron = 50;
    const holdWorld = cellWorld(p, { x: 0, y: -1 });
    sim.state.combat.projectiles.push(shotAt(p, { x: 0, y: -1 }, 'pr:test'));
    const events = runUntil(sim, (e) => e.some((x) => x.type === 'cargoSpilled'));
    const spill = events.find((e) => e.type === 'cargoSpilled');
    expect(spill).toBeDefined();
    if (spill?.type !== 'cargoSpilled') return;
    expect(spill.cargo.iron).toBeCloseTo(40);
    expect(spill.toWreck).not.toBeNull();
    const wreck = sim.state.combat.wrecks.find((w) => w.id === spill.toWreck)!;
    expect(wreck.loot.cargo.iron).toBeCloseTo(40);
    expect(wreck.loot.parts).toEqual({});
    expect(Math.hypot(wreck.body.pos.x - holdWorld.x, wreck.body.pos.y - holdWorld.y)).toBeLessThan(1);
    expect(p.cargo.iron).toBeCloseTo(10);
  });

  it('keeps the 50 % spill of a destroyed large cargo hold in a wreck too', () => {
    const sim = flyingSim(createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ['largeCargo', 0, -2], ['cargo', 1, 0]]));
    const p = sim.state.player;
    p.cargo.copper = 60;
    sim.state.combat.projectiles.push(shotAt(p, { x: 0, y: -2 }, 'pr:test'));
    const events = runUntil(sim, (e) => e.some((x) => x.type === 'cargoSpilled'));
    const spill = events.find((e) => e.type === 'cargoSpilled');
    if (spill?.type !== 'cargoSpilled') throw new Error('no spill');
    expect(spill.cargo.copper).toBeCloseTo(30);
    expect(spill.toWreck).not.toBeNull();
    expect(sim.state.combat.wrecks.find((w) => w.id === spill.toWreck)!.loot.cargo.copper).toBeCloseTo(30);
  });
});

describe('I7 – own detached damaged parts are salvaged as scrap', () => {
  it('returns intact parts as parts and damaged parts as scrap resources', () => {
    // armour 2 holds armour 3 and 4; destroying armour 2 detaches them
    const sim = flyingSim(createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ['armor', 1, 0], ['armor', 2, 0], ['armor', 2, 1]]));
    const p = sim.state.player;
    p.hp.set(4, 20); // armor:1 has 40 HP → half
    sim.state.combat.projectiles.push(shotAt(p, { x: 1, y: 0 }, 'pr:test'));
    runUntil(sim, (e) => e.some((x) => x.type === 'partDestroyed'));
    expect(sim.state.combat.wrecks).toHaveLength(1);
    // a player wreck remembers the fleet ship it broke off (M4a – part ids repeat across ships)
    expect(sim.state.combat.wrecks[0]!.ship).toBe(sim.state.fleet.active.id);
    const loot = sim.state.combat.wrecks[0]!.loot;
    expect(loot.parts).toEqual({ 'armor:1': 1 });
    expect(loot.cargo.iron).toBe(scrapResources('armor:1', 20, 40).iron);
    expect(loot.cargo.iron).toBeGreaterThan(0);
  });

  it('scrap is a share of the recipe scaled by the remaining HP, rounded down', () => {
    expect(scrapResources('armor:1', 40, 40)).toEqual({ iron: 7 });
    expect(scrapResources('armor:1', 20, 40)).toEqual({ iron: 3 });
    expect(scrapResources('engine:1', 1, 25)).toEqual({});
    expect(scrapResources('cockpit:2', 105, 105)).toEqual({ titanium: 20, iron: 10, copper: 25, ice: 10 });
  });
});

describe('M20 – a pirate destroyed in one hit still leaves its loot', () => {
  it('creates a loot wreck when the cockpit dies together with every other part', () => {
    const sim = flyingSim(createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0]]));
    const e = createEnemy({ id: 'pr:test:solo', kind: 'jackal', tier: 1, pos: { x: 30, y: 0 }, angle: Math.PI, home: { x: 30, y: 0 }, orbit: 1 });
    const grid = createGrid([['cockpit', 0, 0]]);
    e.grid = grid;
    e.props = computeProperties(grid);
    e.shield = 0;
    e.hp = new Map();
    sim.state.combat.enemies.push(e);
    expect(cellOwners(grid).size).toBe(1);
    sim.state.combat.projectiles.push(shotAt(e, { x: 0, y: 0 }, 'player'));
    const events = runUntil(sim, (ev) => ev.some((x) => x.type === 'shipDestroyed'));
    expect(events.some((x) => x.type === 'shipDestroyed')).toBe(true);
    expect(sim.state.combat.wrecks).toHaveLength(1);
    const w = sim.state.combat.wrecks[0]!;
    expect(w.livery).toBe('pirate');
    expect(lootEmpty(w.loot)).toBe(false);
    expect(Math.hypot(w.body.pos.x - 30, w.body.pos.y)).toBeLessThan(2);
  });
});
