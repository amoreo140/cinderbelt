"""Forge-smiths (ancient star-smiths) - visual language kit + the Echo
signal beacon (M3.5b).

VISUAL LANGUAGE (deliberately unlike the human hull style):
  * 3-fold / radial symmetry and tapering blade (leaf) forms - humans build
    4-fold boxes on a grid with chamfered plates.
  * Monolithic, seamless surfaces: no plates, seams, bolts, hazard stripes or
    windows.  Parts LEVITATE (floating segmented rings, hovering crystals) -
    nothing is bolted on.
  * Materials: glossy obsidian (kov_obsidian), forged bronze edge-inlays
    (kov_bronze), ember-red glyph channels = the forge fire (kov_ember; the
    pirates collect these "red glowing parts"), and a violet "singing"
    crystal heart (kov_crystal, gradient: deep violet root -> pale tip).
  * Glyphs are rhythms of short dashes (long-short-short...) set into the
    outer faces, never text or human symbols.

ozvena_beacon.glb  ~5.6 x 5.6 x 8.5 units, origin = centre of the base on the
  gameplay plane (the beacon floats; base slab underside at z = -1.0).
    Ozvena_Beacon        static tripod of three obsidian blades + base shards
      Ozvena_Glyphs      all ember glyph inlays in one node (pulse emission)
      Ozvena_Ring_0      lower segmented ring, spin around local +Y (glTF)
      Ozvena_Ring_1      upper segmented ring, spin the other way (tilted 12 deg)
      Ozvena_Crystal     hovering octahedral crystal above the tip (spin/bob)
        signal_origin    empty at the crystal centre (scan pulse / signal origin)
"""
import math
import random

import bmesh
from mathutils import Matrix, Vector

from lib import geo as G

BLADE_H = 6.6


def loft(name, sections, mat, cap_ends=True):
    """Closed loft through sections (lists of Vectors with equal counts)."""
    bm = bmesh.new()
    rows = [[bm.verts.new(p) for p in sec] for sec in sections]
    n = len(sections[0])
    for A, B in zip(rows[:-1], rows[1:]):
        for k in range(n):
            j = (k + 1) % n
            bm.faces.new((A[k], A[j], B[j], B[k]))
    if cap_ends:
        for row, rev in ((rows[0], True), (rows[-1], False)):
            if len(set(v.co.to_tuple(5) for v in row)) > 2:
                bm.faces.new(list(reversed(row)) if rev else row)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    return G.obj_from_bm(name, bm, [mat])


def bar(name, p0, p1, w, mat):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    ob = G.box(name, 0.0, d.length, -w / 2, w / 2, -w / 2, w / 2, mat)
    q = Vector((1, 0, 0)).rotation_difference(d.normalized())
    ob.data.transform(Matrix.Translation(p0) @ q.to_matrix().to_4x4())
    return ob


def blade_frame(t, angle, r_base=1.85, h=BLADE_H):
    """Centreline point, outward normal and tangent of a tripod blade at
    t in [0, 1] (0 = foot, 1 = tip)."""
    a = math.radians(angle)
    radial = Vector((math.cos(a), math.sin(a), 0))
    r = r_base * (1 - t) ** 1.15 + 0.32 * math.sin(math.pi * min(1.0, t * 1.6)) * (1 - t) + 0.06
    p = radial * r + Vector((0, 0, h * t))
    dt = 1e-3
    t2 = min(1.0, t + dt)
    r2 = r_base * (1 - t2) ** 1.15 + 0.32 * math.sin(math.pi * min(1.0, t2 * 1.6)) * (1 - t2) + 0.06
    p2 = radial * r2 + Vector((0, 0, h * t2))
    tan = (p2 - p).normalized() if t < 1 else Vector((0, 0, 1))
    side = Vector((-radial.y, radial.x, 0))
    nout = side.cross(tan).normalized()
    if nout.dot(radial) < 0:
        nout = -nout
    return p, nout, tan, side


def blade(name, angle, mat='kov_obsidian', steps=10):
    """Faceted blade: diamond cross-section (edge, outer ridge, edge, inner face)."""
    secs = []
    for i in range(steps + 1):
        t = i / steps
        p, nout, tan, side = blade_frame(t, angle)
        w = 0.78 * (1 - t) ** 0.7 + 0.015
        th = 0.44 * (1 - t) + 0.02
        secs.append([p + side * w, p + nout * th, p - side * w, p - nout * th * 0.45])
    return loft(name, secs, mat)


def glyph_strip(name, angle, t0, t1, rng, w=0.05, lift=None):
    """Ember dash rhythm along the outer ridge of a blade."""
    out = []
    t = t0
    k = 0
    pattern = (0.07, 0.025, 0.025)
    while t < t1:
        L = pattern[k % len(pattern)]
        a = min(t1, t + L)
        pa, na, _, _ = blade_frame(t, angle)
        pb, nb, _, _ = blade_frame(a, angle)
        tha = 0.44 * (1 - t) + 0.02
        thb = 0.44 * (1 - a) + 0.02
        out.append(bar(f'{name}{k}', pa + na * (tha + 0.012), pb + nb * (thb + 0.012), w * (1 - 0.5 * t),
                       'kov_ember'))
        t = a + (0.06 if k % 3 == 2 else 0.025)
        k += 1
    return out


def seg_ring(name, R, z, n_seg, gap_deg, width, height, mat='kov_bronze', glyph=True):
    """Floating ring of n_seg arc segments (rectangular section) with ember
    tick glyphs on top.  Returns (ring objects, glyph objects)."""
    ring, gl = [], []
    span = 360.0 / n_seg - gap_deg
    for s in range(n_seg):
        a0 = s * 360.0 / n_seg + gap_deg / 2
        steps = 6
        secs = []
        for i in range(steps + 1):
            a = math.radians(a0 + span * i / steps)
            rad = Vector((math.cos(a), math.sin(a), 0))
            c = rad * R + Vector((0, 0, z))
            secs.append([c - rad * width / 2 - Vector((0, 0, height / 2)), c + rad * width / 2 - Vector((0, 0, height / 2)),
                         c + rad * width / 2 + Vector((0, 0, height / 2)), c - rad * width / 2 + Vector((0, 0, height / 2))])
        ring.append(loft(f'{name}Seg{s}', secs, mat))
        if glyph:
            for k, f in enumerate((0.42, 0.5)):
                a = math.radians(a0 + span * f)
                rad = Vector((math.cos(a), math.sin(a), 0))
                L = width * (0.7 if k == 0 else 0.4)
                c = rad * R + Vector((0, 0, z + height / 2 + 0.008))
                gl.append(bar(f'{name}Gl{s}{k}', c - rad * L / 2, c + rad * L / 2, 0.04, 'kov_ember'))
    return ring, gl


def octa(name, r, h, mat, loc=(0, 0, 0)):
    bm = bmesh.new()
    vs = [bm.verts.new((r * math.cos(math.radians(a)), r * math.sin(math.radians(a)), 0)) for a in (0, 90, 180, 270)]
    top = bm.verts.new((0, 0, h))
    bot = bm.verts.new((0, 0, -h * 0.7))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((vs[i], vs[j], top))
        bm.faces.new((vs[j], vs[i], bot))
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)

    def grad(v):
        return max(0.0, min(1.0, (v.co.z - loc[2] + h * 0.7) / (h * 1.7)))
    ob = G.obj_from_bm(name, bm, [mat], grad=grad)
    G.set_smooth(ob, False)
    return ob


def crystal_column(name, r, z0, z1, mat='kov_crystal', sides=6):
    bm = bmesh.new()
    lo = [bm.verts.new((r * math.cos(2 * math.pi * k / sides), r * math.sin(2 * math.pi * k / sides), z0))
          for k in range(sides)]
    hi = [bm.verts.new((r * 0.8 * math.cos(2 * math.pi * k / sides + 0.3), r * 0.8 * math.sin(2 * math.pi * k / sides + 0.3),
                        z1 - r * 1.6)) for k in range(sides)]
    tip = bm.verts.new((0, 0, z1))
    bm.faces.new(list(reversed(lo)))
    for k in range(sides):
        j = (k + 1) % sides
        bm.faces.new((lo[k], lo[j], hi[j], hi[k]))
        bm.faces.new((hi[k], hi[j], tip))

    def grad(v):
        return max(0.0, min(1.0, (v.co.z - z0) / (z1 - z0)))
    ob = G.obj_from_bm(name, bm, [mat], grad=grad)
    G.set_smooth(ob, False)
    return ob


def build_ozvena(atlas_dir, seed=5):
    rng = random.Random(seed)
    st, gl = [], []
    # three obsidian blades leaning into a tripod spire + bronze edge inlays
    for i in range(3):
        ang = 90 + i * 120
        st.append(blade(f'Blade{i}', ang))
        for s in (1, -1):
            pts = []
            for k in range(9):
                t = 0.04 + 0.86 * k / 8
                p, nout, tan, side = blade_frame(t, ang)
                w = 0.78 * (1 - t) ** 0.7 + 0.015
                pts.append(p + side * w * s + nout * 0.015)
            for k in range(len(pts) - 1):
                st.append(bar(f'Edge{i}{s}{k}', pts[k], pts[k + 1], 0.06, 'kov_bronze'))
        gl += glyph_strip(f'Glyph{i}_', ang, 0.08, 0.78, rng)
    # base: hexagonal obsidian slab in three floating shards + bronze rim
    for i in range(3):
        a0 = i * 120 + 90 - 55
        a1 = a0 + 110
        pts = [(0.0, 0.0)] + [(2.7 * math.cos(math.radians(a)), 2.7 * math.sin(math.radians(a)))
                              for a in (a0, (a0 + a1) / 2, a1)]
        # shrink toward the shard centre -> gaps between the shards
        cx = sum(p[0] for p in pts) / 4
        cy = sum(p[1] for p in pts) / 4
        pts = [(cx + (x - cx) * 0.9, cy + (y - cy) * 0.9) for x, y in pts]
        z0 = -1.0 - 0.12 * i
        st.append(G.prism(f'Shard{i}', pts, z0, z0 + 0.42, 'kov_obsidian', bevel=0.04, seg=1))
        keel = [Vector((x, y, z0 + 0.01)) for x, y in pts]
        st.append(loft(f'Keel{i}', [keel, [Vector((cx + (p.x - cx) * 0.25, cy + (p.y - cy) * 0.25, z0 - 1.1))
                                           for p in keel]], 'kov_obsidian'))
        for k in range(1, 3):
            p0, p1 = pts[k], pts[k + 1]
            st.append(bar(f'ShardRim{i}{k}', (p0[0], p0[1], z0 + 0.43), (p1[0], p1[1], z0 + 0.43), 0.07, 'kov_bronze'))
        cg = Vector((cx, cy, z0 + 0.44))
        gl.append(bar(f'ShardGlyph{i}', cg - Vector((cx, cy, 0)).normalized() * 0.35,
                      cg + Vector((cx, cy, 0)).normalized() * 0.35, 0.08, 'kov_ember'))
    # singing crystal heart inside the tripod
    st.append(crystal_column('Heart', 0.42, -0.55, 4.4))
    root = G.join(st, 'Ozvena_Beacon')
    G.finalize(root, atlas_dir)
    glyphs = G.join(gl, 'Ozvena_Glyphs')
    G.finalize(glyphs, atlas_dir)
    glyphs.parent = root
    # floating rings (pivot on the axis)
    for k, (R_, z, n, tilt) in enumerate(((2.65, 1.85, 6, 0.0), (1.7, 4.1, 5, 12.0))):
        ring, rgl = seg_ring(f'Ring{k}', R_, 0.0, n, 9.0, 0.32 - 0.06 * k, 0.16)
        ob = G.join(ring + rgl, f'Ozvena_Ring_{k}')
        G.finalize(ob, atlas_dir)
        ob.location = (0, 0, z)
        ob.rotation_euler = (math.radians(tilt), 0, 0)
        ob.parent = root
    # hovering crystal + signal origin
    cr = octa('Ozvena_Crystal', 0.5, 0.9, 'kov_crystal')
    G.finalize(cr, atlas_dir)
    cr.location = (0, 0, BLADE_H + 0.95)
    cr.parent = root
    so = G.empty('signal_origin', loc=(0, 0, 0), size=0.3)
    so.parent = cr
    return root


BUILDERS = {'ozvena_beacon': build_ozvena}
