// Giant asteroids (5.3): a 300 HP shell only the heavy laser or a cannon breaks; then the core is
// left – a rich rock of a rarer resource (mined by the normal lasers, ×1.5). State: the shell left in
// the discoveries, the core's amount in the world's asteroid delta (like any other rock).
import { GIANT_CORE_AMOUNT, GIANT_CORE_RADIUS, GIANT_CORE_YIELD, GIANT_LASER_DAMAGE, GIANT_RADIUS, GIANT_SHELL_HP } from '../../data/poi';
import { cargoUsed } from '../../data/resources';
import type { MiningBeam } from '../mining/mining';
import { hypot, length, sub, type Vec2 } from '../math/vec2';
import type { Circle } from '../physics/collide';
import type { ShipProperties } from '../ship/properties';
import type { SimEvent, SimState } from '../Simulation';
import { chunkCoord } from '../world/chunks';
import type { Asteroid } from '../world/generate';
import { fireJournal } from './journal';
import { poisInChunk, poisNear, type GiantPoi } from './poi';

/** Shell left (0 = broken). */
export const shellHp = (state: SimState, id: string): number => state.discovery.giants.get(id) ?? GIANT_SHELL_HP;

/** A giant's core as an asteroid (its amount in the world delta). */
export function giantCore(poi: GiantPoi): Asteroid {
  return { id: `core:${poi.id}`, pos: poi.pos, baseRadius: GIANT_CORE_RADIUS, resource: poi.resource, initialAmount: GIANT_CORE_AMOUNT, variant: poi.variant };
}

export const giantsNear = (state: SimState, pos: Vec2, radius: number): GiantPoi[] =>
  poisNear(state.seed, pos, radius + GIANT_RADIUS).filter((p): p is GiantPoi => p.kind === 'giant');

/** A giant's collision circle: the shell, or the core by its amount (null = mined out). */
export function giantCircle(state: SimState, poi: GiantPoi): Circle | null {
  if (shellHp(state, poi.id) > 0) return { pos: poi.pos, radius: GIANT_RADIUS };
  const core = giantCore(poi);
  const r = state.world.radiusOf(core);
  return r > 0 ? { pos: poi.pos, radius: r } : null;
}

/** Giant circles around a point (collisions, beams, projectiles). */
export function giantCircles(state: SimState, pos: Vec2, reach: number): Circle[] {
  return giantCirclesInto(state, pos, reach, []);
}

/**
 * `giantCircles` appended to `out` (same order: the chunks of `poisNear`, its giants) – no lists per call
 * (the per-step obstacle lists of every ship, wreck and container, perf audit 2026-10-17 P4).
 */
export function giantCirclesInto(state: SimState, pos: Vec2, reach: number, out: Circle[]): Circle[] {
  const radius = reach + GIANT_RADIUS;
  const x0 = chunkCoord(pos.x - radius);
  const x1 = chunkCoord(pos.x + radius);
  const y0 = chunkCoord(pos.y - radius);
  const y1 = chunkCoord(pos.y + radius);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      const pois = poisInChunk(state.seed, cx, cy);
      for (let i = 0; i < pois.length; i++) {
        const g = pois[i]!;
        if (g.kind !== 'giant' || !(hypot(g.pos.x - pos.x, g.pos.y - pos.y) <= radius)) continue;
        const c = giantCircle(state, g);
        if (c && hypot(c.pos.x - pos.x, c.pos.y - pos.y) <= reach + c.radius) out.push(c);
      }
    }
  }
  return out;
}

/** Damages the shell; on breaking an event and a journal entry. Returns true when it broke now. */
export function damageShell(state: SimState, poi: GiantPoi, damage: number, events: SimEvent[]): boolean {
  const left = shellHp(state, poi.id);
  if (left <= 0 || damage <= 0) return false;
  const next = Math.max(0, left - damage);
  state.discovery.giants.set(poi.id, next);
  if (next > 0) return false;
  events.push({ type: 'giantBroken', id: poi.id, pos: { ...poi.pos } });
  fireJournal(state, { on: 'giantBroken' }, events);
  return true;
}

/** The giant on whose surface the point lies (a beam end, a projectile hit), or null. */
export function giantAt(state: SimState, p: Vec2, slack = 0.75): GiantPoi | null {
  for (const g of giantsNear(state, p, 2)) {
    const c = giantCircle(state, g);
    if (c && Math.abs(length(sub(p, c.pos)) - c.radius) <= slack) return g;
  }
  return null;
}

/**
 * Beams that stopped at a giant (giant circles are mining blockers): the heavy laser breaks the shell,
 * once broken every laser mines the core. Changes the cargo; mining already spent the energy.
 */
export function mineGiants(
  state: SimState,
  beams: MiningBeam[],
  props: Pick<ShipProperties, 'lasers' | 'cargoCapacity'>,
  dt: number,
  yieldMult: number,
  events: SimEvent[],
): void {
  const player = state.player;
  for (const beam of beams) {
    if (beam.asteroidId) continue;
    const g = giantAt(state, beam.to);
    if (!g) continue;
    const laser = props.lasers[beam.laser]!;
    if (shellHp(state, g.id) > 0) {
      if (laser.heavy) damageShell(state, g, laser.rate * GIANT_LASER_DAMAGE * dt, events);
      continue;
    }
    const core = giantCore(g);
    const free = props.cargoCapacity - cargoUsed(player.cargo);
    if (free <= 1e-9) continue;
    const taken = state.world.extract(core, Math.min(laser.rate * dt * yieldMult * GIANT_CORE_YIELD, free));
    player.cargo[core.resource] += taken;
    beam.resource = core.resource;
    if (taken > 0 && state.world.remaining(core) <= 0) events.push({ type: 'asteroidDepleted', id: core.id });
  }
}
