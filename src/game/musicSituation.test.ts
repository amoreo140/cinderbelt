import { describe, expect, it } from 'vitest';
import { MUSIC_TIMING } from '../audio/music/musicDirector';
import { RELAY_CHAIN } from '../data/guild';
import { syntheticWatch } from '../sim/npc/testing';
import { createEnemy } from '../sim/combat/enemies';
import type { EnemyKind } from '../sim/combat/types';
import { PLAYER_REF } from '../sim/combat/types';
import { echoSites } from '../sim/discovery/poi';
import { fortressSites } from '../sim/pirates/sites';
import { createGrid } from '../sim/ship/grid';
import { Simulation } from '../sim/Simulation';
import { sectorInfoAt } from '../sim/regions/sectors';
import { combatThreat, DISCOVERY_SECONDS, EventMoments, gameMusicSituation, HitMemory, MUSIC_THREAT, musicScreenFor, musicZoneAt, MYSTERY_RADIUS, nearMystery } from './musicSituation';

const empty = (_s: number, cx: number, cy: number) => ({ cx, cy, asteroids: [] });

function flying(x = 300, y = 0): Simulation {
  const sim = new Simulation({ seed: 4, grid: createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0]]), startDocked: false, generator: empty });
  sim.state.player.body.pos = { x, y };
  return sim;
}

function addEnemy(sim: Simulation, kind: EnemyKind, dx: number, mode: 'attack' | 'patrol' | 'hail' | 'flee' | 'evade' | 'dormant' = 'attack') {
  const p = sim.state.player.body.pos;
  const pos = { x: p.x + dx, y: p.y };
  const e = createEnemy({ id: `e${sim.state.combat.enemies.length}`, kind, tier: 1, pos, angle: 0, home: pos, orbit: 1 });
  e.ai.mode = mode;
  sim.state.combat.enemies.push(e);
  return e;
}

describe('gameMusicSituation', () => {
  it('reads the sector depth, distance and speed of the player', () => {
    const sim = flying(1700, 0);
    sim.state.player.body.vel = { x: 30, y: 40 };
    const zone = musicZoneAt(sim.state);
    expect(zone.depth).toBe(sectorInfoAt(sim.state.seed, 1700, 0).depth);
    expect(gameMusicSituation(sim.state, false, { depth: 2, frontier: true })).toEqual({
      docked: false,
      ring: 2,
      frontier: true,
      distanceFromHome: 1700,
      speed: 50,
      combatThreat: 0,
      nearMystery: false,
    });
  });

  it('a docked ship is docked and under no threat', () => {
    const sim = new Simulation({ seed: 4, grid: createGrid([['cockpit', 0, 0]]), generator: empty });
    expect(sim.state.player.dock.mode).toBe('docked');
    addEnemy(sim, 'hammer', 20);
    expect(gameMusicSituation(sim.state)).toMatchObject({ docked: true, combatThreat: 0 });
  });
});

describe('combatThreat', () => {
  it('counts attacking pirates within leash range, a Hammer more than a Jackal, near ones in full', () => {
    const sim = flying();
    addEnemy(sim, 'jackal', 100);
    expect(combatThreat(sim.state)).toBeCloseTo(MUSIC_THREAT.jackal);
    addEnemy(sim, 'hammer', 300);
    expect(combatThreat(sim.state)).toBeCloseTo(MUSIC_THREAT.jackal + MUSIC_THREAT.hammer * 0.7);
  });

  it('ignores patrols, fleeing pirates, scavengers, paid-off pirates and far attackers', () => {
    const sim = flying();
    addEnemy(sim, 'jackal', 50, 'patrol');
    addEnemy(sim, 'jackal', 50, 'flee');
    addEnemy(sim, 'scavenger', 50, 'attack');
    addEnemy(sim, 'jackal', 50).calm = true;
    addEnemy(sim, 'hammer', 900);
    expect(combatThreat(sim.state)).toBe(0);
  });

  it('a toll demand is tension, a recent hit adds, and it never exceeds 1', () => {
    const sim = flying();
    addEnemy(sim, 'jackal', 100, 'hail');
    expect(combatThreat(sim.state)).toBeCloseTo(MUSIC_THREAT.hail);
    expect(combatThreat(sim.state, true)).toBeCloseTo(MUSIC_THREAT.hail + MUSIC_THREAT.recentHit);
    for (let i = 0; i < 6; i++) addEnemy(sim, 'hammer', 30);
    expect(combatThreat(sim.state)).toBe(1);
  });

  it('a standing fortress within turret reach is a threat', () => {
    const site = fortressSites(4)[0]!;
    const sim = flying(site.pos.x + 100, site.pos.y);
    expect(combatThreat(sim.state)).toBeCloseTo(MUSIC_THREAT.fortress);
    const far = flying(site.pos.x + MUSIC_THREAT.fortressRange + 400, site.pos.y);
    expect(combatThreat(far.state)).toBe(0);
  });
});

describe('nearMystery', () => {
  it('only near an Echo the player has heard or found – no spoilers', () => {
    const site = echoSites(4)[0]!;
    const sim = flying(site.pos.x + MYSTERY_RADIUS * 0.5, site.pos.y);
    expect(nearMystery(sim.state)).toBe(false);
    sim.state.discovery.fixes.set(site.id, { pulses: [], radius: 500 });
    expect(nearMystery(sim.state)).toBe(true);
    sim.state.player.body.pos = { x: site.pos.x + MYSTERY_RADIUS * 2, y: site.pos.y };
    expect(nearMystery(sim.state)).toBe(false);
  });
});

describe('HitMemory', () => {
  it('remembers hits on the player for a few seconds', () => {
    const m = new HitMemory();
    expect(m.recent(0)).toBe(false);
    const hit = { type: 'projectileHit', target: 'ship', owner: 'e1', ref: PLAYER_REF, pos: { x: 0, y: 0 }, damage: 5, from: { x: 0, y: 0 } } as const;
    m.note({ ...hit, ref: 'e2' }, 100);
    expect(m.recent(100)).toBe(false);
    m.note(hit, 100);
    expect(m.recent(100 + 60 * MUSIC_THREAT.recentHitSeconds)).toBe(true);
    expect(m.recent(100 + 60 * MUSIC_THREAT.recentHitSeconds + 1)).toBe(false);
  });

  it('forgets a hit when the clock goes backwards (new game / loaded save)', () => {
    const m = new HitMemory();
    const hit = { type: 'projectileHit', target: 'ship', owner: 'e1', ref: PLAYER_REF, pos: { x: 0, y: 0 }, damage: 5, from: { x: 0, y: 0 } } as const;
    m.note(hit, 50_000);
    // a fresh game starts at tick 0 – before the remembered hit
    expect(m.recent(10)).toBe(false);
    // and stays calm afterwards (the stale hit is gone, not just hidden)
    expect(m.recent(50_000)).toBe(false);
  });

  it('reset() forgets the last hit', () => {
    const m = new HitMemory();
    const hit = { type: 'projectileHit', target: 'shield', owner: 'e1', ref: PLAYER_REF, pos: { x: 0, y: 0 }, damage: 5, from: { x: 0, y: 0 } } as const;
    m.note(hit, 100);
    expect(m.recent(110)).toBe(true);
    m.reset();
    expect(m.recent(110)).toBe(false);
  });
});

describe('musicScreenFor', () => {
  it('maps the app state to the music screen', () => {
    expect(musicScreenFor({ kind: 'boot' })).toBe('menu');
    expect(musicScreenFor({ kind: 'menu', page: 'settings' })).toBe('menu');
    expect(musicScreenFor({ kind: 'game', overlay: null })).toBe('game');
    expect(musicScreenFor({ kind: 'game', overlay: 'pause' })).toBe('paused');
    expect(musicScreenFor({ kind: 'game', overlay: 'settings' })).toBe('paused');
    expect(musicScreenFor({ kind: 'game', overlay: 'death' })).toBe('overlay');
  });
});

describe('M4b: new enemies and space events', () => {
  it('a Gunner (also breaking away) and a sentry drone are hostile; a dormant sleeper is not until awake', () => {
    const sim = flying();
    addEnemy(sim, 'gunner', 100, 'evade');
    expect(combatThreat(sim.state)).toBeCloseTo(MUSIC_THREAT.gunner);
    addEnemy(sim, 'sentry', 100);
    expect(combatThreat(sim.state)).toBeCloseTo(MUSIC_THREAT.gunner + MUSIC_THREAT.sentry);
    const sleeper = addEnemy(sim, 'jackal', 60, 'dormant');
    expect(combatThreat(sim.state)).toBeCloseTo(MUSIC_THREAT.gunner + MUSIC_THREAT.sentry);
    sleeper.ai.mode = 'attack';
    expect(combatThreat(sim.state)).toBeCloseTo(MUSIC_THREAT.gunner + MUSIC_THREAT.sentry + MUSIC_THREAT.jackal);
  });

  it('a micrometeor shower is tense from its warning to its end, an ambush during its lead', () => {
    const m = new EventMoments();
    expect(m.tension(0)).toBe(0);
    m.note({ type: 'eventWarning', key: 'ev:micrometeors:s@1', kind: 'micrometeors', inSeconds: 8, dir: 0 }, 100);
    expect(m.tension(200)).toBeCloseTo(MUSIC_THREAT.micrometeors);
    m.note({ type: 'eventWarning', key: 'ev:ambush:s@2', kind: 'ambush', inSeconds: 6, dir: 0 }, 300);
    expect(m.tension(310)).toBeCloseTo(MUSIC_THREAT.micrometeors + MUSIC_THREAT.ambushLead);
    // the party is out – the pirates themselves count now
    m.note({ type: 'ambushSpawned', key: 'ev:ambush:s@2', count: 3, pos: { x: 0, y: 0 }, leader: 'hammer' }, 660);
    expect(m.tension(660)).toBeCloseTo(MUSIC_THREAT.micrometeors);
    m.note({ type: 'eventEnded', key: 'ev:micrometeors:s@1', kind: 'micrometeors' }, 1500);
    expect(m.tension(1500)).toBe(0);
    // comets and ion storms are not tense
    m.note({ type: 'eventWarning', key: 'ev:comet:cm:1@2', kind: 'cometFlyby', inSeconds: 90, dir: 0 }, 1600);
    expect(m.tension(1600)).toBe(0);
  });

  it('an event without its end stops being tense after the cap; a loaded game forgets it', () => {
    const m = new EventMoments();
    m.note({ type: 'eventWarning', key: 'ev:micrometeors:s@1', kind: 'micrometeors', inSeconds: 8, dir: 0 }, 1000);
    expect(m.tension(1000 + MUSIC_THREAT.eventCapSeconds * 60)).toBeGreaterThan(0);
    expect(m.tension(1001 + MUSIC_THREAT.eventCapSeconds * 60)).toBe(0);
    m.note({ type: 'eventWarning', key: 'ev:micrometeors:s@2', kind: 'micrometeors', inSeconds: 8, dir: 0 }, 9000);
    expect(m.tension(10)).toBe(0);
  });

  it('a comet sighted or a derelict’s first berth plays the mystery mood for a while', () => {
    const m = new EventMoments();
    expect(m.discovery(0)).toBe(false);
    m.note({ type: 'cometSighted', id: 'cm:1', pos: { x: 0, y: 0 } }, 100);
    expect(m.discovery(100 + DISCOVERY_SECONDS * 60)).toBe(true);
    expect(m.discovery(101 + DISCOVERY_SECONDS * 60)).toBe(false);
    m.note({ type: 'derelictVisited', id: 'dl:1,2', data: 80, journal: null }, 5000);
    expect(m.moments(5010)).toEqual({ tension: 0, discovery: true });
    m.reset();
    expect(m.discovery(5010)).toBe(false);
  });

  it('the moments reach the situation; berthed at a derelict is the mystery mood', () => {
    const sim = flying();
    const zone = { depth: 2, frontier: true };
    expect(gameMusicSituation(sim.state, false, zone, { tension: 0.16, discovery: false })).toMatchObject({ combatThreat: 0.16, nearMystery: false });
    expect(gameMusicSituation(sim.state, false, zone, { tension: 0, discovery: true }).nearMystery).toBe(true);
    sim.state.sites.berth = 'dl:3,4';
    expect(gameMusicSituation(sim.state, false, zone).nearMystery).toBe(true);
  });
});

describe('M4d: the Guild Watch and the relay hold', () => {
  it('a live Watch ship fighting a pirate near the player is combat (once, however many fight); far or patrolling is not', () => {
    const sim = flying();
    const p = sim.state.player.body.pos;
    const fighting = syntheticWatch('gw:lane:A:0|1', { x: p.x + 300, y: p.y });
    fighting.target = 'pr:1,1:0';
    sim.state.guild.watch.push(fighting);
    expect(combatThreat(sim.state)).toBeCloseTo(MUSIC_THREAT.watchFight);
    expect(MUSIC_THREAT.watchFight).toBeGreaterThanOrEqual(MUSIC_TIMING.combatEnterThreat);
    const second = syntheticWatch('gw:lane:A:0|2', { x: p.x - 200, y: p.y });
    second.target = 'pr:1,1:1';
    sim.state.guild.watch.push(second);
    expect(combatThreat(sim.state)).toBeCloseTo(MUSIC_THREAT.watchFight);
    sim.state.guild.watch = [{ ...fighting, body: { ...fighting.body, pos: { x: p.x + MUSIC_THREAT.watchFightRange + 50, y: p.y } } }, { ...second, mode: 'patrol', target: null }];
    expect(combatThreat(sim.state)).toBe(0);
  });

  it('a powered relay’s warning is tense until the counterattack is due', () => {
    const m = new EventMoments();
    m.note({ type: 'relayHoldStarted', lane: 'A', at: { x: 0, y: 0 } }, 100);
    expect(m.tension(100 + 3 * 60)).toBeCloseTo(MUSIC_THREAT.relayHoldLead);
    expect(m.tension(100 + (RELAY_CHAIN.counterattackDelay + 2) * 60)).toBe(0);
  });
});
