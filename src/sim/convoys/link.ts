// The link with a convoy trader – a moving berth (M4d plan §2.5 "Link") – OWNED BY T5.
//
// F with the trader's trade port (`CONVOY_SHAPES.trader.tradePort`) within `CONVOY.linkRange` of the
// ship's hull, relative speed ≤ `CONVOY.linkSpeed`, no pirate within `CONVOY.linkPirateRadius` →
// `convoys.link`, `convoyLinked`; else `linkRejected { reason }`. While linked the ship is pinned beside
// the port (pose = port pose + the ship's bounding radius outward, velocity = the convoy's), flight input
// ignored, dampers on (`holdLink`, instead of the flight step – like `holdBerth`). Leave: F, the
// `convoyUnlink` command, the turn-around, a pirate near, the player destroyed / docked (`stepLink`).
//
// Rules:
// - A trader is "in play" for F when its trade port lies within `DOCK_APPROACH_RANGE` of the ship's hull
//   (the nearest port wins); otherwise `tryConvoyLink` answers 'none' and the berth / station dock run.
//   Rejections in this order: `tooFar` (port gap > linkRange), `tooFast` (relative speed > linkSpeed),
//   `pirates` (a pirate within linkPirateRadius of the ship). No friendly fire → no hostile / closed
//   rejections (user decision 2026-10-16).
// - Linking clears beams and the tractor (like the berth). A trader in its turn-around is not in play
//   (the link would end at once): F there falls through to the berth / station dock.
// - While linked (`holdLink`): the ship latches into the pinned pose at the berth's `LATCH_RATE` (≈ 1 s,
//   stateless – a save in the middle continues exactly): its heading eases towards the trader's and its
//   offset from the clamp (the pinned pose swung round the trader to the ship's heading) of its own time
//   shrinks by LATCH_RATE every step and rides along with the trader, so it follows the route without
//   drift, and a corner of the route (the trader's heading snaps there) swings it round smoothly instead
//   of a sideways jump. The pinned pose is the port pose at the end of the step (`stepTick`), heading =
//   the trader's. The reactor keeps charging.
// - Auto-unlink (`stepLink`, after the flight step): the pass over (`passOver`), its turn-around
//   (`turnaround`), a pirate within linkPirateRadius (`pirates`) – the ship keeps the convoy's velocity.
//   A rock (or a giant) the pinned ship would touch within `BLOCK_LOOKAHEAD` (`blocked`): the routes keep
//   clear of the rocks (schedule.ts), but a very big ship or a dense field may not fit – the clamp lets
//   go and holds the ship back (velocity 0), so it is never dragged through a rock.
//   The link is cleared silently when the ship is destroyed or no longer flies (respawn, tow, a ship swap),
//   like `stepDerelicts` clears the berth.
import { CONVOY, CONVOY_SHAPES } from '../../data/convoys';
import { TICKS_PER_SECOND } from '../combat/damage';
import type { GameAction, PlayerCommand } from '../commands';
import { giantCircles } from '../discovery/giants';
import { normalizeAngle } from '../math/angle';
import type { Vec2 } from '../math/vec2';
import { LATCH_RATE } from '../sites/berth';
import type { SimEvent, SimState } from '../Simulation';
import { DOCK_APPROACH_RANGE } from '../station/dock';
import { convoysNear, convoyAt, shipLocalToWorld, stepTick } from './schedule';
import type { ConvoyPose, ConvoyUnlinkReason } from './types';

/** Within this distance (u) and angle (rad) of the pinned pose the ship snaps into it. */
const LATCH_SNAP = 0.01;
/** The linked ship swings round the trader at most this fast after a corner of the route (rad/s). */
const LINK_TURN_RATE = 1.5;
const LINK_TURN_STEP = LINK_TURN_RATE / TICKS_PER_SECOND;
/** The pinned poses this many ticks ahead are checked against the rocks (≈ 0.5, 1 and 1.5 s). */
const BLOCK_LOOKAHEAD = [30, 60, 90] as const;

const TRADE_PORT = CONVOY_SHAPES.trader.tradePort!;

/** The trade port of a pass's trader in the world and the outward (port side) normal. */
export function tradePort(pose: ConvoyPose): { pos: Vec2; out: Vec2; heading: number } {
  const trader = pose.ships[0]!;
  return {
    pos: shipLocalToWorld(trader, TRADE_PORT),
    out: { x: -Math.sin(trader.heading), y: Math.cos(trader.heading) },
    heading: trader.heading,
  };
}

/** The pose a ship of bounding radius `bR` is pinned to beside the trade port (centre, heading). */
export function linkPose(pose: ConvoyPose, bR: number): { pos: Vec2; angle: number } {
  const port = tradePort(pose);
  return { pos: { x: port.pos.x + port.out.x * bR, y: port.pos.y + port.out.y * bR }, angle: port.heading };
}

/** `linkPose` with the trader turned to `heading` (the clamp swung round the trader's centre). */
function linkPoseAt(pose: ConvoyPose, bR: number, heading: number): Vec2 {
  const trader = pose.ships[0]!;
  const local = { x: TRADE_PORT.x, y: TRADE_PORT.y + bR };
  return shipLocalToWorld({ pos: trader.pos, heading }, local);
}

/** A pirate within `radius` of `pos`. */
export function pirateNear(state: SimState, pos: Vec2, radius: number): boolean {
  return state.combat.enemies.some((e) => Math.hypot(e.body.pos.x - pos.x, e.body.pos.y - pos.y) <= radius);
}

/** The trader the ship would link to with F now: its pass, the port gap and the relative speed; null = none in play. */
export interface LinkCandidate {
  pose: ConvoyPose;
  /** Gap between the ship's hull (bounding circle) and the trade port (u, ≥ 0). */
  distance: number;
  /** Speed relative to the convoy (u/s). */
  speed: number;
}

export function nearestTradePort(state: SimState): LinkCandidate | null {
  const { player } = state;
  const bR = player.props.boundingRadius;
  const pos = player.body.pos;
  let best: LinkCandidate | null = null;
  for (const pose of convoysNear(state.seed, pos, bR + DOCK_APPROACH_RANGE + CONVOY_SHAPES.trader.radius, stepTick(state))) {
    if (pose.leg === 'turn') continue;
    const port = tradePort(pose).pos;
    const distance = Math.max(0, Math.hypot(port.x - pos.x, port.y - pos.y) - bR);
    if (distance > DOCK_APPROACH_RANGE || (best && distance >= best.distance)) continue;
    const speed = Math.hypot(player.body.vel.x - pose.vel.x, player.body.vel.y - pose.vel.y);
    best = { pose, distance, speed };
  }
  return best;
}

/** F in flight at a convoy: linked, refused (the event is pushed) or no trader in reach. */
export function tryConvoyLink(state: SimState, events: SimEvent[]): 'linked' | 'rejected' | 'none' {
  const { player } = state;
  if (player.destroyed || player.dock.mode !== 'flying' || state.sites.berth !== null) return 'none';
  const near = nearestTradePort(state);
  if (!near) return 'none';
  const reject = (reason: 'tooFar' | 'tooFast' | 'pirates'): 'rejected' => {
    events.push({ type: 'linkRejected', reason, distance: near.distance, speed: near.speed });
    return 'rejected';
  };
  if (near.distance > CONVOY.linkRange) return reject('tooFar');
  if (near.speed > CONVOY.linkSpeed) return reject('tooFast');
  if (pirateNear(state, player.body.pos, CONVOY.linkPirateRadius)) return reject('pirates');
  state.convoys.link = { pass: near.pose.pass, since: state.tick };
  player.beams = [];
  player.tractor = null;
  player.lastLocalForce = { x: 0, y: 0 };
  player.body = { ...player.body, vel: { ...near.pose.vel }, angVel: 0 };
  player.prevBody = player.body;
  events.push({ type: 'convoyLinked', pass: near.pose.pass });
  return 'linked';
}

/** Ends the link (the ship flies on with its velocity); nothing when not linked. */
export function unlink(state: SimState, reason: ConvoyUnlinkReason, events: SimEvent[]): boolean {
  const link = state.convoys.link;
  if (!link) return false;
  state.convoys.link = null;
  events.push({ type: 'convoyUnlinked', pass: link.pass, reason });
  return true;
}

/** One step while linked (instead of the flight step): pinned beside the port; F (`canAct`) unlinks. */
export function holdLink(state: SimState, cmd: PlayerCommand, canAct: boolean, events: SimEvent[]): void {
  const { player } = state;
  player.prevBody = player.body;
  const link = state.convoys.link;
  const pose = link ? convoyAt(state.seed, link.pass, stepTick(state)) : null;
  if (cmd.dock && canAct) {
    unlink(state, 'player', events);
    // fly on alongside: one step at the convoy's velocity
    if (pose) player.body = { ...player.body, pos: { x: player.body.pos.x + pose.vel.x / TICKS_PER_SECOND, y: player.body.pos.y + pose.vel.y / TICKS_PER_SECOND }, vel: { ...pose.vel }, angVel: 0 };
    return;
  }
  player.beams = [];
  player.lastLocalForce = { x: 0, y: 0 };
  // the reactors keep running (no sector or anomaly modifiers beside the trader)
  player.energy = Math.min(player.props.batteryCapacity, player.energy + player.props.energyGen / TICKS_PER_SECOND);
  if (!pose) {
    // the pass is over: stepLink ends the link in this step; the ship drifts on
    const b = player.body;
    player.body = { ...b, pos: { x: b.pos.x + b.vel.x / TICKS_PER_SECOND, y: b.pos.y + b.vel.y / TICKS_PER_SECOND }, angVel: 0 };
    return;
  }
  const bR = player.props.boundingRadius;
  const to = linkPose(pose, bR);
  const b = player.body;
  const vel = { ...pose.vel };
  const keep = 1 - LATCH_RATE;
  // the heading eases towards the trader's (LATCH_RATE, at most LINK_TURN_RATE): the route is a polyline, so
  // the trader's heading snaps at each corner – a pinned ship swung round with it would jump sideways (4–12 u
  // at the sharp corners round the rocks); eased, it swings round the trader in a fraction of a second
  const turn = normalizeAngle(to.angle - b.angle) * LATCH_RATE;
  const angle = normalizeAngle(b.angle + Math.max(-LINK_TURN_STEP, Math.min(LINK_TURN_STEP, turn)));
  // the offset from the clamp (at the ship's own heading) at the ship's own time (the start of the step)
  // shrinks by LATCH_RATE and rides along with the trader – exact following, no drift along the route
  const prevPose = convoyAt(state.seed, link!.pass, state.tick);
  const from = prevPose ? linkPoseAt(prevPose, bR, b.angle) : { x: b.pos.x - pose.vel.x / TICKS_PER_SECOND, y: b.pos.y - pose.vel.y / TICKS_PER_SECOND };
  const at = linkPoseAt(pose, bR, angle);
  const pos = { x: at.x + (b.pos.x - from.x) * keep, y: at.y + (b.pos.y - from.y) * keep };
  if (Math.hypot(pos.x - to.pos.x, pos.y - to.pos.y) < LATCH_SNAP && Math.abs(normalizeAngle(angle - to.angle)) < LATCH_SNAP) {
    player.body = { pos: to.pos, vel, angle: to.angle, angVel: 0 };
    return;
  }
  player.body = { pos, vel, angle, angVel: 0 };
}

/** The ship has latched into the pinned pose beside its trader (false while not linked). */
export function linkLatched(state: SimState): boolean {
  const link = state.convoys.link;
  const pose = link ? convoyAt(state.seed, link.pass, state.tick) : null;
  if (!pose) return false;
  const to = linkPose(pose, state.player.props.boundingRadius);
  const b = state.player.body;
  return Math.hypot(b.pos.x - to.pos.x, b.pos.y - to.pos.y) < 1e-6 && Math.abs(normalizeAngle(b.angle - to.angle)) < 1e-9;
}

/** A rock or a giant the ship (its bounding circle) would touch in the pinned pose ahead on this pass. */
export function linkBlocked(state: SimState, pass: string): boolean {
  const bR = state.player.props.boundingRadius;
  for (const ahead of BLOCK_LOOKAHEAD) {
    const pose = convoyAt(state.seed, pass, stepTick(state) + ahead);
    // the link ends before the turn-around and with the pass anyway
    if (!pose || pose.leg === 'turn') return false;
    const at = linkPose(pose, bR).pos;
    for (const { circle } of state.world.circlesNear(at, bR)) {
      if (Math.hypot(circle.pos.x - at.x, circle.pos.y - at.y) < circle.radius + bR) return true;
    }
    if (giantCircles(state, at, bR).some((c) => Math.hypot(c.pos.x - at.x, c.pos.y - at.y) < c.radius + bR)) return true;
  }
  return false;
}

/** Auto-unlink checks of a step (turn-around, pirates, a rock ahead, the pass over, death, docking). */
export function stepLink(state: SimState, events: SimEvent[]): void {
  const link = state.convoys.link;
  if (!link) return;
  const { player } = state;
  // a ship that no longer flies (destroyed, respawned, towed, docked, swapped) is never linked
  if (player.destroyed || player.dock.mode !== 'flying' || state.sites.berth !== null) {
    state.convoys.link = null;
    return;
  }
  const pose = convoyAt(state.seed, link.pass, stepTick(state));
  if (!pose) unlink(state, 'passOver', events);
  else if (pose.leg === 'turn') unlink(state, 'turnaround', events);
  else if (pirateNear(state, player.body.pos, CONVOY.linkPirateRadius)) unlink(state, 'pirates', events);
  else if (linkBlocked(state, link.pass)) {
    unlink(state, 'blocked', events);
    player.body = { ...player.body, vel: { x: 0, y: 0 }, angVel: 0 };
  }
}

/**
 * Dev only (`debugGuild { what: 'convoy' }`): the ship stopped relative to the nearest pass in flight,
 * ready to link – 2 u off the trade port, the convoy's heading and velocity. False when no pass flies.
 */
export function moveBesideConvoy(state: SimState): boolean {
  const { player } = state;
  if (player.destroyed || player.dock.mode !== 'flying' || state.sites.berth !== null || state.convoys.link !== null) return false;
  const pos = player.body.pos;
  let best: ConvoyPose | null = null;
  let bestD = Infinity;
  for (const pose of convoysNear(state.seed, pos, Infinity, state.tick)) {
    if (pose.leg === 'turn') continue;
    const t = pose.ships[0]!.pos;
    const d = Math.hypot(t.x - pos.x, t.y - pos.y);
    if (d < bestD) {
      bestD = d;
      best = pose;
    }
  }
  if (!best) return false;
  const to = linkPose(best, player.props.boundingRadius + 2);
  player.body = { pos: to.pos, vel: { ...best.vel }, angle: to.angle, angVel: 0 };
  player.prevBody = player.body;
  state.world.update(to.pos);
  return true;
}

/** `debugGuild { what: 'convoy' }` (dev builds only): `moveBesideConvoy`; production builds answer "unavailable". */
export function debugConvoyNear(state: SimState, action: GameAction): SimEvent[] {
  const ok = import.meta.env.DEV && moveBesideConvoy(state);
  return [ok ? { type: 'actionResult', reqId: action.reqId, ok: true } : { type: 'actionResult', reqId: action.reqId, ok: false, reason: 'serviceUnavailable' }];
}
