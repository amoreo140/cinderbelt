// Hostile pirates around the player (readability pass, R1–R3): who counts as a threat for the combat
// zoom-out, the off-screen arrows and the red in-world markers. Reads the simulation state only.
import { AGGRO_RANGE } from '../sim/combat/ai';
import type { Enemy, EnemyKind } from '../sim/combat/types';
import type { Vec2 } from '../sim/math/vec2';

/** Arrows show hostiles up to this multiple of their aggro range (R2). */
export const ARROW_REACH = 1.2;

export interface Hostile {
  id: string;
  kind: EnemyKind;
  pos: Vec2;
  /** Distance from the player (u). */
  dist: number;
  /** The pirate's aggro range (u). */
  aggro: number;
  /** It is attacking the player right now (a Gunner's evade included). */
  attacking: boolean;
}

/**
 * Ranged attackers: the Gunner holds its standoff at its cannon reach (90 u) and a derelict's sentry
 * fights from its post – both shoot from out of the default view, so the camera frames them too.
 */
const RANGED: ReadonlySet<EnemyKind> = new Set<EnemyKind>(['gunner', 'sentry']);

/**
 * Is the pirate a threat at all? A scavenger (no aggro), a pirate paid off by the toll, or one that
 * flees, retreats home or collects loot is not; patrolling, hailing and attacking pirates are, and so
 * is a Gunner breaking away (evade) – it turns back to its standoff in a few seconds.
 */
export function isHostile(e: Pick<Enemy, 'kind' | 'calm' | 'ai'>): boolean {
  if (e.calm || AGGRO_RANGE[e.kind] <= 0) return false;
  const mode = e.ai.mode;
  return mode === 'patrol' || mode === 'attack' || mode === 'hail' || mode === 'evade';
}

/** Hostiles within `reach` × their aggro range of `pos`, nearest first. */
export function hostilesNear(enemies: readonly Enemy[], pos: Vec2, reach = ARROW_REACH): Hostile[] {
  const out: Hostile[] = [];
  for (const e of enemies) {
    if (!isHostile(e)) continue;
    const aggro = AGGRO_RANGE[e.kind];
    const dist = Math.hypot(e.body.pos.x - pos.x, e.body.pos.y - pos.y);
    if (dist > aggro * reach) continue;
    out.push({ id: e.id, kind: e.kind, pos: e.body.pos, dist, aggro, attacking: e.ai.mode === 'attack' || e.ai.mode === 'evade' });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

/**
 * The hostile the combat camera frames: the nearest one inside its aggro range (an attacker anywhere
 * within the arrow reach counts too – it is already coming), or null when there is no fight.
 */
export function combatFocus(hostiles: readonly Hostile[]): Hostile | null {
  for (const h of hostiles) if (h.dist <= h.aggro || h.attacking) return h;
  return null;
}

/**
 * Everyone the combat camera frames with the ship (`hostiles` nearest first; empty = no fight): the
 * focus (`combatFocus`), then every Gunner and sentry attacking from range – their salvo tell must be
 * on screen even while a nearer pirate is the focus.
 */
export function combatFrame(hostiles: readonly Hostile[]): Hostile[] {
  const focus = combatFocus(hostiles);
  if (!focus) return [];
  const out = [focus];
  for (const h of hostiles) if (h !== focus && h.attacking && RANGED.has(h.kind)) out.push(h);
  return out;
}

/** 0 at the arrow reach (1.2× aggro), 1 right next to the ship – drives arrow size and opacity. */
export function proximity(dist: number, aggro: number, reach = ARROW_REACH): number {
  const far = Math.max(1, aggro * reach);
  return Math.min(1, Math.max(0, 1 - dist / far));
}
