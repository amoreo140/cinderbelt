// What the convoy layer draws (M4d plan §2.5, T14) – pure, unit tested: the convoy ships near the
// camera from the published schedule (`convoysNear`), their flame levels, whether the trader still
// carries its containers, the trade-port marker the player lines up with, the link clamp, and the
// lamp colours of each model. No three.js here – ConvoyLayer.ts turns it into instances and sprites.
//
// Time: after a simulation step the ship stands where the convoys are at `state.tick` (link.ts pins
// it there), so the render interpolates the convoys at `state.tick - 1 + alpha` – the same blend as
// the player's `prevBody → body`.
import { CONVOY, CONVOY_SHAPES } from '../../data/convoys';
import { convoysNear, type ConvoyPose, type ConvoyShipKind, type ConvoyTrade } from '../../sim/convoys';
import type { Vec2 } from '../../sim/math/vec2';

/** Convoys with a ship within this distance of the view centre are drawn (u). */
export const CONVOY_RENDER_RANGE = 700;
/** The trade-port marker shows while the ship's centre is within this distance of the port (u)… */
export const MARKER_RANGE = 60;
/** …fully bright inside this distance (u). */
const MARKER_FULL = 40;
/** Flame throttle while cruising along the lane and in the slower turn-around. */
const CRUISE_THROTTLE = 0.55;
const TURN_THROTTLE = 0.3;
/** Bit mask of every rare item slot of a pass. */
const ALL_SLOTS = (1 << CONVOY.slots) - 1;

/** The convoy tick drawn this frame (between the last two simulation steps). */
export const renderTick = (tick: number, alpha: number): number => Math.max(0, tick - 1 + alpha);

/** One convoy ship to draw. */
export interface ConvoyShipView {
  /** Stable while the ship is in view: `<pass>:<kind>`. */
  id: string;
  kind: ConvoyShipKind;
  pos: Vec2;
  heading: number;
  /** Flame level 0..1 (0 = drives off). */
  throttle: number;
  /** The trader still carries its containers (false once every rare item of the pass is sold). */
  cargo: boolean;
}

/** Every rare item of the pass is bought – the trader's containers are gone. */
export const soldOut = (trade: ConvoyTrade | undefined): boolean => trade !== undefined && (trade.bought & ALL_SLOTS) === ALL_SLOTS;

/** Flame level of a pass on a leg of its route. */
export const legThrottle = (leg: ConvoyPose['leg']): number => (leg === 'turn' ? TURN_THROTTLE : CRUISE_THROTTLE);

/** The ships of the convoy passes near `center` at `tick` (appended to `out`, which is returned with the poses). */
export function convoyShipsNear(
  seed: number,
  center: Vec2,
  range: number,
  tick: number,
  trades: ReadonlyMap<string, ConvoyTrade>,
  out: ConvoyShipView[] = [],
): { ships: ConvoyShipView[]; poses: ConvoyPose[] } {
  const poses = convoysNear(seed, center, range, tick);
  for (const pose of poses) {
    const throttle = legThrottle(pose.leg);
    const cargo = !soldOut(trades.get(pose.pass));
    for (const s of pose.ships) out.push({ id: `${pose.pass}:${s.kind}`, kind: s.kind, pos: s.pos, heading: s.heading, throttle, cargo });
  }
  return { ships: out, poses };
}

/** A point given in a convoy ship's frame (x = bow, y = port / left) in the world. */
export function shipPoint(ship: { pos: Vec2; heading: number }, local: { x: number; y: number }): Vec2 {
  const c = Math.cos(ship.heading);
  const s = Math.sin(ship.heading);
  return { x: ship.pos.x + local.x * c - local.y * s, y: ship.pos.y + local.x * s + local.y * c };
}

/** The trader's trade port in the world and the outward normal (its port side). */
export function tradePortOf(trader: { pos: Vec2; heading: number }): { pos: Vec2; out: Vec2 } {
  return { pos: shipPoint(trader, CONVOY_SHAPES.trader.tradePort!), out: { x: -Math.sin(trader.heading), y: Math.cos(trader.heading) } };
}

/** The trade-port marker: a ring where the ship will sit, chevrons pointing at the port. */
export interface PortMarker {
  /** Centre of the ring: the pinned pose (port + the ship's bounding radius outward). */
  pos: Vec2;
  /** Unit vector from the ring towards the port. */
  dir: Vec2;
  /** Ring radius (u): the ship's bounding radius. */
  radius: number;
  /** 0..1 – fades in from MARKER_RANGE to MARKER_FULL. */
  alpha: number;
  /** The link would be accepted now (port gap and relative speed within the limits). */
  ready: boolean;
}

/**
 * The marker of the nearest trade port within MARKER_RANGE of a flying, unlinked ship (a trader in
 * its turn-around takes no link, so it shows none). Null = no marker.
 */
export function portMarker(poses: readonly ConvoyPose[], ship: { pos: Vec2; vel: Vec2; radius: number }): PortMarker | null {
  let best: PortMarker | null = null;
  let bestD = Infinity;
  for (const pose of poses) {
    if (pose.leg === 'turn') continue;
    const trader = pose.ships[0];
    if (!trader || trader.kind !== 'trader') continue;
    const port = tradePortOf(trader);
    const d = Math.hypot(port.pos.x - ship.pos.x, port.pos.y - ship.pos.y);
    if (d > MARKER_RANGE || d >= bestD) continue;
    bestD = d;
    const gap = Math.max(0, d - ship.radius);
    const speed = Math.hypot(ship.vel.x - pose.vel.x, ship.vel.y - pose.vel.y);
    best = {
      pos: { x: port.pos.x + port.out.x * ship.radius, y: port.pos.y + port.out.y * ship.radius },
      dir: { x: -port.out.x, y: -port.out.y },
      radius: ship.radius,
      alpha: Math.min(1, Math.max(0, (MARKER_RANGE - d) / (MARKER_RANGE - MARKER_FULL))),
      ready: gap <= CONVOY.linkRange && speed <= CONVOY.linkSpeed,
    };
  }
  return best;
}

/** The link clamp: from the trade port to the linked ship's centre; null when the pass is not in view. */
export function clampBeam(poses: readonly ConvoyPose[], pass: string, shipPos: Vec2): { from: Vec2; to: Vec2 } | null {
  const pose = poses.find((p) => p.pass === pass);
  const trader = pose?.ships[0];
  if (!trader || trader.kind !== 'trader') return null;
  return { from: tradePortOf(trader).pos, to: { x: shipPos.x, y: shipPos.y } };
}

export type LampColor = 'red' | 'green' | 'white' | 'amber' | 'strobe';

/**
 * Lamp colours of the convoy models (npc_ships.json `lamps`; the trader as the tanker – its amber
 * beacon_3 sits right above the trade port). Lamps not listed are not lit by the layer.
 */
export const LAMPS: Readonly<Record<ConvoyShipKind, Readonly<Record<string, LampColor>>>> = {
  trader: { beacon_0: 'red', beacon_1: 'green', beacon_2: 'white', beacon_3: 'amber' },
  tanker: { beacon_0: 'red', beacon_1: 'green', beacon_2: 'white', beacon_3: 'amber' },
  cutter: { beacon_0: 'red', beacon_1: 'green', beacon_2: 'white', beacon_3: 'white', strobe_0: 'strobe', strobe_1: 'strobe' },
};

/** Flame length per kind (npc_ships.json `flame.length`; the trader as StationTraffic). */
export const FLAME_LENGTH: Readonly<Record<ConvoyShipKind, number>> = { trader: 2.6, tanker: 2.2, cutter: 1.6 };

/**
 * The flame strip's vertex shader (fx/flame.ts) for an InstancedMesh: every flame of every convoy in
 * one draw call. The strip reads its base and axis from the model matrix – here the model matrix
 * times the instance's. Throws when the source no longer has the expected shape (guarded by a test
 * and the shader warm-up e2e).
 */
export function instancedFlameShader(vertex: string): string {
  if (!vertex.includes('void main() {') || !vertex.includes('modelMatrix')) throw new Error('flame vertex shader changed – update instancedFlameShader');
  return vertex.replace(/modelMatrix/g, 'flameModel').replace('void main() {', 'void main() {\n  mat4 flameModel = modelMatrix * instanceMatrix;');
}
