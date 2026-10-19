// Scavenger (long-term design 6.2, M3.6): a pirate freighter without a cannon. It ignores the player,
// flies to loot (wrecks, containers – also the ones the player is towing), steals it with its tractor beam
// and runs when hit. It is loot with a full hold: when destroyed, everything stays in its wreck.
import type { RingIndex } from '../../data/economy';
import { partKey, type PartInventory } from '../../data/parts';
import { RETRIEVE_PARTS } from '../../data/contracts';
import { emptyCargo } from '../../data/resources';
import { SCAVENGER } from '../../data/pirates';
import { cruiseTo, fuelFraction, LOW_FUEL, refuelAtHome, steerTo, type AiCommand } from '../combat/ai';
import { createEnemy, DENSITY_MULT, enemyMass, inPirateFreeZone, STATION_SAFE_MARGIN, type SpawnSlot } from '../combat/enemies';
import type { Container, Enemy, Wreck, WreckLoot } from '../combat/types';
import { rngNext } from '../combat/rng';

import { lootEmpty, mergeLoot } from '../combat/wrecks';
import { poisInChunk } from '../discovery/poi';
import { TAU } from '../math/angle';
import { fnv1a32 } from '../math/fnv1a';
import { createRng } from '../math/rng';
import { hypot, length, rotate, sub, type Vec2 } from '../math/vec2';
import { clamp } from '../math/angle';
import { isHulk } from '../salvage/dismantle';
import { releaseTractor, sameRef, towable, towContainer, towWreck, type Towable } from '../salvage/tractor';
import type { EnemyDensity } from '../settings';
import type { SimEvent, SimState } from '../Simulation';
import { packedChunkKey } from '../world/chunkMemo';
import { CHUNK_SIZE } from '../world/chunks';
import { hash3 } from '../world/hash';
import { ringIndexAt } from '../world/rings';
import { stationAt } from '../world/stations';
import { chunkPirates, regionWorld, STATIC_SPAWN_CONTEXT, type SpawnContext } from '../regions';
import { isSeedWreckKey } from '../sites/graveyardKeys';

const SCAV_SALT = 0x5ca7_e9a1;
/** Patrol cruise speed (u/s). */
const SCAVENGER_CRUISE = 4;

function nearStation(seed: number, cx: number, cy: number, pos: Vec2): boolean {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const s = stationAt(seed, cx + dx, cy + dy);
      if (s && hypot(s.pos.x - pos.x, s.pos.y - pos.y) < s.clearRadius + STATION_SAFE_MARGIN) return true;
    }
  }
  return false;
}

/** The inputs of one cached `scavengerSlots` answer (beside the chunk). */
interface ScavengerEntry {
  seed: number;
  density: EnemyDensity;
  scavenger: number;
  wreckScavenger: number;
  slots: SpawnSlot[];
}

/** `scavengerSlots` answers by chunk (`packedChunkKey`) with their exact inputs – no key string per call. */
const slotCache = new Map<number, ScavengerEntry[]>();
let slotEntries = 0;

/**
 * Scavengers of a chunk (a pure function of the seed with its own random stream – pirate group slots
 * do not change): now and then alone in sectors of depth 2+ and often at a bigger POI wreck
 * (`zb:<cx,cy>`, `zb:<poi>`). Both chances follow the chunk's sector (depth × security × corridor,
 * none within 1 000 u of home or in the pirate corner – sectors §6.1).
 */
export function scavengerSlots(seed: number, cx: number, cy: number, density: EnemyDensity, ctx: SpawnContext = STATIC_SPAWN_CONTEXT): SpawnSlot[] {
  const p = chunkPirates(regionWorld(seed), cx, cy, ctx);
  const key = packedChunkKey(cx, cy);
  let entries = slotCache.get(key);
  if (entries) {
    for (const e of entries) {
      if (e.seed === seed && e.density === density && e.scavenger === p.scavenger && e.wreckScavenger === p.wreckScavenger) return e.slots;
    }
  }
  if (slotEntries > 4096) {
    slotCache.clear();
    slotEntries = 0;
    entries = undefined;
  }
  const out: SpawnSlot[] = [];
  const rng = createRng(hash3(seed ^ SCAV_SALT, cx, cy));
  const roll = rng();
  const home = { x: (cx + 0.2 + rng() * 0.6) * CHUNK_SIZE, y: (cy + 0.2 + rng() * 0.6) * CHUNK_SIZE };
  const angle = rng() * TAU;
  const tier = p.tier;
  if (roll < p.scavenger * DENSITY_MULT[density] && !inPirateFreeZone(home) && !nearStation(seed, cx, cy, home)) {
    out.push({ id: `zb:${cx},${cy}`, kind: 'scavenger', tier, pos: home, angle, home, orbit: 1 });
  }
  for (const poi of poisInChunk(seed, cx, cy)) {
    if (poi.kind !== 'wreck' || poi.size === 0 || poi.ring < 2) continue;
    const r = createRng(hash3(SCAV_SALT, fnv1a32(poi.id), 7));
    if (r() >= SCAVENGER.wreckChance * p.wreckScavenger * DENSITY_MULT[density]) continue;
    const a = r() * TAU;
    const pos = { x: poi.pos.x + Math.cos(a) * SCAVENGER.wreckOffset, y: poi.pos.y + Math.sin(a) * SCAVENGER.wreckOffset };
    if (inPirateFreeZone(pos)) continue;
    out.push({ id: `zb:${poi.id}`, kind: 'scavenger', tier, pos, angle: a + Math.PI, home: { ...poi.pos }, orbit: 1 });
  }
  if (!entries) {
    entries = [];
    slotCache.set(key, entries);
  }
  entries.push({ seed, density, scavenger: p.scavenger, wreckScavenger: p.wreckScavenger, slots: out });
  slotEntries++;
  return out;
}

/** The scavenger's own cargo (deterministic by the slot). */
export function scavengerHold(id: string, ring: RingIndex): WreckLoot {
  const rng = createRng(hash3(SCAV_SALT, fnv1a32(id), 3));
  const cargo = emptyCargo();
  const [lo, hi] = SCAVENGER.hold;
  cargo.iron = Math.round(lo + rng() * (hi - lo));
  cargo.copper = Math.round((lo + rng() * (hi - lo)) * 0.6);
  cargo.titanium = ring >= 2 ? Math.round((lo + rng() * (hi - lo)) * 0.5) : 0;
  const parts: PartInventory = {};
  if (rng() < SCAVENGER.partChance) {
    const part = RETRIEVE_PARTS[Math.floor(rng() * RETRIEVE_PARTS.length)]!;
    parts[partKey(part, ring >= 3 ? 2 : 1)] = 1;
  }
  return { cargo, parts };
}

/** A new scavenger from its slot (full hold). */
export function createScavenger(slot: SpawnSlot): Enemy {
  const e = createEnemy(slot);
  e.hold = scavengerHold(slot.id, ringIndexAt(length(slot.home)) as RingIndex);
  return e;
}

/**
 * The wreck of a Retrieve contract (`rt:`) respawns from the contract until it is loaded – a scavenger
 * stealing it would print the contract part again and again (I9). Scavengers leave it alone.
 */
const contractWreck = (w: Pick<Wreck, 'poi'>): boolean => !!w.poi?.startsWith('rt:');

/** Loot a scavenger goes for: the object the player tows first, else the nearest one in sight. */
function lootTarget(state: SimState, e: Enemy): Towable | null {
  const towed = state.player.tractor && !state.player.tractor.rip ? towable(state, state.player.tractor.target) : null;
  const ex = e.body.pos.x;
  const ey = e.body.pos.y;
  // a towed nugget (Mining 2.0) is not loot for a scavenger
  if (
    towed &&
    !towed.nugget &&
    hypot(towed.body.pos.x - ex, towed.body.pos.y - ey) <= SCAVENGER.sight &&
    !(towed.wreck && (isHulk(towed.wreck) || contractWreck(towed.wreck)))
  ) {
    return towed;
  }
  // the nearest loot in sight: the containers, then the wrecks (the first of equals wins); the towable
  // object only for the winner (perf audit 2026-10-17, P4)
  let bestContainer: Container | null = null;
  let bestWreck: Wreck | null = null;
  let bestD = Infinity;
  const { containers, wrecks } = state.combat;
  for (let i = 0; i < containers.length; i++) {
    const c = containers[i]!;
    if (lootEmpty(c.loot)) continue;
    const d = hypot(c.body.pos.x - ex, c.body.pos.y - ey);
    if (d <= SCAVENGER.sight && d < bestD) {
      bestContainer = c;
      bestD = d;
    }
  }
  for (let i = 0; i < wrecks.length; i++) {
    const w = wrecks[i]!;
    if (lootEmpty(w.loot) || isHulk(w) || contractWreck(w) || w.grid.parts.length > SCAVENGER.maxParts) continue;
    const d = hypot(w.body.pos.x - ex, w.body.pos.y - ey);
    if (d <= SCAVENGER.sight && d < bestD) {
      bestWreck = w;
      bestContainer = null;
      bestD = d;
    }
  }
  return bestWreck ? towWreck(bestWreck) : bestContainer ? towContainer(bestContainer) : null;
}

/** The scavenger steals an object's loot (the wreck or container disappears into its hold). */
function steal(state: SimState, e: Enemy, t: Towable, events: SimEvent[]): void {
  const { combat } = state;
  const hold = (e.hold ??= { cargo: emptyCargo(), parts: {} });
  const loot = t.wreck?.loot ?? t.container!.loot;
  mergeLoot(hold, loot);
  const fromPlayer = sameRef(state.player.tractor?.target, t.ref);
  if (t.container) {
    combat.containers = combat.containers.filter((c) => c !== t.container);
    if (t.container.poi) state.discovery.opened.add(t.container.poi);
  } else if (t.wreck) {
    combat.wrecks = combat.wrecks.filter((w) => w !== t.wreck);
    // a seed wreck (POI or graveyard) is looted for good
    if (isSeedWreckKey(t.wreck.poi)) state.discovery.opened.add(t.wreck.poi);
  }
  if (fromPlayer) releaseTractor(state, 'stolen', events);
  events.push({ type: 'scavengerStole', ref: e.id, pos: { ...t.body.pos }, what: t.ref.kind === 'wreck' ? 'wreck' : 'container', fromPlayer });
}

/**
 * The scavenger's decision for a step (changes `e.ai`): flee after a hit, else fly to loot and steal it
 * there, else patrol around home. It ignores the player.
 */
export function thinkScavenger(state: SimState, e: Enemy, events: SimEvent[], holder: { rng: number }): AiCommand {
  const ai = e.ai;
  ai.timer--;
  const player = state.player;
  if (ai.mode === 'flee') {
    const away = sub(e.body.pos, player.body.pos);
    const d = length(away);
    if (ai.timer <= 0 && d > SCAVENGER.fleeSafe) {
      ai.mode = 'patrol';
      ai.timer = 0;
    } else {
      const point = { x: e.body.pos.x + (away.x / Math.max(d, 1e-6)) * 50, y: e.body.pos.y + (away.y / Math.max(d, 1e-6)) * 50 };
      return { flight: steerTo(e.body, point, 1), aim: point, fire: false };
    }
  }
  // low on fuel: no more hunting for loot – home at an economical cruise, refuel there and patrol again (I14)
  if (ai.mode === 'retreat' || fuelFraction(e) < LOW_FUEL) {
    ai.mode = 'retreat';
    if (!refuelAtHome(e)) {
      if (length(sub(e.home, e.body.pos)) < 12) return { flight: { forward: 0, strafe: 0, turn: 0 }, aim: e.home, fire: false };
      return cruiseTo(e, e.home, SCAVENGER_CRUISE, 1);
    }
  }
  const t = lootTarget(state, e);
  if (t) {
    ai.mode = 'collect';
    ai.waypoint = { ...t.body.pos };
    const gap = length(sub(t.body.pos, e.body.pos)) - e.props.boundingRadius - t.radius;
    if (gap <= SCAVENGER.grab) {
      steal(state, e, t, events);
      ai.mode = 'patrol';
      ai.timer = SCAVENGER.pause;
      return { flight: { forward: 0, strafe: 0, turn: 0 }, aim: t.body.pos, fire: false };
    }
    // brakes with the reverse engines at the target so it does not ram the loot or ships
    const to = sub(t.body.pos, e.body.pos);
    const dist = Math.max(1e-6, length(to));
    const closing = (sub(e.body.vel, t.body.vel).x * to.x + sub(e.body.vel, t.body.vel).y * to.y) / dist;
    // the hold weighs (stolen loot too) – a laden scavenger brakes later
    const brake = Math.max(1, e.props.thrust.backward / enemyMass(e));
    const flight = steerTo(e.body, t.body.pos, 1);
    // the approach speed it can still stop from; the side engines correct the sideways drift
    const allowed = Math.sqrt(2 * brake * Math.max(0, gap - 1)) * 0.7 + 1.5;
    if (closing > allowed) flight.forward = -1;
    else if (closing > allowed * 0.8) flight.forward = 0;
    const rel = rotate(sub(e.body.vel, t.body.vel), -e.body.angle);
    const side = rotate(to, -e.body.angle);
    flight.strafe = clamp(-rel.y * 0.5 + side.y * 0.08, -1, 1);
    return { flight, aim: t.body.pos, fire: false };
  }
  if (ai.mode === 'collect') {
    ai.mode = 'patrol';
    ai.timer = 0;
  }
  if (ai.timer <= 0) {
    const a = rngNext(holder) * TAU;
    const r = Math.sqrt(rngNext(holder)) * SCAVENGER.patrolRadius;
    ai.waypoint = { x: e.home.x + Math.cos(a) * r, y: e.home.y + Math.sin(a) * r };
    ai.timer = 600 + Math.round(rngNext(holder) * 600);
  }
  // an economical cruise between waypoints around home (a patrol burns no fuel, I14); wait at the waypoint
  if (length(sub(ai.waypoint, e.body.pos)) < 8) return { flight: { forward: 0, strafe: 0, turn: 0 }, aim: ai.waypoint, fire: false, patrol: true };
  return { ...cruiseTo(e, ai.waypoint, SCAVENGER_CRUISE, 0.4), patrol: true };
}

/** The scavenger was hit by the player – it runs. */
export function scareScavenger(e: Enemy): void {
  if (e.kind !== 'scavenger') return;
  e.ai.mode = 'flee';
  e.ai.timer = SCAVENGER.fleeTicks;
}
