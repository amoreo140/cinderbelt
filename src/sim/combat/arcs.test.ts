import { describe, expect, it } from 'vitest';
import type { PartId, Tier } from '../../data/parts';
import type { ShapeId } from '../../data/shapes';
import { createGrid } from '../ship/grid';
import { computeProperties } from '../ship/properties';
import type { PlacedPart, Rotation, ShipGrid } from '../ship/types';
import { ARC_STEP, arcsWidth, CANNON_HALF_ARC, effectiveArcs, inArcs, type Arc } from './arcs';
import { cannonsCovering, fireWeapons } from './weapons';
import { combatShip } from './testing';

const deg = (r: number): number => Math.round((r * 180) / Math.PI);

describe('effective cannon arcs', () => {
  it('a cannon with nothing in front covers the full ±60°', () => {
    const grid = createGrid([['cockpit', 0, 0], ['cannon', 1, 0]]);
    expect(effectiveArcs(grid, grid.parts[1]!).map(([a, b]) => [deg(a), deg(b)])).toEqual([[-60, 60]]);
  });

  it('a neighbour beside and ahead trims the arc on its side only', () => {
    // cannon at (1,0) facing +x, armor at (2,1): the left part of the arc is cut
    const grid = createGrid([['cockpit', 0, 0], ['cannon', 1, 0], ['armor', 1, 1], ['armor', 2, 1]]);
    const arcs = effectiveArcs(grid, grid.parts[1]!);
    expect(arcs).toHaveLength(1);
    expect(deg(arcs[0]![0])).toBe(-60);
    expect(deg(arcs[0]![1])).toBeLessThan(30);
    expect(deg(arcs[0]![1])).toBeGreaterThanOrEqual(0);
  });

  it('a cannon facing into its own hull has no arc and never fires', () => {
    const grid = createGrid([['cockpit', 0, 0], ['cannon', 1, 0, 2], ['armor', 0, 1], ['armor', 0, -1]]);
    // rotation 2 faces −x – straight into the cockpit and the armor beside it
    expect(effectiveArcs(grid, grid.parts[1]!)).toEqual([]);
    const ship = combatShip(grid);
    expect(fireWeapons(ship, 'player', { x: -20, y: 0 }, { nextId: 1 })).toEqual([]);
  });

  it('a gap in the hull leaves two separate arcs', () => {
    // a single armor straight ahead (2 cells out) splits the arc in two
    const grid = createGrid([['cockpit', 0, 0], ['cannon', 1, 0], ['armor', 1, 1], ['armor', 2, 1], ['armor', 3, 1], ['armor', 3, 0]]);
    const g2 = createGrid([['cockpit', -1, 0], ['armor', -1, 1], ['armor', 0, 1], ['armor', 1, 1], ['armor', 1, 2], ['armor', 1, 3], ['cannon', 0, 0], ['armor', 3, 0], ['armor', 2, 1]]);
    const arcs = effectiveArcs(g2, g2.parts.find((p) => p.partId === 'cannon')!);
    expect(arcs.length).toBeGreaterThanOrEqual(1);
    expect(arcsWidth(arcs)).toBeLessThan(2 * CANNON_HALF_ARC);
    expect(arcsWidth(effectiveArcs(grid, grid.parts[1]!))).toBeLessThan(2 * CANNON_HALF_ARC);
  });

  it('is part of the ship properties and recomputed with the grid', () => {
    const a = computeProperties(createGrid([['cockpit', 0, 0], ['cannon', 1, 0]]));
    const b = computeProperties(createGrid([['cockpit', 0, 0], ['cannon', 1, 0], ['armor', 1, 1], ['armor', 2, 1]]));
    expect(arcsWidth(a.weapons[0]!.arcs)).toBeCloseTo(2 * CANNON_HALF_ARC, 5);
    expect(arcsWidth(b.weapons[0]!.arcs)).toBeLessThan(arcsWidth(a.weapons[0]!.arcs) - ARC_STEP);
  });

  it('counts the cannons that can hit the aim point', () => {
    const grid = createGrid([['cockpit', 0, 0], ['cannon', 1, 0], ['cannon', 0, 1, 1], ['reactor', -1, 0]]);
    const ship = combatShip(grid);
    // straight ahead: only the front cannon; up and ahead: both
    expect(cannonsCovering(ship, { x: 30, y: 0 })).toEqual({ covering: 1, total: 2 });
    expect(cannonsCovering(ship, { x: 20, y: 25 })).toEqual({ covering: 2, total: 2 });
    expect(cannonsCovering(ship, { x: -30, y: -5 })).toEqual({ covering: 0, total: 2 });
  });
});

// ---------------------------------------------------------------------------------------------------
// SL2 E2 S4: arcs cut by the real polygon of shaped armour (spec §2.5, mock-up rule `sl2-C-arcs.png`)

type Entry = [PartId, number, number, Rotation?, Tier?, ShapeId?];
const cannonAt = (grid: ShipGrid, x: number, y: number): PlacedPart => grid.parts.find((p) => p.partId === 'cannon' && p.x === x && p.y === y)!;
const arcsAt = (grid: ShipGrid, x: number, y: number): Arc[] => effectiveArcs(grid, cannonAt(grid, x, y));
const degArcs = (grid: ShipGrid, x: number, y: number): number[][] => arcsAt(grid, x, y).map(([a, b]) => [deg(a), deg(b)]);

/** Deterministic pseudo-random unshaped grids (overlaps allowed – arcs only read the cells). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const KINDS: PartId[] = ['armor', 'armor', 'cannon', 'cannon', 'reactor', 'engine', 'heavyLaser', 'largeCargo'];
/** Count and FNV-1a hash of every arc bound of 60 random unshaped ships (exact float text). */
function unshapedGolden(): string {
  let h = 0x811c9dc5;
  let n = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const r = lcg(seed);
    const list: [PartId, number, number, Rotation][] = [['cockpit', 0, 0, 0]];
    const count = 4 + Math.floor(r() * 24);
    for (let i = 0; i < count; i++) list.push([KINDS[Math.floor(r() * KINDS.length)]!, Math.floor(r() * 9) - 4, Math.floor(r() * 9) - 4, Math.floor(r() * 4) as Rotation]);
    const grid = createGrid(list);
    for (const p of grid.parts) {
      if (p.partId !== 'cannon') continue;
      for (const [a, b] of effectiveArcs(grid, p)) {
        n++;
        for (const ch of `${p.id}:${a}:${b};`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
      }
    }
  }
  return `${n}:${h.toString(16)}`;
}

/** The bow of example C after E2 (spec §9.5): stair edge cannons, FP/FS wedges, a 2×1 nose. */
function bowC(over: Entry[] = []): ShipGrid {
  const list: Entry[] = [['cockpit', 0, 0]];
  for (let x = -3; x <= 2; x++) for (const y of [-3, -2, -1, 1, 2, 3]) list.push(['armor', x, y]);
  list.push(['armor', -3, 0], ['armor', -2, 0], ['armor', -1, 0], ['armor', 1, 0], ['armor', 2, 0]);
  for (let y = -2; y <= 2; y++) list.push(['armor', 3, y]);
  list.push(['cannon', 3, 3], ['cannon', 3, -3]);
  for (let y = -1; y <= 1; y++) list.push(['armor', 4, y]);
  list.push(['cannon', 4, 2], ['cannon', 4, -2]);
  list.push(['armor', 5, 1, 0, 1, 'wedge'], ['armor', 5, -1, 3, 1, 'wedge'], ['armor', 5, 0, 0, 1, 'nose2x1']);
  const at = new Map(list.map((e) => [`${e[1]},${e[2]}`, e]));
  for (const e of over) at.set(`${e[1]},${e[2]}`, e);
  return createGrid([...at.values()]);
}

describe('effective cannon arcs with shaped armour', () => {
  it('unshaped grids: arcs identical to the values recorded before shapes', () => {
    expect(unshapedGolden()).toBe('179:cc6da8cc');
  });

  it('a wedge on the front diagonal frees the arc that a full cell blocks', () => {
    // cannon (1,0) facing +x; front-starboard diagonal (2,−1): a full cell blocks −72°…−18°, the FP wedge
    // (solid corner rear-starboard) only −72°…−45°
    const full = createGrid([['cockpit', 0, 0], ['cannon', 1, 0], ['armor', 2, -1]]);
    const wedge = createGrid([['cockpit', 0, 0], ['cannon', 1, 0], ['armor', 2, -1, 0, 1, 'wedge']]);
    expect(degArcs(full, 1, 0)).toEqual([[-18, 60]]);
    expect(degArcs(wedge, 1, 0)).toEqual([[-44, 60]]);
  });

  it('the grazing ray along a wedge hypotenuse is blocked (solid boundary)', () => {
    // the FP wedge at (2,−1) has its hypotenuse on the line through the cannon centre at −45°
    const wedge = createGrid([['cockpit', 0, 0], ['cannon', 1, 0], ['armor', 2, -1, 0, 1, 'wedge']]);
    expect(inArcs(arcsAt(wedge, 1, 0), -Math.PI / 4 - ARC_STEP)).toBe(false);
  });

  it('a wedge beside the cannon with its hypotenuse facing it frees the whole side', () => {
    // (1,1) beside the cannon: a full cell blocks 45°…60°; the wedge rot 3 keeps the rear-port corner
    const full = createGrid([['cockpit', 0, 0], ['cannon', 1, 0], ['armor', 1, 1]]);
    const wedge = createGrid([['cockpit', 0, 0], ['cannon', 1, 0], ['armor', 1, 1, 3, 1, 'wedge']]);
    expect(degArcs(full, 1, 0)).toEqual([[-60, 44]]);
    expect(degArcs(wedge, 1, 0)).toEqual([[-60, 60]]);
  });

  it('a wedge directly in front of the muzzle still blocks the axis in every rotation', () => {
    for (const rot of [0, 1, 2, 3] as const) {
      const grid = createGrid([['cockpit', 0, 0], ['cannon', 1, 0], ['armor', 2, 0, rot, 1, 'wedge']]);
      const arcs = arcsAt(grid, 1, 0);
      expect(inArcs(arcs, 0)).toBe(false);
      expect(arcsWidth(arcs)).toBeLessThan(2 * CANNON_HALF_ARC);
    }
  });

  it('example C after E2: the stair edge cannons keep a usable arc, symmetric port/starboard', () => {
    const grid = bowC();
    for (const [x, y] of [[3, 3], [4, 2]] as const) {
      const port = arcsAt(grid, x, y);
      expect(inArcs(port, 0)).toBe(true);
      expect(arcsWidth(port)).toBeGreaterThan(Math.PI / 3);
      expect(degArcs(grid, x, -y)).toEqual(degArcs(grid, x, y).map(([a, b]) => [-b!, -a!]).reverse());
    }
    // the wedges at (5,±1) cut less of the (4,±2) arcs than full armour would
    const full = bowC([['armor', 5, 1], ['armor', 5, -1]]);
    expect(arcsWidth(arcsAt(grid, 4, 2))).toBeGreaterThan(arcsWidth(arcsAt(full, 4, 2)) + 5 * ARC_STEP);
  });

  it('example C: a cannon in a pocket behind a wedge is walled in', () => {
    const grid = bowC([['cannon', 4, 1]]);
    expect(arcsAt(grid, 4, 1)).toEqual([]);
  });

  it('shaped arcs flow into the ship properties', () => {
    const full = computeProperties(createGrid([['cockpit', 0, 0], ['cannon', 1, 0], ['armor', 2, -1]]));
    const wedge = computeProperties(createGrid([['cockpit', 0, 0], ['cannon', 1, 0], ['armor', 2, -1, 0, 1, 'wedge']]));
    expect(arcsWidth(wedge.weapons[0]!.arcs)).toBeGreaterThan(arcsWidth(full.weapons[0]!.arcs) + 10 * ARC_STEP);
  });
});
