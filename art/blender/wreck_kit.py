"""Batch B kit ("clutter, salvage and wreckage", art audit 2026-10-16 §6 B):
small modelling helpers shared by debris.py, wreckage.py, props.py and
preview_batch_b.py - cables/tubes, bends and twists, jagged torn cuts with
charred caps, soot vertex colour, the derelict finishing pipeline and the
optimizer call limited to batch-B output folders.

Owned by batch B; everybody else imports it read-only.
"""
import math
import os
import random
import shutil
import subprocess

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

from lib import geo as G
from lib import materials as M
import paths


# ----------------------------------------------------------------------------
# geometry
# ----------------------------------------------------------------------------
def tube(name, pts, r, mat, sides=6, caps=True, r_end=None, smooth=True):
    """Tube along a polyline (parallel-transport frames, no twisting)."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    bm = bmesh.new()
    t0 = (pts[1] - pts[0]).normalized()
    ref = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
    u = t0.cross(ref).normalized()
    prev = t0
    rings = []
    for i, p in enumerate(pts):
        if i == 0:
            t = t0
        elif i == n - 1:
            t = (pts[-1] - pts[-2]).normalized()
        else:
            t = (pts[i + 1] - pts[i - 1]).normalized()
        ax = prev.cross(t)
        if ax.length > 1e-6:
            u = Matrix.Rotation(prev.angle(t), 3, ax.normalized()) @ u
        prev = t
        v = t.cross(u).normalized()
        rr = r if r_end is None else r + (r_end - r) * i / (n - 1)
        rings.append([bm.verts.new(p + (u * math.cos(2 * math.pi * k / sides) + v * math.sin(2 * math.pi * k / sides)) * rr)
                      for k in range(sides)])
    for A, B in zip(rings[:-1], rings[1:]):
        for k in range(sides):
            j = (k + 1) % sides
            bm.faces.new((A[k], A[j], B[j], B[k]))
    if caps:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    ob = G.obj_from_bm(name, bm, [mat])
    G.set_smooth(ob, smooth)
    return ob


def sag(p0, p1, droop, n=6, wobble=0.0, rng=None, side=None):
    """Points of a hanging cable from p0 to p1 (parabolic droop along -Z,
    optional sideways wobble)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    side = Vector(side) if side is not None else d.cross(Vector((0, 0, 1)))
    if side.length < 1e-6:
        side = Vector((1, 0, 0))
    side.normalize()
    out = []
    for i in range(n + 1):
        t = i / n
        p = p0 + d * t - Vector((0, 0, 1)) * droop * 4 * t * (1 - t)
        if wobble and rng:
            p += side * math.sin(t * math.pi * 2 + rng.uniform(0, 6)) * wobble * t
        out.append(p)
    return out


def bend(ob, pivot, axis, angle_deg, direction, start=0.0, ramp=0.0):
    """Rotate the vertices beyond a plane (distance along `direction` from
    `pivot` > start) around the line (pivot, axis); `ramp` blends the angle in."""
    G.apply_modifiers(ob)
    G.bake_transform(ob)
    piv, ax, dr = Vector(pivot), Vector(axis).normalized(), Vector(direction).normalized()
    for v in ob.data.vertices:
        d = (v.co - piv).dot(dr) - start
        if d <= 0:
            continue
        t = 1.0 if ramp <= 0 else min(1.0, d / ramp)
        m = Matrix.Rotation(math.radians(angle_deg) * t, 3, ax)
        v.co = piv + m @ (v.co - piv)
    ob.data.update()
    return ob


def twist(ob, rate, axis='X'):
    """Twist around the given axis by `rate` rad per unit along it."""
    G.apply_modifiers(ob)
    G.bake_transform(ob)
    for v in ob.data.vertices:
        if axis == 'X':
            a = rate * v.co.x
            y, z = v.co.y, v.co.z
            v.co.y, v.co.z = y * math.cos(a) - z * math.sin(a), y * math.sin(a) + z * math.cos(a)
        else:
            a = rate * v.co.y
            x, z = v.co.x, v.co.z
            v.co.x, v.co.z = x * math.cos(a) - z * math.sin(a), x * math.sin(a) + z * math.cos(a)
    ob.data.update()
    return ob


def subdiv_long(ob, max_len, rounds=3):
    G.apply_modifiers(ob)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for _ in range(rounds):
        long_e = [e for e in bm.edges if e.calc_length() > max_len]
        if not long_e:
            break
        bmesh.ops.subdivide_edges(bm, edges=long_e, cuts=1, use_grid_fill=True)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def _slot(ob, key):
    m = M.mat(key)
    for i, s in enumerate(ob.material_slots):
        if s.material == m:
            return i
    ob.data.materials.append(m)
    return len(ob.data.materials) - 1


def broken(ob, planes, cut_key='char_black'):
    """Cut `ob` with planes [(point, normal)] (removes the side the normal
    points to) and cap the cuts with `cut_key` faces (charred)."""
    G.apply_modifiers(ob)
    G.bake_transform(ob)
    ci = _slot(ob, cut_key)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for co, no in planes:
        res = bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                                     plane_co=Vector(co), plane_no=Vector(no).normalized(), clear_outer=True)
        edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        if edges:
            try:
                for f in bmesh.ops.edgenet_fill(bm, edges=edges)['faces']:
                    f.material_index = ci
            except Exception:
                pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def jagged_planes(rng, edge, n=4, span=(-0.25, 0.25), axis='x', sign=1, tilt=0.9, z=0.0):
    """Planes for a jagged torn edge near `edge` along x (or y)."""
    planes = []
    for i in range(n):
        t = span[0] + (span[1] - span[0]) * (i + 0.5) / n
        a = rng.uniform(-tilt, tilt)
        if axis == 'x':
            planes.append(((edge + rng.uniform(-0.05, 0.05) * abs(edge + 1e-3) ** 0.5, t, z),
                           (sign, a, rng.uniform(-0.3, 0.3))))
        else:
            planes.append(((t, edge + rng.uniform(-0.05, 0.05) * abs(edge + 1e-3) ** 0.5, z),
                           (a, sign, rng.uniform(-0.3, 0.3))))
    return planes


def torn(ob, rng, edge, n=4, span=(-0.25, 0.25), axis='x', sign=1, cut_key='char_black', tilt=0.9):
    return broken(ob, jagged_planes(rng, edge, n, span, axis, sign, tilt), cut_key)


def place(ob, loc=(0, 0, 0), rot=(0, 0, 0)):
    """Bake a placement into the mesh (euler degrees XYZ)."""
    G.apply_modifiers(ob)
    G.bake_transform(ob)
    m = Matrix.Translation(loc) @ G._euler(rot)
    ob.data.transform(m)
    return ob


def place_all(objs, loc=(0, 0, 0), rot=(0, 0, 0)):
    for o in objs:
        place(o, loc, rot)
    return objs


def hull_from_points(name, pts, mat):
    """Convex hull of points -> faceted chunk (flat shaded)."""
    bm = bmesh.new()
    for p in pts:
        bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts)
    ob = G.obj_from_bm(name, bm, [mat])
    G.set_smooth(ob, False)
    return ob


def centre_bbox(ob):
    bb = [Vector(c) for c in ob.bound_box]
    c = sum(bb, Vector()) / 8
    ob.data.transform(Matrix.Translation(-c))
    return c


# ----------------------------------------------------------------------------
# vertex colour
# ----------------------------------------------------------------------------
def soot(ob, rng, amount=0.55, burn=(), radius=0.45, freq=4.0, floor=0.15):
    """COLOR_0: heavy soot near the fracture / ember faces (burn centres)
    fading over `radius`, plus noise blotches elsewhere.  Never black."""
    me = ob.data
    o = Vector([rng.uniform(-40, 40) for _ in range(3)])
    attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for poly in me.polygons:
        for li in poly.loop_indices:
            p = me.vertices[me.loops[li].vertex_index].co
            d = min(((p - c).length for c in burn), default=9.0)
            near = max(0.0, 1.0 - d / radius)
            n = noise.fractal(p * freq + o, 0.7, 2.0, 3)
            blot = max(0.0, min(1.0, (n + 0.1) * 2.5)) * amount
            s = min(1.0, near * 0.95 + blot)
            k = max(floor, 1.0 - s * 0.85)
            attr.data[li].color = (k, k * 0.95, k * 0.9, 1.0)
    me.color_attributes.active_color = attr
    return ob


def burn_centres(ob, keys=('char_black', 'ember')):
    out = []
    for p in ob.data.polygons:
        m = ob.material_slots[p.material_index].material if ob.material_slots else None
        if m and m.get('palette_key') in keys:
            out.append(p.center.copy())
    return out


def flat(ob):
    for p in ob.data.polygons:
        p.use_smooth = False


# ----------------------------------------------------------------------------
# derelict finish (wreckage): weathered swatches + grime + detail pass
# ----------------------------------------------------------------------------
def derelict_finish(name, st, atlas_dir, seed, dress=True, density=1.0, zones=None, grime_scale=1.0,
                    keep_some=0.2, panels=True, panel_cell=0.9, rows=(), smooth=False, weather=None):
    """Join `st` into one weathered derelict mesh (der_* swatches, grime COLOR_0)
    and run the derelict detail pass (holes, scorch, patches, dead lights)."""
    import derelicts as D
    import station_kit as K
    rng = random.Random(seed)
    D.weather_mats(st, keep_some=keep_some, rng=rng)
    root = G.join(st, name)
    D.densify(root, 1.1 * grime_scale)
    G.finalize(root, atlas_dir)
    D.grime(root, rng, grime_scale)
    if not smooth:
        flat(root)
    if dress:
        K.post_dress(root, seed + 1, 'derelict', zones, panels=panels, panel_cell=panel_cell,
                     panel_keys=('der_plate', 'der_dark', 'hull_mid'), panel_min_area=0.7,
                     rows=rows, row_kinds=('wpanel', 'whole', 'window'),
                     scatter=[dict(density=density, max_size=0.8)],
                     weather_cfg=weather or dict(grime=0.3, rust=0.35, panel=0.12, floor=0.22, far=2.0))
    return root


# ----------------------------------------------------------------------------
# optimizer limited to batch-B files
# ----------------------------------------------------------------------------
def optimize_files(files):
    """Run the shipped-asset optimizer (art/tools/optimize_assets.mjs) on the
    given GLBs only (README §2.9) via art/tools/optimize_files.mjs."""
    node = shutil.which('node')
    if not node or not files:
        print('WARNING optimize: node missing or nothing to do')
        return False
    script = os.path.join(paths.ART, 'tools', 'optimize_files.mjs')
    r = subprocess.run([node, script] + list(files), cwd=paths.ROOT)
    if r.returncode != 0:
        print('WARNING optimize: failed - run node art/tools/optimize_files.mjs <files>')
        return False
    return True
