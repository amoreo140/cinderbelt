// Looks of the M4b enemies (plan 2026-10-19 T14) – pure helpers the combat layer reads the simulation
// through: which dress a ship wears (clan pirate, derelict sentry drone, powered-down sleeper), the
// Gunner's salvo tell (its cannons charge up before every salvo so the player can react) and the
// sentry's idle turret sweep. Looks only – nothing here feeds back into the simulation.
import { GUNNER } from '../../data/pirates';
import { TICKS_PER_SECOND } from '../../sim/combat/damage';
import type { Enemy } from '../../sim/combat/types';
import type { Vec2 } from '../../sim/math/vec2';

/** pirate = clan parts in their own colours; sentry = the derelict station's drone; dormant = a sleeper. */
export type EnemyLook = 'pirate' | 'sentry' | 'dormant';

export function enemyLook(e: Pick<Enemy, 'kind' | 'ai'>): EnemyLook {
  if (e.ai.mode === 'dormant') return 'dormant';
  return e.kind === 'sentry' ? 'sentry' : 'pirate';
}

/** Salvo window and cycle (ticks) – the same rounding as the Gunner AI (sim/combat/ai.ts gunnerAttack). */
export const SALVO_ON_TICKS = Math.round(GUNNER.salvo.on * TICKS_PER_SECOND);
export const SALVO_CYCLE_TICKS = SALVO_ON_TICKS + Math.round(GUNNER.salvo.off * TICKS_PER_SECOND);
/** The charge-up tell runs over the last this many ticks of the pause before a salvo. */
export const SALVO_CHARGE_TICKS = Math.round(0.9 * TICKS_PER_SECOND);

export interface SalvoTell {
  /** 0..1 – the cannons glow up to the salvo (0 = no tell). */
  charge: number;
  /** The salvo window is open (the cannons fire while the target is in reach). */
  firing: boolean;
}

/**
 * The Gunner's tell from its salvo clock (`ai.breakOff`, counted by the AI after its decision: the
 * next step fires when it is below the salvo window). `alpha` = the frame's interpolation between
 * steps. Only a Gunner that attacks a target in reach shows it – an evading or fleeing one is silent.
 */
export function salvoTell(e: Pick<Enemy, 'kind' | 'ai'>, inReach: boolean, alpha: number, out: SalvoTell = { charge: 0, firing: false }): SalvoTell {
  out.charge = 0;
  out.firing = false;
  if (e.kind !== 'gunner' || e.ai.mode !== 'attack' || !inReach) return out;
  const b = e.ai.breakOff;
  if (b < SALVO_ON_TICKS) {
    out.firing = true;
    out.charge = 1;
    return out;
  }
  const from = SALVO_CYCLE_TICKS - SALVO_CHARGE_TICKS;
  if (b >= from) out.charge = Math.min(1, Math.max(0, (b - from + alpha) / SALVO_CHARGE_TICKS));
  return out;
}

/** Sentry idle sweep: half-width of the arc (rad, inside the cannon arc) and its period (s). */
export const SWEEP_HALF = 0.85;
export const SWEEP_PERIOD = 5.5;

/**
 * Where an idle sentry's turret looks (ship frame, from the centre of mass): a slow sweep left and
 * right of its nose, each drone on its own phase. `out` is reused (no object per frame).
 */
export function idleSweep(time: number, phase: number, out: Vec2): Vec2 {
  const a = SWEEP_HALF * Math.sin(((time + phase) / SWEEP_PERIOD) * Math.PI * 2);
  out.x = Math.cos(a) * 30;
  out.y = Math.sin(a) * 30;
  return out;
}

/** Standby blink of a dormant sleeper: a short faint pulse every `period` s (0..1). */
export function standbyBlink(time: number, phase: number, period = 2.6): number {
  const t = (((time + phase) % period) + period) % period;
  // a 0.18 s pulse, eased in and out
  return t < 0.18 ? Math.sin((t / 0.18) * Math.PI) : 0;
}
