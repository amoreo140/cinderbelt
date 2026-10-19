// Shape catalogue (SL2 E2, ship-building 2 design §2.2): the table constants match the
// outlines, the points rule holds, codes are unique and the Tab order is fixed.
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../sim/math/vec2';
import {
  CURVE_SEGMENTS_RENDER,
  CURVE_SEGMENTS_SIM,
  SHAPEABLE_PARTS,
  SHAPE_IDS,
  SHAPES,
  isShapeId,
  shapeOfCode,
  type ShapeDef,
} from './shapes';

/**
 * Independent outline expansion for the data test (the game's own lives in sim/ship/shape.ts, S1):
 * arcs CCW around their centre, ogives parabolic from the base (the end farther from y = 0) to the tip.
 */
function outline(def: ShapeDef, detail: { quarter: number; ogive: number }): Vec2[] {
  const pts: Vec2[] = [def.start];
  let at = def.start;
  for (const seg of def.segs) {
    if (seg.kind === 'arc') {
      const r = Math.hypot(at.x - seg.centre.x, at.y - seg.centre.y);
      const a0 = Math.atan2(at.y - seg.centre.y, at.x - seg.centre.x);
      let a1 = Math.atan2(seg.to.y - seg.centre.y, seg.to.x - seg.centre.x);
      while (a1 <= a0) a1 += 2 * Math.PI;
      const n = Math.max(1, Math.ceil(((a1 - a0) / (Math.PI / 2)) * detail.quarter - 1e-9));
      for (let i = 1; i < n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        pts.push({ x: seg.centre.x + r * Math.cos(a), y: seg.centre.y + r * Math.sin(a) });
      }
    } else if (seg.kind === 'ogive') {
      const fromBase = Math.abs(at.y) >= Math.abs(seg.to.y);
      const base = fromBase ? at : seg.to;
      const tip = fromBase ? seg.to : at;
      const n = detail.ogive;
      for (let i = 1; i < n; i++) {
        const s = fromBase ? i / n : 1 - i / n;
        pts.push({ x: base.x + (tip.x - base.x) * s, y: tip.y + (base.y - tip.y) * (1 - s * s) });
      }
    }
    pts.push(seg.to);
    at = seg.to;
  }
  pts.pop(); // the last segment closes back to `start`
  return pts;
}

const shoelace = (poly: readonly Vec2[]): number =>
  poly.reduce((s, p, i) => {
    const q = poly[(i + 1) % poly.length]!;
    return s + p.x * q.y - q.x * p.y;
  }, 0) / 2;

describe('shape catalogue', () => {
  it('SHAPE_IDS is the Tab cycle order and covers every shape once', () => {
    expect(SHAPE_IDS).toEqual(['wedge', 'chamfer', 'round', 'arc', 'half', 'nose', 'wingL', 'wingR', 'nose2x1']);
    expect(Object.keys(SHAPES).sort()).toEqual([...SHAPE_IDS].sort());
    for (const id of SHAPE_IDS) expect(SHAPES[id].id).toBe(id);
  });

  it('area table matches spec §2.2', () => {
    const areas = SHAPE_IDS.map((id) => SHAPES[id].area);
    expect(areas).toEqual([0.5, 0.875, 0.946, 0.785, 0.5, 0.5, 1.0, 1.0, 1.67]);
  });

  it('every outline is closed, CCW and inside its footprint', () => {
    for (const id of SHAPE_IDS) {
      const def = SHAPES[id];
      expect(def.segs.at(-1)!.to, id).toEqual(def.start);
      const poly = outline(def, CURVE_SEGMENTS_RENDER);
      expect(shoelace(poly), id).toBeGreaterThan(0);
      for (const p of poly) {
        expect(Math.abs(p.x), `${id} x`).toBeLessThanOrEqual(def.size.w / 2 + 1e-9);
        expect(Math.abs(p.y), `${id} y`).toBeLessThanOrEqual(def.size.h / 2 + 1e-9);
      }
    }
  });

  it('straight-edge vertices lie on the half grid', () => {
    for (const id of SHAPE_IDS) {
      const def = SHAPES[id];
      for (const v of [def.start, ...def.segs.map((s) => s.to)]) {
        expect(Number.isInteger(v.x * 2) && Number.isInteger(v.y * 2), `${id} ${v.x},${v.y}`).toBe(true);
      }
    }
  });

  it('area = the render polygon area ±1 %', () => {
    for (const id of SHAPE_IDS) {
      const a = shoelace(outline(SHAPES[id], CURVE_SEGMENTS_RENDER));
      expect(Math.abs(a - SHAPES[id].area) / SHAPES[id].area, `${id}: ${a}`).toBeLessThanOrEqual(0.01);
    }
  });

  it('area = the simulation polygon area ±1 %, except the coarse r = 1 arc (±3 %)', () => {
    // 4 chords per quarter circle cut 2.5 % off the r = 1 arc (sagitta 0.019 u, plan §8 question 7)
    for (const id of SHAPE_IDS) {
      const a = shoelace(outline(SHAPES[id], CURVE_SEGMENTS_SIM));
      const tolerance = id === 'arc' ? 0.03 : 0.01;
      expect(Math.abs(a - SHAPES[id].area) / SHAPES[id].area, `${id}: ${a}`).toBeLessThanOrEqual(tolerance);
    }
  });

  it('points = area rounded to ½, at least ½', () => {
    for (const id of SHAPE_IDS) {
      const { area, points } = SHAPES[id];
      expect(points, id).toBe(Math.max(0.5, Math.round(area * 2) / 2));
    }
    expect(SHAPE_IDS.map((id) => SHAPES[id].points)).toEqual([0.5, 1, 1, 1, 0.5, 0.5, 1, 1, 1.5]);
  });

  it('sizes: wings and nose 2×1, the rest 1×1', () => {
    const wide = SHAPE_IDS.filter((id) => SHAPES[id].size.w === 2);
    expect(wide).toEqual(['wingL', 'wingR', 'nose2x1']);
    for (const id of SHAPE_IDS) expect(SHAPES[id].size.h).toBe(1);
  });

  it('AF2 codes are unique and map back', () => {
    const codes = SHAPE_IDS.map((id) => SHAPES[id].code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual(['w', 'c', 'r', 'a', 'h', 'n', 'wl', 'wr', 'n2']);
    for (const id of SHAPE_IDS) expect(shapeOfCode(SHAPES[id].code)).toBe(id);
    expect(shapeOfCode('x')).toBeNull();
    expect(shapeOfCode('toString')).toBeNull();
    expect(shapeOfCode('')).toBeNull();
  });

  it('isShapeId accepts exactly the shape ids', () => {
    for (const id of SHAPE_IDS) expect(isShapeId(id)).toBe(true);
    for (const v of ['w', 'full', 'toString', '__proto__', '', 1, null, undefined, {}]) expect(isShapeId(v)).toBe(false);
  });

  it('only armour is shapeable', () => {
    expect([...SHAPEABLE_PARTS]).toEqual(['armor']);
  });
});
