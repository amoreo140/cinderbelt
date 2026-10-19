// Ship damage: the shield first, then the HP of the part that was hit. Destroyed parts vanish,
// a BFS from the cockpit detaches the disconnected pieces (they become wrecks) and the properties are recomputed.
import { add, rotate, sub } from '../math/vec2';
import { connectedToCockpit, partCells } from '../ship/grid';
import { currentHp } from '../ship/hp';
import { computeProperties } from '../ship/properties';
import type { PlacedPart, ShipGrid } from '../ship/types';
import type { CombatShip } from './types';

/** Steps per second (equal to SIM_DT – avoids a cyclic import from Simulation). */
export const TICKS_PER_SECOND = 60;

export interface DamageResult {
  /** How much the shield absorbed. */
  absorbed: number;
  /** How much HP the hit part lost. */
  toHull: number;
  /** The part dropped to 0 HP with this hit. */
  destroyed: boolean;
}

/**
 * A hit on a ship: the shield absorbs what it can, the rest goes to part `partId` (null = shield only).
 * A destroyed part stays in the grid with 0 HP – only `splitGrid` + `rebuildShip` remove it.
 */
export function damageShip(ship: CombatShip, partId: number | null, amount: number): DamageResult {
  ship.shieldDelay = Math.round(ship.props.shield.regenDelay * TICKS_PER_SECOND);
  const absorbed = Math.min(ship.shield, amount);
  ship.shield -= absorbed;
  const rest = amount - absorbed;
  if (partId === null || rest <= 0) return { absorbed, toHull: 0, destroyed: false };
  const part = ship.grid.parts.find((p) => p.id === partId);
  if (!part) return { absorbed, toHull: 0, destroyed: false };
  const hp = currentHp(ship.hp, part);
  if (hp <= 0) return { absorbed, toHull: 0, destroyed: false };
  const toHull = Math.min(hp, rest);
  ship.hp.set(part.id, hp - toHull);
  return { absorbed, toHull, destroyed: hp - toHull <= 0 };
}

export interface SplitResult {
  removed: PlacedPart[];
  cockpitLost: boolean;
  /** Components with no connection to the cockpit (if the cockpit is lost, everything that remains). */
  detached: PlacedPart[][];
  /** The rest of the ship with the cockpit, or null when the cockpit is gone. */
  remaining: ShipGrid | null;
}

const NEIGHBORS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Splits the parts into connected components (ordered by the first part in the grid). */
export function components(parts: readonly PlacedPart[]): PlacedPart[][] {
  const owner = new Map<string, PlacedPart>();
  for (const p of parts) for (const c of partCells(p)) owner.set(`${c.x},${c.y}`, p);
  const seen = new Set<number>();
  const out: PlacedPart[][] = [];
  for (const start of parts) {
    if (seen.has(start.id)) continue;
    const group: PlacedPart[] = [];
    const queue = [start];
    seen.add(start.id);
    while (queue.length > 0) {
      const p = queue.pop()!;
      group.push(p);
      for (const c of partCells(p)) {
        for (const [dx, dy] of NEIGHBORS) {
          const n = owner.get(`${c.x + dx},${c.y + dy}`);
          if (n && !seen.has(n.id)) {
            seen.add(n.id);
            queue.push(n);
          }
        }
      }
    }
    out.push(group.sort((a, b) => a.id - b.id));
  }
  return out;
}

/** Removes destroyed parts and detaches what lost its connection to the cockpit (the break-up rule). */
export function splitGrid(grid: ShipGrid, destroyed: ReadonlySet<number>): SplitResult {
  const removed = grid.parts.filter((p) => destroyed.has(p.id));
  const left = grid.parts.filter((p) => !destroyed.has(p.id));
  const cockpitLost = !left.some((p) => p.partId === 'cockpit');
  if (cockpitLost) return { removed, cockpitLost, detached: components(left), remaining: null };
  const connected = connectedToCockpit({ parts: left, nextId: grid.nextId });
  const loose = left.filter((p) => !connected.has(p.id));
  return {
    removed,
    cockpitLost,
    detached: components(loose),
    remaining: { parts: left.filter((p) => connected.has(p.id)), nextId: grid.nextId },
  };
}

/**
 * A ship with a new (shrunken) grid: the remaining parts stay in the world in place (the body position is
 * the centre of mass, which shifts), the state of the removed parts is dropped, capacities are trimmed.
 */
export function rebuildShip(ship: CombatShip & { fuel?: number }, grid: ShipGrid): void {
  const oldCom = ship.props.centerOfMass;
  const props = computeProperties(grid);
  const shift = sub(props.centerOfMass, oldCom);
  ship.body = { ...ship.body, pos: add(ship.body.pos, rotate(shift, ship.body.angle)) };
  ship.prevBody = { ...ship.prevBody, pos: add(ship.prevBody.pos, rotate(shift, ship.prevBody.angle)) };
  const ids = new Set(grid.parts.map((p) => p.id));
  for (const id of [...ship.hp.keys()]) if (!ids.has(id)) ship.hp.delete(id);
  for (const id of [...ship.cooldowns.keys()]) if (!ids.has(id)) ship.cooldowns.delete(id);
  ship.grid = grid;
  ship.props = props;
  ship.gridVersion++;
  ship.energy = Math.min(ship.energy, props.batteryCapacity);
  ship.shield = Math.min(ship.shield, props.shield.capacity);
  // a ship that lost a fuel tank (a pirate; the player's fuel is capped by its own step) keeps at most
  // what the remaining tanks hold – otherwise the save validator rejects the state (C1)
  if (typeof ship.fuel === 'number') ship.fuel = Math.min(ship.fuel, props.fuelCapacity);
}

/** Shield recharge after the delay has elapsed – paid for with energy from the battery. */
export function regenShield(ship: CombatShip, dt: number): void {
  const s = ship.props.shield;
  if (s.capacity <= 0) {
    ship.shield = 0;
    return;
  }
  if (ship.shieldDelay > 0) {
    ship.shieldDelay--;
    return;
  }
  const want = Math.min(s.regen * dt, s.capacity - ship.shield);
  if (want <= 0) return;
  const cost = want * s.energyPerPoint;
  const ratio = cost > ship.energy ? Math.max(0, ship.energy) / cost : 1;
  ship.shield = Math.min(s.capacity, ship.shield + want * ratio);
  ship.energy = Math.max(0, ship.energy - cost * ratio);
}
