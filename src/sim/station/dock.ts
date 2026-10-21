// Docking (spec M2, ch. 7.2; manoeuvre rules of 2026-10-17): the conditions, the dock and undock poses.
// The ship docks only by the dock clamp at the tip of the station's arm: close to the docking point and
// slow, at any heading; then a short latch turns it (the shorter way) into the dock pose.
import { normalizeAngle } from '../math/angle';
import { add, dot, length, rotate, scale, sub, type Vec2 } from '../math/vec2';
import type { Body } from '../physics/body';
import type { StationDef, StationId } from '../world/stations';

/**
 * Anything with a dock clamp at (radius, 0) rotated by `portAngle` around `pos`: a station, or a derelict
 * station of M4b (sim/sites/berth.ts `derelictDockTarget`). Every docking geometry works on this shape.
 */
export type DockTarget = Pick<StationDef, 'id' | 'pos' | 'radius' | 'portAngle'>;

/** What a dock request must meet (distances in u from the docking point, speed in u/s). */
export interface DockRules {
  /** Largest distance of the ship centre from the docking point (the docked ship's centre by the clamp). */
  range: number;
  /** Largest speed relative to the station (stations do not move). */
  maxSpeed: number;
  /** Largest angle (rad) between the bow and the dock axis pointing at the station; null = any heading. */
  maxAngle: number | null;
}

/** The manoeuvre: within 4 u of the clamp, at most 3 u/s, any heading (the latch turns the ship). */
export const DOCK_RULES: DockRules = { range: 4, maxSpeed: 3, maxAngle: null };
/** The Archive's docking computer: a longer reach (12 u) and a higher speed (6 u/s). */
export const DOCKING_COMPUTER_RULES: DockRules = { range: 12, maxSpeed: 6, maxAngle: null };
/** The approach readout and the clamp marker show within this distance of a docking point. */
export const DOCK_APPROACH_RANGE = 25;
/** The latch into the dock pose (1 s). */
export const DOCKING_TICKS = 60;
/** Tolerance at the limits (floating point). */
const EPS = 1e-6;

export type DockState =
  | { mode: 'flying' }
  | { mode: 'docking'; stationId: StationId; startTick: number; from: Body; to: Body }
  | { mode: 'docked'; stationId: StationId };

export type DockStatus = 'ok' | 'tooFar' | 'tooFast' | 'misaligned' | 'noStation';

export interface DockCheck<T extends DockTarget = StationDef> {
  status: DockStatus;
  /** The station (dock target) with the nearest docking point (null at noStation). */
  station: T | null;
  /** The docking point of that station (null at noStation). */
  point: Vec2 | null;
  /** Distance of the ship centre from the docking point. */
  distance: number;
  speed: number;
  /** Angle (rad, ≥ 0) between the bow and the dock axis pointing at the station. */
  angle: number;
  rules: DockRules;
}

/** Gap between the ship's and the station's bounding circles (navigation, not docking). */
export const dockGap = (pos: Vec2, boundingRadius: number, station: DockTarget): number =>
  Math.hypot(pos.x - station.pos.x, pos.y - station.pos.y) - station.radius - boundingRadius;

/** The heading of a docked ship: the bow back along the dock axis, at the station. */
export const dockHeading = (station: DockTarget): number => normalizeAngle(station.portAngle + Math.PI);

/** Can the ship dock? The target is the station whose docking point is nearest. */
export function checkDock<T extends DockTarget = StationDef>(body: Body, boundingRadius: number, stations: readonly T[], rules: DockRules = DOCK_RULES): DockCheck<T> {
  const speed = length(body.vel);
  let station: T | null = null;
  let point: Vec2 | null = null;
  let distance = Infinity;
  for (const s of stations) {
    const p = portPoint(s, boundingRadius);
    const d = Math.hypot(body.pos.x - p.x, body.pos.y - p.y);
    if (d < distance) {
      distance = d;
      station = s;
      point = p;
    }
  }
  const angle = station ? Math.abs(normalizeAngle(body.angle - dockHeading(station))) : Math.PI;
  const base = { station, point, distance, speed, angle, rules };
  if (!station) return { status: 'noStation', ...base };
  if (distance > rules.range + EPS) return { status: 'tooFar', ...base };
  if (speed > rules.maxSpeed + EPS) return { status: 'tooFast', ...base };
  if (rules.maxAngle !== null && angle > rules.maxAngle + EPS) return { status: 'misaligned', ...base };
  return { status: 'ok', ...base };
}

/** The docking point: where the docked ship's centre sits, bR + 1 beyond the dock clamp (R, 0). */
export const dockPoint = (station: DockTarget, boundingRadius: number): Vec2 => portPoint(station, boundingRadius);

/** The point by the port: the ship centre bR + 1 beyond the dock port (R, 0). */
function portPoint(station: DockTarget, boundingRadius: number): Vec2 {
  const d = station.radius + boundingRadius + 1;
  return { x: station.pos.x + Math.cos(station.portAngle) * d, y: station.pos.y + Math.sin(station.portAngle) * d };
}

/** The pose of a docked ship – bow at the station. */
export function dockPose(station: DockTarget, boundingRadius: number): Body {
  const angle = station.portAngle + Math.PI;
  return {
    pos: portPoint(station, boundingRadius),
    vel: { x: 0, y: 0 },
    angle: Math.atan2(Math.sin(angle), Math.cos(angle)),
    angVel: 0,
  };
}

/** The undock pose – the same place, bow away from the station. */
export function undockPose(station: DockTarget, boundingRadius: number): Body {
  return { pos: portPoint(station, boundingRadius), vel: { x: 0, y: 0 }, angle: station.portAngle, angVel: 0 };
}

/**
 * The pose after a rebuild in the dock (spec 7.2): the grid origin stays in place (body.pos is the
 * centre of mass, which moves by newCoM − oldCoM) and the distance from the station is recomputed
 * for the new ship radius, so a bigger ship does not cut into the station. The sideways offset stays.
 */
export function rebuiltDockPose(station: DockTarget, body: Body, oldCoM: Vec2, newCoM: Vec2, boundingRadius: number): Body {
  const shifted = add(body.pos, rotate(sub(newCoM, oldCoM), body.angle));
  const dir = { x: Math.cos(station.portAngle), y: Math.sin(station.portAngle) };
  const rel = sub(shifted, station.pos);
  const lateral = sub(rel, scale(dir, dot(rel, dir)));
  const pos = add(add(station.pos, scale(dir, station.radius + boundingRadius + 1)), lateral);
  return { pos, vel: { x: 0, y: 0 }, angle: body.angle, angVel: 0 };
}

export const smoothstep = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
