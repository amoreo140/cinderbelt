// Named captains (long-term design 6.4): 30 captains per seed (name, nickname, clan, temperament),
// their ship by level and the combat enemy with id `cap:<index>`.
import {
  BOUNTY_HOURS_BASE,
  BOUNTY_HOURS_PER_LEVEL,
  CAPTAIN_CLANS,
  CAPTAIN_COUNT,
  CAPTAIN_MAX_LEVEL,
  CAPTAIN_NAMES,
  CAPTAIN_NICKNAME_COUNT,
  CAPTAIN_START_LEVELS,
  CAPTAIN_T2_LEVEL,
  CAPTAIN_TRAITS,
  TRAITS,
  type CaptainTrait,
} from '../../data/captains';
import type { RingIndex } from '../../data/economy';
import { MIN_REFERENCE_INCOME } from '../../data/contracts';
import type { FactionId } from '../../data/factions';
import type { PartId, Tier } from '../../data/parts';
import { createRng } from '../math/rng';
import type { Vec2 } from '../math/vec2';
import { createBody } from '../physics/body';
import { createGrid } from '../ship/grid';
import { hullHp } from '../ship/hp';
import { computeProperties } from '../ship/properties';
import type { Rotation, ShipGrid } from '../ship/types';
import { hash3 } from '../world/hash';
import type { CaptainState } from '../career/types';
import { spawnFuel } from '../combat/enemies';
import type { Enemy } from '../combat/types';

const CAPTAIN_SALT = 0xca97_a1e5;
export const CAPTAIN_PREFIX = 'cap:';

export interface CaptainDef {
  index: number;
  name: number;
  nickname: number;
  clan: FactionId;
  trait: CaptainTrait;
  /** Level when generated (1–3). */
  baseLevel: number;
  /** The ring where the captain flies (2–4). */
  ring: RingIndex;
}

const defCache = new Map<number, CaptainDef[]>();

/** All captains of the seed (names without repeats). */
export function captainDefs(seed: number): readonly CaptainDef[] {
  const cached = defCache.get(seed);
  if (cached) return cached;
  if (defCache.size > 32) defCache.clear();
  const rng = createRng(hash3(seed ^ CAPTAIN_SALT, 0, 0));
  const pairs: [number, number][] = [];
  for (let n = 0; n < CAPTAIN_NAMES.length; n++) for (let k = 0; k < CAPTAIN_NICKNAME_COUNT; k++) pairs.push([n, k]);
  const usedNames = new Set<number>();
  const usedNicks = new Set<number>();
  const usedPairs = new Set<number>();
  const out: CaptainDef[] = [];
  const clanOffset = Math.floor(rng() * CAPTAIN_CLANS.length);
  for (let index = 0; index < CAPTAIN_COUNT; index++) {
    // nicknames and names repeat only once the list is exhausted
    if (usedNames.size >= CAPTAIN_NAMES.length) usedNames.clear();
    if (usedNicks.size >= CAPTAIN_NICKNAME_COUNT) usedNicks.clear();
    const unused = pairs.filter(([n, k]) => !usedPairs.has(n * 1000 + k));
    const fresh = unused.filter(([n, k]) => !usedNames.has(n) && !usedNicks.has(k));
    const free = fresh.length > 0 ? fresh : unused;
    const [name, nickname] = free[Math.floor(rng() * free.length)]!;
    usedNames.add(name);
    usedNicks.add(nickname);
    usedPairs.add(name * 1000 + nickname);
    // clans evenly (every third), temperament and level at random
    const clan = CAPTAIN_CLANS[(index + clanOffset) % CAPTAIN_CLANS.length]!;
    const trait = CAPTAIN_TRAITS[Math.floor(rng() * CAPTAIN_TRAITS.length)]!;
    const baseLevel = 1 + Math.floor(rng() * CAPTAIN_START_LEVELS);
    const ring = (2 + Math.floor(rng() * 3)) as RingIndex;
    out.push({ index, name, nickname, clan, trait, baseLevel, ring });
  }
  defCache.set(seed, out);
  return out;
}

export const captainDef = (seed: number, index: number): CaptainDef | null => captainDefs(seed)[index] ?? null;

export const captainLevel = (def: CaptainDef, state: CaptainState | undefined): number =>
  Math.min(CAPTAIN_MAX_LEVEL, def.baseLevel + (state?.promotions ?? 0));

export const captainBounty = (def: CaptainDef, level: number): number =>
  Math.round((MIN_REFERENCE_INCOME[def.ring] * (BOUNTY_HOURS_BASE + BOUNTY_HOURS_PER_LEVEL * level) * TRAITS[def.trait].bountyMult) / 5) * 5;

type Entry = [PartId, number, number, Rotation?];

/** Hammer (pirate ship) – the captain's ship at level 1. */
const BASE: readonly Entry[] = [
  ['cockpit', 1, 0],
  ['armor', 2, 0],
  ['armor', 1, 1],
  ['armor', 1, -1],
  ['cannon', 2, 1],
  ['cannon', 2, -1],
  ['shield', 0, 0],
  ['reactor', -1, 0],
  ['gyro', 0, 1],
  ['cargo', 0, -1],
  ['engine', -2, 0, 0],
  ['engine', -1, 1, 0],
  ['engine', -1, -1, 0],
  ['engine', 0, 2, 3],
  ['engine', 0, -2, 1],
  ['engine', 1, 2, 2],
  ['engine', 1, -2, 2],
];

/** Every promotion adds +6 pts to the ship (nozzles stay clear). */
const PROMOTIONS: readonly (readonly Entry[])[] = [
  [
    ['armor', 3, 0],
    ['cannon', 3, 1],
    ['cannon', 3, -1],
    ['armor', -1, 2],
    ['armor', -1, -2],
    ['reactor', 1, 3],
  ],
  [
    ['armor', 4, 0],
    ['armor', 3, 2],
    ['armor', 3, -2],
    ['shield', 1, -3],
    ['gyro', -1, 3],
    ['armor', 2, 3],
  ],
  [
    ['cannon', 4, 1],
    ['cannon', 4, -1],
    ['armor', 2, -3],
    ['armor', -2, 2],
    ['armor', -2, -2],
    ['reactor', -1, -3],
  ],
  [
    ['armor', 5, 0],
    ['armor', 4, 2],
    ['armor', 4, -2],
    ['shield', -2, 3],
    ['armor', -1, -4],
    ['armor', -3, 2],
  ],
];

/** The captain's ship for a given level (1–5); from level 3 built from T2 parts. */
export function captainGrid(level: number): ShipGrid {
  const lvl = Math.max(1, Math.min(CAPTAIN_MAX_LEVEL, level));
  const tier: Tier = lvl >= CAPTAIN_T2_LEVEL ? 2 : 1;
  const entries = [...BASE, ...PROMOTIONS.slice(0, lvl - 1).flat()];
  return createGrid(entries.map(([id, x, y, rot]) => [id, x, y, rot ?? 0, tier]));
}

export const captainEnemyId = (index: number): string => `${CAPTAIN_PREFIX}${index}`;

/** Captain index from an enemy id, or null. */
export function captainIndexOf(enemyId: string): number | null {
  if (!enemyId.startsWith(CAPTAIN_PREFIX)) return null;
  const n = Number(enemyId.slice(CAPTAIN_PREFIX.length));
  return Number.isInteger(n) && n >= 0 && n < CAPTAIN_COUNT ? n : null;
}

/** The captain as a combat enemy (Hammer AI), patrolling around `pos`. */
export function createCaptainEnemy(index: number, level: number, pos: Vec2, angle: number): Enemy {
  const grid = captainGrid(level);
  const props = computeProperties(grid);
  const body = createBody(pos, angle);
  return {
    id: captainEnemyId(index),
    kind: 'hammer',
    home: { ...pos },
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
    fuel: spawnFuel(captainEnemyId(index), props.fuelCapacity),
    ai: { mode: 'patrol', waypoint: { ...pos }, timer: 0, orbit: index % 2 === 0 ? 1 : -1, breakOff: 0, react: 0, seen: { x: 0, y: 0 } },
  };
}
