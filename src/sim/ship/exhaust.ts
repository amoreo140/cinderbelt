// Blocked engine exhaust (long-term design 3.4.2, functional from M3): an engine whose nozzle points
// straight into another part gives half thrust, and while it fires the part in front of the nozzle
// burns at 2 HP/s (scaled by how hard that engine group is pushing). Applies to every ship – the
// player and the pirates fly by the same rules.
import type { Vec2 } from '../math/vec2';
import { facing, partCells } from './grid';
import type { ThrustGroup } from './properties';
import type { HpMap, ShipGrid } from './types';
import { currentHp } from './hp';

/** Thrust of an engine whose nozzle is covered by another part. */
export const BLOCKED_EXHAUST_THRUST = 0.5;
/** HP per second the part in front of a covered nozzle loses while the engine fires at full power. */
export const EXHAUST_BURN_DPS = 2;

/** The cockpit in front of a covered nozzle burns down to this HP, never below. */
export const COCKPIT_BURN_FLOOR = 1;

/** An engine (`engineId`) blowing into part `partId`. */
export interface ExhaustBlock {
  engineId: number;
  partId: number;
}

/**
 * Engines whose nozzle (the cell behind the engine, against its thrust) holds another part – in
 * grid order. The shipyard's `blockedExhaust` warning marks the same engines.
 */
export function blockedExhausts(grid: ShipGrid): ExhaustBlock[] {
  const owner = new Map<string, number>();
  for (const p of grid.parts) for (const c of partCells(p)) owner.set(`${c.x},${c.y}`, p.id);
  const out: ExhaustBlock[] = [];
  for (const p of grid.parts) {
    if (p.partId !== 'engine') continue;
    const f = facing(p.rot);
    for (const c of partCells(p)) {
      const o = owner.get(`${c.x - f.x},${c.y - f.y}`);
      if (o !== undefined && o !== p.id) {
        out.push({ engineId: p.id, partId: o });
        break;
      }
    }
  }
  return out;
}

/** A covered nozzle in the ship's properties: the engine's thrust group and the part it burns. */
export interface ExhaustBurn extends ExhaustBlock {
  group: ThrustGroup;
}

/** How hard each thrust group pushes this step (0..1) from the ship-frame force. */
export function groupLoad(localForce: Vec2, thrust: Record<ThrustGroup, number>): Record<ThrustGroup, number> {
  const share = (force: number, total: number): number => (total > 0 && force > 0 ? Math.min(1, force / total) : 0);
  return {
    forward: share(localForce.x, thrust.forward),
    backward: share(-localForce.x, thrust.backward),
    left: share(localForce.y, thrust.left),
    right: share(-localForce.y, thrust.right),
  };
}

/** Burns in progress for this ship-frame force (engines that fire into a part). */
export function activeBurns(burns: readonly ExhaustBurn[], localForce: Vec2, thrust: Record<ThrustGroup, number>): ExhaustBurn[] {
  if (burns.length === 0) return [];
  const load = groupLoad(localForce, thrust);
  return burns.filter((b) => load[b.group] > 0);
}

/** One step of a burn: the part and its HP before and after. */
export interface BurnStep {
  engineId: number;
  partId: number;
  before: number;
  after: number;
}

/**
 * Applies one step of exhaust burns to the HP map (straight to the part – the shield does not stop
 * the engine's own flame). Returns what burnt this step, in the order of `props.exhaustBurns`.
 */
export function applyExhaustBurns(
  ship: { grid: ShipGrid; hp: HpMap; props: { thrust: Record<ThrustGroup, number>; exhaustBurns: readonly ExhaustBurn[] } },
  localForce: Vec2,
  dt: number,
): BurnStep[] {
  const burns = ship.props.exhaustBurns;
  if (burns.length === 0) return [];
  const load = groupLoad(localForce, ship.props.thrust);
  const out: BurnStep[] = [];
  for (const b of burns) {
    const power = load[b.group];
    if (power <= 0) continue;
    const part = ship.grid.parts.find((p) => p.id === b.partId);
    if (!part) continue;
    const before = currentHp(ship.hp, part);
    // the flame never burns through the cockpit – a covered nozzle must not kill the ship (I15)
    const floor = part.partId === 'cockpit' ? COCKPIT_BURN_FLOOR : 0;
    if (before <= floor) continue;
    const after = Math.max(floor, before - EXHAUST_BURN_DPS * power * dt);
    ship.hp.set(part.id, after);
    out.push({ engineId: b.engineId, partId: b.partId, before, after });
  }
  return out;
}

/**
 * The burn crossed a quarter of the part's HP this step (the first one at full HP: the burn has just
 * started) – the moments the player is told about. Depends only on saved HP, so a loaded game
 * announces the same.
 */
export function burnNotice(step: BurnStep, max: number): boolean {
  for (let k = 4; k >= 1; k--) {
    const at = (max * k) / 4;
    if (step.before >= at && step.after < at) return true;
  }
  return false;
}
