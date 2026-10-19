// Test helpers for the scheduled convoys (not used by the game): a ship beside a pass's trade port, linked.
import { IDLE_COMMAND } from '../commands';
import { flyingAt } from '../discovery/testing';
import type { Vec2 } from '../math/vec2';
import type { LaneId } from '../regions/lanes';
import type { SimEvent, Simulation } from '../Simulation';
import { linkPose } from './link';
import { convoyAt, departureTick } from './schedule';

/**
 * A flying ship `gap` u off the trade port of `pass` (hull to port) at the start of a step at `tick`,
 * matching the convoy's heading and velocity (+ `relVel`).
 */
export function besideTrader(seed: number, pass: string, tick: number, gap = 1, relVel: Vec2 = { x: 0, y: 0 }): Simulation {
  const pose = convoyAt(seed, pass, tick + 1);
  if (!pose) throw new Error(`${pass} is not in flight at ${tick}`);
  const sim = flyingAt(seed, { x: 0, y: 0 });
  const to = linkPose(pose, sim.state.player.props.boundingRadius + gap);
  sim.state.tick = tick;
  const body = { pos: to.pos, vel: { x: pose.vel.x + relVel.x, y: pose.vel.y + relVel.y }, angle: to.angle, angVel: 0 };
  sim.state.player.body = body;
  sim.state.player.prevBody = body;
  sim.state.world.update(to.pos);
  return sim;
}

/** F pressed for one step. */
export const pressF = (sim: Simulation): SimEvent[] => sim.step({ ...IDLE_COMMAND, dock: true });

/** A ship linked to `pass` (`seconds` after its departure) through a real F press. */
export function linkedTo(seed: number, lane: LaneId, n: number, seconds: number): Simulation {
  const pass = `cv:${lane}@${n}`;
  const sim = besideTrader(seed, pass, departureTick(lane, n) + seconds * 60);
  const events = pressF(sim);
  if (sim.state.convoys.link?.pass !== pass) throw new Error(`no link to ${pass}: ${JSON.stringify(events.filter((e) => e.type.includes('ink')))}`);
  return sim;
}
