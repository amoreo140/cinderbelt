// Comets (M4b plan §2.3, DH §5.3.3) – OWNED BY T2.
//
// Count per depth band `COMET.count` per seed from `hash3(seed ^ COMET_SALT, n, …)`; a period of
// 40–120 game min and a pass: an arc of length speed × passSeconds centred on a perihelion inside its
// depth band, tangent to the radial direction there, its ends curving outward (a circular arc whose
// centre lies outward – parabola-like near the perihelion, so the perihelion is the arc's point closest
// to home). Every pass of a comet runs along the same arc. Position = pure function of the tick
// (`cometAt`); nothing about position is saved. The nucleus collides (relative velocity counts) and is
// mined like a rich rock (cometMining.ts); 24 tail shards behind it (away from home) are mined once per
// pass each. Budgets per pass live in `sites.comets` (current pass only).
//
// Time convention: during a sim step the ship is integrated to the end of the step, so collisions,
// mining and projectile hits use the comet at `cometStepTick(state)` = `state.tick + 1`. After the
// step `state.tick` has advanced, so a renderer draws `cometAt(tick - 1)` → `cometAt(tick)` with the
// usual alpha (like `prevBody` → `body`).
import type { ResourceId } from '../../data/resources';
import { COMET, COMET_SALT, SITES, VEIN_ANALYZER } from '../../data/sites';
import { SECTOR_EPOCH_TICKS } from '../../data/sector';
import { hasFeature } from '../discovery/archive';
import { radarRangeOf } from '../discovery/scanner';
import { TAU } from '../math/angle';
import { fnv1a32 } from '../math/fnv1a';
import { createRng, type Rng } from '../math/rng';
import { hypot, type Vec2 } from '../math/vec2';
import type { Circle } from '../physics/collide';
import { FORTRESS_LAYOUT, fortressSites } from '../pirates/sites';
import type { Depth } from '../regions/constants';
import { guildCorridorAt, sectorIdAt, sectorInfoAt } from '../regions/sectors';
import type { SimEvent, SimState } from '../Simulation';
import { chunkCoord } from '../world/chunks';
import { hash3 } from '../world/hash';
import { RINGS } from '../world/rings';
import { stationAt, type StationDef } from '../world/stations';
import type { CometDef, CometPose, CometShard, SiteHit, SiteHitTarget } from './types';

// ---------------------------------------------------------------------------
// geometry tuning (derived shape rules; the gameplay numbers are COMET in data/sites.ts)

/** Bend radius of the pass arc in half-lengths: the ends turn ±1/1.25 rad (≈ 46°) outward. */
const ARC_BEND = 1.25;
/** The perihelion keeps this far inside its ring (u). */
const BAND_MARGIN = 100;
/** Width of the depth-4 band (ring 4 is unbounded), u. */
const DEPTH4_WIDTH = 3_000;
/** Arc samples for the clearance rules (u along the arc). */
const CLEAR_STEP = 25;
/** Perihelion candidates per attempt (the cometPath weight picks among them). */
const PERIHELION_CANDIDATES = 4;
/** Steps of the perihelion shift along the band once the re-rolls are spent, at this many extra radii. */
const SHIFT_STEPS = 64;
const SHIFT_RADII = 5;
/** Sampling of the sector crossings of a pass (ticks); a change between two samples is re-scanned per tick. */
const SECTOR_STRIDE = 10;
/** Projectiles stop at nuclei within this distance of the player (u). */
const HIT_REACH = 800;
/** Lateral spread of the tail: half-width at the nucleus and its growth per unit of tail length. */
const TAIL_SPREAD = { base: 1, perUnit: 0.12 };

const DEPTHS: readonly Depth[] = [1, 2, 3, 4];
const TICKS_PER_SECOND = 60;

/** Internal orbit of a comet (consumers use the `CometDef` fields only). */
interface Orbit extends CometDef {
  /** Perihelion (the arc's middle point and the point closest to home). */
  perihelion: Vec2;
  /** Outward unit vector at the perihelion. */
  radial: Vec2;
  /** Unit vector of travel at the perihelion. */
  tangent: Vec2;
  /** Bend radius of the arc (u). */
  bend: number;
  /** Arc length = speed × pass seconds (u). */
  length: number;
  /** Tick of the start of pass 0. */
  phase: number;
}

// ---------------------------------------------------------------------------
// arc geometry

/** Point and unit direction on the arc at arc length `s` ∈ [-L/2, L/2] from the perihelion. */
function arcPoint(o: Orbit, s: number): { pos: Vec2; dir: Vec2 } {
  const th = s / o.bend;
  const sn = Math.sin(th);
  const cs = Math.cos(th);
  const a = o.bend * sn;
  const b = o.bend * (1 - cs);
  return {
    pos: { x: o.perihelion.x + o.tangent.x * a + o.radial.x * b, y: o.perihelion.y + o.tangent.y * a + o.radial.y * b },
    dir: { x: o.tangent.x * cs + o.radial.x * sn, y: o.tangent.y * cs + o.radial.y * sn },
  };
}

function band(depth: Depth): [number, number] {
  const ring = RINGS[depth - 1]!;
  const lo = Math.max(ring.inner, SITES.homeClear) + BAND_MARGIN;
  const hi = (Number.isFinite(ring.outer) ? ring.outer : ring.inner + DEPTH4_WIDTH) - BAND_MARGIN;
  return [lo, hi];
}

function makeOrbit(base: Omit<Orbit, 'perihelion' | 'radial' | 'tangent' | 'bend' | 'length'>, angle: number, r: number, sign: 1 | -1): Orbit {
  const radial = { x: Math.cos(angle), y: Math.sin(angle) };
  const tangent = { x: -radial.y * sign, y: radial.x * sign };
  const length = (base.speed * base.passTicks) / TICKS_PER_SECOND;
  return { ...base, perihelion: { x: radial.x * r, y: radial.y * r }, radial, tangent, bend: (length / 2) * ARC_BEND, length };
}

/** The arc keeps `COMET.clear` from stations and fortresses; its middle third lies outside Guild Lane corridors. */
function arcClear(seed: number, o: Orbit): boolean {
  const forts = fortressSites(seed);
  const stations = new Map<string, StationDef | null>();
  const reach = COMET.clear + 80;
  const n = Math.ceil(o.length / CLEAR_STEP);
  for (let i = 0; i <= n; i++) {
    const s = -o.length / 2 + (o.length * i) / n;
    const p = arcPoint(o, s).pos;
    if (Math.abs(s) <= o.length / 6 && guildCorridorAt(seed, p.x, p.y)) return false;
    for (const f of forts) {
      if (hypot(p.x - f.pos.x, p.y - f.pos.y) < COMET.clear + FORTRESS_LAYOUT.clearRadius) return false;
    }
    const cx0 = chunkCoord(p.x - reach);
    const cx1 = chunkCoord(p.x + reach);
    const cy0 = chunkCoord(p.y - reach);
    const cy1 = chunkCoord(p.y + reach);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = `${cx},${cy}`;
        let st = stations.get(key);
        if (st === undefined) {
          st = stationAt(seed, cx, cy);
          stations.set(key, st);
        }
        if (st && hypot(p.x - st.pos.x, p.y - st.pos.y) < COMET.clear + st.radius) return false;
      }
    }
  }
  return true;
}

/** Weighted pick of a perihelion among a few candidates: right sector depth, depth-3 cometPath ×3. */
function pickPerihelion(seed: number, depth: Depth, rng: Rng): { angle: number; r: number } {
  const [lo, hi] = band(depth);
  const cands: { angle: number; r: number; w: number }[] = [];
  for (let i = 0; i < PERIHELION_CANDIDATES; i++) {
    const angle = rng() * TAU;
    const r = lo + (hi - lo) * rng();
    const info = sectorInfoAt(seed, Math.cos(angle) * r, Math.sin(angle) * r);
    const w = info.depth !== depth ? 0 : depth === 3 && info.biome === 'cometPath' ? COMET.cometPathWeight : 1;
    cands.push({ angle, r, w });
  }
  const roll = rng();
  const total = cands.reduce((t, c) => t + c.w, 0);
  if (total <= 0) return cands[0]!;
  let x = roll * total;
  for (const c of cands) {
    x -= c.w;
    if (x < 0) return c;
  }
  return cands[cands.length - 1]!;
}

function buildComet(seed: number, n: number, depth: Depth): Orbit {
  // the comet's own numbers: always drawn in this order
  const rng = createRng(hash3(seed ^ COMET_SALT, n, 0));
  const speed = COMET.speed[0] + (COMET.speed[1] - COMET.speed[0]) * rng();
  const passSeconds = COMET.passSeconds[0] + (COMET.passSeconds[1] - COMET.passSeconds[0]) * rng();
  const periodMinutes = COMET.periodMinutes[0] + (COMET.periodMinutes[1] - COMET.periodMinutes[0]) * rng();
  const phaseRoll = rng();
  const sign: 1 | -1 = rng() < 0.5 ? 1 : -1;
  const periodTicks = Math.round(periodMinutes * 60 * TICKS_PER_SECOND);
  const passTicks = Math.round(passSeconds * TICKS_PER_SECOND);
  const base = { id: `cm:${n}`, n, depth, periodTicks, passTicks, speed, phase: Math.floor(phaseRoll * periodTicks) };

  // the arc: first try + re-rolls from sub-streams, then shift the perihelion along the band (the first
  // one's radius, then radii across the band); the perihelion must lie in a sector of its depth
  // (an arc that is clear but whose perihelion sector has another depth is the fallback)
  let clearOnly: Orbit | null = null;
  const fits = (o: Orbit): boolean => {
    if (!arcClear(seed, o)) return false;
    if (sectorInfoAt(seed, o.perihelion.x, o.perihelion.y).depth === depth) return true;
    clearOnly ??= o;
    return false;
  };
  let first: Orbit | null = null;
  for (let attempt = 0; attempt <= COMET.rerolls; attempt++) {
    const p = pickPerihelion(seed, depth, createRng(hash3(seed ^ COMET_SALT, n, 1 + attempt)));
    const o = makeOrbit(base, p.angle, p.r, sign);
    if (!first) first = o;
    if (fits(o)) return o;
  }
  const angle0 = Math.atan2(first!.radial.y, first!.radial.x);
  const r0 = hypot(first!.perihelion.x, first!.perihelion.y);
  const [lo, hi] = band(depth);
  for (let j = 0; j <= SHIFT_RADII; j++) {
    const r = j === 0 ? r0 : lo + ((hi - lo) * (j - 1)) / Math.max(1, SHIFT_RADII - 1);
    for (let k = j === 0 ? 1 : 0; k < SHIFT_STEPS; k++) {
      const o = makeOrbit(base, angle0 + (k * TAU) / SHIFT_STEPS, r, sign);
      if (fits(o)) return o;
    }
  }
  return clearOnly ?? first!;
}

const defsCache = new Map<number, Orbit[]>();

function orbits(seed: number): Orbit[] {
  const hit = defsCache.get(seed);
  if (hit) return hit;
  const out: Orbit[] = [];
  let n = 0;
  for (const depth of DEPTHS) {
    for (let i = 0; i < COMET.count[depth]; i++) out.push(buildComet(seed, n++, depth));
  }
  if (defsCache.size >= 8) defsCache.clear();
  defsCache.set(seed, out);
  return out;
}

/** Orbits by their exact id per orbit list (no regex per lookup – the flyby asks for every comet every step). */
const byIdCache = new WeakMap<readonly Orbit[], Map<string, Orbit>>();

function orbitById(seed: number, id: string): Orbit | null {
  const list = orbits(seed);
  let byId = byIdCache.get(list);
  if (!byId) {
    byId = new Map(list.map((o) => [o.id, o]));
    byIdCache.set(list, byId);
  }
  const hit = byId.get(id);
  if (hit) return hit;
  // a non-canonical spelling (`cm:07`) resolves like before
  const m = /^cm:(\d+)$/.exec(id);
  if (!m) return null;
  return orbits(seed)[Number(m[1])] ?? null;
}

// ---------------------------------------------------------------------------
// passes

/** Pass index and offset (ticks into it) at a tick; `inPass` false while the comet is away. */
function passAt(o: Orbit, tick: number): { pass: number; off: number; inPass: boolean } {
  const rel = tick - o.phase;
  const pass = Math.floor(rel / o.periodTicks);
  const off = rel - pass * o.periodTicks;
  return { pass, off, inPass: off < o.passTicks };
}

/** `passAt(o, tick).pass` without the object (hot paths). */
const passIndex = (o: Orbit, tick: number): number => Math.floor((tick - o.phase) / o.periodTicks);
/** `passAt(o, tick).off` for `pass = passIndex(o, tick)` – the same arithmetic. */
const passOffset = (o: Orbit, tick: number, pass: number): number => tick - o.phase - pass * o.periodTicks;

const passStart = (o: Orbit, pass: number): number => o.phase + pass * o.periodTicks;
const arcLengthAt = (o: Orbit, off: number): number => -o.length / 2 + (o.speed * off) / TICKS_PER_SECOND;

function poseOf(o: Orbit, tick: number): CometPose | null {
  const pass = passIndex(o, tick);
  const off = passOffset(o, tick, pass);
  if (!(off < o.passTicks)) return null;
  const { pos, dir } = arcPoint(o, arcLengthAt(o, off));
  return { id: o.id, pass, pos, vel: { x: dir.x * o.speed, y: dir.y * o.speed }, t: off / o.passTicks };
}

/**
 * Distance of the nucleus at `tick` from (px, py), Infinity while away – `poseOf` + hypot without the
 * pose objects (the same arithmetic as `arcPoint`).
 */
function nucleusDist(o: Orbit, tick: number, px: number, py: number): number {
  const pass = passIndex(o, tick);
  const off = passOffset(o, tick, pass);
  if (!(off < o.passTicks)) return Infinity;
  const th = arcLengthAt(o, off) / o.bend;
  const a = o.bend * Math.sin(th);
  const b = o.bend * (1 - Math.cos(th));
  const x = o.perihelion.x + o.tangent.x * a + o.radial.x * b;
  const y = o.perihelion.y + o.tangent.y * a + o.radial.y * b;
  return hypot(x - px, y - py);
}

/**
 * Arc-length intervals [a, b] of the arc within `range` of `pos` (closed form: the arc is a circle piece,
 * so the distance is d² = D² + bend² − 2·D·bend·cos(θ − θX)).
 */
/** Scratch of `nearIntervals`: [a0, b0, a1, b1, a2, b2] (read right after the call). */
const IV = new Float64Array(6);
const SHIFTS = [-TAU, 0, TAU] as const;

/**
 * Arc-length intervals [a, b] of the arc within `range` of `pos` (closed form: the arc is a circle piece,
 * so the distance is d² = D² + bend² − 2·D·bend·cos(θ − θX)), written to `IV` in ascending order; returns
 * their count. (The starts grow with the shift, so they come out sorted.)
 */
function nearIntervals(o: Orbit, pos: Vec2, range: number): number {
  const cx = o.perihelion.x + o.radial.x * o.bend;
  const cy = o.perihelion.y + o.radial.y * o.bend;
  const dx = pos.x - cx;
  const dy = pos.y - cy;
  const D = hypot(dx, dy);
  const thMax = o.length / 2 / o.bend;
  if (D < 1e-9) {
    if (!(o.bend <= range)) return 0;
    IV[0] = -o.length / 2;
    IV[1] = o.length / 2;
    return 1;
  }
  const k = (D * D + o.bend * o.bend - range * range) / (2 * D * o.bend);
  if (k > 1) return 0;
  const alpha = k < -1 ? Math.PI : Math.acos(k);
  // the circle point at θ is C + bend·(tangent·sinθ − radial·cosθ)
  const thX = Math.atan2(dx * o.tangent.x + dy * o.tangent.y, -(dx * o.radial.x + dy * o.radial.y));
  let n = 0;
  for (const shift of SHIFTS) {
    const a = Math.max(-thMax, thX + shift - alpha);
    const b = Math.min(thMax, thX + shift + alpha);
    if (a <= b) {
      IV[2 * n] = a * o.bend;
      IV[2 * n + 1] = b * o.bend;
      n++;
    }
  }
  return n;
}

const distAt = (o: Orbit, tick: number, pos: Vec2): number => nucleusDist(o, tick, pos.x, pos.y);

/**
 * The first integer tick in [from, to] (inside passes) at which the nucleus is within `range` of `pos`,
 * or null. Exact per tick: the closed-form arc intervals give the candidate, a per-tick check confirms.
 */
function firstTickNear(o: Orbit, pos: Vec2, range: number, from: number, to: number): number | null {
  const count = nearIntervals(o, pos, range);
  if (count === 0) return null;
  const a0 = IV[0]!;
  const b0 = IV[1]!;
  const a1 = IV[2]!;
  const b1 = IV[3]!;
  const a2 = IV[4]!;
  const b2 = IV[5]!;
  for (let pass = passIndex(o, from); passStart(o, pass) <= to; pass++) {
    const ps = passStart(o, pass);
    const lastTick = Math.min(to, ps + o.passTicks - 1);
    for (let i = 0; i < count; i++) {
      const a = i === 0 ? a0 : i === 1 ? a1 : a2;
      const b = i === 0 ? b0 : i === 1 ? b1 : b2;
      const offA = ((a + o.length / 2) * TICKS_PER_SECOND) / o.speed;
      const offB = ((b + o.length / 2) * TICKS_PER_SECOND) / o.speed;
      const lo = Math.max(from, ps, ps + Math.ceil(offA) - 1);
      const hi = Math.min(lastTick, ps + Math.floor(offB) + 1);
      for (let t = lo; t <= hi; t++) if (nucleusDist(o, t, pos.x, pos.y) <= range) return t;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// public surface

/** Every comet of the seed (memoised), in `n` order. */
export function cometDefs(seed: number): readonly CometDef[] {
  return orbits(seed);
}

/** The comet with this id (`cm:<n>`) of this seed, or null. */
export function cometById(seed: number, id: string): CometDef | null {
  return orbitById(seed, id);
}

/** The comet at `tick`: in its pass → pose, away → null. Pure in `tick` (no state). */
export function cometAt(seed: number, id: string, tick: number): CometPose | null {
  const o = orbitById(seed, id);
  return o ? poseOf(o, tick) : null;
}

/** The pass running at `tick`, else the next one: its index and ticks [start, end) (map, fixtures, e2e). */
export function cometPassWindow(seed: number, id: string, tick: number): { pass: number; start: number; end: number } | null {
  const o = orbitById(seed, id);
  if (!o) return null;
  const p = passAt(o, tick);
  const pass = p.inPass ? p.pass : p.pass + 1;
  const start = passStart(o, pass);
  return { pass, start, end: start + o.passTicks };
}

/** Comets in their pass whose nucleus lies within `radius` of `pos` at `tick`. */
export function cometsNear(seed: number, pos: Vec2, radius: number, tick: number): CometPose[] {
  const out: CometPose[] = [];
  const list = orbits(seed);
  for (let i = 0; i < list.length; i++) {
    const o = list[i]!;
    // the distance first (no objects), the pose only for a comet in range – the same numbers
    if (!(nucleusDist(o, tick, pos.x, pos.y) <= radius)) continue;
    out.push(poseOf(o, tick)!);
  }
  return out;
}

/** The pass arc in world space (map, T7/T10): `samples` points from the start to the end of the pass. */
export function cometArc(seed: number, id: string, samples = 32): Vec2[] {
  const o = orbitById(seed, id);
  if (!o) return [];
  const n = Math.max(2, samples);
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) out.push(arcPoint(o, -o.length / 2 + (o.length * i) / (n - 1)).pos);
  return out;
}

/**
 * The first tick ≥ `tick` at which the comet's nucleus comes within `COMET.nearRange` of `pos`
 * (searched over `COMET.nearSearchPeriods` periods), or null ("Nearest flyby near you: N min").
 */
export function nextPassNear(seed: number, id: string, pos: Vec2, tick: number): number | null {
  const o = orbitById(seed, id);
  if (!o) return null;
  return firstTickNear(o, pos, COMET.nearRange, Math.ceil(tick), Math.ceil(tick) + COMET.nearSearchPeriods * o.periodTicks);
}

/**
 * The pass of a comet that comes within `range` of `pos` between `from` and `from + lead` ticks: its
 * pass index, the first and the last tick in range (the last searched up to the pass end) and the
 * closest approach. Used by the comet flyby (events/cometFlyby.ts).
 */
export function cometApproach(
  seed: number,
  id: string,
  pos: Vec2,
  range: number,
  from: number,
  lead: number,
): { pass: number; enter: number; exit: number; closest: Vec2; closestTick: number } | null {
  const o = orbitById(seed, id);
  if (!o) return null;
  // cheap reject: no pass overlaps the window
  const pFrom = passIndex(o, from);
  const nextStart = passOffset(o, from, pFrom) < o.passTicks ? from : passStart(o, pFrom + 1);
  if (nextStart > from + lead) return null;
  const enter = firstTickNear(o, pos, range, from, from + lead);
  if (enter === null) return null;
  const pass = passIndex(o, enter);
  const end = passStart(o, pass) + o.passTicks - 1;
  // the interval containing `enter` gives the exit and the closest point (closed form)
  const sEnter = arcLengthAt(o, enter - passStart(o, pass));
  const count = nearIntervals(o, pos, range);
  let iv0 = sEnter;
  let iv1 = sEnter;
  for (let i = 0; i < count; i++) {
    if (sEnter >= IV[2 * i]! - 1 && sEnter <= IV[2 * i + 1]! + 1) {
      iv0 = IV[2 * i]!;
      iv1 = IV[2 * i + 1]!;
      break;
    }
  }
  let exit = Math.min(end, Math.floor(arcTick(o, pass, iv1)));
  while (exit < end && distAt(o, exit + 1, pos) <= range) exit++;
  while (exit > enter && distAt(o, exit, pos) > range) exit--;
  // closest approach: the arc point nearest to `pos`, clamped to the interval in range
  const sClosest = Math.max(iv0, Math.min(iv1, closestArcLength(o, pos)));
  const closestTick = Math.max(enter, Math.min(exit, Math.round(arcTick(o, pass, sClosest))));
  const closest = nucleusPos(o, closestTick) ?? arcPoint(o, sClosest).pos;
  return { pass, enter, exit, closest, closestTick };
}

/** The tick of pass `pass` at which the nucleus is at arc `s` (fractional). */
const arcTick = (o: Orbit, pass: number, s: number): number => passStart(o, pass) + ((s + o.length / 2) * TICKS_PER_SECOND) / o.speed;

/** `poseOf(o, tick)?.pos` without the rest of the pose (the same arithmetic as `arcPoint`). */
function nucleusPos(o: Orbit, tick: number): Vec2 | null {
  const pass = passIndex(o, tick);
  const off = passOffset(o, tick, pass);
  if (!(off < o.passTicks)) return null;
  const th = arcLengthAt(o, off) / o.bend;
  const a = o.bend * Math.sin(th);
  const b = o.bend * (1 - Math.cos(th));
  return { x: o.perihelion.x + o.tangent.x * a + o.radial.x * b, y: o.perihelion.y + o.tangent.y * a + o.radial.y * b };
}

/** Arc length of the arc point closest to `pos`. */
function closestArcLength(o: Orbit, pos: Vec2): number {
  const cx = o.perihelion.x + o.radial.x * o.bend;
  const cy = o.perihelion.y + o.radial.y * o.bend;
  const dx = pos.x - cx;
  const dy = pos.y - cy;
  const thMax = o.length / 2 / o.bend;
  if (hypot(dx, dy) < 1e-9) return 0;
  const thX = Math.atan2(dx * o.tangent.x + dy * o.tangent.y, -(dx * o.radial.x + dy * o.radial.y));
  return Math.max(-thMax, Math.min(thMax, thX)) * o.bend;
}

/** Comet nuclei a scanner pulse of `range` at `pos` hears (scanner integration, T3). */
export function cometSignals(seed: number, pos: Vec2, range: number, tick: number): { id: string; pos: Vec2 }[] {
  return cometsNear(seed, pos, range + COMET.nucleusRadius, tick).map((c) => ({ id: c.id, pos: c.pos }));
}

/** Local tail layout of a shard: distance behind the nucleus, lateral offset, radius (from the id only). */
function shardLayout(id: string): { along: number; side: number; radius: number }[] {
  const h0 = fnv1a32(id);
  const out: { along: number; side: number; radius: number }[] = [];
  const { shards, length, radius } = COMET.tail;
  const start = COMET.nucleusRadius + 1;
  for (let i = 0; i < shards; i++) {
    const rng = createRng(hash3(h0, i, 0x7a11));
    const along = start + (length - start) * ((i + 0.2 + 0.6 * rng()) / shards);
    const spread = TAIL_SPREAD.base + TAIL_SPREAD.perUnit * (along - start);
    const side = (rng() * 2 - 1) * spread;
    out.push({ along, side, radius: radius[0] + (radius[1] - radius[0]) * rng() });
  }
  return out;
}

const layoutCache = new Map<string, { along: number; side: number; radius: number }[]>();

/** Tail shards of a comet at a pose (world positions; sim mining and render `cometLook.ts` share them). */
export function cometShards(pose: CometPose): CometShard[] {
  let layout = layoutCache.get(pose.id);
  if (!layout) {
    layout = shardLayout(pose.id);
    layoutCache.set(pose.id, layout);
  }
  // the tail points away from home
  const r = hypot(pose.pos.x, pose.pos.y);
  const ax = r > 1e-9 ? pose.pos.x / r : 1;
  const ay = r > 1e-9 ? pose.pos.y / r : 0;
  return layout.map((l, index) => ({
    index,
    pos: { x: pose.pos.x + ax * l.along - ay * l.side, y: pose.pos.y + ay * l.along + ax * l.side },
    radius: l.radius,
  }));
}

/** The tick the comets are at during a sim step (the ship is integrated to the end of the step). */
export const cometStepTick = (state: SimState): number => state.tick + 1;

/** The moving nucleus as an obstacle (with `vel` – the impact uses the relative velocity). */
export function cometColliders(state: SimState, pos: Vec2, reach: number): Circle[] {
  return cometCollidersInto(state, pos, reach, []);
}

/** `cometColliders` appended to `out` (same order) – nothing allocated while no comet is near. */
export function cometCollidersInto(state: SimState, pos: Vec2, reach: number, out: Circle[]): Circle[] {
  const tick = cometStepTick(state);
  const radius = reach + COMET.nucleusRadius;
  const list = orbits(state.seed);
  for (let i = 0; i < list.length; i++) {
    const o = list[i]!;
    if (!(nucleusDist(o, tick, pos.x, pos.y) <= radius)) continue;
    const c = poseOf(o, tick)!;
    out.push({ pos: c.pos, radius: COMET.nucleusRadius, vel: c.vel });
  }
  return out;
}

/** Nuclei projectiles stop at (kind 'comet'). */
export function cometHitTargets(state: SimState): SiteHitTarget[] {
  return cometHitTargetsInto(state, []);
}

/** `cometHitTargets` appended to `out` (same order) – nothing allocated while no comet is near. */
export function cometHitTargetsInto(state: SimState, out: SiteHitTarget[]): SiteHitTarget[] {
  const tick = cometStepTick(state);
  const pos = state.player.body.pos;
  const list = orbits(state.seed);
  for (let i = 0; i < list.length; i++) {
    const o = list[i]!;
    if (!(nucleusDist(o, tick, pos.x, pos.y) <= HIT_REACH)) continue;
    const c = poseOf(o, tick)!;
    out.push({ id: c.id, kind: 'comet', pos: c.pos, radius: COMET.nucleusRadius });
  }
  return out;
}

/** A projectile hit a comet nucleus (a spent shot – the ice swallows it). */
export function onCometHit(_state: SimState, _target: SiteHitTarget, _hit: SiteHit, _events: SimEvent[]): void {}

/** What is left of a comet in a pass: nucleus rock units and the bitmask of mined tail shards. */
export function cometLeft(state: SimState, id: string, pass: number): { core: number; tail: number } {
  const st = state.sites.comets.get(id);
  if (!st || st.pass !== pass) return { core: COMET.budget, tail: 0 };
  return { core: Math.max(0, COMET.budget - st.core), tail: st.tail };
}

/** Reach of a comet's composition read-out: radar range, ×2 with the Archive "Vein analyser". */
export const cometAssayRange = (state: SimState): number =>
  radarRangeOf(state) * (hasFeature(state, 'veinAnalyzer') ? VEIN_ANALYZER.assayRangeMult : 1);

/**
 * Composition and budget of a comet nucleus the player can read now (within `cometAssayRange` and in its
 * pass), or null – for the analysis panel (T3/T10) and the map (T7).
 */
export function cometReadout(
  state: SimState,
  id: string,
): { mix: Partial<Record<ResourceId, number>>; core: number; budget: number; shardsLeft: number } | null {
  const pose = cometAt(state.seed, id, state.tick);
  if (!pose) return null;
  const p = state.player.body.pos;
  if (hypot(pose.pos.x - p.x, pose.pos.y - p.y) > cometAssayRange(state) + COMET.nucleusRadius) return null;
  const left = cometLeft(state, id, pose.pass);
  let mined = 0;
  for (let t = left.tail; t; t &= t - 1) mined++;
  return { mix: { ...COMET.mix }, core: left.core, budget: COMET.budget, shardsLeft: COMET.tail.shards - mined };
}

/** One step: drop budgets of finished passes, `cometSighted` when a comet comes within radar range. */
export function stepComets(state: SimState, events: SimEvent[], _dt: number): void {
  const now = cometStepTick(state);
  const comets = state.sites.comets;
  if (comets.size > 0) {
    // a budget of a pass that is over (or of another pass) is dropped – `cometAt(…).pass` without the
    // pose; deleting the visited entry while iterating a Map is safe and keeps the order
    comets.forEach((st, id) => {
      const o = orbitById(state.seed, id);
      const pass = o ? passIndex(o, now) : 0;
      if (!o || !(passOffset(o, now, pass) < o.passTicks) || pass !== st.pass) comets.delete(id);
    });
  }
  const player = state.player;
  if (player.destroyed) return;
  const d = state.discovery;
  for (const pose of cometsNear(state.seed, player.body.pos, radarRangeOf(state) + COMET.nucleusRadius, now)) {
    if (d.known.has(pose.id)) continue;
    d.known.add(pose.id);
    d.signals = d.signals.filter((s) => s.id !== pose.id);
    events.push({ type: 'cometSighted', id: pose.id, pos: { ...pose.pos } });
  }
}

// ---------------------------------------------------------------------------
// derived local condition "Comet flyby" (sector.ts)

const sectorsCache = new Map<string, ReadonlySet<string>>();

/**
 * Sectors the nucleus of any comet passes through during an epoch (ticks [epoch·E, (epoch+1)·E)) –
 * the derived local condition `cometFlyby` (sim/sector/sector.ts). Sampled every tick of the passes.
 */
export function cometSectorsInEpoch(seed: number, epoch: number): ReadonlySet<string> {
  const key = `${seed}|${epoch}`;
  const hit = sectorsCache.get(key);
  if (hit) return hit;
  const from = epoch * SECTOR_EPOCH_TICKS;
  const to = from + SECTOR_EPOCH_TICKS - 1;
  const out = new Set<string>();
  for (const o of orbits(seed)) {
    for (let pass = passAt(o, from).pass; passStart(o, pass) <= to; pass++) {
      const ps = passStart(o, pass);
      const lo = Math.max(from, ps);
      const hi = Math.min(to, ps + o.passTicks - 1);
      if (lo > hi) continue;
      const at =(t: number): string => {
        const p = arcPoint(o, arcLengthAt(o, t - ps)).pos;
        return sectorIdAt(seed, p.x, p.y);
      };
      let prevT = lo;
      let prev = at(lo);
      out.add(prev);
      for (let t = Math.min(hi, lo + SECTOR_STRIDE); t > prevT; t = Math.min(hi, t + SECTOR_STRIDE)) {
        const id = at(t);
        // a change between two samples: every tick in between (catches a thin sliver crossed on the way)
        if (id !== prev) for (let k = prevT + 1; k < t; k++) out.add(at(k));
        out.add(id);
        prev = id;
        prevT = t;
      }
    }
  }
  if (sectorsCache.size >= 256) sectorsCache.clear();
  sectorsCache.set(key, out);
  return out;
}
