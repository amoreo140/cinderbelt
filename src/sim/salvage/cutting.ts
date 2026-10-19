// Cutting joints with the mining laser (5.3.1): a beam that missed every asteroid stops on a cell of a
// dismantlable wreck (shaped cells by their polygon – the beam passes the empty half of a wedge). On a
// joint (a part holding the wreck together) the cut progresses; after ~3 s the joint is cut and the
// wreck falls apart into pieces. A beam off a joint only scorches the hull.
import { CUT_DECAY, CUT_REFERENCE_RATE, CUT_SECONDS } from '../../data/salvage';
import { raycastShip, worldToGrid } from '../combat/geometry';
import type { Wreck } from '../combat/types';
import { add, length, scale, sub, type Vec2 } from '../math/vec2';
import type { MiningBeam } from '../mining/mining';
import type { Circle } from '../physics/collide';
import type { ShipProperties } from '../ship/properties';
import type { SimEvent, SimState } from '../Simulation';
import { cutJoint, jointParts } from './dismantle';

/** Dismantlable wrecks as obstacles for mining lasers (a beam does not pass through a hull). */
export function hulkCircles(state: SimState, pos: Vec2, radius: number): Circle[] {
  const out: Circle[] = [];
  for (const w of state.combat.wrecks) {
    if (!w.dismantle) continue;
    if (length(sub(w.body.pos, pos)) <= radius + w.props.boundingRadius) out.push({ pos: w.body.pos, radius: w.props.boundingRadius });
  }
  return out;
}

/** Cutting speed of a laser (share of a joint per second). */
export const cutRate = (laserRate: number): number => Math.sqrt(laserRate / CUT_REFERENCE_RATE) / CUT_SECONDS;

/** First hit on the wreck's parts along the segment (polygon-aware). */
function wreckHit(w: Wreck, from: Vec2, to: Vec2): { t: number; partId: number } | null {
  const hit = raycastShip(w.grid, worldToGrid(w.body, w.props.centerOfMass, from), worldToGrid(w.body, w.props.centerOfMass, to));
  return hit ? { t: hit.t, partId: hit.partId } : null;
}

/**
 * Beams that missed every asteroid stop on a wreck's cell and cut joints. Mutates `beams` (the beam
 * end, `wreck`) and the wrecks (cut progress, cut).
 */
export function applyCutting(state: SimState, beams: MiningBeam[], props: ShipProperties, dt: number, events: SimEvent[]): void {
  const hits = new Map<number, { partId: number; rate: number }>();
  for (const beam of beams) {
    if (beam.asteroidId !== null) continue;
    const laser = props.lasers[beam.laser];
    if (!laser) continue;
    const d = sub(beam.to, beam.from);
    const len = length(d);
    if (len < 1e-6) continue;
    const dir = scale(d, 1 / len);
    const end = add(beam.from, scale(dir, laser.range));
    let best: { w: Wreck; t: number; partId: number } | null = null;
    for (const w of state.combat.wrecks) {
      if (!w.dismantle) continue;
      if (length(sub(w.body.pos, beam.from)) > laser.range + w.props.boundingRadius) continue;
      const hit = wreckHit(w, beam.from, end);
      if (hit && (!best || hit.t < best.t)) best = { w, t: hit.t, partId: hit.partId };
    }
    if (!best) continue;
    beam.to = add(beam.from, scale(dir, best.t * laser.range));
    beam.wreck = best.w.id;
    const h = hits.get(best.w.id);
    if (!h || h.partId === best.partId) hits.set(best.w.id, { partId: best.partId, rate: (h?.rate ?? 0) + cutRate(laser.rate) });
  }
  // cut progress: a beam on the joint raises it, without a beam it cools down
  for (const w of [...state.combat.wrecks]) {
    const h = hits.get(w.id);
    const onJoint = h && jointParts(w.grid).has(h.partId) ? h : null;
    if (!onJoint) {
      if (w.cutting) {
        w.cutting.progress -= CUT_DECAY * dt;
        if (w.cutting.progress <= 0) delete w.cutting;
      }
      continue;
    }
    const progress = (w.cutting?.partId === onJoint.partId ? w.cutting.progress : 0) + onJoint.rate * dt;
    if (progress >= 1) cutJoint(state, w, onJoint.partId, events);
    else w.cutting = { partId: onJoint.partId, progress };
  }
}
