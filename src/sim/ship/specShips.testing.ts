// Example ships from the SL2 design (the ship-building 2 design, example ships) in
// their "after E2" form, with shaped armour – shared by the shape tests. Test-only helpers.
import type { PartId, Tier } from '../../data/parts';
import type { ShapeId } from '../../data/shapes';
import { createGrid, partCells } from './grid';
import type { Rotation, ShipGrid } from './types';

type Row = [PartId, number, number, Rotation?, Tier?, ShapeId?];

const withTier = (rows: readonly Row[], tier: Tier): Row[] => rows.map(([id, x, y, rot, , shape]) => [id, x, y, rot ?? 0, tier, shape]);

/** A – small T1 miner "Scythe" after E2 (§9.3, 18½ pts): nose tip bow, wings, arcs at the stern corners. */
export function kosaE2(): ShipGrid {
  const rows: Row[] = [
    ['engine', -2, 1], ['engine', -2, 0], ['engine', -2, -1],
    ['fuelTank', -1, 1], ['reactor', -1, 0], ['radar', -1, -1],
    ['cargo', 0, 1], ['gyro', 0, 0], ['cargo', 0, -1],
    ['cargo', 1, 1], ['cockpit', 1, 0], ['cargo', 1, -1],
    ['miningLaser', 2, 1], ['armor', 2, 0, 0, 1, 'nose'], ['miningLaser', 2, -1],
    ['armor', 0, 2, 0, 1, 'wingL'], ['armor', 0, -2, 0, 1, 'wingR'],
    ['armor', -1, 2, 1, 1, 'arc'], ['armor', -1, -2, 2, 1, 'arc'],
  ];
  return createGrid(withTier(rows, 1));
}

/** B – T2 freighter "Mule" after E2 (§9.4, ≈ 36 pts): a 45° wedge bow with the tractor on the tip, wings. */
export function mulaE2(): ShipGrid {
  const rows: Row[] = [
    ...[2, 1, 0, -1, -2].map((y): Row => ['engine', -4, y]),
    ['fuelTank', -3, 2], ['reactor', -3, 1], ['reactor', -3, 0], ['reactor', -3, -1], ['fuelTank', -3, -2],
    ['largeCargo', -2, 1], ['largeCargo', -2, -2], ['gyro', -2, 0], ['battery', -1, 0],
    ...[2, 1, 0, -1, -2].flatMap((y): Row[] => [['cargo', 0, y], ['cargo', 1, y]]),
    ['armor', 2, 2, 0, 2, 'wedge'], ['shield', 2, 1], ['cockpit', 2, 0], ['radar', 2, -1], ['armor', 2, -2, 3, 2, 'wedge'],
    ['armor', 3, 1, 0, 2, 'wedge'], ['tractorBeam', 3, 0], ['armor', 3, -1, 3, 2, 'wedge'],
    ['armor', 0, 3, 0, 2, 'wingL'], ['armor', 0, -3, 0, 2, 'wingR'],
  ];
  return createGrid(withTier(rows, 2));
}

/**
 * C – battleship "Halberd" after E2 (≈ 63½ pts), built from T2 parts (no T3 parts yet): a stepped
 * cannon bow ending in wedges and a nose 2×1, wings at the stern.
 */
export function halapartnaE2(): ShipGrid {
  const half = (s: 1 | -1): Row[] => [
    ...[-3, -2, -1, 0, 1, 2].map((x): Row => ['armor', x, 3 * s]),
    ['cannon', 3, 3 * s],
    ['engine', -4, 2 * s], ['fuelTank', -3, 2 * s], ['cargo', -2, 2 * s], ['fuelTank', -1, 2 * s], ['battery', 0, 2 * s],
    ['gyro', 1, 2 * s], ['armor', 2, 2 * s], ['armor', 3, 2 * s], ['cannon', 4, 2 * s],
    ['engine', -4, s], ['reactor', -3, s], ['reactor', -2, s], ['shield', -1, s], ['reactor', 0, s], ['reactor', 1, s],
    ['shield', 2, s], ['armor', 3, s], ['armor', 4, s], ['armor', 5, s, s === 1 ? 0 : 3, 2, 'wedge'],
  ];
  const rows: Row[] = [
    ...half(1),
    ['engine', -4, 0], ['gyro', -3, 0], ['battery', -2, 0], ['reactor', -1, 0], ['gyro', 0, 0], ['cockpit', 1, 0],
    ['radar', 2, 0], ['armor', 3, 0], ['armor', 4, 0], ['armor', 5, 0, 0, 2, 'nose2x1'],
    ...half(-1),
    ['armor', -3, 4, 0, 2, 'wingL'], ['armor', -3, -4, 0, 2, 'wingR'],
  ];
  return createGrid(withTier(rows, 2));
}

/** The same ship with every shaped part replaced by full armour on each cell it occupies (ids renumbered). */
export function filledFull(grid: ShipGrid): ShipGrid {
  const rows: Row[] = [];
  for (const p of grid.parts) {
    if (p.shape === undefined) rows.push([p.partId, p.x, p.y, p.rot, p.tier]);
    else for (const c of partCells(p)) rows.push([p.partId, c.x, c.y, 0, p.tier]);
  }
  return createGrid(rows);
}
