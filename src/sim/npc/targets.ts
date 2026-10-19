// Pirate targets and the AI ship budget (M4d plan §2.3 "Pirates' response", DH §12.4) – OWNED BY T4.
//
// `pirateTarget` (stateless – no saved state of its own): the player when targetable and within the
// pirate's AGGRO_RANGE; an escort-ambush pirate (`ea:<serial>:…`) the escorted trader (`es:<serial>:trader`)
// first; else the nearest live Watch ship or escorted convoy ship within AGGRO_RANGE (it shoots back);
// else today's target (the flying player at any distance – `think` decides by distance and leash).
// A pirate already fighting (attack / evade / flee / retreat) keeps an NPC opponent up to LEASH_RANGE
// unless the player is nearer, so a fight with the Watch does not flip at the aggro edge. `think()` is
// unchanged – it gets the chosen target. Scavengers, sentries, sleepers and a toll hail keep today's
// target (the player).
// `npcBudgetLeft`: AI ships still allowed – pirates + live Watch + escort convoy ships ≤ WATCH.aiBudget.
import { WATCH } from '../../data/guild';
import { AGGRO_RANGE, LEASH_RANGE, type AiTarget } from '../combat/ai';
import type { Enemy } from '../combat/types';
import { escortHitTargets } from '../convoys';
import { hypot, type Vec2 } from '../math/vec2';
import type { SimState } from '../Simulation';
import { NPC_PREFIX } from './types';

const AT_REST: Vec2 = { x: 0, y: 0 };
const AMBUSH_PREFIX = 'ea:';

/** The pirate fights (its target choice keeps an NPC opponent up to the leash). */
const fighting = (e: Enemy): boolean => e.ai.mode === 'attack' || e.ai.mode === 'evade' || e.ai.mode === 'flee' || e.ai.mode === 'retreat';

/** The escort serial of an ambush pirate `ea:<serial>:<k>:<i>` (null for any other id). */
function ambushSerial(id: string): string | null {
  if (!id.startsWith(AMBUSH_PREFIX)) return null;
  const end = id.indexOf(':', AMBUSH_PREFIX.length);
  return end > AMBUSH_PREFIX.length ? id.slice(AMBUSH_PREFIX.length, end) : null;
}

/** The target a pirate's AI fights this step, or null (patrol). */
export function pirateTarget(state: SimState, e: Enemy): AiTarget | null {
  const { player } = state;
  const you: AiTarget | null = player.dock.mode === 'flying' && !player.destroyed ? { pos: player.body.pos, vel: player.body.vel } : null;
  // only pirates that fight ships choose; the rest keep the pre-M4d rule
  if (e.kind === 'scavenger' || e.kind === 'sentry' || e.ai.mode === 'dormant' || e.ai.mode === 'hail') return you;
  const watch = state.guild.watch;
  const escorts = escortHitTargets(state);
  if (watch.length === 0 && escorts.length === 0) return you;

  const pos = e.body.pos;
  // an escort ambush goes for its trader first, wherever it is
  const serial = ambushSerial(e.id);
  if (serial !== null) {
    const trader = escorts.find((t) => t.id === `${NPC_PREFIX.escort}${serial}:trader`);
    if (trader) return { pos: trader.pos, vel: trader.vel ?? AT_REST };
  }
  const toYou = you ? hypot(you.pos.x - pos.x, you.pos.y - pos.y) : Infinity;
  if (toYou <= AGGRO_RANGE[e.kind]) return you;

  // the nearest live Watch ship or escorted convoy ship within reach
  const reach = fighting(e) ? Math.max(LEASH_RANGE, AGGRO_RANGE[e.kind]) : AGGRO_RANGE[e.kind];
  let best: AiTarget | null = null;
  let bestD = reach;
  for (const w of watch) {
    if (w.hull <= 0) continue;
    const d = hypot(w.body.pos.x - pos.x, w.body.pos.y - pos.y);
    if (d <= bestD) {
      bestD = d;
      best = { pos: w.body.pos, vel: w.body.vel };
    }
  }
  for (const t of escorts) {
    if (!t.damageable) continue;
    const d = hypot(t.pos.x - pos.x, t.pos.y - pos.y);
    if (d <= bestD) {
      bestD = d;
      best = { pos: t.pos, vel: t.vel ?? AT_REST };
    }
  }
  // a fighting pirate keeps the player when the player is the nearer opponent
  if (best && toYou < bestD) return you;
  return best ?? you;
}

/**
 * How many more AI ships may exist now (pirates + live Watch + escort convoy ships ≤ WATCH.aiBudget,
 * DH §12.4). Escort convoy ships are counted from `escortHitTargets` (T6: it lists every live escort ship).
 */
export function npcBudgetLeft(state: SimState): number {
  return WATCH.aiBudget - state.combat.enemies.length - state.guild.watch.length - escortHitTargets(state).length;
}
