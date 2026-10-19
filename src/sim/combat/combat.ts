// Combat step (M3a): pirates spawn and leave, their AI and flight, projectiles, hits, ships breaking up,
// wrecks with loot, ship–ship and ship–wreck collisions and shield recharge. Called once per
// simulation step after the player's flight; all randomness goes through the saved combat RNG (determinism).
import { clearList } from '../scratch';
import { partDef, partKey, type PartInventory } from '../../data/parts';
import { cargoUsed, emptyCargo, RESOURCE_IDS, type Cargo } from '../../data/resources';
import { add, hypot, length, scale, sub, type Vec2 } from '../math/vec2';
import { integrate } from '../physics/body';
import { resolveCollisions, type Circle } from '../physics/collide';
import { computeFlight, type FlightOutput, type FlightProps } from '../ship/control';
import { partCenter } from '../ship/grid';
import type { PlacedPart } from '../ship/types';
import type { PartLossCause, SimEvent, SimState } from '../Simulation';
import { chunkCoord } from '../world/chunks';
import { hash3 } from '../world/hash';
import { ringIndexAt } from '../world/rings';
import { think, type AiCommand } from './ai';
import { aimSkill } from './aim';
import { flightFuel } from '../ship/fuel';
import { applyExhaustBurns, burnNotice } from '../ship/exhaust';
import { maxHp } from '../ship/hp';
import { collidePair, type Collider } from './collide';
import { damageShip, rebuildShip, regenShield, splitGrid } from './damage';
import { createEnemy, enemyMass, spawnSlots } from './enemies';
import { spawnContext } from '../pirates/sectors';
import { ramDamage, ramShare } from './ram';
import { cellOwners, gridToWorld, segmentCircle } from './geometry';
import { nextLivePart, stepProjectiles, type ShipTarget } from './projectiles';
import { rngNext, rngRange } from './rng';
import { PLAYER_REF, type CombatShip, type CombatState, type Enemy, type EnemyKind, type Livery, type Projectile, type ShipRef, type Wreck, type WreckLoot } from './types';
import { fireWeapons, tickCooldowns } from './weapons';
import { careerSpawns } from '../career/career';
import { expandBlasts } from './partBlast';
import { sectorAt, sectorEffects } from '../sector/sector';
import { CHUNK_SIZE } from '../world/chunks';
import { addPartLoot, createWreck, emptyLoot, lootEmpty, MAX_WRECKS, mergeLoot, stepWreck, type WreckSource } from './wrecks';
import { createScavenger, scareScavenger, scavengerSlots, thinkScavenger } from '../pirates/scavenger';
import { damageShell, giantAt, giantCirclesInto } from '../discovery/giants';
import { containerColliderInto, stepContainer } from '../salvage/containers';
import { fortressObstaclesInto, fortressProjectiles } from '../pirates/fortress';
import { onSiteHit, siteCollidersInto, siteHitTargetsInto, type SiteHitTarget } from '../sites';
import { canHit, NPC_PREFIX, npcCollidersInto, npcProjectiles, pirateTarget } from '../npc';
import { ATTENTION, attentionLevel } from '../../data/pirates';
import { captainIndexOf } from '../captains/captains';
import type { PartId } from '../../data/parts';

/** T2 part a named captain drops (by captain index). */
const CAPTAIN_PRIZES: readonly PartId[] = ['cannon', 'shield', 'reactor', 'engine', 'gyro'];
import { CONTAINER_RADIUS } from '../../data/salvage';

/** Pirate spawning and leaving is checked once every this many steps. */
export const SPAWN_CHECK_INTERVAL = 30;
/** A pirate appears when its slot is closer than this… */
export const SPAWN_RADIUS = 450;
/** …but not right in front of the player (outside the camera's view). */
export const SPAWN_MIN_DISTANCE = 140;
/** Farther from the player a pirate disappears (the slot spawns again later with full HP). */
export const DESPAWN_RADIUS = 750;
/** A destroyed pirate appears in the same slot again after 20 minutes of game time at the earliest. */
export const RESPAWN_TICKS = 20 * 60 * 60;
/** Chance that a destroyed pirate's part survives as loot (long-term design 4.3: 25 %). */
export const LOOT_PART_CHANCE = 0.25;
/** An impact slower than this is not reported (as with asteroids). */
const COLLISION_EVENT_SPEED = 1;
/** Query margin for collisions beyond the ship's radius. */
const COLLISION_MARGIN = 6;
const COMBAT_SALT = 0xc0b7_a700;

/** Unit vector, or `fallback` for a zero vector. */
function normalizeOr(v: Vec2, fallback: Vec2): Vec2 {
  const len = length(v);
  return len > 1e-9 ? scale(v, 1 / len) : fallback;
}

export function createCombatState(seed: number): CombatState {
  return { rng: hash3(seed ^ COMBAT_SALT, 0, 0), nextId: 1, enemies: [], defeated: new Map(), projectiles: [], wrecks: [], containers: [] };
}

/** The player is a target (flying and alive). */
export const playerTargetable = (state: SimState): boolean => state.player.dock.mode === 'flying' && !state.player.destroyed;

/** The ship of a reference (the player or an enemy), or null. */
export function shipByRef(state: SimState, ref: ShipRef): CombatShip | null {
  if (ref === PLAYER_REF) return state.player;
  return state.combat.enemies.find((e) => e.id === ref) ?? null;
}

// ---------------------------------------------------------------------------
// spawn

function manageSpawns(state: SimState): void {
  const { combat, player, tick } = state;
  const pos = player.body.pos;
  combat.enemies = combat.enemies.filter((e) => length(sub(e.body.pos, pos)) <= DESPAWN_RADIUS);
  for (const [id, at] of [...combat.defeated]) if (tick - at >= RESPAWN_TICKS) combat.defeated.delete(id);
  const alive = new Set(combat.enemies.map((e) => e.id));
  const pcx = chunkCoord(pos.x);
  const pcy = chunkCoord(pos.y);
  const reach = Math.ceil(SPAWN_RADIUS / 200);
  // more and stronger pirates with higher attention (M3.6, 6.3)
  const level = attentionLevel(state.pirates.attention);
  // the sector of each chunk decides (depth, security, corridor, the pirate corner – sectors §6.1)
  const ctx = spawnContext(state);
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dy = -reach; dy <= reach; dy++) {
      const cx = pcx + dx;
      const cy = pcy + dy;
      // the sector's state changes the chance of a group (M3.5a)
      const center = { x: (cx + 0.5) * CHUNK_SIZE, y: (cy + 0.5) * CHUNK_SIZE };
      const mult = sectorEffects(sectorAt(state.seed, center, tick)).pirateMult * ATTENTION.spawnMult[level]!;
      for (const slot of spawnSlots(state.seed, cx, cy, state.settings.enemyDensity, mult, ATTENTION.hammerBonus[level]!, ctx)) {
        if (alive.has(slot.id) || combat.defeated.has(slot.id)) continue;
        const d = length(sub(slot.pos, pos));
        if (d > SPAWN_RADIUS || d < SPAWN_MIN_DISTANCE) continue;
        combat.enemies.push(createEnemy(slot));
        alive.add(slot.id);
      }
      // scavengers (M3.6) – their own slots, at larger POI wrecks
      for (const slot of scavengerSlots(state.seed, cx, cy, state.settings.enemyDensity, ctx)) {
        if (alive.has(slot.id) || combat.defeated.has(slot.id)) continue;
        const d = length(sub(slot.pos, pos));
        if (d > SPAWN_RADIUS || d < SPAWN_MIN_DISTANCE) continue;
        combat.enemies.push(createScavenger(slot));
        alive.add(slot.id);
      }
    }
  }
  // the hunted group and the named captain of contracts (M3.5a)
  for (const spawn of careerSpawns(state)) {
    if (alive.has(spawn.id) || combat.defeated.has(spawn.id)) continue;
    const d = length(sub(spawn.pos, pos));
    if (d > SPAWN_RADIUS || d < SPAWN_MIN_DISTANCE) continue;
    combat.enemies.push(spawn.create());
    alive.add(spawn.id);
  }
}

// ---------------------------------------------------------------------------
// enemies

/** The obstacle list of one ship / wreck / container, reused (filled and consumed within one call). */
const OBSTACLES: Circle[] = [];

/**
 * Everything a pirate, a wreck or a container bounces off near `pos`, in this order: asteroids, stations,
 * giants, fortresses, site structures and comet nuclei, NPC ships and masts. Returns the reused list
 * `OBSTACLES` – valid until the next call (perf audit 2026-10-17, P4: no lists per body and step).
 */
function obstaclesNear(state: SimState, pos: Vec2, reach: number): readonly Circle[] {
  const out = OBSTACLES;
  clearList(out);
  state.world.circlesInto(pos, reach, out);
  state.world.stationCirclesInto(pos, reach, out);
  giantCirclesInto(state, pos, reach, out);
  fortressObstaclesInto(state, pos, reach, out);
  siteCollidersInto(state, pos, reach, out);
  npcCollidersInto(state, pos, reach, out);
  return out;
}

function stepEnemy(state: SimState, e: Enemy, events: SimEvent[], dt: number): void {
  const { combat } = state;
  // the player, or (M4d) a live Guild Watch ship / an escorted convoy ship – npc/targets.ts
  const target = pirateTarget(state, e);
  // a scavenger (M3.6) ignores the player – it flies for the loot
  const skill = aimSkill(state.settings.deathPenalty);
  const { cmd, alerted } = e.kind === 'scavenger' ? { cmd: thinkScavenger(state, e, events, combat), alerted: false } : think(e, target, combat, skill);
  if (alerted) events.push({ type: 'enemyAlert', ref: e.id, pos: { ...e.body.pos } });

  // the same flight as the player's: cargo weighs, fuel burns, an empty tank leaves only the gyros
  const out = enemyFlight(state, e, cmd, dt);
  e.prevBody = e.body;
  const mass = enemyMass(e);
  const moved = integrate(e.body, out.force, out.torque, mass, (e.props.inertia * mass) / e.props.mass, dt);
  const reach = e.props.boundingRadius + COLLISION_MARGIN;
  e.body = resolveCollisions(moved, e.props.cellOffsets, e.props.boundingRadius, obstaclesNear(state, moved.pos, reach)).body;
  e.lastLocalForce = out.localForce;

  tickCooldowns(e);
  if (cmd.fire) {
    for (const shot of fireWeapons(e, e.id, cmd.aim, combat)) {
      combat.projectiles.push(shot);
      events.push(shotEvent(shot.owner, shot.pos, shot.vel, e.body.vel, shot.tier));
    }
  }
  e.energy = Math.min(e.props.batteryCapacity, e.energy + e.props.energyGen * dt);
  regenShield(e, dt);
  burnExhausts(state, e.id, e, out.localForce, events, dt);
}

/**
 * A pirate's thrust for this step by the player's rules (Simulation.stepFlight): the hold's mass slows
 * acceleration and turning, the engines and the cockpit RCS burn fuel by `flightFuel` (× the sector's and the engines'
 * fuel use), the dampers need fuel too, and with empty tanks only the gyros work. Burns `e.fuel`.
 */
const ENEMY_FLIGHT: FlightProps = { thrust: { forward: 0, backward: 0, left: 0, right: 0 }, rcsThrust: 0, torque: 0, mass: 1, inertia: 1 };

export function enemyFlight(state: SimState, e: Enemy, cmd: AiCommand, dt: number): FlightOutput {
  const hasFuel = e.fuel > 0;
  const flight = hasFuel ? cmd.flight : { forward: 0, strafe: 0, turn: cmd.flight.turn };
  const mass = enemyMass(e);
  let props: FlightProps = e.props;
  if (mass !== e.props.mass) {
    // the loaded pirate's flight view – reused (computeFlight keeps nothing)
    props = ENEMY_FLIGHT;
    ENEMY_FLIGHT.thrust = e.props.thrust;
    ENEMY_FLIGHT.rcsThrust = e.props.rcsThrust;
    ENEMY_FLIGHT.torque = e.props.torque;
    ENEMY_FLIGHT.mass = mass;
    ENEMY_FLIGHT.inertia = (e.props.inertia * mass) / e.props.mass;
  }
  const out = computeFlight(props, e.body, flight, hasFuel && cmd.dampers !== false, dt);
  // a patrol around the home base burns nothing (I14 – the gang keeps it supplied)
  const needed = cmd.patrol ? 0 : flightFuel(out, e.props.fuelUseMult, dt) * sectorEffects(sectorAt(state.seed, e.body.pos, state.tick)).fuelUseMult;
  if (needed <= 0) return out;
  const ratio = needed > e.fuel ? e.fuel / needed : 1;
  e.fuel = Math.max(0, e.fuel - needed * ratio);
  return ratio < 1 ? { force: scale(out.force, ratio), localForce: scale(out.localForce, ratio), rcs: scale(out.rcs, ratio), torque: out.torque } : out;
}

/**
 * Engines blowing into a part (ship/exhaust.ts) burn it while they fire; a part burnt through is lost
 * like a shot-off one. The player hears about a burn when it starts and at every quarter of the
 * part's HP (`exhaustBurn`).
 */
export function burnExhausts(state: SimState, ref: ShipRef, ship: CombatShip, force: Vec2, events: SimEvent[], dt: number): void {
  if (ship.props.exhaustBurns.length === 0) return;
  const steps = applyExhaustBurns(ship, force, dt);
  if (steps.length === 0) return;
  const gone = new Set<number>();
  for (const step of steps) {
    const part = ship.grid.parts.find((p) => p.id === step.partId)!;
    if (ref === PLAYER_REF && burnNotice(step, maxHp(part))) {
      events.push({ type: 'exhaustBurn', engineId: step.engineId, partId: step.partId, key: partKey(part.partId, part.tier, part.variant), hp: step.after / maxHp(part) });
    }
    if (step.after <= 0) gone.add(step.partId);
  }
  if (gone.size > 0) resolveDestroyed(state, ref, ship, gone, events, 'exhaust');
}

export function shotEvent(owner: ShipRef, pos: Vec2, vel: Vec2, shipVel: Vec2, tier: 1 | 2): SimEvent {
  return { type: 'shotFired', owner, pos: { ...pos }, dir: normalizeOr(sub(vel, shipVel), { x: 1, y: 0 }), tier };
}

// ---------------------------------------------------------------------------
// ships breaking up and wrecks

function pieceMotion(state: SimState, ship: WreckSource, piece: readonly PlacedPart[]): { vel: Vec2; angVel: number } {
  const holder = state.combat;
  let cx = 0;
  let cy = 0;
  for (const p of piece) {
    const c = partCenter(p);
    cx += c.x;
    cy += c.y;
  }
  const local = { x: cx / piece.length, y: cy / piece.length };
  const world = gridToWorld(ship.body, ship.props.centerOfMass, local);
  const out = normalizeOr(sub(world, ship.body.pos), { x: rngRange(holder, -1, 1), y: rngRange(holder, -1, 1) });
  const speed = rngRange(holder, 1.5, 4);
  return {
    vel: add(ship.body.vel, add(scale(out, speed), { x: rngRange(holder, -0.8, 0.8), y: rngRange(holder, -0.8, 0.8) })),
    angVel: ship.body.angVel + rngRange(holder, -1.5, 1.5),
  };
}

function addWreck(state: SimState, w: Wreck): void {
  const { combat } = state;
  // a player wreck remembers its ship (part ids repeat across the fleet – death.ts reclaim)
  if (w.livery === 'default') w.ship = state.fleet.active.id;
  combat.wrecks.push(w);
  if (combat.wrecks.length > MAX_WRECKS) combat.wrecks.splice(0, combat.wrecks.length - MAX_WRECKS);
}

/** Cargo loot multiplier of a pirate kind: the Hammer and the Gunner (M4b, a big ship like the Hammer) carry twice as much. */
export const kindLootMult = (kind: EnemyKind): number => (kind === 'hammer' || kind === 'gunner' ? 2 : 1);

/**
 * Loot of a destroyed pirate: random parts (25 %; damaged ones as scrap) and resources by ring and kind.
 * A pirate destroyed by the Guild Watch (M4d, `cargo` false) leaves no cargo – the rolls are drawn anyway,
 * so the combat RNG stream does not depend on who fired the last shot.
 */
function pirateLoot(state: SimState, e: Enemy, pieces: readonly PlacedPart[][], cargo = true): WreckLoot {
  const holder = state.combat;
  const loot = emptyLoot();
  for (const p of pieces.flat().sort((a, b) => a.id - b.id)) {
    if (rngNext(holder) < LOOT_PART_CHANCE) addPartLoot(loot, p, e.hp, 'other');
  }
  const ring = ringIndexAt(length(e.body.pos));
  // better loot with higher attention (M3.6, 6.3)
  const mult = kindLootMult(e.kind) * ATTENTION.lootMult[attentionLevel(state.pirates.attention)]!;
  loot.cargo.iron = Math.round(rngRange(holder, 4, 12) * mult);
  loot.cargo.copper = Math.round(rngRange(holder, 0, 8) * mult);
  loot.cargo.titanium = ring >= 2 ? Math.round(rngRange(holder, 0, 5) * mult) : 0;
  if (!cargo) loot.cargo = emptyCargo();
  // a named captain carries a unique T2 part (6.3: "captain = unique parts")
  const captain = captainIndexOf(e.id);
  if (captain !== null) {
    const key = partKey(CAPTAIN_PRIZES[captain % CAPTAIN_PRIZES.length]!, 2);
    loot.parts[key] = (loot.parts[key] ?? 0) + 1;
  }
  return loot;
}

const pieceMass = (piece: readonly PlacedPart[]): number => piece.length;

/**
 * Removes the destroyed parts of ship `ref`, turns the detached pieces into wrecks and destroys the
 * ship when it loses its cockpit. Returns true when the ship is gone.
 */
function resolveDestroyed(
  state: SimState,
  ref: ShipRef,
  ship: CombatShip,
  destroyed: ReadonlySet<number>,
  events: SimEvent[],
  cause: PartLossCause,
  /** What the player leaves in the wreck of an abandoned ship (the cargo of a scuttle). */
  left?: WreckLoot,
  /** Owner of the destroying shot (M4d `shipDestroyed.by`; unset for rams, exhausts, blasts, scuttles). */
  by?: ShipRef,
): boolean {
  const { combat } = state;
  const isPlayer = ref === PLAYER_REF;
  const livery: Livery = isPlayer ? 'default' : 'pirate';
  // explosive parts (M4c large reactor) take their 8-neighbours with them (partBlast.ts)
  const gone = expandBlasts(state, ref, ship, destroyed, events);
  const split = splitGrid(ship.grid, gone);
  for (const p of split.removed) {
    events.push({
      type: 'partDestroyed',
      ref,
      partId: p.id,
      key: partKey(p.partId, p.tier, p.variant),
      pos: gridToWorld(ship.body, ship.props.centerOfMass, partCenter(p)),
    });
  }

  if (split.cockpitLost) {
    const enemy = isPlayer ? null : (ship as Enemy);
    // a pirate destroyed by a Guild Watch shot (M4d): no cargo loot, not the player's kill
    const watchKill = by !== undefined && by.startsWith(NPC_PREFIX.watch);
    const loot = enemy ? pirateLoot(state, enemy, split.detached, !watchKill) : (left ?? emptyLoot());
    // a scavenger's hold (its own and stolen) stays in the wreck (M3.6)
    if (enemy?.hold) mergeLoot(loot, enemy.hold);
    // the loot goes to the largest piece
    let largest = -1;
    split.detached.forEach((piece, i) => {
      if (largest < 0 || pieceMass(piece) > pieceMass(split.detached[largest]!)) largest = i;
    });
    split.detached.forEach((piece, i) => {
      const motion = pieceMotion(state, ship, piece);
      const w = createWreck(combat.nextId++, piece, ship, motion, i === largest ? loot : emptyLoot(), livery);
      // a pirate's wreck with loot may carry a plan fragment (M3.5b, 3.2.3)
      if (enemy && i === largest) w.cls = 'pirate';
      addWreck(state, w);
    });
    // everything destroyed at once – the pirate's loot stays in the debris of the cockpit (M20)
    const cockpit = split.removed.find((p) => p.partId === 'cockpit');
    if (largest < 0 && cockpit && !lootEmpty(loot)) {
      const w = createWreck(combat.nextId++, [cockpit], ship, pieceMotion(state, ship, [cockpit]), loot, livery);
      if (enemy) w.cls = 'pirate';
      addWreck(state, w);
    }
    const pos = { ...ship.body.pos };
    const vel = { ...ship.body.vel };
    if (enemy) {
      combat.enemies = combat.enemies.filter((e) => e !== enemy);
      combat.defeated.set(enemy.id, state.tick);
      if (!watchKill) state.stats.kills++;
      events.push({ type: 'shipDestroyed', ref, kind: enemy.kind, pos, vel, radius: ship.props.boundingRadius, ...(by !== undefined ? { by } : {}) });
    } else {
      const player = state.player;
      player.destroyed = true;
      player.body = { ...player.body, vel: { x: 0, y: 0 }, angVel: 0 };
      player.prevBody = player.body;
      player.beams = [];
      player.lastLocalForce = { x: 0, y: 0 };
      // destroyed parts have no valid HP (a save during the death screen)
      for (const [id, hp] of [...player.hp]) if (hp <= 0) player.hp.delete(id);
      events.push({ type: 'playerDestroyed', pos, vel, radius: ship.props.boundingRadius });
    }
    return true;
  }

  if (isPlayer) {
    // one notice for everything this blow took off (the HUD toasts it, the sound plays once)
    const lost = (p: PlacedPart, detached: boolean) => ({ partId: p.id, key: partKey(p.partId, p.tier, p.variant), detached });
    // a blast that took more parts than the blow itself is what the player hears about
    events.push({ type: 'partsLost', cause: gone.size > destroyed.size ? 'blast' : cause, parts: [...split.removed.map((p) => lost(p, false)), ...split.detached.flat().map((p) => lost(p, true))] });
  }

  const wrecks: Wreck[] = [];
  for (const piece of split.detached) {
    const loot = emptyLoot();
    for (const p of piece) {
      // own detached parts can be loaded back (damaged ones as scrap, I7), pirate ones with a 25 % chance
      if (isPlayer || rngNext(combat) < LOOT_PART_CHANCE) addPartLoot(loot, p, ship.hp, isPlayer ? 'player' : 'other');
    }
    wrecks.push(createWreck(combat.nextId++, piece, ship, pieceMotion(state, ship, piece), loot, livery));
  }
  // the original position and centre of mass – for the wreck of a spilled cargo after the rebuild
  const before: WreckSource = { body: ship.body, props: { centerOfMass: ship.props.centerOfMass } };
  rebuildShip(ship, split.remaining!);
  if (isPlayer) {
    // a destroyed large cargo hold spills half the cargo (spec 3.3); several such parts multiply
    const keep = split.removed.reduce((k, p) => k * (1 - (partDef(p.partId, p.tier, p.variant).cargoSpill ?? 0)), 1);
    // without a detached piece the wreck carries only the loot, where the destroyed cargo hold was (I3)
    const hold = split.removed.find((p) => (partDef(p.partId, p.tier, p.variant).cargo ?? 0) > 0) ?? split.removed[0];
    const spillWreck = (): Wreck | null => {
      if (wrecks[0]) return wrecks[0];
      if (!hold) return null;
      const w = createWreck(combat.nextId++, [hold], before, pieceMotion(state, before, [hold]), emptyLoot(), livery);
      wrecks.push(w);
      return w;
    };
    spillPlayerCargo(state, spillWreck, events, keep);
  }
  for (const w of wrecks) addWreck(state, w);
  return false;
}

/**
 * The player lost cargo or tanks – first the `keepShare` share is spilled (a destroyed large cargo hold
 * keeps 50 %), then the surplus over the new capacity; all of it into a wreck (made by `wreckFor`, only when
 * something really spills). The fuel is cut down.
 */
function spillPlayerCargo(state: SimState, wreckFor: () => Wreck | null, events: SimEvent[], keepShare = 1): void {
  const player = state.player;
  player.fuel = Math.min(player.fuel, player.props.fuelCapacity);
  const used = cargoUsed(player.cargo);
  const cap = player.props.cargoCapacity;
  const kept = used * keepShare;
  if (kept >= used - 1e-9 && used <= cap + 1e-9) return;
  const keep = Math.min(kept, cap) / used;
  const wreck = wreckFor();
  const lost: Partial<Cargo> = {};
  for (const r of RESOURCE_IDS) {
    const spill = player.cargo[r] * (1 - keep);
    if (spill <= 0) continue;
    player.cargo[r] -= spill;
    lost[r] = spill;
    if (wreck) wreck.loot.cargo[r] += spill;
  }
  events.push({ type: 'cargoSpilled', cargo: lost, toWreck: wreck?.id ?? null });
}

// ---------------------------------------------------------------------------
// hits

/** Station and giant circles near a projectile's path (reused, see `applyHits`). */
const PROJECTILE_BLOCKERS: Circle[] = [];

/**
 * The world of the projectiles (`stepProjectiles`): the asteroids, and the stations with the giant
 * asteroids (M3.5b) – they stop shots like stations. One object; `state` is set per step.
 */
const PROJECTILE_WORLD = {
  state: null as SimState | null,
  circlesNear(pos: Vec2, radius: number) {
    return this.state!.world.circlesNear(pos, radius);
  },
  // a reused list: `stepProjectiles` reads it right away, once per projectile
  stationCirclesNear(pos: Vec2, radius: number): Circle[] {
    const state = this.state!;
    const out = clearList(PROJECTILE_BLOCKERS);
    state.world.stationCirclesInto(pos, radius, out);
    return giantCirclesInto(state, pos, radius, out);
  },
};

function applyHits(state: SimState, ships: readonly ShipTarget[], events: SimEvent[], dt: number): void {
  const { combat } = state;
  // giant asteroids (M3.5b) stop shots like stations – a hit damages the shell
  PROJECTILE_WORLD.state = state;
  // the side rules (M4d, npc/sides.ts): who may hit whom – no friendly fire on the Guild and convoys
  const { alive, hits } = stepProjectiles(combat.projectiles, ships, combat.wrecks, PROJECTILE_WORLD, dt, canHit);
  PROJECTILE_WORLD.state = null;
  combat.projectiles = alive;
  if (hits.length === 0) return;
  const destroyed = new Map<ShipRef, Set<number>>();
  // owner of the shot that destroyed a ship's part (the cockpit's wins) → `shipDestroyed.by` (M4d)
  const killers = new Map<ShipRef, { owner: ShipRef; cockpit: boolean }>();
  for (const hit of hits) {
    const p = hit.projectile;
    if (hit.kind !== 'ship') {
      let target: 'wreck' | 'asteroid' | 'station' = hit.kind;
      if (hit.kind === 'station') {
        const giant = giantAt(state, hit.pos, 1.2);
        if (giant) {
          target = 'asteroid';
          damageShell(state, giant, p.damage, events);
        }
      }
      events.push({ type: 'projectileHit', target, owner: p.owner, pos: hit.pos, damage: p.damage, from: p.origin, ref: null });
      continue;
    }
    const target = ships.find((s) => s.ref === hit.ref)!;
    // a scavenger that is hit runs away (M3.6)
    if (p.owner === PLAYER_REF && hit.ref !== PLAYER_REF) scareScavenger(target.ship as Enemy);
    // a part destroyed by an earlier hit in the same step – the shot goes on to the next cell (M19)
    let partId = hit.partId;
    if (partId !== null && destroyed.get(hit.ref)?.has(partId)) partId = nextLivePart(target.ship, hit.pos, p.vel);
    const r = damageShip(target.ship, partId, p.damage);
    events.push({
      type: 'projectileHit',
      target: hit.shielded && r.absorbed > 0 ? 'shield' : 'ship',
      owner: p.owner,
      pos: hit.pos,
      damage: p.damage,
      from: p.origin,
      ref: hit.ref,
    });
    if (r.destroyed && partId !== null) {
      let set = destroyed.get(hit.ref);
      if (!set) destroyed.set(hit.ref, (set = new Set()));
      set.add(partId);
      const cockpit = target.ship.grid.parts.find((x) => x.id === partId)?.partId === 'cockpit';
      if (!killers.get(hit.ref)?.cockpit) killers.set(hit.ref, { owner: p.owner, cockpit });
    }
  }
  // the order of ships is the list of targets (the player, then the enemies) – deterministic
  for (const { ref, ship } of ships) {
    const set = destroyed.get(ref);
    if (set) resolveDestroyed(state, ref, ship, set, events, 'shot', undefined, killers.get(ref)?.owner);
  }
}

// ---------------------------------------------------------------------------
// collisions

/** Two reused colliders for the pair loop of `collideAll` (`collidePair` keeps neither). */
const COLLIDER_A: Collider = { body: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 }, cellOffsets: [], boundingRadius: 0, mass: 1 };
const COLLIDER_B: Collider = { body: COLLIDER_A.body, cellOffsets: [], boundingRadius: 0, mass: 1 };

/** A ship / wreck as a collider, written into `out` (no object per pair). */
function collider(out: Collider, s: { body: CombatShip['body']; props: CombatShip['props'] }): Collider {
  out.body = s.body;
  out.cellOffsets = s.props.cellOffsets;
  out.boundingRadius = s.props.boundingRadius;
  out.mass = s.props.mass;
  return out;
}

/** Impact damage to a ship's cell (grid coordinates) – applied after all collisions are resolved. */
interface RamHit {
  ref: ShipRef;
  ship: CombatShip;
  cell: Vec2;
  damage: number;
}

/**
 * Impact damage (M21): the shield first, then part `partId`; a destroyed part is removed at once
 * (breaking up, wrecks, death at the cockpit as with a hit).
 */
export function applyRam(
  state: SimState,
  ref: ShipRef,
  ship: CombatShip,
  partId: number | null,
  damage: number,
  events: SimEvent[],
  cause: PartLossCause = 'impact',
): void {
  if (damage <= 0 || partId === null) return;
  const r = damageShip(ship, partId, damage);
  if (r.destroyed) resolveDestroyed(state, ref, ship, new Set([partId]), events, cause);
}

/** The ships of `collideAll` (reused: the player, then the enemies). */
const COLLIDING: CombatShip[] = [];

/** A ram hit for the list (created on the first one). */
function ramHit(rams: RamHit[] | null, player: CombatShip, ship: CombatShip, cell: Vec2, damage: number): RamHit[] | null {
  if (!(damage > 0)) return rams;
  (rams ??= []).push({ ref: ship === player ? PLAYER_REF : (ship as Enemy).id, ship, cell: add(cell, ship.props.centerOfMass), damage });
  return rams;
}

function collideAll(state: SimState, events: SimEvent[]): void {
  const { combat, player } = state;
  const ships = clearList(COLLIDING);
  if (playerTargetable(state)) ships.push(player);
  for (let i = 0; i < combat.enemies.length; i++) ships.push(combat.enemies[i]!);
  let rams: RamHit[] | null = null;
  let playerImpact = 0;
  let playerDamage = 0;
  for (let i = 0; i < ships.length; i++) {
    for (let j = i + 1; j < ships.length; j++) {
      const a = ships[i]!;
      const b = ships[j]!;
      const r = collidePair(collider(COLLIDER_A, a), collider(COLLIDER_B, b));
      if (!r) continue;
      a.body = r.a;
      b.body = r.b;
      const base = ramDamage(r.impactSpeed);
      rams = ramHit(rams, player, a, r.cellA, base * ramShare(a.props.mass, b.props.mass));
      rams = ramHit(rams, player, b, r.cellB, base * ramShare(b.props.mass, a.props.mass));
      if (a === player) {
        playerImpact = Math.max(playerImpact, r.impactSpeed);
        playerDamage += base * ramShare(a.props.mass, b.props.mass);
      }
    }
    for (let k = 0; k < combat.wrecks.length; k++) {
      const w = combat.wrecks[k]!;
      const a = ships[i]!;
      const r = collidePair(collider(COLLIDER_A, a), collider(COLLIDER_B, w));
      if (!r) continue;
      a.body = r.a;
      w.body = r.b;
      if (a === player) playerImpact = Math.max(playerImpact, r.impactSpeed);
    }
    // containers (M3.6) bounce like wrecks
    for (let k = 0; k < combat.containers.length; k++) {
      const c = combat.containers[k]!;
      const a = ships[i]!;
      const r = collidePair(collider(COLLIDER_A, a), containerColliderInto(COLLIDER_B, c));
      if (!r) continue;
      a.body = r.a;
      c.body = r.b;
    }
  }
  if (playerImpact > COLLISION_EVENT_SPEED) {
    events.push(playerDamage > 0 ? { type: 'collision', speed: playerImpact, damage: playerDamage } : { type: 'collision', speed: playerImpact });
  }
  clearList(ships);
  if (!rams) return;
  // order: the player, then the enemies (deterministic); a ship already gone gets nothing
  for (const hit of rams) {
    if (hit.ship === player ? player.destroyed : !combat.enemies.includes(hit.ship as Enemy)) continue;
    const partId = cellOwners(hit.ship.grid).get(`${Math.round(hit.cell.x)},${Math.round(hit.cell.y)}`) ?? null;
    applyRam(state, hit.ref, hit.ship, partId, hit.damage, events);
  }
}

// ---------------------------------------------------------------------------
// step

/** This step's projectile targets (reused; `applyHits` and `stepProjectiles` keep nothing). */
const SHIPS: ShipTarget[] = [];
/** The target object of each ship (`{ ref, ship }` – constant per ship object). */
const targetOf = new WeakMap<CombatShip, ShipTarget>();

function shipTarget(ref: ShipRef, ship: CombatShip): ShipTarget {
  let t = targetOf.get(ship);
  if (!t || t.ref !== ref) {
    t = { ref, ship };
    targetOf.set(ship, t);
  }
  return t;
}

export function stepCombat(state: SimState, events: SimEvent[], dt: number): void {
  const { combat, player } = state;
  if (state.tick % SPAWN_CHECK_INTERVAL === 0) manageSpawns(state);

  // a copy: a step may remove enemies (manageSpawns ran above; nothing else changes the list here)
  for (const e of [...combat.enemies]) stepEnemy(state, e, events, dt);
  tickCooldowns(player);

  // the targets: the player, then the enemies (their target objects are kept per ship – read-only)
  const ships = clearList(SHIPS);
  if (playerTargetable(state)) ships.push(shipTarget(PLAYER_REF, player));
  for (const e of combat.enemies) ships.push(shipTarget(e.id, e));
  // player shots at fortresses (M3.6) leave before the ship hits
  fortressProjectiles(state, events, dt);
  // shots at M4b world sites (live mines, derelict / relay structures, comet nuclei) too
  siteProjectiles(state, events, dt);
  // and (M4d) shots at live Guild Watch ships, convoy ships and the Guild relay masts (npc/hits.ts)
  npcProjectiles(state, events, dt);
  applyHits(state, ships, events, dt);
  collideAll(state, events);

  for (const w of combat.wrecks) {
    const reach = w.props.boundingRadius + COLLISION_MARGIN;
    stepWreck(w, obstaclesNear(state, w.body.pos, reach), dt);
  }
  // a new list only when a wreck is gone (the same contents either way)
  if (combat.wrecks.some((w) => w.ttl <= 0)) combat.wrecks = combat.wrecks.filter((w) => w.ttl > 0);
  for (const c of combat.containers) {
    const reach = CONTAINER_RADIUS + COLLISION_MARGIN;
    stepContainer(c, obstaclesNear(state, c.body.pos, reach), dt);
  }
  if (combat.containers.some((c) => c.ttl <= 0)) combat.containers = combat.containers.filter((c) => c.ttl > 0);

  if (playerTargetable(state)) regenShield(player, dt);
}

/**
 * Projectiles that reach an M4b world-site target this step (`siteHitTargets`: a live mine, a derelict or
 * relay structure, a comet nucleus) stop at the nearest one along their path; the site reacts in
 * `onSiteHit` (a mine blows, a structure takes a spent shot – sim/sites). Like `fortressProjectiles`.
 */
function siteProjectiles(state: SimState, events: SimEvent[], dt: number): void {
  const { combat } = state;
  // no shot in flight: nothing to stop (the targets are not even listed – perf audit 2026-10-17, P4)
  if (combat.projectiles.length === 0) return;
  // a reused list (read in this loop only; onSiteHit lists nothing)
  const targets = siteHitTargetsInto(state, clearList(SITE_TARGETS));
  if (targets.length === 0) return;
  const projectiles = combat.projectiles;
  // the flying ones, copied only once the first one stops (no stop: the list stays as it is)
  let keep: Projectile[] | null = null;
  const to = SEGMENT_END;
  for (let i = 0; i < projectiles.length; i++) {
    const p = projectiles[i]!;
    to.x = p.pos.x + p.vel.x * dt;
    to.y = p.pos.y + p.vel.y * dt;
    let bestT = 0;
    let best: SiteHitTarget | null = null;
    for (const target of targets) {
      const t = hypot(p.pos.x - target.pos.x, p.pos.y - target.pos.y) <= target.radius ? 0 : segmentCircle(p.pos, to, target.pos, target.radius);
      if (t !== null && (!best || t < bestT)) {
        bestT = t;
        best = target;
      }
    }
    if (!best) {
      keep?.push(p);
      continue;
    }
    keep ??= projectiles.slice(0, i);
    const pos = { x: p.pos.x + (to.x - p.pos.x) * bestT, y: p.pos.y + (to.y - p.pos.y) * bestT };
    onSiteHit(state, best, { owner: p.owner, pos, damage: p.damage, from: p.origin }, events);
  }
  if (keep) combat.projectiles = keep;
}

/** The site targets of `siteProjectiles` (reused). */
const SITE_TARGETS: SiteHitTarget[] = [];

/** The end of a projectile's segment this step (`siteProjectiles` scratch; segmentCircle keeps nothing). */
const SEGMENT_END: Vec2 = { x: 0, y: 0 };

/**
 * Abandoning the ship (C2): the cockpit is destroyed as by a hit – the rest of the ship breaks up into wrecks
 * and the game layer starts the death sequence (playerDestroyed). The caller checks that the ship flies.
 */
export function scuttlePlayer(state: SimState, events: SimEvent[]): void {
  const player = state.player;
  const cockpit = player.grid.parts.find((p) => p.partId === 'cockpit');
  if (!cockpit || player.destroyed) return;
  events.push({ type: 'shipScuttled', pos: { ...player.body.pos } });
  // a voluntary death: applyDeath charges the tow fee and repairs / refuels nothing (death/death.ts);
  // the cargo stays in the abandoned wreck – a scuttle is never a free ride home with a full hold
  player.scuttled = true;
  const left = emptyLoot();
  for (const r of RESOURCE_IDS) left.cargo[r] = player.cargo[r];
  player.cargo = emptyCargo();
  player.hp.set(cockpit.id, 0);
  resolveDestroyed(state, PLAYER_REF, player, new Set([cockpit.id]), events, 'hazard', left);
}

/** Parts on board go to the station's storage when docking. */
export function mergeInventory(into: PartInventory, add: PartInventory): void {
  for (const [key, n] of Object.entries(add) as [keyof PartInventory, number][]) {
    if (n > 0) into[key] = (into[key] ?? 0) + n;
  }
}
