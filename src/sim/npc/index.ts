// The public surface of the non-pirate ships in combat (M4d plan §2.3, §2.4, §3, T0): live Guild Watch
// ships, convoy ships and the Guild relay mast. Every function lives in the file of the task that fills
// it and is re-exported or composed here, so this file never changes after T0:
//
//   sides.ts    T4   sideOf, canHit (the projectile hit predicate – no friendly fire)
//   targets.ts  T4   pirateTarget, npcBudgetLeft
//   hits.ts     T4   npcProjectiles (the pass over `npcHitTargets`, next to `siteProjectiles`)
//   ../guild    T2 / T3   relay mast and Watch colliders, hit targets, `onWatchHit`
//   ../convoys  T5 / T6   convoy colliders, hit targets, `onConvoyHit`
//
// Hooks in hot files (T0): Simulation.ts (`npcColliders` in the player's obstacle and mining-blocker
// lists), combat.ts (`pirateTarget` in `stepEnemy`, `npcColliders` for pirates / wrecks / containers,
// `npcProjectiles` next to `siteProjectiles`, `canHit` passed to `stepProjectiles`).
import type { Vec2 } from '../math/vec2';
import type { Circle } from '../physics/collide';
import type { SimEvent, SimState } from '../Simulation';
import { convoyColliders, convoyHitTargets, onConvoyHit } from '../convoys';
import { onWatchHit, relayMastColliders, relayMastHitTargets, watchColliders, watchHitTargets } from '../guild';
import type { HitBox, NpcHit, NpcHitTarget } from './types';

export * from './types';
export { sideOf, canHit } from './sides';
export { pirateTarget, npcBudgetLeft } from './targets';
export { npcProjectiles } from './hits';

const NO_CIRCLES: readonly Circle[] = [];
const NO_TARGETS: readonly NpcHitTarget[] = [];

/**
 * NPC obstacles within `reach` of `pos`: live Watch ships, convoy ships (safe – pushed out like a
 * station, no ram damage either way) and the Guild relay masts (hard, like a derelict relay). Hot path:
 * asked for every ship, wreck and container every step – an empty answer allocates nothing.
 */
export function npcColliders(state: SimState, pos: Vec2, reach: number): readonly Circle[] {
  const watch = watchColliders(state, pos, reach);
  const convoys = convoyColliders(state, pos, reach);
  const masts = relayMastColliders(state, pos, reach);
  const n = watch.length + convoys.length + masts.length;
  if (n === 0) return NO_CIRCLES;
  if (n === watch.length) return watch;
  if (n === convoys.length) return convoys;
  if (n === masts.length) return masts;
  return [...watch, ...convoys, ...masts];
}

function pushAll(out: Circle[], list: readonly Circle[]): void {
  for (let i = 0; i < list.length; i++) out.push(list[i]!);
}

/** `npcColliders` appended to `out` (same order). Returns `out`. */
export function npcCollidersInto(state: SimState, pos: Vec2, reach: number, out: Circle[]): Circle[] {
  pushAll(out, watchColliders(state, pos, reach));
  pushAll(out, convoyColliders(state, pos, reach));
  pushAll(out, relayMastColliders(state, pos, reach));
  return out;
}

/**
 * Everything near the player a projectile can hit that is not a pirate / the player. With `near` (the
 * bounds of the step's shots) a scheduled convoy that no shot can reach is left out.
 */
export function npcHitTargets(state: SimState, near?: HitBox): readonly NpcHitTarget[] {
  const watch = watchHitTargets(state);
  const convoys = convoyHitTargets(state, near);
  const masts = relayMastHitTargets(state);
  const n = watch.length + convoys.length + masts.length;
  if (n === 0) return NO_TARGETS;
  if (n === watch.length) return watch;
  if (n === convoys.length) return convoys;
  if (n === masts.length) return masts;
  return [...watch, ...convoys, ...masts];
}

/** A projectile hit an NPC target (consumed by the caller): the owner module reacts. */
export function onNpcHit(state: SimState, target: NpcHitTarget, hit: NpcHit, events: SimEvent[]): void {
  if (target.kind === 'watch') onWatchHit(state, target, hit, events);
  else if (target.kind === 'convoy') onConvoyHit(state, target, hit, events);
  else events.push({ type: 'projectileHit', target: 'station', owner: hit.owner, ref: null, pos: { ...hit.pos }, damage: hit.damage, from: { ...hit.from }, site: target.id });
}
