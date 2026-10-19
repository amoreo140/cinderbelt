// Shape geometry of placed parts (SL2 E2 S1): polygons, footprints, clipping, ray entry, mirror table,
// solid sides and multipliers – plus the hard rule that parts without a shape stay bit-identical.
import { describe, expect, it } from 'vitest';
import { ALL_PART_KEYS, PART_IDS, parsePartKey, partDef } from '../../data/parts';
import { SHAPES, SHAPE_IDS, type ShapeId } from '../../data/shapes';
import type { Vec2 } from '../math/vec2';
import { partHullPoints } from './budget';
import { createGrid, laserPivot, partCells, partCenter, rotatedSize } from './grid';
import {
  cellPolygon,
  hpMultOf,
  massMultOf,
  mirrorShape,
  partPolygon,
  partSize,
  polygonArea,
  polygonCentroid,
  segmentPolygonEntry,
  shapeHullPoints,
  shapePolygon,
  shapeProblem,
  sideSolid,
  solidContact,
  type Poly,
} from './shape';
import { shaped } from './testing';
import type { PlacedPart, Rotation } from './types';

const ROTS: readonly Rotation[] = [0, 1, 2, 3];
const CURVED: ReadonlySet<ShapeId> = new Set(['round', 'arc', 'nose2x1']);

const armour = (x: number, y: number, rot: Rotation, shape?: ShapeId, id = 1): PlacedPart => ({
  id,
  partId: 'armor',
  tier: 1,
  x,
  y,
  rot,
  ...(shape ? { shape } : {}),
});

/** Every edge turns left (or goes straight): convex and CCW. */
const isConvexCcw = (poly: Poly): boolean =>
  poly.every((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    const c = poly[(i + 2) % poly.length]!;
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) >= -1e-12;
  });

const sortPts = (poly: Poly): Vec2[] => [...poly].sort((a, b) => a.x - b.x || a.y - b.y);

describe('shapePolygon', () => {
  it('every shape × rot × detail: convex, CCW, inside its rotated footprint, area = table', () => {
    for (const id of SHAPE_IDS) {
      const def = SHAPES[id];
      for (const rot of ROTS) {
        const { w, h } = rotatedSize(def.size, rot);
        for (const detail of ['sim', 'render'] as const) {
          const poly = shapePolygon(id, rot, detail);
          const tag = `${id} rot ${rot} ${detail}`;
          expect(isConvexCcw(poly), tag).toBe(true);
          for (const p of poly) {
            expect(Math.abs(p.x), tag).toBeLessThanOrEqual(w / 2 + 1e-9);
            expect(Math.abs(p.y), tag).toBeLessThanOrEqual(h / 2 + 1e-9);
          }
          // the r = 1 arc's 4-chord polyline is 2.5 % under the circle at sim detail
          const tol = id === 'arc' && detail === 'sim' ? 0.03 : 0.01;
          expect(Math.abs(polygonArea(poly) - def.area) / def.area, tag).toBeLessThanOrEqual(tol);
        }
      }
    }
  });

  it('render detail has more vertices than sim detail only for curved shapes', () => {
    for (const id of SHAPE_IDS) {
      const sim = shapePolygon(id, 0, 'sim').length;
      const render = shapePolygon(id, 0, 'render').length;
      if (CURVED.has(id)) expect(render, id).toBeGreaterThan(sim);
      else expect(render, id).toBe(sim);
    }
  });

  it('vertices of non-curved shapes lie on the half grid', () => {
    for (const id of SHAPE_IDS) {
      if (CURVED.has(id)) continue;
      for (const rot of ROTS) {
        for (const p of shapePolygon(id, rot)) {
          expect(Number.isInteger(p.x * 2), `${id} ${rot}`).toBe(true);
          expect(Number.isInteger(p.y * 2), `${id} ${rot}`).toBe(true);
        }
      }
    }
  });

  it('rot 0 matches the spec table; rotation is CCW (wedge slant 0 = FP, 1 = RP, 2 = RS, 3 = FS)', () => {
    expect(sortPts(shapePolygon('wedge', 0))).toEqual(sortPts([{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: -0.5, y: 0.5 }]));
    expect(sortPts(shapePolygon('nose', 0))).toEqual(sortPts([{ x: -0.5, y: -0.5 }, { x: 0.5, y: 0 }, { x: -0.5, y: 0.5 }]));
    // the missing corner of the wedge: the slant faces it
    const missing: Record<Rotation, Vec2> = { 0: { x: 0.5, y: 0.5 }, 1: { x: -0.5, y: 0.5 }, 2: { x: -0.5, y: -0.5 }, 3: { x: 0.5, y: -0.5 } };
    for (const rot of ROTS) {
      const pts = shapePolygon('wedge', rot);
      expect(pts.some((p) => p.x === missing[rot].x && p.y === missing[rot].y), `rot ${rot}`).toBe(false);
      expect(pts).toHaveLength(3);
    }
    // the half plate's solid half at rot 1 is the +x half (CCW turn of the starboard half)
    const half1 = shapePolygon('half', 1);
    expect(Math.min(...half1.map((p) => p.x))).toBe(0);
    expect(Math.max(...half1.map((p) => p.x))).toBe(0.5);
  });

  it('nose2x1: the rear cell is full, the tip is at (1, 0), the ogive is tangent-flat at its base', () => {
    const poly = shapePolygon('nose2x1', 0, 'render');
    expect(poly.some((p) => p.x === 1 && p.y === 0)).toBe(true);
    expect(poly.some((p) => p.x === -1 && p.y === -0.5)).toBe(true);
    expect(poly.some((p) => p.x === -1 && p.y === 0.5)).toBe(true);
    // the parabola y = −½(1 − s²) at s = ½: y = −0.375
    const sim = shapePolygon('nose2x1', 0, 'sim');
    const mid = sim.find((p) => Math.abs(p.x - 0.5) < 1e-9 && p.y < 0)!;
    expect(mid.y).toBeCloseTo(-0.375, 12);
  });

  it('no negative zero leaks into rotated coordinates', () => {
    for (const id of SHAPE_IDS) for (const rot of ROTS) for (const p of shapePolygon(id, rot)) {
      expect(Object.is(p.x, -0), `${id} ${rot}`).toBe(false);
      expect(Object.is(p.y, -0), `${id} ${rot}`).toBe(false);
    }
  });
});

describe('polygonArea / polygonCentroid', () => {
  it('unit square and a wedge', () => {
    const sq = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    expect(polygonArea(sq)).toBe(1);
    expect(polygonCentroid(sq)).toEqual({ x: 0.5, y: 0.5 });
    const c = polygonCentroid(shapePolygon('wedge', 0));
    expect(c.x).toBeCloseTo(-1 / 6, 12);
    expect(c.y).toBeCloseTo(-1 / 6, 12);
  });
});

describe('footprints', () => {
  it('partSize: the shape size when present, else the part size', () => {
    expect(partSize({ partId: 'armor', tier: 1 })).toEqual({ w: 1, h: 1 });
    expect(partSize({ partId: 'armor', tier: 1, shape: 'wedge' })).toEqual({ w: 1, h: 1 });
    expect(partSize({ partId: 'armor', tier: 2, shape: 'wingL' })).toEqual({ w: 2, h: 1 });
    expect(partSize({ partId: 'armor', tier: 1, shape: 'wingR' })).toEqual({ w: 2, h: 1 });
    expect(partSize({ partId: 'armor', tier: 1, shape: 'nose2x1' })).toEqual({ w: 2, h: 1 });
  });

  it('partCells and partCenter of a wing at each rotation', () => {
    const cells: Record<Rotation, Vec2[]> = {
      0: [{ x: 3, y: 1 }, { x: 4, y: 1 }],
      1: [{ x: 3, y: 1 }, { x: 3, y: 2 }],
      2: [{ x: 3, y: 1 }, { x: 4, y: 1 }],
      3: [{ x: 3, y: 1 }, { x: 3, y: 2 }],
    };
    for (const rot of ROTS) {
      for (const shape of ['wingL', 'wingR', 'nose2x1'] as const) {
        const p = armour(3, 1, rot, shape);
        expect(partCells(p), `${shape} ${rot}`).toEqual(cells[rot]);
        expect(partCenter(p), `${shape} ${rot}`).toEqual(rot % 2 === 0 ? { x: 3.5, y: 1 } : { x: 3, y: 1.5 });
      }
    }
    expect(partCells(armour(3, 1, 2, 'wedge'))).toEqual([{ x: 3, y: 1 }]);
  });

  it('unshaped partCells / partCenter / laserPivot / rotatedSize are identical to before for every part × rot', () => {
    // the pre-E2 implementation, inlined as the reference
    const refSize = (p: PlacedPart): { w: number; h: number } => partDef(p.partId, p.tier, p.variant).size;
    const refRotated = (s: { w: number; h: number }, rot: Rotation) => (rot % 2 === 0 ? { w: s.w, h: s.h } : { w: s.h, h: s.w });
    const refCells = (p: PlacedPart): Vec2[] => {
      const { w, h } = refRotated(refSize(p), p.rot);
      const out: Vec2[] = [];
      for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) out.push({ x: p.x + dx, y: p.y + dy });
      return out;
    };
    const refCenter = (p: PlacedPart): Vec2 => {
      const { w, h } = refRotated(refSize(p), p.rot);
      return { x: p.x + (w - 1) / 2, y: p.y + (h - 1) / 2 };
    };
    const refPivot = (p: PlacedPart): Vec2 => {
      const length = refSize(p).w;
      const c = refCenter(p);
      const f = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }][p.rot]!;
      return { x: c.x + (f.x * (length - 1)) / 2, y: c.y + (f.y * (length - 1)) / 2 };
    };
    for (const key of ALL_PART_KEYS) {
      const { partId, tier, variant } = parsePartKey(key);
      for (const rot of ROTS) {
        const p: PlacedPart = { id: 1, partId, tier, x: -2, y: 3, rot, ...(variant ? { variant } : {}) };
        expect(partCells(p), key).toStrictEqual(refCells(p));
        expect(partCenter(p), key).toStrictEqual(refCenter(p));
        expect(laserPivot(p), key).toStrictEqual(refPivot(p));
        expect(rotatedSize(partSize(p), rot), key).toStrictEqual(refRotated(refSize(p), rot));
      }
    }
  });
});

describe('partPolygon / cellPolygon', () => {
  it('parts without a shape: null (the fast path)', () => {
    const g = createGrid(PART_IDS.map((partId, i) => [partId, i * 3, 0] as const));
    for (const p of g.parts) {
      expect(partPolygon(p)).toBeNull();
      expect(cellPolygon(p, { x: p.x, y: p.y })).toBeNull();
    }
  });

  it('partPolygon is the shape polygon moved to the part centre', () => {
    for (const id of SHAPE_IDS) for (const rot of ROTS) {
      const p = armour(2, -3, rot, id);
      const c = partCenter(p);
      const expected = shapePolygon(id, rot).map((v) => ({ x: v.x + c.x, y: v.y + c.y }));
      expect(partPolygon(p), `${id} ${rot}`).toEqual(expected);
    }
  });

  it('cellPolygon of each wing cell at rot 0', () => {
    const l = armour(0, 0, 0, 'wingL'); // cells (0,0) and (1,0), centre (0.5, 0)
    const rearL = cellPolygon(l, { x: 0, y: 0 })!;
    expect(polygonArea(rearL)).toBeCloseTo(0.75, 12);
    expect(sortPts(rearL)).toEqual(sortPts([{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0 }, { x: -0.5, y: 0.5 }]));
    const frontL = cellPolygon(l, { x: 1, y: 0 })!;
    expect(polygonArea(frontL)).toBeCloseTo(0.25, 12);
    expect(sortPts(frontL)).toEqual(sortPts([{ x: 0.5, y: -0.5 }, { x: 1.5, y: -0.5 }, { x: 0.5, y: 0 }]));

    const r = armour(0, 0, 0, 'wingR');
    expect(sortPts(cellPolygon(r, { x: 0, y: 0 })!)).toEqual(
      sortPts([{ x: -0.5, y: -0.5 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }]),
    );
    expect(sortPts(cellPolygon(r, { x: 1, y: 0 })!)).toEqual(sortPts([{ x: 0.5, y: 0 }, { x: 1.5, y: 0.5 }, { x: 0.5, y: 0.5 }]));
  });

  it('cell polygons of every shape × rot: inside their cell, convex, CCW, summing to the part polygon', () => {
    for (const id of SHAPE_IDS) for (const rot of ROTS) {
      const p = armour(1, 2, rot, id);
      let sum = 0;
      for (const cell of partCells(p)) {
        const poly = cellPolygon(p, cell);
        if (poly === null) {
          sum += 1;
          continue;
        }
        expect(isConvexCcw(poly), `${id} ${rot}`).toBe(true);
        for (const v of poly) {
          expect(Math.abs(v.x - cell.x)).toBeLessThanOrEqual(0.5 + 1e-9);
          expect(Math.abs(v.y - cell.y)).toBeLessThanOrEqual(0.5 + 1e-9);
        }
        sum += polygonArea(poly);
      }
      expect(sum, `${id} ${rot}`).toBeCloseTo(polygonArea(partPolygon(p)!), 9);
    }
  });

  it('a full cell of a shaped part (nose2x1 rear) is null; cells outside the part are empty', () => {
    const p = armour(0, 0, 0, 'nose2x1');
    expect(cellPolygon(p, { x: 0, y: 0 })).toBeNull();
    expect(cellPolygon(p, { x: 1, y: 0 })).not.toBeNull();
    expect(cellPolygon(armour(0, 0, 0, 'wedge'), { x: 5, y: 5 })).toEqual([]);
  });
});

describe('segmentPolygonEntry', () => {
  const sq: Poly = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const wedge: Poly = [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: -0.5, y: 0.5 }];

  it('a straight hit enters at the edge', () => {
    expect(segmentPolygonEntry({ x: -1, y: 0.5 }, { x: 1, y: 0.5 }, sq)).toBeCloseTo(0.5, 12);
    expect(segmentPolygonEntry({ x: 2, y: 0.5 }, { x: 0, y: 0.5 }, sq)).toBeCloseTo(0.5, 12);
  });

  it('misses and short segments are null', () => {
    expect(segmentPolygonEntry({ x: -1, y: 2 }, { x: 2, y: 2 }, sq)).toBeNull();
    expect(segmentPolygonEntry({ x: -2, y: 0.5 }, { x: -0.5, y: 0.5 }, sq)).toBeNull();
    expect(segmentPolygonEntry({ x: 2, y: 0.5 }, { x: 3, y: 0.5 }, sq)).toBeNull();
    expect(segmentPolygonEntry({ x: -1, y: 0.5 }, { x: -1, y: 0.5 }, sq)).toBeNull();
  });

  it('a start inside (or on the boundary) is 0', () => {
    expect(segmentPolygonEntry({ x: 0.5, y: 0.5 }, { x: 3, y: 0.5 }, sq)).toBe(0);
    expect(segmentPolygonEntry({ x: 0, y: 0.5 }, { x: -3, y: 0.5 }, sq)).toBe(0);
    expect(segmentPolygonEntry({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, sq)).toBe(0);
  });

  it('the boundary is solid: grazing an edge and touching a vertex count as hits', () => {
    // along the top edge
    expect(segmentPolygonEntry({ x: -1, y: 1 }, { x: 2, y: 1 }, sq)).toBeCloseTo(1 / 3, 12);
    // through the corner (1, 1) only
    expect(segmentPolygonEntry({ x: 2, y: 0 }, { x: 0, y: 2 }, sq)).toBeCloseTo(0.5, 12);
    // a segment ending exactly on the edge
    expect(segmentPolygonEntry({ x: -1, y: 0.5 }, { x: 0, y: 0.5 }, sq)).toBe(1);
  });

  it('the empty half of a wedge lets a shot through; the hypotenuse stops it on the edge', () => {
    // parallel to the hypotenuse, through the empty half
    expect(segmentPolygonEntry({ x: 0.3, y: 1 }, { x: 1, y: 0.3 }, wedge)).toBeNull();
    // straight down through the empty corner and into the solid part: entry at the hypotenuse y = −x
    const t = segmentPolygonEntry({ x: 0.25, y: 1 }, { x: 0.25, y: -1 }, wedge)!;
    expect(1 - 2 * t).toBeCloseTo(-0.25, 12);
    // diagonal along the hypotenuse (grazing a whole edge)
    expect(segmentPolygonEntry({ x: 1, y: -1 }, { x: -1, y: 1 }, wedge)).toBeCloseTo(0.25, 12);
  });
});

describe('mirrorShape (derived from the polygons)', () => {
  const swap = (pairs: [number, number][]): Record<Rotation, Rotation> => {
    const out = {} as Record<Rotation, Rotation>;
    for (const [a, b] of pairs) {
      out[a as Rotation] = b as Rotation;
      out[b as Rotation] = a as Rotation;
    }
    return out;
  };
  const corner = swap([[0, 3], [1, 2]]);
  const nose = swap([[0, 0], [1, 3], [2, 2]]);
  const half = swap([[0, 2], [1, 1], [3, 3]]);

  it('matches the spec §2.11 table', () => {
    for (const rot of ROTS) {
      for (const id of ['wedge', 'chamfer', 'round', 'arc'] as const) expect(mirrorShape(id, rot), `${id} ${rot}`).toEqual({ shape: id, rot: corner[rot] });
      for (const id of ['nose', 'nose2x1'] as const) expect(mirrorShape(id, rot), `${id} ${rot}`).toEqual({ shape: id, rot: nose[rot] });
      expect(mirrorShape('half', rot)).toEqual({ shape: 'half', rot: half[rot] });
      const neg = ((4 - rot) % 4) as Rotation;
      expect(mirrorShape('wingL', rot)).toEqual({ shape: 'wingR', rot: neg });
      expect(mirrorShape('wingR', rot)).toEqual({ shape: 'wingL', rot: neg });
    }
  });

  it('mirroring twice is the identity', () => {
    for (const id of SHAPE_IDS) for (const rot of ROTS) {
      const m = mirrorShape(id, rot);
      expect(mirrorShape(m.shape, m.rot), `${id} ${rot}`).toEqual({ shape: id, rot });
    }
  });
});

describe('sideSolid / solidContact', () => {
  it('full parts: every side solid; contact = shared cell sides', () => {
    const a = armour(0, 0, 0);
    for (const side of [0, 1, 2, 3] as const) expect(sideSolid(a, { x: 0, y: 0 }, side)).toEqual([0, 1]);
    // largeCargo 2×2 at (0,0)–(1,1); engine at (2,0)–: one side; armour column (2,0),(2,1) via two parts
    const g = createGrid([['largeCargo', 0, 0], ['engine', 2, 0], ['armor', 2, 1], ['heavyLaser', 0, 2]]);
    expect(solidContact(g.parts[0]!, g.parts[1]!)).toBe(1);
    expect(solidContact(g.parts[0]!, g.parts[2]!)).toBe(1);
    expect(solidContact(g.parts[0]!, g.parts[3]!)).toBe(2);
    expect(solidContact(g.parts[1]!, g.parts[3]!)).toBe(0);
  });

  it('wedge rot 0: legs (−x, −y) solid, hypotenuse sides (+x, +y) open', () => {
    const w = armour(0, 0, 0, 'wedge');
    const c = { x: 0, y: 0 };
    expect(sideSolid(w, c, 0)).toBeNull();
    expect(sideSolid(w, c, 1)).toBeNull();
    expect(sideSolid(w, c, 2)).toEqual([0, 1]);
    expect(sideSolid(w, c, 3)).toEqual([0, 1]);
  });

  it('half plate rot 0: the open (+y) side has nothing, the ends are half solid', () => {
    const h = armour(0, 0, 0, 'half');
    const c = { x: 0, y: 0 };
    expect(sideSolid(h, c, 1)).toBeNull();
    expect(sideSolid(h, c, 3)).toEqual([0, 1]);
    expect(sideSolid(h, c, 0)).toEqual([0, 0.5]);
    expect(sideSolid(h, c, 2)).toEqual([0, 0.5]);
  });

  it('round and chamfer: the cut corner shortens two sides to ½', () => {
    for (const id of ['round', 'chamfer'] as const) {
      const p = armour(0, 0, 0, id);
      expect(sideSolid(p, { x: 0, y: 0 }, 0), id).toEqual([0, 0.5]);
      expect(sideSolid(p, { x: 0, y: 0 }, 1), id).toEqual([0, 0.5]);
      expect(sideSolid(p, { x: 0, y: 0 }, 2), id).toEqual([0, 1]);
    }
  });

  it('wedge touching by its hypotenuse side → 0, by a leg → 1', () => {
    const full = armour(1, 0, 0, undefined, 2); // +x neighbour
    expect(solidContact(armour(0, 0, 0, 'wedge'), full)).toBe(0);
    expect(solidContact(full, armour(0, 0, 0, 'wedge'))).toBe(0);
    expect(solidContact(armour(0, 0, 2, 'wedge'), full)).toBe(1);
    // two wedges back to back along their legs
    expect(solidContact(armour(0, 0, 2, 'wedge'), armour(1, 0, 0, 'wedge', 2))).toBe(1);
  });

  it('half plate: open side → 0, end side → ½', () => {
    expect(solidContact(armour(0, 0, 0, 'half'), armour(0, 1, 0, undefined, 2))).toBe(0);
    expect(solidContact(armour(0, 0, 0, 'half'), armour(1, 0, 0, undefined, 2))).toBe(0.5);
    // two half plates end to end: their solid halves overlap fully
    expect(solidContact(armour(0, 0, 0, 'half'), armour(1, 0, 0, 'half', 2))).toBe(0.5);
    // a starboard half next to a port half: the solid halves do not overlap
    expect(solidContact(armour(0, 0, 0, 'half'), armour(1, 0, 2, 'half', 2))).toBe(0);
  });

  it('wing: along its long leg the contact is 2', () => {
    const wing = armour(0, 1, 0, 'wingL'); // long leg on the −y edge (y = ½)
    const below = createGrid([['armor', 0, 0], ['armor', 1, 0]]).parts;
    expect(solidContact(wing, below[0]!) + solidContact(wing, below[1]!)).toBe(2);
    const above = armour(0, 2, 0, undefined, 9);
    expect(solidContact(wing, above)).toBe(0);
  });
});

describe('multipliers and points', () => {
  it('shaped parts use the table; unshaped parts are 1 and their size points', () => {
    for (const id of SHAPE_IDS) {
      const p = armour(0, 0, 0, id);
      expect(hpMultOf(p)).toBe(SHAPES[id].area);
      expect(massMultOf(p)).toBe(SHAPES[id].area);
      expect(shapeHullPoints(p)).toBe(SHAPES[id].points);
    }
    const g = createGrid(PART_IDS.map((partId, i) => [partId, i * 3, 0] as const));
    for (const p of g.parts) {
      expect(hpMultOf(p)).toBe(1);
      expect(massMultOf(p)).toBe(1);
      expect(shapeHullPoints(p)).toBe(partHullPoints(p));
    }
  });
});

describe('shapeProblem', () => {
  it('no shape is always fine', () => {
    for (const partId of PART_IDS) expect(shapeProblem({ partId })).toBeNull();
  });
  it('only armour may have a shape, and only a known one', () => {
    expect(shapeProblem({ partId: 'armor', shape: 'wedge' })).toBeNull();
    expect(shapeProblem({ partId: 'armor', shape: 'nose2x1' })).toBeNull();
    expect(shapeProblem({ partId: 'engine', shape: 'wedge' })).toBe('shapeNotAllowed');
    expect(shapeProblem({ partId: 'cockpit', shape: 'half' })).toBe('shapeNotAllowed');
    expect(shapeProblem({ partId: 'armor', shape: 'blob' as never })).toBe('unknownShape');
    expect(shapeProblem({ partId: 'engine', shape: 'blob' as never })).toBe('unknownShape');
  });
});

describe('createGrid and the shaped() helper', () => {
  it('createGrid takes an optional 6th shape; unshaped parts carry no shape key', () => {
    const g = createGrid([['cockpit', 0, 0], ['armor', 1, 0, 0, 1, 'wedge'], ['armor', 2, 0, 1, 2, 'wingL']]);
    expect(Object.keys(g.parts[0]!)).not.toContain('shape');
    expect(g.parts[1]).toEqual({ id: 2, partId: 'armor', tier: 1, x: 1, y: 0, rot: 0, shape: 'wedge' });
    expect(g.parts[2]!.shape).toBe('wingL');
    expect(partCells(g.parts[2]!)).toEqual([{ x: 2, y: 0 }, { x: 2, y: 1 }]);
  });

  it('shaped() returns a new grid with one part reshaped (null clears)', () => {
    const g = createGrid([['cockpit', 0, 0], ['armor', 1, 0]]);
    const s = shaped(g, 2, 'chamfer');
    expect(s).not.toBe(g);
    expect(g.parts[1]!.shape).toBeUndefined();
    expect(s.parts[1]!.shape).toBe('chamfer');
    expect(s.parts[0]).toBe(g.parts[0]);
    const back = shaped(s, 2, null);
    expect(Object.keys(back.parts[1]!)).not.toContain('shape');
    expect(() => shaped(g, 99, 'wedge')).toThrow();
  });
});
