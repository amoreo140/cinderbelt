// The escort contract (M4d plan §2.7) – OWNED BY T6.
//
// Offer (`escortOffer`): at stations within `ESCORT.offerRange` of a lane (`escortAvailable` – the board
// rolls `escort` only there). The stretch lies on the lane's convoy route (schedule.ts `convoyRoutes`:
// the lane centre line offset to the right, clear of stations), on its outbound or its inbound leg, from
// the route point nearest the station, `ESCORT.segment` long (cut at the leg's end, at least the
// minimum), and crosses at least one sector dangerous by the CURRENT security (`BoardContext.security`).
// 1 (risk 0.25) or 2 (risk 0.5) ambush points inside the dangerous part, ≥ `ESCORT.ambushSpacing`
// apart – everything from the slip's rng, so deterministic from the offer id. `from` / `to` / the
// ambushes are arc lengths along the ROUTE polyline (to > from on both legs – the inbound leg follows
// the U-turn on the same polyline).
//
// Flow: accept → the deposit (`escortDeposit`, 10 % of the frozen reward, at most the credits the
// player has) and the convoy `es:<serial>:trader` (+ `:tanker` by the offer id's hash) waits at `meet`.
// A free cancel ≤ 2 min before the convoy departed (`escortUnderway`) gives the deposit back, a later
// one loses it (`contractFailed abandoned`, `escortRefund`). The convoy departs when the flying player comes within `ESCORT.departRadius`
// (`escortDeparted`), flies at `ESCORT.speed`, stops while a pirate is within `ESCORT.stopRadius`
// (`escortStopped`) and resumes `resumeSeconds` after the last one left. `AMBUSH_LEAD` before each
// ambush point the party `ea:<serial>:<k>:<i>` (M4b `ambushParty` by the point's depth) is armed
// (`escortAmbush`, waits for `ambushBudgetOk`); `escortSpawns` lists it for careerSpawns, which brings
// it in `ESCORT.ambushDistance` off the lane, beside the ambush point (or beside the point
// `AMBUSH_LEAD` ahead of the trader when that is farther along – a late party), in attack mode.
// Ambushers go for the trader (npc/targets.ts); one that lost the scent patrols towards it.
// Arrival at `to` with the trader alive → state `done`, the deposit paid back, the contract ready; the
// convoy flies on `flyOnSeconds` and leaves the scene (no ships, the record stays until the turn-in).
// Failures (`stepEscortContracts` → `outcome.fail`): the trader destroyed (`traderLost`), the player
// farther than `awayRadius` from the departed convoy (or docked) for `awaySeconds` in a row
// (`abandoned`), the player destroyed (`playerLost`), the convoy not met within `waitSeconds` of the
// acceptance (`missed`). The deposit is lost (it was taken on acceptance).
// Pirates damage the escorted ships (`onConvoyHit`, hull only – no shields); the player never can (no
// friendly fire, npc/sides.ts). A scheduled convoy ship just stops the shot (sparks, no damage).
import { CONTRACT_DEFS, CRUISE_SPEED, HUNT_SECONDS_PER_ENEMY, type ContractRisk } from '../../data/contracts';
import { CONVOY, CONVOY_SHAPES, ESCORT, ESCORT_SALT, type ConvoyShipKind } from '../../data/convoys';
import type { RingIndex } from '../../data/economy';
import type { CareerSpawn } from '../career/career';
import type { Contract, ContractOutcome, ContractTarget } from '../career/types';
import { createEnemy } from '../combat/enemies';
import type { Enemy } from '../combat/types';
import type { BoardContext, ContractDraft } from '../contracts/generate';
import { ambushBudgetOk, ambushParty } from '../events/ambush';
import { fnv1a32 } from '../math/fnv1a';
import type { Rng } from '../math/rng';
import { hypot, type Vec2 } from '../math/vec2';
import type { Circle } from '../physics/collide';
import type { NpcHit, NpcHitTarget } from '../npc/types';
import { NPC_PREFIX } from '../npc/types';
import { isDangerousSecurity, laneDistance, NO_SECURITY_OVERRIDES, sectorIdAt, sectorInfoAt, sectorLanes, sectorSecurity, type LaneId, type Security, type SecurityOverrides } from '../regions';
import type { SimEvent, SimState } from '../Simulation';
import { hash3 } from '../world/hash';
import { ringIndexAt } from '../world/rings';
import { convoyRoutes, convoyShipCircles, type ConvoyRoute } from './schedule';
import type { EscortState } from './types';

type EscortTarget = Extract<ContractTarget, { kind: 'escort' }>;

const TICKS = 60;
const NO_CIRCLES: readonly Circle[] = [];
const NO_TARGETS: readonly NpcHitTarget[] = [];

/** The danger of a stretch is sampled this often along the route (u). */
const SAMPLE_STEP = 50;
/** The first ambush point lies at least this far past the meeting point, the last this far before the end (u). */
const AMBUSH_START_GAP = 400;
const AMBUSH_END_GAP = 200;
/** A party is armed when the trader is this far before its ambush point (u): the spawn point is ~335 u ahead-aside. */
export const AMBUSH_LEAD = 150;
/** Party members spawn this far from the party's spawn point (u). */
const PARTY_SPREAD = 12;
/** Chance of two ambushes (risk 0.5) when the dangerous part has room for two: through a Pirate sector, else. */
const TWO_AMBUSH_CHANCE = { pirate: 0.7, contested: 0.4 } as const;
/**
 * Ambush ships the duration estimate counts per ambush (× `HUNT_SECONDS_PER_ENEMY`). A party has 2–3 ships, but
 * the convoy stands still only while they fight: a P2 pilot (seeds 1–10) lost a median 77 s per ambush, so
 * 1.5 × 75 s puts the estimate at ≈ 1.08 × the real time (3 made it 1.4 × – escorts paid ~2 × the reference
 * income per real hour; econ model `M4D.escort.ambushShips`).
 */
const AMBUSH_SHIPS_ESTIMATE = 1.5;

// ---------------------------------------------------------------------------
// route geometry (the lane's convoy route, schedule.ts)

/** The convoy route of a lane (null: the lane is too short for convoys). */
const routeOf = (seed: number, lane: LaneId): ConvoyRoute | null => convoyRoutes(seed).find((r) => r.lane === lane) ?? null;

/** Index of the route segment that holds arc `s` (clamped to the ends). */
function segmentAt(arc: readonly number[], s: number): number {
  let lo = 0;
  let hi = arc.length - 1;
  if (s <= arc[0]!) return 0;
  if (s >= arc[hi]!) return Math.max(0, hi - 1);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arc[mid]! <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Point and unit direction at arc `s` of a route (beyond its ends extrapolated along the end segments). */
function routePoint(route: ConvoyRoute, s: number): { pos: Vec2; dir: Vec2 } {
  const i = segmentAt(route.arc, s);
  const a = route.points[i]!;
  const b = route.points[i + 1] ?? a;
  const len = hypot(b.x - a.x, b.y - a.y);
  const dir = len > 1e-9 ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : { x: 1, y: 0 };
  const t = s - route.arc[i]!;
  return { pos: { x: a.x + dir.x * t, y: a.y + dir.y * t }, dir };
}

/** The route's legs as arc ranges: out to the U-turn, back after it. */
const legs = (route: ConvoyRoute): { out: [number, number]; back: [number, number] } => ({
  out: [0, route.outLen],
  back: [route.outLen + route.turnLen, route.outLen + route.turnLen + route.backLen],
});

/** The arc of the leg's point nearest `p` (projected onto the route segments within the leg). */
function nearestArc(route: ConvoyRoute, [lo, hi]: readonly [number, number], p: Vec2): number {
  let best = lo;
  let bestD = Infinity;
  const { points, arc } = route;
  for (let i = 0; i + 1 < points.length; i++) {
    if (arc[i + 1]! < lo || arc[i]! > hi) continue;
    const a = points[i]!;
    const b = points[i + 1]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2)) : 0;
    const d = hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
    if (d < bestD) {
      bestD = d;
      best = Math.max(lo, Math.min(hi, arc[i]! + t * Math.sqrt(len2)));
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// the offer

/** The station lies within `ESCORT.offerRange` of a Guild Lane (the board may roll an escort). */
export function escortAvailable(ctx: BoardContext): boolean {
  const { x, y } = ctx.station.pos;
  return laneDistance(sectorLanes(ctx.seed), x, y, ESCORT.offerRange) <= ESCORT.offerRange;
}

/** The deposit of an escort contract with this frozen reward (credits). */
export const escortDepositOf = (reward: number): number => Math.round(reward * ESCORT.deposit);

/** The dangerous samples of a stretch [from, to] by the current security: arc and whether the sector is Pirate. */
function dangerousSamples(seed: number, route: ConvoyRoute, from: number, to: number, security: SecurityOverrides): { s: number; pirate: boolean }[] {
  const out: { s: number; pirate: boolean }[] = [];
  const memo = new Map<string, Security>();
  for (let s = from + AMBUSH_START_GAP; s <= to - AMBUSH_END_GAP; s += SAMPLE_STEP) {
    const p = routePoint(route, s).pos;
    const id = sectorIdAt(seed, p.x, p.y);
    let sec = memo.get(id);
    if (sec === undefined) {
      sec = sectorSecurity(seed, id, security);
      memo.set(id, sec);
    }
    if (isDangerousSecurity(sec)) out.push({ s, pirate: sec === 'pirate' });
  }
  return out;
}

const pick = <T>(list: readonly T[], r: number): T => list[Math.min(list.length - 1, Math.floor(r * list.length))]!;

/** An escort contract draft for the board (uses the slip's rng), or null. */
export function escortOffer(ctx: BoardContext, rng: Rng): ContractDraft | null {
  // every roll is drawn first: the slip's stream does not depend on which candidate fits
  const outbound = rng() < 0.5;
  const want = ESCORT.segment[0] + rng() * (ESCORT.segment[1] - ESCORT.segment[0]);
  const countRoll = rng();
  const first = rng();
  const second = rng();
  const at = ctx.station.pos;
  const security = ctx.security ?? NO_SECURITY_OVERRIDES;
  const lanes = sectorLanes(ctx.seed)
    .map((l) => ({ id: l.id, d: laneDistance([l], at.x, at.y, ESCORT.offerRange) }))
    .filter((l) => l.d <= ESCORT.offerRange)
    .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
  for (const lane of lanes) {
    const route = routeOf(ctx.seed, lane.id);
    if (!route) continue;
    const { out, back } = legs(route);
    for (const leg of outbound ? [out, back] : [back, out]) {
      const from = nearestArc(route, leg, at);
      const left = leg[1] - from;
      if (left < ESCORT.segment[0]) continue;
      const to = from + Math.min(left, want);
      const danger = dangerousSamples(ctx.seed, route, from, to, security);
      if (danger.length === 0) continue;
      const a = pick(danger, first).s;
      const apart = danger.filter((d) => Math.abs(d.s - a) >= ESCORT.ambushSpacing);
      const two = apart.length > 0 && countRoll < (danger.some((d) => d.pirate) ? TWO_AMBUSH_CHANCE.pirate : TWO_AMBUSH_CHANCE.contested);
      const ambushes = two ? [a, pick(apart, second).s].sort((x, y) => x - y) : [a];
      const meet = routePoint(route, from).pos;
      const end = routePoint(route, to).pos;
      const points = [meet, end, ...ambushes.map((s) => routePoint(route, s).pos)];
      const ring = Math.max(...points.map((p) => ringIndexAt(hypot(p.x, p.y)))) as RingIndex;
      const unlock = CONTRACT_DEFS.escort.unlock[ring];
      if (unlock === undefined || !ctx.unlocks.has(unlock)) continue;
      const risk: ContractRisk = ambushes.length === 2 ? 0.5 : 0.25;
      return {
        ring,
        risk,
        target: { kind: 'escort', lane: lane.id, from, to, meet, end, ambushes },
        // the sector state of the (first) ambush – where the contract's danger is
        where: routePoint(route, ambushes[0]!).pos,
      };
    }
  }
  return null;
}

/** Duration estimate of an escort contract beyond the overhead (s): to the meeting point, the stretch, the ambushes. */
export function escortSeconds(origin: Vec2, target: EscortTarget): number {
  const travel = hypot(target.meet.x - origin.x, target.meet.y - origin.y) / CRUISE_SPEED;
  return travel + Math.abs(target.to - target.from) / ESCORT.speed + target.ambushes.length * AMBUSH_SHIPS_ESTIMATE * HUNT_SECONDS_PER_ENEMY;
}

// ---------------------------------------------------------------------------
// the convoy ships

/** Does the escort of this offer fly a tanker? (Deterministic from the offer id.) */
export const escortHasTanker = (seed: number, offerId: string): boolean => hash3(seed ^ ESCORT_SALT, fnv1a32(offerId), 0x7a4c) / 4294967296 < ESCORT.tankerChance;

/** The ship kinds of an escort record (trader first, then the tanker when it has one). */
const kindsOf = (e: EscortState): readonly ConvoyShipKind[] => (e.hulls.length > 1 ? TRADER_TANKER : TRADER_ONLY);
const TRADER_ONLY: readonly ConvoyShipKind[] = ['trader'];
const TRADER_TANKER: readonly ConvoyShipKind[] = ['trader', 'tanker'];

/** The id of an escort convoy ship. */
export const escortShipId = (serial: number, kind: ConvoyShipKind): string => `${NPC_PREFIX.escort}${serial}:${kind}`;

/** Serial and ship index of an escort ship id `es:<serial>:<kind>`, or null. */
function parseEscortShip(id: string): { serial: number; index: number } | null {
  const m = /^es:(\d{1,9}):(trader|tanker)$/.exec(id);
  return m ? { serial: Number(m[1]), index: m[2] === 'trader' ? 0 : 1 } : null;
}

export interface EscortShipPose {
  id: string;
  kind: ConvoyShipKind;
  index: number;
  pos: Vec2;
  heading: number;
  vel: Vec2;
}

/** Is the convoy flying this step (its ships have the cruise velocity)? */
const flying = (e: EscortState): boolean => e.state === 'moving' || e.state === 'done';

/** How far the convoy flies on after its arrival before it leaves the scene (u). */
const FLY_ON = ESCORT.speed * ESCORT.flyOnSeconds;

/** An arrived convoy that has flown on and left (its record stays until the contract is turned in). */
const gone = (e: EscortState, target: EscortTarget): boolean => e.state === 'done' && e.progress >= target.to + FLY_ON - 1e-6;

/**
 * The last poses of an escort record with everything they depend on, plus what is derived from them
 * (projectile targets, collision circles per ship) – the poses are asked for by every obstacle and target
 * query of a step (perf audit 2026-10-17, P4). Answers are shared: read-only.
 */
interface EscortPoses {
  seed: number;
  serial: number;
  target: EscortTarget;
  progress: number;
  state: EscortState['state'];
  hullCount: number;
  hull0: number;
  hull1: number;
  ships: EscortShipPose[];
  targets: NpcHitTarget[] | null;
  circles: (Circle[] | undefined)[];
}

const posesOf = new WeakMap<EscortState, EscortPoses>();

/** The memo entry of an escort's current poses (built when anything they depend on changed). */
function escortPoses(state: SimState, serial: number, e: EscortState, target: EscortTarget): EscortPoses {
  const m = posesOf.get(e);
  const hull0 = e.hulls[0] ?? 0;
  const hull1 = e.hulls[1] ?? 0;
  if (
    m &&
    m.seed === state.seed &&
    m.serial === serial &&
    m.target === target &&
    m.progress === e.progress &&
    m.state === e.state &&
    m.hullCount === e.hulls.length &&
    m.hull0 === hull0 &&
    m.hull1 === hull1
  ) {
    return m;
  }
  const fresh: EscortPoses = {
    seed: state.seed,
    serial,
    target,
    progress: e.progress,
    state: e.state,
    hullCount: e.hulls.length,
    hull0,
    hull1,
    ships: buildEscortShips(state, serial, e, target),
    targets: null,
    circles: [],
  };
  posesOf.set(e, fresh);
  return fresh;
}

/** The poses of an escort's living ships (the trader at `progress`, the tanker `CONVOY.tankerGap` behind). Read-only (memoised). */
export function escortShips(state: SimState, serial: number, e: EscortState, target: EscortTarget): EscortShipPose[] {
  return escortPoses(state, serial, e, target).ships;
}

function buildEscortShips(state: SimState, serial: number, e: EscortState, target: EscortTarget): EscortShipPose[] {
  const route = routeOf(state.seed, target.lane);
  if (!route || gone(e, target)) return [];
  const out: EscortShipPose[] = [];
  kindsOf(e).forEach((kind, index) => {
    if ((e.hulls[index] ?? 0) <= 0) return;
    const at = routePoint(route, e.progress - (index === 0 ? 0 : CONVOY.tankerGap));
    const speed = flying(e) ? ESCORT.speed : 0;
    out.push({ id: escortShipId(serial, kind), kind, index, pos: at.pos, heading: Math.atan2(at.dir.y, at.dir.x), vel: { x: at.dir.x * speed, y: at.dir.y * speed } });
  });
  return out;
}

/** The trader's position of an escort (null when it is gone). */
function traderPos(state: SimState, serial: number, e: EscortState, target: EscortTarget): Vec2 | null {
  if ((e.hulls[0] ?? 0) <= 0) return null;
  const route = routeOf(state.seed, target.lane);
  return route ? routePoint(route, e.progress).pos : null;
}

interface EscortEntry {
  serial: number;
  e: EscortState;
  c: Contract;
  t: EscortTarget;
}

const NO_ESCORTS: readonly EscortEntry[] = [];
/** The last answer of `escortsWithContracts` (rebuilt into a new list when anything differs – a caller may still iterate the old one). */
let lastEscorts: EscortEntry[] = [];

/** Each escort record with its contract (records without an escort contract are skipped). Read-only. */
function escortsWithContracts(state: SimState): readonly EscortEntry[] {
  const escorts = state.convoys.escorts;
  if (escorts.size === 0) return NO_ESCORTS;
  // the same records as last time → the same list (no list per query – perf audit 2026-10-17, P4)
  let k = 0;
  let same = true;
  for (const c of state.career.contracts) {
    if (c.target.kind !== 'escort') continue;
    const e = escorts.get(c.serial);
    if (!e) continue;
    const prev = lastEscorts[k++];
    if (!prev || prev.c !== c || prev.e !== e || prev.serial !== c.serial || prev.t !== c.target) {
      same = false;
      break;
    }
  }
  if (same && k === lastEscorts.length) return lastEscorts;
  const out: EscortEntry[] = [];
  for (const c of state.career.contracts) {
    if (c.target.kind !== 'escort') continue;
    const e = escorts.get(c.serial);
    if (e) out.push({ serial: c.serial, e, c, t: c.target });
  }
  lastEscorts = out;
  return out;
}

/** Escort convoy ship circles within `reach` of `pos` (safe, moving obstacles). */
export function escortColliders(state: SimState, pos: Vec2, reach: number): readonly Circle[] {
  if (state.convoys.escorts.size === 0) return NO_CIRCLES;
  let out: Circle[] | null = null;
  for (const { serial, e, t } of escortsWithContracts(state)) {
    const poses = escortPoses(state, serial, e, t);
    for (let k = 0; k < poses.ships.length; k++) {
      const s = poses.ships[k]!;
      const bound = CONVOY_SHAPES[s.kind].radius;
      if (hypot(s.pos.x - pos.x, s.pos.y - pos.y) > reach + bound) continue;
      // the circles of a pose are built once (shared, read-only)
      for (const circle of (poses.circles[k] ??= convoyShipCircles(s.kind, s.pos, s.heading, s.vel))) {
        if (hypot(circle.pos.x - pos.x, circle.pos.y - pos.y) - circle.radius <= reach) (out ??= []).push(circle);
      }
    }
  }
  return out ?? NO_CIRCLES;
}

/**
 * Every living escort convoy ship as a projectile target (kind 'convoy', damageable, no shield): one target
 * per ship with its bounding radius – the AI budget (`npcBudgetLeft`) counts these, and the ambushers look
 * the trader up by its id `es:<serial>:trader`.
 */
export function escortHitTargets(state: SimState): readonly NpcHitTarget[] {
  if (state.convoys.escorts.size === 0) return NO_TARGETS;
  let out: NpcHitTarget[] | null = null;
  let only: NpcHitTarget[] | null = null;
  for (const { serial, e, t } of escortsWithContracts(state)) {
    const poses = escortPoses(state, serial, e, t);
    // the targets of a pose are built once (shared, read-only)
    const targets = (poses.targets ??= poses.ships.map(
      (s): NpcHitTarget => ({ id: s.id, kind: 'convoy', pos: s.pos, vel: s.vel, radius: CONVOY_SHAPES[s.kind].radius, shield: 0, damageable: true }),
    ));
    if (targets.length === 0) continue;
    if (out) for (const x of targets) out.push(x);
    else if (only) out = [...only, ...targets];
    else only = targets;
  }
  return out ?? only ?? NO_TARGETS;
}

/** A projectile hit a convoy ship (escorted: hull damage, `npcHit` / `npcDestroyed`; scheduled: a spent hit). */
export function onConvoyHit(state: SimState, target: NpcHitTarget, hit: NpcHit, events: SimEvent[]): void {
  const ship = parseEscortShip(target.id);
  if (!ship) {
    // a scheduled convoy ship never takes damage: the shot stops at its hull (sparks, like the relay mast)
    events.push({ type: 'projectileHit', target: 'station', owner: hit.owner, ref: null, pos: { ...hit.pos }, damage: hit.damage, from: { ...hit.from }, site: target.id });
    return;
  }
  const e = state.convoys.escorts.get(ship.serial);
  const hull = e?.hulls[ship.index] ?? 0;
  if (!e || hull <= 0) return;
  e.hulls[ship.index] = Math.max(0, hull - hit.damage);
  events.push({ type: 'npcHit', id: target.id, pos: { ...hit.pos }, damage: hit.damage, shielded: false, by: hit.owner });
  if (e.hulls[ship.index]! > 0) return;
  events.push({ type: 'npcDestroyed', id: target.id, kind: ship.index === 0 ? 'trader' : 'tanker', pos: { ...target.pos }, by: hit.owner });
}

// ---------------------------------------------------------------------------
// acceptance and cancellation

/** A new escort record: the convoy waits at the meeting point. */
function newEscort(state: SimState, c: Contract, t: EscortTarget, deposit: number): EscortState {
  const hulls = escortHasTanker(state.seed, c.id) ? [ESCORT.traderHull, ESCORT.tankerHull] : [ESCORT.traderHull];
  return { progress: t.from, state: 'waiting', departed: null, away: 0, stopUntil: 0, fired: 0, hulls, deposit };
}

/** The deposit of an accepted escort contract (credits taken; events) and its convoy at the meeting point. */
export function escortDeposit(state: SimState, contract: Contract): SimEvent[] {
  if (contract.target.kind !== 'escort') return [];
  const deposit = Math.max(0, Math.min(Math.floor(state.credits), escortDepositOf(contract.reward)));
  state.credits -= deposit;
  state.convoys.escorts.set(contract.serial, newEscort(state, contract, contract.target, deposit));
  return deposit > 0 ? [{ type: 'creditsChanged', delta: -deposit, reason: 'contract' }] : [];
}

/**
 * Is an escort under way – its convoy departed or an ambush armed? Then a cancel is never free (`abandon`):
 * accept → shoot the ambush down → cancel → accept would arm a fresh party for its loot again and again
 * (saboteur G2, the same rule as a hunt already fought – M12).
 */
export function escortUnderway(state: SimState, serial: number): boolean {
  const e = state.convoys.escorts.get(serial);
  return !!e && (e.state !== 'waiting' || e.departed !== null || e.fired !== 0);
}

/** An escort contract abandoned: the deposit back on a free cancel, else lost (and the failure `abandoned`). */
export function escortRefund(state: SimState, contract: Contract, refunded: boolean): SimEvent[] {
  if (contract.target.kind !== 'escort') return [];
  const e = state.convoys.escorts.get(contract.serial);
  state.convoys.escorts.delete(contract.serial);
  // a contract already done (its deposit was paid back on arrival) is just given up
  if (contract.ready || e?.state === 'done') return [];
  const deposit = e?.deposit ?? 0;
  // a free cancel (`abandon`: within FREE_CANCEL_TICKS – the slip goes back on the board)
  if (refunded) {
    if (deposit <= 0) return [];
    state.credits += deposit;
    return [{ type: 'creditsChanged', delta: deposit, reason: 'contract' }];
  }
  return [{ type: 'contractFailed', contractId: contract.serial, reason: 'abandoned' }];
}

// ---------------------------------------------------------------------------
// the ambushes

/** The bit of ambush `k` in `EscortState.fired`. */
const bit = (k: number): number => 1 << k;

/** The id of ship `i` of ambush `k` of an escort. */
export const escortAmbushId = (serial: number, k: number, i: number): string => `ea:${serial}:${k}:${i}`;

/**
 * Where ambush `k`'s party spawns: `ESCORT.ambushDistance` off the route (side by hash) beside the ambush
 * point – or, for a party armed late (the AI budget was full) or brought back after a despawn, beside the
 * point `AMBUSH_LEAD` ahead of the trader at `progress`, so it always comes out ahead of the convoy.
 */
export function escortAmbushPoint(seed: number, serial: number, target: EscortTarget, k: number, progress = -Infinity): Vec2 | null {
  const route = routeOf(seed, target.lane);
  const s = target.ambushes[k];
  if (!route || s === undefined) return null;
  const { pos, dir } = routePoint(route, Math.max(s, progress + AMBUSH_LEAD));
  const side = hash3(seed ^ ESCORT_SALT, serial, k) & 1 ? 1 : -1;
  return { x: pos.x - dir.y * side * ESCORT.ambushDistance, y: pos.y + dir.x * side * ESCORT.ambushDistance };
}

/** The party of ambush `k`: kinds by the depth of the ambush point's sector (`ambushParty`). */
function partyOf(seed: number, serial: number, target: EscortTarget, k: number) {
  const route = routeOf(seed, target.lane);
  const at = route ? routePoint(route, target.ambushes[k] ?? target.from).pos : target.meet;
  const info = sectorInfoAt(seed, at.x, at.y);
  return ambushParty(seed, info.id, serial * 4 + k, Math.min(4, Math.max(1, info.depth)) as RingIndex);
}

/** The ambush parties of the active escorts (listed by `careerSpawns` – it spawns them near the player). */
export function escortSpawns(state: SimState): CareerSpawn[] {
  if (state.convoys.escorts.size === 0) return [];
  const out: CareerSpawn[] = [];
  for (const { serial, e, c, t } of escortsWithContracts(state)) {
    if (c.ready || e.state === 'done' || e.fired === 0) continue;
    const route = routeOf(state.seed, t.lane);
    if (!route) continue;
    t.ambushes.forEach((s, k) => {
      if ((e.fired & bit(k)) === 0) return;
      const at = escortAmbushPoint(state.seed, serial, t, k, e.progress);
      if (!at) return;
      const lane = routePoint(route, Math.max(s, e.progress + AMBUSH_LEAD)).pos;
      const face = Math.atan2(lane.y - at.y, lane.x - at.x);
      const party = partyOf(state.seed, serial, t, k);
      party.kinds.forEach((kind, i) => {
        const id = escortAmbushId(serial, k, i);
        const pos = i === 0 ? at : { x: at.x + Math.cos(face + 1.6 + i) * PARTY_SPREAD, y: at.y + Math.sin(face + 1.6 + i) * PARTY_SPREAD };
        out.push({
          id,
          pos,
          create: (): Enemy => {
            const enemy = createEnemy({ id, kind, tier: party.tier, pos, angle: face, home: { ...lane }, orbit: i % 2 === 0 ? 1 : -1 });
            // `think` only turns to attack within its aggro range – the party comes out attacking (like `rc:`)
            enemy.ai.mode = 'attack';
            return enemy;
          },
        });
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// the step

/** A pirate (awake) within `radius` of `pos`? */
function pirateNear(state: SimState, pos: Vec2, radius: number): boolean {
  for (const en of state.combat.enemies) {
    if (en.ai.mode === 'dormant') continue;
    if (hypot(en.body.pos.x - pos.x, en.body.pos.y - pos.y) <= radius) return true;
  }
  return false;
}

/** One escort convoy's step. */
function stepEscort(state: SimState, serial: number, e: EscortState, c: Contract, t: EscortTarget, events: SimEvent[], dt: number): void {
  const { player } = state;
  const trader = traderPos(state, serial, e, t);
  // the trader is gone: the contract fails (stepEscortContracts); the record stays until then
  if (!trader) return;
  const here = !player.destroyed && player.dock.mode === 'flying';
  const toPlayer = hypot(player.body.pos.x - trader.x, player.body.pos.y - trader.y);
  if (e.state === 'waiting') {
    if (here && toPlayer <= ESCORT.departRadius) {
      e.state = 'moving';
      e.departed = state.tick;
      events.push({ type: 'escortDeparted', serial });
    }
    return;
  }
  // departed: the player keeps with the convoy (docked = away)
  e.away = here && toPlayer <= ESCORT.awayRadius ? 0 : e.away + dt;
  // pirates near the trader stop it; it resumes `resumeSeconds` after the last one left
  if (pirateNear(state, trader, ESCORT.stopRadius)) {
    if (e.state === 'moving') events.push({ type: 'escortStopped', serial });
    e.state = 'stopped';
    e.stopUntil = state.tick + ESCORT.resumeSeconds * TICKS;
  } else if (e.state === 'stopped' && state.tick >= e.stopUntil) {
    e.state = 'moving';
  }
  if (e.state === 'moving') e.progress = Math.min(t.to, e.progress + ESCORT.speed * dt);
  // the ambush parties: armed AMBUSH_LEAD before their point, once each (`fired`), within the AI budget
  t.ambushes.forEach((s, k) => {
    if ((e.fired & bit(k)) !== 0 || e.progress < s - AMBUSH_LEAD || !ambushBudgetOk(state)) return;
    e.fired |= bit(k);
    const at = escortAmbushPoint(state.seed, serial, t, k, e.progress);
    // a fresh party (an id fought down in an earlier contract does not keep it away)
    partyOf(state.seed, serial, t, k).kinds.forEach((_, i) => state.combat.defeated.delete(escortAmbushId(serial, k, i)));
    if (at) events.push({ type: 'escortAmbush', serial, pos: at });
  });
  // an ambusher that lost the trader (beyond its leash) patrols towards it until it is in reach again
  const prefix = `ea:${serial}:`;
  for (const en of state.combat.enemies) {
    if (!en.id.startsWith(prefix) || en.ai.mode !== 'patrol') continue;
    en.home = { ...trader };
    en.ai.mode = 'attack';
  }
  // arrival: done, the deposit back, the convoy flies on and leaves
  if (e.progress >= t.to - 1e-6) {
    e.state = 'done';
    const deposit = e.deposit ?? 0;
    e.deposit = 0;
    if (deposit > 0) {
      state.credits += deposit;
      events.push({ type: 'creditsChanged', delta: deposit, reason: 'contract' });
    }
  }
}

/** One step of the escort convoys: wait, depart, fly, stop, ambush points (before combat). */
export function stepEscorts(state: SimState, events: SimEvent[], dt: number): void {
  const escorts = state.convoys.escorts;
  // a contract without its convoy record (an older save, a test fixture): the convoy waits at the meeting point
  for (const c of state.career.contracts) {
    if (c.target.kind === 'escort' && !c.ready && !escorts.has(c.serial)) escorts.set(c.serial, newEscort(state, c, c.target, 0));
  }
  if (escorts.size === 0) return;
  const live = new Set<number>();
  for (const { serial, e, c, t } of escortsWithContracts(state)) {
    live.add(serial);
    if (e.state === 'done') {
      // after the arrival the convoy flies on `flyOnSeconds` and leaves (the record waits for the turn-in)
      e.progress = Math.min(t.to + FLY_ON, e.progress + ESCORT.speed * dt);
      continue;
    }
    if (c.ready) continue;
    stepEscort(state, serial, e, c, t, events, dt);
  }
  // records of contracts that are gone (turned in, failed, abandoned)
  for (const serial of [...escorts.keys()]) if (!live.has(serial)) escorts.delete(serial);
}

/** Escort contracts after a step: ready on arrival, failures (`stepContracts` hook). */
export function stepEscortContracts(state: SimState, events: readonly SimEvent[], outcome: ContractOutcome): void {
  const died = events.some((ev) => ev.type === 'playerDestroyed');
  for (const c of state.career.contracts) {
    const t = c.target;
    if (t.kind !== 'escort' || c.ready) continue;
    const e = state.convoys.escorts.get(c.serial);
    if (e?.state === 'done') {
      c.progress = 1;
      outcome.ready(c);
      continue;
    }
    let reason: Parameters<ContractOutcome['fail']>[1] | null = null;
    if (died) reason = 'playerLost';
    else if (e && (e.hulls[0] ?? 0) <= 0) reason = 'traderLost';
    else if (e && e.state === 'waiting' && state.tick - c.acceptedTick >= ESCORT.waitSeconds * TICKS) reason = 'missed';
    else if (e && e.state !== 'waiting' && e.away >= ESCORT.awaySeconds) reason = 'abandoned';
    if (!reason) continue;
    state.convoys.escorts.delete(c.serial);
    outcome.fail(c, reason);
  }
}
