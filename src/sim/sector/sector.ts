// Local conditions (long-term design 8.4, sectors design §6.3): rotating modifiers of a sector – a
// pure function of the seed, the sector (region id) and the game time. Since sectors stage 1b they are
// keyed by (sector id, epoch) instead of a 5 × 5 chunk block, the sector depth replaces the ring of the
// modifier tables, and hunting grounds / clan war come only to Contested and Pirate sectors. Nothing
// here is saved (the demand cap is saved per station and epoch), so the change keeps saves valid.
// Ion storms keep their own 5 × 5 chunk areas (`areaOf`, discovery/events.ts).
import type { RingIndex } from '../../data/economy';
import { RESOURCE_IDS, type ResourceId } from '../../data/resources';
import {
  ACTIVE_SECTOR_MODIFIERS,
  NEUTRAL_EFFECTS,
  SECTOR_AREA_CHUNKS,
  SECTOR_COUNT_WEIGHTS,
  SECTOR_EPOCH_TICKS,
  SECTOR_MODIFIERS,
  type SectorEffects,
  type SectorModifierId,
} from '../../data/sector';
import { TAU } from '../math/angle';
import { createRng, type Rng } from '../math/rng';
import type { Vec2 } from '../math/vec2';
import { isDangerousSecurity, sectorIdAt, sectorInfo } from '../regions/sectors';
import { cometSectorsInEpoch } from '../sites/comets';
import { convoySectorsInEpoch } from '../convoys/schedule';
import { CHUNK_SIZE } from '../world/chunks';
import { fnv1a32 } from '../math/fnv1a';
import { hash3 } from '../world/hash';
import { RINGS } from '../world/rings';

const SECTOR_SALT = 0x5ec7_02a1;
const AREA_SIZE = SECTOR_AREA_CHUNKS * CHUNK_SIZE;

/** A 5 × 5 chunk block – only the ion storms use it now. */
export interface SectorArea {
  ax: number;
  ay: number;
}

export interface ActiveModifier {
  id: SectorModifierId;
  /** Demanded resource (only `demand`). */
  resource?: ResourceId;
  /** Direction of the current in radians (only `currents`). */
  angle?: number;
}

export interface SectorState {
  /** Sector (region) id. */
  region: string;
  epoch: number;
  modifiers: ActiveModifier[];
}

export const areaOf = (pos: Vec2): SectorArea => ({ ax: areaCoord(pos.x), ay: areaCoord(pos.y) });
/** One coordinate of `areaOf` (no object). */
export const areaCoord = (v: number): number => Math.floor(v / AREA_SIZE);
export const areaCenter = (ax: number, ay: number): Vec2 => ({ x: (ax + 0.5) * AREA_SIZE, y: (ay + 0.5) * AREA_SIZE });
export const areaKey = (a: SectorArea): string => `${a.ax},${a.ay}`;
export const sectorEpoch = (tick: number): number => Math.floor(tick / SECTOR_EPOCH_TICKS);
/** Game step of the next change of the local conditions. */
export const nextSectorChange = (tick: number): number => (sectorEpoch(tick) + 1) * SECTOR_EPOCH_TICKS;

const cache = new Map<string, SectorState>();
const CACHE_MAX = 2048;
/**
 * The answers of the last (seed, epoch) by sector id: the hot path (every ship asks every step) without a
 * key string per call (perf audit 2026-10-17, P4). Same objects as `cache`.
 */
let hotSeed = NaN;
let hotEpoch = NaN;
const hot = new Map<string, SectorState>();

/** Modifiers that need a dangerous sector (Contested or Pirate, §6.3). */
const DANGEROUS_ONLY: ReadonlySet<SectorModifierId> = new Set(['huntingGrounds', 'pirateWar']);

function pick(rng: Rng, ids: readonly SectorModifierId[]): SectorModifierId | null {
  let total = 0;
  for (const id of ids) total += SECTOR_MODIFIERS[id].weight;
  if (total <= 0) return null;
  let r = rng() * total;
  for (const id of ids) {
    r -= SECTOR_MODIFIERS[id].weight;
    if (r < 0) return id;
  }
  return ids[ids.length - 1] ?? null;
}

/** Resources mined in a ring (a demand for them makes sense). */
function ringResources(ring: RingIndex): ResourceId[] {
  const weights = RINGS[ring - 1]!.weights;
  return RESOURCE_IDS.filter((r) => (weights[r] ?? 0) > 0);
}

/**
 * Modifiers of a sector in an epoch (0–2 rolled, at most 1 warning and 1 market) plus the derived
 * `cometFlyby` when a comet pass crosses the sector in the epoch (M4b) and the derived `convoy` when a
 * convoy pass does (M4d). The first epoch is calm.
 * The sector's depth picks the modifier table (as the ring did); its static security decides the
 * dangerous-only modifiers (a fallen fortress keeps its sector dangerous – Pirate becomes Contested).
 */
export function sectorState(seed: number, region: string, epoch: number): SectorState {
  if (seed === hotSeed && epoch === hotEpoch) {
    const h = hot.get(region);
    if (h) return h;
  } else {
    hot.clear();
    hotSeed = seed;
    hotEpoch = epoch;
  }
  const s = sectorStateOf(seed, region, epoch);
  if (hot.size >= CACHE_MAX) hot.clear();
  hot.set(region, s);
  return s;
}

function sectorStateOf(seed: number, region: string, epoch: number): SectorState {
  const key = `${seed}|${region}|${epoch}`;
  const cached = cache.get(key);
  if (cached) return cached;
  if (cache.size >= CACHE_MAX) cache.clear();

  const state: SectorState = { region, epoch, modifiers: [] };
  const info = sectorInfo(seed, region);
  if (epoch > 0 && info) {
    const rng = createRng(hash3(hash3(seed ^ SECTOR_SALT, fnv1a32(region), 0), epoch, 0));
    // every roll is always made, in the same order
    const countRoll = rng();
    const rolls = [rng(), rng()];
    const extra = [rng(), rng()];
    const ring = Math.min(RINGS.length, info.depth) as RingIndex;
    const dangerous = isDangerousSecurity(info.security);
    const count = countRoll < SECTOR_COUNT_WEIGHTS[0] ? 0 : countRoll < SECTOR_COUNT_WEIGHTS[0] + SECTOR_COUNT_WEIGHTS[1] ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const taken = state.modifiers.map((m) => SECTOR_MODIFIERS[m.id].kind);
      const options = ACTIVE_SECTOR_MODIFIERS.filter((id) => {
        const def = SECTOR_MODIFIERS[id];
        if (!def.rings.includes(ring)) return false;
        if (DANGEROUS_ONLY.has(id) && !dangerous) return false;
        if (state.modifiers.some((m) => m.id === id)) return false;
        return !((def.kind === 'warning' || def.kind === 'market') && taken.includes(def.kind));
      });
      const id = pick(createRng(Math.floor(rolls[i]! * 0xffff_ffff)), options);
      if (!id) break;
      const mod: ActiveModifier = { id };
      if (id === 'demand') {
        const res = ringResources(ring);
        mod.resource = res[Math.min(res.length - 1, Math.floor(extra[i]! * res.length))]!;
      } else if (id === 'currents') {
        mod.angle = extra[i]! * TAU;
      }
      state.modifiers.push(mod);
    }
  }
  // derived (M4b): a comet pass crosses the sector in this epoch – on top of the rolled ones, never rolled
  // (the first epoch stays calm)
  if (epoch > 0 && info && cometSectorsInEpoch(seed, epoch).has(region)) state.modifiers.push({ id: 'cometFlyby' });
  // derived (M4d): a convoy pass crosses the sector in this epoch (convoys/schedule.ts)
  if (epoch > 0 && info && convoySectorsInEpoch(seed, epoch).has(region)) state.modifiers.push({ id: 'convoy' });
  cache.set(key, state);
  return state;
}

/** The local conditions of the sector a point lies in, now. */
export function sectorAt(seed: number, pos: Vec2, tick: number): SectorState {
  return sectorState(seed, sectorIdAt(seed, pos.x, pos.y), sectorEpoch(tick));
}

/** `sectorEffects` per (cached, never changed) sector state: read-only answers, like NEUTRAL_EFFECTS. */
const effectsCache = new WeakMap<SectorState, SectorEffects>();

/** Combined effects of the modifiers (multipliers multiply, currents add up). Read-only (shared). */
export function sectorEffects(state: SectorState): SectorEffects {
  if (state.modifiers.length === 0) return NEUTRAL_EFFECTS;
  let out = effectsCache.get(state);
  if (!out) {
    out = combinedEffects(state);
    effectsCache.set(state, out);
  }
  return out;
}

function combinedEffects(state: SectorState): SectorEffects {
  const out = { ...NEUTRAL_EFFECTS };
  for (const m of state.modifiers) {
    const e = SECTOR_MODIFIERS[m.id].effects;
    out.pirateMult *= e.pirateMult ?? 1;
    out.veinYieldMult *= e.veinYieldMult ?? 1;
    out.energyGenMult *= e.energyGenMult ?? 1;
    out.fuelUseMult *= e.fuelUseMult ?? 1;
    out.fuelPriceMult *= e.fuelPriceMult ?? 1;
    out.radarMult *= e.radarMult ?? 1;
    out.drift += e.drift ?? 0;
    out.ionStormMult *= e.ionStormMult ?? 1;
    out.attentionMult *= e.attentionMult ?? 1;
  }
  return out;
}

/** Contract reward bonus of the sector (sum of the warning bonuses). */
export const sectorBonus = (state: SectorState): number =>
  state.modifiers.reduce((sum, m) => sum + SECTOR_MODIFIERS[m.id].bonus, 0);

/** Demand of the sector (a resource with a sale premium), or null. */
export const demandOf = (state: SectorState): ResourceId | null => state.modifiers.find((m) => m.id === 'demand')?.resource ?? null;

/** Acceleration of the current (vector), or null. */
export function driftOf(state: SectorState): Vec2 | null {
  const m = state.modifiers.find((x) => x.id === 'currents');
  if (!m || m.angle === undefined) return null;
  const a = SECTOR_MODIFIERS.currents.effects.drift ?? 0;
  return { x: Math.cos(m.angle) * a, y: Math.sin(m.angle) * a };
}
