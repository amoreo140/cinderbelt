import type { PartId, Tier } from '../../data/parts';
import type { ShapeId } from '../../data/shapes';
import type { Vec2 } from '../math/vec2';
import { partSize } from './shape';
import type { PlacedPart, Rotation, ShipGrid } from './types';

const FACINGS: readonly Vec2[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

const NEIGHBORS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Unit vector the part points along (for an engine: the thrust direction). */
export function facing(rot: Rotation): Vec2 {
  return FACINGS[rot]!;
}

export function rotatedSize(size: { w: number; h: number }, rot: Rotation): { w: number; h: number } {
  return rot % 2 === 0 ? { w: size.w, h: size.h } : { w: size.h, h: size.w };
}

/** Cells of the rectangle `size` (at rot 0) with the lower-left cell (x, y) – 1×1, 2×1, 2×2, 3×1… */
export function footprintCells(size: { w: number; h: number }, x: number, y: number, rot: Rotation): Vec2[] {
  const { w, h } = rotatedSize(size, rot);
  const cells: Vec2[] = [];
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) cells.push({ x: x + dx, y: y + dy });
  }
  return cells;
}

/** Centre of the rectangle – the model origin of a multi-cell part (art/README 2.2.1). */
export function footprintCenter(size: { w: number; h: number }, x: number, y: number, rot: Rotation): Vec2 {
  const { w, h } = rotatedSize(size, rot);
  return { x: x + (w - 1) / 2, y: y + (h - 1) / 2 };
}

/** Cells of the part's footprint (a shaped part: the shape's footprint – a wing is 2×1 armour). */
export function partCells(p: PlacedPart): Vec2[] {
  return footprintCells(partSize(p), p.x, p.y, p.rot);
}

/** Centre of the part in ship-local coordinates (a cell centre is an integer). */
export function partCenter(p: PlacedPart): Vec2 {
  return footprintCenter(partSize(p), p.x, p.y, p.rot);
}

/**
 * Axis of a laser head: the centre of the part's front cell (for 1×1 the part centre). The 2×1 heavy
 * laser has its head over the front cell (art/README 2.3); the beam and the aiming arc start there.
 */
export function laserPivot(p: PlacedPart): Vec2 {
  const length = partSize(p).w;
  const c = partCenter(p);
  const f = facing(p.rot);
  return { x: c.x + (f.x * (length - 1)) / 2, y: c.y + (f.y * (length - 1)) / 2 };
}

/**
 * Builds a grid from a list of [part, x, y, rotation?, tier?, shape?]; ids are 1..n. A part without a
 * shape gets no `shape` key at all (bit-identical to grids built before E2).
 */
export function createGrid(list: ReadonlyArray<[PartId, number, number, Rotation?, Tier?, ShapeId?]>): ShipGrid {
  return {
    parts: list.map(([partId, x, y, rot, tier, shape], i) => ({
      id: i + 1,
      partId,
      tier: tier ?? 1,
      x,
      y,
      rot: rot ?? 0,
      ...(shape !== undefined ? { shape } : {}),
    })),
    nextId: list.length + 1,
  };
}

const cellKey = (x: number, y: number): string => `${x},${y}`;

function buildCellMap(grid: ShipGrid): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of grid.parts) for (const c of partCells(p)) map.set(cellKey(c.x, c.y), p.id);
  return map;
}

/** Ids of every part connected to the cockpit through neighbouring cells. */
export function connectedToCockpit(grid: ShipGrid): Set<number> {
  const cockpit = grid.parts.find((p) => p.partId === 'cockpit');
  if (!cockpit) return new Set();
  const owners = buildCellMap(grid);
  const byId = new Map(grid.parts.map((p) => [p.id, p]));
  const visited = new Set<number>([cockpit.id]);
  const queue: PlacedPart[] = [cockpit];
  while (queue.length > 0) {
    const p = queue.pop()!;
    for (const c of partCells(p)) {
      for (const [dx, dy] of NEIGHBORS) {
        const owner = owners.get(cellKey(c.x + dx, c.y + dy));
        if (owner !== undefined && !visited.has(owner)) {
          visited.add(owner);
          queue.push(byId.get(owner)!);
        }
      }
    }
  }
  return visited;
}

export type GridError = 'empty' | 'overlap' | 'noCockpit' | 'multipleCockpits' | 'disconnected';

export function validateGrid(grid: ShipGrid): GridError[] {
  if (grid.parts.length === 0) return ['empty'];
  const errors: GridError[] = [];

  const seen = new Set<string>();
  let overlap = false;
  for (const p of grid.parts) {
    for (const c of partCells(p)) {
      const k = cellKey(c.x, c.y);
      if (seen.has(k)) overlap = true;
      seen.add(k);
    }
  }
  if (overlap) errors.push('overlap');

  const cockpits = grid.parts.filter((p) => p.partId === 'cockpit').length;
  if (cockpits === 0) errors.push('noCockpit');
  if (cockpits > 1) errors.push('multipleCockpits');
  if (cockpits >= 1 && connectedToCockpit(grid).size !== grid.parts.length) errors.push('disconnected');

  return errors;
}
