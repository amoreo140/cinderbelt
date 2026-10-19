// Projectiles against NPC targets (M4d plan §2.3, §2.4) – OWNED BY T4.
//
// `npcProjectiles` runs next to `siteProjectiles` (combat.ts): every projectile that reaches an
// `npcHitTargets` target this step and passes `canHit(owner, target.id)` stops at the nearest one along
// its path (like `siteProjectiles`); `onNpcHit` hands the hit to the owner module (Watch: shield bubble
// then hull, `npcHit` / `npcDestroyed`; escorted convoy ship: hull; scheduled convoy ship / relay mast:
// a spent hit). Player shots never stop at a Watch or convoy ship (no friendly fire) – they fly on.
import { SHIELD_MARGIN } from '../combat/projectiles';
import { segmentCircle } from '../combat/geometry';
import type { Projectile } from '../combat/types';
import type { SimEvent, SimState } from '../Simulation';
import { npcHitTargets, onNpcHit } from './index';
import { canHit } from './sides';
import type { HitBox, NpcHitTarget } from './types';

/** The circle a shot hits: the shield bubble while the shield holds, else the hull. */
const hitRadius = (t: NpcHitTarget): number => (t.shield > 0 ? t.radius + SHIELD_MARGIN : t.radius);

/** Scratch of `npcProjectiles` (segmentCircle and the target listing keep nothing). */
const BOX: HitBox = { x0: 0, y0: 0, x1: 0, y1: 0 };
const SEGMENT_END = { x: 0, y: 0 };

/**
 * Removes the projectiles that hit an NPC target this step (the rest fly on in `applyHits`) and hands each
 * hit to the target's owner module (`onNpcHit`).
 */
export function npcProjectiles(state: SimState, events: SimEvent[], dt: number): void {
  // no shot in flight: the targets are not even listed (they are rebuilt every step near a convoy)
  if (state.combat.projectiles.length === 0) return;
  // the bounds of this step's segments: a scheduled convoy far from every shot is not listed
  const box = BOX;
  box.x0 = Infinity;
  box.y0 = Infinity;
  box.x1 = -Infinity;
  box.y1 = -Infinity;
  const all = state.combat.projectiles;
  for (let i = 0; i < all.length; i++) {
    const p = all[i]!;
    const tx = p.pos.x + p.vel.x * dt;
    const ty = p.pos.y + p.vel.y * dt;
    // (min / max of two at a time: no builtin call with an argument list)
    if (p.pos.x < box.x0) box.x0 = p.pos.x;
    if (tx < box.x0) box.x0 = tx;
    if (p.pos.y < box.y0) box.y0 = p.pos.y;
    if (ty < box.y0) box.y0 = ty;
    if (p.pos.x > box.x1) box.x1 = p.pos.x;
    if (tx > box.x1) box.x1 = tx;
    if (p.pos.y > box.y1) box.y1 = p.pos.y;
    if (ty > box.y1) box.y1 = ty;
  }
  const targets = npcHitTargets(state, box);
  if (targets.length === 0) return;
  const { combat } = state;
  const projectiles = combat.projectiles;
  // the flying ones, copied only once the first one stops (no stop: the list stays as it is)
  let keep: Projectile[] | null = null;
  const to = SEGMENT_END;
  for (let i = 0; i < projectiles.length; i++) {
    const p = projectiles[i]!;
    to.x = p.pos.x + p.vel.x * dt;
    to.y = p.pos.y + p.vel.y * dt;
    let bestT = 0;
    let best: NpcHitTarget | null = null;
    for (let k = 0; k < targets.length; k++) {
      const target = targets[k]!;
      if (!canHit(p.owner, target.id)) continue;
      const r = hitRadius(target);
      const inside = (p.pos.x - target.pos.x) ** 2 + (p.pos.y - target.pos.y) ** 2 <= r * r;
      const t = inside ? 0 : segmentCircle(p.pos, to, target.pos, r);
      if (t !== null && (!best || t < bestT)) {
        bestT = t;
        best = target;
      }
    }
    if (!best) {
      keep?.push(p);
      continue;
    }
    keep ??= projectiles.slice(0, i);
    const pos = { x: p.pos.x + (to.x - p.pos.x) * bestT, y: p.pos.y + (to.y - p.pos.y) * bestT };
    onNpcHit(state, best, { owner: p.owner, pos, damage: p.damage, from: { ...p.origin } }, events);
  }
  if (keep) combat.projectiles = keep;
}
