// The events director (M4b plan §2.2, DH §5.5).
//
// Registry over `EVENT_DEFS` (data/events.ts):
// - legacy kinds keep their generators – distress signals (`distressAt` / `distressNear`) and ion storms
//   (`ionStormIn`, plus derelict storms via `stormAt`'s `siteStorms`) – output unchanged (golden test);
//   the director only LISTS them (`activeEvents`), their radio and effects stay where they were;
// - rolled kinds draw `hash3(seed ^ DIRECTOR.salt, fnv1a32(sectorId), bucket)` for the player's sector and
//   the 60 s bucket: the trigger offset first, then one roll per kind in `ROLLED_EVENT_ORDER` – always all
//   of them, whatever the outcome. The first kind whose roll is below its chance (rate by depth ×
//   security weight × corridor × local conditions; ambush 0 when the AI budget is full) is the bucket's
//   event. It fires at the trigger tick only when the player flies there (not destroyed, not berthed),
//   not in the Guild Training, sector epoch ≥ `minEpoch`, the quiet window since `director.last` is over
//   and no station is within `stationClear`. Firing = the radio warning; the event starts
//   `leadSeconds` later;
// - derived kinds come from providers (comet flyby, cometFlyby.ts – T2; M4d convoy flyby,
//   convoys/flyby.ts – T5).
// Security only via `securityHere` (pirates/sectors.ts). The running rolled events are re-derived from
// the saved one-shot keys `director.fired` (key → trigger tick), so a reload continues them exactly.
import type { RingIndex } from '../../data/economy';
import { AMBUSH, DIRECTOR, DISTRESS, EVENT_DEFS, ION_STORM, MICROMETEORS, ROLLED_EVENT_ORDER, type DirectorEventKind, type RolledEventKind } from '../../data/events';
import type { GameAction } from '../commands';
import { distressBucket, distressNear, ionStormIn } from '../discovery/events';
import { fnv1a32 } from '../math/fnv1a';
import { createRng } from '../math/rng';
import type { Vec2 } from '../math/vec2';
import { securityHere } from '../pirates/sectors';
import { guildCorridorAt, sectorIdAt, sectorInfo, type Security } from '../regions';
import { areaOf, sectorEpoch, sectorState } from '../sector/sector';
import { siteStorms } from '../sites/derelict';
import type { SimEvent, SimState } from '../Simulation';
import { CHUNK_SIZE, chunkCoord } from '../world/chunks';
import { hash3 } from '../world/hash';
import { stationAt } from '../world/stations';
import { ambushBearing, ambushBudgetOk, ambushMembers, ambushParty, spawnAmbush, stepAmbushHail } from './ambush';
import { cometFlybyEvents, stepCometFlyby } from './cometFlyby';
import { convoyFlybyEvents, stepConvoyFlyby } from '../convoys/flyby';
import { showerOf, stepShower } from './micrometeors';
import type { ActiveEvent } from './types';

const TICKS = 60;
/** Length of a director bucket (ticks). */
export const BUCKET_TICKS = DIRECTOR.bucketSeconds * TICKS;

// ---------------------------------------------------------------------------
// rolls (pure)

export interface BucketRoll {
  /** Trigger tick − bucket start. */
  offset: number;
  /** One uniform roll per rolled kind, drawn in `ROLLED_EVENT_ORDER`. */
  rolls: Record<RolledEventKind, number>;
}

const rollMemo = new Map<string, BucketRoll>();

/** The director's draw for (seed, sector, bucket): always the offset and every kind's roll, in a fixed order. */
export function rollBucket(seed: number, sector: string, bucket: number): BucketRoll {
  const memoKey = `${seed}|${sector}|${bucket}`;
  const known = rollMemo.get(memoKey);
  if (known) return known;
  const rng = createRng(hash3(seed ^ DIRECTOR.salt, fnv1a32(sector), bucket));
  const [lo, hi] = DIRECTOR.offsetSeconds;
  const offset = Math.floor((lo + rng() * (hi - lo)) * TICKS);
  const rolls = {} as Record<RolledEventKind, number>;
  for (const kind of ROLLED_EVENT_ORDER) rolls[kind] = rng();
  const roll = { offset, rolls };
  if (rollMemo.size >= 256) rollMemo.clear();
  rollMemo.set(memoKey, roll);
  return roll;
}

/** What the chance of a rolled kind depends on (at the trigger tick). */
export interface RollContext {
  depth: RingIndex;
  security: Security;
  /** Inside a Guild Lane corridor. */
  corridor: boolean;
  /** Local condition ids of the sector now. */
  modifiers: readonly string[];
  /** The AI budget allows an ambush (`ambushBudgetOk`). */
  budget: boolean;
}

/** Rate per bucket by depth (data/events.ts). */
const RATES: Record<RolledEventKind, Record<RingIndex, number>> = { ambush: AMBUSH.rate, micrometeors: MICROMETEORS.rate };

/** Chance of a rolled kind per bucket. */
export function rolledChance(kind: RolledEventKind, ctx: RollContext): number {
  let p = RATES[kind][ctx.depth] * DIRECTOR.securityWeight[kind][ctx.security];
  if (ctx.corridor) p *= DIRECTOR.corridor[kind];
  if (kind === 'ambush') {
    if (!ctx.budget) return 0;
    for (const m of ctx.modifiers) p *= DIRECTOR.modifierMult[m] ?? 1;
  }
  return p;
}

/** The bucket's event: the first kind in `ROLLED_EVENT_ORDER` whose roll is below its chance, or null. */
export function pickRolledKind(roll: BucketRoll, ctx: RollContext): RolledEventKind | null {
  for (const kind of ROLLED_EVENT_ORDER) if (roll.rolls[kind] < rolledChance(kind, ctx)) return kind;
  return null;
}

// ---------------------------------------------------------------------------
// keys and the running rolled events

export const rolledKey = (kind: RolledEventKind, sector: string, bucket: number): string => `ev:${kind}:${sector}@${bucket}`;

export interface RolledKey {
  kind: RolledEventKind;
  sector: string;
  bucket: number;
}

const KEY_RE = /^ev:(ambush|micrometeors):(.+)@(\d+)$/;
const keyMemo = new Map<string, RolledKey | null>();

/** Parses a rolled event key (`ev:<kind>:<sector>@<bucket>`), else null (other owners' keys, markers). */
export function parseRolledKey(key: string): RolledKey | null {
  let parsed = keyMemo.get(key);
  if (parsed !== undefined) return parsed;
  const m = KEY_RE.exec(key);
  parsed = m ? { kind: m[1] as RolledEventKind, sector: m[2]!, bucket: Number(m[3]) } : null;
  if (keyMemo.size >= 512) keyMemo.clear();
  keyMemo.set(key, parsed);
  return parsed;
}

interface RolledEvent extends RolledKey {
  key: string;
  depth: RingIndex;
  /** Trigger (warning) tick, the first tick and the end (exclusive; an ambush: = start). */
  fired: number;
  start: number;
  end: number;
  /** Micrometeors: the stream comes from here. */
  dir: number | null;
}

/** A rolled event re-derived from its key and trigger tick, or null for a foreign / unknown key. */
function rolledEvent(state: SimState, key: string, fired: number): RolledEvent | null {
  const k = parseRolledKey(key);
  if (!k) return null;
  const info = sectorInfo(state.seed, k.sector);
  if (!info) return null;
  const start = fired + EVENT_DEFS[k.kind].leadSeconds * TICKS;
  if (k.kind === 'micrometeors') {
    const shower = showerOf(state.seed, k.sector, k.bucket);
    return { ...k, key, depth: info.depth, fired, start, end: start + shower.duration, dir: shower.dir };
  }
  return { ...k, key, depth: info.depth, fired, start, end: start, dir: null };
}

/** The director's rolled events in `fired`, in key order (independent of the map's insertion order). */
function rolledEvents(state: SimState): RolledEvent[] {
  const out: RolledEvent[] = [];
  for (const key of [...state.director.fired.keys()].sort()) {
    const ev = rolledEvent(state, key, state.director.fired.get(key)!);
    if (ev) out.push(ev);
  }
  return out;
}

/** The tick the event was over (micrometeors: its end; ambush: its party was gone), or null while it runs. */
function overAt(state: SimState, ev: RolledEvent): number | null {
  if (ev.kind === 'micrometeors') return state.tick >= ev.end ? ev.end : null;
  return state.director.fired.get(`${ev.key}#end`) ?? null;
}

const isOver = (state: SimState, ev: RolledEvent): boolean => overAt(state, ev) !== null;

// ---------------------------------------------------------------------------
// gating

/** The gates that do not depend on the roll: flying, alive, not berthed, no training, epoch, quiet window. */
export function directorOpen(state: SimState): boolean {
  const player = state.player;
  if (player.dock.mode !== 'flying' || player.destroyed || state.sites.berth !== null) return false;
  if (state.career.training.status === 'active') return false;
  if (sectorEpoch(state.tick) < DIRECTOR.minEpoch) return false;
  return state.tick - state.director.last >= DIRECTOR.quietSeconds * TICKS;
}

/** Some station (home included) lies within `DIRECTOR.stationClear` of the point. */
export function nearStation(state: SimState, pos: Vec2): boolean {
  const r = DIRECTOR.stationClear;
  for (let cx = chunkCoord(pos.x - r - CHUNK_SIZE); cx <= chunkCoord(pos.x + r + CHUNK_SIZE); cx++) {
    for (let cy = chunkCoord(pos.y - r - CHUNK_SIZE); cy <= chunkCoord(pos.y + r + CHUNK_SIZE); cy++) {
      const s = stationAt(state.seed, cx, cy, state.world.gen);
      if (s && Math.hypot(s.pos.x - pos.x, s.pos.y - pos.y) < r) return true;
    }
  }
  return false;
}

/** The roll context at the player's position in `sector` now. */
export function rollContext(state: SimState, sector: string, pos: Vec2): RollContext {
  return {
    depth: (sectorInfo(state.seed, sector)?.depth ?? 1) as RingIndex,
    security: securityHere(state, pos),
    corridor: guildCorridorAt(state.seed, pos.x, pos.y),
    modifiers: sectorState(state.seed, sector, sectorEpoch(state.tick)).modifiers.map((m) => m.id),
    budget: ambushBudgetOk(state),
  };
}

// ---------------------------------------------------------------------------
// step

/** Fires a rolled event now: one-shot key, the quiet window, the radio warning. */
function fire(state: SimState, kind: RolledEventKind, sector: string, bucket: number, events: SimEvent[]): boolean {
  const key = rolledKey(kind, sector, bucket);
  const director = state.director;
  if (director.fired.has(key)) return false;
  director.fired.set(key, state.tick);
  const ev = rolledEvent(state, key, state.tick);
  if (!ev) {
    director.fired.delete(key);
    return false;
  }
  director.last = Math.max(director.last, ev.end);
  const dir = ev.dir ?? ambushDir(state, ev);
  events.push({ type: 'eventWarning', key, kind, inSeconds: EVENT_DEFS[kind].leadSeconds, dir });
  return true;
}

/** Bearing of an ambush party from the player now. */
function ambushDir(state: SimState, ev: RolledEvent): number {
  return ambushBearing(state, ambushParty(state.seed, ev.sector, ev.bucket, ev.depth).bearing, state.player.body.pos);
}

/** The bucket's rolled event at its trigger tick, when every gate is open. */
function trigger(state: SimState, events: SimEvent[]): void {
  if (!directorOpen(state)) return;
  const pos = state.player.body.pos;
  const sector = sectorIdAt(state.seed, pos.x, pos.y);
  const bucket = Math.floor(state.tick / BUCKET_TICKS);
  const roll = rollBucket(state.seed, sector, bucket);
  if (state.tick !== bucket * BUCKET_TICKS + roll.offset) return;
  if (nearStation(state, pos)) return;
  const kind = pickRolledKind(roll, rollContext(state, sector, pos));
  if (kind) fire(state, kind, sector, bucket, events);
}

/** Starts, rays, spawns, hails and ends of the running rolled events. */
function progress(state: SimState, events: SimEvent[]): void {
  const tick = state.tick;
  const player = state.player;
  const director = state.director;
  for (const ev of rolledEvents(state)) {
    if (ev.kind === 'micrometeors') {
      if (tick === ev.start) events.push({ type: 'eventStarted', key: ev.key, kind: ev.kind, end: ev.end, dir: ev.dir! });
      if (tick >= ev.start && tick < ev.end) stepShower(state, ev.sector, ev.bucket, ev.start, ev.dir!, ev.depth, events);
      if (tick === ev.end) events.push({ type: 'eventEnded', key: ev.key, kind: ev.kind });
      continue;
    }
    if (tick === ev.start) {
      const flying = player.dock.mode === 'flying' && !player.destroyed && state.sites.berth === null;
      const spawned = flying ? spawnAmbush(state, ev.sector, ev.bucket, ev.depth) : null;
      events.push({ type: 'eventStarted', key: ev.key, kind: ev.kind, end: ev.end, ...(spawned ? { dir: spawned.bearing, pos: spawned.pos } : {}) });
      if (spawned) events.push({ type: 'ambushSpawned', key: ev.key, count: spawned.count, pos: spawned.pos, leader: spawned.leader });
    } else if (tick > ev.start && !director.fired.has(`${ev.key}#end`)) {
      stepAmbushHail(state, ev.key, ev.sector, ev.bucket, events);
      if (ambushMembers(state, ev.sector, ev.bucket).length === 0) {
        director.fired.set(`${ev.key}#end`, tick);
        director.last = Math.max(director.last, tick);
        events.push({ type: 'eventEnded', key: ev.key, kind: ev.kind });
      }
    }
  }
}

/**
 * Drops one-shot keys `pruneBuckets` buckets after their event is over (the director's own, with their
 * markers) or after their tick (other owners' keys – a comet flyby stores the tick its pass ends).
 */
function prune(state: SimState): void {
  const fired = state.director.fired;
  const keep = DIRECTOR.pruneBuckets * BUCKET_TICKS;
  for (const [key, t] of [...fired]) {
    const marker = /^(.*)#(hail|end)$/.exec(key);
    if (marker) {
      if (!fired.has(marker[1]!)) fired.delete(key);
      continue;
    }
    const ev = rolledEvent(state, key, t);
    // foreign keys (comet flyby: its end tick) go `keep` after their tick
    const over = ev ? overAt(state, ev) : t;
    if (over === null || state.tick - over <= keep) continue;
    fired.delete(key);
    fired.delete(`${key}#hail`);
    fired.delete(`${key}#end`);
  }
}

/** One director step (after the pirate step): warnings, starts, ends, micrometeor rays, ambush spawns. */
export function stepDirector(state: SimState, events: SimEvent[]): void {
  trigger(state, events);
  progress(state, events);
  stepCometFlyby(state, events);
  stepConvoyFlyby(state, events);
  prune(state);
}

// ---------------------------------------------------------------------------
// listing (HUD chip, radio, map)

/** Legacy events at the player: the ion storm around it, distress signals within hearing. */
function legacyEvents(state: SimState): ActiveEvent[] {
  const out: ActiveEvent[] = [];
  const { seed, tick } = state;
  const pos = state.player.body.pos;
  for (const ds of distressNear(seed, pos, DISTRESS.hearRange, tick)) {
    if (state.discovery.opened.has(ds.id)) continue;
    const start = distressBucket(tick) * DISTRESS.bucketSeconds * TICKS;
    out.push({ key: ds.id, kind: 'distress', start, end: ds.until, pos: { ...ds.pos } });
  }
  const storm = ionStormIn(seed, pos, tick);
  if (storm && tick >= storm.start && tick < storm.end) {
    const a = areaOf(pos);
    const bucket = Math.floor(tick / (ION_STORM.bucketSeconds * TICKS));
    out.push({ key: `ev:ionStorm:${a.ax},${a.ay}@${bucket}`, kind: 'ionStorm', start: storm.start, end: storm.end });
  }
  for (const s of siteStorms(state)) {
    if (tick < s.start || tick >= s.end || Math.hypot(pos.x - s.pos.x, pos.y - s.pos.y) > s.radius) continue;
    out.push({ key: `ev:ionStorm:${s.id}@${s.start}`, kind: 'ionStorm', start: s.start, end: s.end, pos: { ...s.pos } });
  }
  return out;
}

/** The running (or announced) rolled events. */
function listRolled(state: SimState): ActiveEvent[] {
  const out: ActiveEvent[] = [];
  for (const ev of rolledEvents(state)) {
    if (isOver(state, ev)) continue;
    if (ev.kind === 'micrometeors') {
      out.push({ key: ev.key, kind: ev.kind, start: ev.start, end: ev.end, dir: ev.dir!, sector: ev.sector });
      continue;
    }
    const base = { key: ev.key, kind: ev.kind, start: ev.start, end: ev.end, sector: ev.sector };
    if (state.tick < ev.start) {
      const dir = ambushDir(state, ev);
      const p = state.player.body.pos;
      out.push({ ...base, dir, pos: { x: p.x + Math.cos(dir) * AMBUSH.spawnDistance, y: p.y + Math.sin(dir) * AMBUSH.spawnDistance } });
      continue;
    }
    const lead = ambushMembers(state, ev.sector, ev.bucket)[0];
    const p = state.player.body.pos;
    out.push({ ...base, open: true, ...(lead ? { pos: { ...lead.body.pos }, dir: Math.atan2(lead.body.pos.y - p.y, lead.body.pos.x - p.x) } : {}) });
  }
  return out;
}

const KIND_ORDER: Readonly<Record<DirectorEventKind, number>> = { ambush: 0, micrometeors: 1, ionStorm: 2, cometFlyby: 3, convoyFlyby: 4, distress: 5 };

/** Every event the director lists now (legacy + rolled + derived), for the HUD chip, radio and map. */
export function activeEvents(state: SimState): ActiveEvent[] {
  const all = [...listRolled(state), ...legacyEvents(state), ...cometFlybyEvents(state), ...convoyFlybyEvents(state)];
  return all.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// ---------------------------------------------------------------------------
// debugEvent (dev builds only)

/** `debugEvent { kind }` – dev builds only (the game sends it only with `import.meta.env.DEV`). */
export const isDirectorAction = (a: GameAction): boolean => a.type === 'debugEvent';

/**
 * Forces a rolled event (micrometeors, ambush) in the player's sector and bucket now – no roll, no
 * gates except that the player flies (e2e, dev hooks). Legacy and derived kinds cannot be forced.
 * Production builds answer "unavailable".
 */
export function directorAction(state: SimState, action: GameAction): SimEvent[] {
  const fail: SimEvent[] = [{ type: 'actionResult', reqId: action.reqId, ok: false, reason: 'serviceUnavailable' }];
  if (action.type !== 'debugEvent' || !import.meta.env.DEV) return fail;
  if (action.kind !== 'micrometeors' && action.kind !== 'ambush') return fail;
  const player = state.player;
  if (player.dock.mode !== 'flying' || player.destroyed || state.sites.berth !== null) return fail;
  const pos = player.body.pos;
  const events: SimEvent[] = [];
  const ok = fire(state, action.kind, sectorIdAt(state.seed, pos.x, pos.y), Math.floor(state.tick / BUCKET_TICKS), events);
  return ok ? [{ type: 'actionResult', reqId: action.reqId, ok: true }, ...events] : fail;
}
