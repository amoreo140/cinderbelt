// The public surface of the M4d Guild (the M4d Guild and trade plan,
// Guild section, T0). Every function lives in the file of the task that fills it and is re-exported here, so
// this file never changes after T0:
//
//   relaySites.ts   T2   guildRelaySites, guildRelayCandidates, relayMastColliders, relayMastHitTargets
//   relayChain.ts   T2   relayContractSites, relayOffer, relaySeconds, relayInteraction, interactRelay,
//                        relaySpawns, stepRelayChain, stepRelayContracts
//   watchRoutes.ts  T3   scheduledWatchNear (+ the route math moved from render/borders/guildWatch.ts)
//   watch.ts        T3   stepWatch, spawnRelayWatch
//   watchAi.ts      T3   stepWatchAi (internal)
//   watchHits.ts    T3   watchColliders, watchHitTargets, onWatchHit
//   debug.ts        T2/T3/T5 in turn   isGuildAction, guildAction (`debugGuild`, dev builds only)
//   ../pirates/sectors.ts  T1   securedSectors (the one source of truth of the secured sectors)
//
// User decision 2026-10-16: NO friendly fire – no offence / hostility / fine (`recordOffence`, `payFine`
// and offence.ts of the plan are dropped).
//
// Hooks in hot files (T0): Simulation.ts (`stepGuild` between stepSites and stepCombat, `guildAction`),
// npc/index.ts (Watch and relay mast colliders / hit targets), placement.ts (`guildRelayCandidates`),
// generate.ts (`relayOffer` pinned next to the first chart), board.ts (`relayContractSites` in the board
// context, `relaySeconds`), career.ts (`relayInteraction` / `interactRelay`, `relaySpawns`,
// `stepRelayContracts`).
import type { SimEvent, SimState } from '../Simulation';
import { stepRelayChain } from './relayChain';
import { stepWatch } from './watch';

export * from './types';
export { createGuild } from './state';
export { guildRelaySites, guildRelayCandidates, relayMastColliders, relayMastHitTargets } from './relaySites';
export {
  relayContractSites,
  relayOffer,
  relaySeconds,
  relayInteraction,
  interactRelay,
  relaySpawns,
  stepRelayChain,
  stepRelayContracts,
} from './relayChain';
export { scheduledWatchNear, type ScheduledWatch } from './watchRoutes';
export { stepWatch, spawnRelayWatch } from './watch';
export { watchColliders, watchHitTargets, onWatchHit } from './watchHits';
export { isGuildAction, guildAction } from './debug';
export { securedSectors } from '../pirates/sectors';

/**
 * One step of the Guild, after the world sites (relays saw this step's beams) and before combat: the
 * relay chain first (it may call the reinforcement), then the live Watch.
 */
export function stepGuild(state: SimState, events: SimEvent[], dt: number): void {
  stepRelayChain(state, events, dt);
  stepWatch(state, events, dt);
}
