// Test helpers (templates tests only): random valid ships from a seed – a cockpit somewhere in the hangar
// and parts grown off it through shared edges, so the grid is always connected – optionally with shaped
// armour, and the SL2 example ships after E2.
import { ALL_PART_KEYS, parsePartKey, type PartId, type Tier } from '../../data/parts';
import { SHAPE_IDS, type ShapeId } from '../../data/shapes';
import { createRng } from '../math/rng';
import { createGrid, partCells, validateGrid } from '../ship/grid';
import { halapartnaE2, kosaE2, mulaE2 } from '../ship/specShips.testing';
import type { PlacedPart, Rotation, ShipGrid } from '../ship/types';
import { applyEditorOp, HANGAR_MAX, HANGAR_MIN } from '../shipyard/editor';

/**
 * Parts and variants added after the golden AF1 codes were recorded (M4c) stay out of the random ships, so
 * the seeds keep building exactly the same ships (golden.test.ts). New ids are only ever appended, so the
 * filtered list is the original one.
 */
const LATER_PARTS: ReadonlySet<string> = new Set(['largeReactor', 'repairModule', 'refinery']);
const LATER_VARIANTS: ReadonlySet<string> = new Set(['focused', 'light', 'flywheel', 'buffer', 'longBarrel']);
const GOLDEN_KEYS = ALL_PART_KEYS.filter((k) => {
  const { partId, variant } = parsePartKey(k);
  return !LATER_PARTS.has(partId) && (variant === undefined || !LATER_VARIANTS.has(variant));
});
const NON_COCKPIT = GOLDEN_KEYS.filter((k) => parsePartKey(k).partId !== 'cockpit');
const COCKPITS = GOLDEN_KEYS.filter((k) => parsePartKey(k).partId === 'cockpit');
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export function randomShip(seed: number, tries = 30): ShipGrid {
  const rng = createRng(seed);
  const int = (n: number): number => Math.floor(rng() * n);
  const cockpit = COCKPITS[int(COCKPITS.length)]!;
  const start = createGrid([]);
  let grid = applyEditorOp(start, { op: 'place', key: cockpit, x: int(15) - 7, y: int(15) - 7, rot: int(4) as Rotation });
  if (!grid.ok) throw new Error('cockpit placement failed');
  let g = grid.grid;
  for (let i = 0; i < tries; i++) {
    const cells = g.parts.flatMap(partCells);
    const c = cells[int(cells.length)]!;
    const [dx, dy] = DIRS[int(4)]!;
    const r = applyEditorOp(g, { op: 'place', key: NON_COCKPIT[int(NON_COCKPIT.length)]!, x: c.x + dx, y: c.y + dy, rot: int(4) as Rotation });
    if (r.ok) g = r.grid;
  }
  if (validateGrid(g).length > 0) throw new Error(`random ship ${seed} is invalid`);
  return g;
}

/** The same ship translated by (dx, dy), ids renumbered in a different order. */
export function shifted(grid: ShipGrid, dx: number, dy: number): ShipGrid {
  const parts = [...grid.parts].reverse().map((p, i) => ({ ...p, id: i + 10, x: p.x + dx, y: p.y + dy }));
  return { parts, nextId: parts.length + 10 };
}

/**
 * `randomShip(seed, tries)` with its armour laid in random shapes (about two thirds of the plates; a
 * 2×1 shape only where its second cell is free and inside the hangar). Still a valid design.
 */
export function shapedRandomShip(seed: number, tries = 30): ShipGrid {
  const grid = randomShip(seed, tries);
  const rng = createRng(seed ^ 0x5eed);
  const used = new Set(grid.parts.flatMap(partCells).map((c) => `${c.x},${c.y}`));
  const inHangar = (v: number): boolean => v >= HANGAR_MIN && v <= HANGAR_MAX;
  const parts = grid.parts.map((p): PlacedPart => {
    if (p.partId !== 'armor' || rng() < 1 / 3) return p;
    const shape = SHAPE_IDS[Math.floor(rng() * SHAPE_IDS.length)]!;
    const extra = partCells({ ...p, shape }).filter((c) => c.x !== p.x || c.y !== p.y);
    if (extra.some((c) => used.has(`${c.x},${c.y}`) || !inHangar(c.x) || !inHangar(c.y))) return p;
    for (const c of extra) used.add(`${c.x},${c.y}`);
    return { ...p, shape };
  });
  const out = { parts, nextId: grid.nextId };
  if (validateGrid(out).length > 0) throw new Error(`shaped random ship ${seed} is invalid`);
  return out;
}

type Row = [PartId, number, number, Rotation?, Tier?, ShapeId?];

/** D – the pirate "Wedge" after E2 (§9.6) from plain T2 parts: `hammer(2)` + a nose tip and a wing pair. */
export function klinE2(): ShipGrid {
  const rows: Row[] = [
    ['cockpit', 1, 0], ['armor', 2, 0], ['armor', 1, 1], ['armor', 1, -1], ['cannon', 2, 1], ['cannon', 2, -1],
    ['shield', 0, 0], ['reactor', -1, 0], ['gyro', 0, 1], ['fuelTank', 0, -1],
    ['engine', -2, 0], ['engine', -1, 1], ['engine', -1, -1], ['engine', 0, 2, 3], ['engine', 0, -2, 1], ['engine', 1, 2, 2], ['engine', 1, -2, 2],
    ['armor', 3, 0, 0, 2, 'nose'], ['armor', -2, 2, 0, 2, 'wingL'], ['armor', -2, -2, 0, 2, 'wingR'],
  ];
  return createGrid(rows.map(([id, x, y, rot, , shape]): Row => [id, x, y, rot ?? 0, 2, shape]));
}

/** E – the starter ship after E2 (§9.2): `createStarterShip()` + a wedge FP at (1, 2) and FS at (1, −2). */
export function starterE2(): ShipGrid {
  return createGrid([
    ['cockpit', 1, 0], ['gyro', 0, 0], ['miningLaser', 2, 0], ['reactor', -1, 0], ['cargo', 0, 1], ['cargo', 0, -1],
    ['fuelTank', 1, 1], ['radar', 1, -1], ['engine', -1, 1], ['engine', -1, -1], ['engine', 2, 1, 2], ['engine', 2, -1, 2],
    ['engine', 0, -2, 1], ['engine', 0, 2, 3],
    ['armor', 1, 2, 0, 1, 'wedge'], ['armor', 1, -2, 3, 1, 'wedge'],
  ]);
}

/** The SL2 example ships A–E after E2 (spec §9), all with shaped armour. */
export const SPEC_SHIPS_E2: Readonly<Record<'A' | 'B' | 'C' | 'D' | 'E', () => ShipGrid>> = {
  A: kosaE2,
  B: mulaE2,
  C: halapartnaE2,
  D: klinE2,
  E: starterE2,
};
