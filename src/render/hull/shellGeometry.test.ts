// SL2 E1 T2: hull shell geometry (shellGeometry.ts) – owners, attributes, swatch UVs, the rules of
// spec §3 (nothing behind nozzles, band only at muzzles, soot on torn edges, bevels, guards, seams,
// terraces), determinism, the triangle budget and the build time.
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import type { PartId, Tier } from '../../data/parts';
import { ENEMY_TEMPLATES } from '../../sim/combat/enemies';
import type { Vec2 } from '../../sim/math/vec2';
import { createGrid, partCells } from '../../sim/ship/grid';
import { gridCellKeys, hullOutline, type HullOutline, type OutlineOptions } from '../../sim/ship/outline';
import { halapartnaE2, kosaE2, mulaE2 } from '../../sim/ship/specShips.testing';
import { createStarterShip } from '../../sim/ship/presets';
import type { Rotation, ShipGrid } from '../../sim/ship/types';
import type { GraphicsQuality } from '../quality';
import { batchKey } from '../shipBatch';
import {
  BAND_CORE_Z,
  BAND_OUT,
  BEVEL,
  EMBER_TOOTH,
  EMBER_Z,
  GUARD_ARM,
  GUARD_OUT,
  GUARD_Z,
  LIP_W,
  LIP_Z,
  SHELL_MAX_TRIANGLES,
  SOOT_IN,
  SOOT_Z,
  STRIPE_OUT,
  TERRACE_BASE_Z,
  TERRACE_GROOVE_LIFT,
  TERRACE_GROOVE_W,
  TERRACE_INSET,
  TERRACE_LINE_W,
  TERRACE_SLOPE,
  TERRACE_TOP_Z,
} from './shellConstants';
import {
  buildShell,
  cellSetLoops,
  PART_LAYOUT,
  shellStyle,
  shellTriangles,
  type ShellLayout,
  type ShellMode,
  type ShellStyle,
  type SwatchLookup,
} from './shellGeometry';

// --- helpers -------------------------------------------------------------------------------------------

/** A fake swatch table: every key gets its own cell centre of an 8 × 32 atlas (deterministic). */
const ATLAS_COLS = 8;
const ATLAS_ROWS = 32;
// shared CI runners are several times slower than a dev machine; the timing budgets are for the latter
const CI_SLACK = import.meta.env.CI ? 3 : 1;
const fakeKeys = new Map<string, readonly [number, number]>();
const fakeSwatches: SwatchLookup = (key) => {
  let uv = fakeKeys.get(key);
  if (!uv) {
    const i = fakeKeys.size;
    uv = [((i % ATLAS_COLS) + 0.5) / ATLAS_COLS, (Math.floor(i / ATLAS_COLS) + 0.5) / ATLAS_ROWS];
    fakeKeys.set(key, uv);
  }
  return uv;
};

type Entry = [PartId, number, number, Rotation?, Tier?];

interface BuildOpts {
  style?: ShellStyle;
  outline?: Partial<OutlineOptions>;
  quality?: GraphicsQuality;
  mode?: ShellMode;
  layout?: ShellLayout;
  terraces?: boolean;
}

const shellOf = (grid: ShipGrid, o: BuildOpts = {}): Map<number, BufferGeometry> =>
  buildShell({
    outline: hullOutline(grid, { tornFrom: null, bevelArmour: true, ...o.outline }),
    style: o.style ?? shellStyle(1, null),
    layout: o.layout ?? PART_LAYOUT,
    swatchUv: fakeSwatches,
    quality: o.quality ?? 'medium',
    mode: o.mode ?? 'flight',
    grid,
    terraces: o.terraces,
  });

/** Grid-frame vertices (x, y, h) of a geometry (three.js hull frame: (x, h, −y)). */
function verts(g: BufferGeometry): { x: number; y: number; h: number }[] {
  const p = g.getAttribute('position');
  const out: { x: number; y: number; h: number }[] = [];
  for (let i = 0; i < p.count; i++) out.push({ x: p.getX(i), y: -p.getZ(i), h: p.getY(i) });
  return out;
}
const allVerts = (shell: Map<number, BufferGeometry>) => [...shell.values()].flatMap(verts);

/** UVs (as "u,v" strings) used by a shell. */
function uvSet(shell: Map<number, BufferGeometry>): Set<string> {
  const out = new Set<string>();
  for (const g of shell.values()) {
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) out.add(`${uv.getX(i)},${uv.getY(i)}`);
  }
  return out;
}
const uvKey = (key: string): string => fakeSwatches(key)!.join(',');

/** Chebyshev distance from a point to the nearest of the cells (0 inside). */
function outside(p: Vec2, cells: readonly Vec2[]): number {
  let best = Infinity;
  for (const c of cells) best = Math.min(best, Math.max(Math.abs(p.x - c.x) - 0.5, Math.abs(p.y - c.y) - 0.5, 0));
  return best;
}
const cellsOf = (grid: ShipGrid): Vec2[] => grid.parts.flatMap((p) => partCells(p));

/** A 140-cell freighter-like hull (14 × 10, mixed parts, 2×2 cargo bays, 2×1 heavy lasers). */
function bigShip(): ShipGrid {
  const list: Entry[] = [];
  const taken = new Set<string>();
  const put = (e: Entry, cells: Vec2[]) => {
    list.push(e);
    for (const c of cells) taken.add(`${c.x},${c.y}`);
  };
  put(['cockpit', 6, 0, 0, 2], [{ x: 6, y: 0 }]);
  for (const [x, y] of [[-3, 2], [-3, -4], [1, 2], [1, -4]] as const) {
    put(['largeCargo', x, y, 0, 2], [{ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }]);
  }
  for (const y of [-4, 3]) put(['heavyLaser', 5, y, 0, 2], [{ x: 5, y }, { x: 6, y }]);
  const fill: PartId[] = ['armor', 'reactor', 'fuelTank', 'armor', 'gyro', 'battery', 'armor', 'shield', 'radar', 'armor'];
  let k = 0;
  for (let x = -7; x <= 6; x++) {
    for (let y = -5; y <= 4; y++) {
      if (taken.has(`${x},${y}`)) continue;
      let id: PartId;
      let rot: Rotation = 0;
      if (x === -7) id = 'engine';
      else if (x === 6 && Math.abs(y) % 3 === 1) id = 'cannon';
      else if (y === -5 || y === 4) id = 'armor';
      else id = fill[k++ % fill.length]!;
      if (id === 'engine' && (y === -5 || y === 4)) rot = y < 0 ? 1 : 3;
      list.push([id, x, y, rot, 2]);
    }
  }
  return createGrid(list);
}

/** The 30-cell benchmark ship of outline.test.ts (engines, tanks, cockpit, armour, cannons). */
function thirtyCells(): ShipGrid {
  const rows = ['. . E< . . .', 'E R Ca A K .', 'E F S A A A', 'E G C A A A', 'E F S A A A', 'E R Ca A K .'];
  const codes: Record<string, [PartId, Rotation]> = {
    'E': ['engine', 0], 'E<': ['engine', 2], 'F': ['fuelTank', 0], 'A': ['armor', 0], 'K': ['cannon', 0],
    'R': ['reactor', 0], 'G': ['gyro', 0], 'Ca': ['cargo', 0], 'S': ['shield', 0], 'C': ['cockpit', 0],
  };
  const list: Entry[] = [];
  rows.forEach((row, r) =>
    row.split(/\s+/).forEach((code, c) => {
      if (code === '.') return;
      const [id, rot] = codes[code]!;
      list.push([id, -2 + c, 3 - r, rot, 1]);
    }),
  );
  list.push(['engine', 0, -3, 1, 1]);
  return createGrid(list);
}

// --- tests ---------------------------------------------------------------------------------------------

describe('buildShell – owners and attributes', () => {
  it('builds one geometry per owner part, only for parts of the grid', () => {
    const grid = createStarterShip();
    const shell = shellOf(grid);
    expect(shell.size).toBeGreaterThan(0);
    const ids = new Set(grid.parts.map((p) => p.id));
    for (const owner of shell.keys()) expect(ids.has(owner)).toBe(true);
  });

  it('splits a run between its owners: each piece stays at its own cells', () => {
    // three 1×1 parts in a row, no terrace (< 3 armour cells): every part owns its stretch of band and lip
    const grid = createGrid([['armor', 0, 0], ['cockpit', 1, 0], ['armor', 2, 0]]);
    const shell = shellOf(grid);
    expect([...shell.keys()].sort()).toEqual([1, 2, 3]);
    for (const p of grid.parts) {
      const own = partCells(p);
      for (const v of verts(shell.get(p.id)!)) expect(outside(v, own)).toBeLessThanOrEqual(LIP_W + 0.03);
    }
  });

  it('carries exactly the layout of the part meshes, so it joins their batch', () => {
    const layout: ShellLayout = {
      attributes: [
        { name: 'color', itemSize: 3 },
        { name: 'normal', itemSize: 3 },
        { name: 'position', itemSize: 3 },
        { name: 'uv', itemSize: 2 },
      ],
    };
    const shell = shellOf(createStarterShip(), { layout });
    const part = new BufferGeometry();
    part.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    part.setAttribute('normal', new BufferAttribute(new Int8Array(9), 3, true));
    part.setAttribute('uv', new BufferAttribute(new Uint16Array(6), 2, true));
    part.setAttribute('color', new BufferAttribute(new Float32Array(9), 3));
    const mat = new MeshStandardMaterial();
    const key = batchKey(new Mesh(part, mat));
    for (const g of shell.values()) {
      expect(Object.keys(g.attributes).sort()).toEqual(['color', 'normal', 'position', 'uv']);
      expect(batchKey(new Mesh(g, mat))).toBe(key);
      const color = g.getAttribute('color');
      expect(color.getX(0)).toBe(1);
    }
  });

  it('has unit normals and every triangle wound to face its normal', () => {
    for (const style of [shellStyle(1, null), shellStyle(2, null), shellStyle(2, 'rust')]) {
      const shell = shellOf(bigShip(), { style, quality: 'high', mode: 'hangar' });
      for (const g of shell.values()) {
        const p = g.getAttribute('position');
        const n = g.getAttribute('normal');
        const idx = g.index!;
        for (let t = 0; t < idx.count; t += 3) {
          const a = idx.getX(t);
          const b = idx.getX(t + 1);
          const c = idx.getX(t + 2);
          const ux = p.getX(b) - p.getX(a);
          const uy = p.getY(b) - p.getY(a);
          const uz = p.getZ(b) - p.getZ(a);
          const vx = p.getX(c) - p.getX(a);
          const vy = p.getY(c) - p.getY(a);
          const vz = p.getZ(c) - p.getZ(a);
          const cx = uy * vz - uz * vy;
          const cy = uz * vx - ux * vz;
          const cz = ux * vy - uy * vx;
          const area = Math.hypot(cx, cy, cz);
          if (area < 1e-9) continue;
          const dot = (cx * n.getX(a) + cy * n.getY(a) + cz * n.getZ(a)) / area;
          expect(dot).toBeGreaterThan(0.5);
          expect(Math.hypot(n.getX(a), n.getY(a), n.getZ(a))).toBeCloseTo(1, 5);
        }
      }
    }
  });

  it('uses only the style swatches (UVs at the swatch cell centres)', () => {
    for (const [style, mode] of [
      [shellStyle(1, null), 'flight'],
      [shellStyle(2, null), 'hangar'],
      [shellStyle(3, null), 'shipyard'],
      [shellStyle(2, 'slantedStar'), 'hangar'],
      [shellStyle(2, 'rust'), 'hangar'],
      [shellStyle(1, 'cauldron'), 'flight'],
    ] as const) {
      const allowed = new Set(
        [style.core, style.plate, style.stripe, style.glow, style.lip, style.seam, style.terraceSide, style.groove, style.soot, style.sootAlt, style.char, style.ember]
          .filter((k): k is string => k !== null)
          .map(uvKey),
      );
      const grid = bigShip();
      const torn = gridCellKeys(grid);
      const damaged: ShipGrid = { parts: grid.parts.filter((p) => p.id % 7 !== 3), nextId: grid.nextId };
      const shell = shellOf(damaged, { style, mode, quality: 'high', outline: { tornFrom: torn } });
      for (const uv of uvSet(shell)) expect(allowed.has(uv)).toBe(true);
      for (const uv of uvSet(shell)) {
        const [u, v] = uv.split(',').map(Number) as [number, number];
        // the centre of a cell of the fake atlas
        expect((u * ATLAS_COLS) % 1).toBeCloseTo(0.5, 6);
        expect((v * ATLAS_ROWS) % 1).toBeCloseTo(0.5, 6);
      }
    }
  });

  it('is empty without a swatch table or an outline', () => {
    const grid = createStarterShip();
    const outline = hullOutline(grid, { tornFrom: null, bevelArmour: true });
    const base = { outline, style: shellStyle(1, null), layout: PART_LAYOUT, quality: 'medium' as const, mode: 'flight' as const };
    expect(buildShell({ ...base, swatchUv: () => null }).size).toBe(0);
    expect(shellOf(createGrid([])).size).toBe(0);
  });

  it('is deterministic', () => {
    const grid = bigShip();
    const torn = gridCellKeys(grid);
    const damaged: ShipGrid = { parts: grid.parts.filter((p) => p.id % 5 !== 2), nextId: grid.nextId };
    const dump = (shell: Map<number, BufferGeometry>) =>
      [...shell].map(([id, g]) => [id, Array.from(g.getAttribute('position').array), Array.from(g.getAttribute('uv').array), Array.from(g.index!.array)]);
    const a = shellOf(damaged, { outline: { tornFrom: torn }, quality: 'high', mode: 'hangar' });
    // a fresh grid object (no outline memo) gives the same result
    const b = shellOf({ parts: damaged.parts.map((p) => ({ ...p })), nextId: damaged.nextId }, { outline: { tornFrom: torn }, quality: 'high', mode: 'hangar' });
    expect(JSON.stringify(dump(b))).toBe(JSON.stringify(dump(a)));
  });
});

describe('buildShell – spec §3 rules', () => {
  it('adds no surface beyond the cells but the band (stripe) – guards at most GUARD_OUT', () => {
    const grid = bigShip();
    const cells = cellsOf(grid);
    let worst = 0;
    for (const v of allVerts(shellOf(grid, { quality: 'high', mode: 'hangar' }))) worst = Math.max(worst, outside(v, cells));
    expect(worst).toBeLessThanOrEqual(GUARD_OUT + 1e-6);
    // a hull without guards: nothing beyond the stripe
    const block = createGrid([
      ['armor', 0, 0], ['armor', 1, 0], ['armor', 2, 0],
      ['armor', 0, 1], ['cockpit', 1, 1], ['armor', 2, 1],
      ['armor', 0, 2], ['armor', 1, 2], ['armor', 2, 2],
    ]);
    worst = 0;
    for (const v of allVerts(shellOf(block))) worst = Math.max(worst, outside(v, cellsOf(block)));
    expect(worst).toBeLessThanOrEqual(STRIPE_OUT + 1e-6);
  });

  it('follows the shaved player armour corners; clan armour gets guards instead', () => {
    const block = createGrid([
      ['armor', 0, 0], ['armor', 1, 0], ['armor', 2, 0],
      ['armor', 0, 1], ['cockpit', 1, 1], ['armor', 2, 1],
      ['armor', 0, 2], ['armor', 1, 2], ['armor', 2, 2],
    ]);
    const player = allVerts(shellOf(block));
    // the cut of the front-port corner (2.5, 2.5): x + y ≤ 5 − BEVEL, plus the stripe along its normal
    const limit = 5 - BEVEL + STRIPE_OUT * Math.SQRT2 + 1e-9;
    for (const v of player) expect(v.x + v.y).toBeLessThanOrEqual(limit);
    expect(player.some((v) => v.h === GUARD_Z[1])).toBe(false);
    const clan = allVerts(shellOf(block, { style: shellStyle(1, 'rust'), outline: { bevelArmour: false } }));
    expect(clan.some((v) => Math.abs(v.h - GUARD_Z[1]) < 1e-9)).toBe(true);
    expect(clan.some((v) => v.x + v.y > 5 - 1e-6)).toBe(true);
  });

  it('puts corner guards on the convex corners of functional parts', () => {
    // a lone cockpit: four convex corners, four guards (each topped at GUARD_Z[1])
    const shell = shellOf(createGrid([['cockpit', 0, 0]]));
    const tops = allVerts(shell).filter((v) => Math.abs(v.h - GUARD_Z[1]) < 1e-9);
    // per guard: the two cap top quads (8 vertices) + the cap's walls reach the top too (6 walls × 2)
    expect(tops.length).toBe(4 * (8 + 12));
    for (const v of tops) expect(Math.max(Math.abs(v.x), Math.abs(v.y))).toBeGreaterThan(0.5 - 0.3 - 1e-9);
  });

  it('builds nothing behind a nozzle', () => {
    // engine behind the cockpit: its rear edge and the rear halves of its sides are nozzle edges
    const shell = shellOf(createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0]]));
    const xs = allVerts(shell).map((v) => v.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1 - 1e-9);
    expect(shell.has(2)).toBe(true); // the engine's front half still has band and lip
  });

  it('gives a muzzle edge the band but no lip', () => {
    const shell = shellOf(createGrid([['cockpit', 0, 0], ['cannon', 1, 0, 0]]));
    const cannon = verts(shell.get(2)!);
    const front = 1.5;
    // band at the front face, down to the core's bottom
    expect(cannon.some((v) => Math.abs(v.x - front - BAND_OUT) < 1e-6 && Math.abs(v.h - BAND_CORE_Z[0]) < 1e-6 && Math.abs(v.y) < 0.6)).toBe(true);
    // no lip top over the middle of the front edge
    expect(cannon.some((v) => v.h >= LIP_Z[1] - 1e-9 && v.x > front - LIP_W - 0.05 && Math.abs(v.y) < 0.3)).toBe(false);
  });

  it('turns a torn edge into soot and an ember rim: no band, no lip', () => {
    const grid = createGrid([['cockpit', 0, 0], ['armor', 1, 0], ['engine', -1, 0, 0]]);
    const torn = gridCellKeys(grid);
    const shot: ShipGrid = { parts: grid.parts.filter((p) => p.partId !== 'armor'), nextId: grid.nextId };
    const style = shellStyle(1, null);
    const intact = shellOf(shot);
    const damaged = shellOf(shot, { outline: { tornFrom: torn } });
    for (const key of [style.soot, style.sootAlt, style.char, style.ember]) expect(uvSet(intact).has(uvKey(key))).toBe(false);
    for (const key of [style.soot, style.char, style.ember]) expect(uvSet(damaged).has(uvKey(key))).toBe(true);
    // over the torn front edge (x = 0.5): soot only, no lip top
    const front = verts(damaged.get(1)!).filter((v) => v.x > 0.5 - LIP_W - 0.01 && Math.abs(v.y) < 0.2);
    expect(front.length).toBeGreaterThan(0);
    expect(front.every((v) => v.h < LIP_Z[1] - 1e-6)).toBe(true);
  });

  it('torn edges read on light and dark hulls: an emissive rim over the soot, ash on dark clan decks', () => {
    // light / mid-tone decks get dark char, dark decks light ash (art/README §3.1 roles); the rim is
    // ember, the Cauldron's hot_edge (ember would be orange on its orange paint)
    for (const [style, soot, rim] of [
      [shellStyle(1, null), 'char_black', 'ember'],
      [shellStyle(2, 'rust'), 'char_black', 'ember'],
      [shellStyle(2, 'slantedStar'), 'ash', 'ember'],
      [shellStyle(2, 'cauldron'), 'ash', 'hot_edge'],
    ] as const) {
      expect(style.soot).toBe(soot);
      expect(style.ember).toBe(rim);
    }
    const grid = createGrid([['cockpit', 0, 0], ['armor', 1, 0], ['engine', -1, 0, 0]]);
    const shot: ShipGrid = { parts: grid.parts.filter((p) => p.partId !== 'armor'), nextId: grid.nextId };
    const style = shellStyle(2, 'slantedStar');
    const damaged = shellOf(shot, { style, outline: { tornFrom: gridCellKeys(grid), bevelArmour: false } });
    const g = damaged.get(1)!;
    const uv = g.getAttribute('uv');
    const ember = uvKey(style.ember);
    const rim = verts(g).filter((_, i) => `${uv.getX(i)},${uv.getY(i)}` === ember);
    expect(rim.length).toBeGreaterThan(0);
    // the rim tops out above the soot and below the lip, within its tooth of the torn edge (x = 0.5)
    expect(Math.max(...rim.map((v) => v.h))).toBeCloseTo(EMBER_Z, 6);
    expect(EMBER_Z).toBeGreaterThan(SOOT_Z + 0.004 + 0.006);
    expect(EMBER_Z).toBeLessThan(LIP_Z[1]);
    expect(rim.every((v) => v.x > 0.5 - EMBER_TOOTH * 1.3 - 1e-9 && v.x < 0.5 + 0.01)).toBe(true);
    // the soot patches reach deeper than the rim
    const ash = uvKey(style.soot);
    const patches = verts(g).filter((v, i) => `${uv.getX(i)},${uv.getY(i)}` === ash && Math.abs(v.h - SOOT_Z) < 0.005);
    expect(Math.min(...patches.map((v) => v.x))).toBeLessThan(0.5 - SOOT_IN * 0.7);
  });

  it('draws one seam strip per seam run, owned by the lower part id', () => {
    const grid = createStarterShip();
    const outline = hullOutline(grid, { tornFrom: null, bevelArmour: true });
    const style = shellStyle(1, null);
    // the player's seam swatch is the band core: count seam strips by their height instead
    const shell = shellOf(grid);
    const seamTops = allVerts(shell).filter((v) => v.h > 0.205 && v.h < 0.21);
    expect(seamTops.length).toBe(outline.seams.length * 4);
    for (const s of outline.seams) expect(shell.has(s.owners[0])).toBe(true);
    expect(style.seam).toBe(style.core);
  });

  describe('terrace v2 – the low inner spine', () => {
    /** A w × h armour block from (0, 0) – its inner cells carry the terrace. */
    const block = (w: number, h: number): ShipGrid => {
      const list: Entry[] = [];
      for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) list.push(['armor', x, y]);
      return createGrid(list);
    };
    /** Terrace geometry: everything above the lip, guards and clan decorations (≤ 0.25). */
    const ABOVE = 0.26;
    const terraceVerts = (shell: Map<number, BufferGeometry>) => allVerts(shell).filter((v) => v.h > ABOVE);
    /** Triangles with a corner on the slab (the sides start at the base, under the deck). */
    const terraceTris = (shell: Map<number, BufferGeometry>): number => {
      let n = 0;
      for (const g of shell.values()) {
        const p = g.getAttribute('position');
        const idx = g.index!;
        for (let t = 0; t < idx.count; t += 3) {
          if ([0, 1, 2].some((k) => p.getY(idx.getX(t + k)) > ABOVE)) n++;
        }
      }
      return n;
    };
    const GROOVE_H = TERRACE_TOP_Z + TERRACE_GROOVE_LIFT;
    const CHEVRON_TOP = TERRACE_TOP_Z + 0.017;
    const LINE_IN = TERRACE_INSET + TERRACE_SLOPE + TERRACE_LINE_W;

    it('is on by default (TERRACE_ENABLED), off when asked, owned by the lowest id', () => {
      const grid = block(5, 3);
      expect(terraceVerts(shellOf(grid, { terraces: false }))).toEqual([]);
      expect(terraceVerts(shellOf(grid)).length).toBeGreaterThan(0);
      const outline = hullOutline(grid, { tornFrom: null, bevelArmour: true });
      const owner = outline.terraces[0]!.owner;
      const shell = shellOf(grid, { terraces: true });
      expect(verts(shell.get(owner)!).some((v) => v.h > ABOVE)).toBe(true);
      for (const [id, g] of shell) if (id !== owner) expect(verts(g).some((v) => v.h > ABOVE)).toBe(false);
    });

    it('is low: top at deck + 0.07, base at deck − 0.01, insets 0.08 + 0.06, only the chevron higher', () => {
      expect(TERRACE_TOP_Z).toBeCloseTo(0.27, 9);
      expect(TERRACE_BASE_Z).toBeCloseTo(0.19, 9);
      expect(TERRACE_INSET).toBeCloseTo(0.08, 9);
      expect(TERRACE_SLOPE).toBeCloseTo(0.06, 9);
      const grid = block(5, 3); // spine: (1..3, 1) → x 0.5 … 3.5, y 0.5 … 1.5
      const shell = shellOf(grid, { terraces: true });
      const vs = terraceVerts(shell);
      const tops = vs.filter((v) => Math.abs(v.h - TERRACE_TOP_Z) < 1e-6);
      expect(tops.length).toBeGreaterThan(0);
      const topIn = TERRACE_INSET + TERRACE_SLOPE;
      for (const v of tops) {
        expect(v.x).toBeGreaterThanOrEqual(0.5 + topIn - 1e-6);
        expect(v.x).toBeLessThanOrEqual(3.5 - topIn + 1e-6);
        expect(v.y).toBeGreaterThanOrEqual(0.5 + topIn - 1e-6);
        expect(v.y).toBeLessThanOrEqual(1.5 - topIn + 1e-6);
      }
      // the sloped sides start at the base, TERRACE_INSET in from the group's edge
      const base = allVerts(shell).filter((v) => Math.abs(v.h - TERRACE_BASE_Z) < 1e-6);
      expect(base.length).toBeGreaterThan(0);
      for (const v of base) expect(Math.min(v.x - 0.5, 3.5 - v.x, v.y - 0.5, 1.5 - v.y)).toBeCloseTo(TERRACE_INSET, 6);
      // nothing higher than the top except the chevron (0.017 prism, the plates' CHEVRON_Z thickness)
      const above = vs.filter((v) => v.h > GROOVE_H + 1e-6);
      expect(above.length).toBeGreaterThan(0);
      for (const v of above) expect(v.h).toBeCloseTo(CHEVRON_TOP, 6);
    });

    it('matte hull_mid top and sides, the tier accent line and chevron – never the plate swatch', () => {
      const grid = block(5, 3);
      const style = shellStyle(1, null);
      expect(style.terraceSide).toBe('hull_mid');
      const shell = shellOf(grid, { terraces: true });
      const uvs = new Set<string>();
      for (const g of shell.values()) {
        const p = g.getAttribute('position');
        const uv = g.getAttribute('uv');
        for (let i = 0; i < p.count; i++) if (p.getY(i) > ABOVE) uvs.add(`${uv.getX(i)},${uv.getY(i)}`);
      }
      expect(uvs.has(uvKey('hull_mid'))).toBe(true);
      expect(uvs.has(uvKey(style.stripe))).toBe(true);
      expect(uvs.has(uvKey(style.plate))).toBe(false);
      // the accent line: a TERRACE_LINE_W ring on the top edge (top vertices that far further in exist)
      const tops = allVerts(shell).filter((v) => Math.abs(v.h - TERRACE_TOP_Z) < 1e-6);
      expect(tops.some((v) => Math.abs(v.y - (0.5 + LINE_IN)) < 1e-6)).toBe(true);
    });

    it('one chevron on the bow-most cell, pointing to the bow', () => {
      const shell = shellOf(block(5, 3), { terraces: true });
      const chevron = terraceVerts(shell).filter((v) => Math.abs(v.h - CHEVRON_TOP) < 1e-6);
      expect(chevron.length).toBeGreaterThan(0);
      // centred on (3, 1): bbox x −0.075 … +0.075, y ±0.1; the tip (frontmost point) on the middle line
      const xs = chevron.map((v) => v.x);
      const ys = chevron.map((v) => v.y);
      expect(Math.min(...xs)).toBeCloseTo(3 - 0.075, 6);
      expect(Math.max(...xs)).toBeCloseTo(3 + 0.075, 6);
      expect(Math.min(...ys)).toBeCloseTo(0.9, 6);
      expect(Math.max(...ys)).toBeCloseTo(1.1, 6);
      for (const v of chevron.filter((q) => Math.abs(q.x - (3 + 0.075)) < 1e-6)) expect(v.y).toBeCloseTo(1, 6);
      // a transverse spine (3 × 7 block: x = 1, y 1 … 5): the chevron on its middle cell, still to the bow
      const col = terraceVerts(shellOf(block(3, 7), { terraces: true })).filter((v) => Math.abs(v.h - CHEVRON_TOP) < 1e-6);
      expect(Math.max(...col.map((v) => v.x))).toBeCloseTo(1 + 0.075, 6);
      expect(Math.min(...col.map((v) => v.y))).toBeCloseTo(3 - 0.1, 6);
      expect(Math.max(...col.map((v) => v.y))).toBeCloseTo(3 + 0.1, 6);
    });

    it('per-cell grooves continue the cell grid: hangar / shipyard always, flight on High only', () => {
      const grid = block(5, 3); // two inner cell sides: x = 1.5 and 2.5
      const groove = (shell: Map<number, BufferGeometry>) => allVerts(shell).filter((v) => Math.abs(v.h - GROOVE_H) < 1e-6);
      expect(groove(shellOf(grid, { terraces: true, quality: 'medium', mode: 'flight' }))).toEqual([]);
      for (const o of [
        { quality: 'high', mode: 'flight' },
        { quality: 'medium', mode: 'hangar' },
        { quality: 'low', mode: 'shipyard' },
      ] as const) {
        const g = groove(shellOf(grid, { terraces: true, ...o }));
        expect(g).toHaveLength(8);
        for (const v of g) {
          expect([1.5, 2.5].some((x) => Math.abs(Math.abs(v.x - x) - TERRACE_GROOVE_W / 2) < 1e-6)).toBe(true);
          expect(Math.min(v.y - 0.5, 1.5 - v.y)).toBeCloseTo(LINE_IN, 6);
        }
      }
      // a transverse spine: grooves across it (along x) at y = 1.5 … 4.5
      const col = groove(shellOf(block(3, 7), { terraces: true, mode: 'hangar' }));
      expect(col).toHaveLength(16);
      for (const v of col) expect(Math.min(v.x - 0.5, 1.5 - v.x)).toBeCloseTo(LINE_IN, 6);
    });

    it('stays inside the triangle budget: ≤ 60 triangles for a 3-cell spine, big ships within the shell budget', () => {
      expect(terraceTris(shellOf(block(5, 3), { terraces: true, quality: 'high', mode: 'hangar' }))).toBeLessThanOrEqual(60);
      for (const grid of [halapartnaE2(), mulaE2(), kosaE2(), bigShip()]) {
        const shell = shellOf(grid, { terraces: true, quality: 'high', mode: 'hangar' });
        expect(shellTriangles(shell)).toBeLessThanOrEqual(SHELL_MAX_TRIANGLES);
      }
    });
  });

  it('adds grooves and clan decorations only on High off-flight', () => {
    const grid = bigShip();
    const style = shellStyle(2, 'rust');
    const flight = shellTriangles(shellOf(grid, { terraces: false, style, quality: 'high', mode: 'flight' }));
    const hangar = shellTriangles(shellOf(grid, { terraces: false, style, quality: 'high', mode: 'hangar' }));
    const medium = shellTriangles(shellOf(grid, { terraces: false, style, quality: 'medium', mode: 'hangar' }));
    expect(hangar).toBeGreaterThan(flight);
    expect(medium).toBe(flight);
    const groove = uvKey(style.groove);
    expect(uvSet(shellOf(grid, { terraces: false, style, quality: 'high', mode: 'hangar' })).has(groove)).toBe(true);
    expect(uvSet(shellOf(grid, { terraces: false, style, quality: 'high', mode: 'flight' })).has(groove)).toBe(false);
  });

  it('Low builds the lean profile (fewer triangles, same coverage)', () => {
    const grid = createStarterShip();
    const low = shellOf(grid, { quality: 'low' });
    const medium = shellOf(grid, { quality: 'medium' });
    expect(shellTriangles(low)).toBeLessThan(shellTriangles(medium));
    expect([...low.keys()]).toEqual([...medium.keys()]);
  });
});

describe('buildShell – styles', () => {
  it('has the crystal tier and the clan styles', () => {
    expect(shellStyle(3, null)).toMatchObject({ core: 'hull_dark_cr', plate: 'hull_cr', stripe: 'accent_crystal', glow: 'tier_glow_cr', lip: 'accent_crystal' });
    expect(shellStyle(2, 'slantedStar')).toMatchObject({ lip: 'sst_lacquer', seam: 'sst_gold', glow: 'sst_glow', deco: 'slashes' });
    expect(shellStyle(1, 'slantedStar').glow).toBeNull();
    expect(shellStyle(1, 'rust')).toMatchObject({ lip: 'pir_rust_patch', seam: 'pir_weld', deco: 'welds' });
    expect(shellStyle(2, 'cauldron')).toMatchObject({ lip: 'kot_copper', glow: 'kot_furnace', deco: null });
    expect(shellStyle(3, 'wardens').lip).toBe('accent_crystal');
  });
});

describe('cellSetLoops', () => {
  it('traces outer loops counter-clockwise and holes clockwise, corners only', () => {
    const ring: Vec2[] = [];
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) if (x !== 1 || y !== 1) ring.push({ x, y });
    const loops = cellSetLoops(ring);
    expect(loops).toHaveLength(2);
    const area = (l: { x: number[]; y: number[] }) => l.x.reduce((a, x, i) => a + x * l.y[(i + 1) % l.x.length]! - l.x[(i + 1) % l.x.length]! * l.y[i]!, 0) / 2;
    expect(loops.map(area).sort((a, b) => a - b)).toEqual([-1, 9]);
    expect(loops.every((l) => l.x.length === 4)).toBe(true);
  });
});

describe('buildShell – budget', () => {
  it(`stays within ${SHELL_MAX_TRIANGLES} triangles for a 140-cell hull`, () => {
    const grid = bigShip();
    expect(cellsOf(grid)).toHaveLength(140);
    for (const [quality, mode] of [['low', 'flight'], ['medium', 'flight'], ['high', 'flight'], ['high', 'hangar']] as const) {
      for (const style of [shellStyle(2, null), shellStyle(2, 'rust'), shellStyle(2, 'slantedStar')]) {
        const t = shellTriangles(shellOf(grid, { quality, mode, style }));
        expect(t).toBeLessThanOrEqual(SHELL_MAX_TRIANGLES);
      }
    }
  });

  it('falls back to the lean profile for a very ragged hull', () => {
    // a comb: a spine with 1×1 teeth – a long outline split into many owners
    const list: Entry[] = [['cockpit', 0, 0]];
    for (let x = 1; x < 24; x++) list.push(['armor', x, 0]);
    for (let x = 0; x < 24; x += 2) for (const y of [1, 2, -1, -2]) list.push(['armor', x, y]);
    const grid = createGrid(list);
    const lean = shellTriangles(shellOf(grid, { quality: 'low' }));
    const auto = shellTriangles(shellOf(grid, { quality: 'high' }));
    expect(auto).toBe(lean);
  });

  it('builds a 30-cell pirate within 0.3 ms (warm, median of 50)', () => {
    const grids = [thirtyCells(), ...Object.values(ENEMY_TEMPLATES).map((t) => t(2))];
    for (const grid of grids) {
      const outline = hullOutline(grid, { tornFrom: gridCellKeys(grid), bevelArmour: false });
      const input = { outline, style: shellStyle(2, 'rust'), layout: PART_LAYOUT, swatchUv: fakeSwatches, quality: 'high' as const, mode: 'flight' as const, grid };
      for (let i = 0; i < 200; i++) buildShell(input);
      // the median of 50 builds; the best of three rounds (other test files share the CPU)
      let best = Infinity;
      for (let round = 0; round < 3; round++) {
        const times: number[] = [];
        for (let i = 0; i < 50; i++) {
          const t0 = performance.now();
          buildShell(input);
          times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        best = Math.min(best, times[25]!);
      }
      expect(best).toBeLessThanOrEqual(0.3 * CI_SLACK);
    }
  });
});

// --- SL2 E2 R3: shaped edges ---------------------------------------------------------------------------

/** Swatch key of a fake-table UV ("u,v"). */
const swatchOfUv = {
  get: (uv: string): string | undefined => {
    for (const [key, v] of fakeKeys) if (`${v[0]},${v[1]}` === uv) return key;
    return undefined;
  },
};

/** FNV-1a hash of a whole shell: owners in map order, positions, normals, UVs and indices (exact floats). */
function shellHash(shell: Map<number, BufferGeometry>): string {
  let h = 0x811c9dc5;
  const word = (x: number): void => {
    h ^= x;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  for (const [owner, g] of shell) {
    word(owner);
    for (const name of ['position', 'normal']) {
      const arr = g.getAttribute(name).array;
      word(arr.length);
      for (let i = 0; i < arr.length; i++) {
        f32[0] = arr[i]!;
        word(u32[0]!);
      }
    }
    // UVs by swatch key: the fake table numbers its keys in first-use order, which depends on the test order
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      const key = swatchOfUv.get(`${uv.getX(i)},${uv.getY(i)}`) ?? '?';
      for (let c = 0; c < key.length; c++) word(key.charCodeAt(c));
    }
    const idx = g.index!.array;
    word(idx.length);
    for (let i = 0; i < idx.length; i++) word(idx[i]!);
  }
  return h.toString(16).padStart(8, '0');
}

/** Unshaped ships × option sets whose shells must stay bit-identical through E2. */
function unshapedCases(): [string, () => Map<number, BufferGeometry>][] {
  /** Terraces off: these hashes were recorded before terrace v2 and cover the terrace-free shell. */
  const shellNoTerrace = (grid: ShipGrid, o: BuildOpts = {}): Map<number, BufferGeometry> => shellOf(grid, { ...o, terraces: false });
  const block = (): ShipGrid =>
    createGrid([
      ['armor', 0, 0], ['armor', 1, 0], ['armor', 2, 0],
      ['armor', 0, 1], ['armor', 2, 1],
      ['armor', 0, 2], ['cockpit', 1, 2], ['armor', 2, 2],
    ]);
  const damaged = (grid: ShipGrid, k: number): [ShipGrid, Set<string>] => [
    { parts: grid.parts.filter((p) => p.id % k !== 2), nextId: grid.nextId },
    gridCellKeys(grid),
  ];
  const out: [string, () => Map<number, BufferGeometry>][] = [
    ['starter-medium', () => shellNoTerrace(createStarterShip())],
    ['starter-low', () => shellNoTerrace(createStarterShip(), { quality: 'low' })],
    ['starter-t3-shipyard', () => shellNoTerrace(createStarterShip(), { style: shellStyle(3, null), quality: 'high', mode: 'shipyard' })],
    ['big-t2-hangar', () => shellNoTerrace(bigShip(), { style: shellStyle(2, null), quality: 'high', mode: 'hangar' })],
    ['big-rust-torn', () => {
      const [g, torn] = damaged(bigShip(), 5);
      return shellNoTerrace(g, { style: shellStyle(2, 'rust'), quality: 'high', mode: 'hangar', outline: { tornFrom: torn, bevelArmour: false } });
    }],
    ['big-star-hangar', () => shellNoTerrace(bigShip(), { style: shellStyle(2, 'slantedStar'), quality: 'high', mode: 'hangar', outline: { bevelArmour: false } })],
    ['thirty-torn', () => {
      const [g, torn] = damaged(thirtyCells(), 4);
      return shellNoTerrace(g, { outline: { tornFrom: torn } });
    }],
    ['ring-hole', () => shellNoTerrace(block())],
    ['ring-hole-clan', () => shellNoTerrace(block(), { style: shellStyle(1, 'cauldron'), outline: { bevelArmour: false } })],
  ];
  for (const [kind, make] of Object.entries(ENEMY_TEMPLATES)) {
    out.push([`${kind}2`, () => shellNoTerrace(make(2), { style: shellStyle(2, 'rust'), outline: { tornFrom: gridCellKeys(make(2)), bevelArmour: false } })]);
  }
  return out;
}

/**
 * Recorded before R3 changed shellGeometry.ts. The two torn cases were re-recorded by the torn-edge
 * readability pass (2026-10-16: ember rim, deeper soot, new soot swatches) – only torn runs changed.
 * Built with terraces off (`shellNoTerrace`), so terrace v2 being on by default does not move them.
 */
const RECORDED_SHELLS: Record<string, string> = {
  'starter-medium': 'ee25a6ac',
  'starter-low': '7df2474c',
  'starter-t3-shipyard': '75bdbd8c',
  'big-t2-hangar': 'f9747729',
  'big-rust-torn': '95b24eb5',
  'big-star-hangar': '76200201',
  'thirty-torn': '8898f8ca',
  'ring-hole': 'ca6d4971',
  'ring-hole-clan': '59b930d9',
  jackal2: 'd5d5aa2b',
  hammer2: '2e302400',
  scavenger2: 'fc0a8732',
  gunner2: '791f33ae',
  sentry2: '945c04c9',
};

describe('buildShell – unshaped shells are unchanged by E2', () => {
  it('shell hashes equal the values recorded before shaped edges', () => {
    const got: Record<string, string> = {};
    for (const [name, make] of unshapedCases()) got[name] = shellHash(make());
    expect(got).toEqual(RECORDED_SHELLS);
  });
});

/** Spec §9.2 E after E2: two wedges beside the steering engines. */
const starterE2 = (): ShipGrid => {
  const base = createStarterShip();
  const list: Entry[] = base.parts.map((p): Entry => [p.partId, p.x, p.y, p.rot, p.tier]);
  return createGrid([...list, ['armor', 1, 2, 0, 1, 'wedge'], ['armor', 1, -2, 3, 1, 'wedge']]);
};

/** Spec §9.6 D after E2: the hammer with a nose tip and two wings (a clan ship). */
const hammerE2 = (): ShipGrid => {
  const base = ENEMY_TEMPLATES.hammer(2);
  const list: Entry[] = base.parts.map((p): Entry => [p.partId, p.x, p.y, p.rot, p.tier]);
  return createGrid([...list, ['armor', 3, 0, 0, 2, 'nose'], ['armor', -2, 2, 0, 2, 'wingL'], ['armor', -2, -2, 0, 2, 'wingR']]);
};

/** Spec ships A–E after E2 with their shell style and outline options. */
const SHAPED_SHIPS: [string, () => ShipGrid, ShellStyle, Partial<OutlineOptions>][] = [
  ['E', starterE2, shellStyle(1, null), {}],
  ['A', kosaE2, shellStyle(1, null), {}],
  ['B', mulaE2, shellStyle(2, null), {}],
  ['C', halapartnaE2, shellStyle(2, null), {}],
  ['D', hammerE2, shellStyle(2, 'rust'), { bevelArmour: false }],
];

/** The shell of a shaped ship: the outline at render detail, as ShipView builds it. */
const shapedShell = (grid: ShipGrid, style: ShellStyle, o: BuildOpts = {}): Map<number, BufferGeometry> =>
  shellOf(grid, { style, ...o, outline: { detail: 'render', ...o.outline } });

/** Winding number of the outline loops around a point (≠ 0 = inside the solid). */
function inSolid(o: HullOutline, x: number, y: number): boolean {
  let w = 0;
  for (const loop of o.loops) {
    for (const r of loop.runs) {
      for (const e of r.edges) {
        const { a, b } = e;
        if (a.y <= y) {
          if (b.y > y && (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) > 0) w++;
        } else if (b.y <= y && (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) < 0) w--;
      }
    }
  }
  return w !== 0;
}

/** Distance from a point to the nearest outline edge. */
function toOutline(o: HullOutline, x: number, y: number): number {
  let best = Infinity;
  for (const loop of o.loops) {
    for (const r of loop.runs) {
      for (const { a, b } of r.edges) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
        best = Math.min(best, Math.hypot(a.x + dx * t - x, a.y + dy * t - y));
      }
    }
  }
  return best;
}

/** How far a shell vertex sticks out of the solid (0 inside). */
const sticksOut = (o: HullOutline, v: Vec2): number => (inSolid(o, v.x, v.y) ? 0 : toOutline(o, v.x, v.y));

/** Finite positions, unit normals and every triangle wound to face its normal (as the attributes test). */
function checkWinding(shell: Map<number, BufferGeometry>): void {
  for (const g of shell.values()) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const idx = g.index!;
    for (let i = 0; i < p.array.length; i++) expect(Number.isFinite(p.array[i]!)).toBe(true);
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t);
      const b = idx.getX(t + 1);
      const c = idx.getX(t + 2);
      const ux = p.getX(b) - p.getX(a);
      const uy = p.getY(b) - p.getY(a);
      const uz = p.getZ(b) - p.getZ(a);
      const vx = p.getX(c) - p.getX(a);
      const vy = p.getY(c) - p.getY(a);
      const vz = p.getZ(c) - p.getZ(a);
      const cx = uy * vz - uz * vy;
      const cy = uz * vx - ux * vz;
      const cz = ux * vy - uy * vx;
      const area = Math.hypot(cx, cy, cz);
      expect(Math.hypot(n.getX(a), n.getY(a), n.getZ(a))).toBeCloseTo(1, 5);
      if (area < 1e-9) continue;
      const at = [a, b, c].map((i) => `(${p.getX(i).toFixed(3)},${(-p.getZ(i)).toFixed(3)},${p.getY(i).toFixed(3)})`).join(' ');
      expect((cx * n.getX(a) + cy * n.getY(a) + cz * n.getZ(a)) / area, at).toBeGreaterThan(0.5);
    }
  }
}

/** Vertices at the top of a corner guard (20 per guard, see the guard test above). */
const guardTops = (shell: Map<number, BufferGeometry>): number =>
  allVerts(shell).filter((v) => Math.abs(v.h - GUARD_Z[1]) < 1e-9).length;

describe('buildShell – shaped edges (SL2 E2 R3)', () => {
  it('A–E build within the triangle budget at every quality without the lean fallback', () => {
    for (const [name, make, style, o] of SHAPED_SHIPS) {
      const grid = make();
      const counts: number[] = [];
      for (const [quality, mode] of [['low', 'flight'], ['medium', 'flight'], ['high', 'flight'], ['high', 'hangar']] as const) {
        const t = shellTriangles(shapedShell(grid, style, { quality, mode, outline: o }));
        expect(`${name} ${quality} ${mode} ${t <= SHELL_MAX_TRIANGLES}`).toBe(`${name} ${quality} ${mode} true`);
        counts.push(t);
      }
      // the full profile above Low (no lean fallback)
      expect(counts[1]).toBeGreaterThan(counts[0]!);
    }
  });

  it('A–E: owners are parts of the grid, normals unit, triangles wound to face them, all finite', () => {
    for (const [, make, style, o] of SHAPED_SHIPS) {
      const grid = make();
      const ids = new Set(grid.parts.map((p) => p.id));
      for (const [quality, mode] of [['low', 'flight'], ['high', 'hangar']] as const) {
        const shell = shapedShell(grid, style, { quality, mode, outline: o });
        for (const owner of shell.keys()) expect(ids.has(owner)).toBe(true);
        checkWinding(shell);
      }
    }
  });

  it('A–E: no vertex beyond the polygon + the mitred band (stripe) except at corner guards', () => {
    for (const [name, make, style, o] of SHAPED_SHIPS) {
      const grid = make();
      const outline = hullOutline(grid, { tornFrom: null, bevelArmour: true, ...o, detail: 'render' });
      const guards = outline.corners.filter((c) => c.kind === 'guard').map((c) => c.at);
      let worst = 0;
      for (const v of allVerts(shapedShell(grid, style, { quality: 'high', mode: 'hangar', outline: o }))) {
        if (guards.some((g) => Math.hypot(v.x - g.x, v.y - g.y) <= (GUARD_ARM + GUARD_OUT) * Math.SQRT2 + 1e-6)) continue;
        worst = Math.max(worst, sticksOut(outline, v));
      }
      // the stripe, mitred at convex corners (the mitre limit: at most twice the offset)
      expect(`${name} ${worst <= 2 * STRIPE_OUT + 1e-6}`).toBe(`${name} true`);
    }
  });

  it('no spikes at acute tips: bevelled joins sharper than 60°, mitres at most twice the offset elsewhere', () => {
    const loneWing = createGrid([['cockpit', 0, 0], ['armor', 0, 1, 0, 1, 'wingL']]); // free 26.6° tip at (1.5, 0.5)
    const cases: [ShipGrid, ShellStyle, Vec2[], number][] = [
      // acute (bevelled): the free wing tip, A's nose tip (53°) and the notches beside it (26.6°)
      [loneWing, shellStyle(1, null), [{ x: 1.5, y: 0.5 }], STRIPE_OUT],
      [kosaE2(), shellStyle(1, null), [{ x: 2.5, y: 0 }, { x: 1.5, y: 0.5 }, { x: 1.5, y: -0.5 }], STRIPE_OUT],
      // the outer wing tips of B and C (63.4°): a mitre within the limit
      [mulaE2(), shellStyle(2, null), [{ x: -0.5, y: 3.5 }, { x: -0.5, y: -3.5 }], 2 * STRIPE_OUT],
      [halapartnaE2(), shellStyle(2, null), [{ x: -3.5, y: 4.5 }, { x: -3.5, y: -4.5 }], 2 * STRIPE_OUT],
    ];
    for (const [grid, style, tips, limit] of cases) {
      const outline = hullOutline(grid, { tornFrom: null, bevelArmour: true, detail: 'render' });
      const vs = allVerts(shapedShell(grid, style, { quality: 'high', mode: 'hangar' }));
      for (const tip of tips) {
        let worst = 0;
        let near = 0;
        for (const v of vs) {
          if (Math.hypot(v.x - tip.x, v.y - tip.y) > 0.1) continue;
          near++;
          worst = Math.max(worst, sticksOut(outline, v));
        }
        expect(near).toBeGreaterThan(0);
        expect(`${tip.x},${tip.y} ${worst}`).toBe(`${tip.x},${tip.y} ${Math.min(worst, limit + 1e-6)}`);
      }
    }
  });

  it('shaped runs carry the band and the lip along the slope', () => {
    // B: the port bow slope from the tractor's tip (3.5, 0.5) to (1.5, 2.5), outward normal (1, 1)/√2
    const vs = allVerts(shapedShell(mulaE2(), shellStyle(2, null)));
    const along = (v: Vec2) => (v.x - 3.5) * -Math.SQRT1_2 + (v.y - 0.5) * Math.SQRT1_2;
    const out = (v: Vec2) => (v.x - 3.5) * Math.SQRT1_2 + (v.y - 0.5) * Math.SQRT1_2;
    const mid = vs.filter((v) => along(v) > 0.5 && along(v) < 2.3);
    // the band's outer face down to the core's bottom, BAND_OUT out of the slope
    expect(mid.some((v) => Math.abs(out(v) - BAND_OUT) < 1e-6 && Math.abs(v.h - BAND_CORE_Z[0]) < 1e-6)).toBe(true);
    // the lip top, LIP_W in
    expect(mid.some((v) => Math.abs(out(v) + LIP_W) < 0.01 && v.h > LIP_Z[1] - 0.01)).toBe(true);
  });

  it('corner guards and bevels stay on the axis corners after curves (corners stay matched to runs)', () => {
    // a round corner's 12 chords before the shaved armour corner (-0.5, 1.5) and the guards
    const mixed = (): ShipGrid => createGrid([['cockpit', 0, 0], ['cargo', 1, 0], ['armor', 0, 1], ['armor', 1, 1, 0, 1, 'round']]);
    const ships: [string, () => ShipGrid, ShellStyle, Partial<OutlineOptions>][] = [['mixed', mixed, shellStyle(1, null), {}], ...SHAPED_SHIPS];
    const vs = allVerts(shapedShell(mixed(), shellStyle(1, null)));
    // the shaved corner: nothing beyond its cut (−x + y ≤ 2 − BEVEL, plus the stripe along its normal)
    for (const v of vs) expect(-v.x + v.y).toBeLessThanOrEqual(2 - BEVEL + STRIPE_OUT * Math.SQRT2 + 1e-6);
    for (const [name, make, style, o] of ships) {
      const grid = make();
      const outline = hullOutline(grid, { tornFrom: null, bevelArmour: true, ...o, detail: 'render' });
      const guards = outline.corners.filter((c) => c.kind === 'guard').map((c) => c.at);
      const shell = shapedShell(grid, style, { outline: o });
      expect(`${name} ${guardTops(shell)}`).toBe(`${name} ${guards.length * 20}`);
      // every guard at a guard corner of the outline
      const reach = (GUARD_ARM + GUARD_OUT) * Math.SQRT2 + 1e-6;
      for (const v of allVerts(shell)) {
        if (Math.abs(v.h - GUARD_Z[1]) > 1e-9) continue;
        expect(`${name} ${guards.some((g) => Math.hypot(v.x - g.x, v.y - g.y) <= reach)}`).toBe(`${name} true`);
      }
    }
  });

  it('torn cell sides of shaped parts get soot; shaped edges keep band and lip', () => {
    const before = halapartnaE2();
    const at = (x: number, y: number) => before.parts.find((p) => partCells(p).some((c) => c.x === x && c.y === y))!.id;
    const gone = [at(3, 3), at(2, 3), at(4, 1)];
    const after: ShipGrid = { parts: before.parts.filter((p) => !gone.includes(p.id)), nextId: before.nextId };
    const style = shellStyle(2, null);
    const shell = shapedShell(after, style, { outline: { tornFrom: gridCellKeys(before) } });
    checkWinding(shell);
    // the wedge at (5, 1) lost its rear neighbour (4, 1): soot on its rear leg, lip on its slope
    const uv = shell.get(at(5, 1))!.getAttribute('uv');
    const uvs = new Set<string>();
    for (let i = 0; i < uv.count; i++) uvs.add(`${uv.getX(i)},${uv.getY(i)}`);
    expect(uvs.has(uvKey(style.soot)) && uvs.has(uvKey(style.ember))).toBe(true);
    expect(uvs.has(uvKey(style.lip))).toBe(true);
    expect(shellTriangles(shell)).toBeLessThanOrEqual(SHELL_MAX_TRIANGLES);
  });

  it('enclosed shaped cuts (clockwise hole loops) build sanely', () => {
    for (const shape of ['chamfer', 'round', 'wedge'] as const) {
      const grid = createGrid([['cargo', 0, 0], ['cargo', 1, 0], ['cargo', 0, 1], ['armor', 1, 1, 2, 1, shape]]);
      for (const detail of ['sim', 'render'] as const) {
        const outline = hullOutline(grid, { tornFrom: null, bevelArmour: true, detail });
        const shell = shellOf(grid, { quality: 'high', mode: 'hangar', outline: { detail } });
        checkWinding(shell);
        let worst = 0;
        for (const v of allVerts(shell)) {
          if (Math.max(Math.abs(v.x - 0.5), Math.abs(v.y - 0.5)) > 0.6) continue; // the outer loop's guards
          worst = Math.max(worst, sticksOut(outline, v));
        }
        expect(`${shape} ${detail} ${worst <= 2 * STRIPE_OUT + 1e-6}`).toBe(`${shape} ${detail} true`);
      }
    }
  });

  it('is deterministic for shaped ships', () => {
    for (const [, make, style, o] of SHAPED_SHIPS) {
      const a = shapedShell(make(), style, { quality: 'high', mode: 'hangar', outline: o });
      const b = shapedShell(make(), style, { quality: 'high', mode: 'hangar', outline: o });
      expect(shellHash(b)).toBe(shellHash(a));
    }
  });

  it('builds C after E2 (12-chord curves) within 0.8 ms (warm, median of 50)', () => {
    const grid = halapartnaE2();
    const outline = hullOutline(grid, { tornFrom: null, bevelArmour: true, detail: 'render' });
    const input = { outline, style: shellStyle(2, null), layout: PART_LAYOUT, swatchUv: fakeSwatches, quality: 'high' as const, mode: 'flight' as const, grid };
    for (let i = 0; i < 100; i++) buildShell(input);
    // the median of 50 builds; the best of three rounds (other test files share the CPU)
    let best = Infinity;
    for (let round = 0; round < 3; round++) {
      const times: number[] = [];
      for (let i = 0; i < 50; i++) {
        const t0 = performance.now();
        buildShell(input);
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      best = Math.min(best, times[25]!);
    }
    expect(best).toBeLessThanOrEqual(0.8 * CI_SLACK);
  });
});
