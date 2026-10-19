import type { ShapeId } from '../../data/shapes';
import type { ShipProperties } from './properties';
import type { ShipGrid } from './types';

/** Ship properties for tests – fields left out get neutral values. */
export function makeProps(partial: Partial<ShipProperties> = {}): ShipProperties {
  return {
    mass: 1,
    centerOfMass: { x: 0, y: 0 },
    inertia: 1,
    thrust: { forward: 0, backward: 0, left: 0, right: 0 },
    torque: 0,
    rcsThrust: 0,
    cargoCapacity: 0,
    fuelCapacity: 0,
    batteryCapacity: 0,
    energyGen: 0,
    radarRange: 0,
    lasers: [],
    weapons: [],
    tractors: [],
    shield: { capacity: 0, regen: 0, regenDelay: 0, energyPerPoint: 0 },
    cellOffsets: [{ x: 0, y: 0 }],
    boundingRadius: Math.SQRT1_2,
    fuelUseMult: 1,
    pulseCooldownMult: 1,
    exhaustBurns: [],
    ...partial,
  };
}

/** A copy of `grid` with part `id` laid in `shape` (null = back to the full part, no `shape` key). */
export function shaped(grid: ShipGrid, id: number, shape: ShapeId | null): ShipGrid {
  if (!grid.parts.some((p) => p.id === id)) throw new Error(`shaped: no part ${id}`);
  return {
    ...grid,
    parts: grid.parts.map((p) => {
      if (p.id !== id) return p;
      const { shape: _old, ...rest } = p;
      return shape === null ? rest : { ...rest, shape };
    }),
  };
}
