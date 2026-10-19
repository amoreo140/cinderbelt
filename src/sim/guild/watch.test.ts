// Live Guild Watch ships (M4d T3): the live bubble, the patrol on the schedule, target choice, leash,
// retreat, destruction and respawn, guns without friendly fire, determinism.
import { describe, expect, it, vi } from 'vitest';
import { WATCH } from '../../data/guild';
import { createEnemy } from '../combat/enemies';
import type { Enemy, EnemyKind } from '../combat/types';
import { IDLE_COMMAND } from '../commands';
import { teleport } from '../discovery/testing';
import { add, type Vec2 } from '../math/vec2';
import { inCorridor } from '../regions/lanes';
import { sectorInfoAt, sectorLanes } from '../regions/sectors';
import { Simulation, type SimEvent } from '../Simulation';
import { guildAction } from './debug';
import { createWatchShip, debugWatchNear, manageWatch, spawnRelayWatch, stepWatch } from './watch';
import { chooseTarget, stepWatchAi } from './watchAi';
import { onWatchHit, watchColliders, watchHitTargets } from './watchHits';
import { routeById, scheduledAt, scheduledWatchNear, type PatrolRoute } from './watchRoutes';

const SEED = 1;
const DT = 1 / 60;

function pirate(id: string, kind: EnemyKind, pos: Vec2, mode: Enemy['ai']['mode'] = 'patrol'): Enemy {
  const e = createEnemy({ id, kind, tier: 1, pos, angle: 0, home: pos, orbit: 1 });
  e.ai.mode = mode;
  return e;
}

/** A flying game with the player `side` u beside the leader of `route` at `tick` (a multiple of 30). */
function besideRoute(routeId = 'lane:B:1', tick = 6000, side = 120): { sim: Simulation; route: PatrolRoute } {
  const sim = new Simulation({ seed: SEED, startDocked: false });
  sim.state.tick = tick;
  const route = routeById(sim.state, routeId)!;
  const s = scheduledAt(route, 0, tick);
  teleport(sim, add(s.pos, { x: Math.sin(s.heading) * side, y: -Math.cos(s.heading) * side }));
  sim.state.combat.enemies = [];
  return { sim, route };
}

/** The first point of a ring search (from `from`) that passes `test`. */
function findSpot(test: (p: Vec2) => boolean, from: Vec2 = { x: 0, y: 0 }): Vec2 {
  for (let r = 300; r < 9000; r += 150) {
    for (let a = 0; a < 48; a++) {
      const p = { x: from.x + Math.cos((a / 48) * Math.PI * 2) * r, y: from.y + Math.sin((a / 48) * Math.PI * 2) * r };
      if (test(p)) return p;
    }
  }
  throw new Error('no spot');
}

describe('Guild Watch live bubble', () => {
  it('materialises scheduled ships within 520 u at their scheduled pose, never over 3', () => {
    const { sim } = besideRoute();
    const near = scheduledWatchNear(sim.state, sim.state.player.body.pos, WATCH.liveRadius);
    expect(near.length).toBeGreaterThan(0);
    manageWatch(sim.state);
    const live = sim.state.guild.watch;
    expect(live.length).toBe(Math.min(WATCH.maxLive, near.length));
    for (const w of live) {
      const s = near.find((x) => x.id === w.id)!;
      expect(w.body.pos).toEqual(s.pos);
      expect(w.body.vel).toEqual(s.vel);
      expect(w.body.angle).toBe(s.heading);
      expect(w.hull).toBe(WATCH.ships[w.kind].hull);
      expect(w.mode).toBe('patrol');
    }
    // far from every route: nothing
    const far = new Simulation({ seed: SEED, startDocked: false });
    teleport(far, { x: 40_000, y: 40_000 });
    manageWatch(far.state);
    expect(far.state.guild.watch).toEqual([]);
  });

  it('never materialises a lost id (until it respawns), nor while docked, nor over the AI budget', () => {
    const { sim } = besideRoute();
    const first = scheduledWatchNear(sim.state, sim.state.player.body.pos, WATCH.liveRadius)[0]!;
    sim.state.guild.lost.set(first.id, sim.state.tick);
    manageWatch(sim.state);
    expect(sim.state.guild.watch.map((w) => w.id)).not.toContain(first.id);
    // 20 game minutes later it is back on its route
    sim.state.guild.watch = [];
    sim.state.tick += WATCH.respawnTicks;
    stepWatch(sim.state, [], DT);
    expect(sim.state.guild.lost.has(first.id)).toBe(false);

    // the budget: pirates + live Watch ≤ 10, pirates keep priority
    const b = besideRoute();
    for (let i = 0; i < WATCH.aiBudget - 1; i++) b.sim.state.combat.enemies.push(pirate(`pr:t:${i}`, 'jackal', { x: 90_000 + i * 50, y: 0 }));
    manageWatch(b.sim.state);
    expect(b.sim.state.guild.watch.length).toBe(1);
    b.sim.state.guild.watch = [];
    b.sim.state.combat.enemies.push(pirate('pr:t:last', 'jackal', { x: 80_000, y: 0 }));
    manageWatch(b.sim.state);
    expect(b.sim.state.guild.watch).toEqual([]);

    const docked = besideRoute();
    docked.sim.state.player.dock = { mode: 'docked', stationId: 'home' } as typeof docked.sim.state.player.dock;
    manageWatch(docked.sim.state);
    expect(docked.sim.state.guild.watch).toEqual([]);
  });

  it('flies a patrol exactly on the schedule (no drift) and returns to it beyond 800 u', () => {
    const { sim, route } = besideRoute('lane:B:1', 6000, 60);
    for (let t = 0; t < 900; t++) {
      sim.state.combat.enemies = [];
      sim.state.player.body = { ...sim.state.player.body, pos: scheduledAt(route, 0, sim.state.tick).pos };
      sim.step(IDLE_COMMAND);
      for (const w of sim.state.guild.watch) {
        expect(w.mode).toBe('patrol');
        const r = routeById(sim.state, w.route)!;
        expect(w.body.pos).toEqual(scheduledAt(r, w.slot, sim.state.tick - 1).pos);
      }
    }
    expect(sim.state.guild.watch.length).toBeGreaterThan(0);
    // the player leaves: the patrol ships go back to the schedule
    teleport(sim, add(sim.state.player.body.pos, { x: 2000, y: 0 }));
    for (let t = 0; t < 31; t++) {
      sim.state.combat.enemies = [];
      sim.step(IDLE_COMMAND);
    }
    expect(sim.state.guild.watch).toEqual([]);
  });

  it('is an obstacle and a hit target with its shield', () => {
    const { sim } = besideRoute();
    expect(watchColliders(sim.state, sim.state.player.body.pos, 50)).toEqual([]);
    manageWatch(sim.state);
    const w = sim.state.guild.watch[0]!;
    const c = watchColliders(sim.state, w.body.pos, 1);
    expect(c[0]).toMatchObject({ radius: WATCH.ships[w.kind].radius, safe: true });
    expect(watchHitTargets(sim.state)[0]).toMatchObject({ id: w.id, kind: 'watch', shield: WATCH.ships[w.kind].shield, damageable: true });
  });
});

describe('Guild Watch target choice', () => {
  const sim = new Simulation({ seed: SEED, startDocked: false });
  const lanes = sectorLanes(SEED);
  const guarded = (p: Vec2) => sectorInfoAt(SEED, p.x, p.y).security === 'guarded';
  const contested = (p: Vec2) => sectorInfoAt(SEED, p.x, p.y).security === 'contested';
  const clearOf = (p: Vec2, test: (q: Vec2) => boolean, r = 280) => [0, 1, 2, 3, 4, 5, 6, 7].every((k) => test(add(p, { x: Math.cos(k) * r, y: Math.sin(k) * r })));

  const watchAt = (pos: Vec2) => {
    const route = routeById(sim.state, 'lane:A:0')!;
    const w = createWatchShip({ ...scheduledAt(route, 1, 0), pos }, 0);
    sim.state.guild.watch = [w];
    return w;
  };

  it('defends the player first, then retaliates, then takes the nearest pirate in its beat', () => {
    const at = findSpot((p) => inCorridor(lanes, p.x, p.y) && clearOf(p, (q) => inCorridor(lanes, q.x, q.y), 210));
    teleport(sim, add(at, { x: 150, y: 0 }));
    const w = watchAt(at);
    const beat = pirate('pr:t:beat', 'jackal', add(at, { x: -60, y: 0 }));
    const attacker = pirate('pr:t:att', 'hammer', add(at, { x: 200, y: 30 }), 'attack');
    const hitter = pirate('pr:t:hit', 'jackal', add(at, { x: 0, y: -120 }));
    sim.state.combat.enemies = [beat, attacker, hitter];
    expect(chooseTarget(sim.state, w, at)?.id).toBe('pr:t:att');
    sim.state.combat.enemies = [beat, hitter];
    w.target = 'pr:t:hit';
    w.lastHitBy = sim.state.tick;
    expect(chooseTarget(sim.state, w, at)?.id).toBe('pr:t:hit');
    w.lastHitBy = sim.state.tick - 5 * 60;
    expect(chooseTarget(sim.state, w, at)?.id).toBe('pr:t:beat');
    // scavengers and dormant sleepers never; beyond 260 u nothing
    sim.state.combat.enemies = [pirate('pr:t:sc', 'scavenger', add(at, { x: 30, y: 0 })), pirate('pr:t:dm', 'hammer', add(at, { x: -30, y: 0 }), 'dormant'), pirate('pr:t:far', 'jackal', add(at, { x: 0, y: 270 }))];
    expect(chooseTarget(sim.state, w, at)).toBeNull();
  });

  it('ignores pirates in Contested space off the lane corridor, fights them in a Guarded sector', () => {
    const off = findSpot((p) => contested(p) && clearOf(p, (q) => contested(q) && !inCorridor(lanes, q.x, q.y)));
    teleport(sim, add(off, { x: 5000, y: 0 }));
    const w = watchAt(off);
    sim.state.combat.enemies = [pirate('pr:t:c', 'jackal', add(off, { x: 100, y: 0 }))];
    expect(chooseTarget(sim.state, w, off)).toBeNull();
    const safe = findSpot((p) => clearOf(p, (q) => guarded(q) && !inCorridor(lanes, q.x, q.y)));
    w.body = { ...w.body, pos: safe };
    sim.state.combat.enemies = [pirate('pr:t:g', 'jackal', add(safe, { x: 100, y: 0 }))];
    expect(chooseTarget(sim.state, w, safe)?.id).toBe('pr:t:g');
    // never farther than the leash from the scheduled point
    expect(chooseTarget(sim.state, w, add(safe, { x: 600, y: 0 }))).toBeNull();
  });
});

describe('Guild Watch modes', () => {
  it('engages, fires Watch shots that never hit the player, keeps the leash, returns and patrols again', () => {
    const { sim, route } = besideRoute('lane:B:1', 6000, 40);
    manageWatch(sim.state);
    const w = sim.state.guild.watch.find((x) => x.route === route.id && x.slot === 0)!;
    // a pirate attacking the player right behind the Watch ship – the player sits in the line of fire
    const e = pirate('pr:t:a', 'hammer', add(w.body.pos, { x: 0, y: 0 }), 'attack');
    e.body = { ...e.body, pos: add(sim.state.player.body.pos, { x: Math.sin(w.body.angle) * 40, y: -Math.cos(w.body.angle) * 40 }) };
    sim.state.combat.enemies = [e];
    const events: SimEvent[] = [];
    let engaged = false;
    for (let t = 0; t < 600; t++) {
      sim.state.combat.enemies = sim.state.combat.enemies.filter((x) => x.id === e.id);
      // the pirate is held in place so the fight stays here
      const p = sim.state.combat.enemies[0];
      if (p) p.body = { ...p.body, pos: e.body.pos, vel: { x: 0, y: 0 } };
      events.push(...sim.step(IDLE_COMMAND));
      engaged ||= w.mode === 'engage';
    }
    expect(engaged).toBe(true);
    const shots = events.filter((x) => x.type === 'shotFired' && x.owner === w.id);
    expect(shots.length).toBeGreaterThan(0);
    expect(events.some((x) => x.type === 'projectileHit' && x.owner.startsWith('gw:') && x.ref === 'player')).toBe(false);

    // the leash: a target dragged away is given up, the ship returns and patrols on the schedule again
    const s2 = besideRoute('lane:B:1', 9000, 40);
    manageWatch(s2.sim.state);
    const v = s2.sim.state.guild.watch[0]!;
    const target = pirate('pr:t:l', 'jackal', add(v.body.pos, { x: 80, y: 0 }), 'patrol');
    s2.sim.state.combat.enemies = [target];
    const modes = new Set<string>();
    for (let t = 0; t < 120 * 60; t++) {
      const anchor = scheduledAt(routeById(s2.sim.state, v.route)!, v.slot, s2.sim.state.tick).pos;
      target.body = { ...target.body, pos: add(anchor, { x: 80 + t * 0.05, y: 0 }), vel: { x: 3, y: 0 } };
      stepWatchAi(s2.sim.state, v, [], DT);
      s2.sim.state.tick++;
      modes.add(v.mode);
      if (modes.has('return') && v.mode === 'patrol') break;
      if (t > 60 * 60) s2.sim.state.combat.enemies = [];
    }
    expect([...modes]).toEqual(expect.arrayContaining(['engage', 'return', 'patrol']));
    expect(v.mode).toBe('patrol');
  });

  it('a pirate the Watch destroys leaves no cargo and is not the player\'s kill', () => {
    const { sim } = besideRoute('lane:B:1', 6000, 300);
    manageWatch(sim.state);
    const w = sim.state.guild.watch[0]!;
    const e = pirate('pr:t:k', 'jackal', add(w.body.pos, { x: 50, y: 0 }));
    sim.state.combat.enemies = [e];
    const events: SimEvent[] = [];
    for (let t = 0; t < 120 * 60 && sim.state.combat.enemies.some((x) => x.id === e.id); t++) {
      sim.state.combat.enemies = sim.state.combat.enemies.filter((x) => x.id === e.id);
      // held in front of the Watch, out of the player's way
      const p = sim.state.combat.enemies[0];
      if (p) p.body = { ...p.body, pos: add(w.body.pos, { x: 50, y: 0 }), vel: { ...w.body.vel } };
      // the player keeps 300 u away (inside the spawn bubble, out of the fight)
      sim.state.player.body = { ...sim.state.player.body, pos: add(w.body.pos, { x: -300, y: 0 }), vel: { ...w.body.vel } };
      events.push(...sim.step(IDLE_COMMAND));
    }
    const kill = events.find((x) => x.type === 'shipDestroyed' && x.ref === e.id);
    expect(kill).toMatchObject({ by: expect.stringMatching(/^gw:/) });
    expect(sim.state.stats.kills).toBe(0);
    for (const wr of sim.state.combat.wrecks.filter((x) => x.livery === 'pirate')) expect(Object.values(wr.loot.cargo).every((n) => n === 0)).toBe(true);
  });

  it('gives up a target farther than the leash from its scheduled point', () => {
    const { sim, route } = besideRoute();
    manageWatch(sim.state);
    const w = sim.state.guild.watch[0]!;
    const anchor = scheduledAt(route, w.slot, sim.state.tick).pos;
    const e = pirate('pr:t:far', 'jackal', add(anchor, { x: WATCH.leash + 60, y: 0 }), 'attack');
    sim.state.combat.enemies = [e];
    w.mode = 'engage';
    w.target = e.id;
    w.body = { ...w.body, pos: add(anchor, { x: WATCH.leash + 5, y: 0 }) };
    stepWatchAi(sim.state, w, [], DT);
    expect(w.mode).toBe('return');
    expect(w.target).toBeNull();
  });

  it('retreats below 25 % hull and leaves far from the player (then counts as lost)', () => {
    const { sim } = besideRoute();
    manageWatch(sim.state);
    const w = sim.state.guild.watch[0]!;
    w.hull = WATCH.ships[w.kind].hull * 0.2;
    sim.state.combat.enemies = [pirate('pr:t:r', 'jackal', add(w.body.pos, { x: 50, y: 0 }), 'attack')];
    const events: SimEvent[] = [];
    stepWatch(sim.state, events, DT);
    expect(w.mode).toBe('retreat');
    expect(events).toContainEqual({ type: 'watchRetreated', id: w.id });
    teleport(sim, add(w.body.pos, { x: 700, y: 0 }));
    sim.state.tick++;
    stepWatch(sim.state, events, DT);
    expect(sim.state.guild.watch.includes(w)).toBe(false);
    expect(sim.state.guild.lost.get(w.id)).toBe(sim.state.tick);
  });

  it('a destroyed Watch ship is lost: shield first, then hull, npcDestroyed, no wreck', () => {
    const { sim } = besideRoute();
    manageWatch(sim.state);
    const w = sim.state.guild.watch[0]!;
    const def = WATCH.ships[w.kind];
    const target = watchHitTargets(sim.state).find((t) => t.id === w.id)!;
    const events: SimEvent[] = [];
    onWatchHit(sim.state, target, { owner: 'pr:x', pos: w.body.pos, damage: 10, from: w.body.pos }, events);
    expect(w.shield).toBe(def.shield - 10);
    expect(w.hull).toBe(def.hull);
    expect(w.target).toBe('pr:x');
    expect(w.lastHitBy).toBe(sim.state.tick);
    expect(events[0]).toMatchObject({ type: 'npcHit', id: w.id, shielded: true, by: 'pr:x' });
    const wrecks = sim.state.combat.wrecks.length;
    onWatchHit(sim.state, target, { owner: 'pr:x', pos: w.body.pos, damage: def.hull + def.shield, from: w.body.pos }, events);
    expect(events.at(-1)).toMatchObject({ type: 'npcDestroyed', id: w.id, kind: w.kind, by: 'pr:x' });
    expect(sim.state.guild.watch.includes(w)).toBe(false);
    expect(sim.state.guild.lost.get(w.id)).toBe(sim.state.tick);
    expect(sim.state.combat.wrecks.length).toBe(wrecks);
  });

  it('regenerates its shield after the delay', () => {
    const { sim } = besideRoute();
    manageWatch(sim.state);
    const w = sim.state.guild.watch[0]!;
    const def = WATCH.ships[w.kind];
    w.shield = 0;
    w.shieldDelay = def.shieldDelay;
    for (let t = 0; t < def.shieldDelay * 60; t++) stepWatchAi(sim.state, w, [], DT);
    expect(w.shield).toBeLessThan(1);
    for (let t = 0; t < 60; t++) stepWatchAi(sim.state, w, [], DT);
    expect(w.shield).toBeCloseTo(def.shieldRegen, 0);
  });
});

describe('Guild Watch dev action and relay reinforcement', () => {
  it('debugGuild watch puts the player beside the nearest scheduled ship and materialises it', () => {
    const sim = new Simulation({ seed: SEED, startDocked: false });
    sim.state.tick = 3000;
    const [r] = guildAction(sim.state, { type: 'debugGuild', what: 'watch', reqId: 7 });
    expect(r).toEqual({ type: 'actionResult', reqId: 7, ok: true });
    const w = sim.state.guild.watch[0]!;
    const d = Math.hypot(w.body.pos.x - sim.state.player.body.pos.x, w.body.pos.y - sim.state.player.body.pos.y);
    expect(d).toBeCloseTo(60, 5);
    const docked = new Simulation({ seed: SEED });
    expect(guildAction(docked.state, { type: 'debugGuild', what: 'watch', reqId: 8 })[0]).toMatchObject({ ok: false });
  });

  it('every debugGuild command is refused in a production build – no teleport beside a Watch ship (G4)', () => {
    vi.stubEnv('DEV', false);
    try {
      const sim = new Simulation({ seed: SEED, startDocked: false });
      sim.state.tick = 3000;
      const before = { ...sim.state.player.body.pos };
      for (const what of ['watch', 'secure', 'convoy'] as const) {
        expect(guildAction(sim.state, { type: 'debugGuild', what, reqId: 9 })).toEqual([{ type: 'actionResult', reqId: 9, ok: false, reason: 'serviceUnavailable' }]);
      }
      expect(sim.state.player.body.pos).toEqual(before);
      expect(sim.state.guild.watch).toEqual([]);
      expect(debugWatchNear(sim.state, { type: 'debugGuild', what: 'watch', reqId: 9 })[0]).toMatchObject({ ok: false });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('the relay reinforcement needs a Guild relay site', () => {
    const sim = new Simulation({ seed: SEED, startDocked: false });
    const ships = spawnRelayWatch(sim.state, 'A');
    // with a relay site (T2) the frigate and two cutters come in, otherwise nothing
    for (const s of ships) {
      expect(s.id.startsWith('gw:relay:A|')).toBe(true);
      expect(s.mode).toBe('return');
    }
    expect(ships.length === 0 || ships.length === 3).toBe(true);
  });
});

describe('Guild Watch determinism', () => {
  it('the same commands give the same Watch and combat state', () => {
    const run = () => {
      const { sim, route } = besideRoute('lane:B:1', 6000, 40);
      const s = scheduledAt(route, 0, 6000);
      sim.state.combat.enemies = [pirate('pr:t:d', 'hammer', add(s.pos, { x: 90, y: 20 }), 'patrol'), pirate('pr:t:e', 'jackal', add(s.pos, { x: -60, y: 70 }), 'patrol')];
      for (let t = 0; t < 1200; t++) sim.step(IDLE_COMMAND);
      return JSON.stringify({ watch: sim.state.guild.watch, lost: [...sim.state.guild.lost], enemies: sim.state.combat.enemies.map((e) => [e.id, e.body, [...e.hp]]), rng: sim.state.combat.rng, n: sim.state.combat.nextId });
    };
    expect(run()).toBe(run());
  });
});
