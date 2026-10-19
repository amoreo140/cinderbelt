// SL2 E1 T2: shaved armour corners – the runtime clip of the armour model (clipArmour.ts).
import { BoxGeometry, BufferAttribute, BufferGeometry, Group, InterleavedBuffer, InterleavedBufferAttribute, Matrix4, Mesh, MeshStandardMaterial, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { BEVEL_FP, BEVEL_FS, BEVEL_RP, BEVEL_RS } from '../../sim/ship/outline';
import { armourLocalMask, clipArmour, clipArmourVariants, clipGeometry } from './clipArmour';
import { BEVEL, CLIP_ARMOUR_MAX_VARIANTS, DECK_TOP, TERRACE_CLIP_Z } from './shellConstants';

/** An armour-like template: a root node with one mesh (a 0.98 × 0.45 × 0.98 box, deck top at 0.25). */
function armourTemplate(): Group {
  const root = new Group();
  root.name = 'Armor_Test';
  const geo = new BoxGeometry(0.98, 0.45, 0.98, 4, 1, 4);
  const mesh = new Mesh(geo, new MeshStandardMaterial());
  mesh.position.y = 0.025;
  root.add(mesh);
  return root;
}

/** Part-frame grid coordinates (gx = x, gy = −z) of every vertex of every mesh of a template. */
function gridVerts(t: Object3D): { x: number; y: number }[] {
  t.updateMatrixWorld(true);
  const inv = new Matrix4().copy(t.matrixWorld).invert();
  const out: { x: number; y: number }[] = [];
  t.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const m = new Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const p = o.geometry.getAttribute('position');
    const v = new Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      out.push({ x: v.x, y: -v.z });
    }
  });
  return out;
}

/** Area of the up-facing triangles at the top of a geometry (y ≈ top). */
function topArea(g: BufferGeometry, top: number): number {
  const p = g.getAttribute('position');
  const idx = g.index!;
  let area = 0;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let t = 0; t < idx.count; t += 3) {
    a.fromBufferAttribute(p, idx.getX(t));
    b.fromBufferAttribute(p, idx.getX(t + 1));
    c.fromBufferAttribute(p, idx.getX(t + 2));
    if (Math.abs(a.y - top) > 1e-6 || Math.abs(b.y - top) > 1e-6 || Math.abs(c.y - top) > 1e-6) continue;
    area += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
  }
  return area;
}

const EPS = 1e-6;
const CUT = 1 - BEVEL;

describe('armourLocalMask', () => {
  it('turns the grid-frame mask into the model frame of a rotated part', () => {
    expect(armourLocalMask(BEVEL_FP, 0)).toBe(BEVEL_FP);
    // rot 1: the model's front-starboard corner points to the grid's front-port
    expect(armourLocalMask(BEVEL_FP, 1)).toBe(BEVEL_FS);
    expect(armourLocalMask(BEVEL_FP, 2)).toBe(BEVEL_RS);
    expect(armourLocalMask(BEVEL_FP, 3)).toBe(BEVEL_RP);
    expect(armourLocalMask(BEVEL_FP | BEVEL_RS, 1)).toBe(BEVEL_FS | BEVEL_RP);
    expect(armourLocalMask(15, 3)).toBe(15);
  });
});

describe('clipArmour', () => {
  it('removes the masked corner region and keeps the rest', () => {
    const t = armourTemplate();
    const v = clipArmour(t, BEVEL_FP);
    const verts = gridVerts(v);
    for (const p of verts) expect(p.x + p.y).toBeLessThanOrEqual(CUT + EPS);
    // the other three corners are still there
    for (const [sx, sy] of [[-1, 1], [-1, -1], [1, -1]] as const) {
      expect(verts.some((p) => Math.abs(p.x - sx * 0.49) < EPS && Math.abs(p.y - sy * 0.49) < EPS)).toBe(true);
    }
    // the cut runs along the bevel line
    expect(verts.some((p) => Math.abs(p.x + p.y - CUT) < EPS)).toBe(true);
    // top face: the full square minus the corner triangle (legs 0.98 − CUT … i.e. 0.49 + 0.49 − 0.75)
    const leg = 0.98 - CUT;
    const mesh = v.children[0] as Mesh;
    expect(topArea(mesh.geometry, 0.225)).toBeCloseTo(0.98 * 0.98 - (leg * leg) / 2, 6);
  });

  it('clips every masked corner, in the part frame even when the mesh has its own transform', () => {
    const t = armourTemplate();
    const mesh = t.children[0] as Mesh;
    mesh.rotation.y = Math.PI / 2; // a quarter turn inside the template: the grid corners stay the grid corners
    mesh.updateMatrix();
    const v = clipArmour(t, 15);
    const verts = gridVerts(v);
    for (const p of verts) expect(Math.abs(p.x) + Math.abs(p.y)).toBeLessThanOrEqual(CUT + EPS);
    expect(verts.some((p) => Math.abs(p.x - 0.49) < EPS && Math.abs(p.y) < 0.25)).toBe(true);
  });

  it('a part turned by rot gets its grid corner shaved via armourLocalMask', () => {
    const t = armourTemplate();
    for (const rot of [0, 1, 2, 3] as const) {
      const node = clipArmour(t, armourLocalMask(BEVEL_RP, rot)).clone();
      node.rotation.y = (rot * Math.PI) / 2; // ShipView: node.rotation.y = rot · 90°
      const world = new Group();
      world.add(node);
      for (const p of gridVerts(world)) expect(-p.x + p.y).toBeLessThanOrEqual(CUT + EPS);
    }
  });

  it('caches one shared variant per mask (≤ 15), mask 0 = the template', () => {
    const t = armourTemplate();
    expect(clipArmour(t, 0)).toBe(t);
    const a = clipArmour(t, BEVEL_FS);
    expect(clipArmour(t, BEVEL_FS)).toBe(a);
    expect((a.children[0] as Mesh).geometry).not.toBe((t.children[0] as Mesh).geometry);
    // clones share the clipped geometry (never disposed by a view)
    expect((a.clone().children[0] as Mesh).geometry).toBe((a.children[0] as Mesh).geometry);
    for (let m = 0; m < 32; m++) clipArmour(t, m);
    clipArmour(t, 'deck');
    expect(clipArmourVariants(t)).toBe(CLIP_ARMOUR_MAX_VARIANTS);
    // the template itself is untouched
    expect(gridVerts(t).some((p) => p.x + p.y > CUT + 0.1)).toBe(true);
  });

  it('keeps attribute names, types and normalisation (meshopt-style interleaved int8 normals, uint16 uvs)', () => {
    const box = new BoxGeometry(0.98, 0.45, 0.98, 2, 1, 2);
    const g = new BufferGeometry();
    g.setAttribute('position', box.getAttribute('position'));
    const n = box.getAttribute('normal');
    const inter = new InterleavedBuffer(new Int8Array(n.count * 4), 4);
    const normal = new InterleavedBufferAttribute(inter, 3, 0, true);
    for (let i = 0; i < n.count; i++) normal.setXYZ(i, n.getX(i), n.getY(i), n.getZ(i));
    g.setAttribute('normal', normal);
    const uvSrc = box.getAttribute('uv');
    const uv = new BufferAttribute(new Uint16Array(uvSrc.count * 2), 2, true);
    for (let i = 0; i < uvSrc.count; i++) uv.setXY(i, 0.25 + uvSrc.getX(i) * 0.01, 0.75);
    g.setAttribute('uv', uv);
    g.setIndex(box.getIndex());
    const out = clipGeometry(g, new Matrix4(), [[1, 1]]);
    expect(Object.keys(out.attributes).sort()).toEqual(['normal', 'position', 'uv']);
    expect(out.getAttribute('normal').array).toBeInstanceOf(Int8Array);
    expect(out.getAttribute('normal').normalized).toBe(true);
    expect(out.getAttribute('uv').array).toBeInstanceOf(Uint16Array);
    expect(out.getAttribute('uv').normalized).toBe(true);
    const on = out.getAttribute('normal');
    for (let i = 0; i < on.count; i++) expect(Math.hypot(on.getX(i), on.getY(i), on.getZ(i))).toBeCloseTo(1, 1);
    const ou = out.getAttribute('uv');
    for (let i = 0; i < ou.count; i++) {
      expect(ou.getX(i)).toBeGreaterThanOrEqual(0.25 - 1e-4);
      expect(ou.getX(i)).toBeLessThanOrEqual(0.26 + 1e-4);
    }
    // no unused vertices
    const used = new Set(Array.from(out.index!.array));
    expect(used.size).toBe(out.getAttribute('position').count);
  });

  it('shares the vertices of a cut edge between its two triangles (no cracks)', () => {
    const out = clipGeometry(new BoxGeometry(0.98, 0.45, 0.98, 3, 1, 3), new Matrix4(), [[1, 1]]);
    const p = out.getAttribute('position');
    const keys = new Map<string, number>();
    for (let i = 0; i < p.count; i++) {
      const k = `${p.getX(i).toFixed(5)},${p.getY(i).toFixed(5)},${p.getZ(i).toFixed(5)}`;
      keys.set(k, (keys.get(k) ?? 0) + 1);
    }
    // a box has split normals at its edges, so a position may repeat – but never more than 3 times
    for (const c of keys.values()) expect(c).toBeLessThanOrEqual(3);
  });
});

/** Armour with a deck block (top at DECK_TOP), a raised pad mesh and a bolt crossing the deck top. */
function paddedTemplate(): Group {
  const root = new Group();
  const deck = new Mesh(new BoxGeometry(0.98, 0.4, 0.98, 2, 1, 2), new MeshStandardMaterial());
  deck.position.y = DECK_TOP - 0.2;
  const pad = new Mesh(new BoxGeometry(0.56, 0.04, 0.56), new MeshStandardMaterial());
  pad.position.y = DECK_TOP + 0.03; // 0.21 … 0.25: entirely above the clip height
  const bolt = new Mesh(new BoxGeometry(0.04, 0.04, 0.04), new MeshStandardMaterial());
  bolt.position.set(0.3, DECK_TOP + 0.01, 0.3); // 0.19 … 0.23: across it
  root.add(deck, pad, bolt);
  return root;
}

/** Height (part frame) of every vertex of every mesh of a template. */
function heights(t: Object3D): number[] {
  t.updateMatrixWorld(true);
  const inv = new Matrix4().copy(t.matrixWorld).invert();
  const out: number[] = [];
  t.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const m = new Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const p = o.geometry.getAttribute('position');
    const v = new Vector3();
    for (let i = 0; i < p.count; i++) out.push(v.fromBufferAttribute(p, i).applyMatrix4(m).y);
  });
  return out;
}

describe("clipArmour – mode 'deck' (terrace v2)", () => {
  it('leaves no armour triangle above DECK_TOP + 0.005: the pad goes, the deck plate stays', () => {
    const t = paddedTemplate();
    const v = clipArmour(t, 'deck');
    expect(TERRACE_CLIP_Z).toBeCloseTo(DECK_TOP + 0.005, 9);
    for (const h of heights(v)) expect(h).toBeLessThanOrEqual(TERRACE_CLIP_Z + EPS);
    // the pad mesh had nothing below the cut: dropped from the variant; the bolt is cut, the deck kept
    const meshes: Mesh[] = [];
    v.traverse((o) => {
      if (o instanceof Mesh) meshes.push(o);
    });
    expect(meshes).toHaveLength(2);
    const deck = meshes[0]!;
    expect(deck.geometry.index!.count).toBe((t.children[0] as Mesh).geometry.index!.count);
    expect(topArea(deck.geometry, 0.2)).toBeCloseTo(0.98 * 0.98, 6);
    // the template keeps its pad
    expect(Math.max(...heights(t))).toBeCloseTo(DECK_TOP + 0.05, 6);
  });

  it('is one shared variant per template, apart from the corner masks', () => {
    const t = paddedTemplate();
    const d = clipArmour(t, 'deck');
    expect(clipArmour(t, 'deck')).toBe(d);
    expect(d.userData.afArmourClip).toBe('deck');
    expect(clipArmour(t, BEVEL_FP)).not.toBe(d);
    expect(clipArmourVariants(t)).toBe(2);
  });
});
