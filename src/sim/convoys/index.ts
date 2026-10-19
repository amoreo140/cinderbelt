// The public surface of the M4d convoys (the M4d Guild and trade plan,
// convoy section, T0). Every function lives in the file of the task that fills it and is re-exported here,
// so this file never changes after T0:
//
//   schedule.ts  T5   convoyAt, convoysInFlight, convoysNear, convoySectorsInEpoch,
//                     scheduledConvoyColliders, scheduledConvoyHitTargets
//   link.ts      T5   tryConvoyLink, holdLink, stepLink
//   trade.ts     T5   isConvoyAction, convoyAction, convoyOffer, pruneTrades (one helper line T7)
//   flyby.ts     T5   convoyFlybyEvents, stepConvoyFlyby
//   escort.ts    T6   escortAvailable, escortOffer, escortSeconds, escortSpawns, stepEscortContracts,
//                     escortDeposit, escortRefund, stepEscorts, escortColliders, escortHitTargets, onConvoyHit
//
// Hooks in hot files (T0): Simulation.ts (`stepConvoys` between stepSites and stepCombat, `holdLink`
// instead of the flight step while linked, `tryConvoyLink` first in tryDock, convoy actions),
// npc/index.ts (convoy colliders / hit targets), director.ts (`convoyFlybyEvents`, `stepConvoyFlyby`),
// sector.ts (`convoySectorsInEpoch`), generate.ts (`escortAvailable` / `escortOffer`), board.ts
// (`escortSeconds`), career.ts (`escortSpawns`, `stepEscortContracts`, `escortDeposit`, `escortRefund`).
import type { Vec2 } from '../math/vec2';
import type { Circle } from '../physics/collide';
import type { HitBox, NpcHitTarget } from '../npc/types';
import type { SimEvent, SimState } from '../Simulation';
import { escortColliders, escortHitTargets, stepEscorts } from './escort';
import { stepLink } from './link';
import { scheduledConvoyColliders, scheduledConvoyHitTargets } from './schedule';
import { pruneTrades } from './trade';

export * from './types';
export { createConvoys } from './state';
export {
  convoyAt,
  convoysInFlight,
  convoysNear,
  convoySectorsInEpoch,
  scheduledConvoyColliders,
  scheduledConvoyHitTargets,
} from './schedule';
export { tryConvoyLink, holdLink, stepLink } from './link';
export { isConvoyAction, convoyAction, convoyOffer, pruneTrades } from './trade';
export { convoyFlybyEvents, stepConvoyFlyby } from './flyby';
export {
  escortAvailable,
  escortOffer,
  escortSeconds,
  escortSpawns,
  stepEscortContracts,
  escortDeposit,
  escortRefund,
  stepEscorts,
  escortColliders,
  escortHitTargets,
  onConvoyHit,
} from './escort';

/**
 * One step of the convoys, after the world sites and the Guild, before combat: the link's auto-unlink
 * checks, the escort convoys' flight, then the trades of passes that are over are dropped.
 */
export function stepConvoys(state: SimState, events: SimEvent[], dt: number): void {
  stepLink(state, events);
  stepEscorts(state, events, dt);
  pruneTrades(state);
}

/** Convoy ship circles within `reach` of `pos`: the scheduled passes and the escort convoys (safe, moving). */
export function convoyColliders(state: SimState, pos: Vec2, reach: number): readonly Circle[] {
  const scheduled = scheduledConvoyColliders(state, pos, reach);
  const escort = escortColliders(state, pos, reach);
  if (escort.length === 0) return scheduled;
  if (scheduled.length === 0) return escort;
  return [...scheduled, ...escort];
}

/**
 * Convoy ships near the player as projectile targets: scheduled (spent hits) and escorted (damageable).
 * `near`: only the scheduled passes that can reach these bounds (see `scheduledConvoyHitTargets`).
 */
export function convoyHitTargets(state: SimState, near?: HitBox): readonly NpcHitTarget[] {
  const scheduled = scheduledConvoyHitTargets(state, near);
  const escort = escortHitTargets(state);
  if (escort.length === 0) return scheduled;
  if (scheduled.length === 0) return escort;
  return [...scheduled, ...escort];
}
