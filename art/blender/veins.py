"""Ore veins on the style-C asteroids (vein-mining mechanic, spec 2.1.1).

Each vein is a gently meandering seam ACROSS part of the rock surface
(length ~2-4 units, never wrapping around): a chiselled groove is carved
into the rock (boolean difference with a swept trapezoid cutter, flat floor,
sloped walls, ramps at both ends) and a faceted ore fill sits in it.

The fill is exported as a separate child mesh node `Vein_<i>` (identity
transform under the rock root) with
  TEXCOORD_0  palette atlas UV (st_band_<res> swatch, slightly emissive)
  TEXCOORD_1  "VeinUV": u = normalised arc length along the vein 0..1,
              v = 0..1 across the fill (0 = left edge, 0.5 = ridge, 1 = right)
  COLOR_0     soft shading (edges darker than the ridge)
The game shader moves a bright "active segment" along u.  The centreline
polyline (one point per fill row, ordered along u) is written to veins.json.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

from lib import geo as G
from lib import materials as M
import asteroid_styles as S

# veins per (resource, shape); ice has no veins
COUNT = {'round': 2, 'elongated': 2, 'chunky': 3}
KINDS = ('iron', 'copper', 'titanium', 'crystal', 'rare')
SEGMENTS = 20                  # fill rows - 1 (= polyline points - 1)
FILL_KEY = {'iron': 'st_band_iron', 'copper': 'st_band_copper', 'titanium': 'st_band_ti',
            'crystal': 'st_band_crystal', 'rare': 'st_band_rare'}
# vein mechanic per resource (spec 2.1.1) -> veins.json "type"
VEIN_TYPE = {'iron': 'drift', 'copper': 'drift', 'titanium': 'deep', 'crystal': 'singing', 'rare': 'fast'}
# per-kind overrides: vein count per shape, arc length range, nugget spacing / height
KIND_PARAMS = {
    # Kr "singing" veins: long, few, with sparse tall tuning crystals standing out of the seam
    'crystal': dict(count={'round': 1, 'elongated': 2, 'chunky': 2}, length=(2.6, 3.6), spacing=(0.62, 0.95),
                    nug_h=(1.9, 2.8)),
    # VZ "fast" veins: SHORT (1.2-1.8 u), three per rock, densely packed small emerald crystals
    'rare': dict(count={'round': 3, 'elongated': 3, 'chunky': 3}, length=(1.25, 1.8), spacing=(0.3, 0.42),
                 nug_h=(0.8, 1.1)),
}
UV_NAME = 'VeinUV'


class Vein:
    def __init__(self, pts, nrms, half_w, depth):
        self.pts = pts            # surface centreline points (Blender coords), SEGMENTS + 1
        self.nrms = nrms          # smoothed outward normals
        self.half_w = half_w      # floor half width per point
        self.depth = depth        # groove depth per point
        self.ridge = []           # fill ridge centreline (filled by fill_mesh)

    @property
    def length(self):
        return sum((b - a).length for a, b in zip(self.pts[:-1], self.pts[1:]))


def _smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def _resample(pts, n):
    """n + 1 points evenly spaced by arc length along the polyline."""
    acc = [0.0]
    for a, b in zip(pts[:-1], pts[1:]):
        acc.append(acc[-1] + (b - a).length)
    total = acc[-1]
    out, j = [], 0
    for i in range(n + 1):
        s = total * i / n
        while j < len(pts) - 2 and acc[j + 1] < s:
            j += 1
        seg = acc[j + 1] - acc[j]
        t = 0.0 if seg < 1e-9 else (s - acc[j]) / seg
        out.append(pts[j].lerp(pts[j + 1], min(1.0, max(0.0, t))))
    return out


def _smooth_vecs(vs, k=3, iters=1):
    for _ in range(iters):
        out = []
        for i in range(len(vs)):
            acc = Vector((0, 0, 0))
            for j in range(max(0, i - k), min(len(vs), i + k + 1)):
                acc += vs[j]
            out.append(acc.normalized())
        vs = out
    return vs


def _walk(bvh, p0, heading, length, step, curv, phase, wl, sign):
    """Walk on the surface from p0 along `heading`, turning around the local
    normal by a slowly varying curvature.  Returns points (excl. p0)."""
    pts = []
    p, h = p0.copy(), heading.copy()
    s = 0.0
    while s < length:
        loc, nrm, _, _ = bvh.find_nearest(p)
        n = nrm.normalized()
        h = (h - n * h.dot(n)).normalized()
        k = curv * (math.sin(2 * math.pi * s / wl + phase) + 0.35 * math.sin(2 * math.pi * s / (wl * 0.45) + 2 * phase))
        h = Matrix.Rotation(sign * k * step, 3, n) @ h
        q = loc + h * step
        loc2, nrm2, _, _ = bvh.find_nearest(q)
        if (loc2 - loc).length > step * 2.6 or (loc2 - loc).length < step * 0.3:
            return None       # jumped across a crevice / got stuck
        p = loc2
        pts.append(p.copy())
        s += step
    return pts


def plan(rock, rng, radius, shape, centres, others=(), count=None, kind=None):
    """Find `count` vein centrelines on `rock`.  Avoids crystal cluster
    centres and earlier veins; prefers the upper (camera-facing) side.
    kind: optional resource with KIND_PARAMS overrides (count, length)."""
    bpy.context.view_layer.update()
    bvh = BVHTree.FromObject(rock, bpy.context.evaluated_depsgraph_get())
    kp = KIND_PARAMS.get(kind, {})
    count = count or kp.get('count', COUNT)[shape]
    veins = []
    scale = max(0.85, min(1.25, radius / 2.0))
    clear_cl = radius * 0.36
    tries = 0
    while len(veins) < count and tries < 900:
        tries += 1
        d = S._rand_dir(rng)
        if d.z < 0.2 + 0.2 * (tries < 300):
            continue
        hit = bvh.ray_cast(d * radius * 3, -d)
        if hit[0] is None:
            continue
        mid, n = hit[0], hit[1].normalized()
        if n.z < 0.35:
            continue
        if 'length' in kp:
            L = rng.uniform(*kp['length'])
        else:
            L = max(2.2, min(4.0, radius * rng.uniform(1.15, 1.6)))
        t = n.orthogonal().normalized()
        t = Matrix.Rotation(rng.uniform(0, 2 * math.pi), 3, n) @ t
        curv, wl, ph = rng.uniform(0.4, 0.72), rng.uniform(1.9, 2.8), rng.uniform(0, 6.28)
        step = 0.035
        a = _walk(bvh, mid, t, L / 2, step, curv, ph, wl, 1)
        b = _walk(bvh, mid, -t, L / 2, step, curv, ph + math.pi, wl, -1)
        if a is None or b is None:
            continue
        pts = list(reversed(b)) + [mid.copy()] + a
        # constraints
        ok = True
        for p in pts:
            if any((p - c).length < clear_cl for c in centres):
                ok = False
                break
            if any(min((p - q).length for q in v.pts) < 0.55 * scale + 0.3 for v in veins + list(others)):
                ok = False
                break
        if not ok:
            continue
        chord = (pts[-1] - pts[0]).length
        if chord < 0.62 * L:          # too hooked / folding back
            continue
        # no near-parallel neighbours (reads as claw marks)
        cdir = (pts[-1] - pts[0]).normalized()
        if any(abs(cdir.dot((w.pts[-1] - w.pts[0]).normalized())) > 0.8 and
               min((p - q).length for p in pts[::4] for q in w.pts[::4]) < min(1.6, L * 0.9) for w in veins):
            continue
        nz = [bvh.find_nearest(p)[1].z for p in pts]
        if min(nz) < -0.25:
            continue
        pts = _resample(pts, SEGMENTS)
        nrms = []
        for p in pts:
            acc = Vector((0, 0, 0))
            for off in ((0, 0, 0), (0.06, 0, 0), (-0.06, 0, 0), (0, 0.06, 0), (0, -0.06, 0), (0, 0, 0.06),
                        (0, 0, -0.06)):
                acc += bvh.find_nearest(p + Vector(off))[1]
            nrms.append((acc.normalized() * 0.7 + p.normalized() * 0.3).normalized())
        nrms = _smooth_vecs(nrms, 3, 2)
        # width / depth profile: lens-shaped (ramps at the ends) + gentle variation
        o = rng.uniform(0, 100)
        hw, dp = [], []
        for i in range(SEGMENTS + 1):
            u = i / SEGMENTS
            taper = _smoothstep(0.0, 0.12, u) * _smoothstep(0.0, 0.12, 1 - u)
            var = 1.0 + 0.22 * noise.noise(Vector((u * 3.1 + o, o, 0.5)))
            hw.append(0.105 * scale * (0.55 + 0.45 * taper) * var)
            dp.append(0.13 * scale * taper)
        veins.append(Vein(pts, nrms, hw, dp))
    return veins


def _frames(v):
    """Per point: (tangent, side, normal) orthonormal frame."""
    out = []
    n_ = len(v.pts)
    for i in range(n_):
        a, b = v.pts[max(0, i - 1)], v.pts[min(n_ - 1, i + 1)]
        t = (b - a).normalized()
        n = v.nrms[i]
        s = t.cross(n).normalized()
        n = s.cross(t).normalized()
        out.append((t, s, n))
    return out


WALL_SLOPE = 0.95     # horizontal run per unit depth of the groove walls
CUT_UP = 0.30          # cutter rises this far above the surface
RIDGE = 0.45           # fill ridge height as a fraction of the groove depth


def cutter(v, name='Cutter'):
    """Closed swept trapezoid along the vein, extended past both ends with
    the floor rising above the surface (clean ramps)."""
    fr = _frames(v)
    rows = []
    pts = list(v.pts)
    # extension points beyond the ends
    ext = 0.12
    t0, t1 = fr[0][0], fr[-1][0]
    secs = [(pts[0] - t0 * ext, fr[0], v.half_w[0] * 0.8, -0.04)]
    for i in range(len(pts)):
        secs.append((pts[i], fr[i], v.half_w[i], v.depth[i]))
    secs.append((pts[-1] + t1 * ext, fr[-1], v.half_w[-1] * 0.8, -0.04))
    bm = bmesh.new()
    for p, (t, s, n), hw, d in secs:
        top_w = hw + (d + CUT_UP) * WALL_SLOPE
        ring = [p + s * (-top_w) + n * CUT_UP, p + s * top_w + n * CUT_UP,
                p + s * hw - n * d, p + s * (-hw) - n * d]
        rows.append([bm.verts.new(c) for c in ring])
    for A, B in zip(rows[:-1], rows[1:]):
        for k in range(4):
            j = (k + 1) % 4
            bm.faces.new((A[k], A[j], B[j], B[k]))
    bm.faces.new(list(reversed(rows[0])))
    bm.faces.new(rows[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    G.link(ob)
    return ob


def carve(rock, veins):
    """Boolean-difference all vein grooves out of the rock."""
    cutters = [cutter(v, f'Cutter{i}') for i, v in enumerate(veins)]
    for c in cutters:
        c.data.materials.append(rock.data.materials[0])
        mod = rock.modifiers.new('Groove', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.solver = 'EXACT'
        mod.object = c
        mod.material_mode = 'INDEX'
        G.apply_modifiers(rock)
    for c in cutters:
        bpy.data.objects.remove(c)
    return rock


def intersects(piece, veins, margin=0.05):
    """True if a dressing piece (crystal/nugget) sits in a groove."""
    bpy.context.view_layer.update()
    mw = piece.matrix_world
    pts = [mw @ Vector(c) for c in piece.bound_box] + [mw.translation]
    for v in veins:
        for p in pts:
            for i, q in enumerate(v.pts):
                if (p - q).length < v.half_w[i] + v.depth[i] * WALL_SLOPE + margin + 0.06:
                    return True
    return False


def fill_mesh(v, res, name, rng):
    """Faceted ore fill sitting on the groove floor: 3 vertices across
    (edge, ridge, edge), ridge height and position jittered per row so the
    top breaks into crystalline facets.  UV0 = atlas swatch (set by
    finalize), UV1 = VeinUV."""
    fr = _frames(v)
    bm = bmesh.new()
    uv_rows = []
    rows = []
    # faceted top: ridge height jitters per row so the fill catches light in facets
    jit = [1.0 + rng.uniform(-0.28, 0.28) for i in range(len(v.pts))]
    lats = [rng.uniform(-0.25, 0.25) for i in range(len(v.pts))]
    h_r = [max(0.012, v.depth[i] * RIDGE * jit[i]) for i in range(len(v.pts))]
    v.ridge = [v.pts[i] - fr[i][2] * v.depth[i] + fr[i][2] * h_r[i] for i in range(len(v.pts))]
    acc = [0.0]
    for a, b in zip(v.ridge[:-1], v.ridge[1:]):
        acc.append(acc[-1] + (b - a).length)
    total = acc[-1]
    v.u = [a / total for a in acc]
    for i, (p, (t, s, n)) in enumerate(zip(v.pts, fr)):
        hw, d = v.half_w[i], v.depth[i]
        floor = p - n * d
        w = hw * 0.97
        lat = lats[i] * w                           # ridge wanders a little -> crystalline facets
        prof = [(-w, 0.008), (lat, h_r[i]), (w, 0.008)]
        row = [bm.verts.new(floor + s * x + n * y) for x, y in prof]
        rows.append(row)
        uv_rows.append([(v.u[i], k / 2) for k in range(3)])
    faces = []
    for i in range(len(rows) - 1):
        A, B = rows[i], rows[i + 1]
        for k in range(2):     # split quads into triangles along alternating diagonals (facets)
            if (i + k) % 2:
                tris = ((A[k], A[k + 1], B[k + 1]), (A[k], B[k + 1], B[k]))
            else:
                tris = ((A[k], A[k + 1], B[k]), (A[k + 1], B[k + 1], B[k]))
            for tri in tris:
                faces.append((bm.faces.new(tri), (i, k)))
    bm.normal_update()
    # make sure faces point outward (along the local normal)
    for f, (i, k) in faces:
        if f.normal.dot(fr[i][2]) < 0:
            f.normal_flip()
    me = bpy.data.meshes.new(name)
    for e in bm.edges:   # flat faceted shading
        e.smooth = False
    bm.to_mesh(me)
    # UV layers: 0 = atlas (filled by finalize), 1 = VeinUV
    me.uv_layers.new(name='UVMap')
    vl = me.uv_layers.new(name=UV_NAME)
    coords = {}
    for i, row in enumerate(rows):
        for k in range(3):
            coords[i * 3 + k] = uv_rows[i][k]
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = False
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            vl.data[li].uv = coords[vi]
    me.materials.append(M.mat(FILL_KEY[res]))
    ob = bpy.data.objects.new(name, me)
    G.link(ob)
    return ob


NUGGET_KEY = {'iron': 'st_ore_iron', 'copper': 'st_ore_copper', 'titanium': 'st_ore_ti',
              'crystal': 'st_ore_crystal', 'rare': 'st_ore_rare'}


def _ridge_param(v, p):
    """u of the closest point on the ridge polyline to p."""
    best = (1e9, 0.0)
    for i in range(len(v.ridge) - 1):
        a, b = v.ridge[i], v.ridge[i + 1]
        ab = b - a
        t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
        d = (a + ab * t - p).length
        if d < best[0]:
            best = (d, v.u[i] + t * (v.u[i + 1] - v.u[i]))
    return best[1]


def add_nuggets(fill, v, res, rng):
    """Chunky ore crystals of the resource type (iron prisms, copper blocks,
    titanium blades) packed into the seam, tips just breaking the surface.
    Joined into the Vein mesh; their VeinUV = (u at their position, 0.5) so
    the active segment lights them up too."""
    import asteroids as A
    c = A.CRYSTAL[res]
    fr = _frames(v)
    total = v.length
    pieces = []
    u = rng.uniform(0.15, 0.3)
    k = 0
    while u < 0.86:
        x = u * SEGMENTS
        i = min(len(v.pts) - 2, int(x))
        f = x - i
        t, s, n = fr[i]
        hw, d = v.half_w[i], v.depth[i]
        floor = v.pts[i].lerp(v.pts[i + 1], f) - n * d
        L = d * rng.uniform(*KIND_PARAMS.get(res, {}).get('nug_h', (0.8, 1.2))) * (0.8 if res == 'copper' else 1.0)
        cr = S.crystal(f'{fill.name}_N{k}', L, L * c['w'] * 1.3, NUGGET_KEY[res], sides=c['sides'],
                       flat=c['flat'], tip=c['tip'])
        base = floor + s * rng.uniform(-0.45, 0.45) * hw
        dirn = (n + t * rng.uniform(-0.5, 0.5) + s * rng.uniform(-0.3, 0.3)).normalized()
        S.align(cr, base, dirn)
        pieces.append(cr)
        k += 1
        u += rng.uniform(*KIND_PARAMS.get(res, {}).get('spacing', (0.36, 0.62))) / total
    if not pieces:
        return fill
    name = fill.name
    ob = G.join([fill] + pieces, name)
    me = ob.data
    vl = me.uv_layers[UV_NAME]
    keys = [sl.material.get('palette_key') for sl in ob.material_slots]
    for poly in me.polygons:
        if keys[poly.material_index] != NUGGET_KEY[res]:
            continue
        uu = _ridge_param(v, poly.center)
        for li in poly.loop_indices:
            vl.data[li].uv = (uu, 0.5)
    return ob


def fill_colours(ob):
    """COLOR_0 for the fill: ridge 1.0 .. edges 0.62, darker toward the ends."""
    me = ob.data
    vl = me.uv_layers[UV_NAME]
    attr = me.color_attributes.new(S.COL, 'BYTE_COLOR', 'CORNER')
    for poly in me.polygons:
        for li in poly.loop_indices:
            u, vv = vl.data[li].uv
            a = abs(vv - 0.5) * 2              # 0 ridge .. 1 edge
            k = 1.0 - 0.38 * a ** 1.5
            end = _smoothstep(0.0, 0.08, u) * _smoothstep(0.0, 0.08, 1 - u)
            k *= 0.7 + 0.3 * end
            attr.data[li].color = (k, k, k, 1.0)
    me.color_attributes.active_color = attr


def groove_tint(ob, veins, res):
    """Tint the groove faces (walls + floor) in the rock's vertex colours:
    per FACE, so the walls read as a crisp dark rim around the ore fill
    (crevice colour of the resource, never black) with a faint warm ore glow
    toward the floor."""
    R_ = S.RES[res]
    me = ob.data
    attr = me.color_attributes.get(S.COL)
    if attr is None:
        return
    segs = []
    for v in veins:
        fr = _frames(v)
        for i in range(len(v.pts) - 1):
            segs.append((v.pts[i], v.pts[i + 1], v.half_w[i], v.depth[i], fr[i][2]))
    stain = R_['stain']
    m = max(R_['crev'])
    crev = [x / m for x in R_['crev']]
    for poly in me.polygons:
        p = poly.center
        best = None
        for a, b, hw, d, n in segs:
            ab = b - a
            t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
            q = a + ab * t
            dist = (p - q).length
            if best is None or dist < best[0]:
                best = (dist, hw, d, (p - q).dot(n))
        dist, hw, d, h = best
        open_w = hw + d * WALL_SLOPE
        if d < 0.012 or dist > open_w + 0.02 or h > -0.12 * d:
            continue
        depth_f = max(0.0, min(1.0, -h / d))          # 0 at the lip .. 1 at the floor
        for li in poly.loop_indices:
            c = attr.data[li].color
            col = [c[j] * (0.30 + 0.16 * (1 - depth_f)) * (0.6 + 0.4 * crev[j]) + 0.12 * depth_f * stain[j]
                   for j in range(3)]
            attr.data[li].color = (*[min(1.0, x) for x in col], 1.0)


def to_gltf(v):
    """Blender (x, y, z) -> glTF (x, z, -y)."""
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


JSON_SCHEMA = {
    'coords': 'model-local glTF coordinates (Y up, +X forward, +Z = Blender -Y); same frame as the rock root node',
    'veins[i].node': 'name of the child mesh node (Vein_<i>)',
    'veins[i].points': 'centreline of the ore fill at ridge height (the faceted ridge vertices wander up to +-0.25 halfWidth sideways), ordered along u; point k has u = cumulative chord length / length',
    'veins[i].u': 'u of each point (= TEXCOORD_1.u of the matching fill row)',
    'veins[i].normals': 'outward surface normal per point (unit)',
    'veins[i].length': 'polyline arc length in units (sum of chord lengths)',
    'veins[i].halfWidth': 'fill half width per point (groove opening is wider)',
    'veins[i].type': 'vein mechanic (spec 2.1.1): drift = Fe/Cu moving segment, deep = Ti, singing = Kr '
                     '(tone peak bonus), fast = VZ (short, fast segment)',
    'uv1': 'TEXCOORD_1 of Vein_<i>: u = normalised arc length 0..1 (matches points), v = 0..1 across the fill',
}


def json_entry(veins, kind=None):
    out = []
    for i, v in enumerate(veins):
        pts = v.ridge or v.pts
        length = sum((b - a).length for a, b in zip(pts[:-1], pts[1:]))
        out.append({'node': f'Vein_{i}', 'length': round(length, 4),
                    'points': [to_gltf(p) for p in pts],
                    'u': [round(x, 4) for x in v.u],
                    'normals': [to_gltf(n) for n in v.nrms],
                    'halfWidth': [round(w, 4) for w in v.half_w],
                    'type': VEIN_TYPE.get(kind, 'drift')})
    return {'veins': out}
