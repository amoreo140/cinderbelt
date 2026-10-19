// Berth at a derelict's dock clamp (M4b plan §2.4, open question 1: a berth is NOT a station dock) –
// OWNED BY T4.
//
// Rules:
// - F in flight (nothing else claimed it): `tryBerth` runs before the station dock (Simulation.tryDock).
//   A derelict clamp is "in play" when its docking point is within `DOCK_APPROACH_RANGE` of the ship and
//   nearer than any station's docking point (`nearestBerth` – also the approach readout of the game).
// - The derelict is a `DockTarget` (`derelictDockTarget`) for `checkDock` with `playerDockRules`: the very
//   same manoeuvre (4 u, 3 u/s, ±35°) and docking computer (12 u, 6 u/s, any heading) rules as a station.
// - Refusals (`berthRejected`): not all `RELAY.count` relays of the derelict powered → `relaysUnpowered`
//   (checked first – the clamp has no power); else the manoeuvre status (tooFar / tooFast / misaligned).
// - Berthed: `sites.berth = id`, beams and the tractor off, the ship stopped; `berthed`, then on the first
//   berth the terminal's Data + log (`visitDerelict`). `player.dock.mode` stays 'flying': no respawn
//   change, no market, no hub, no station storage, no save `dockedAt`.
// - While berthed (`holdBerth`, instead of the flight step): thrust, currents and anomalies are ignored,
//   velocity 0; the ship latches into the dock pose over ~1 s (each step closes `LATCH_RATE` of the gap –
//   stateless, so a save in the middle of the latch continues exactly); the reactor keeps charging the
//   battery. F (a new press) or the `berthLeave` action leaves: undock pose (same point, bow away),
//   `berthLeft`.
// - The ship's destruction (or anything that ends the flight) clears the berth (derelict.ts).
//
// Docking clearance: the docked ship's centre sits at R + bR + 1, so its bounding circle keeps ≥ 1 u from
// the clamp at (R, 0); derelict_a's clamp circle reaches 11.2 vs R = 11 – a 0.8 u gap (berth.test.ts checks
// every model).
import { DERELICT_LAYOUTS, RELAY } from '../../data/sites';
import { TICKS_PER_SECOND } from '../combat/damage';
import { normalizeAngle } from '../math/angle';
import type { Vec2 } from '../math/vec2';
import type { PlayerCommand } from '../commands';
import type { SimEvent, SimState } from '../Simulation';
import { checkDock, DOCK_APPROACH_RANGE, dockPose, undockPose, type DockCheck, type DockTarget } from '../station/dock';
import { playerDockRules } from '../station/dockRules';
import { derelictById } from './derelict';
import { forSitesNear } from './placement';
import { visitDerelict } from './terminal';
import type { BerthAttempt, DerelictSite } from './types';

/** The derelict as a dock target: dock port at (R, 0) of its layout rotated by its angle. */
export function derelictDockTarget(site: DerelictSite): DockTarget {
  return { id: site.id, pos: site.pos, radius: DERELICT_LAYOUTS[site.model].radius, portAngle: site.angle };
}

/** A derelict dock target that remembers its site. */
export interface BerthTarget extends DockTarget {
  site: DerelictSite;
}

/** The largest station radius of the derelict models. */
const MAX_RADIUS = Math.max(...Object.values(DERELICT_LAYOUTS).map((l) => l.radius));

/** All relays of the derelict are powered: its clamp works. */
export const clampPowered = (state: SimState, site: DerelictSite): boolean =>
  site.relays.length === RELAY.count && site.relays.every((r) => state.sites.powered.has(r.id));

/** Powered relays of a derelict (0..RELAY.count). */
export const relaysLit = (state: SimState, site: DerelictSite): number => site.relays.filter((r) => state.sites.powered.has(r.id)).length;

/** The nearest derelict clamp in play for the ship: the dock check against it and whether it has power. */
export interface BerthCandidate {
  site: DerelictSite;
  check: DockCheck<BerthTarget>;
  powered: boolean;
}

/**
 * The derelict clamp the ship would berth at with F now: its docking point within `DOCK_APPROACH_RANGE`
 * and nearer than every station's docking point; null = none (the station dock runs as usual).
 */
export function nearestBerth(state: SimState): BerthCandidate | null {
  const { player } = state;
  const bR = player.props.boundingRadius;
  let targets: BerthTarget[] | null = null;
  forSitesNear(state.seed, player.body.pos, MAX_RADIUS + bR + 1 + DOCK_APPROACH_RANGE, (s) => {
    if (s.kind === 'derelict') (targets ??= []).push({ ...derelictDockTarget(s), site: s });
  });
  if (!targets) return null;
  const rules = playerDockRules(state);
  const check = checkDock<BerthTarget>(player.body, bR, targets, rules);
  if (!check.station || check.distance > DOCK_APPROACH_RANGE) return null;
  const station = checkDock(player.body, bR, state.world.stations(), rules);
  if (station.station && station.distance <= check.distance) return null;
  return { site: check.station.site, check, powered: clampPowered(state, check.station.site) };
}

/**
 * F pressed in flight (and nothing else claimed it): berth at the nearest derelict clamp when it is the
 * nearest dock target. 'none' = no derelict clamp in play, the station dock runs as usual.
 */
export function tryBerth(state: SimState, events: SimEvent[]): BerthAttempt {
  const near = nearestBerth(state);
  if (!near) return 'none';
  const { site, check } = near;
  const reject = (reason: Extract<SimEvent, { type: 'berthRejected' }>['reason']): BerthAttempt => {
    events.push({ type: 'berthRejected', id: site.id, reason, distance: check.distance, speed: check.speed, angle: check.angle });
    return 'rejected';
  };
  if (!near.powered) return reject('relaysUnpowered');
  if (check.status !== 'ok') return reject(check.status === 'noStation' ? 'tooFar' : check.status);
  const { player } = state;
  state.sites.berth = site.id;
  player.beams = [];
  player.tractor = null;
  player.lastLocalForce = { x: 0, y: 0 };
  player.body = { ...player.body, vel: { x: 0, y: 0 }, angVel: 0 };
  player.prevBody = player.body;
  events.push({ type: 'berthed', id: site.id });
  visitDerelict(state, site, events);
  return 'berthed';
}

/** Share of the remaining gap to the dock pose closed every step (≈ 0.1 % left after 60 steps = 1 s). */
export const LATCH_RATE = 1 - Math.pow(0.001, 1 / TICKS_PER_SECOND);
/** Within this distance (u) and angle (rad) of the dock pose the ship snaps into it. */
const LATCH_SNAP = 0.01;

/** The ship has latched into the dock pose of its berth (false while not berthed). */
export function berthLatched(state: SimState): boolean {
  const id = state.sites.berth;
  const site = id === null ? null : derelictById(state, id);
  if (!site) return false;
  const to = dockPose(derelictDockTarget(site), state.player.props.boundingRadius);
  const b = state.player.body;
  return b.pos.x === to.pos.x && b.pos.y === to.pos.y && b.angle === to.angle;
}

/** Leaves the berth (F or `berthLeave`): the undock pose at the clamp, bow away. Nothing when not berthed. */
export function leaveBerth(state: SimState, events: SimEvent[]): boolean {
  const id = state.sites.berth;
  if (id === null) return false;
  const { player } = state;
  state.sites.berth = null;
  const site = derelictById(state, id);
  player.body = site ? undockPose(derelictDockTarget(site), player.props.boundingRadius) : { ...player.body, vel: { x: 0, y: 0 }, angVel: 0 };
  player.prevBody = player.body;
  events.push({ type: 'berthLeft', id });
  return true;
}

const towards = (from: Vec2, to: Vec2, k: number): Vec2 => ({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k });

/**
 * One step of a berthed ship (instead of the flight step): keep it at the dock pose (prevBody = body),
 * F (`cmd.dock`, a new press; `canLeave` = it was berthed at the start of the step) leaves the berth.
 */
export function holdBerth(state: SimState, cmd: PlayerCommand, canLeave: boolean, events: SimEvent[]): void {
  const { player } = state;
  player.prevBody = player.body;
  if (cmd.dock && canLeave) {
    leaveBerth(state, events);
    return;
  }
  player.beams = [];
  player.lastLocalForce = { x: 0, y: 0 };
  // the reactors keep running (no sector or anomaly modifiers at the clamp)
  player.energy = Math.min(player.props.batteryCapacity, player.energy + player.props.energyGen / TICKS_PER_SECOND);
  const id = state.sites.berth;
  const site = id === null ? null : derelictById(state, id);
  if (!site) {
    player.body = { ...player.body, vel: { x: 0, y: 0 }, angVel: 0 };
    return;
  }
  const to = dockPose(derelictDockTarget(site), player.props.boundingRadius);
  const b = player.body;
  const da = normalizeAngle(to.angle - b.angle);
  if (Math.hypot(to.pos.x - b.pos.x, to.pos.y - b.pos.y) < LATCH_SNAP && Math.abs(da) < LATCH_SNAP) {
    player.body = to;
    return;
  }
  player.body = { pos: towards(b.pos, to.pos, LATCH_RATE), vel: { x: 0, y: 0 }, angle: normalizeAngle(b.angle + da * LATCH_RATE), angVel: 0 };
}
