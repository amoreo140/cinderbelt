import { add, hypot, rotate, type Vec2 } from '../math/vec2';
import { initialVeinState, type VeinState } from '../mining/veins';
import type { Circle } from '../physics/collide';
import { crackFragments } from './fragments';
import { chunkCoord, chunkKey, generateChunk, type Asteroid, type ChunkData, type ChunkGenerator } from './generate';
import { HOME_STATION_ID, type StationDef, type StationId } from './stations';
import { WORLD_GEN_LEGACY, type WorldGen } from './worldGen';

/** An asteroid with its cached circle for collisions and mining (the circle shrinks as it is mined). */
export interface AsteroidCircle {
  asteroid: Asteroid;
  circle: Circle;
}

/** How many chunks around the player are active (2 → 5×5). */
export const ACTIVE_RADIUS = 2;
/** How many chunks around the player are marked explored. */
export const EXPLORE_RADIUS = 1;

export class World {
  /** Remaining amount of changed asteroids – the delta against generation (saved). */
  readonly remainingById = new Map<string, number>();
  readonly explored = new Set<string>();
  /**
   * Chunks added to `explored` since the pirate step last looked (it clears the list every step):
   * lets it react to a first contact – a Pirate sector's first explored chunk. Not saved.
   */
  newlyExplored: string[] = [];
  /** Discovered stations (a station is discovered when its chunk is explored). Home is always known. */
  readonly discovered = new Set<StationId>([HOME_STATION_ID]);
  /** Vein state of mined asteroids (delta against the initial state from the id – saved). */
  readonly veins = new Map<string, VeinState>();
  /** Cracked ice: parent id → amount left at the crack (the fragments derive from it; saved). */
  readonly cracked = new Map<string, number>();
  private readonly active = new Map<string, ChunkData>();
  /** Asteroids of the active chunks: generated + fragments of cracked ice (in a fixed order). */
  private readonly lists = new Map<string, Asteroid[]>();
  /** Circles of the unmined asteroids in the active chunks by id. */
  private readonly circles = new Map<string, Circle>();
  /** Largest radius of a loaded asteroid – the chunk query widens by it. */
  private maxRadius = 0;
  private cache: Asteroid[] | null = null;
  private stationCache: StationDef[] | null = null;
  /** Collision circles of the stations in the active chunks, in world coordinates (layout + extras). */
  private readonly stationCircles = new Map<StationId, Circle[]>();
  /**
   * Extra collision circles of a station in its own frame (unrotated, like `StationDef.colliders`):
   * the home modules (M4c). Kept across chunk loads; not saved – the simulation sets them on build and
   * on restore.
   */
  private readonly stationExtras = new Map<StationId, readonly Circle[]>();
  /** How far the extras of a station reach from its centre (the near query widens by it). */
  private readonly stationExtraReach = new Map<StationId, number>();
  private centerKey: string | null = null;
  private centerChunk: { cx: number; cy: number } | null = null;

  constructor(
    readonly seed: number,
    private readonly generator: ChunkGenerator = generateChunk,
    /** World generation rules of this game (saved since V14; worldGen.ts). */
    readonly gen: WorldGen = WORLD_GEN_LEGACY,
  ) {}

  /** Loads the chunks around `center`; returns the newly discovered stations. */
  update(center: Vec2): StationId[] {
    const pcx = chunkCoord(center.x);
    const pcy = chunkCoord(center.y);
    const key = chunkKey(pcx, pcy);
    if (key === this.centerKey) return [];
    this.centerKey = key;
    this.centerChunk = { cx: pcx, cy: pcy };

    const wanted = new Set<string>();
    for (let dx = -ACTIVE_RADIUS; dx <= ACTIVE_RADIUS; dx++) {
      for (let dy = -ACTIVE_RADIUS; dy <= ACTIVE_RADIUS; dy++) {
        const k = chunkKey(pcx + dx, pcy + dy);
        wanted.add(k);
        if (!this.active.has(k)) this.load(k, this.generator(this.seed, pcx + dx, pcy + dy, this.gen));
      }
    }
    for (const [k, chunk] of [...this.active]) {
      if (wanted.has(k)) continue;
      this.active.delete(k);
      for (const a of this.lists.get(k) ?? []) this.circles.delete(a.id);
      this.lists.delete(k);
      if (chunk.station) this.stationCircles.delete(chunk.station.id);
    }
    this.cache = null;
    this.stationCache = null;

    // explored chunks lie inside the active ones, so their station is known
    const found: StationId[] = [];
    for (let dx = -EXPLORE_RADIUS; dx <= EXPLORE_RADIUS; dx++) {
      for (let dy = -EXPLORE_RADIUS; dy <= EXPLORE_RADIUS; dy++) {
        const k = chunkKey(pcx + dx, pcy + dy);
        if (!this.explored.has(k)) this.newlyExplored.push(k);
        this.explored.add(k);
        const station = this.active.get(k)?.station;
        if (station && !this.discovered.has(station.id)) {
          this.discovered.add(station.id);
          found.push(station.id);
        }
      }
    }
    return found;
  }

  /** Stations in the active chunks. */
  stations(): StationDef[] {
    if (!this.stationCache) {
      this.stationCache = [];
      for (const chunk of this.active.values()) if (chunk.station) this.stationCache.push(chunk.station);
    }
    return this.stationCache;
  }

  /** The chunk's generated asteroids followed by the fragments of the cracked ones (the order does not depend on the order of cracking). */
  private chunkList(chunk: ChunkData): Asteroid[] {
    const list = [...chunk.asteroids];
    for (const a of chunk.asteroids) {
      const amount = this.cracked.get(a.id);
      if (amount !== undefined) list.push(...crackFragments(a, amount));
    }
    return list;
  }

  private addCircle(a: Asteroid): void {
    const radius = this.radiusOf(a);
    if (radius <= 0) return;
    this.circles.set(a.id, { pos: a.pos, radius });
    this.maxRadius = Math.max(this.maxRadius, a.baseRadius);
  }

  private load(key: string, chunk: ChunkData): void {
    this.active.set(key, chunk);
    const list = this.chunkList(chunk);
    this.lists.set(key, list);
    if (chunk.station) this.placeStationCircles(chunk.station);
    for (const a of list) this.addCircle(a);
  }

  /** World circles of a loaded station: its layout, then its extras, rotated by the port angle. */
  private placeStationCircles(station: StationDef): void {
    const local = [...station.colliders, ...(this.stationExtras.get(station.id) ?? [])];
    this.stationCircles.set(
      station.id,
      local.map((c) => ({ pos: add(station.pos, rotate(c.pos, station.portAngle)), radius: c.radius })),
    );
  }

  /**
   * Sets (replaces) the extra collision circles of station `id`, in the station's frame (unrotated,
   * like `StationDef.colliders`) – the built home modules (M4c). Idempotent; an empty list removes them.
   * Works whether the station's chunk is loaded or not (a later load adds them).
   */
  setStationExtraColliders(id: StationId, circles: readonly Circle[]): void {
    if (circles.length === 0) {
      this.stationExtras.delete(id);
      this.stationExtraReach.delete(id);
    } else {
      this.stationExtras.set(id, circles.map((c) => ({ pos: { ...c.pos }, radius: c.radius })));
      this.stationExtraReach.set(id, Math.max(...circles.map((c) => hypot(c.pos.x, c.pos.y) + c.radius)));
    }
    const station = this.stations().find((s) => s.id === id);
    if (station) this.placeStationCircles(station);
  }

  /**
   * Unmined asteroids whose circle reaches into the square centred on `pos` with half side `radius`.
   * Walks only the chunks the square overlaps.
   */
  circlesNear(pos: Vec2, radius: number): AsteroidCircle[] {
    const result: AsteroidCircle[] = [];
    const reach = radius + this.maxRadius;
    const x0 = chunkCoord(pos.x - reach);
    const x1 = chunkCoord(pos.x + reach);
    const y0 = chunkCoord(pos.y - reach);
    const y1 = chunkCoord(pos.y + reach);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const list = this.lists.get(chunkKey(cx, cy));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const asteroid = list[i]!;
          const circle = this.circles.get(asteroid.id);
          if (!circle) continue;
          const r = radius + circle.radius;
          if (Math.abs(circle.pos.x - pos.x) > r || Math.abs(circle.pos.y - pos.y) > r) continue;
          result.push({ asteroid, circle });
        }
      }
    }
    return result;
  }

  /**
   * The circles of `circlesNear` (same order) appended to `out` – no wrapper object per asteroid (the
   * per-step obstacle lists, perf audit 2026-10-17 P4). Returns `out`.
   */
  circlesInto(pos: Vec2, radius: number, out: Circle[]): Circle[] {
    const reach = radius + this.maxRadius;
    const x0 = chunkCoord(pos.x - reach);
    const x1 = chunkCoord(pos.x + reach);
    const y0 = chunkCoord(pos.y - reach);
    const y1 = chunkCoord(pos.y + reach);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const list = this.lists.get(chunkKey(cx, cy));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const circle = this.circles.get(list[i]!.id);
          if (!circle) continue;
          const r = radius + circle.radius;
          if (Math.abs(circle.pos.x - pos.x) > r || Math.abs(circle.pos.y - pos.y) > r) continue;
          out.push(circle);
        }
      }
    }
    return out;
  }

  /** Collision circles of the stations whose hull reaches into the circle (pos, radius). */
  stationCirclesNear(pos: Vec2, radius: number): Circle[] {
    return this.stationCirclesInto(pos, radius, []);
  }

  /** `stationCirclesNear` appended to `out` (same order). Returns `out`. */
  stationCirclesInto(pos: Vec2, radius: number, out: Circle[]): Circle[] {
    const stations = this.stations();
    for (let i = 0; i < stations.length; i++) {
      const station = stations[i]!;
      const reach = radius + Math.max(station.radius, this.stationExtraReach.get(station.id) ?? 0) + 1;
      const dx = station.pos.x - pos.x;
      const dy = station.pos.y - pos.y;
      if (dx * dx + dy * dy > reach * reach) continue;
      const circles = this.stationCircles.get(station.id);
      if (circles) for (let k = 0; k < circles.length; k++) out.push(circles[k]!);
    }
    return out;
  }

  /** The chunk the active chunks are loaded around (null before the first `update`). */
  center(): { cx: number; cy: number } | null {
    return this.centerChunk ? { ...this.centerChunk } : null;
  }

  get activeChunkCount(): number {
    return this.active.size;
  }

  /** Every unmined asteroid in the active chunks. */
  asteroids(): Asteroid[] {
    if (!this.cache) {
      this.cache = [];
      for (const list of this.lists.values()) {
        for (const a of list) if (this.remaining(a) > 0) this.cache.push(a);
      }
    }
    return this.cache;
  }

  /** An asteroid of the active chunks by id (also a mined-out one – e.g. for the break-up effect), or null. */
  findAsteroid(id: string): Asteroid | null {
    for (const list of this.lists.values()) {
      const a = list.find((x) => x.id === id);
      if (a) return a;
    }
    return null;
  }

  /** Vein state of an asteroid (saved, or the initial one from the id). Do not mutate – use `mutableVeinState`. */
  veinState(a: Asteroid): VeinState {
    return this.veins.get(a.id) ?? initialVeinState(a);
  }

  /** Vein state to modify (stored in the delta on the first change). */
  mutableVeinState(a: Asteroid): VeinState {
    let state = this.veins.get(a.id);
    if (!state) {
      state = initialVeinState(a);
      this.veins.set(a.id, state);
    }
    return state;
  }

  /**
   * Cracking ice: the parent disappears and fragments (derived from what was left) appear in its chunk.
   * Returns the new fragments (an empty array when the asteroid is not in the active chunks).
   */
  crack(a: Asteroid): Asteroid[] {
    const amount = this.remaining(a);
    let key: string | null = null;
    for (const [k, list] of this.lists) if (list.some((x) => x.id === a.id)) key = k;
    const chunk = key === null ? undefined : this.active.get(key);
    if (key === null || !chunk || amount <= 0) return [];
    this.cracked.set(a.id, amount);
    this.remainingById.set(a.id, 0);
    this.circles.delete(a.id);
    const list = this.chunkList(chunk);
    this.lists.set(key, list);
    const fragments = list.filter((x) => x.id.startsWith(`${a.id}~`));
    for (const f of fragments) this.addCircle(f);
    this.cache = null;
    return fragments;
  }

  remaining(a: Asteroid): number {
    return this.remainingById.get(a.id) ?? a.initialAmount;
  }

  /** An asteroid shrinks as it is mined, but until it is gone it keeps at least 35 % of its size. */
  radiusOf(a: Asteroid): number {
    const left = this.remaining(a);
    if (left <= 0) return 0;
    return a.baseRadius * Math.max(0.35, Math.sqrt(left / a.initialAmount));
  }

  /** Takes up to `amount` units, returns the amount really mined. */
  extract(a: Asteroid, amount: number): number {
    const left = this.remaining(a);
    const taken = Math.min(Math.max(0, amount), left);
    if (taken <= 0) return 0;
    let rest = left - taken;
    if (rest < 1e-6) rest = 0;
    this.remainingById.set(a.id, rest);
    const circle = this.circles.get(a.id);
    if (circle) circle.radius = this.radiusOf(a);
    if (rest === 0) {
      this.circles.delete(a.id);
      this.cache = null;
    }
    return taken;
  }
}
