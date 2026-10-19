// Pirates (spec 2.7, long-term design 6.2): ship templates from the same parts as the player and their
// deterministic placement in chunks by the sector (depth, security, Guild Lane corridor – sectors
// design §6.1) and the enemy density.
import type { RingIndex } from '../../data/economy';
import { GUNNER, PIRATE_GROUPS } from '../../data/pirates';
import type { Tier } from '../../data/parts';
import { cargoMass } from '../../data/resources';
import { TAU } from '../math/angle';
import { fnv1a32 } from '../math/fnv1a';
import { createRng } from '../math/rng';
import { hypot, type Vec2 } from '../math/vec2';
import { createBody } from '../physics/body';
import type { EnemyDensity } from '../settings';
import { createGrid } from '../ship/grid';
import { hullHp } from '../ship/hp';
import { computeProperties } from '../ship/properties';
import type { ShipGrid } from '../ship/types';
import { packedChunkKey } from '../world/chunkMemo';
import { CHUNK_SIZE } from '../world/chunks';
import { hash3 } from '../world/hash';
import { chunkPirates, REGION_GEN, regionWorld, STATIC_SPAWN_CONTEXT, type SpawnContext } from '../regions';
import { stationAt, type StationDef } from '../world/stations';
import type { Enemy, EnemyKind } from './types';

/**
 * Jackal (drone): small and agile, 1 cannon, engines to every side.
 *
 *   y= 1        R  B
 *   y= 0     F  C  W
 *   y=-1        L  B
 *          x=-1 0  1
 */
function jackal(tier: Tier): ShipGrid {
  return createGrid([
    ['cockpit', 0, 0, 0, tier],
    ['cannon', 1, 0, 0, tier],
    ['engine', -1, 0, 0, tier],
    ['engine', 0, 1, 3, tier],
    ['engine', 0, -1, 1, tier],
    ['engine', 1, 1, 2, tier],
    ['engine', 1, -1, 2, tier],
  ]);
}

/**
 * Hammer (pirate ship): armour in front, 2 cannons, a shield, a fuel tank (T – seven engines drink
 * more than the cockpit's tank holds).
 *
 *   y= 2           R  B
 *   y= 1        F  G  A  W
 *   y= 0     F  E  S  C  A
 *   y=-1        F  T  A  W
 *   y=-2           L  B
 *          x=-2 -1 0  1  2
 */
function hammer(tier: Tier): ShipGrid {
  return createGrid([
    ['cockpit', 1, 0, 0, tier],
    ['armor', 2, 0, 0, tier],
    ['armor', 1, 1, 0, tier],
    ['armor', 1, -1, 0, tier],
    ['cannon', 2, 1, 0, tier],
    ['cannon', 2, -1, 0, tier],
    ['shield', 0, 0, 0, tier],
    ['reactor', -1, 0, 0, tier],
    ['gyro', 0, 1, 0, tier],
    ['fuelTank', 0, -1, 0, tier],
    ['engine', -2, 0, 0, tier],
    ['engine', -1, 1, 0, tier],
    ['engine', -1, -1, 0, tier],
    ['engine', 0, 2, 3, tier],
    ['engine', 0, -2, 1, tier],
    ['engine', 1, 2, 2, tier],
    ['engine', 1, -2, 2, tier],
  ]);
}

/**
 * Scavenger (M3.6, 6.2): a tractor beam in front, two cargo holds and a fuel tank (T) between them, a
 * gyro and many engines – no cannon. The gyro sits beside the right-thrust engine, clear of every
 * nozzle (a covered nozzle halves thrust and burns the part).
 *
 *   y= 2        R  G
 *   y= 1     F  N  B
 *   y= 0  F  E  T  C  V
 *   y=-1     F  N  B
 *   y=-2        L
 *       x=-2 -1 0  1  2
 */
function scavenger(tier: Tier): ShipGrid {
  return createGrid([
    ['cockpit', 1, 0, 0, tier],
    ['tractorBeam', 2, 0, 0, tier],
    ['gyro', 1, 2, 0, tier],
    ['fuelTank', 0, 0, 0, tier],
    ['cargo', 0, 1, 0, tier],
    ['cargo', 0, -1, 0, tier],
    ['reactor', -1, 0, 0, tier],
    ['engine', -2, 0, 0, tier],
    ['engine', -1, 1, 0, tier],
    ['engine', -1, -1, 0, tier],
    ['engine', 0, 2, 3, tier],
    ['engine', 0, -2, 1, tier],
    ['engine', 1, 1, 2, tier],
    ['engine', 1, -1, 2, tier],
  ]);
}

/**
 * Gunner (M4b, design 6.2): an artillery barge – three forward cannons behind no armour
 * (their arcs stay clear), armour plates behind them, a shield, two reactors to feed the guns, two fuel
 * tanks, a gyro and six engines (2 forward, 2 backward to back away while keeping its guns on the
 * target, 1 each side). Heavy for its thrust: it cannot outrun a combat-fit ship of its tier (no unfair
 * kiting – the counter is fast engines). The cannons are always T2 (range 100 → standoff 90 u), the
 * rest by tier. 21 parts, every one a part the clan sets have (cockpit, engine, cannon, armour,
 * shield, reactor, gyro, fuel tank – render/assets/clanParts.ts), so its wreck is an ordinary pirate
 * wreck.
 *
 *   y= 2     A  R  B
 *   y= 1  F  T  G  A  K
 *   y= 0  E  E  C  A  K
 *   y=-1  F  T  S  A  K
 *   y=-2     A  L  B
 *       x=-1 0  1  2  3
 */
function gunner(tier: Tier): ShipGrid {
  const gun = GUNNER.cannonTier;
  return createGrid([
    ['cockpit', 1, 0, 0, tier],
    ['cannon', 3, 1, 0, gun],
    ['cannon', 3, 0, 0, gun],
    ['cannon', 3, -1, 0, gun],
    ['armor', 2, 1, 0, tier],
    ['armor', 2, 0, 0, tier],
    ['armor', 2, -1, 0, tier],
    ['gyro', 1, 1, 0, tier],
    ['shield', 1, -1, 0, tier],
    ['reactor', 0, 0, 0, tier],
    ['reactor', -1, 0, 0, tier],
    ['fuelTank', 0, 1, 0, tier],
    ['fuelTank', 0, -1, 0, tier],
    ['engine', -1, 1, 0, tier],
    ['engine', -1, -1, 0, tier],
    ['engine', 1, 2, 2, tier],
    ['engine', 1, -2, 2, tier],
    ['engine', 0, 2, 3, tier],
    ['engine', 0, -2, 1, tier],
    ['armor', -1, 2, 0, tier],
    ['armor', -1, -2, 0, tier],
  ]);
}

/**
 * Sentry drone of a derelict station (M4b, plan §2.4): five parts – cockpit, a cannon, armour, one
 * engine forward and one backward (sideways only the cockpit RCS). It guards its derelict.
 *
 *   y= 1     B
 *   y= 0  F  C  K
 *   y=-1     A
 *       x=-1 0  1
 */
function sentry(tier: Tier): ShipGrid {
  return createGrid([
    ['cockpit', 0, 0, 0, tier],
    ['cannon', 1, 0, 0, tier],
    ['armor', 0, -1, 0, tier],
    ['engine', -1, 0, 0, tier],
    ['engine', 0, 1, 2, tier],
  ]);
}

export const ENEMY_TEMPLATES: Record<EnemyKind, (tier: Tier) => ShipGrid> = { jackal, hammer, scavenger, gunner, sentry };

/** Average pirate groups per chunk at normal density by sector depth (data/pirates.ts PIRATE_GROUPS). */
export const GROUP_RATE: Record<RingIndex, number> = PIRATE_GROUPS.rate;
export const DENSITY_MULT: Record<EnemyDensity, number> = { low: 0.5, normal: 1, high: 1.6 };
/** Around stations no pirates (added to the station's clear circle). */
export const STATION_SAFE_MARGIN = 150;
const PIRATE_SALT = 0x7a3e_91c5;
/** Margin of the chunk the group centre stays out of. */
const MARGIN = 25;

export interface SpawnSlot {
  /** Stable id, e.g. 'pr:12,-3:1'. */
  id: string;
  kind: EnemyKind;
  /**
   * The kind the slot had before a separate roll replaced it (M4b: the Gunner leader roll of a regular
   * group, `GUNNER.salt` – set only when it replaced the kind). The golden test compares this one, so
   * the Gunner never moves or resizes a recorded group (src/sim/sites/golden.test.ts).
   */
  baseKind?: EnemyKind;
  tier: Tier;
  pos: Vec2;
  angle: number;
  /** Centre of the group's patrol. */
  home: Vec2;
  orbit: 1 | -1;
}

/** The inputs of one cached `spawnSlots` answer (beside the chunk). */
interface SlotEntry {
  seed: number;
  density: EnemyDensity;
  mult: number;
  group: number;
  hammer: number;
  tier: Tier;
  slots: SpawnSlot[];
}

/**
 * `spawnSlots` answers by chunk (`packedChunkKey`), each with its exact inputs – no key string per chunk
 * and spawn check (perf audit 2026-10-17, P4: the key held two doubles). Pure answers, so any hit is the
 * answer a fresh computation gives.
 */
const slotCache = new Map<number, SlotEntry[]>();
let slotEntries = 0;

/** No pirate ever spawns this close to home (sectors §6.1) – also checked per group, not just per chunk. */
export const inPirateFreeZone = (p: Vec2): boolean => hypot(p.x, p.y) < REGION_GEN.corner.pirateFreeRadius;
const SLOT_CACHE_MAX = 4096;

function nearStation(seed: number, cx: number, cy: number, pos: Vec2): boolean {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const s: StationDef | null = stationAt(seed, cx + dx, cy + dy);
      if (s && hypot(s.pos.x - pos.x, s.pos.y - pos.y) < s.clearRadius + STATION_SAFE_MARGIN) return true;
    }
  }
  return false;
}

/** A chunk's pirate group: the layout drawn from the chunk's hash (always in the same order). */
interface GroupLayout {
  roll: number;
  home: Vec2;
  kindRoll: number;
  countRoll: number;
  orbit: 1 | -1;
  offsets: { x: number; y: number; angle: number }[];
}

function groupLayout(seed: number, cx: number, cy: number): GroupLayout {
  const rng = createRng(hash3(seed ^ PIRATE_SALT, cx, cy));
  // every value is always drawn in the same order
  const roll = rng();
  const home = { x: cx * CHUNK_SIZE + MARGIN + rng() * (CHUNK_SIZE - 2 * MARGIN), y: cy * CHUNK_SIZE + MARGIN + rng() * (CHUNK_SIZE - 2 * MARGIN) };
  const kindRoll = rng();
  const countRoll = rng();
  const orbit: 1 | -1 = rng() < 0.5 ? 1 : -1;
  const offsets = [0, 1, 2, 3].map(() => ({ x: (rng() - 0.5) * 24, y: (rng() - 0.5) * 24, angle: rng() * TAU }));
  return { roll, home, kindRoll, countRoll, orbit, offsets };
}

/**
 * The slots of a group. `gunnerLead` = the separate Gunner roll (M4b) turned the leader (index 0) into
 * a Gunner: only its kind changes (`baseKind` keeps the old one) – ids, positions and the group size
 * stay, so saved hunt contracts and the golden spawn slots keep resolving.
 */
function groupSlots(cx: number, cy: number, g: GroupLayout, kinds: readonly EnemyKind[], tier: Tier, gunnerLead = false): SpawnSlot[] {
  return kinds.map((kind, i) => {
    const o = g.offsets[Math.min(i, g.offsets.length - 1)]!;
    const lead = gunnerLead && i === 0 && kind !== 'gunner';
    return {
      id: `pr:${cx},${cy}:${i}`,
      kind: lead ? 'gunner' : kind,
      ...(lead ? { baseKind: kind } : {}),
      tier,
      pos: { x: g.home.x + o.x, y: g.home.y + o.y },
      angle: o.angle,
      home: g.home,
      orbit: (i % 2 === 0 ? g.orbit : -g.orbit) as 1 | -1,
    };
  });
}

const groupKinds = (g: GroupLayout, hammerShare: number): EnemyKind[] =>
  g.kindRoll < hammerShare
    ? ['hammer', ...Array<EnemyKind>(Math.floor(g.countRoll * 2)).fill('jackal')]
    : Array<EnemyKind>(2 + Math.floor(g.countRoll * 2)).fill('jackal');

/**
 * The Gunner leader roll of a regular group (M4b §2.6 a): its own hash stream (`GUNNER.salt`), so the
 * group layout above draws exactly what it drew before; the chance by the depth of the chunk's sector.
 */
export function gunnerLeads(seed: number, cx: number, cy: number, depth: RingIndex): boolean {
  const share = GUNNER.groupShare[depth] ?? 0;
  return share > 0 && createRng(hash3(seed ^ GUNNER.salt, cx, cy))() < share;
}

/**
 * Spawn slots of a chunk (a pure function of the hash; cached). The group chance, Hammer share and
 * tier come from the chunk's sector (`chunkPirates`: depth × security × corridor, the pirate corner,
 * nothing within 1 000 u of home) for the spawn context `ctx` (training, epoch, destroyed fortresses).
 * `mult` = multiplier of the group chance from the local conditions (hunting grounds ×1.5, pirate war
 * ×0.5) and pirate attention (M3.6); `hammerBonus` = extra Hammer share from attention.
 * Contracts and their targets use the static context (an untouched world after the calm start).
 */
export function spawnSlots(
  seed: number,
  cx: number,
  cy: number,
  density: EnemyDensity,
  mult = 1,
  hammerBonus = 0,
  ctx: SpawnContext = STATIC_SPAWN_CONTEXT,
): SpawnSlot[] {
  const p = chunkPirates(regionWorld(seed), cx, cy, ctx);
  const hammer = p.hammerShare + (p.hammerBonus ? hammerBonus : 0);
  const key = packedChunkKey(cx, cy);
  let entries = slotCache.get(key);
  if (entries) {
    for (const e of entries) {
      if (e.seed === seed && e.density === density && e.mult === mult && e.group === p.group && e.hammer === hammer && e.tier === p.tier) return e.slots;
    }
  }
  if (slotEntries >= SLOT_CACHE_MAX) {
    slotCache.clear();
    slotEntries = 0;
    entries = undefined;
  }

  const g = groupLayout(seed, cx, cy);
  const live = g.roll < p.group * DENSITY_MULT[density] * mult && !inPirateFreeZone(g.home) && !nearStation(seed, cx, cy, g.home);
  const slots = live ? groupSlots(cx, cy, g, groupKinds(g, hammer), p.tier, gunnerLeads(seed, cx, cy, p.depth as RingIndex)) : [];
  if (!entries) {
    entries = [];
    slotCache.set(key, entries);
  }
  entries.push({ seed, density, mult, group: p.group, hammer, tier: p.tier, slots });
  slotEntries++;
  return slots;
}

/**
 * The group of a hunt contract (`pr:<cx,cy>:<i>` ids saved in the contract): exactly the saved ids,
 * laid out from the chunk's hash whatever the chunk's chance is now – a contract accepted before the
 * sectors (ring-based groups) or before a fortress fell stays completable.
 */
export function huntGroupSlots(seed: number, cx: number, cy: number, ids: readonly string[]): SpawnSlot[] {
  const p = chunkPirates(regionWorld(seed), cx, cy, STATIC_SPAWN_CONTEXT);
  const g = groupLayout(seed, cx, cy);
  const tier: Tier = p.tier;
  const kinds = groupKinds(g, p.hammerShare);
  const all = groupSlots(cx, cy, g, Array.from({ length: Math.max(kinds.length, ids.length) }, (_, i) => kinds[i] ?? 'jackal'), tier, gunnerLeads(seed, cx, cy, p.depth as RingIndex));
  // an id beyond the layout (a bigger saved group) still gets its own slot
  return ids.map((id) => {
    const i = Number(/:(\d+)$/.exec(id)?.[1] ?? -1);
    const slot = all[i];
    return slot && slot.id === id ? slot : { ...all[0]!, id };
  });
}

/** Mass of a pirate with its hold: cargo weighs exactly as in the player's hold (cargoMass). */
export const enemyMass = (e: Pick<Enemy, 'props' | 'hold'>): number => e.props.mass + (e.hold ? cargoMass(e.hold.cargo) : 0);

/** A freshly spawned pirate's tanks are 65–100 % full (deterministic per spawn slot). */
export const SPAWN_FUEL: readonly [number, number] = [0.65, 1];

/** Starting fuel of a pirate with id `id` and tanks of `capacity`. */
export function spawnFuel(id: string, capacity: number): number {
  const roll = (fnv1a32(`fuel:${id}`) % 1000) / 999;
  return capacity * (SPAWN_FUEL[0] + (SPAWN_FUEL[1] - SPAWN_FUEL[0]) * roll);
}

/** A new enemy from a slot – full shield and battery, patrolling around the group centre. */
export function createEnemy(slot: SpawnSlot): Enemy {
  const grid = ENEMY_TEMPLATES[slot.kind](slot.tier);
  const props = computeProperties(grid);
  const body = createBody(slot.pos, slot.angle);
  return {
    id: slot.id,
    kind: slot.kind,
    home: { ...slot.home },
    maxHull: hullHp(grid, new Map()).max,
    grid,
    gridVersion: 0,
    hp: new Map(),
    props,
    body,
    prevBody: body,
    lastLocalForce: { x: 0, y: 0 },
    energy: props.batteryCapacity,
    shield: props.shield.capacity,
    shieldDelay: 0,
    cooldowns: new Map(),
    fuel: spawnFuel(slot.id, props.fuelCapacity),
    ai: { mode: 'patrol', waypoint: { ...slot.pos }, timer: 0, orbit: slot.orbit, breakOff: 0, react: 0, seen: { x: 0, y: 0 } },
  };
}
