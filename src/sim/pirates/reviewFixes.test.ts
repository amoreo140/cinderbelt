// Second code review (M3.5a fairness): paid tolls (I1, I2), raids (M6, M7), clan challenge (M8) and
// fortress (M9, M10) edge cases.
import { describe, expect, it } from 'vitest';
import { RAID } from '../../data/pirates';
import { captainEnemyId } from '../captains/captains';
import { spawnSlots, type SpawnSlot } from '../combat/enemies';
import { SPAWN_CHECK_INTERVAL } from '../combat/combat';
import type { Enemy } from '../combat/types';
import { flyingAt, ofType, run, teleport } from '../discovery/testing';
import { loadSave } from '../save/load';
import { restoreSimulation, toEnvelope, toSave } from '../save/serialize';
import { testContext } from '../save/testing';
import { createGrid } from '../ship/grid';
import type { Simulation } from '../Simulation';
import { CHUNK_SIZE } from '../world/chunks';
import { freshFortress } from './fortress';
import { raidFlagship } from './pirates';
import { FORTRESS_LAYOUT, fortressSites, fortressToWorld } from './sites';

const SEED = 4242;
const ctx = testContext();

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

function hammerGroup(): SpawnSlot[] {
  for (let r = 8; r < 20; r++) {
    for (let cx = -r; cx <= r; cx++) {
      for (const cy of [-r, r]) {
        const slots = spawnSlots(SEED, cx, cy, 'normal');
        if (slots.some((s) => s.kind === 'hammer') && Math.hypot((cx + 0.5) * CHUNK_SIZE, (cy + 0.5) * CHUNK_SIZE) < 3800) return slots;
      }
    }
  }
  throw new Error('no hammer group');
}

/** A Hammer-led group hailed the player; the toll is paid. */
function paid(): { sim: Simulation; group: string } {
  const slots = hammerGroup();
  const home = slots[0]!.home;
  const sim = flyingAt(SEED, { x: home.x + 150, y: home.y }, fighter());
  sim.state.credits = 5000;
  for (let i = 0; i < 400 && !sim.state.pirates.toll; i++) {
    const p = sim.state.player.body.pos;
    teleport(sim, { x: p.x - 0.5, y: p.y });
    run(sim, 1);
  }
  const group = slots[0]!.id.replace(/:\d+$/, '');
  expect(sim.state.pirates.toll?.group).toBe(group);
  expect(ofType(run(sim, 1, { toll: 'pay' }), 'tollPaid')).toHaveLength(1);
  return { sim, group };
}

const members = (sim: Simulation, group: string): Enemy[] => sim.state.combat.enemies.filter((e) => e.id.startsWith(`${group}:`));

function roundTrip(sim: Simulation): Simulation {
  const result = loadSave(toEnvelope(toSave(sim, ctx)));
  if (!result.ok) throw new Error(`load failed: ${result.error} ${result.details.join('; ')}`);
  return restoreSimulation(result.save);
}

describe('paid toll', () => {
  it('I1: the truce is saved – after loading the group stays calm, identical events to the unsaved game', () => {
    const a = paid();
    const b = paid();
    expect(b.sim.state.pirates.paid.get(b.group)).toBeGreaterThan(b.sim.state.tick);
    const loaded = roundTrip(b.sim);
    expect(members(loaded, b.group).every((e) => e.calm)).toBe(true);
    // fly right through the group: nobody attacks
    const cmd = { flight: { forward: 0.3, strafe: 0, turn: 0 } };
    const eventsA = run(a.sim, 900, cmd);
    const eventsB = run(loaded, 900, cmd);
    expect(eventsB).toEqual(eventsA);
    expect(JSON.stringify(toSave(loaded, ctx))).toBe(JSON.stringify(toSave(a.sim, ctx)));
    expect(ofType(eventsB, 'shotFired').filter((e) => e.owner !== 'player')).toHaveLength(0);
  }, 20_000);

  it('I1: the truce ends with its period', () => {
    const { sim, group } = paid();
    sim.state.tick = sim.state.pirates.paid.get(group)!;
    run(sim, 1);
    expect(sim.state.pirates.paid.has(group)).toBe(false);
    expect(members(sim, group).some((e) => e.calm)).toBe(false);
  });

  it('I2: a hit on a calm pirate ends the truce – the whole group fights back', () => {
    const { sim, group } = paid();
    const target = members(sim, group)[0]!;
    const from = { x: target.body.pos.x - 4, y: target.body.pos.y };
    sim.state.combat.projectiles.push({ id: 999_999, owner: 'player', pos: from, vel: { x: 300, y: 0 }, ttl: 30, damage: 5, tier: 1, origin: from });
    const events = run(sim, 3);
    expect(sim.state.pirates.paid.has(group)).toBe(false);
    expect(members(sim, group).every((e) => !e.calm && e.ai.mode === 'attack')).toBe(true);
    expect(ofType(events, 'enemyAlert').length).toBeGreaterThan(0);
  });
});

/** Ship in ring 2 near the first fortress beacon. */
function outerSim(): Simulation {
  const f = fortressSites(SEED)[0]!;
  return flyingAt(SEED, { x: f.beacon.pos.x - 40, y: f.beacon.pos.y }, fighter());
}

describe('raids', () => {
  it('M6: a raid captain who fell before the fleet arrives is replaced by a nameless flagship (never a second copy)', () => {
    const sim = outerSim();
    sim.state.pirates.attention = 95;
    run(sim, 1);
    const raid = sim.state.pirates.raid!;
    expect(raid.captain).not.toBeNull();
    const captain = raid.captain!;
    sim.state.career.captains.set(captain, { promotions: 0, defeated: true, trophies: [], kills: 0 });
    sim.state.tick = raid.arrive;
    teleport(sim, { x: raid.pos.x + 200, y: raid.pos.y });
    expect(ofType(run(sim, 1), 'raidArrived')).toHaveLength(1);
    expect(raid.captain).toBeNull();
    expect(sim.state.combat.enemies.some((e) => e.id === captainEnemyId(captain))).toBe(false);
    expect(sim.state.combat.enemies.some((e) => e.id === raidFlagship(raid))).toBe(true);
  });

  it('M7: a fleet that despawned (the player flew away) is there again on return – without the ships killed before', () => {
    const sim = outerSim();
    sim.state.pirates.attention = 95;
    run(sim, 1);
    const raid = sim.state.pirates.raid!;
    sim.state.tick = raid.arrive;
    teleport(sim, { x: raid.pos.x + 200, y: raid.pos.y });
    run(sim, 1);
    const escort = `rd:${raid.serial}:2`;
    expect(sim.state.combat.enemies.some((e) => e.id === escort)).toBe(true);
    sim.state.combat.enemies = sim.state.combat.enemies.filter((e) => e.id !== escort);
    sim.state.combat.defeated.set(escort, sim.state.tick);
    // away: the fleet despawns
    teleport(sim, { x: raid.pos.x + 3000, y: raid.pos.y });
    run(sim, SPAWN_CHECK_INTERVAL + 1);
    expect(sim.state.combat.enemies.some((e) => e.id === raidFlagship(raid))).toBe(false);
    // back: it is there again, the escort killed before is not
    teleport(sim, { x: raid.pos.x + 200, y: raid.pos.y });
    const back = run(sim, SPAWN_CHECK_INTERVAL + 1);
    expect(ofType(back, 'raidArrived')).toHaveLength(0);
    expect(sim.state.combat.enemies.some((e) => e.id === raidFlagship(raid))).toBe(true);
    expect(sim.state.combat.enemies.some((e) => e.id === escort)).toBe(false);
  });

  it('M8: after a clan challenge the clan refuses one at any beacon until it recovers', () => {
    const sim = outerSim();
    const [first, second] = fortressSites(SEED);
    teleport(sim, { x: first!.beacon.pos.x - 6, y: first!.beacon.pos.y });
    expect(ofType(run(sim, 1, { dock: true }), 'challengeIssued')).toHaveLength(1);
    sim.state.tick = sim.state.pirates.raid!.ends;
    run(sim, 1);
    teleport(sim, { x: second!.beacon.pos.x - 6, y: second!.beacon.pos.y });
    expect(ofType(run(sim, 1, { dock: true }), 'challengeRefused')[0]).toMatchObject({ reason: 'cooldown' });
    sim.state.tick += RAID.beaconCooldownTicks + 1;
    expect(ofType(run(sim, 1, { dock: true }), 'challengeIssued')).toHaveLength(1);
  });
});

describe('fortress', () => {
  it('M9: with every turret down no more reinforcements launch', () => {
    const f = fortressSites(SEED)[0]!;
    const sim = flyingAt(SEED, fortressToWorld(f, { x: -60, y: 0 }), fighter());
    sim.state.pirates.fortresses.set(f.id, { ...freshFortress(), turrets: FORTRESS_LAYOUT.turrets.map(() => 0) });
    const events = run(sim, 60 * 120);
    expect(ofType(events, 'fortressReinforcements')).toHaveLength(0);
  });

  it('M10: a pirate shot stops at the fortress rock like the player one', () => {
    const f = fortressSites(SEED)[0]!;
    const sim = flyingAt(SEED, fortressToWorld(f, { x: -80, y: 0 }), fighter());
    const core = fortressToWorld(f, FORTRESS_LAYOUT.core);
    const from = fortressToWorld(f, { x: 0, y: FORTRESS_LAYOUT.clearRadius - 1 });
    const dir = { x: core.x - from.x, y: core.y - from.y };
    const len = Math.hypot(dir.x, dir.y);
    sim.state.combat.projectiles.push({ id: 999_998, owner: 'pr:test:0', pos: from, vel: { x: (dir.x / len) * 80, y: (dir.y / len) * 80 }, ttl: 200, damage: 5, tier: 1, origin: from });
    const events = run(sim, 120);
    expect(sim.state.combat.projectiles.some((p) => p.id === 999_998)).toBe(false);
    expect(ofType(events, 'projectileHit').some((e) => e.owner === 'pr:test:0' && e.fortress === f.id)).toBe(true);
    // the fortress took no damage from it
    expect(sim.state.pirates.fortresses.get(f.id)?.core ?? freshFortress().core).toBe(freshFortress().core);
  });
});
