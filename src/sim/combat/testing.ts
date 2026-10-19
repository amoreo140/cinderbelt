// Helpers for combat tests (not used by the game).
import { createBody } from '../physics/body';
import { computeProperties } from '../ship/properties';
import type { ShipGrid } from '../ship/types';
import type { CombatShip } from './types';

/** A ship in combat built from a grid – full battery and shield, aims at `angle`. */
export function combatShip(grid: ShipGrid, pos = { x: 0, y: 0 }, angle = 0): CombatShip {
  const props = computeProperties(grid);
  const body = createBody(pos, angle);
  return {
    grid,
    gridVersion: 0,
    hp: new Map(),
    props,
    body,
    prevBody: body,
    lastLocalForce: { x: 0, y: 0 },
    energy: props.batteryCapacity,
    shield: props.shield.capacity,
    shieldDelay: 0,
    cooldowns: new Map(),
  };
}
