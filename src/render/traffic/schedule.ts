// Cosmetic station traffic (render only – no collisions, no simulation state): traders, the civilian
// ships of art batch C (ore barges, tankers, couriers, Institute survey ships) and small shuttles that rise from a traffic lane below the gameplay plane, hold at a berth beside the
// station, wait and sink away again. Every vehicle is a pure function of (station, slot, time), so
// the schedule looks deterministic and needs no saved state. All poses are in the station's local
// frame (three.js axes, +X = the dock port, y = up): the paths stay in the back sector of the
// station, away from the player's dock corridor along +X.
import type { StationKind } from '../../data/stations';
import { createRng } from '../../sim/math/rng';

export type VehicleKind = 'trader' | 'cargo' | 'scout' | 'miner_barge' | 'tanker' | 'courier' | 'survey_ship';

export const VEHICLE_KINDS: readonly VehicleKind[] = ['trader', 'cargo', 'scout', 'miner_barge', 'tanker', 'courier', 'survey_ship'];

/**
 * What a station is for, as far as its traffic goes: the station kind, refined by the model for the
 * plain stations (art: station_a trade hub, station_b ice refinery, station_c shipyard, station_d
 * Institute research station, station_e frontier trade post).
 */
export type TrafficRole = StationKind | 'trade' | 'refinery' | 'research';

const ROLE_BY_MODEL: Readonly<Record<string, TrafficRole>> = {
  station_a: 'trade',
  station_b: 'refinery',
  station_d: 'research',
  station_e: 'trade',
};

export function trafficRole(kind: StationKind, model: string): TrafficRole {
  return kind === 'station' ? (ROLE_BY_MODEL[model] ?? 'station') : kind;
}

/** Half angle of the dock corridor kept clear of traffic (rad) and how far out it reaches. */
export const CORRIDOR_HALF_ANGLE = (50 * Math.PI) / 180;
export const CORRIDOR_REACH = 260;
/** Vehicles never come closer to the +X axis than this angle (inside the corridor + margin). */
const MIN_ANGLE = (72 * Math.PI) / 180;

/** Depth of the arrival / departure lane below the plane and how far out vehicles appear. */
export const LANE_DEPTH = 70;
export const SPAWN_RANGE: readonly [number, number] = [380, 470];
/** Share of the path at the far end where a vehicle grows from nothing / shrinks away. */
export const FADE_SHARE = 0.07;

interface KindSpec {
  approach: number;
  wait: readonly [number, number];
  depart: number;
  idle: readonly [number, number];
  /** Distance of the berth from the station rim and its height above the plane. */
  clearance: number;
  height: number;
  /** Docked: side to the station (tangential) or nose in (radial). */
  alongside: boolean;
}

export const KIND_SPECS: Readonly<Record<VehicleKind, KindSpec>> = {
  trader: { approach: 34, wait: [28, 50], depart: 30, idle: [10, 45], clearance: 6.5, height: 0.6, alongside: true },
  cargo: { approach: 18, wait: [8, 18], depart: 15, idle: [4, 22], clearance: 2.6, height: 1.6, alongside: false },
  scout: { approach: 14, wait: [5, 12], depart: 11, idle: [6, 30], clearance: 2.4, height: 2.2, alongside: false },
  // batch C (models/npc/npc_ships.json: speed class + berth hints)
  miner_barge: { approach: 36, wait: [26, 46], depart: 32, idle: [12, 45], clearance: 6.5, height: 0.7, alongside: true },
  tanker: { approach: 36, wait: [30, 52], depart: 32, idle: [12, 50], clearance: 6.5, height: 0.6, alongside: true },
  courier: { approach: 16, wait: [6, 14], depart: 13, idle: [6, 28], clearance: 3.5, height: 1.2, alongside: false },
  survey_ship: { approach: 26, wait: [20, 40], depart: 22, idle: [15, 50], clearance: 5, height: 0.8, alongside: true },
};

/**
 * Vehicles per station role at full density (home is the busiest, outposts sparse): ore barges at
 * the home station and the refinery, tankers and couriers at the trade posts, the survey ship at the
 * Institute's research station. The Guild cutter / frigate are not station traffic (sector patrols).
 */
export const TRAFFIC_BY_STATION: Readonly<Record<TrafficRole, Readonly<Partial<Record<VehicleKind, number>>>>> = {
  home: { trader: 2, cargo: 4, scout: 2, miner_barge: 1, courier: 1 },
  station: { trader: 1, cargo: 2, scout: 1, tanker: 1, courier: 1 },
  trade: { trader: 1, cargo: 2, tanker: 1, courier: 2 },
  refinery: { cargo: 2, scout: 1, miner_barge: 1, tanker: 1 },
  research: { cargo: 2, scout: 2, survey_ship: 1, courier: 1 },
  outpost: { trader: 1, cargo: 1, courier: 1 },
};

/** Outposts see a trader rarely: extra idle time per cycle (s). */
const OUTPOST_TRADER_IDLE = 90;

export interface TrafficSlot {
  index: number;
  kind: VehicleKind;
  /** Berth angle around the station (rad, from +X toward −Z… i.e. the sim's +y). */
  berthAngle: number;
  /** One whole cycle (s) and this slot's phase in it. */
  period: number;
  offset: number;
  wait: number;
}

export interface VehiclePose {
  slot: number;
  kind: VehicleKind;
  x: number;
  y: number;
  z: number;
  /** Yaw of the nose (rad, three.js rotation.y: 0 = nose along +X). */
  heading: number;
  /** Engine output 0..1 (flames, trails). */
  throttle: number;
  /** 0..1 – size ramp at the far ends of the path. */
  scale: number;
  phase: 'approach' | 'docked' | 'depart';
  /** 0..1 – how far through the current phase (a barge unloads its ore halfway through the stay). */
  progress: number;
}

/** Stable 32-bit hash of a station id. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Angle limited to the back sector [MIN_ANGLE, 2π − MIN_ANGLE] (never toward the dock corridor). */
function backSector(a: number): number {
  const tau = Math.PI * 2;
  const x = ((a % tau) + tau) % tau;
  return Math.min(tau - MIN_ANGLE, Math.max(MIN_ANGLE, x));
}

/**
 * The vehicle kinds of a station in berth order: `density` 0..1 (graphics quality) scales the count
 * per kind; the big ships that dock alongside are spread evenly with the small shuttles between them,
 * so two long hulls never take neighbouring berths (while there are enough shuttles).
 */
export function trafficMix(role: TrafficRole, density: number): VehicleKind[] {
  const counts = TRAFFIC_BY_STATION[role];
  const big: VehicleKind[] = [];
  const small: VehicleKind[] = [];
  for (const k of VEHICLE_KINDS) {
    const n = Math.round((counts[k] ?? 0) * clamp01(density));
    for (let i = 0; i < n; i++) (KIND_SPECS[k].alongside ? big : small).push(k);
  }
  // the home station is never empty, even on the lowest setting
  if (big.length + small.length === 0 && role === 'home' && density > 0) small.push('cargo');
  const n = big.length + small.length;
  const bigAt = new Set(big.map((_, j) => Math.round(((j + 0.5) * n) / big.length - 0.5)));
  const out: VehicleKind[] = [];
  let b = 0;
  let s = 0;
  for (let i = 0; i < n; i++) out.push((bigAt.has(i) && b < big.length) || s >= small.length ? big[b++]! : small[s++]!);
  return out;
}

/**
 * The traffic slots of a station (`role` from trafficRole): berths are spread over the back half of
 * the station so two vehicles never share one.
 */
export function trafficSlots(stationId: string, role: TrafficRole, density: number): TrafficSlot[] {
  const seed = hashString(stationId);
  const rng = createRng(seed ^ 0x51ab7e);
  const slots: TrafficSlot[] = [];
  const kinds = trafficMix(role, density);
  const span = Math.PI * 2 - 2 * MIN_ANGLE;
  kinds.forEach((k, i) => {
    const spec = KIND_SPECS[k];
    const wait = mix(spec.wait[0], spec.wait[1], rng());
    const idle = mix(spec.idle[0], spec.idle[1], rng()) + (role === 'outpost' && k === 'trader' ? OUTPOST_TRADER_IDLE : 0);
    const period = spec.approach + wait + spec.depart + idle;
    const berthAngle = MIN_ANGLE + span * ((i + 0.5) / kinds.length) + (rng() - 0.5) * 0.12;
    slots.push({ index: i, kind: k, berthAngle: backSector(berthAngle), period, offset: rng() * period, wait });
  });
  return slots;
}

interface Polar {
  r: number;
  a: number;
  y: number;
}

interface Point {
  x: number;
  y: number;
  z: number;
}

/**
 * The far ends of one cycle of a slot (two random lane points – they change only once per cycle).
 * Remembered per slot: vehicleAt runs for every vehicle every frame (audit 2026-10-16, issue #10).
 */
interface CycleEnds {
  stationId: string;
  cycle: number;
  farIn: Polar;
  farOut: Polar;
  /**
   * The settle turn of the arrival and the turn away of the departure (turnDelta of fixed path points –
   * constant for the cycle at a station radius), worked out once, not per vehicle and frame. NaN = not yet.
   */
  radius: number;
  refIn: number;
  refOut: number;
}
const cycleEnds = new WeakMap<TrafficSlot, CycleEnds>();

function endsOf(stationId: string, slot: TrafficSlot, cycle: number): CycleEnds {
  const known = cycleEnds.get(slot);
  if (known && known.cycle === cycle && known.stationId === stationId) return known;
  const rng = createRng((hashString(stationId) ^ Math.imul(slot.index + 1, 0x9e3779b1) ^ Math.imul(cycle, 0x85ebca6b)) >>> 0);
  const farIn: Polar = { r: mix(SPAWN_RANGE[0], SPAWN_RANGE[1], rng()), a: backSector(slot.berthAngle + (rng() - 0.5) * 1.1), y: -LANE_DEPTH };
  const farOut: Polar = { r: mix(SPAWN_RANGE[0], SPAWN_RANGE[1], rng()), a: backSector(slot.berthAngle + (rng() - 0.5) * 1.1), y: -LANE_DEPTH };
  const ends = { stationId, cycle, farIn, farOut, radius: NaN, refIn: NaN, refOut: NaN };
  cycleEnds.set(slot, ends);
  return ends;
}

function toLocalInto(r: number, a: number, y: number, out: Point): Point {
  out.x = Math.cos(a) * r;
  out.y = y;
  out.z = -Math.sin(a) * r;
  return out;
}

/** Point of the lane path at `s` (0 = far below, 1 = at the berth), written into `out`. */
function lanePoint(far: Polar, berth: Polar, s: number, out: Point): Point {
  return toLocalInto(mix(far.r, berth.r, smooth(0, 1, s)), mix(far.a, berth.a, smooth(0, 0.85, s)), mix(far.y, berth.y, smooth(0.15, 0.85, s)), out);
}

const headingAlong = (a: Point, b: Point): number => Math.atan2(-(b.z - a.z), b.x - a.x);

// scratch of one vehicleAt call (it never calls itself)
const berth: Polar = { r: 0, a: 0, y: 0 };
const docked: Point = { x: 0, y: 0, z: 0 };
const ptA: Point = { x: 0, y: 0, z: 0 };
const ptB: Point = { x: 0, y: 0, z: 0 };
const ptU: Point = { x: 0, y: 0, z: 0 };
const ptV: Point = { x: 0, y: 0, z: 0 };

const along = (far: Polar, s0: number, s1: number): number => headingAlong(lanePoint(far, berth, s0, ptU), lanePoint(far, berth, s1, ptV));

function setPose(out: VehiclePose, slot: TrafficSlot, p: Point, heading: number, throttle: number, scale: number, phase: VehiclePose['phase'], progress: number): VehiclePose {
  out.slot = slot.index;
  out.kind = slot.kind;
  out.x = p.x;
  out.y = p.y;
  out.z = p.z;
  out.heading = heading;
  out.throttle = throttle;
  out.scale = scale;
  out.phase = phase;
  out.progress = progress;
  return out;
}

/**
 * Pose of a slot's vehicle at `time` (s), or null while it is away. `stationRadius` = R. `out` = a
 * pose object to fill (the renderer passes one per vehicle – no garbage per frame); without it a new
 * one is returned.
 */
export function vehicleAt(stationId: string, slot: TrafficSlot, stationRadius: number, time: number, out?: VehiclePose): VehiclePose | null {
  const spec = KIND_SPECS[slot.kind];
  const local = time + slot.offset;
  const cycle = Math.floor(local / slot.period);
  let t = local - cycle * slot.period;
  // past the depart phase the vehicle is away: nothing to compute (the same sums as below)
  if (t - spec.approach - slot.wait >= spec.depart) return null;
  const ends = endsOf(stationId, slot, cycle);
  const { farIn, farOut } = ends;
  if (ends.radius !== stationRadius) {
    ends.radius = stationRadius;
    ends.refIn = NaN;
    ends.refOut = NaN;
  }
  berth.r = stationRadius + spec.clearance;
  berth.a = slot.berthAngle;
  berth.y = spec.height;
  toLocalInto(berth.r, berth.a, berth.y, docked);
  const dockedHeading = spec.alongside ? slot.berthAngle + Math.PI / 2 : slot.berthAngle + Math.PI;
  const pose = out ?? ({} as VehiclePose);

  // the direction of each turn is decided ONCE per manoeuvre (at a stable point of the path):
  // a turn of about ±π (a shuttle that docked nose-in and leaves outward) would otherwise pick its
  // way by numerical noise and flip between turning left and right from frame to frame
  const prefer = Math.sign(wrapAngle(farOut.a - berth.a)) || 1;

  if (t < spec.approach) {
    const p = t / spec.approach;
    // decelerating arrival
    const s = 1 - (1 - p) * (1 - p);
    const a = lanePoint(farIn, berth, s, ptA);
    const b = lanePoint(farIn, berth, Math.min(1, s + 0.01), ptB);
    const settle = smooth(0.8, 1, s);
    // the settle turn: from the travel heading at its start to the docked heading
    if (Number.isNaN(ends.refIn)) ends.refIn = turnDelta(along(farIn, 0.79, 0.8), dockedHeading, 0, prefer);
    const ref = ends.refIn;
    const travel = s < 0.995 ? headingAlong(a, b) : dockedHeading - ref;
    const heading = travel + wrapNear(dockedHeading - travel, ref) * settle;
    return setPose(pose, slot, a, heading, Math.max(0.12, 1 - p) * (1 - settle * 0.85), smooth(0, FADE_SHARE, s), 'approach', p);
  }
  t -= spec.approach;
  if (t < slot.wait) {
    // a slow bob while it holds at the berth
    docked.y += Math.sin((time + slot.offset) * 0.7) * 0.08;
    return setPose(pose, slot, docked, dockedHeading, 0, 1, 'docked', t / slot.wait);
  }
  t -= slot.wait;
  // accelerating departure: the reverse path toward another far point
  const p = t / spec.depart;
  const s = 1 - p * p;
  const a = lanePoint(farOut, berth, s, ptA);
  const b = lanePoint(farOut, berth, Math.max(0, s - 0.01), ptB);
  const leave = smooth(0, 0.25, p);
  // the turn away: toward the travel heading where the turn ends (p = 0.25 → s = 1 − 1/16)
  if (Number.isNaN(ends.refOut)) ends.refOut = turnDelta(dockedHeading, along(farOut, 1 - 1 / 16, 1 - 1 / 16 - 0.01), 0, prefer);
  const ref = ends.refOut;
  const heading = dockedHeading + wrapNear(headingAlong(a, b) - dockedHeading, ref) * leave;
  return setPose(pose, slot, a, heading, 0.35 + 0.65 * smooth(0, 0.4, p), smooth(0, FADE_SHARE, s), 'depart', p);
}

const TAU = Math.PI * 2;

/** Angle wrapped into (−π, π]. */
export function wrapAngle(d: number): number {
  const x = ((d % TAU) + TAU) % TAU;
  return x > Math.PI ? x - TAU : x;
}

/** `d` shifted by whole turns into [ref − π, ref + π) – the branch next to a reference delta. */
export function wrapNear(d: number, ref: number): number {
  return ref + wrapAngle(d - ref);
}

/**
 * Signed turn from heading `from` to `to` (rad). The shortest way, except near a reversal (within
 * `margin` of ±π), where it turns toward `prefer` (±1) – a fixed choice, not the numerical noise.
 */
export function turnDelta(from: number, to: number, margin: number, prefer: number): number {
  const d = wrapAngle(to - from);
  const nearReverse = Math.PI - Math.abs(d) <= Math.max(margin, 0.35);
  return nearReverse ? Math.sign(prefer || 1) * Math.abs(d) : d;
}

/** Is a local point (three.js x, z) inside the dock corridor that must stay clear? */
export function inDockCorridor(x: number, z: number, stationRadius: number): boolean {
  const r = Math.hypot(x, z);
  if (r > stationRadius + CORRIDOR_REACH) return false;
  return Math.abs(Math.atan2(-z, x)) < CORRIDOR_HALF_ANGLE;
}
