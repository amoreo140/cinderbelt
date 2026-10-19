// SL2 E2 R2: shaped plate geometry (shapePlate.ts) – every shape × rot × tier stays inside its polygon,
// keeps the triangle budget, takes its colours from the expected swatches, carries the part layout,
// is wound outward, closed from above, and cached.
import { BufferGeometry, DoubleSide, Mesh, MeshStandardMaterial, Object3D, Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { SHAPES, SHAPE_IDS, type ShapeId } from '../../data/shapes';
import type { Vec2 } from '../../sim/math/vec2';
import { shapePolygon, type Poly } from '../../sim/ship/shape';
import type { Rotation } from '../../sim/ship/types';
import { batchKey } from '../shipBatch';
import { CHEVRON_Z, DECK_TOP, PLATE_CHEVRON_MIN_AREA, PLATE_CORE_Z, PLATE_MAX_TRIANGLES, PLATE_TOP_IN } from './shellConstants';
import { PART_LAYOUT, shellLayoutOf, type ShellLayout, type ShellTier, type SwatchLookup } from './shellGeometry';
import { plateStyle, shapePlateGeometry, type PlateStyle } from './shapePlate';

// --- helpers -------------------------------------------------------------------------------------------

/** A fake swatch table: every key gets its own cell centre of an 8 × 32 atlas (deterministic). */
const COLS = 8;
const ROWS = 32;
function fakeTable(): SwatchLookup {
  const keys = new Map<string, readonly [number, number]>();
  return (key) => {
    let uv = keys.get(key);
    if (!uv) {
      const i = keys.size;
      uv = [((i % COLS) + 0.5) / COLS, (Math.floor(i / COLS) + 0.5) / ROWS];
      keys.set(key, uv);
    }
    return uv;
  };
}
const swatches = fakeTable();

const ROTS: readonly Rotation[] = [0, 1, 2, 3];
const TIERS: readonly ShellTier[] = [1, 2, 3];
const QUARTER = Math.PI / 2;

/** Vertices of a plate placed like ShipView places part nodes (rotation.y = rot · 90°), in the grid frame. */
function placedVertices(g: BufferGeometry, rot: Rotation): { x: number; y: number; h: number }[] {
  const node = new Object3D();
  node.rotation.y = rot * QUARTER;
  node.updateMatrixWorld(true);
  const pos = g.getAttribute('position');
  const v = new Vector3();
  const out: { x: number; y: number; h: number }[] = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(node.matrixWorld);
    out.push({ x: v.x, y: -v.z, h: v.y });
  }
  return out;
}

/** Signed distance of a point inside a convex CCW polygon to its boundary (negative = outside). */
function insideDistance(p: Vec2, poly: Poly): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-12) continue;
    // left of a→b is inside for a CCW polygon
    d = Math.min(d, (ex * (p.y - a.y) - ey * (p.x - a.x)) / len);
  }
  return d;
}

function triangles(g: BufferGeometry): number {
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}

const sameUv = (a: readonly [number, number], u: number, v: number): boolean => Math.abs(a[0] - u) < 1e-6 && Math.abs(a[1] - v) < 1e-6;

// --- tests ---------------------------------------------------------------------------------------------

describe('plateStyle', () => {
  it('takes the player armour swatches of the part tier (armor.py, palette TIERS)', () => {
    expect(plateStyle(1, null)).toEqual({
      core: 'hull_dark',
      plate: 'hull_light',
      pad: 'hull_white',
      groove: 'panel_line',
      accent: 'accent_iron',
      glow: null,
      tier: 1,
    });
    expect(plateStyle(2, null).plate).toBe('hull_ti');
    expect(plateStyle(2, null).accent).toBe('accent_titanium');
    expect(plateStyle(2, null).glow).toBe('tier_glow_ti');
    expect(plateStyle(3, null).core).toBe('hull_dark_cr');
    expect(plateStyle(3, null).glow).toBe('tier_glow_cr');
  });
  it('clans take their shell swatches (E4 only passes the clan)', () => {
    const sst = plateStyle(1, 'slantedStar');
    expect(sst.core).toBe('sst_lacquer');
    expect(sst.accent).toBe('sst_gold_dark');
    // a faction without a clan style flies player parts
    expect(plateStyle(1, 'guild')).toEqual(plateStyle(1, null));
  });
});

describe('shapePlateGeometry', () => {
  for (const shape of SHAPE_IDS) {
    for (const tier of TIERS) {
      it(`${shape} T${tier}: inside the polygon at every rotation, within the budget and the deck profile`, () => {
        const style = plateStyle(tier, null);
        for (const rot of ROTS) {
          const g = shapePlateGeometry(shape, style, PART_LAYOUT, swatches, rot);
          expect(triangles(g)).toBeLessThanOrEqual(PLATE_MAX_TRIANGLES);
          const poly = shapePolygon(shape, rot, 'render');
          for (const v of placedVertices(g, rot)) {
            expect(insideDistance(v, poly)).toBeGreaterThan(-0.012 - 1e-6);
            expect(v.h).toBeGreaterThanOrEqual(PLATE_CORE_Z[0] - 1e-6);
            expect(v.h).toBeLessThanOrEqual(CHEVRON_Z[1] + 1e-6);
          }
        }
      });
    }
  }

  it('has the recorded triangle counts (walls on the 12-segment render polygon, pad on 3 chords per curve, 2 on the 2×1 nose)', () => {
    const counts = (tier: ShellTier): Record<string, number> =>
      Object.fromEntries(SHAPE_IDS.map((s) => [s, Math.max(...ROTS.map((rot) => triangles(shapePlateGeometry(s, plateStyle(tier, null), PART_LAYOUT, swatches, rot))))]));
    // T1: one chevron (16) on the large plates; T2: + the seam strip (2) and a second chevron (16); T3: + the seam
    expect(counts(1)).toEqual({ wedge: 26, chamfer: 62, round: 127, arc: 107, half: 36, nose: 26, wingL: 42, wingR: 42, nose2x1: 182 });
    expect(counts(2)).toEqual({ wedge: 28, chamfer: 80, round: 145, arc: 125, half: 38, nose: 28, wingL: 60, wingR: 60, nose2x1: 200 });
    expect(counts(3)).toEqual({ wedge: 28, chamfer: 64, round: 129, arc: 109, half: 38, nose: 28, wingL: 44, wingR: 44, nose2x1: 184 });
  });

  it('the chevrons point to the bow at every rotation (pointed front, open back)', () => {
    for (const shape of SHAPE_IDS.filter((s) => SHAPES[s].area >= PLATE_CHEVRON_MIN_AREA)) {
      for (const tier of TIERS) {
        const style = plateStyle(tier, null);
        const accent = swatches(style.accent)!;
        for (const rot of ROTS) {
          const g = shapePlateGeometry(shape, style, PART_LAYOUT, swatches, rot);
          const uv = g.getAttribute('uv');
          const tops = placedVertices(g, rot).filter((v, i) => sameUv(accent, uv.getX(i), uv.getY(i)) && Math.abs(v.h - CHEVRON_Z[1]) < 1e-6);
          expect(tops.length, `${shape} T${tier} rot ${rot}`).toBeGreaterThan(0);
          const ys = tops.map((v) => v.y);
          const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
          const maxX = Math.max(...tops.map((v) => v.x));
          const minX = Math.min(...tops.map((v) => v.x));
          // the bow-most points are the tip on the axis, the aft-most points the two open back corners
          for (const v of tops.filter((q) => q.x > maxX - 1e-6)) expect(Math.abs(v.y - midY), `${shape} T${tier} rot ${rot} tip`).toBeLessThan(1e-6);
          for (const v of tops.filter((q) => q.x < minX + 1e-6)) expect(Math.abs(v.y - midY), `${shape} T${tier} rot ${rot} back`).toBeGreaterThan(0.05);
        }
      }
    }
  });

  it('T2 / T3 plates carry tier detail: a glowing seam along the bow axis, a double (T2) or one bold (T3) chevron', () => {
    const chevronTops = (g: BufferGeometry, accent: readonly [number, number]): number => {
      const uv = g.getAttribute('uv');
      const pos = g.getAttribute('position');
      const seen = new Set<string>();
      for (let i = 0; i < pos.count; i++) {
        if (sameUv(accent, uv.getX(i), uv.getY(i)) && Math.abs(pos.getY(i) - CHEVRON_Z[1]) < 1e-6) seen.add(`${pos.getX(i).toFixed(6)},${pos.getZ(i).toFixed(6)}`);
      }
      return seen.size;
    };
    const span = (g: BufferGeometry, key: readonly [number, number], rot: Rotation): { x: number; y: number } | null => {
      const uv = g.getAttribute('uv');
      const vs = placedVertices(g, rot).filter((_, i) => sameUv(key, uv.getX(i), uv.getY(i)));
      if (vs.length === 0) return null;
      return { x: Math.max(...vs.map((v) => v.x)) - Math.min(...vs.map((v) => v.x)), y: Math.max(...vs.map((v) => v.y)) - Math.min(...vs.map((v) => v.y)) };
    };
    for (const shape of SHAPE_IDS) {
      const big = SHAPES[shape].area >= PLATE_CHEVRON_MIN_AREA;
      for (const rot of ROTS) {
        const t1 = plateStyle(1, null);
        const g1 = shapePlateGeometry(shape, t1, PART_LAYOUT, swatches, rot);
        expect(chevronTops(g1, swatches(t1.accent)!)).toBe(big ? 6 : 0);
        for (const tier of [2, 3] as const) {
          const style = plateStyle(tier, null);
          const g = shapePlateGeometry(shape, style, PART_LAYOUT, swatches, rot);
          // the seam: a glowing strip along the bow axis (longer than wide once placed)
          const seam = span(g, swatches(style.glow!)!, rot);
          expect(seam, `${shape} T${tier} rot ${rot}`).not.toBeNull();
          expect(seam!.x).toBeGreaterThan(seam!.y);
          expect(seam!.y).toBeLessThan(0.03);
          if (big) expect(chevronTops(g, swatches(style.accent)!), `${shape} T${tier} rot ${rot}`).toBe(tier === 2 ? 12 : 6);
        }
        if (big) {
          // the bold T3 chevron is wider than the T1 one
          const w1 = span(g1, swatches(t1.accent)!, rot)!;
          const t3 = plateStyle(3, null);
          const w3 = span(shapePlateGeometry(shape, t3, PART_LAYOUT, swatches, rot), swatches(t3.accent)!, rot)!;
          expect(w3.y).toBeGreaterThan(w1.y * 1.2);
        }
      }
    }
  });

  it('every UV is a swatch centre of the style; core below the plate, the chevron only on large plates', () => {
    for (const shape of SHAPE_IDS) {
      for (const clan of [null, 'rust'] as const) {
        const style = plateStyle(2, clan);
        const g = shapePlateGeometry(shape, style, PART_LAYOUT, swatches);
        const uv = g.getAttribute('uv');
        const pos = g.getAttribute('position');
        const keys = [style.core, style.plate, style.pad, style.groove, style.accent, style.glow].filter((k): k is string => k !== null);
        const allowed = keys.map((k) => swatches(k)!);
        const core = swatches(style.core)!;
        const accent = swatches(style.accent)!;
        let accentSeen = false;
        for (let i = 0; i < uv.count; i++) {
          const u = uv.getX(i);
          const v = uv.getY(i);
          expect(allowed.some((a) => sameUv(a, u, v))).toBe(true);
          if (pos.getY(i) < PLATE_CORE_Z[1] - 1e-6) expect(sameUv(core, u, v)).toBe(true);
          if (sameUv(accent, u, v) && style.accent !== style.plate && style.accent !== style.core) accentSeen = true;
        }
        expect(accentSeen).toBe(SHAPES[shape].area >= PLATE_CHEVRON_MIN_AREA);
      }
    }
  });

  it('the flat plate top lies at DECK_TOP and is plate-coloured', () => {
    const style = plateStyle(1, null);
    const g = shapePlateGeometry('wedge', style, PART_LAYOUT, swatches);
    const plate = swatches(style.plate)!;
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    const uv = g.getAttribute('uv');
    let top = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - DECK_TOP) < 1e-6 && nrm.getY(i) > 0.999) {
        top++;
        expect(sameUv(plate, uv.getX(i), uv.getY(i))).toBe(true);
      }
    }
    expect(top).toBeGreaterThanOrEqual(3);
  });

  it('faces are wound outward: stored normals agree with the triangle winding', () => {
    for (const [shape, tier, rot] of SHAPE_IDS.flatMap((s) => TIERS.flatMap((t) => ROTS.map((r) => [s, t, r] as const)))) {
      const g = shapePlateGeometry(shape, plateStyle(tier, null), PART_LAYOUT, swatches, rot);
      const pos = g.getAttribute('position');
      const nrm = g.getAttribute('normal');
      const idx = g.index!;
      const a = new Vector3();
      const b = new Vector3();
      const c = new Vector3();
      const n = new Vector3();
      for (let t = 0; t < idx.count; t += 3) {
        a.fromBufferAttribute(pos, idx.getX(t));
        b.fromBufferAttribute(pos, idx.getX(t + 1));
        c.fromBufferAttribute(pos, idx.getX(t + 2));
        const cross = b.sub(a).cross(c.sub(a));
        if (cross.length() < 1e-10) continue;
        n.fromBufferAttribute(nrm, idx.getX(t));
        expect(Math.abs(n.length() - 1)).toBeLessThan(1e-5);
        expect(cross.normalize().dot(n)).toBeGreaterThan(0.99);
      }
    }
  });

  it('is closed from above: rays down hit a front face everywhere inside the plate top', () => {
    const material = new MeshStandardMaterial();
    const ray = new Raycaster();
    const down = new Vector3(0, -1, 0);
    for (const [shape, tier] of SHAPE_IDS.flatMap((s) => [[s, 1], [s, 2]] as const)) {
      const mesh = new Mesh(shapePlateGeometry(shape, plateStyle(tier, null), PART_LAYOUT, swatches, 3), material);
      const poly = shapePolygon(shape, 0, 'render');
      for (let x = -1; x <= 1; x += 0.05) {
        for (let y = -0.5; y <= 0.5; y += 0.05) {
          if (insideDistance({ x, y }, poly) < PLATE_TOP_IN + 0.005) continue;
          ray.set(new Vector3(x, 2, -y), down);
          const hit = ray.intersectObject(mesh, false)[0];
          expect(hit, `${shape} (${x.toFixed(2)}, ${y.toFixed(2)})`).toBeDefined();
          expect(hit!.point.y).toBeGreaterThanOrEqual(DECK_TOP - 1e-6);
        }
      }
    }
    expect(material.side).not.toBe(DoubleSide);
  });

  it('carries exactly the attribute layout of the reference part mesh (joins its batch)', () => {
    const layouts: ShellLayout[] = [
      PART_LAYOUT,
      {
        attributes: [
          { name: 'color', itemSize: 4 },
          { name: 'normal', itemSize: 3 },
          { name: 'position', itemSize: 3 },
          { name: 'tangent', itemSize: 4 },
          { name: 'uv', itemSize: 2 },
          { name: 'uv1', itemSize: 2 },
        ],
      },
    ];
    const material = new MeshStandardMaterial();
    for (const layout of layouts) {
      const g = shapePlateGeometry('round', plateStyle(1, null), layout, swatches);
      expect(shellLayoutOf(g)).toEqual(layout);
      const refGeometry = new BufferGeometry();
      for (const { name, itemSize } of layout.attributes) refGeometry.setAttribute(name, g.getAttribute(name).clone());
      expect(batchKey(new Mesh(g, material))).toBe(batchKey(new Mesh(refGeometry, material)));
      // neutral fills of the extra attributes
      if (layout !== PART_LAYOUT) {
        expect(g.getAttribute('color').getX(0)).toBe(1);
        expect(g.getAttribute('uv1').getX(0)).toBe(g.getAttribute('uv').getX(0));
      }
    }
  });

  it('is cached per (shape, style, layout, swatch table) and shared', () => {
    const style = plateStyle(1, null);
    const a = shapePlateGeometry('arc', style, PART_LAYOUT, swatches);
    expect(shapePlateGeometry('arc', { ...style }, { attributes: [...PART_LAYOUT.attributes] }, swatches)).toBe(a);
    expect(shapePlateGeometry('arc', plateStyle(2, null), PART_LAYOUT, swatches)).not.toBe(a);
    expect(shapePlateGeometry('arc', plateStyle(1, 'rust'), PART_LAYOUT, swatches)).not.toBe(a);
    expect(shapePlateGeometry('chamfer', style, PART_LAYOUT, swatches)).not.toBe(a);
    expect(shapePlateGeometry('arc', style, PART_LAYOUT, fakeTable())).not.toBe(a);
    // rot only keys plates with bow-pointing detail (≤ 4 variants)
    expect(shapePlateGeometry('arc', style, PART_LAYOUT, swatches, 0)).toBe(a);
    expect(new Set(ROTS.map((rot) => shapePlateGeometry('arc', style, PART_LAYOUT, swatches, rot))).size).toBe(4);
    expect(new Set(ROTS.map((rot) => shapePlateGeometry('wedge', style, PART_LAYOUT, swatches, rot))).size).toBe(1);
    expect(new Set(ROTS.map((rot) => shapePlateGeometry('wedge', plateStyle(2, null), PART_LAYOUT, swatches, rot))).size).toBe(4);
  });

  it('is deterministic', () => {
    const style = plateStyle(2, null);
    const a = shapePlateGeometry('nose2x1', style, PART_LAYOUT, swatches);
    const b = shapePlateGeometry('nose2x1', style, PART_LAYOUT, fakeTableSameOrder());
    expect(Array.from(b.getAttribute('position').array)).toEqual(Array.from(a.getAttribute('position').array));
    expect(Array.from(b.index!.array)).toEqual(Array.from(a.index!.array));
  });

  it('builds a plain slab when the swatch table is missing', () => {
    const none: SwatchLookup = () => null;
    for (const shape of SHAPE_IDS) {
      const g = shapePlateGeometry(shape as ShapeId, plateStyle(1, null), PART_LAYOUT, none);
      expect(g.getAttribute('position').count).toBeGreaterThan(0);
      expect(triangles(g)).toBeLessThanOrEqual(PLATE_MAX_TRIANGLES);
      expect(shellLayoutOf(g)).toEqual(PART_LAYOUT);
      const poly = shapePolygon(shape, 0, 'render');
      for (const v of placedVertices(g, 0)) expect(insideDistance(v, poly)).toBeGreaterThan(-1e-6);
      expect(shapePlateGeometry(shape, plateStyle(1, null), PART_LAYOUT, none)).toBe(g);
    }
  });
});

/** A second fake table that hands out the same UVs (keys asked in the same order as `swatches`). */
function fakeTableSameOrder(): SwatchLookup {
  return (key) => swatches(key);
}
