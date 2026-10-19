import { createGrid } from './grid';
import type { ShipGrid } from './types';

/**
 * The starter ship (the bow points along +x, +y is the port side):
 *
 *   y= 2        R
 *   y= 1   F  K  T  B
 *   y= 0   E  G  C  M
 *   y=-1   F  K  D  B
 *   y=-2        L
 *        x=-1  0  1  2
 *
 * C cockpit, G gyroscope, M mining laser, E reactor, K cargo bay,
 * T fuel tank, D radar, F forward engines, B rear engines,
 * L engine pushing left, R engine pushing right.
 */
export function createStarterShip(): ShipGrid {
  return createGrid([
    ['cockpit', 1, 0],
    ['gyro', 0, 0],
    ['miningLaser', 2, 0, 0],
    ['reactor', -1, 0],
    ['cargo', 0, 1],
    ['cargo', 0, -1],
    ['fuelTank', 1, 1],
    ['radar', 1, -1],
    ['engine', -1, 1, 0],
    ['engine', -1, -1, 0],
    ['engine', 2, 1, 2],
    ['engine', 2, -1, 2],
    ['engine', 0, -2, 1],
    ['engine', 0, 2, 3],
  ]);
}
