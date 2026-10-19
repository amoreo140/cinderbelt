import { describe, expect, it } from 'vitest';
import { applyDeath } from './death/death';
import { IDLE_COMMAND, type PlayerCommand } from './commands';
import { createEnemy, type SpawnSlot } from './combat/enemies';
import { cellWorld } from './combat/projectiles';
import { SPAWN_MIN_DISTANCE, SPAWN_RADIUS, DESPAWN_RADIUS } from './combat/combat';
import type { Enemy } from './combat/types';
import { createGrid } from './ship/grid';
import { createStarterShip } from './ship/presets';
import { Simulation, type SimEvent } from './Simulation';
import { homeOnly } from './station/testHarness';
import { homeStation } from './world/stations';
import type { ChunkGenerator } from './world/generate';

/** Empty space without stations or asteroids. */
const emptySpace: ChunkGenerator = (_s, cx, cy) => ({ cx, cy, asteroids: [] });

/** The player's combat ship: cockpit, 2 cannons, reactor, shield and engines in all directions. */
const fighter = () =>
  createGrid([
    ['cockpit', 0, 0],
    ['cannon', 1, 1, 0],
    ['cannon', 1, -1, 0],
    ['armor', 1, 0, 0],
    ['reactor', -1, 0],
    ['shield', 0, 1],
    ['cargo', 0, -1],
    ['engine', -2, 0, 0],
    ['engine', 2, 0, 2],
    ['engine', -1, 1, 1],
    ['engine', -1, -1, 3],
  ]);

function flyingSim(grid = fighter(), generator: ChunkGenerator = emptySpace, pos = { x: 0, y: 0 }): Simulation {
  const sim = new Simulation({ seed: 77, grid, startDocked: false, generator });
  const body = { pos, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
  sim.state.player.body = body;
  sim.state.player.prevBody = body;
  return sim;
}

const slot = (kind: 'jackal' | 'hammer', pos: { x: number; y: number }, angle = Math.PI): SpawnSlot => ({
  id: `pr:test:${kind}`,
  kind,
  tier: 1,
  pos,
  angle,
  home: pos,
  orbit: 1,
});

function addEnemy(sim: Simulation, kind: 'jackal' | 'hammer', pos: { x: number; y: number }, angle = Math.PI): Enemy {
  const e = createEnemy(slot(kind, pos, angle));
  sim.state.combat.enemies.push(e);
  return e;
}

const fireAt = (target: { x: number; y: number }): PlayerCommand => ({ ...IDLE_COMMAND, aim: target, fire: true });

function run(sim: Simulation, steps: number, cmd: (sim: Simulation, i: number) => PlayerCommand): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < steps; i++) events.push(...sim.step(cmd(sim, i)));
  return events;
}

describe('Simulation – cannons (M3a)', () => {
  it('fires projectiles toward the mouse with the left button', () => {
    const sim = flyingSim();
    const events = sim.step(fireAt({ x: 30, y: 5 }));
    expect(events.filter((e) => e.type === 'shotFired')).toHaveLength(2);
    expect(sim.state.combat.projectiles).toHaveLength(2);
    expect(sim.state.combat.projectiles.every((p) => p.owner === 'player' && p.vel.x > 0)).toBe(true);
    // aim behind the ship – out of the ±90° arc
    const sim2 = flyingSim();
    expect(sim2.step(fireAt({ x: -30, y: 0 })).some((e) => e.type === 'shotFired')).toBe(false);
  });

  it('destroys parts of an enemy, splits it and leaves a pirate wreck with loot', () => {
    const sim = flyingSim();
    const enemy = addEnemy(sim, 'jackal', { x: 25, y: 0 });
    // let the jackal sit still: no time to react
    enemy.ai.mode = 'patrol';
    const events = run(sim, 600, (s) => {
      const e = s.state.combat.enemies[0];
      if (e) {
        e.body = { ...e.body, vel: { x: 0, y: 0 }, angVel: 0 };
        e.prevBody = e.body;
      }
      return fireAt(e ? e.body.pos : { x: 25, y: 0 });
    });
    const hits = events.filter((e) => e.type === 'projectileHit' && e.ref === enemy.id);
    expect(hits.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'partDestroyed' && e.ref === enemy.id)).toBe(true);
    const destroyed = events.find((e) => e.type === 'shipDestroyed');
    expect(destroyed).toMatchObject({ type: 'shipDestroyed', ref: enemy.id, kind: 'jackal' });
    expect(sim.state.combat.enemies).toEqual([]);
    expect(sim.state.combat.defeated.get(enemy.id)).toBeGreaterThan(0);
    expect(sim.state.stats.kills).toBe(1);
    const wrecks = sim.state.combat.wrecks.filter((w) => w.livery === 'pirate');
    expect(wrecks.length).toBeGreaterThan(0);
    const loot = wrecks.map((w) => w.loot.cargo.iron).reduce((a, b) => a + b, 0);
    expect(loot).toBeGreaterThanOrEqual(4);
  });
});

describe('Simulation – damage to the player', () => {
  it('the shield absorbs hits first, then parts lose HP; regen waits for the delay', () => {
    const sim = flyingSim();
    const player = sim.state.player;
    expect(player.shield).toBe(60);
    const enemy = addEnemy(sim, 'hammer', { x: 22, y: 0 });
    enemy.ai.mode = 'attack';
    const events = run(sim, 240, () => IDLE_COMMAND);
    const playerHits = events.filter((e) => e.type === 'projectileHit' && e.ref === 'player');
    expect(playerHits.length).toBeGreaterThan(0);
    expect(playerHits[0]).toMatchObject({ target: 'shield' });
    expect(player.shield).toBeLessThan(60);
  });

  it('detached player parts become a wreck with the parts as loot and the ship is rebuilt', () => {
    const sim = flyingSim();
    const player = sim.state.player;
    const before = player.grid.parts.length;
    player.shield = 0;
    // the armor (1,0) is enclosed – the shot starts right in its cell
    player.hp.set(4, 1);
    const armorWorld = cellWorld(player, { x: 1, y: 0 });
    sim.state.combat.projectiles.push({
      id: 999, owner: 'pr:x', pos: { x: armorWorld.x + 0.1, y: armorWorld.y }, vel: { x: -80, y: 0 }, ttl: 10, damage: 5, tier: 1, origin: { x: 40, y: 0 },
    });
    const events = sim.step(IDLE_COMMAND);
    expect(events).toContainEqual(expect.objectContaining({ type: 'partDestroyed', ref: 'player', partId: 4, key: 'armor:1' }));
    // the right engine (2,0) hung only on the armor → detached
    expect(player.grid.parts.length).toBe(before - 2);
    expect(player.gridVersion).toBe(1);
    const wreck = sim.state.combat.wrecks.at(-1)!;
    expect(wreck.livery).toBe('default');
    expect(wreck.loot.parts).toEqual({ 'engine:1': 1 });
    expect(player.props.thrust.backward).toBe(0);
  });

  it('a destroyed large cargo hold spills 50 % of the cargo (spec 3.3), then the overflow', () => {
    const grid = createGrid([['cockpit', 0, 0], ['largeCargo', 1, 0], ['cargo', 0, -1], ['engine', -1, 0]]);
    const sim = flyingSim(grid);
    const player = sim.state.player;
    player.shield = 0;
    player.cargo.iron = 100;
    player.cargo.copper = 20;
    player.hp.set(2, 1);
    const cell = cellWorld(player, { x: 2, y: 0 });
    sim.state.combat.projectiles.push({
      id: 998, owner: 'pr:x', pos: { x: cell.x + 0.1, y: cell.y }, vel: { x: -80, y: 0 }, ttl: 10, damage: 5, tier: 1, origin: { x: 40, y: 0 },
    });
    const events = sim.step(IDLE_COMMAND);
    expect(events).toContainEqual(expect.objectContaining({ type: 'partDestroyed', ref: 'player', partId: 2, key: 'largeCargo:1' }));
    // 50% dumped (50 Fe + 10 Cu remain), capacity 70 suffices – no further surplus
    expect(player.cargo.iron).toBeCloseTo(50);
    expect(player.cargo.copper).toBeCloseTo(10);
    const spilled = events.find((e) => e.type === 'cargoSpilled');
    // nothing broke off – the dumped cargo is in the wreck only with the loot of the destroyed part (I3)
    expect(spilled).toMatchObject({ type: 'cargoSpilled', toWreck: expect.any(Number) });
    if (spilled?.type === 'cargoSpilled') {
      expect(spilled.cargo.iron).toBeCloseTo(50);
      expect(spilled.cargo.copper).toBeCloseTo(10);
      const wreck = sim.state.combat.wrecks.find((w) => w.id === spilled.toWreck)!;
      expect(wreck.loot.cargo.iron).toBeCloseTo(50);
      expect(wreck.grid.parts.map((p) => p.partId)).toEqual(['largeCargo']);
    }
  });

  it('losing the cockpit destroys the player: frozen, untargetable, and applyDeath restores', () => {
    const sim = flyingSim();
    const player = sim.state.player;
    player.shield = 0;
    player.hp.set(1, 1);
    // cockpit (0,0) from below (y −), the cargo (0,−1) is in the way → cut it first
    player.hp.set(7, 1);
    const below = cellWorld(player, { x: 0, y: -1 });
    for (let i = 0; i < 2; i++) {
      sim.state.combat.projectiles.push({
        id: 900 + i, owner: 'pr:x', pos: { x: below.x, y: below.y - 1.2 - i * 1.4 }, vel: { x: 0, y: 80 }, ttl: 10, damage: 5, tier: 1, origin: { x: 0, y: -40 },
      });
    }
    let events: SimEvent[] = [];
    for (let i = 0; i < 3 && !player.destroyed; i++) events.push(...sim.step(IDLE_COMMAND));
    expect(player.destroyed).toBe(true);
    expect(events.some((e) => e.type === 'playerDestroyed')).toBe(true);
    expect([...player.hp.values()].every((v) => v > 0)).toBe(true);
    const pos = { ...player.body.pos };
    events = sim.step({ ...IDLE_COMMAND, flight: { forward: 1, strafe: 0, turn: 1 }, fire: true, aim: { x: 10, y: 0 } });
    expect(player.body.pos).toEqual(pos);
    expect(events.some((e) => e.type === 'shotFired')).toBe(false);

    const outcome = applyDeath(sim);
    expect(player.destroyed).toBe(false);
    expect(player.dock.mode).toBe('docked');
    expect(outcome.events.some((e) => e.type === 'docked')).toBe(true);
    expect(player.shield).toBe(player.props.shield.capacity);
  });
});

describe('Simulation – salvage', () => {
  it('F next to a wreck loads its loot (outside docking range); parts go to the station on docking', () => {
    const sim = new Simulation({ seed: 3, startDocked: false, generator: homeOnly });
    const player = sim.state.player;
    const body = { pos: { x: 80, y: 0 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    player.body = body;
    player.prevBody = body;
    sim.step(IDLE_COMMAND);
    const enemy = createEnemy(slot('jackal', { x: 86, y: 0 }));
    // a wreck right next to the ship
    sim.state.combat.wrecks.push({
      id: 50,
      grid: enemy.grid,
      props: enemy.props,
      body: enemy.body,
      prevBody: enemy.body,
      loot: { cargo: { iron: 10, copper: 0, ice: 0, titanium: 2 }, parts: { 'cannon:1': 1 } },
      ttl: 1000,
      livery: 'pirate',
    });
    const events = sim.step({ ...IDLE_COMMAND, dock: true });
    expect(events).toContainEqual({ type: 'salvaged', wreckId: 50, cargo: { iron: 10, titanium: 2 }, parts: { 'cannon:1': 1 }, cargoFull: false });
    expect(events.some((e) => e.type === 'dockRejected')).toBe(false);
    expect(player.cargo.iron).toBe(10);
    expect(player.salvage).toEqual({ 'cannon:1': 1 });

    // dock at home → salvaged parts into the storage
    const home = homeStation();
    const near = { pos: { x: home.radius + player.props.boundingRadius + 4, y: 0 }, vel: { x: 0, y: 0 }, angle: Math.PI, angVel: 0 };
    player.body = near;
    player.prevBody = near;
    sim.state.combat.wrecks = [];
    const dockEvents = run(sim, 70, (_s, i) => ({ ...IDLE_COMMAND, dock: i === 0 }));
    expect(dockEvents).toContainEqual({ type: 'salvageStored', stationId: 'home', parts: { 'cannon:1': 1 } });
    expect(player.salvage).toEqual({});
    expect(sim.state.stations.get('home')!.parts['cannon:1']).toBe(2);
  });
});

describe('Simulation – collisions between ships', () => {
  it('pushes ships apart and reports the impact', () => {
    const sim = flyingSim(createStarterShip());
    const e = addEnemy(sim, 'jackal', { x: 4, y: 0 });
    e.ai.mode = 'patrol';
    e.ai.waypoint = { x: 4, y: 0 };
    e.ai.timer = 1000;
    sim.state.player.body = { ...sim.state.player.body, vel: { x: 20, y: 0 } };
    const events = run(sim, 20, () => IDLE_COMMAND);
    expect(events.some((ev) => ev.type === 'collision')).toBe(true);
    expect(e.body.pos.x - sim.state.player.body.pos.x).toBeGreaterThan(2.5);
  });
});

describe('Simulation – pirate spawns', () => {
  /** Find a ring-2 spot with a pirate group for seed 77 (normal density). */
  function pirateSpot(sim: Simulation): { x: number; y: number } {
    for (let r = 1700; r < 3800; r += 200) {
      for (let a = 0; a < 64; a++) {
        const pos = { x: Math.cos(a / 10) * r, y: Math.sin(a / 10) * r };
        const body = { pos, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
        sim.state.player.body = body;
        sim.state.player.prevBody = body;
        sim.state.tick = 0;
        sim.step(IDLE_COMMAND);
        if (sim.state.combat.enemies.length > 0) return pos;
      }
    }
    throw new Error('no pirates found');
  }

  it('spawns pirates of ring 2 around the player and despawns them when far away', () => {
    const sim = flyingSim(fighter(), emptySpace);
    const pos = pirateSpot(sim);
    for (const e of sim.state.combat.enemies) {
      const d = Math.hypot(e.body.pos.x - pos.x, e.body.pos.y - pos.y);
      expect(d).toBeLessThanOrEqual(SPAWN_RADIUS);
      expect(d).toBeGreaterThanOrEqual(SPAWN_MIN_DISTANCE - 1);
    }
    const far = { pos: { x: pos.x + DESPAWN_RADIUS * 3, y: pos.y }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    sim.state.player.body = far;
    sim.state.player.prevBody = far;
    sim.state.tick = 30;
    sim.step(IDLE_COMMAND);
    expect(sim.state.combat.enemies.every((e) => Math.hypot(e.body.pos.x - far.pos.x, e.body.pos.y - far.pos.y) <= DESPAWN_RADIUS)).toBe(true);
  });

  it('never spawns pirates near home', () => {
    const sim = new Simulation({ seed: 77, settings: { enemyDensity: 'high' } });
    run(sim, 300, () => IDLE_COMMAND);
    expect(sim.state.combat.enemies).toEqual([]);
  });
});
