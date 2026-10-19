"""Modelling helpers: primitives built with bmesh, bevels, joining, finalising."""
import math
import bmesh
import bpy
from mathutils import Matrix, Vector

from . import materials as M

GRAD_ATTR = M.GRAD_ATTR
SHARP_ANGLE = math.radians(35)


# --------------------------------------------------------------------------
# scene / object basics
# --------------------------------------------------------------------------
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def link(obj, collection=None):
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def obj_from_bm(name, bm, mat_keys, grad=None):
    """Create an object from a bmesh.  Face material_index refers to mat_keys.
    grad: optional dict {BMVert.index: float} stored as point attribute."""
    me = bpy.data.meshes.new(name)
    # consistent outward normals (assets are exported with back-face culling)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    for e in bm.edges:  # "auto smooth": hard edges above SHARP_ANGLE
        if len(e.link_faces) == 2 and e.calc_face_angle(0) > SHARP_ANGLE:
            e.smooth = False
    bm.verts.index_update()
    if grad is not None:
        layer = bm.verts.layers.float.new(GRAD_ATTR)
        for v in bm.verts:
            v[layer] = grad(v)
    bm.to_mesh(me)
    bm.free()
    for k in mat_keys:
        me.materials.append(M.mat(k))
    ob = bpy.data.objects.new(name, me)
    link(ob)
    return ob


def set_smooth(ob, smooth=True):
    for p in ob.data.polygons:
        p.use_smooth = smooth


# --------------------------------------------------------------------------
# primitives (all return objects; `mat` is a palette key)
# --------------------------------------------------------------------------
def box(name, x0, x1, y0, y1, z0, z1, mat, bevel=0.0, seg=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x = x0 if v.co.x < 0 else x1
        v.co.y = y0 if v.co.y < 0 else y1
        v.co.z = z0 if v.co.z < 0 else z1
    ob = obj_from_bm(name, bm, [mat])
    if bevel:
        add_bevel(ob, bevel, seg)
    return ob


def prism(name, pts, z0, z1, mat, bevel=0.0, seg=2, top_mat=None):
    """Extrude a CCW 2D outline (list of (x,y)) from z0 to z1."""
    bm = bmesh.new()
    vb = [bm.verts.new((x, y, z0)) for x, y in pts]
    vt = [bm.verts.new((x, y, z1)) for x, y in pts]
    n = len(pts)
    bot = bm.faces.new(list(reversed(vb)))
    top = bm.faces.new(vt)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((vb[i], vb[j], vt[j], vt[i]))
    keys = [mat]
    if top_mat:
        keys.append(top_mat)
        top.material_index = 1
    bm.normal_update()
    ob = obj_from_bm(name, bm, keys)
    if bevel:
        add_bevel(ob, bevel, seg)
    return ob


def chamfer_rect(x0, x1, y0, y1, c):
    """CCW outline of a rectangle with 45 deg chamfered corners."""
    return [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c),
            (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c)]


def _orient(axis):
    if axis == 'X':
        return Matrix.Rotation(math.radians(90), 4, 'Y')
    if axis == 'Y':
        return Matrix.Rotation(math.radians(-90), 4, 'X')
    return Matrix.Identity(4)


def cyl(name, r, depth, mat, loc=(0, 0, 0), axis='Z', verts=16, r2=None,
        bevel=0.0, seg=2, caps=True, cap_mat=None, smooth=True):
    """Cylinder/cone along `axis` centred at loc. r = radius at -axis end,
    r2 = radius at +axis end."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=verts,
                          radius1=r, radius2=r if r2 is None else r2, depth=depth)
    keys = [mat]
    if cap_mat and caps:
        keys.append(cap_mat)
        for f in bm.faces:
            if abs(f.normal.z) > 0.99:
                f.material_index = 1
    bmesh.ops.transform(bm, matrix=Matrix.Translation(loc) @ _orient(axis), verts=bm.verts)
    ob = obj_from_bm(name, bm, keys)
    set_smooth(ob, smooth)
    if bevel:
        add_bevel(ob, bevel, seg)
    return ob


def torus(name, R, r, mat, loc=(0, 0, 0), rot=(0, 0, 0), maj=24, mnr=8, smooth=True):
    bm = bmesh.new()
    verts = []
    for i in range(maj):
        a = 2 * math.pi * i / maj
        ring = []
        for j in range(mnr):
            b = 2 * math.pi * j / mnr
            d = R + r * math.cos(b)
            ring.append(bm.verts.new((d * math.cos(a), d * math.sin(a), r * math.sin(b))))
        verts.append(ring)
    for i in range(maj):
        for j in range(mnr):
            a, b = verts[i][j], verts[(i + 1) % maj][j]
            c, d = verts[(i + 1) % maj][(j + 1) % mnr], verts[i][(j + 1) % mnr]
            bm.faces.new((a, b, c, d))
    m = Matrix.Translation(loc) @ _euler(rot)
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    bm.normal_update()
    ob = obj_from_bm(name, bm, [mat])
    set_smooth(ob, smooth)
    return ob


def ring_band(name, r_out, r_in, z0, z1, mat, loc=(0, 0, 0), axis='Z', verts=24,
              top_mat=None, smooth=True):
    """Flat annulus/tube (washer) with thickness: outer radius, inner radius."""
    bm = bmesh.new()
    rings = []
    for rr, zz in ((r_out, z0), (r_out, z1), (r_in, z1), (r_in, z0)):
        rings.append([bm.verts.new((rr * math.cos(2 * math.pi * i / verts),
                                    rr * math.sin(2 * math.pi * i / verts), zz)) for i in range(verts)])
    faces = []
    for k in range(4):
        A, B = rings[k], rings[(k + 1) % 4]
        for i in range(verts):
            j = (i + 1) % verts
            faces.append((k, bm.faces.new((A[i], A[j], B[j], B[i]))))
    keys = [mat]
    if top_mat:
        keys.append(top_mat)
        for k, f in faces:
            if k == 1:
                f.material_index = 1
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(loc) @ _orient(axis), verts=bm.verts)
    ob = obj_from_bm(name, bm, keys)
    set_smooth(ob, smooth)
    return ob


def ellipsoid(name, rx, ry, rz, mat, loc=(0, 0, 0), seg=16, rings=10, upper_only=False,
              smooth=True):
    bm = bmesh.new()
    rows = []
    r0 = rings // 2 if upper_only else 0
    for i in range(r0, rings + 1):
        th = math.pi * i / rings          # 0 .. pi  (bottom -> top)
        z = -math.cos(th)
        rr = math.sin(th)
        if i == rings:
            rows.append([bm.verts.new((0, 0, rz))])
            continue
        if i == 0:
            rows.append([bm.verts.new((0, 0, -rz))])
            continue
        rows.append([bm.verts.new((rx * rr * math.cos(2 * math.pi * k / seg),
                                   ry * rr * math.sin(2 * math.pi * k / seg), rz * z)) for k in range(seg)])
    for a, b in zip(rows[:-1], rows[1:]):
        if len(a) == 1:
            for k in range(seg):
                bm.faces.new((a[0], b[(k + 1) % seg], b[k]))
        elif len(b) == 1:
            for k in range(seg):
                bm.faces.new((a[k], a[(k + 1) % seg], b[0]))
        else:
            for k in range(seg):
                bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
    if upper_only:
        bm.faces.new(list(reversed(rows[0])))
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    ob = obj_from_bm(name, bm, [mat])
    set_smooth(ob, smooth)
    return ob


def _euler(rot):
    from mathutils import Euler
    return Euler([math.radians(a) for a in rot], 'XYZ').to_matrix().to_4x4()


# --------------------------------------------------------------------------
# modifiers / finishing
# --------------------------------------------------------------------------
def add_bevel(ob, width, seg=2, angle=40, harden=True):
    mod = ob.modifiers.new('Bevel', 'BEVEL')
    mod.width = width
    mod.segments = seg
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(angle)
    mod.harden_normals = harden
    mod.use_clamp_overlap = True
    mod.miter_outer = 'MITER_ARC'
    set_smooth(ob, True)
    return mod


def apply_modifiers(ob):
    if not ob.modifiers:
        return ob
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    me.name = old.name
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return ob


def transform(ob, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    ob.location = loc
    ob.rotation_euler = [math.radians(a) for a in rot]
    ob.scale = scale
    return ob


def bake_transform(ob):
    """Apply object transform into mesh data."""
    mw = ob.matrix_basis.copy()
    ob.data.transform(mw)
    ob.matrix_basis = Matrix.Identity(4)


def join(objs, name):
    """Apply modifiers + transforms of objs and join them into one object."""
    for o in objs:
        apply_modifiers(o)
        bake_transform(o)
    target = objs[0]
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=target, object=target,
                                       selected_objects=objs, selected_editable_objects=objs):
            bpy.ops.object.join()
    target.name = name
    target.data.name = name
    return target


def finalize(ob, atlas_dir):
    """Bake palette UVs + atlas material."""
    M.bake_to_atlas(ob, atlas_dir)
    return ob


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def parent(child, par):
    mw = child.matrix_world.copy()
    child.parent = par
    child.matrix_world = mw


def lathe(name, profile, seg_mats, mat_keys, loc=(0, 0, 0), axis='Z', verts=20,
          closed=True, smooth=True, rot=None):
    """Revolve a profile [(a, r), ...] (a = position along axis, r = radius)
    around `axis`.  seg_mats[i] = index into mat_keys for the band between
    profile[i] and profile[i+1] (and the closing band if closed).
    A point with r == 0 becomes a single pole vertex (triangle fan).
    rot: optional extra (x, y, z) euler in degrees applied before `loc`."""
    bm = bmesh.new()
    rings = []
    for a, r in profile:
        if r <= 1e-6:
            rings.append([bm.verts.new((0, 0, a))] * verts)
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * k / verts),
                                        r * math.sin(2 * math.pi * k / verts), a)) for k in range(verts)])
    n = len(rings)
    last = n if closed else n - 1
    for i in range(last):
        A, B = rings[i], rings[(i + 1) % n]
        if A[0] is A[1] and B[0] is B[1]:
            continue
        for k in range(verts):
            j = (k + 1) % verts
            quad = [A[k], A[j], B[j], B[k]]
            vs = []
            for v in quad:
                if v not in vs:
                    vs.append(v)
            if len(vs) < 3:
                continue
            f = bm.faces.new(vs)
            f.material_index = seg_mats[i]
    bm.normal_update()
    if closed:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    m = Matrix.Translation(loc) @ _orient(axis)
    if rot:
        m = Matrix.Translation(loc) @ _euler(rot) @ _orient(axis)
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    ob = obj_from_bm(name, bm, mat_keys)
    set_smooth(ob, smooth)
    return ob


def empty(name, loc=(0, 0, 0), size=0.05):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = 'PLAIN_AXES'
    ob.empty_display_size = size
    ob.location = loc
    link(ob)
    return ob
