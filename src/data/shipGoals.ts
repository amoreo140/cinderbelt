// Automatic suggestion of the "Ship" goal in the Goals panel (9.1): the nearest big part by the pace table
// (3.5) – the first one the ship does not yet have in the required count.
import type { PartKey } from './parts';

export interface ShipGoal {
  key: PartKey;
  /** How many pieces (of this or a higher tier) the ship should have. */
  count: number;
}

export const SHIP_GOALS: readonly ShipGoal[] = [
  { key: 'cargo:1', count: 3 },
  { key: 'miningLaser:1', count: 2 },
  { key: 'reactor:1', count: 2 },
  { key: 'fuelTank:1', count: 2 },
  { key: 'cannon:1', count: 1 },
  { key: 'shield:1', count: 1 },
  { key: 'miningLaser:2', count: 1 },
  { key: 'cockpit:2', count: 1 },
  { key: 'cargo:2', count: 3 },
  { key: 'engine:2', count: 2 },
];
