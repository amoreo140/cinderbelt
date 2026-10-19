// Live Guild Watch ships as obstacles and projectile targets (M4d plan §2.3 "Combat model").
//
// `watchColliders`: a circle of `WATCH.ships[kind].radius` per live ship (safe – the player and pirates are
// pushed out, no ram damage either way). `watchHitTargets`: kind 'watch', damageable, with the shield
// bubble. `onWatchHit`: the shield first, then the hull; `npcHit`; hull 0 → `npcDestroyed` (explosion FX,
// debris – no wreck, no loot), the id → `guild.lost` (back on its route after `WATCH.respawnTicks`).
// Only pirate shots reach here – the player can never hit the Watch (npc/sides.ts, no friendly fire).
import { WATCH } from '../../data/guild';
import type { Vec2 } from '../math/vec2';
import type { Circle } from '../physics/collide';
import type { NpcHit, NpcHitTarget } from '../npc/types';
import type { SimEvent, SimState } from '../Simulation';
import { sideOf } from '../npc/sides';

const NO_CIRCLES: readonly Circle[] = [];
const NO_TARGETS: readonly NpcHitTarget[] = [];

/** Live Watch ship circles within `reach` of `pos` (safe obstacles). Allocates nothing without live ships. */
export function watchColliders(state: SimState, pos: Vec2, reach: number): readonly Circle[] {
  const live = state.guild.watch;
  if (live.length === 0) return NO_CIRCLES;
  let out: Circle[] | null = null;
  for (const w of live) {
    const r = WATCH.ships[w.kind].radius;
    const dx = w.body.pos.x - pos.x;
    const dy = w.body.pos.y - pos.y;
    if (dx * dx + dy * dy > (reach + r) * (reach + r)) continue;
    (out ??= []).push({ pos: w.body.pos, radius: r, safe: true, vel: w.body.vel });
  }
  return out ?? NO_CIRCLES;
}

/** Live Watch ships that projectiles can hit (pirate shots only – `canHit`). */
export function watchHitTargets(state: SimState): readonly NpcHitTarget[] {
  const live = state.guild.watch;
  if (live.length === 0) return NO_TARGETS;
  return live.map((w) => ({ id: w.id, kind: 'watch' as const, pos: w.body.pos, vel: w.body.vel, radius: WATCH.ships[w.kind].radius, shield: w.shield, damageable: true }));
}

/** A projectile hit a live Watch ship (consumed by the caller): shield, hull, retaliation, destruction. */
export function onWatchHit(state: SimState, target: NpcHitTarget, hit: NpcHit, events: SimEvent[]): void {
  const g = state.guild;
  const ship = g.watch.find((w) => w.id === target.id);
  if (!ship) return;
  const def = WATCH.ships[ship.kind];
  const absorbed = Math.min(ship.shield, hit.damage);
  ship.shield -= absorbed;
  ship.hull = Math.max(0, ship.hull - (hit.damage - absorbed));
  ship.shieldDelay = def.shieldDelay;
  events.push({ type: 'npcHit', id: ship.id, pos: { ...hit.pos }, damage: hit.damage, shielded: absorbed > 0, by: hit.owner });
  // the retaliation target (watchAi rule 2 – the next target choice still prefers defending the player)
  if (sideOf(hit.owner) === 'pirate') {
    ship.lastHitBy = state.tick;
    if (ship.mode !== 'retreat') ship.target = hit.owner;
  }
  if (ship.hull > 0) return;
  g.watch = g.watch.filter((w) => w !== ship);
  g.lost.set(ship.id, state.tick);
  events.push({ type: 'npcDestroyed', id: ship.id, kind: ship.kind, pos: { ...ship.body.pos }, by: hit.owner });
}
