// Pirate step (design 6.3, M3.6): attention grows only from activity (cargo value carried through
// dangerous sectors, exploration, kills, the first contact with a Pirate sector) and decays with time.
// "Dangerous" is a Contested or Pirate sector (or the awake depth-1 corner) – sectors design §6.1;
// Quiet and Guarded sectors count as "outside". Levels bring more and stronger pirates,
// better loot, a hunting party with a named captain at 60 and an announced raid at 90 – the peak is
// content with the best loot of the ring (war chest), never a punishment. A Hammer-led group may hail
// the player and demand a toll; a clan beacon (F) calls a raid on demand (clan challenge).
import { MIN_REFERENCE_INCOME } from '../../data/contracts';
import type { RingIndex } from '../../data/economy';
import { RESOURCE_BASE_PRICE } from '../../data/economy';
import { partKey, type PartId } from '../../data/parts';
import { ATTENTION, attentionLevel, GUNNER, HUNT, RAID, TOLL } from '../../data/pirates';
import { emptyCargo, RESOURCE_IDS } from '../../data/resources';
import { captainDefs, captainEnemyId, captainLevel, createCaptainEnemy } from '../captains/captains';
import { createEnemy } from '../combat/enemies';
import { regionWorld, sectorInfoAt, sectorSecurity, type RegionSeed, type SpawnContext } from '../regions';
import type { Enemy, WreckLoot } from '../combat/types';
import type { PlayerCommand } from '../commands';
import { TAU } from '../math/angle';
import { fnv1a32 } from '../math/fnv1a';
import { createRng } from '../math/rng';
import { length, scale, sub, type Vec2 } from '../math/vec2';
import { createContainer } from '../salvage/containers';
import { sectorAt, sectorEffects } from '../sector/sector';
import type { SimEvent, SimState } from '../Simulation';
import { chunkCoord, chunkKey } from '../world/chunks';
import { hash3 } from '../world/hash';
import { ringIndexAt } from '../world/rings';
import { stationById, type StationDef } from '../world/stations';
import { fortressSites } from './sites';
import { dangerousSector, securityHere, spawnContext } from './sectors';
import type { Raid, RaidKind } from './state';
import { stepFortresses } from './fortress';

const TOLL_SALT = 0x7011_c0de;
const RAID_SALT = 0x4a1d_0005;
const TICKS_PER_SECOND = 60;

/** Enemy density and sector multiplier of all attention gains. */
function gainMult(state: SimState): number {
  const sector = sectorEffects(sectorAt(state.seed, state.player.body.pos, state.tick));
  return ATTENTION.densityMult[state.settings.enemyDensity] * sector.attentionMult;
}

/** Highest attention allowed (low density: no raids). */
const attentionCap = (state: SimState): number => (state.settings.enemyDensity === 'low' ? ATTENTION.levels[2] - 1 : ATTENTION.max);

/** Change attention and report a level change. */
export function addAttention(state: SimState, delta: number, events: SimEvent[]): void {
  const p = state.pirates;
  const before = attentionLevel(p.attention);
  p.attention = Math.max(0, Math.min(attentionCap(state), p.attention + delta));
  const after = attentionLevel(p.attention);
  if (after !== before) events.push({ type: 'attentionLevel', level: after, attention: p.attention });
}

/** Value of the cargo at base prices (attention from carried wealth). */
export function cargoValue(state: SimState): number {
  let v = 0;
  for (const r of RESOURCE_IDS) v += state.player.cargo[r] * RESOURCE_BASE_PRICE[r];
  return v;
}

/** Current attention level of the player (spawns, loot). */
export const pirateLevel = (state: SimState): 0 | 1 | 2 | 3 => attentionLevel(state.pirates.attention);

/** The ship is flying in a dangerous sector (was "in the outer belts", ring ≥ 2). */
const inDangerousSector = (state: SimState, ctx: SpawnContext): boolean => dangerousSector(state, state.player.body.pos, ctx);

/**
 * Pirate sectors whose first chunk the latest world update explored (+2 attention each, §3.1). Derived
 * from `explored` only: a sector counts when none of its chunks was explored before this step, so
 * flying along its border again never adds more. The depth-1 corner counts only once awake.
 */
function firstPirateContacts(state: SimState, ctx: SpawnContext): number {
  const fresh = state.world.newlyExplored;
  if (fresh.length === 0) return 0;
  const world = regionWorld(state.seed);
  const freshSet = new Set(fresh);
  const seen = new Set<string>();
  let contacts = 0;
  for (const key of fresh) {
    const [cx, cy] = key.split(',').map(Number) as [number, number];
    const seed = world.field.regionOfChunk(cx, cy);
    if (seen.has(seed.id)) continue;
    seen.add(seed.id);
    if (sectorSecurity(state.seed, seed.id, ctx) !== 'pirate') continue;
    if (seed.id === world.corners.depth1 && (ctx.training || ctx.epoch === 0)) continue;
    if (!exploredBefore(state, seed, freshSet)) contacts++;
  }
  return contacts;
}

/** Some chunk of the sector was explored before this step (not among `fresh`) – scans the sector's box. */
function exploredBefore(state: SimState, seed: RegionSeed, fresh: ReadonlySet<string>): boolean {
  const world = regionWorld(state.seed);
  const explored = state.world.explored;
  // a sector's cell stays within ~1.5 spacings of its seed (power diagram + warp ≤ 110 u)
  const reach = Math.ceil((1.5 * seed.spacing + 200) / 200);
  const ccx = chunkCoord(seed.x);
  const ccy = chunkCoord(seed.y);
  for (let cx = ccx - reach; cx <= ccx + reach; cx++) {
    for (let cy = ccy - reach; cy <= ccy + reach; cy++) {
      const key = `${cx},${cy}`;
      if (fresh.has(key) || !explored.has(key)) continue;
      if (world.field.regionOfChunk(cx, cy).id === seed.id) return true;
    }
  }
  return false;
}

function stepAttention(state: SimState, events: readonly SimEvent[], out: SimEvent[]): void {
  const p = state.pirates;
  const player = state.player;
  const flying = player.dock.mode === 'flying' && !player.destroyed;
  const ctx = spawnContext(state);
  const outer = flying && inDangerousSector(state, ctx);
  let gain = 0;
  for (const e of events) if (e.type === 'shipDestroyed') gain += ATTENTION.kill;
  // the same "cx,cy" string as before, memoised per chunk (chunkKey)
  const chunk = flying ? chunkKey(chunkCoord(player.body.pos.x), chunkCoord(player.body.pos.y)) : null;
  if (outer && chunk !== null && p.chunk !== null && chunk !== p.chunk) gain += cargoValue(state) / ATTENTION.cargoPerPoint + ATTENTION.newChunk;
  if (flying) gain += firstPirateContacts(state, ctx) * ATTENTION.pirateSectorFirst;
  // consumed: a later step without a world update must not count the same chunks again
  state.world.newlyExplored = [];
  p.chunk = chunk;
  if (gain > 0) addAttention(state, gain * gainMult(state), out);
  // decay: −1 per 3 min outside dangerous sectors, −1 per 9 min inside
  const decay = 1 / (outer ? ATTENTION.decayInsideTicks : ATTENTION.decayOutsideTicks);
  if (p.attention > 0 && !p.raid) addAttention(state, -decay, out);
}

// ---------------------------------------------------------------------------
// toll

/**
 * Id prefixes of the groups that may hail the player for a toll: regular groups (`pr:<cx>,<cy>`) and
 * the director's ambush parties (`ab:<sector>@<bucket>`, M4b). Hunting parties, raids, fortress
 * reinforcements, graveyard sleepers and derelict sentries never toll.
 */
const TOLL_GROUPS = /^((?:pr:-?\d+,-?\d+)|(?:ab:.+@-?\d+)):\d+$/;

/** The toll group of a pirate (its id without the member index), or null when its kind of group never tolls. */
export const groupOf = (id: string): string | null => {
  const m = TOLL_GROUPS.exec(id);
  return m ? m[1]! : null;
};

const groupEnemies = (state: SimState, group: string): Enemy[] => state.combat.enemies.filter((e) => groupOf(e.id) === group);

/** Toll amount for the current cargo and the depth of the sector the ship is in (rounded to 50). */
export function tollAmount(state: SimState): number {
  const { x, y } = state.player.body.pos;
  const depth = sectorInfoAt(state.seed, x, y).depth;
  const raw = TOLL.base + TOLL.perDepth * depth + TOLL.cargoShare * cargoValue(state);
  return Math.max(50, Math.round(raw / 50) * 50);
}

function startToll(state: SimState, events: readonly SimEvent[], out: SimEvent[]): void {
  const p = state.pirates;
  if (p.toll) return;
  if (!events.some((e) => e.type === 'enemyAlert')) return;
  const ctx = spawnContext(state);
  if (!inDangerousSector(state, ctx)) return;
  const { x, y } = state.player.body.pos;
  const chance = TOLL.chance[sectorSecurity(state.seed, sectorInfoAt(state.seed, x, y).id, ctx)];
  for (const e of events) {
    if (e.type !== 'enemyAlert') continue;
    const group = groupOf(e.ref);
    if (!group || (p.tolled.get(group) ?? -1) > state.tick) continue;
    const members = groupEnemies(state, group);
    if (!members.some((m) => m.kind === 'hammer')) continue;
    const period = Math.floor(state.tick / (TOLL.calmSeconds * TICKS_PER_SECOND));
    const roll = createRng(hash3(state.seed ^ TOLL_SALT, fnv1a32(group), period))();
    if (roll >= chance) {
      p.tolled.set(group, state.tick + TOLL.calmSeconds * TICKS_PER_SECOND);
      continue;
    }
    const amount = tollAmount(state);
    p.toll = { group, amount, until: state.tick + TOLL.seconds * TICKS_PER_SECOND };
    for (const m of members) m.ai.mode = 'hail';
    out.push({ type: 'tollDemanded', group, amount, until: p.toll.until, pos: { ...e.pos } });
    return;
  }
}

function endToll(state: SimState, mode: 'attack' | 'patrol'): string | null {
  const p = state.pirates;
  const toll = p.toll;
  if (!toll) return null;
  p.toll = null;
  p.tolled.set(toll.group, state.tick + TOLL.calmSeconds * TICKS_PER_SECOND);
  for (const m of groupEnemies(state, toll.group)) m.ai.mode = mode;
  return toll.group;
}

/** Y / X answer to a toll demand. */
export function answerToll(state: SimState, answer: 'pay' | 'refuse', events: SimEvent[]): void {
  const p = state.pirates;
  const toll = p.toll;
  if (!toll) {
    events.push({ type: 'tollFailed', reason: 'none' });
    return;
  }
  if (answer === 'refuse') {
    endToll(state, 'attack');
    events.push({ type: 'tollRefused', group: toll.group, timeout: false });
    return;
  }
  if (state.credits < toll.amount) {
    events.push({ type: 'tollFailed', reason: 'credits' });
    return;
  }
  state.credits -= toll.amount;
  events.push({ type: 'creditsChanged', delta: -toll.amount, reason: 'toll' });
  endToll(state, 'patrol');
  // the truce is saved with the group (I1) – it lasts the toll period, through save and load
  p.paid.set(toll.group, state.tick + TOLL.calmSeconds * TICKS_PER_SECOND);
  syncCalm(state);
  addAttention(state, ATTENTION.toll, events);
  events.push({ type: 'tollPaid', group: toll.group, amount: toll.amount });
}

/**
 * A paid group stays calm while its toll period lasts (`pirates.paid`, saved – I1); members that spawn
 * later (after flying away and back) are calm too. Derived state: called every step and after a load.
 */
export function syncCalm(state: SimState): void {
  const paid = state.pirates.paid;
  for (const e of state.combat.enemies) {
    const group = groupOf(e.id);
    if (group && (paid.get(group) ?? -1) > state.tick) e.calm = true;
    else delete e.calm;
  }
}

function stepToll(state: SimState, events: readonly SimEvent[], out: SimEvent[]): void {
  const p = state.pirates;
  // a hit on a calm pirate ends the truce of its whole group – they fight back (I2)
  for (const e of events) {
    if (e.type !== 'projectileHit' || e.owner !== 'player' || e.ref === null) continue;
    const group = groupOf(e.ref);
    if (!group || (p.paid.get(group) ?? -1) <= state.tick) continue;
    p.paid.delete(group);
    for (const m of groupEnemies(state, group)) {
      m.ai.mode = 'attack';
      out.push({ type: 'enemyAlert', ref: m.id, pos: { ...m.body.pos } });
    }
  }
  if (p.paid.size > 0) for (const [group, until] of [...p.paid]) if (until <= state.tick) p.paid.delete(group);
  syncCalm(state);
  if (p.tolled.size > 0) for (const [group, until] of [...p.tolled]) if (until <= state.tick) p.tolled.delete(group);
  const toll = p.toll;
  if (!toll) return;
  const members = groupEnemies(state, toll.group);
  const player = state.player;
  if (members.length === 0 || player.dock.mode !== 'flying' || player.destroyed) {
    p.toll = null;
    return;
  }
  const shot = events.some((e) => e.type === 'projectileHit' && e.owner === 'player' && e.ref !== null && groupOf(e.ref) === toll.group);
  if (shot || state.tick >= toll.until) {
    endToll(state, 'attack');
    out.push({ type: 'tollRefused', group: toll.group, timeout: !shot });
    return;
  }
  if (members.every((m) => length(sub(m.body.pos, player.body.pos)) > TOLL.escape)) {
    endToll(state, 'patrol');
    out.push({ type: 'tollEscaped', group: toll.group });
  }
}

// ---------------------------------------------------------------------------
// hunting party and raids

/** A named captain free to lead a hunting party or a raid (alive, not hunted, not in combat). */
function freeCaptain(state: SimState, salt: number): number | null {
  const hunted = new Set(state.career.contracts.flatMap((c) => (c.target.kind === 'captain' ? [c.target.captain] : [])));
  const present = new Set(state.combat.enemies.map((e) => e.id));
  const free = captainDefs(state.seed).filter((d) => !state.career.captains.get(d.index)?.defeated && !hunted.has(d.index) && !present.has(captainEnemyId(d.index)));
  if (free.length === 0) return null;
  const pick = createRng(hash3(state.seed ^ RAID_SALT, salt, 1))();
  return free[Math.floor(pick * free.length)]!.index;
}

function captainShip(state: SimState, index: number, pos: Vec2, angle: number, home: Vec2): Enemy {
  const def = captainDefs(state.seed)[index]!;
  const e = createCaptainEnemy(index, captainLevel(def, state.career.captains.get(index)), pos, angle);
  e.home = { ...home };
  return e;
}

function stepHunt(state: SimState, out: SimEvent[]): void {
  const p = state.pirates;
  const player = state.player;
  if (pirateLevel(state) < 2 || p.raid || state.tick - p.lastHunt < HUNT.cooldownTicks) return;
  if (player.dock.mode !== 'flying' || player.destroyed) return;
  const ctx = spawnContext(state);
  if (!inDangerousSector(state, ctx)) return;
  p.lastHunt = state.tick;
  const serial = p.serial++;
  const rng = createRng(hash3(state.seed ^ RAID_SALT, serial, 2));
  // the party comes out of a dangerous sector (§6.1): the first of 8 bearings from a random one whose
  // point lies in one, else the random bearing (the ship itself is in a dangerous sector)
  const a0 = rng() * TAU;
  const pointAt = (b: number): Vec2 => ({ x: player.body.pos.x + Math.cos(b) * HUNT.distance, y: player.body.pos.y + Math.sin(b) * HUNT.distance });
  let a = a0;
  for (let k = 0; k < 8; k++) {
    const b = a0 + (k * TAU) / 8;
    if (dangerousSector(state, pointAt(b), ctx)) {
      a = b;
      break;
    }
  }
  const at = pointAt(a);
  const home = { ...player.body.pos };
  const depth = sectorInfoAt(state.seed, at.x, at.y).depth;
  const captain = freeCaptain(state, serial);
  const ships: Enemy[] = [];
  if (captain !== null) ships.push(captainShip(state, captain, at, a + Math.PI, home));
  const count = HUNT.jackals + (captain === null ? 1 : 0);
  // M4b §2.6 b: out of a Pirate sector of depth 2 the party brings a Gunner instead of its last Jackal
  const gunner = depth === GUNNER.huntDepth && securityHere(state, at) === 'pirate';
  for (let i = 0; i < count; i++) {
    const o = { x: at.x + Math.cos(a + 1.6 + i) * 10, y: at.y + Math.sin(a + 1.6 + i) * 10 };
    const kind = i === 0 && captain === null ? 'hammer' : gunner && i === count - 1 ? 'gunner' : 'jackal';
    ships.push(createEnemy({ id: `hp:${serial}:${i}`, kind, tier: depth >= 3 ? 2 : 1, pos: o, angle: a + Math.PI, home, orbit: i % 2 === 0 ? 1 : -1 }));
  }
  for (const e of ships) {
    e.ai.mode = 'attack';
    state.combat.enemies.push(e);
  }
  out.push({ type: 'huntingParty', captain, pos: at });
}

/**
 * Where a natural raid strikes: the discovered station in a dangerous sector (Contested or Pirate,
 * sectors §6.1 – was "an outer-belt station", ring ≥ 2) nearest to the player. Guarded and Quiet
 * sectors are watched by the Guild, so their stations are never raided.
 */
function raidTarget(state: SimState): { pos: Vec2; station: StationDef | null } {
  const pos = state.player.body.pos;
  const ctx = spawnContext(state);
  let best: StationDef | null = null;
  let bestD = Infinity;
  for (const id of state.world.discovered) {
    const s = stationById(state.seed, id);
    if (!s || s.kind === 'home' || !dangerousSector(state, s.pos, ctx)) continue;
    const d = length(sub(s.pos, pos));
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  if (!best) {
    const dir = length(pos) > 1 ? scale(pos, 1 / length(pos)) : { x: 1, y: 0 };
    return { pos: { x: pos.x + dir.x * 400, y: pos.y + dir.y * 400 }, station: null };
  }
  const out = length(best.pos) > 1 ? scale(best.pos, 1 / length(best.pos)) : { x: 1, y: 0 };
  return { pos: { x: best.pos.x + out.x * (best.clearRadius + 140), y: best.pos.y + out.y * (best.clearRadius + 140) }, station: best };
}

function announceRaid(state: SimState, kind: RaidKind, pos: Vec2, station: string | null, beacon: string | null, delay: number, out: SimEvent[]): Raid {
  const p = state.pirates;
  const serial = p.serial++;
  const captain = freeCaptain(state, serial);
  const raid: Raid = {
    serial,
    kind,
    pos: { ...pos },
    station,
    beacon,
    captain,
    ships: 1 + RAID.escorts,
    arrive: state.tick + delay,
    ends: state.tick + delay + RAID.lingerTicks,
    spawned: false,
  };
  p.raid = raid;
  out.push({ type: 'raidAnnounced', serial, kind, pos: { ...pos }, station, captain, ships: raid.ships, arrive: raid.arrive });
  return raid;
}

/** Id of the raid flagship (named captain or a nameless Hammer). */
export const raidFlagship = (raid: Raid): string => (raid.captain !== null ? captainEnemyId(raid.captain) : `rd:${raid.serial}:0`);

const isRaidShip = (raid: Raid, id: string): boolean => id === raidFlagship(raid) || id.startsWith(`rd:${raid.serial}:`);

/** The raid's captain is still free to lead it (not defeated, hunted by a contract or flying elsewhere). */
function captainStillFree(state: SimState, captain: number): boolean {
  if (state.career.captains.get(captain)?.defeated) return false;
  if (state.career.contracts.some((c) => c.target.kind === 'captain' && c.target.captain === captain)) return false;
  return !state.combat.enemies.some((e) => e.id === captainEnemyId(captain));
}

/**
 * The fleet arrives – or comes back after it despawned when the player flew away (M7: ships killed
 * before stay dead). A captain who since fell, is hunted by a contract or flies elsewhere is replaced
 * by a nameless flagship (M6 – never a second copy of a captain).
 */
function spawnRaid(state: SimState, raid: Raid, out: SimEvent[]): void {
  const again = raid.spawned;
  raid.spawned = true;
  if (raid.captain !== null && !again && !captainStillFree(state, raid.captain)) raid.captain = null;
  const rng = createRng(hash3(state.seed ^ RAID_SALT, raid.serial, 3));
  // escorts are T2 from sector depth 3 on (like the hunting party)
  const depth = sectorInfoAt(state.seed, raid.pos.x, raid.pos.y).depth;
  const a = rng() * TAU;
  const ships: Enemy[] = [];
  if (raid.captain !== null) {
    if (captainStillFree(state, raid.captain)) ships.push(captainShip(state, raid.captain, raid.pos, a, raid.pos));
  } else if (!state.combat.defeated.has(`rd:${raid.serial}:0`)) {
    ships.push(createEnemy({ id: `rd:${raid.serial}:0`, kind: 'hammer', tier: 2, pos: raid.pos, angle: a, home: raid.pos, orbit: 1 }));
  }
  for (let i = 1; i <= RAID.escorts; i++) {
    const id = `rd:${raid.serial}:${i}`;
    if (state.combat.defeated.has(id)) continue;
    const o = { x: raid.pos.x + Math.cos(a + i * 2.1) * 14, y: raid.pos.y + Math.sin(a + i * 2.1) * 14 };
    ships.push(createEnemy({ id, kind: i === 1 ? 'hammer' : 'jackal', tier: depth >= 3 ? 2 : 1, pos: o, angle: a, home: raid.pos, orbit: i % 2 === 0 ? 1 : -1 }));
  }
  for (const e of ships) e.ai.mode = again ? 'patrol' : e.ai.mode;
  state.combat.enemies.push(...ships);
  if (!again) out.push({ type: 'raidArrived', serial: raid.serial, pos: { ...raid.pos } });
}

const CHEST_PARTS: readonly PartId[] = ['cannon', 'shield', 'engine', 'reactor', 'gyro', 'cargo'];

/** War chest containers (titanium, copper and T2 parts) at a point. */
export function warChest(state: SimState, key: string, pos: Vec2, count: number): void {
  const rng = createRng(hash3(state.seed ^ RAID_SALT, fnv1a32(key), 4));
  for (let i = 0; i < count; i++) {
    const loot: WreckLoot = { cargo: emptyCargo(), parts: {} };
    loot.cargo.titanium = Math.round(25 + rng() * 25);
    loot.cargo.copper = Math.round(10 + rng() * 15);
    if (rng() < 0.6) loot.parts[partKey(CHEST_PARTS[Math.floor(rng() * CHEST_PARTS.length)]!, 2)] = 1;
    const a = (i / count) * TAU + rng() * 0.5;
    const vel = { x: Math.cos(a) * 2.5, y: Math.sin(a) * 2.5 };
    state.combat.containers.push(createContainer(state.combat.nextId++, { x: pos.x + Math.cos(a) * 3, y: pos.y + Math.sin(a) * 3 }, vel, loot));
  }
}

/** War chest credits: hours of the reference income of the ring. */
export const chestCredits = (ring: RingIndex): number => Math.round((MIN_REFERENCE_INCOME[ring] * RAID.chestHours) / 50) * 50;

function stepRaid(state: SimState, events: readonly SimEvent[], out: SimEvent[]): void {
  const p = state.pirates;
  if (!p.raid && p.attention >= ATTENTION.levels[2] && state.settings.enemyDensity !== 'low') {
    const target = raidTarget(state);
    announceRaid(state, 'raid', target.pos, target.station?.id ?? null, null, RAID.announceTicks, out);
  }
  const raid = p.raid;
  if (!raid) return;
  const flagship = raidFlagship(raid);
  const killed = events.find((e) => e.type === 'shipDestroyed' && e.ref === flagship);
  if (raid.spawned && killed && killed.type === 'shipDestroyed') {
    const ring = ringIndexAt(length(killed.pos)) as RingIndex;
    const credits = chestCredits(ring);
    state.credits += credits;
    out.push({ type: 'creditsChanged', delta: credits, reason: 'bounty' });
    warChest(state, `raid:${raid.serial}`, killed.pos, RAID.chestContainers);
    finishRaid(state, raid);
    out.push({ type: 'raidDefeated', serial: raid.serial, credits, pos: { ...killed.pos } });
    return;
  }
  if (state.tick >= raid.ends) {
    // the fleet leaves (undefended raid in M3.6 takes nothing – bases come in M5b)
    state.combat.enemies = state.combat.enemies.filter((e) => !isRaidShip(raid, e.id));
    finishRaid(state, raid);
    out.push({ type: 'raidEnded', serial: raid.serial });
    return;
  }
  // the fleet despawned (the player flew away): it waits at its point and comes back with the player (M7)
  const fleetHere = state.combat.enemies.some((e) => isRaidShip(raid, e.id));
  if (state.tick >= raid.arrive && length(sub(state.player.body.pos, raid.pos)) <= RAID.spawnRange && (!raid.spawned || !fleetHere)) spawnRaid(state, raid, out);
}

function finishRaid(state: SimState, raid: Raid): void {
  const p = state.pirates;
  p.raid = null;
  p.attention = Math.min(p.attention, ATTENTION.afterRaid);
  if (raid.beacon) p.beacons.set(raid.beacon, state.tick + RAID.beaconCooldownTicks);
}

// ---------------------------------------------------------------------------
// clan challenge (pirate beacon, F)

export interface BeaconInteraction {
  kind: 'beacon';
  id: string;
  pos: Vec2;
}

/** Clan beacon in F range, or null. */
export function pirateInteraction(state: SimState): BeaconInteraction | null {
  const player = state.player;
  for (const f of fortressSites(state.seed)) {
    const gap = length(sub(f.beacon.pos, player.body.pos)) - player.props.boundingRadius - 1;
    if (gap <= RAID.beaconRange) return { kind: 'beacon', id: f.beacon.id, pos: f.beacon.pos };
  }
  return null;
}

/** Tick until which the clan refuses another challenge at any beacon (M8). */
export const challengeCooldownUntil = (state: SimState): number => Math.max(-1, ...state.pirates.beacons.values());

/** F at a clan beacon: the clan sends a captain to a duel at the beacon (attention 90). */
export function interactPirates(state: SimState, it: BeaconInteraction, events: SimEvent[]): void {
  const p = state.pirates;
  if (p.raid) {
    events.push({ type: 'challengeRefused', reason: 'raidActive' });
    return;
  }
  // the clan recovers from a challenge as a whole – another beacon does not skip the cooldown (M8)
  if (challengeCooldownUntil(state) > state.tick) {
    events.push({ type: 'challengeRefused', reason: 'cooldown' });
    return;
  }
  const before = attentionLevel(p.attention);
  p.attention = Math.max(p.attention, ATTENTION.levels[2]);
  if (attentionLevel(p.attention) !== before) events.push({ type: 'attentionLevel', level: 3, attention: p.attention });
  events.push({ type: 'challengeIssued', beacon: it.id, pos: { ...it.pos } });
  announceRaid(state, 'challenge', it.pos, null, it.id, RAID.challengeTicks, events);
}

// ---------------------------------------------------------------------------

/** Pirate step after combat. Returns new events. */
export function stepPirates(state: SimState, cmd: PlayerCommand, events: readonly SimEvent[]): SimEvent[] {
  const out: SimEvent[] = [];
  if (cmd.toll) answerToll(state, cmd.toll, out);
  stepAttention(state, events, out);
  startToll(state, events, out);
  stepToll(state, events, out);
  stepHunt(state, out);
  stepRaid(state, events, out);
  stepFortresses(state, events, out);
  return out;
}
