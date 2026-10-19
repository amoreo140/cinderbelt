import { describe, expect, it } from 'vitest';
import { ATTENTION, HUNT, RAID, TOLL } from '../../data/pirates';
import { spawnSlots, type SpawnSlot } from '../combat/enemies';
import { flyingAt, ofType, run, teleport } from '../discovery/testing';
import { createGrid } from '../ship/grid';
import type { Simulation } from '../Simulation';
import { CHUNK_SIZE } from '../world/chunks';
import { fortressSites } from './sites';
import { addAttention, cargoValue, raidFlagship, tollAmount } from './pirates';

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

/** First Hammer-led pirate group in ring 2 (spiral from home). */
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

/** Ship in a Pirate (fortress) sector on a quiet spot near the first fortress beacon – met before (no first-contact gain). */
function outerSim(): Simulation {
  const f = fortressSites(SEED)[0]!;
  const sim = flyingAt(SEED, { x: f.beacon.pos.x - 40, y: f.beacon.pos.y }, fighter());
  sim.state.world.newlyExplored = [];
  return sim;
}

describe('pirate attention (6.3)', () => {
  it('grows from kills and from cargo carried through a dangerous sector, never from waiting', () => {
    const sim = outerSim();
    run(sim, 2);
    expect(sim.state.pirates.attention).toBe(0);
    sim.state.player.cargo.titanium = 40;
    const value = cargoValue(sim.state);
    // into the next chunk
    const p = sim.state.player.body.pos;
    teleport(sim, { x: p.x + CHUNK_SIZE, y: p.y });
    run(sim, 1);
    expect(sim.state.pirates.attention).toBeCloseTo(value / ATTENTION.cargoPerPoint + ATTENTION.newChunk, 3);
    const a0 = sim.state.pirates.attention;
    sim.state.combat.enemies = [];
    const events: Parameters<typeof addAttention>[2] = [];
    addAttention(sim.state, 50, events);
    expect(events).toEqual([{ type: 'attentionLevel', level: 1, attention: a0 + 50 }]);
  });

  it('decays three times faster outside dangerous sectors than inside', () => {
    const inside = outerSim();
    inside.state.pirates.attention = 50;
    run(inside, 60 * 60);
    const home = flyingAt(SEED, { x: 0, y: 400 }, fighter());
    home.state.pirates.attention = 50;
    run(home, 60 * 60);
    expect(50 - home.state.pirates.attention).toBeCloseTo(1 / 3, 2);
    expect(50 - inside.state.pirates.attention).toBeCloseTo(1 / 9, 2);
  });

  it('low enemy density halves the gains and never reaches a raid', () => {
    const sim = outerSim();
    sim.state.settings = { ...sim.state.settings, enemyDensity: 'low' };
    addAttention(sim.state, 500, []);
    expect(sim.state.pirates.attention).toBe(89);
    run(sim, 2);
    expect(sim.state.pirates.raid).toBeNull();
  });
});

describe('toll', () => {
  function hailed() {
    const slots = hammerGroup();
    const home = slots[0]!.home;
    const sim = flyingAt(SEED, { x: home.x + 150, y: home.y }, fighter());
    sim.state.player.cargo.titanium = 30;
    sim.state.credits = 5000;
    // approach until the group hails (or attacks, when the dice say no toll)
    for (let i = 0; i < 400 && !sim.state.pirates.toll; i++) {
      const p = sim.state.player.body.pos;
      teleport(sim, { x: p.x - 0.5, y: p.y });
      run(sim, 1);
    }
    return { sim, group: slots[0]!.id.replace(/:\d+$/, '') };
  }

  it('a Hammer-led group hails the player instead of attacking and waits for an answer', () => {
    const { sim, group } = hailed();
    const toll = sim.state.pirates.toll!;
    expect(toll.group).toBe(group);
    expect(toll.amount).toBe(tollAmount(sim.state));
    const members = sim.state.combat.enemies.filter((e) => e.id.startsWith(`${group}:`));
    expect(members.every((e) => e.ai.mode === 'hail')).toBe(true);
    const events = run(sim, 120);
    expect(ofType(events, 'shotFired').filter((e) => e.owner !== 'player')).toHaveLength(0);
  });

  it('paying lowers attention by 10 and the group leaves the player alone', () => {
    const { sim, group } = hailed();
    sim.state.pirates.attention = 35;
    const amount = sim.state.pirates.toll!.amount;
    const events = run(sim, 1, { toll: 'pay' });
    expect(ofType(events, 'tollPaid')[0]).toMatchObject({ group, amount });
    expect(sim.state.credits).toBe(5000 - amount);
    expect(sim.state.pirates.attention).toBeLessThanOrEqual(25.01);
    const later = run(sim, 600);
    expect(ofType(later, 'shotFired').filter((e) => e.owner !== 'player')).toHaveLength(0);
    expect(sim.state.combat.enemies.filter((e) => e.id.startsWith(`${group}:`)).every((e) => e.ai.mode !== 'attack')).toBe(true);
  });

  it('refusing or waiting too long starts the fight; flying away slips out', () => {
    const a = hailed();
    expect(ofType(run(a.sim, 1, { toll: 'refuse' }), 'tollRefused')[0]).toMatchObject({ timeout: false });
    expect(a.sim.state.combat.enemies.some((e) => e.ai.mode === 'attack')).toBe(true);
    const b = hailed();
    const timeout = run(b.sim, TOLL.seconds * 60 + 2);
    expect(ofType(timeout, 'tollRefused')[0]).toMatchObject({ timeout: true });
    const c = hailed();
    const p = c.sim.state.player.body.pos;
    teleport(c.sim, { x: p.x + TOLL.escape + 120, y: p.y });
    expect(ofType(run(c.sim, 1), 'tollEscaped')).toHaveLength(1);
  });

  it('cannot pay without credits', () => {
    const { sim } = hailed();
    sim.state.credits = 0;
    expect(ofType(run(sim, 1, { toll: 'pay' }), 'tollFailed')[0]).toMatchObject({ reason: 'credits' });
    expect(sim.state.pirates.toll).not.toBeNull();
  });
});

describe('hunting party and raids', () => {
  it('at 60+ a hunting party with a named captain comes for the player (once per cooldown)', () => {
    const sim = outerSim();
    sim.state.pirates.attention = 65;
    const events = run(sim, 2);
    const hunt = ofType(events, 'huntingParty');
    expect(hunt).toHaveLength(1);
    expect(hunt[0]!.captain).not.toBeNull();
    expect(sim.state.combat.enemies.some((e) => e.id === `cap:${hunt[0]!.captain}`)).toBe(true);
    expect(sim.state.combat.enemies.filter((e) => e.id.startsWith('hp:')).length).toBe(HUNT.jackals);
    expect(ofType(run(sim, 60), 'huntingParty')).toHaveLength(0);
  });

  it('at 90 a raid is announced 8 minutes ahead; beating the flagship pays the war chest and drops attention to 40', () => {
    const sim = outerSim();
    sim.state.pirates.attention = 95;
    const announced = ofType(run(sim, 1), 'raidAnnounced')[0]!;
    expect(announced.kind).toBe('raid');
    expect(announced.arrive - sim.state.tick).toBeGreaterThan(RAID.announceTicks - 5);
    const raid = sim.state.pirates.raid!;
    // jump to the arrival at the target
    sim.state.tick = raid.arrive;
    teleport(sim, { x: raid.pos.x + 200, y: raid.pos.y });
    const arrived = run(sim, 1);
    expect(ofType(arrived, 'raidArrived')).toHaveLength(1);
    const flagship = sim.state.combat.enemies.find((e) => e.id === raidFlagship(raid))!;
    expect(sim.state.combat.enemies.filter((e) => e.id.startsWith(`rd:${raid.serial}:`)).length).toBe(RAID.escorts + (raid.captain === null ? 1 : 0));
    // destroy the flagship (cockpit)
    const cockpit = flagship.grid.parts.find((p) => p.partId === 'cockpit')!;
    flagship.hp.set(cockpit.id, 0.01);
    flagship.shield = 0;
    const credits0 = sim.state.credits;
    const containers0 = sim.state.combat.containers.length;
    sim.state.combat.projectiles.push({ id: 999999, owner: 'player', pos: { x: flagship.body.pos.x - 6, y: flagship.body.pos.y }, vel: { x: 300, y: 0 }, ttl: 30, damage: 50, tier: 1, origin: flagship.body.pos });
    let won: ReturnType<typeof ofType<'raidDefeated'>> = [];
    for (let i = 0; i < 30 && won.length === 0; i++) {
      const f = sim.state.combat.enemies.find((e) => e.id === raidFlagship(raid));
      if (f) for (const p of f.grid.parts) f.hp.set(p.id, 0.01);
      if (f) sim.state.combat.projectiles.push({ id: 999000 + i, owner: 'player', pos: { x: f.body.pos.x - 6, y: f.body.pos.y }, vel: { x: 300, y: 0 }, ttl: 30, damage: 50, tier: 1, origin: f.body.pos });
      won = ofType(run(sim, 1), 'raidDefeated');
    }
    expect(won).toHaveLength(1);
    expect(sim.state.credits).toBeGreaterThan(credits0);
    expect(sim.state.combat.containers.length).toBeGreaterThan(containers0);
    expect(sim.state.pirates.attention).toBeLessThanOrEqual(40);
    expect(sim.state.pirates.raid).toBeNull();
  });

  it('an undefended raid leaves after a while and attention drops to 40 (nothing is lost)', () => {
    const sim = outerSim();
    sim.state.pirates.attention = 92;
    run(sim, 1);
    const raid = sim.state.pirates.raid!;
    const credits = sim.state.credits;
    sim.state.tick = raid.ends;
    expect(ofType(run(sim, 1), 'raidEnded')).toHaveLength(1);
    expect(sim.state.pirates.attention).toBeLessThanOrEqual(40);
    expect(sim.state.credits).toBe(credits);
  });

  it('the clan beacon (F) calls a duel to the beacon on demand, then cools down', () => {
    const sim = outerSim();
    const beacon = fortressSites(SEED)[0]!.beacon;
    teleport(sim, { x: beacon.pos.x - 6, y: beacon.pos.y });
    const events = run(sim, 1, { dock: true });
    expect(ofType(events, 'challengeIssued')[0]).toMatchObject({ beacon: beacon.id });
    const raid = sim.state.pirates.raid!;
    expect(raid.kind).toBe('challenge');
    expect(raid.arrive - sim.state.tick).toBeLessThanOrEqual(RAID.challengeTicks);
    expect(sim.state.pirates.attention).toBeGreaterThanOrEqual(90);
    expect(ofType(run(sim, 1, { dock: true }), 'challengeRefused')[0]).toMatchObject({ reason: 'raidActive' });
    sim.state.tick = raid.ends;
    run(sim, 1);
    expect(ofType(run(sim, 1, { dock: true }), 'challengeRefused')[0]).toMatchObject({ reason: 'cooldown' });
  });
});
