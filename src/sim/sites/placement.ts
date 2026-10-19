// Placement of derelict stations and ship graveyards (M4b plan §2.1, §2.4, §2.5) – OWNED BY T3.
//
// Rules (binding): the sites come from their own stream `hash3(seed ^ SITE_SALT, cx, cy)` (data/sites.ts)
// and never move or remove anything existing; placement reads the depth and the STATIC security of the
// chunk's sector (`sectorInfoOfChunk`, never `currentSecurity`); 0 in statically Guarded sectors and
// within `SITES.homeClear` of home; up to `SITES.candidates` candidate positions, each rejected when too
// close to a station's clear circle, any POI of the chunk and its 8 neighbours, an asteroid, a fortress
// (and its clan beacon), a landmark, an Echo site, a survey point, a lane's guild_relay landmark
// (`SITES.guildRelayClear`, keeps the M4d Guild relay site free) or another site; else the site is
// skipped. Results are memoised per chunk like `poisInChunk`.
//
// The stream: every number of a chunk is always drawn, in a fixed order (derelict block, then graveyard
// block), whatever the depth, security or outcome – a retune of a density or a rejection rule never
// shifts another roll.
//
// Footprints: a derelict is its layout's clear circle plus the clear circle of each of its three relays
// (the relays move with the candidate). A graveyard is its 200 u field: the field keeps clear of
// stations, fortresses, landmarks, Echo sites, survey points and other sites; inside the field the
// asteroids and the POIs stay where they are (a graveyard in an asteroid field is a graveyard among
// rocks) – only its centre (`GRAVEYARD_CORE`) and its live mines keep clear of rocks and POIs. A field of
// 200 u free of every rock would almost never exist (≈ 1.6 clusters per chunk) and the density of the
// table could not be met.
//
// Overlap of sites of different chunks: every chunk first places its sites alone ("raw"); a raw site
// survives when no raw site of a nearby chunk with a lower priority (its roll ÷ density – uniform in
// [0, 1)) overlaps it. Pure and order-independent, like the station spacing.
import { DERELICT_LAYOUTS, DERELICT_MODELS, GRAVEYARD, MINE, RELAY, RELAY_LAYOUT, SITE_SALT, SITES, type DerelictModel } from '../../data/sites';
import { ECHO_RADIUS } from '../../data/echoes';
import type { EnemyKind } from '../combat/types';
import { echoSites, poiRadius, poisInChunk } from '../discovery/poi';
import { TAU } from '../math/angle';
import { createRng, type Rng } from '../math/rng';
import { add, hypot, rotate, type Vec2 } from '../math/vec2';
import { FORTRESS_LAYOUT, fortressSites } from '../pirates/sites';
import { guildRelayById, guildRelayCandidates } from '../guild/relaySites';
import { sectorInfoOfChunk, surveyPointsNear, type Depth } from '../regions';
import type { SimState } from '../Simulation';
import { CHUNK_SIZE, chunkCoord } from '../world/chunks';
import { ChunkMemo } from '../world/chunkMemo';
import { generateChunk } from '../world/generate';
import { hash3 } from '../world/hash';
import { landmarkSites } from '../world/landmarks';
import { seedKey, stationsInArea } from '../world/stations';
import { WORLD_GENS } from '../world/worldGen';
import type { DerelictDefence, DerelictService, DerelictSite, GraveyardSite, RelaySite, Site } from './types';

// ---------------------------------------------------------------------------
// placement constants of this module (the tunable numbers live in data/sites.ts)

/** Clear circle kept around a landmark (they hang below the plane; their silhouettes cover ~150 u). */
const LANDMARK_CLEAR = 150;
/** Clear circle kept around an Echo site (its beacon and the light column). */
const ECHO_CLEAR = ECHO_RADIUS + 60;
/** Clear circle of a fortress's clan beacon (its own placement keeps 12 u). */
const BEACON_CLEAR = 12;
/** A graveyard's centre keeps this clear of rocks and POIs (the field itself may hold rocks). */
export const GRAVEYARD_CORE = 30;
/** Live mines lie in this band of distances from the graveyard's centre (u). */
export const GRAVEYARD_MINE_BAND: readonly [number, number] = [40, GRAVEYARD.radius - 25];
/** Mines keep this far from each other and (plus the rock's radius) from rocks and POIs. */
const MINE_SPACING = 30;
const MINE_CLEAR = MINE.armRange;
/** Turns of a derelict's layout tried at one candidate position when a relay does not fit there. */
const DERELICT_TURNS: readonly number[] = [0, Math.PI / 3, -Math.PI / 3];
/** Positions drawn per mine (the first that fits is taken; none fits = the mine is left out). */
const MINE_TRIES = 3;
/** Most mines a graveyard can have (the stream always draws this many). */
const MINES_MAX = Math.max(...Object.values(GRAVEYARD.mines).map((m) => m[1]));

/** Farthest point of a derelict's structure (layout + relays) from its centre. */
export const DERELICT_EXTENT =
  RELAY.distance[1] + Math.max(...RELAY_LAYOUT.circles.map((c) => hypot(c.x, c.y) + c.r));
/** How far a site reaches from its centre: the graveyard's field, the derelict's farthest relay clear circle. */
function reachOf(s: Site): number {
  if (s.kind === 'graveyard') return GRAVEYARD.radius;
  let r = DERELICT_LAYOUTS[s.model].clearRadius;
  for (const relay of s.relays) r = Math.max(r, hypot(relay.pos.x - s.pos.x, relay.pos.y - s.pos.y) + RELAY_LAYOUT.clearRadius);
  return r;
}

/** The clear circles of a site: the graveyard's field; the derelict's own and its relays'. */
const circlesOf = (s: Site): Blocker[] =>
  s.kind === 'graveyard'
    ? [{ pos: s.pos, r: GRAVEYARD.radius }]
    : [{ pos: s.pos, r: DERELICT_LAYOUTS[s.model].clearRadius }, ...s.relays.map((r) => ({ pos: r.pos, r: RELAY_LAYOUT.clearRadius }))];

/**
 * Two sites overlap: two derelicts when their reaches meet (the relays of two stations never mingle);
 * otherwise when any clear circles meet (a derelict may stand at the edge of a graveyard's field).
 */
function overlap(a: Site, b: Site): boolean {
  const d = hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
  if (d >= reachOf(a) + reachOf(b) + SITES.margin) return false;
  if (a.kind === 'derelict' && b.kind === 'derelict') return true;
  const cb = circlesOf(b);
  return circlesOf(a).some((p) => cb.some((q) => hypot(p.pos.x - q.pos.x, p.pos.y - q.pos.y) < p.r + q.r + SITES.margin));
}
/** The largest footprint of any site – how far a site can reach beyond its chunk. */
const MAX_FOOTPRINT = Math.max(GRAVEYARD.radius, RELAY.distance[1] + RELAY_LAYOUT.clearRadius);
/** Chunks around a chunk whose raw sites can overlap its own (two footprints + margin, in chunks). */
const CONFLICT_CHUNKS = Math.ceil((2 * MAX_FOOTPRINT + SITES.margin) / CHUNK_SIZE);

// ---------------------------------------------------------------------------
// ids

export const derelictId = (cx: number, cy: number): string => `dl:${cx},${cy}`;
export const graveyardId = (cx: number, cy: number): string => `gy:${cx},${cy}`;
export const relayId = (cx: number, cy: number, i: number): string => `dl:${cx},${cy}:r${i}`;

const SITE_ID = /^(dl|gy):(-?\d+),(-?\d+)$/;
const RELAY_ID = /^dl:(-?\d+),(-?\d+):r(\d+)$/;

// ---------------------------------------------------------------------------
// the stream of a chunk (always drawn in full, fixed order)

interface DerelictDraw {
  roll: number;
  tries: Vec2[];
  model: number;
  angle: number;
  relays: { jitter: number; distance: number }[];
  defence: number;
  service: number;
}

interface GraveyardDraw {
  roll: number;
  tries: Vec2[];
  wrecks: number;
  mines: number;
  mineSpots: { angle: number; r: number }[];
  sleepers: number;
}

const drawTries = (rng: Rng, cx: number, cy: number): Vec2[] =>
  Array.from({ length: SITES.candidates }, () => ({
    x: cx * CHUNK_SIZE + SITES.chunkMargin + rng() * (CHUNK_SIZE - 2 * SITES.chunkMargin),
    y: cy * CHUNK_SIZE + SITES.chunkMargin + rng() * (CHUNK_SIZE - 2 * SITES.chunkMargin),
  }));

function drawChunk(seed: number, cx: number, cy: number): { derelict: DerelictDraw; graveyard: GraveyardDraw } {
  const rng = createRng(hash3(seed ^ SITE_SALT, cx, cy));
  const derelict: DerelictDraw = {
    roll: rng(),
    tries: drawTries(rng, cx, cy),
    model: rng(),
    angle: rng(),
    relays: Array.from({ length: RELAY.count }, () => ({ jitter: rng(), distance: rng() })),
    defence: rng(),
    service: rng(),
  };
  const graveyard: GraveyardDraw = {
    roll: rng(),
    tries: drawTries(rng, cx, cy),
    wrecks: rng(),
    mines: rng(),
    mineSpots: Array.from({ length: MINES_MAX * MINE_TRIES }, () => ({ angle: rng(), r: rng() })),
    sleepers: rng(),
  };
  return { derelict, graveyard };
}

/** Picks a key by cumulative weights from one uniform number. */
function pick<K extends string>(u: number, weights: Readonly<Record<K, number>>): K {
  const keys = Object.keys(weights) as K[];
  let total = 0;
  for (const k of keys) total += weights[k];
  let r = u * total;
  for (const k of keys) {
    r -= weights[k];
    if (r < 0) return k;
  }
  return keys[keys.length - 1]!;
}

// ---------------------------------------------------------------------------
// what a site must keep clear of (lazy per chunk – most chunks never roll a site)

interface Blocker {
  pos: Vec2;
  /** The blocker's own radius (its clear circle). */
  r: number;
}

class Surroundings {
  private stationList: Blocker[] | null = null;
  private poiList: Blocker[] | null = null;
  private rockList: Blocker[] | null = null;
  private fixedList: Blocker[] | null = null;

  constructor(
    private readonly seed: number,
    private readonly cx: number,
    private readonly cy: number,
  ) {}

  /** Stations of both world generations (positions are the same, clear circles may differ – the larger counts). */
  get stations(): Blocker[] {
    if (this.stationList) return this.stationList;
    const byId = new Map<string, Blocker>();
    const reach = Math.ceil((MAX_FOOTPRINT + SITES.margin + 150) / CHUNK_SIZE);
    for (const gen of WORLD_GENS) {
      for (const s of stationsInArea(this.seed, this.cx - reach, this.cx + reach, this.cy - reach, this.cy + reach, gen)) {
        const known = byId.get(s.id);
        if (!known || known.r < s.clearRadius) byId.set(s.id, { pos: s.pos, r: s.clearRadius });
      }
    }
    return (this.stationList = [...byId.values()]);
  }

  /** POIs of the chunk and its 8 neighbours. */
  get pois(): Blocker[] {
    if (this.poiList) return this.poiList;
    const out: Blocker[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const p of poisInChunk(this.seed, this.cx + dx, this.cy + dy)) out.push({ pos: p.pos, r: poiRadius(p) });
    return (this.poiList = out);
  }

  /** Asteroids of the chunk and its 8 neighbours, of both world generations (they differ only near stations). */
  get rocks(): Blocker[] {
    if (this.rockList) return this.rockList;
    const byId = new Map<string, Blocker>();
    for (const gen of WORLD_GENS) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const a of generateChunk(this.seed, this.cx + dx, this.cy + dy, gen).asteroids) byId.set(`${a.id}@${a.pos.x},${a.pos.y}`, { pos: a.pos, r: a.baseRadius });
        }
      }
    }
    return (this.rockList = [...byId.values()]);
  }

  /** Fortresses (clear radius + `SITES.fortressMargin`), their clan beacons, landmarks and Echo sites. */
  get fixed(): Blocker[] {
    if (this.fixedList) return this.fixedList;
    const out: Blocker[] = [];
    for (const f of fortressSites(this.seed)) {
      out.push({ pos: f.pos, r: FORTRESS_LAYOUT.clearRadius + SITES.fortressMargin - SITES.margin });
      out.push({ pos: f.beacon.pos, r: BEACON_CLEAR });
    }
    for (const l of landmarkSites(this.seed)) {
      out.push({ pos: l.pos, r: LANDMARK_CLEAR });
      // the lane's relay mast: the M4d Guild relay goes there – no site within guildRelayClear
      if (l.kind === 'guild_relay') out.push({ pos: l.pos, r: SITES.guildRelayClear - SITES.margin });
    }
    for (const e of echoSites(this.seed)) out.push({ pos: e.pos, r: ECHO_CLEAR });
    return (this.fixedList = out);
  }
}

const clearOf = (pos: Vec2, r: number, list: readonly Blocker[], margin: number = SITES.margin): boolean =>
  list.every((b) => hypot(b.pos.x - pos.x, b.pos.y - pos.y) >= b.r + r + margin);

/**
 * A circle of radius r at pos keeps clear of home, stations, fortresses, landmarks and Echo sites (by
 * `SITES.margin`) and of survey points (within `surveyR` + margin).
 */
function clearOfFixed(seed: number, around: Surroundings, pos: Vec2, r: number, surveyR: number = r): boolean {
  if (hypot(pos.x, pos.y) < SITES.homeClear + r) return false;
  if (!clearOf(pos, r, around.stations) || !clearOf(pos, r, around.fixed)) return false;
  return surveyPointsNear(seed, pos, surveyR + SITES.margin).length === 0;
}

// ---------------------------------------------------------------------------
// options of one chunk: every candidate position that fits the world (other sites not considered yet)

interface Options<S extends Site> {
  /** Roll ÷ density, uniform in [0, 1): the lower one wins an overlap of two sites. */
  priority: number;
  /** The site at each candidate position that fits, in the stream's order (non-empty). */
  sites: readonly S[];
}

interface ChunkOptions {
  derelict: Options<DerelictSite> | null;
  graveyard: Options<GraveyardSite> | null;
}

function derelictOptions(seed: number, cx: number, cy: number, depth: Depth, draw: DerelictDraw, around: Surroundings): DerelictSite[] {
  const model: DerelictModel = DERELICT_MODELS[Math.min(DERELICT_MODELS.length - 1, Math.floor(draw.model * DERELICT_MODELS.length))]!;
  const layout = DERELICT_LAYOUTS[model];
  const defence = pick<DerelictDefence>(draw.defence, SITES.derelict.defence);
  const service = pick<DerelictService>(draw.service, SITES.derelict.service);
  const id = derelictId(cx, cy);
  const out: DerelictSite[] = [];
  for (const pos of draw.tries) {
    // the derelict's own circle does not turn; the layout turns (relays and dock port) when a relay does not fit
    if (!clearOfFixed(seed, around, pos, layout.clearRadius) || !clearOf(pos, layout.clearRadius, around.pois) || !clearOf(pos, layout.clearRadius, around.rocks, 0)) continue;
    for (const turn of DERELICT_TURNS) {
      const angle = draw.angle * TAU + turn;
      // the relays sit away from the dock approach: at port + 60°, 180°, 300° (± jitter), 60–120 u out
      const relayPos = draw.relays.map((r, i) => {
        const bearing = angle + ((60 + i * RELAY.spacingDeg + (r.jitter * 2 - 1) * RELAY.jitterDeg) * Math.PI) / 180;
        const d = RELAY.distance[0] + r.distance * (RELAY.distance[1] - RELAY.distance[0]);
        return { x: pos.x + Math.cos(bearing) * d, y: pos.y + Math.sin(bearing) * d };
      });
      // rocks: the layouts' clear radius already holds the gap (asteroid centre ≥ clear radius + its radius)
      const r = RELAY_LAYOUT.clearRadius;
      if (!relayPos.every((p) => clearOfFixed(seed, around, p, r) && clearOf(p, r, around.pois) && clearOf(p, r, around.rocks, 0))) continue;
      const relays: RelaySite[] = relayPos.map((rp, i) => ({
        id: relayId(cx, cy, i),
        pos: rp,
        // the relay faces its station (+X of the relay layout towards the derelict)
        angle: Math.atan2(pos.y - rp.y, pos.x - rp.x),
        owner: 'derelict',
        group: id,
      }));
      out.push({ kind: 'derelict', id, cx, cy, pos, angle, model, depth, relays, defence, service });
    }
  }
  return out;
}

function graveyardOptions(seed: number, cx: number, cy: number, depth: Depth, draw: GraveyardDraw, around: Surroundings): GraveyardSite[] {
  const [wMin, wMax] = GRAVEYARD.wrecks;
  const wrecks = wMin + Math.min(wMax - wMin, Math.floor(draw.wrecks * (wMax - wMin + 1)));
  const [mMin, mMax] = GRAVEYARD.mines[depth];
  const mineCount = mMin + Math.min(mMax - mMin, Math.floor(draw.mines * (mMax - mMin + 1)));
  const sleepers: EnemyKind[] = draw.sleepers < GRAVEYARD.sleeperChance[depth] ? [...GRAVEYARD.sleeperParty[depth]] : [];
  const out: GraveyardSite[] = [];
  for (const pos of draw.tries) {
    // the whole field keeps clear of stations, fortresses, landmarks, Echo sites; its core of rocks, POIs, survey points
    if (!clearOfFixed(seed, around, pos, GRAVEYARD.radius, GRAVEYARD_CORE)) continue;
    if (!clearOf(pos, GRAVEYARD_CORE, around.pois) || !clearOf(pos, GRAVEYARD_CORE, around.rocks, 0)) continue;
    const mines: Vec2[] = [];
    for (let m = 0; m < mineCount; m++) {
      for (let k = 0; k < MINE_TRIES; k++) {
        const spot = draw.mineSpots[m * MINE_TRIES + k]!;
        // uniform over the band's area
        const [r0, r1] = GRAVEYARD_MINE_BAND;
        const r = Math.sqrt(r0 * r0 + spot.r * (r1 * r1 - r0 * r0));
        const p = { x: pos.x + Math.cos(spot.angle * TAU) * r, y: pos.y + Math.sin(spot.angle * TAU) * r };
        if (mines.some((q) => hypot(q.x - p.x, q.y - p.y) < MINE_SPACING)) continue;
        if (!clearOf(p, MINE_CLEAR, around.rocks, 0) || !clearOf(p, MINE_CLEAR, around.pois, 0)) continue;
        mines.push(p);
        break;
      }
    }
    out.push({ kind: 'graveyard', id: graveyardId(cx, cy), cx, cy, pos, depth, wrecks, mines, sleepers });
  }
  return out;
}

const NO_OPTIONS: ChunkOptions = { derelict: null, graveyard: null };

function placeOptions(seed: number, cx: number, cy: number): ChunkOptions {
  const centre = { x: (cx + 0.5) * CHUNK_SIZE, y: (cy + 0.5) * CHUNK_SIZE };
  // nothing near home (a cheap exit before any lookup – the stream of a chunk does not depend on it)
  if (hypot(centre.x, centre.y) < SITES.homeClear - CHUNK_SIZE) return NO_OPTIONS;
  const draw = drawChunk(seed, cx, cy);
  const info = sectorInfoOfChunk(seed, cx, cy);
  // static security: a sector secured later (fortress destroyed, M4d Guild relay) keeps its sites
  if (info.security === 'guarded') return NO_OPTIONS;
  const depth = info.depth;
  const dDensity = SITES.derelict.density[depth];
  const gDensity = Math.min(1, SITES.graveyard.density[depth] * (info.biome === 'wreckField' ? GRAVEYARD.biomeMult : 1));
  const wantDerelict = draw.derelict.roll < dDensity;
  const wantGraveyard = draw.graveyard.roll < gDensity;
  if (!wantDerelict && !wantGraveyard) return NO_OPTIONS;
  const around = new Surroundings(seed, cx, cy);
  const derelicts = wantDerelict ? derelictOptions(seed, cx, cy, depth, draw.derelict, around) : [];
  const graveyards = wantGraveyard ? graveyardOptions(seed, cx, cy, depth, draw.graveyard, around) : [];
  if (derelicts.length === 0 && graveyards.length === 0) return NO_OPTIONS;
  return {
    derelict: derelicts.length > 0 ? { priority: draw.derelict.roll / dDensity, sites: derelicts } : null,
    graveyard: graveyards.length > 0 ? { priority: draw.graveyard.roll / gDensity, sites: graveyards } : null,
  };
}

const optionMemo = new ChunkMemo<ChunkOptions>(8192);
const optionCache = new Map<string, ChunkOptions>();

function chunkOptions(seed: number, cx: number, cy: number): ChunkOptions {
  const key = seedKey(seed, 0, 1);
  if (key === null) {
    const k = `${seed},${cx},${cy}`;
    const hit = optionCache.get(k);
    if (hit) return hit;
    if (optionCache.size >= 4096) optionCache.clear();
    const out = placeOptions(seed, cx, cy);
    optionCache.set(k, out);
    return out;
  }
  return optionMemo.get(key, cx, cy) ?? optionMemo.set(key, cx, cy, placeOptions(seed, cx, cy));
}

// ---------------------------------------------------------------------------
// overlaps between sites: a site takes its first option that keeps clear of every site that beats it

interface Ranked {
  kind: Site['kind'];
  priority: number;
  id: string;
}

/** a beats b in an overlap: the lower priority, then derelict before graveyard, then the smaller id (a strict total order). */
const beats = (a: Ranked, b: Ranked): boolean =>
  a.priority !== b.priority ? a.priority < b.priority : a.kind !== b.kind ? a.kind === 'derelict' : a.id < b.id;

const chosenMemo = { derelict: new ChunkMemo<Site | null>(8192), graveyard: new ChunkMemo<Site | null>(8192) };
const chosenCache = new Map<string, Site | null>();

/**
 * The option a site of chunk (cx, cy) ends up with: the first one that keeps clear of the chosen
 * positions of every site that beats it (the recursion follows strictly better sites only, so it ends),
 * or null when none does. Pure and independent of the order the chunks are asked in.
 */
function chosen(seed: number, cx: number, cy: number, kind: Site['kind']): Site | null {
  const key = seedKey(seed, 0, 1);
  if (key === null) {
    const k = `${seed},${cx},${cy},${kind}`;
    const hit = chosenCache.get(k);
    if (hit !== undefined) return hit;
    if (chosenCache.size >= 4096) chosenCache.clear();
    const out = choose(seed, cx, cy, kind);
    chosenCache.set(k, out);
    return out;
  }
  const memo = chosenMemo[kind];
  const known = memo.get(key, cx, cy);
  return known !== undefined ? known : memo.set(key, cx, cy, choose(seed, cx, cy, kind));
}

const KINDS: readonly Site['kind'][] = ['derelict', 'graveyard'];

function choose(seed: number, cx: number, cy: number, kind: Site['kind']): Site | null {
  const opts = chunkOptions(seed, cx, cy)[kind];
  if (!opts) return null;
  const me: Ranked = { kind, priority: opts.priority, id: opts.sites[0]!.id };
  // the chosen positions of every site that beats this one and could reach it
  const better: Site[] = [];
  for (let dx = -CONFLICT_CHUNKS; dx <= CONFLICT_CHUNKS; dx++) {
    for (let dy = -CONFLICT_CHUNKS; dy <= CONFLICT_CHUNKS; dy++) {
      const other = chunkOptions(seed, cx + dx, cy + dy);
      for (const k of KINDS) {
        const o = other[k];
        if (!o || (dx === 0 && dy === 0 && k === kind)) continue;
        if (!beats({ kind: k, priority: o.priority, id: o.sites[0]!.id }, me)) continue;
        const site = chosen(seed, cx + dx, cy + dy, k);
        if (site) better.push(site);
      }
    }
  }
  return opts.sites.find((s) => better.every((b) => !overlap(s, b))) ?? null;
}

// ---------------------------------------------------------------------------
// public API

const NO_SITES: readonly Site[] = [];
const siteMemo = new ChunkMemo<readonly Site[]>(8192);
const siteCache = new Map<string, readonly Site[]>();

function resolveChunk(seed: number, cx: number, cy: number): readonly Site[] {
  const opts = chunkOptions(seed, cx, cy);
  if (opts === NO_OPTIONS) return NO_SITES;
  const out: Site[] = [];
  for (const kind of KINDS) {
    const s = opts[kind] ? chosen(seed, cx, cy, kind) : null;
    if (s) out.push(s);
  }
  return out.length > 0 ? out : NO_SITES;
}

/** The sites of chunk (cx, cy): at most one derelict and one graveyard, in a fixed order. Pure, memoised. */
export function sitesInChunk(seed: number, cx: number, cy: number): readonly Site[] {
  const key = seedKey(seed, 0, 1);
  if (key === null) {
    const k = `${seed},${cx},${cy}`;
    const hit = siteCache.get(k);
    if (hit) return hit;
    if (siteCache.size >= 4096) siteCache.clear();
    const out = resolveChunk(seed, cx, cy);
    siteCache.set(k, out);
    return out;
  }
  return siteMemo.get(key, cx, cy) ?? siteMemo.set(key, cx, cy, resolveChunk(seed, cx, cy));
}

/**
 * Calls `visit` for every site whose centre lies within `radius` of `pos` – no allocation, the hot paths
 * (colliders, hit targets, relay candidates) use it every step.
 */
export function forSitesNear(seed: number, pos: Vec2, radius: number, visit: (site: Site) => void): void {
  const x0 = chunkCoord(pos.x - radius);
  const x1 = chunkCoord(pos.x + radius);
  const y0 = chunkCoord(pos.y - radius);
  const y1 = chunkCoord(pos.y + radius);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      const list = sitesInChunk(seed, cx, cy);
      for (let i = 0; i < list.length; i++) {
        const s = list[i]!;
        if (hypot(s.pos.x - pos.x, s.pos.y - pos.y) <= radius) visit(s);
      }
    }
  }
}

/** Sites whose centre lies within `radius` of `pos` (walks the chunks the circle overlaps). */
export function sitesNear(seed: number, pos: Vec2, radius: number): Site[] {
  return sitesNearInto(seed, pos, radius, []);
}

/** `sitesNear` appended to `out` (same order, no closure) – for hot paths with a reused list. Returns `out`. */
export function sitesNearInto(seed: number, pos: Vec2, radius: number, out: Site[]): Site[] {
  const x0 = chunkCoord(pos.x - radius);
  const x1 = chunkCoord(pos.x + radius);
  const y0 = chunkCoord(pos.y - radius);
  const y1 = chunkCoord(pos.y + radius);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      const list = sitesInChunk(seed, cx, cy);
      for (let i = 0; i < list.length; i++) {
        const s = list[i]!;
        if (hypot(s.pos.x - pos.x, s.pos.y - pos.y) <= radius) out.push(s);
      }
    }
  }
  return out;
}

/** The site with this id (`dl:<cx>,<cy>` / `gy:<cx>,<cy>`) of this seed, or null (also for a malformed id). */
export function siteById(seed: number, id: string): Site | null {
  const m = SITE_ID.exec(id);
  if (!m) return null;
  return sitesInChunk(seed, Number(m[2]), Number(m[3])).find((s) => s.id === id) ?? null;
}

/** The relay with this id (`dl:<cx>,<cy>:r<i>`, or a Guild relay `gr:<lane>` – M4d) of this seed, or null. */
export function relayById(seed: number, id: string): RelaySite | null {
  if (id.startsWith('gr:')) return guildRelayById(seed, id)?.relay ?? null;
  const m = RELAY_ID.exec(id);
  if (!m) return null;
  const site = siteById(seed, derelictId(Number(m[1]), Number(m[2])));
  return site?.kind === 'derelict' ? (site.relays.find((r) => r.id === id) ?? null) : null;
}

const NO_RELAYS: readonly RelaySite[] = [];

/**
 * Relays the player's beams could reach this step (input of `stepRelays`; the M4d Guild relays are appended).
 * Every relay of a derelict near the ship is listed – the whole group – so `stepRelays` can count the lit
 * relays of a group.
 */
export function relayCandidates(state: SimState): readonly RelaySite[] {
  const { player } = state;
  if (player.beams.length === 0 || player.dock.mode !== 'flying') return NO_RELAYS;
  let reach = 0;
  for (const l of player.props.lasers) reach = Math.max(reach, l.range);
  reach += player.props.boundingRadius + DERELICT_EXTENT;
  let out: RelaySite[] | null = null;
  forSitesNear(state.seed, player.body.pos, reach, (s) => {
    if (s.kind === 'derelict') (out ??= []).push(...s.relays);
  });
  // M4d: the Guild relay masts that can be charged now (guild/relaySites.ts)
  const guild = guildRelayCandidates(state);
  if (guild.length > 0) return [...(out ?? NO_RELAYS), ...guild];
  return out ?? NO_RELAYS;
}

/** Local layout frame → world (derelict and relay layouts are rotated by the site's angle). */
export const siteToWorld = (site: { pos: Vec2; angle: number }, local: { x: number; y: number }): Vec2 => add(site.pos, rotate(local, site.angle));
