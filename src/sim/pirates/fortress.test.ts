import { describe, expect, it } from 'vitest';
import { FORTRESS } from '../../data/pirates';
import layoutsJson from '../../data/fortress_layouts.json';
import { flyingAt, ofType, run, teleport } from '../discovery/testing';
import { length, sub, type Vec2 } from '../math/vec2';
import { createGrid } from '../ship/grid';
import type { Simulation } from '../Simulation';
import { ringIndexAt } from '../world/rings';
import { coreShielded, fortressStatus, generatorWorld, turretWorld } from './fortress';
import { FORTRESS_LAYOUT, fortressCircles, fortressSites, fortressToWorld, type FortressSite } from './sites';

const SEED = 4242;

const fighter = () =>
  createGrid([
    ['cockpit', 0, 0],
    ['gyro', 0, 2],
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

const site = (): FortressSite => fortressSites(SEED)[0]!;

/** Player shot from `from` towards `to` (fast, strong enough to finish a part quickly). */
function shoot(sim: Simulation, from: Vec2, to: Vec2, damage = 400): void {
  const d = sub(to, from);
  const len = length(d);
  sim.state.combat.projectiles.push({
    id: sim.state.combat.nextId++,
    owner: 'player',
    pos: { ...from },
    vel: { x: (d.x / len) * 200, y: (d.y / len) * 200 },
    ttl: 60,
    damage,
    tier: 1,
    origin: { ...from },
  });
}

/** Player parked far behind (out of turret reach) – the fortress logic still runs. */
function nearFortress(dx = 0, dy = 0): Simulation {
  const f = site();
  const back = fortressToWorld(f, { x: -60 + dx, y: dy });
  return flyingAt(SEED, back, fighter());
}

describe('fortress sites (6.5)', () => {
  it('three fortresses in ring 2, clear of rocks and stations, each with a beacon towards home', () => {
    const sites = fortressSites(SEED);
    expect(sites).toHaveLength(FORTRESS.count);
    expect(fortressSites(SEED)).toBe(sites);
    for (const f of sites) {
      expect(ringIndexAt(length(f.pos))).toBe(2);
      const sim = flyingAt(SEED, f.pos);
      expect(sim.state.world.circlesNear(f.pos, FORTRESS_LAYOUT.clearRadius)).toHaveLength(0);
      expect(sim.state.world.stationCirclesNear(f.pos, FORTRESS_LAYOUT.clearRadius + 100)).toHaveLength(0);
      expect(length(f.beacon.pos)).toBeLessThan(length(f.pos));
    }
  });

  it('the game copy of the layout matches the art pipeline', () => {
    const sources = import.meta.glob('../../../art/blender/data/fortress_layouts.json', { eager: true, import: 'default' });
    const art = Object.values(sources)[0];
    if (!art) return;
    // on a difference: copy art/blender/data/fortress_layouts.json to src/data/
    expect(layoutsJson).toEqual(art);
  });

  it('the rock blocks the ship', () => {
    const f = site();
    const sim = flyingAt(SEED, fortressToWorld(f, { x: 25, y: 0 }), fighter());
    sim.state.player.body = { ...sim.state.player.body, vel: { x: -Math.cos(f.angle) * 30, y: -Math.sin(f.angle) * 30 } };
    run(sim, 120);
    const d = length(sub(sim.state.player.body.pos, f.pos));
    expect(d).toBeGreaterThan(9);
    expect(fortressCircles(f).length).toBe(FORTRESS_LAYOUT.circles.length);
  });
});

describe('fortress fight', () => {
  it('the core is shielded until both generators fall, then it can be destroyed for the big reward', () => {
    const f = site();
    const sim = nearFortress();
    const core = fortressToWorld(f, FORTRESS_LAYOUT.core);
    const from = fortressToWorld(f, { x: 0, y: 30 });
    shoot(sim, from, core);
    const shielded = run(sim, 20);
    expect(ofType(shielded, 'projectileHit').find((e) => e.fortress === f.id)?.target).toBe('shield');
    expect(fortressStatus(sim.state, f.id).core).toBe(FORTRESS.coreHp);
    // generators behind the rock
    for (let i = 0; i < 2; i++) {
      const g = generatorWorld(f, i);
      shoot(sim, fortressToWorld(f, { x: -25, y: i === 0 ? 12 : -12 }), g, FORTRESS.generatorHp);
      run(sim, 20);
    }
    expect(coreShielded(fortressStatus(sim.state, f.id))).toBe(false);
    const credits = sim.state.credits;
    const containers = sim.state.combat.containers.length;
    sim.state.pirates.attention = 50;
    let destroyed: ReturnType<typeof ofType<'fortressDestroyed'>> = [];
    for (let i = 0; i < 10 && destroyed.length === 0; i++) {
      shoot(sim, from, core, 400);
      destroyed = ofType(run(sim, 20), 'fortressDestroyed');
    }
    expect(destroyed[0]).toMatchObject({ fortress: f.id, credits: FORTRESS.credits, first: true });
    expect(sim.state.credits).toBe(credits + FORTRESS.credits);
    expect(sim.state.discovery.keyItems.has('resonator')).toBe(true);
    expect(sim.state.combat.containers.length).toBe(containers + FORTRESS.chestContainers);
    expect(sim.state.pirates.attention).toBeCloseTo(25, 1);
    expect(sim.state.career.rep.guild.points).toBeGreaterThanOrEqual(FORTRESS.rep);
  });

  it('turrets shoot a ship in reach; a destroyed turret stays silent', () => {
    const f = site();
    const t0 = turretWorld(f, 0);
    const out = fortressToWorld(f, { x: FORTRESS_LAYOUT.turrets[0]!.x * 3, y: FORTRESS_LAYOUT.turrets[0]!.y * 3 });
    const sim = flyingAt(SEED, out, fighter());
    const shots = ofType(run(sim, 120), 'shotFired').filter((e) => e.owner === `fort:${f.index}`);
    expect(shots.length).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) {
      const m = FORTRESS_LAYOUT.turrets[i]!;
      shoot(sim, fortressToWorld(f, { x: m.x * 1.8, y: m.y * 1.8 }), turretWorld(f, i), FORTRESS.turretHp);
      run(sim, 15);
    }
    expect(fortressStatus(sim.state, f.id).turrets.every((hp) => hp === 0)).toBe(true);
    expect(ofType(run(sim, 200), 'shotFired').filter((e) => e.owner === `fort:${f.index}`)).toHaveLength(0);
    expect(length(sub(t0, f.pos))).toBeLessThan(12);
  });

  it('reinforcements launch every 45 s while the player is near (at most three alive)', () => {
    const f = site();
    const sim = nearFortress();
    // keep the ship alive (the test is about the waves, not the fight)
    const events = [];
    for (let i = 0; i < 360; i++) {
      sim.state.player.hp.clear();
      sim.state.player.shield = sim.state.player.props.shield.capacity;
      events.push(...run(sim, 30));
    }
    const waves = ofType(events, 'fortressReinforcements');
    expect(waves.length).toBeGreaterThanOrEqual(3);
    expect(sim.state.combat.enemies.filter((e) => e.id.startsWith(`fr:${f.index}:`)).length).toBeLessThanOrEqual(FORTRESS.reinforceMax);
  });

  it('a destroyed fortress is rebuilt after an hour with a smaller reward', () => {
    const f = site();
    const sim = nearFortress();
    const fs = fortressStatus(sim.state, f.id);
    sim.state.pirates.fortresses.set(f.id, { ...fs, destroyed: 10, kills: 1, core: 0, gens: [0, 0], turrets: [0, 0, 0, 0] });
    sim.state.tick = 10 + FORTRESS.rebuildTicks;
    expect(ofType(run(sim, 1), 'fortressRebuilt')).toHaveLength(1);
    expect(fortressStatus(sim.state, f.id)).toMatchObject({ destroyed: null, kills: 1, core: FORTRESS.coreHp });
    teleport(sim, fortressToWorld(f, { x: -60, y: 0 }));
  });
});

describe('Destroy the fortress contract', () => {
  it('ring 2 stations near a standing fortress offer it, at most once per board', async () => {
    const { generateBoard } = await import('../contracts/generate');
    const { unlocksUpTo } = await import('../../data/factions');
    const { stationsInArea } = await import('../world/stations');
    const f = site();
    const station = stationsInArea(SEED, -25, 25, -25, 25)
      .filter((s) => s.ring === 2)
      .sort((a, b) => length(sub(a.pos, f.pos)) - length(sub(b.pos, f.pos)))[0]!;
    let found = 0;
    for (let epoch = 0; epoch < 40; epoch++) {
      const board = generateBoard({
        seed: SEED, station, epoch, tick: epoch * 72_000, unlocks: new Set(unlocksUpTo('guild', 2)), density: 'normal', captains: [],
        fortresses: fortressSites(SEED).map((x) => ({ id: x.id, pos: x.pos })),
      });
      const forts = board.offers.filter((o) => o.target.kind === 'fortress');
      expect(forts.length).toBeLessThanOrEqual(1);
      found += forts.length;
    }
    expect(found).toBeGreaterThan(0);
  });

  it('is ready when the fortress falls', () => {
    const f = site();
    const sim = nearFortress();
    sim.state.career.contracts.push({
      id: 'x@0.1', type: 'fortress', faction: 'guild', station: 'home', ring: 2, risk: 0.5,
      target: { kind: 'fortress', fortress: f.id, pos: f.pos }, modifiers: [], bonus: 0, part: null,
      serial: 7, acceptedTick: 0, seconds: 600, reward: 9000, rep: 30, progress: 0, base: 0, ready: false,
    });
    sim.state.pirates.fortresses.set(f.id, { ...fortressStatus(sim.state, f.id), gens: [0, 0], core: 10 });
    shoot(sim, fortressToWorld(f, { x: 0, y: 30 }), fortressToWorld(f, FORTRESS_LAYOUT.core), 50);
    const events = run(sim, 20);
    expect(ofType(events, 'contractReady')).toEqual([{ type: 'contractReady', contractId: 7 }]);
  });
});
