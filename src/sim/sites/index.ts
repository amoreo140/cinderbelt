// The public surface of the M4b world sites (M4b plan,
// T0). Every function lives in the file of the task that fills it and is re-exported here, so this
// file never changes after T0 (M4d adds the Guild relays in `relayCandidates`, placement.ts):
//
//   placement.ts  T3   sitesInChunk, sitesNear, siteById, relayById, relayCandidates
//   relays.ts     T3   stepRelays, isRelayPowered, relayCharge   (generic – no derelict knowledge)
//   colliders.ts  T3   structureColliders, structureHitTargets, onStructureHit
//   derelict.ts   T4   derelictState, stepDerelicts, siteStorms
//   berth.ts      T4   tryBerth, holdBerth, derelictDockTarget
//   terminal.ts   T4   terminalOffer
//   actions.ts    T4   isSiteAction, siteAction
//   graveyard.ts  T5   graveyardState, manageSiteWrecks, stepGraveyards
//   mines.ts      T5   stepMines, mineHitTargets, onMineHit
//   comets.ts     T2   cometDefs, cometById, cometAt, cometsNear, cometArc, nextPassNear, cometSignals,
//                      cometShards, cometColliders, cometHitTargets, onCometHit, stepComets
//   cometMining.ts T2  miningMovers, applyMoverExtractions
//
// Hooks in hot files (T0): Simulation.ts (stepSites after the flight step, tryBerth before the station
// dock, holdBerth instead of the flight step while berthed, movers in runMining, siteColliders in the
// collision and mining-blocker lists, site actions), combat.ts (siteColliders for pirates / wrecks /
// containers, projectiles vs `siteHitTargets` → `onSiteHit`), discovery.ts (`manageSiteWrecks`).
import type { Vec2 } from '../math/vec2';
import type { Circle } from '../physics/collide';
import type { SimEvent, SimState } from '../Simulation';
import { cometCollidersInto, cometHitTargetsInto, onCometHit, stepComets } from './comets';
import { onStructureHit, structureCollidersInto, structureHitTargetsInto } from './colliders';
import { stepDerelicts } from './derelict';
import { stepGraveyards } from './graveyard';
import { mineHitTargetsInto, onMineHit, stepMines } from './mines';
import { relayCandidates } from './placement';
import { stepRelays } from './relays';
import type { SiteHit, SiteHitTarget } from './types';

export * from './types';
export { createSites } from './state';
export { sitesInChunk, sitesNear, siteById, relayById, relayCandidates } from './placement';
export { stepRelays, isRelayPowered, relayCharge } from './relays';
export { structureColliders, structureHitTargets, onStructureHit } from './colliders';
export { derelictState, stepDerelicts, siteStorms } from './derelict';
export { tryBerth, holdBerth, derelictDockTarget } from './berth';
export { terminalOffer } from './terminal';
export { isSiteAction, siteAction } from './actions';
export { graveyardState, manageSiteWrecks, stepGraveyards } from './graveyard';
export { stepMines, mineHitTargets, onMineHit } from './mines';
export {
  cometDefs,
  cometById,
  cometAt,
  cometsNear,
  cometArc,
  nextPassNear,
  cometSignals,
  cometShards,
  cometColliders,
  cometHitTargets,
  onCometHit,
  stepComets,
} from './comets';
export { miningMovers, applyMoverExtractions } from './cometMining';

/**
 * One step of the world sites, after the flight step (the beams of this step are set) and before
 * combat. Fixed order: relays → derelicts (wake on the 2nd lit relay) → graveyards → mines → comets.
 */
export function stepSites(state: SimState, events: SimEvent[], dt: number): void {
  stepRelays(state, relayCandidates(state), events, dt);
  stepDerelicts(state, events, dt);
  stepGraveyards(state, events, dt);
  stepMines(state, events, dt);
  stepComets(state, events, dt);
}

/** Site obstacles within `reach` of `pos`: derelict / relay circles and moving comet nuclei. */
export function siteColliders(state: SimState, pos: Vec2, reach: number): Circle[] {
  return siteCollidersInto(state, pos, reach, []);
}

/** `siteColliders` appended to `out` (same order) – the per-step obstacle lists reuse one list. */
export function siteCollidersInto(state: SimState, pos: Vec2, reach: number, out: Circle[]): Circle[] {
  structureCollidersInto(state, pos, reach, out);
  return cometCollidersInto(state, pos, reach, out);
}

/** Everything near the player a projectile can hit at a site: structures, live mines, comet nuclei. */
export function siteHitTargets(state: SimState): SiteHitTarget[] {
  return siteHitTargetsInto(state, []);
}

/** `siteHitTargets` appended to `out` (same order) – the per-step projectile pass reuses one list. */
export function siteHitTargetsInto(state: SimState, out: SiteHitTarget[]): SiteHitTarget[] {
  structureHitTargetsInto(state, out);
  mineHitTargetsInto(state, out);
  return cometHitTargetsInto(state, out);
}

/** A projectile hit a site target (the projectile is consumed by the caller). */
export function onSiteHit(state: SimState, target: SiteHitTarget, hit: SiteHit, events: SimEvent[]): void {
  if (target.kind === 'mine') onMineHit(state, target, hit, events);
  else if (target.kind === 'comet') onCometHit(state, target, hit, events);
  else onStructureHit(state, target, hit, events);
}
