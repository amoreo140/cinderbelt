// Stations in the HUD: the docking prompt with the approach readout, radar contacts and the edge arrow.
import { tx } from '../i18n';
import type { Vec2 } from '../sim/math/vec2';
import type { Body } from '../sim/physics/body';
import { DOCK_APPROACH_RANGE, type DockCheck, type DockRules, type DockState, type DockTarget } from '../sim/station/dock';
import type { StationDef } from '../sim/world/stations';
import { formatAmount } from './format';

/** One item of the approach readout: the value now, the limit, and whether it is in tolerance. */
export interface DockApproachItem {
  id: 'distance' | 'speed' | 'bow';
  label: string;
  value: string;
  /** "≤ 4 j" ('' when the item has no limit – the docking computer's heading). */
  limit: string;
  ok: boolean;
}

export interface DockApproach {
  items: DockApproachItem[];
  /** The Archive's docking computer relaxes the rules. */
  computer: boolean;
  /** The readout's title (default: the docking one; M4d: the convoy link at a trader's trade port). */
  title?: string;
}

export interface DockPrompt {
  text: string;
  kind: 'ok' | 'warn' | 'info';
  /** The approach readout near a dock clamp (absent for other F prompts). */
  approach?: DockApproach;
}

const whole = (v: number): string => String(Math.round(v));

/** The docking prompt and readout within DOCK_APPROACH_RANGE of a docking point (null further away). */
export function dockPrompt(check: DockCheck<DockTarget>, name: string): DockPrompt | null {
  if (!check.station || check.distance > DOCK_APPROACH_RANGE) return null;
  const r = tx().docking.readout;
  const { rules } = check;
  const computer = rules.maxAngle === null;
  const degrees = (check.angle * 180) / Math.PI;
  const items: DockApproachItem[] = [
    {
      id: 'distance',
      label: r.distance,
      value: `${formatAmount(check.distance)} ${r.distanceUnit}`,
      limit: r.limit(`${whole(rules.range)} ${r.distanceUnit}`),
      ok: check.distance <= rules.range + 1e-6,
    },
    {
      id: 'speed',
      label: r.speed,
      value: `${formatAmount(check.speed)} ${r.speedUnit}`,
      limit: r.limit(`${whole(rules.maxSpeed)} ${r.speedUnit}`),
      ok: check.speed <= rules.maxSpeed + 1e-6,
    },
    rules.maxAngle === null
      ? { id: 'bow', label: r.bow, value: r.anyHeading, limit: '', ok: true }
      : {
          id: 'bow',
          label: r.bow,
          value: `${whole(Math.abs(degrees))}${r.degree}`,
          limit: r.limit(`${whole((rules.maxAngle * 180) / Math.PI)}${r.degree}`),
          ok: check.angle <= rules.maxAngle + 1e-6,
        },
  ];
  const approach = { items, computer };
  switch (check.status) {
    case 'ok':
      return { text: tx().docking.prompt(name), kind: 'ok', approach };
    case 'tooFar':
      return { text: r.fix.tooFar, kind: 'info', approach };
    case 'tooFast':
      return { text: r.fix.tooFast, kind: 'warn', approach };
    case 'misaligned':
      return { text: r.fix.misaligned, kind: 'warn', approach };
    default:
      return null;
  }
}

/** Speed towards or away from the docking point (u/s) below which the ship counts as hovering. */
export const DOCK_CLOSING_SPEED = 0.3;

/**
 * When the approach readout and the clamp marker show. Right after undocking the ship sits on the
 * docking point with its bow away from the station, so a red "turn the bow" readout would only be noise
 * while the player is leaving. A departure starts at undocking and ends when the ship closes in on the
 * docking point or leaves the readout range; during it the readout shows only once the bow turns back
 * to the station (and the ship is not moving away). Otherwise the readout hides while the ship moves
 * away from the docking point, unless it is still within every tolerance (F would dock).
 * Reads the simulation state only; one instance per game, updated every frame.
 */
export class DockReadoutGate {
  private lastMode: DockState['mode'] | null = null;
  private departing = false;

  update(mode: DockState['mode'], body: Body, check: DockCheck<DockTarget>): boolean {
    if (mode === 'flying' && this.lastMode !== null && this.lastMode !== 'flying') this.departing = true;
    this.lastMode = mode;
    if (mode !== 'flying' || !check.point || check.distance > DOCK_APPROACH_RANGE) {
      if (mode === 'flying') this.departing = false;
      return false;
    }
    // the velocity component towards the docking point (none on the point itself)
    const dx = check.point.x - body.pos.x;
    const dy = check.point.y - body.pos.y;
    const closing = check.distance > 1e-6 ? (body.vel.x * dx + body.vel.y * dy) / check.distance : 0;
    const leaving = closing < -DOCK_CLOSING_SPEED;
    if (this.departing && closing > DOCK_CLOSING_SPEED) this.departing = false;
    if (this.departing) return check.angle < Math.PI / 2 && !leaving;
    return !leaving || check.status === 'ok';
  }
}

/** The toast after F away from the tolerances (the rules in force give the limits). */
export function dockRejectedText(
  e: { reason: 'tooFar' | 'tooFast' | 'misaligned' | 'noStation'; distance: number; speed: number; angle: number },
  rules: DockRules,
): string {
  const t = tx().docking.rejected;
  switch (e.reason) {
    case 'tooFar':
      return t.tooFar(formatAmount(e.distance), whole(rules.range));
    case 'tooFast':
      return t.tooFast(formatAmount(e.speed), whole(rules.maxSpeed));
    case 'misaligned':
      return t.misaligned(whole((e.angle * 180) / Math.PI), whole(((rules.maxAngle ?? Math.PI) * 180) / Math.PI));
    default:
      return t.noStation;
  }
}

export interface StationContact {
  /** Position relative to the player (sim coordinates). */
  x: number;
  y: number;
  kind: StationDef['kind'];
  /** Out of range – pinned to the radar's edge. */
  edge?: boolean;
}

/** Stations for the radar; `pinToEdge` also shows distant stations on the edge. */
export function buildStationContacts(
  stations: readonly StationDef[],
  center: Vec2,
  range: number,
  pinToEdge = false,
): StationContact[] {
  const out: StationContact[] = [];
  for (const s of stations) {
    const x = s.pos.x - center.x;
    const y = s.pos.y - center.y;
    const d = Math.hypot(x, y);
    if (d <= range) out.push({ x, y, kind: s.kind });
    else if (pinToEdge && d > 0) out.push({ x: (x / d) * range, y: (y / d) * range, kind: s.kind, edge: true });
  }
  return out;
}

export interface EdgeArrow {
  x: number;
  y: number;
  /** Angle in screen pixels (0 = right, y down). */
  angle: number;
}

/** The arrow at the screen edge towards a point out of view (null = the point is visible). */
export function edgeArrow(
  screen: { x: number; y: number; behind?: boolean },
  view: { width: number; height: number },
  margin: number,
): EdgeArrow | null {
  const cx = view.width / 2;
  const cy = view.height / 2;
  const inside =
    screen.x >= margin && screen.x <= view.width - margin && screen.y >= margin && screen.y <= view.height - margin;
  if (inside && !screen.behind) return null;
  let dx = screen.x - cx;
  let dy = screen.y - cy;
  if (screen.behind) {
    dx = -dx;
    dy = -dy;
  }
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) dy = 1;
  const t = Math.min(
    Math.abs(dx) > 1e-9 ? (cx - margin) / Math.abs(dx) : Infinity,
    Math.abs(dy) > 1e-9 ? (cy - margin) / Math.abs(dy) : Infinity,
  );
  return { x: cx + dx * t, y: cy + dy * t, angle: Math.atan2(dy, dx) };
}
