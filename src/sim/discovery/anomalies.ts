// Anomalies (5.3, 5.5): a gravity anomaly pulls in its whole field, a pass through a core gives a short
// bonus (sling, ion charge, radiation, time echo) – once per 5 minutes from the same anomaly.
import { ANOMALIES, ANOMALY_RECHARGE_SECONDS, BUFFS, GRAVITY_PULL, RADIATION_HIT, SLING_PLUS_MULT, type BuffKind } from '../../data/poi';
import { applyRam } from '../combat/combat';
import { gridToWorld } from '../combat/geometry';
import { PLAYER_REF } from '../combat/types';
import { length, sub, type Vec2 } from '../math/vec2';
import { partCenter } from '../ship/grid';
import type { SimEvent, SimState } from '../Simulation';
import { hasFeature } from './archive';
import { fireJournal } from './journal';
import { poisNear, type AnomalyPoi } from './poi';

const TICKS = 60;
const MAX_FIELD = Math.max(...Object.values(ANOMALIES).map((a) => a.field));

export const anomaliesNear = (state: SimState, pos: Vec2, radius: number): AnomalyPoi[] =>
  poisNear(state.seed, pos, radius + MAX_FIELD).filter((p): p is AnomalyPoi => p.kind === 'anomaly');

const NO_PULL: Vec2 = Object.freeze({ x: 0, y: 0 });

/**
 * Acceleration from gravity anomalies (u/s²) – it falls to 0 from the core's edge to the field's edge.
 * No anomaly near: a shared zero (read-only).
 */
export function anomalyPull(state: SimState, pos: Vec2): Vec2 {
  let x = 0;
  let y = 0;
  let any = false;
  for (const a of poisNear(state.seed, pos, MAX_FIELD)) {
    if (a.kind !== 'anomaly' || a.type !== 'gravity') continue;
    any = true;
    const def = ANOMALIES.gravity;
    const d = sub(a.pos, pos);
    const r = length(d);
    if (r >= def.field || r < 1e-6) continue;
    const k = r <= def.core ? 1 : (def.field - r) / (def.field - def.core);
    x += (d.x / r) * GRAVITY_PULL * k;
    y += (d.y / r) * GRAVITY_PULL * k;
  }
  return any ? { x, y } : NO_PULL;
}

export function buffActive(state: SimState, kind: BuffKind): boolean {
  for (const b of state.discovery.buffs) if (b.kind === kind && b.until > state.tick) return true;
  return false;
}

const NO_MODS = Object.freeze({ thrustMult: 1, energyGenMult: 1, noHeat: false });

/** Flight and energy multipliers of the bonuses (no bonus: a shared answer – read-only). */
export function flightMods(state: SimState): { thrustMult: number; energyGenMult: number; noHeat: boolean } {
  if (state.discovery.buffs.length === 0) return NO_MODS;
  return {
    thrustMult: buffActive(state, 'sling') ? BUFFS.sling.thrustMult : 1,
    energyGenMult: buffActive(state, 'charge') ? BUFFS.charge.energyGenMult : 1,
    noHeat: buffActive(state, 'echo'),
  };
}

function grantBuff(state: SimState, kind: BuffKind, seconds: number, events: SimEvent[]): void {
  const d = state.discovery;
  d.buffs = d.buffs.filter((b) => b.kind !== kind && b.until > state.tick);
  d.buffs.push({ kind, until: state.tick + Math.round(seconds * TICKS) });
  events.push({ type: 'buffGained', buff: kind, seconds });
  fireJournal(state, { on: 'buff', buff: kind }, events);
}

/** The ship's part nearest to a point (radiation hits the side facing the anomaly). */
function nearestPart(state: SimState, p: Vec2): number | null {
  const player = state.player;
  let best: number | null = null;
  let bestD = Infinity;
  for (const part of player.grid.parts) {
    const w = gridToWorld(player.body, player.props.centerOfMass, partCenter(part));
    const d = length(sub(w, p));
    if (d < bestD) {
      bestD = d;
      best = part.id;
    }
  }
  return best;
}

/** A pass through an anomaly's core → a bonus (and a hit for radiation, the shield drops for ions). */
export function stepAnomalies(state: SimState, events: SimEvent[]): void {
  const d = state.discovery;
  if (d.buffs.length > 0) d.buffs = d.buffs.filter((b) => b.until > state.tick);
  const player = state.player;
  if (player.dock.mode !== 'flying' || player.destroyed) return;
  const pos = player.body.pos;
  for (const a of anomaliesNear(state, pos, 0)) {
    const def = ANOMALIES[a.type];
    if (length(sub(a.pos, pos)) > def.core + player.props.boundingRadius * 0.5) continue;
    const used = d.anomalyUsed.get(a.id);
    if (used !== undefined && state.tick - used < ANOMALY_RECHARGE_SECONDS * TICKS) continue;
    d.anomalyUsed.set(a.id, state.tick);
    const seconds = def.buff === 'sling' && hasFeature(state, 'slingPlus') ? def.seconds * SLING_PLUS_MULT : def.seconds;
    grantBuff(state, def.buff, seconds, events);
    if (a.type === 'ion') {
      player.shield = 0;
      player.energy = player.props.batteryCapacity;
    } else if (a.type === 'radiation') {
      applyRam(state, PLAYER_REF, player, nearestPart(state, a.pos), RADIATION_HIT, events, 'hazard');
    } else if (a.type === 'time') {
      player.heat = new Map();
    }
  }
}
