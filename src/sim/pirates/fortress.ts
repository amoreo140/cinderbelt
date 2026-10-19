// Rust fortress (design 6.5, M3.6): an asteroid with four turrets, two shield generators behind the
// rock that must fall first, and the core (a stolen Kovaci relic). While a generator stands, the core
// is shielded. Reinforcements launch from spawn_0 every 45 s while the player is near. The fortress
// gives a big reward, fragments and guild reputation; it is rebuilt after an hour of game time with
// a smaller reward (the Resonator drops only the first time).
import { FORTRESS, GUNNER } from '../../data/pirates';
import { PLAN_IDS } from '../../data/plans';
import { createEnemy } from '../combat/enemies';
import { segmentCircle } from '../combat/geometry';
import { aimSkill, aimWithError } from '../combat/aim';
import type { Projectile } from '../combat/types';
import { awardFragment } from '../discovery/plans';
import { gainData } from '../discovery/state';
import { addPoints } from '../factions/reputation';
import { normalizeAngle } from '../math/angle';
import { add, hypot, length, scale, sub, type Vec2 } from '../math/vec2';
import type { Circle } from '../physics/collide';
import type { SimEvent, SimState } from '../Simulation';
import { addAttention, warChest } from './pirates';
import { FORTRESS_LAYOUT, fortressCircles, fortressSites, fortressToWorld, type FortressSite } from './sites';
import type { FortressState } from './state';
import { ATTENTION } from '../../data/pirates';

const TICKS = 60;
/** Turret firing arc around its outward rest aim (rad). */
const TURRET_ARC = (100 * Math.PI) / 180;
/** A turret or generator hit counts even this far (j) behind the rock surface in front of it. */
const PART_PRIORITY = 1.5;
/** Fortress logic runs only when the player is this close. */
const ACTIVE_RANGE = 900;

export function freshFortress(): FortressState {
  return {
    core: FORTRESS.coreHp,
    gens: FORTRESS_LAYOUT.shieldGens.map(() => FORTRESS.generatorHp),
    turrets: FORTRESS_LAYOUT.turrets.map(() => FORTRESS.turretHp),
    destroyed: null,
    kills: 0,
    reinforce: 0,
    spawned: 0,
    cooldowns: FORTRESS_LAYOUT.turrets.map(() => 0),
  };
}

/** Fortress state (an untouched fortress is fresh – not stored until something happens). */
export const fortressStatus = (state: SimState, id: string): FortressState => state.pirates.fortresses.get(id) ?? freshFortress();

function touch(state: SimState, id: string): FortressState {
  let f = state.pirates.fortresses.get(id);
  if (!f) {
    f = freshFortress();
    state.pirates.fortresses.set(id, f);
  }
  return f;
}

export const fortressAlive = (f: FortressState): boolean => f.destroyed === null;
/** The core is shielded while any generator stands. */
export const coreShielded = (f: FortressState): boolean => f.gens.some((hp) => hp > 0);

/** Collision circles of fortresses near a point (the rock stays even after destruction). */
export function fortressObstacles(state: SimState, pos: Vec2, reach: number): Circle[] {
  return fortressObstaclesInto(state, pos, reach, []);
}

/** `fortressCircles` per site object (pure in the site; the obstacle lists only read them). */
const circlesBySite = new WeakMap<FortressSite, readonly Circle[]>();

/** `fortressObstacles` appended to `out` (same order) – no lists per call (perf audit 2026-10-17, P4). */
export function fortressObstaclesInto(state: SimState, pos: Vec2, reach: number, out: Circle[]): Circle[] {
  const sites = fortressSites(state.seed);
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i]!;
    if (hypot(site.pos.x - pos.x, site.pos.y - pos.y) > reach + FORTRESS_LAYOUT.clearRadius) continue;
    let circles = circlesBySite.get(site);
    if (!circles) {
      circles = fortressCircles(site);
      circlesBySite.set(site, circles);
    }
    for (let k = 0; k < circles.length; k++) {
      const c = circles[k]!;
      if (hypot(c.pos.x - pos.x, c.pos.y - pos.y) <= reach + c.radius) out.push(c);
    }
  }
  return out;
}

/** World positions of turrets and generators (render, UI). */
export const turretWorld = (site: FortressSite, i: number): Vec2 => fortressToWorld(site, FORTRESS_LAYOUT.turrets[i]!);
export const generatorWorld = (site: FortressSite, i: number): Vec2 => fortressToWorld(site, FORTRESS_LAYOUT.shieldGens[i]!);

type FortressTarget = { kind: 'turret' | 'generator'; index: number; pos: Vec2; radius: number } | { kind: 'rock'; pos: Vec2; radius: number };

function targets(site: FortressSite, f: FortressState): FortressTarget[] {
  const out: FortressTarget[] = [];
  f.turrets.forEach((hp, i) => {
    if (hp > 0 && fortressAlive(f)) out.push({ kind: 'turret', index: i, pos: turretWorld(site, i), radius: FORTRESS.turretRadius });
  });
  f.gens.forEach((hp, i) => {
    if (hp > 0 && fortressAlive(f)) out.push({ kind: 'generator', index: i, pos: generatorWorld(site, i), radius: FORTRESS.generatorRadius });
  });
  for (const c of fortressCircles(site)) out.push({ kind: 'rock', pos: c.pos, radius: c.radius });
  return out;
}

/**
 * Player projectiles that hit a fortress in this step: damage the turret, generator or core (the
 * core only when the shield is down) and leave the projectile list. Runs before the normal hits.
 */
export function fortressProjectiles(state: SimState, events: SimEvent[], dt: number): void {
  const { combat } = state;
  // the fortresses near the ship (a list only when there is one)
  const ship = state.player.body.pos;
  let near: FortressSite[] | null = null;
  for (const s of fortressSites(state.seed)) if (hypot(s.pos.x - ship.x, s.pos.y - ship.y) <= ACTIVE_RANGE + 200) (near ??= []).push(s);
  if (!near) return;
  const keep: Projectile[] = [];
  for (const p of combat.projectiles) {
    const to = add(p.pos, scale(p.vel, dt));
    // turrets and generators sit on the rock: they win over a rock hit up to this far behind it
    const slack = PART_PRIORITY / Math.max(1e-6, length(p.vel) * dt);
    let best: { t: number; site: FortressSite; target: FortressTarget } | null = null;
    for (const site of near) {
      if (length(sub(site.pos, p.pos)) > FORTRESS_LAYOUT.clearRadius + length(p.vel) * dt) continue;
      const f = fortressStatus(state, site.id);
      // turret shots start inside the fortress and fly out; a pirate ship's shot stops at the rock like
      // the player's (M10) but does not hurt its own turrets and generators
      if (p.owner.startsWith('fort:')) continue;
      for (const target of targets(site, f)) {
        if (p.owner !== 'player' && target.kind !== 'rock') continue;
        const inside = length(sub(p.pos, target.pos)) <= target.radius;
        const t = inside ? 0 : segmentCircle(p.pos, to, target.pos, target.radius);
        if (t === null) continue;
        const rank = target.kind === 'rock' ? t : t - slack;
        const bestRank = best ? (best.target.kind === 'rock' ? best.t : best.t - slack) : Infinity;
        if (rank < bestRank) best = { t, site, target };
      }
    }
    if (!best) {
      keep.push(p);
      continue;
    }
    const pos = add(p.pos, scale(sub(to, p.pos), best.t));
    hitFortress(state, best.site, best.target, p, pos, events);
  }
  combat.projectiles = keep;
}

function hitFortress(state: SimState, site: FortressSite, target: FortressTarget, p: Projectile, pos: Vec2, events: SimEvent[]): void {
  if (p.owner !== 'player') {
    // a pirate's shot spent on the rock (M10)
    events.push({ type: 'projectileHit', target: 'station', owner: p.owner, pos, damage: 0, from: p.origin, ref: null, fortress: site.id });
    return;
  }
  const alive = fortressAlive(fortressStatus(state, site.id));
  const shielded = alive && target.kind === 'rock' && coreShielded(fortressStatus(state, site.id));
  events.push({ type: 'projectileHit', target: shielded ? 'shield' : alive ? 'ship' : 'station', owner: p.owner, pos, damage: p.damage, from: p.origin, ref: null, fortress: site.id });
  if (!alive || shielded) return;
  const f = touch(state, site.id);
  if (target.kind === 'turret' || target.kind === 'generator') {
    const list = target.kind === 'turret' ? f.turrets : f.gens;
    const before = list[target.index]!;
    list[target.index] = Math.max(0, before - p.damage);
    if (before > 0 && list[target.index] === 0) {
      events.push({ type: 'fortressPartDestroyed', fortress: site.id, part: target.kind, index: target.index, pos: { ...target.pos } });
      if (target.kind === 'generator' && !coreShielded(f)) events.push({ type: 'fortressShieldDown', fortress: site.id, pos: { ...site.pos } });
    }
    return;
  }
  f.core = Math.max(0, f.core - p.damage);
  if (f.core <= 0) destroyFortress(state, site, f, events);
}

function destroyFortress(state: SimState, site: FortressSite, f: FortressState, events: SimEvent[]): void {
  const first = f.kills === 0;
  f.destroyed = state.tick;
  f.kills++;
  f.turrets = f.turrets.map(() => 0);
  f.gens = f.gens.map(() => 0);
  const credits = first ? FORTRESS.credits : FORTRESS.rebuiltCredits;
  state.credits += credits;
  events.push({ type: 'creditsChanged', delta: credits, reason: 'bounty' });
  const core = fortressToWorld(site, FORTRESS_LAYOUT.core);
  events.push({ type: 'fortressDestroyed', fortress: site.id, pos: core, credits, first });
  // the Resonator (story key item, 5.7.2) only the first time
  if (first && !state.discovery.keyItems.has('resonator')) {
    state.discovery.keyItems.add('resonator');
    events.push({ type: 'keyItemFound', item: 'resonator' });
  }
  // fragments of plans the player does not have yet (deterministic order)
  const missing = PLAN_IDS.filter((id) => !state.discovery.plans.has(id));
  const count = first ? FORTRESS.fragments : 1;
  for (let i = 0; i < count; i++) {
    const plan = missing.length > 0 ? missing[(site.index + i + f.kills) % missing.length]! : PLAN_IDS[(site.index + i) % PLAN_IDS.length]!;
    awardFragment(state, plan, events);
  }
  for (const level of addPoints(state.career.rep, 'guild', FORTRESS.rep)) events.push({ type: 'repLevelUp', faction: 'guild', level });
  gainData(state, FORTRESS.data, 'scan', events);
  addAttention(state, ATTENTION.fortress, events);
  warChest(state, `${site.id}#${f.kills}`, add(core, scale(sub(fortressToWorld(site, FORTRESS_LAYOUT.spawn), core), 1.3)), first ? FORTRESS.chestContainers : 2);
}

const reinforcementPrefix = (site: FortressSite): string => `fr:${site.index}:`;

/** Kind of the fortress's reinforcement number `serial` (0-based): every 3rd one is a Gunner (M4b §2.6 c). */
export const reinforcementKind = (serial: number): 'jackal' | 'gunner' => ((serial + 1) % GUNNER.fortressEvery === 0 ? 'gunner' : 'jackal');

/** Turrets, reinforcements and rebuilding of fortresses near the player. */
export function stepFortresses(state: SimState, _events: readonly SimEvent[], out: SimEvent[]): void {
  const player = state.player;
  const flying = player.dock.mode === 'flying' && !player.destroyed;
  for (const site of fortressSites(state.seed)) {
    const stored = state.pirates.fortresses.get(site.id);
    if (stored && stored.destroyed !== null && state.tick - stored.destroyed >= FORTRESS.rebuildTicks) {
      const kills = stored.kills;
      const fresh = freshFortress();
      state.pirates.fortresses.set(site.id, { ...fresh, kills });
      out.push({ type: 'fortressRebuilt', fortress: site.id });
    }
    const dist = hypot(site.pos.x - player.body.pos.x, site.pos.y - player.body.pos.y);
    if (!flying || dist > ACTIVE_RANGE) continue;
    const f = fortressStatus(state, site.id);
    if (!fortressAlive(f)) continue;
    stepTurrets(state, site, dist, out);
    stepReinforcements(state, site, dist, out);
  }
}

function stepTurrets(state: SimState, site: FortressSite, dist: number, out: SimEvent[]): void {
  const f = fortressStatus(state, site.id);
  const busy = f.cooldowns.some((c) => c > 0);
  if (dist > FORTRESS.aggroRange + FORTRESS_LAYOUT.clearRadius && !busy) return;
  const t = touch(state, site.id);
  const player = state.player;
  const gun = FORTRESS.turret;
  const skill = aimSkill(state.settings.deathPenalty);
  FORTRESS_LAYOUT.turrets.forEach((mount, i) => {
    if (t.cooldowns[i]! > 0) t.cooldowns[i]!--;
    if (t.turrets[i]! <= 0 || t.cooldowns[i]! > 0) return;
    const from = turretWorld(site, i);
    const d = length(sub(player.body.pos, from));
    if (d > gun.range) return;
    // each turret covers ±100° around its outward rest aim
    const rest = site.angle + (mount.yawDeg * Math.PI) / 180;
    const dir = Math.atan2(player.body.pos.y - from.y, player.body.pos.x - from.x);
    if (Math.abs(normalizeAngle(dir - rest)) > TURRET_ARC) return;
    // the turret gunners aim like the pirate ships: lead with the difficulty's aim error (combat/aim.ts)
    const aim = aimWithError(from, { x: 0, y: 0 }, player.body.pos, player.body.vel, gun.projectileSpeed, skill, state.combat);
    const v = sub(aim, from);
    const len = Math.max(1e-6, length(v));
    const vel = scale(v, gun.projectileSpeed / len);
    const pos = add(from, scale(v, 1.2 / len));
    state.combat.projectiles.push({
      id: state.combat.nextId++,
      owner: `fort:${site.index}`,
      pos,
      vel,
      ttl: Math.ceil((gun.range / gun.projectileSpeed) * TICKS),
      damage: gun.damage,
      tier: 2,
      origin: pos,
    });
    out.push({ type: 'shotFired', owner: `fort:${site.index}`, pos: { ...pos }, dir: scale(vel, 1 / gun.projectileSpeed), tier: 2 });
    t.cooldowns[i] = Math.round(TICKS / gun.fireRate) + (i % 2) * 7;
  });
}

function stepReinforcements(state: SimState, site: FortressSite, dist: number, out: SimEvent[]): void {
  if (dist > FORTRESS.reinforceRange) return;
  // with every turret down the fortress is beaten – no more reinforcements to farm (M9)
  if (fortressStatus(state, site.id).turrets.every((hp) => hp <= 0)) return;
  const f = touch(state, site.id);
  if (f.reinforce === 0) f.reinforce = state.tick + 10 * TICKS;
  if (state.tick < f.reinforce) return;
  f.reinforce = state.tick + FORTRESS.reinforceTicks;
  const prefix = reinforcementPrefix(site);
  const alive = state.combat.enemies.filter((e) => e.id.startsWith(prefix)).length;
  const count = Math.min(coreShielded(f) ? 1 : 2, FORTRESS.reinforceMax - alive);
  if (count <= 0) return;
  const launch = fortressToWorld(site, { x: FORTRESS_LAYOUT.spawn.x + 4, y: 0 });
  for (let i = 0; i < count; i++) {
    const pos = fortressToWorld(site, { x: FORTRESS_LAYOUT.spawn.x + 4 + i * 3, y: (i - 0.5) * 4 * (count > 1 ? 1 : 0) });
    const serial = f.spawned++;
    const e = createEnemy({ id: `${prefix}${serial}`, kind: reinforcementKind(serial), tier: 1, pos, angle: site.angle, home: launch, orbit: i % 2 === 0 ? 1 : -1 });
    e.body = { ...e.body, vel: { x: Math.cos(site.angle) * 12, y: Math.sin(site.angle) * 12 } };
    e.prevBody = e.body;
    e.ai.mode = 'attack';
    state.combat.enemies.push(e);
  }
  out.push({ type: 'fortressReinforcements', fortress: site.id, count, pos: launch });
}
