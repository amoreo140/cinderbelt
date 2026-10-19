"""Batch A "Depth and belts" (art audit 2026-10-16 section 6): far silhouettes for the depth layers,
ring-identity silhouette sets, belt-bed rocks under the asteroid fields and rubble chips.

Every set is ONE glb whose root is an empty and whose children are independent meshes, each
**centred on its own origin with bounding radius 1** (identity node transform, all overlapping at
the origin) - code takes `mesh.geometry` by node name and scales/rotates the instances itself.
AF_Palette atlas + COLOR_0 (AO, facet jitter, grime), flat shading, no lights.

  depth_rocks.glb           Far_Rock_0..7        all rings   A1  neutral grey-brown far rocks (120-260 tris)
  depth_ring2_scrap.glb     Far_Scrap_0..5       ring 2      A2  frontier-graveyard scrap (150-400 tris)
  depth_ring3_crystal.glb   Far_Crystal_0..5     ring 3      A3  slate + violet crystal clusters (150-350)
  depth_ring4_obsidian.glb  Far_Obsidian_0..5    ring 4      A4  obsidian blades / Forge-smith shards (150-350)
  bed_rocks.glb             Bed_<res>_<0..2>     per field   A5  non-minable belt-bed rocks (600-1500)
  rubble.glb                Rubble_0..7          all         A6  chips orbiting asteroids (40-120)
  scenery.json              manifest (sets, mesh list, per-ring mix, scale/depth/count suggestions)

  blender --background --factory-startup --python art/blender/scenery.py -- [--only rocks,scrap,crystal,obsidian,bed,rubble] [--no-optimize]

The optimizer post-step runs ONLY on public/assets/models/scenery/ (a temporary copy of
art/tools/optimize_assets.mjs restricted to that folder), so parallel art batches are not touched.
"""
import json
import math
import os
import random
import subprocess
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector, noise  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

import paths  # noqa: E402
import asteroid_styles as AS  # noqa: E402  (import-only: sculpt_bm, planar_cuts, crystal, surface_points)
from lib import export as E  # noqa: E402
from lib import geo as G  # noqa: E402
from lib import materials as M  # noqa: E402
from lib import palette as P  # noqa: E402

OUT = os.path.join(paths.MODELS, 'scenery')
MANIFEST = os.path.join(OUT, 'scenery.json')
# private atlas build dir: parallel art batches rewrite art/out/palette/ (same pixels, but file locks)
ATLAS = os.path.join(paths.OUT, 'palette_batch_a')


# ----------------------------------------------------------------------------
# generic helpers
# ----------------------------------------------------------------------------
def _clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def _rand_dir(rng):
    return AS._rand_dir(rng)


def bm_of(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    return bm


def remove(ob):
    me = ob.data
    bpy.data.objects.remove(ob)
    if me and me.users == 0:
        bpy.data.meshes.remove(me)


def rebuild(ob, fn):
    """Run fn(bm) on the object's mesh in place."""
    bm = bm_of(ob)
    fn(bm)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


def flat(ob):
    G.set_smooth(ob, False)
    return ob


def bar(name, p0, p1, w, mat, h=None, roll=0.0):
    """Box beam from p0 to p1 with a w x h section (12 tris)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    h = w if h is None else h
    ob = G.box(name, 0.0, d.length, -w / 2, w / 2, -h / 2, h / 2, mat)
    q = Vector((1, 0, 0)).rotation_difference(d.normalized())
    ob.data.transform(Matrix.Translation(p0) @ q.to_matrix().to_4x4() @ Matrix.Rotation(roll, 4, 'X'))
    return flat(ob)


def place(ob, loc=(0, 0, 0), rot=(0, 0, 0), scale=None):
    """Bake a transform into the mesh (rot in degrees, XYZ)."""
    m = Matrix.Translation(Vector(loc)) @ G._euler(rot)
    if scale is not None:
        m = m @ Matrix.Diagonal((*scale, 1.0))
    ob.data.transform(m)
    return ob


def loft(name, sections, mat_keys, face_mat=None, caps=True, cap_mat=0):
    """Closed loft through sections (equal-length lists of Vectors)."""
    bm = bmesh.new()
    rows = [[bm.verts.new(p) for p in sec] for sec in sections]
    n = len(sections[0])
    for i, (A, B) in enumerate(zip(rows[:-1], rows[1:])):
        for k in range(n):
            j = (k + 1) % n
            f = bm.faces.new((A[k], A[j], B[j], B[k]))
            f.material_index = face_mat(i, k) if face_mat else 0
    if caps:
        for row, rev in ((rows[0], True), (rows[-1], False)):
            f = bm.faces.new(list(reversed(row)) if rev else row)
            f.material_index = cap_mat
    ob = G.obj_from_bm(name, bm, mat_keys)
    return flat(ob)


def crystal(name, L, w, key, sides=6, flat_=1.0, tip=0.38, grad_max=1.0):
    """Prism crystal along +Z (root below z=0), gradient swatch scaled to grad_max (stay saturated)."""
    ob = AS.crystal(name, L, w, key, sides=sides, flat=flat_, bevel_w=0.0, tip=tip)
    lay = ob.data.attributes.get(M.GRAD_ATTR)
    if lay is not None and grad_max < 1.0:
        for d in lay.data:
            d.value *= grad_max
    return flat(ob)


def join(objs, name):
    ob = G.join(objs, name)
    return flat(ob)


def unitize(ob):
    """Centre on the bounding-box centre and scale to bounding radius 1. Returns the extents."""
    vs = [v.co.copy() for v in ob.data.vertices]
    mn = Vector([min(v[i] for v in vs) for i in range(3)])
    mx = Vector([max(v[i] for v in vs) for i in range(3)])
    c = (mn + mx) / 2
    r = max((v - c).length for v in vs)
    ob.data.transform(Matrix.Diagonal((1 / r, 1 / r, 1 / r, 1)) @ Matrix.Translation(-c))
    ob.data.update()
    return (mx - mn) / r


def remap(ob, table):
    """Swap logical swatches on an object (before finalize)."""
    for slot in ob.material_slots:
        k = slot.material.get('palette_key') if slot.material else None
        if k in table:
            slot.material = M.mat(table[k])
    return ob


# Far silhouettes sit under 55-80 % zone haze x the background dim: near-black swatches vanish
# into the sky (first pass: obsidian and dark scrap were invisible at depth 210). The far sets keep
# the same shapes and hues but use one step lighter swatches.
FAR_SCRAP_REMAP = {'der_dark': 'pir_gunmetal', 'pir_rust_dark': 'pir_rust', 'pir_gunmetal_dark': 'pir_gunmetal',
                   'char_black': 'scorch'}
FAR_OBSIDIAN_REMAP = {'kov_obsidian': 'sst_graphite'}


def tris(ob):
    return G.tri_count(ob)


def emissive_slots(ob):
    keys = [s.material.get('palette_key') if s.material else None for s in ob.material_slots]
    return [bool(k and P.BY_KEY[k].emit) for k in keys]


def shade(ob, rng, tint=(1.0, 1.0, 1.0), floor=0.45, jitter=0.14, ao_rays=16, ao_len=0.9, up=0.0,
          grime=0.0, grime_tint=(0.62, 0.5, 0.42), grime_scale=0.9, mult=1.0, crev_tint=None,
          stain=None, keep=()):
    """COLOR_0 (CORNER, BYTE): ray-cast AO x tint x per-face jitter x optional height gradient
    (`up` = how much darker the -Z side is) x grime blotches. Emissive faces and faces using a
    swatch in `keep` stay white. `stain` = (centres, colour, radius) tints around ore clusters."""
    me = ob.data
    emis = emissive_slots(ob)
    keys = [s.material.get('palette_key') if s.material else None for s in ob.material_slots]
    bpy.context.view_layer.update()
    bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
    dirs = []
    for i in range(ao_rays):
        u, v = (i + 0.5) / ao_rays, (i * 0.618034) % 1.0
        r_, th = math.sqrt(u), 2 * math.pi * v
        dirs.append((r_ * math.cos(th), r_ * math.sin(th), math.sqrt(max(0.0, 1 - u))))
    ao = []
    for vt in me.vertices:
        n = vt.normal
        t = n.orthogonal().normalized()
        b = n.cross(t)
        hits = 0
        for dx, dy, dz in dirs:
            d = (t * dx + b * dy + n * dz).normalized()
            if bvh.ray_cast(vt.co + n * 0.01, d, ao_len)[0] is not None:
                hits += 1
        ao.append(1.0 - hits / ao_rays)
    zs = [v.co.z for v in me.vertices]
    z0, z1 = min(zs), max(zs)
    off = Vector([rng.uniform(-50, 50) for _ in range(3)])
    attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    crev = crev_tint or tint
    for poly in me.polygons:
        mi = poly.material_index
        if (mi < len(emis) and emis[mi]) or (mi < len(keys) and keys[mi] in keep):
            for li in poly.loop_indices:
                attr.data[li].color = (1, 1, 1, 1)
            continue
        fj = 1.0 - rng.uniform(0.0, jitter)
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            p = me.vertices[vi].co
            a = ao[vi] ** 1.4
            k = (floor + (1 - floor) * a) * fj * mult
            if up:
                h = _clamp((p.z - z0) / max(1e-6, z1 - z0))
                k *= (1 - up) + up * h
            c = [crev[i] + (tint[i] - crev[i]) * a for i in range(3)]
            c = [c[i] * k for i in range(3)]
            if grime:
                g = _clamp((noise.fractal(p * grime_scale * 2.2 + off, 0.6, 2.0, 3) + 0.15) * 1.7) * grime
                c = [c[i] * (1 - g + g * grime_tint[i]) for i in range(3)]
            if stain:
                centres, col, rad = stain
                if centres:
                    dmin = min((p - cc).length for cc in centres)
                    s = 1.0 - AS._smoothstep(rad * 0.4, rad, dmin)
                    c = [c[i] * (1 - s + s * col[i]) for i in range(3)]
            attr.data[li].color = (min(1, c[0]), min(1, c[1]), min(1, c[2]), 1.0)
    me.color_attributes.active_color = attr
    return ob


def fit_budget(make, lo, hi, x0, tries=8):
    """make(x) -> object; x = a detail knob (bigger -> more tris). Rebuild until lo <= tris <= hi."""
    x = x0
    target = (lo + hi) / 2
    best = None
    for _ in range(tries):
        ob = make(x)
        t = tris(ob)
        if lo <= t <= hi:
            if best is not None:
                remove(best[0])
            return ob
        if best is None or abs(t - target) < abs(best[1] - target):
            if best is not None:
                remove(best[0])
            best = (ob, t)
        else:
            remove(ob)
        x *= max(0.4, min(2.5, (target / max(t, 1)) ** 0.9))
    print(f'WARNING budget: {best[0].name} {best[1]} tris outside {lo}-{hi}')
    return best[0]


def facet_rock(name, rng_seed, swatch, stretch, squash, ratio, cuts=(2, 4), dissolve=6.0, chamfer=0.03,
               chamfer_angle=28, subdiv=3, amp=0.28, detail=0.45, cut_depth=(0.76, 0.88), lobes=(1, 2)):
    """Style-C rock simplified: sculpted blob -> collapse decimate -> planar cuts (big flat facets)
    -> limited dissolve (merge near-coplanar) -> 1-segment chamfer. Unit-ish size (unitize later)."""
    rng = random.Random(rng_seed)
    bm = AS.sculpt_bm(rng, 1.0, subdiv=subdiv, amp=amp, detail=detail, craters=(1, 2), lobes=lobes,
                      stretch=stretch, squash=squash)
    tmp = G.obj_from_bm(name + '_tmp', bm, [swatch])
    AS.decimate(tmp, ratio=ratio)
    bm = bm_of(tmp)
    remove(tmp)
    AS.planar_cuts(bm, rng, rng.randint(*cuts), depth=cut_depth)
    if dissolve:
        bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(dissolve), verts=bm.verts, edges=bm.edges)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    ob = G.obj_from_bm(name, bm, [swatch])
    if chamfer:
        AS.bevel(ob, chamfer, 1, chamfer_angle, harden=False)
    return flat(ob)


def export_set(root_name, objs, filename):
    root = G.empty(root_name)
    for o in objs:
        o.parent = root
    bpy.context.view_layer.update()
    return E.export_glb(root, os.path.join(OUT, filename), vertex_colors=True)


def mesh_entry(ob, ext, **extra):
    # glTF axes: (x, y up, z) = Blender (x, z, -y)
    e = {'name': ob.name, 'tris': tris(ob), 'radius': 1.0,
         'size': [round(ext.x, 3), round(ext.z, 3), round(ext.y, 3)],
         'elongation': round(max(ext) / max(1e-6, min(ext)), 2)}
    e.update(extra)
    return e


# ----------------------------------------------------------------------------
# A1 - far rocks (all rings)
# ----------------------------------------------------------------------------
FAR_ROCKS = [  # kind, seed
    ('elongated', 101), ('elongated', 102), ('elongated', 103),
    ('slab', 201), ('slab', 202),
    ('chunky', 301), ('chunky', 302), ('chunky', 303),
]
FAR_SHAPE = {
    'elongated': dict(stretch=(1.75, 2.15), squash=(0.55, 0.7), cuts=(3, 4)),
    'slab':      dict(stretch=(1.25, 1.45), squash=(0.3, 0.38), cuts=(3, 4)),
    'chunky':    dict(stretch=(1.0, 1.15), squash=(0.72, 0.88), cuts=(4, 6)),
}
ROCK_SWATCH = 'base_concrete'            # neutral warm grey; COLOR_0 adds the brown and the AO
ROCK_TINT = (0.76, 0.69, 0.6)
ROCK_CREV = (0.42, 0.35, 0.31)


def build_rocks():
    objs, entries = [], []
    for i, (kind, seed) in enumerate(FAR_ROCKS):
        sh = FAR_SHAPE[kind]
        r0 = random.Random(seed * 3 + 1)
        stretch = r0.uniform(*sh['stretch'])

        def make(ratio, i=i, seed=seed, sh=sh, stretch=stretch):
            return facet_rock(f'Far_Rock_{i}', seed, ROCK_SWATCH, stretch, sh['squash'], ratio, cuts=sh['cuts'],
                              dissolve=7.0, chamfer=0.05, chamfer_angle=24)
        ob = fit_budget(make, 150, 240, 0.06)
        ob.name = ob.data.name = f'Far_Rock_{i}'
        ext = unitize(ob)
        shade(ob, random.Random(seed), tint=ROCK_TINT, crev_tint=ROCK_CREV, floor=0.4, jitter=0.26)
        G.finalize(ob, ATLAS)
        objs.append(ob)
        entries.append(mesh_entry(ob, ext, kind=kind))
    return objs, entries


# ----------------------------------------------------------------------------
# A2 - ring-2 scrap ("frontier graveyard")
# ----------------------------------------------------------------------------
def scrap_plate(name, rng):
    """Hull plate sheet with a bent-up corner, jagged torn edge and three ribs underneath."""
    nx, ny, W, H, T = 6, 4, 3.2, 2.0, 0.07
    bm = bmesh.new()
    grid = [[None] * (ny + 1) for _ in range(nx + 1)]
    for i in range(nx + 1):
        for j in range(ny + 1):
            x = (i / nx - 0.5) * W
            y = (j / ny - 0.5) * H
            edge = i in (0, nx) or j in (0, ny)
            if edge:                       # torn outline
                x += rng.uniform(-0.12, 0.12)
                y += rng.uniform(-0.1, 0.1)
            z = 0.0
            # bend: the +x/+y corner folds up around a diagonal crease
            s = (x / W + y / H) - 0.35
            if s > 0:
                z += s * 1.6
            z += 0.05 * math.sin(i * 1.7 + j)
            grid[i][j] = bm.verts.new((x, y, z))
    for i in range(nx):
        for j in range(ny):
            f = bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
            f.material_index = 0
    # stripe of faded orange trim along one edge
    for f in bm.faces:
        if f.calc_center_median().y < -H / 2 + H / ny:
            f.material_index = 2
    res = bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=T)
    inner = {g for g in res['geom'] if isinstance(g, bmesh.types.BMFace)}
    for f in inner:
        f.material_index = 1
    # knock out one torn hole
    hole = [f for f in bm.faces if f not in inner and (f.calc_center_median() - Vector((-0.6, 0.2, 0))).length < 0.35]
    if hole:
        bmesh.ops.delete(bm, geom=hole, context='FACES')
    ob = G.obj_from_bm(name, bm, ['der_plate', 'der_dark', 'der_rust'])
    parts = [ob]
    for k, x in enumerate((-1.0, 0.0, 0.9)):
        parts.append(bar(f'{name}_rib{k}', (x, -H * 0.48, -0.1), (x + rng.uniform(-0.1, 0.1), H * 0.3, -0.1),
                         0.12, 'der_dark', 0.14))
    return join(parts, name)


def scrap_girders(name, rng):
    """Bundle of two square trusses and an I-beam, splayed, with a snapped cross brace."""
    parts = []

    def truss(tag, p0, p1, w):
        p0, p1 = Vector(p0), Vector(p1)
        ax = (p1 - p0).normalized()
        a = ax.orthogonal().normalized()
        b = ax.cross(a)
        cs = [a * w + b * w, a * -w + b * w, a * -w + b * -w, a * w + b * -w]
        for ci, c in enumerate(cs):
            parts.append(bar(f'{tag}_l{ci}', p0 + c, p1 + c, 0.07, 'der_dark' if ci % 2 else 'pir_rust_dark'))
        n = 4
        for s in range(n):
            t0, t1 = s / n, (s + 0.5) / n
            q0 = p0.lerp(p1, t0)
            q1 = p0.lerp(p1, t1)
            parts.append(bar(f'{tag}_x{s}', q0 + cs[s % 4], q1 + cs[(s + 2) % 4], 0.05, 'der_dark'))
    truss('A', (-2.0, -0.2, 0.0), (2.1, 0.25, 0.25), 0.2)
    truss('B', (-1.7, 0.6, 0.35), (1.4, 0.95, -0.2), 0.16)
    # I-beam (prism of an I outline)
    w, h, t = 0.18, 0.26, 0.05
    pts = [(-w, -h), (w, -h), (w, -h + t), (t / 2, -h + t), (t / 2, h - t), (w, h - t), (w, h), (-w, h),
           (-w, h - t), (-t / 2, h - t), (-t / 2, -h + t), (-w, -h + t)]
    ib = G.prism(f'{name}_ib', pts, -1.9, 1.6, 'pir_rust')
    place(ib, loc=(0.1, -0.85, -0.25), rot=(rng.uniform(-8, 8), 90, rng.uniform(-14, -6)))
    parts.append(flat(ib))
    parts.append(bar(f'{name}_brace', (-0.4, -0.85, -0.2), (0.2, 0.75, 0.3), 0.08, 'pir_rust_dark'))
    return join(parts, name)


def scrap_container(name, rng):
    """Half a cargo container: open box shell sliced diagonally, corrugation ribs, bent door."""
    L, W, H, T = 3.0, 1.3, 1.3, 0.06
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(L, W, H), verts=bm.verts)
    top = [f for f in bm.faces if f.normal.z > 0.9]
    bmesh.ops.delete(bm, geom=top, context='FACES')      # open top (torn away)
    res = bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=T)
    inner = {g for g in res['geom'] if isinstance(g, bmesh.types.BMFace)}
    for f in bm.faces:
        f.material_index = 1 if f in inner else 0
    n = Vector((0.55, 0.0, 0.84)).normalized()
    bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                           plane_co=Vector((0.2, 0, 0.1)), plane_no=n, clear_outer=True)
    ob = G.obj_from_bm(name, bm, ['pir_rust', 'pir_gunmetal_dark'])
    parts = [ob]
    for k in range(5):     # corrugation ribs on the long sides (only where the shell survived)
        x = -L / 2 + 0.3 + k * 0.32
        ztop = min(H / 2, (0.1 - (x - 0.2) * n.x / n.z)) - 0.08
        if ztop < -H / 2 + 0.2:
            continue
        for sy in (-1, 1):
            parts.append(bar(f'{name}_r{k}{sy}', (x, sy * (W / 2 + 0.03), -H / 2 + 0.06), (x, sy * (W / 2 + 0.03), ztop),
                             0.07, 'pir_rust_dark'))
    door = G.box(f'{name}_door', 0, 1.05, -0.03, 0.03, -H / 2 + 0.05, H / 2 - 0.1, 'der_rust')
    place(door, loc=(-L / 2, -W / 2, 0), rot=(0, 0, -140))
    parts.append(flat(door))
    return join(parts, name)


def scrap_ring_arc(name, rng):
    """Snapped station-ring arc: rectangular band along 70 deg of a circle, jagged ends, dead
    window band on the outer face, two spoke stubs pointing inward."""
    R, w, h, n, arc = 3.2, 0.55, 0.38, 12, math.radians(72)
    secs = []
    for i in range(n + 1):
        a = -arc / 2 + arc * i / n
        c, s = math.cos(a), math.sin(a)
        jag = (i in (0, n))
        sec = []
        for (dr, dz) in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)):
            rr = R + dr
            da = rng.uniform(-0.09, 0.09) if jag else 0.0
            sec.append(Vector((rr * math.cos(a + da), rr * math.sin(a + da), dz + (rng.uniform(-0.08, 0.08) if jag else 0))))
        secs.append(sec)

    def fm(i, k):
        if k == 1:                # outer face: alternating dead windows / plate
            return 2 if i % 2 == 0 else 0
        if k == 2:
            return 0              # top deck
        return 1
    ob = loft(name, secs, ['der_plate', 'der_dark', 'der_dark'], face_mat=fm, cap_mat=1)
    parts = [ob]
    for k, a in enumerate((-0.18, 0.2)):
        c, s = math.cos(a), math.sin(a)
        parts.append(bar(f'{name}_sp{k}', (c * (R - w / 2), s * (R - w / 2), 0), (c * (R - 1.5), s * (R - 1.5), 0.05),
                         0.2, 'der_dark', 0.16))
    # a bleached orange belt on the top
    a0, a1 = -arc * 0.42, arc * 0.15
    belt = []
    for i in range(5):
        a = a0 + (a1 - a0) * i / 4
        belt.append([Vector(((R + dr) * math.cos(a), (R + dr) * math.sin(a), h / 2 + dz))
                     for dr, dz in ((-0.12, 0.0), (0.12, 0.0), (0.12, 0.03), (-0.12, 0.03))])
    parts.append(loft(f'{name}_belt', belt, ['der_rust']))
    ob = join(parts, name)
    place(ob, loc=(-R, 0, 0))
    return ob


def scrap_drive(name, rng):
    """Dead three-bell drive block: scorched mount with three cold engine bells and a torn frame."""
    parts = [flat(G.box(f'{name}_mount', -0.9, 0.5, -0.95, 0.95, -0.45, 0.45, 'pir_gunmetal_dark'))]
    for k, (y, z) in enumerate(((-0.55, -0.15), (0.55, -0.15), (0.0, 0.32))):
        bell = G.lathe(f'{name}_b{k}', [(0.0, 0.26), (-0.95, 0.46), (-0.95, 0.4), (-0.05, 0.2)], [0, 0, 1, 1],
                       ['pir_gunmetal', 'char_black'], loc=(-0.9, y, z), axis='X', verts=8, smooth=False)
        parts.append(flat(bell))
    # torn frame girders sticking forward
    parts.append(bar(f'{name}_g0', (0.5, -0.6, 0.3), (1.6, -0.45, 0.42), 0.12, 'der_dark'))
    parts.append(bar(f'{name}_g1', (0.5, 0.65, 0.25), (1.25, 0.9, 0.0), 0.12, 'pir_rust_dark'))
    parts.append(flat(G.box(f'{name}_plate', 0.5, 0.62, -0.9, 0.7, -0.4, 0.42, 'scorch')))
    return join(parts, name)


def scrap_hull(name, rng):
    """Crumpled hull section: half a cylinder shell with ribs, one torn end and a buckled panel."""
    R, L, nseg, nl = 1.0, 2.8, 7, 4
    bm = bmesh.new()
    rows = []
    for i in range(nl + 1):
        x = -L / 2 + L * i / nl
        row = []
        for k in range(nseg + 1):
            a = math.pi * k / nseg
            rr = R * (1 + (0.12 * math.sin(k * 2.1 + i) if i == nl else 0.0))
            dx = rng.uniform(-0.25, 0.25) if i == nl else 0.0
            buck = -0.18 if (i == 2 and k in (3, 4)) else 0.0
            row.append(bm.verts.new((x + dx, (rr + buck) * math.cos(a), (rr + buck) * math.sin(a))))
        rows.append(row)
    for i in range(nl):
        for k in range(nseg):
            f = bm.faces.new((rows[i][k], rows[i + 1][k], rows[i + 1][k + 1], rows[i][k + 1]))
            f.material_index = 2 if (k == 1 and i < 3) else 0
    res = bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=0.07)
    for g in res['geom']:
        if isinstance(g, bmesh.types.BMFace):
            g.material_index = 1
    ob = G.obj_from_bm(name, bm, ['der_plate', 'der_dark', 'der_rust'])
    parts = [ob]
    for i in range(3):       # ribs
        x = -L / 2 + 0.25 + i * 0.85
        rib = []
        for k in range(nseg + 1):
            a = math.pi * k / nseg
            rib.append([Vector((x + dx, (R - 0.02 - dr) * math.cos(a), (R - 0.02 - dr) * math.sin(a)))
                        for dx, dr in ((-0.06, 0.0), (0.06, 0.0), (0.06, 0.16), (-0.06, 0.16))])
        parts.append(loft(f'{name}_rib{i}', rib, ['der_dark']))
    return join(parts, name)


SCRAP = [('plate', scrap_plate, 11), ('girders', scrap_girders, 12), ('container', scrap_container, 13),
         ('ring_arc', scrap_ring_arc, 14), ('drive', scrap_drive, 15), ('hull', scrap_hull, 16)]


def build_scrap():
    objs, entries = [], []
    for i, (kind, fn, seed) in enumerate(SCRAP):
        rng = random.Random(seed)
        ob = fn(f'Far_Scrap_{i}', rng)
        remap(ob, FAR_SCRAP_REMAP)
        ext = unitize(ob)
        shade(ob, rng, tint=(1.0, 0.97, 0.93), floor=0.6, jitter=0.12, grime=0.25, grime_scale=1.1,
              grime_tint=(0.55, 0.42, 0.34))
        G.finalize(ob, ATLAS)
        objs.append(ob)
        entries.append(mesh_entry(ob, ext, kind=kind))
    return objs, entries


# ----------------------------------------------------------------------------
# A3 - ring-3 crystal clusters on slate
# ----------------------------------------------------------------------------
SLATE = 'st_rock_crystal'
CRYS = 'st_ore_crystal'
CRYS_GRAD = 0.5          # use only the saturated half of the gradient (haze + AgX/ACES wash pale tips white)


def _slate(name, seed, stretch, squash, ratio=0.05, cuts=(2, 3)):
    return facet_rock(name, seed, SLATE, stretch, squash, ratio, cuts=cuts, dissolve=6.0, chamfer=0.03,
                      chamfer_angle=28)


def _cluster(tag, rng, root, normal, n, L, w, spread=0.55, sides=5):
    out = []
    for j in range(n):
        big = 1.0 if j == 0 else rng.uniform(0.45, 0.8)
        cr = crystal(f'{tag}{j}', L * big, w * big, CRYS, sides=sides, grad_max=CRYS_GRAD)
        d = (normal + Vector([rng.uniform(-spread, spread) for _ in range(3)]) * (0 if j == 0 else 1)).normalized()
        off = Vector([rng.uniform(-1, 1) for _ in range(3)]) * w * 1.2 * (j > 0)
        AS.align(cr, root + off, d)
        G.bake_transform(cr)
        out.append(flat(cr))
    return out


def crystal_slate_cluster(name, rng):
    base = _slate(name, 401, 1.4, (0.55, 0.65))
    parts = [base]
    parts += _cluster(f'{name}_c', rng, Vector((0.1, 0.0, 0.42)), Vector((0.15, -0.1, 1)), 4, 1.3, 0.2)
    return join(parts, name)


def crystal_spears(name, rng):
    base = _slate(name, 402, 1.0, (0.7, 0.85), ratio=0.035, cuts=(2, 2))
    place(base, scale=(0.55, 0.55, 0.55))
    parts = [base]
    for k in range(5):
        a = 2 * math.pi * k / 5 + rng.uniform(-0.3, 0.3)
        d = Vector((math.cos(a), math.sin(a), rng.uniform(-0.4, 0.6))).normalized()
        cr = crystal(f'{name}_s{k}', rng.uniform(1.1, 1.6), rng.uniform(0.14, 0.2), CRYS, sides=5, grad_max=CRYS_GRAD)
        AS.align(cr, d * 0.25, d)
        G.bake_transform(cr)
        parts.append(flat(cr))
    return join(parts, name)


def crystal_geode(name, rng):
    """Split geode: half a slate rock whose flat cut face grows a crystal bed."""
    rs = random.Random(403)
    bm = AS.sculpt_bm(rs, 1.0, subdiv=3, amp=0.22, detail=0.4, craters=(0, 1), lobes=(1, 1), stretch=1.2,
                      squash=(0.8, 0.9))
    tmp = G.obj_from_bm(name + '_tmp', bm, [SLATE])
    AS.decimate(tmp, ratio=0.06)
    bm = bm_of(tmp)
    remove(tmp)
    res = bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                                 plane_co=(0, 0, 0.05), plane_no=(0, 0, 1), clear_outer=True)
    edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
    if edges:
        bmesh.ops.edgenet_fill(bm, edges=edges)
    for f in bm.faces:
        f.material_index = 1 if f.normal.z > 0.95 and f.calc_center_median().z > 0.0 else 0
    base = G.obj_from_bm(name, bm, [SLATE, 'accent_crystal_dark'])
    AS.bevel(base, 0.03, 1, 28, harden=False)
    parts = [flat(base)]
    for k in range(7):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0.0, 0.6)
        p = Vector((math.cos(a) * r * 1.1, math.sin(a) * r * 0.75, 0.0))
        d = (Vector((0, 0, 1)) + p * 0.6 + Vector([rng.uniform(-0.25, 0.25) for _ in range(3)])).normalized()
        L = rng.uniform(0.45, 0.85) * (1.3 if k == 0 else 1.0)
        cr = crystal(f'{name}_g{k}', L, L * 0.2, CRYS, sides=5, grad_max=CRYS_GRAD)
        AS.align(cr, p, d)
        G.bake_transform(cr)
        parts.append(flat(cr))
    return join(parts, name)


def crystal_slab_row(name, rng):
    base = _slate(name, 404, 1.5, (0.3, 0.36), ratio=0.05, cuts=(2, 3))
    parts = [base]
    for k, x in enumerate((-0.7, -0.15, 0.45)):
        d = Vector((rng.uniform(-0.3, 0.3), -0.35 + rng.uniform(-0.2, 0.2), 1)).normalized()
        parts += _cluster(f'{name}_c{k}', rng, Vector((x, 0.25, 0.22)), d, 2, rng.uniform(0.75, 1.05), 0.15)
    return join(parts, name)


def crystal_lone(name, rng):
    """One big double-terminated crystal through a slate collar."""
    parts = []
    for k, d in enumerate((Vector((0.25, 0.1, 1)), Vector((-0.25, -0.1, -1)))):
        cr = crystal(f'{name}_m{k}', 1.6 if k == 0 else 1.1, 0.34 if k == 0 else 0.3, CRYS, sides=6,
                     grad_max=CRYS_GRAD)
        AS.align(cr, Vector((0, 0, 0)), d.normalized())
        G.bake_transform(cr)
        parts.append(flat(cr))
    collar = _slate(name + '_col', 405, 1.2, (0.55, 0.65), ratio=0.04, cuts=(2, 2))
    place(collar, scale=(0.62, 0.62, 0.62))
    parts.insert(0, collar)
    parts += _cluster(f'{name}_s', rng, Vector((0.3, 0.2, 0.15)), Vector((1, 0.6, 0.6)), 2, 0.6, 0.12)
    ob = join(parts, name)
    ob.name = name
    return ob


def crystal_shard(name, rng):
    base = _slate(name, 406, 2.1, (0.45, 0.55), ratio=0.045, cuts=(2, 3))
    parts = [base]
    parts += _cluster(f'{name}_a', rng, Vector((0.9, 0.0, 0.2)), Vector((1, 0.2, 0.9)), 4, 1.3, 0.22)
    parts += _cluster(f'{name}_b', rng, Vector((-0.85, 0.05, 0.15)), Vector((-1, -0.3, 0.9)), 3, 1.0, 0.2)
    return join(parts, name)


CRYSTAL = [('slate_cluster', crystal_slate_cluster, 31), ('spears', crystal_spears, 32), ('geode', crystal_geode, 33),
           ('slab_row', crystal_slab_row, 34), ('lone', crystal_lone, 35), ('shard', crystal_shard, 36)]


def build_crystal():
    objs, entries = [], []
    for i, (kind, fn, seed) in enumerate(CRYSTAL):
        rng = random.Random(seed)
        ob = fn(f'Far_Crystal_{i}', rng)
        ob.name = f'Far_Crystal_{i}'
        ob.data.name = ob.name
        ext = unitize(ob)
        shade(ob, rng, tint=(0.95, 0.94, 1.0), crev_tint=(0.36, 0.3, 0.5), floor=0.5, jitter=0.14)
        G.finalize(ob, ATLAS)
        objs.append(ob)
        entries.append(mesh_entry(ob, ext, kind=kind))
    return objs, entries


# ----------------------------------------------------------------------------
# A4 - ring-4 obsidian blades / split Forge-smith shards
# ----------------------------------------------------------------------------
OBS = 'kov_obsidian'
EMBER_DEAD = 'st_ore_iron'      # dull orange-red, emission 0.9 (kov_ember is 4.0 - far too hot for a dead scar)
BRONZE = 'kov_bronze'


def blade_loft(name, L, w, t, bend=0.25, n=8, twist=0.0, tip0=0.06, tip1=0.02, mat_keys=(OBS,), face_mat=None,
               sweep=0.0):
    """Leaf blade along +X: diamond section (w wide in Y, t thick in Z), pointed at both ends,
    bent upward by `bend` (fraction of L) and swept sideways by `sweep`."""
    secs = []
    for i in range(n + 1):
        u = i / n
        x = (u - 0.5) * L
        prof = math.sin(math.pi * u) ** 0.7
        ww = max(tip0 if i == 0 else tip1, w * prof)
        tt = max(0.02, t * prof)
        z = bend * L * (math.sin(math.pi * u) - 0.5) * 0.6 + bend * L * (u - 0.5) * 0.5
        y = sweep * L * (u - 0.5) ** 2 * 2
        a = twist * (u - 0.5)
        ca, sa = math.cos(a), math.sin(a)
        sec = []
        for (dy, dz) in ((ww, 0.0), (0.0, tt), (-ww, 0.0), (0.0, -tt * 0.7)):
            sec.append(Vector((x, y + dy * ca - dz * sa, z + dy * sa + dz * ca)))
        secs.append(sec)
    return loft(name, secs, list(mat_keys), face_mat=face_mat)


def scar(name, pts, w=0.05):
    """Thin dead-ember scar strip along a polyline (dash rhythm long-short-short)."""
    out = []
    pattern = (1.0, 0.45, 0.45)
    total = sum((b - a).length for a, b in zip(pts[:-1], pts[1:]))
    seg = total / 5.2
    s = 0.0
    k = 0

    def at(d):
        acc = 0.0
        for a, b in zip(pts[:-1], pts[1:]):
            ln = (b - a).length
            if acc + ln >= d:
                return a.lerp(b, (d - acc) / max(1e-6, ln))
            acc += ln
        return pts[-1]
    while s < total * 0.98:
        ln = pattern[k % 3] * seg
        e = min(total, s + ln)
        out.append(bar(f'{name}{k}', at(s), at(e), w, EMBER_DEAD, w * 0.8))
        s = e + seg * 0.32
        k += 1
    return out


def _bvh(ob):
    bpy.context.view_layer.update()
    return BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())


def project_down(ob, pts_xy, lift=0.01):
    """Surface points under (x, y) seen from above (+Z), lifted along the normal."""
    bvh = _bvh(ob)
    out = []
    for x, y in pts_xy:
        hit, n, _, _ = bvh.ray_cast(Vector((x, y, 20.0)), Vector((0, 0, -1)), 50.0)
        if hit is not None:
            out.append(hit + n * lift)
    return out


def project_radial(ob, dirs, centre=(0, 0, 0), lift=0.01):
    """Surface points hit by rays from far outside toward `centre` along -d."""
    bvh = _bvh(ob)
    c = Vector(centre)
    out = []
    for d in dirs:
        d = Vector(d).normalized()
        hit, n, _, _ = bvh.ray_cast(c + d * 20.0, -d, 50.0)
        if hit is not None:
            out.append(hit + n * lift)
    return out


def obs_leaf(name, rng):
    b = blade_loft(name, 3.4, 0.55, 0.22, bend=0.12, n=12, twist=0.5, sweep=0.12, mat_keys=(OBS, BRONZE),
                   face_mat=lambda i, k: 1 if k == 0 and 2 <= i <= 9 else 0)
    parts = [b]
    parts += scar(f'{name}_s', project_down(b, [(-1.25, 0.0), (-0.4, 0.04), (0.4, 0.06), (1.15, 0.1)]))
    return join(parts, name)


def obs_trident(name, rng):
    """Three short blades from a common faceted root (3-fold)."""
    parts = []
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.2
        b = blade_loft(f'{name}_b{k}', 2.0, 0.36, 0.16, bend=0.18, twist=0.3)
        b.data.transform(Matrix.Translation((1.0, 0, 0)))
        place(b, rot=(0, -28, math.degrees(a)))
        parts.append(b)
    core = G.ellipsoid(f'{name}_core', 0.32, 0.32, 0.42, OBS, seg=6, rings=4, smooth=False)
    parts.append(flat(core))
    ring = G.ring_band(f'{name}_band', 0.4, 0.33, -0.05, 0.05, BRONZE, loc=(0, 0, 0.15), verts=9, smooth=False)
    parts.append(flat(ring))
    return join(parts, name)


def obs_broken(name, rng):
    """Broken blade: one long blade with a snapped jagged end, the tip drifting beside it."""
    b = blade_loft(name, 3.6, 0.5, 0.2, bend=0.08, twist=0.3, mat_keys=(OBS, BRONZE),
                   face_mat=lambda i, k: 1 if k == 3 and 1 <= i <= 5 else 0)

    def snap(bm):
        res = bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                                     plane_co=(0.75, 0, 0), plane_no=Vector((1, 0.35, 0.2)).normalized(),
                                     clear_outer=True)
        edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        if edges:
            bmesh.ops.edgenet_fill(bm, edges=edges)
    rebuild(b, snap)
    tip = blade_loft(f'{name}_tip', 1.3, 0.3, 0.12, bend=0.0, twist=0.0)
    place(tip, loc=(1.75, 0.45, 0.2), rot=(15, 10, 22))
    parts = [b, tip]
    parts += scar(f'{name}_s', project_down(b, [(-1.4, 0.0), (-0.4, 0.0), (0.55, 0.0)]))
    return join(parts, name)


def obs_rock(name, rng):
    """Faceted obsidian lump with a crack network of dead ember (cinder of a forge)."""
    ob = facet_rock(name, 501, OBS, 1.5, (0.55, 0.65), 0.05, cuts=(3, 4), dissolve=6.0, chamfer=0.025)
    parts = [ob]
    for k in range(3):
        d0 = _rand_dir(rng)
        d0.z = abs(d0.z) + 0.3
        d0.normalize()
        t = d0.orthogonal().normalized()
        dirs = [(d0 + t * (s - 0.5) * 0.9 + d0.cross(t) * 0.12 * math.sin(s * 5)) for s in (0.0, 0.25, 0.5, 0.75, 1.0)]
        parts += scar(f'{name}_s{k}', project_radial(ob, dirs), w=0.04)
    return join(parts, name)


def obs_claw(name, rng):
    """Curved claw rib (part of a Forge-smith cage) with a bronze edge inlay."""
    secs = []
    n = 12
    R = 2.0
    for i in range(n + 1):
        u = i / n
        a = math.radians(-60 + 120 * u)
        prof = 0.25 + 0.75 * math.sin(math.pi * min(1.0, u * 1.15)) ** 0.6
        w, t = 0.34 * prof + 0.03, 0.2 * prof + 0.02
        c = Vector((R * math.cos(a), 0, R * math.sin(a)))
        rad = Vector((math.cos(a), 0, math.sin(a)))
        side = Vector((0, 1, 0))
        secs.append([c + side * w, c + rad * t, c - side * w, c - rad * t * 0.6])

    def fm(i, k):
        return 1 if k == 0 and 3 <= i <= 8 else 0
    ob = loft(name, secs, [OBS, BRONZE], face_mat=fm)
    parts = [ob]
    collar = G.ring_band(f'{name}_col', 0.42, 0.3, -0.06, 0.06, BRONZE, verts=6, smooth=False)
    place(collar, loc=(R * math.cos(math.radians(-48)), 0, R * math.sin(math.radians(-48))), rot=(0, 48 + 90, 0))
    parts.append(flat(collar))
    dirs = [Vector((math.cos(math.radians(a)), 0.08, math.sin(math.radians(a)))) for a in (-40, -15, 10, 35)]
    parts += scar(f'{name}_s', project_radial(ob, dirs), w=0.04)
    return join(parts, name)


def obs_pair(name, rng):
    """Two levitating diamond shards, one above the other (split shard, 3-fold facets)."""
    parts = []
    for k, (z, s, rz) in enumerate(((0.0, 1.0, 0), (1.25, 0.6, 40))):
        bm = bmesh.new()
        ring = [bm.verts.new((0.55 * s * math.cos(2 * math.pi * j / 3), 0.55 * s * math.sin(2 * math.pi * j / 3), 0))
                for j in range(3)]
        top = bm.verts.new((0, 0, 0.45 * s))
        bot = bm.verts.new((0, 0, -1.25 * s))
        for j in range(3):
            jj = (j + 1) % 3
            bm.faces.new((ring[j], ring[jj], top))
            bm.faces.new((ring[jj], ring[j], bot))
        sh = G.obj_from_bm(f'{name}_p{k}', bm, [OBS])
        AS.bevel(sh, 0.04 * s, 1, 20, harden=False)
        place(sh, loc=(0.1 * k, 0, z), rot=(0, 0, rz))
        parts.append(flat(sh))
        e = G.ring_band(f'{name}_e{k}', 0.62 * s, 0.56 * s, -0.03, 0.03, BRONZE, verts=6, smooth=False)
        place(e, loc=(0.1 * k, 0, z), rot=(0, 0, rz))
        parts.append(flat(e))
    parts += scar(f'{name}_s', project_radial(parts[0], [(0.2, -1, 0.1), (0.15, -1, -0.5), (0.1, -1, -1.2)]), w=0.04)
    return join(parts, name)


OBSIDIAN = [('leaf', obs_leaf, 41), ('trident', obs_trident, 42), ('broken', obs_broken, 43),
            ('cinder', obs_rock, 44), ('claw', obs_claw, 45), ('pair', obs_pair, 46)]


def build_obsidian():
    objs, entries = [], []
    for i, (kind, fn, seed) in enumerate(OBSIDIAN):
        rng = random.Random(seed)
        ob = fn(f'Far_Obsidian_{i}', rng)
        ob.name = f'Far_Obsidian_{i}'
        ob.data.name = ob.name
        remap(ob, FAR_OBSIDIAN_REMAP)
        ext = unitize(ob)
        shade(ob, rng, tint=(1.0, 1.0, 1.0), crev_tint=(0.7, 0.66, 0.72), floor=0.7, jitter=0.08)
        G.finalize(ob, ATLAS)
        objs.append(ob)
        entries.append(mesh_entry(ob, ext, kind=kind))
    return objs, entries


# ----------------------------------------------------------------------------
# A5 - belt-bed rocks (non-minable, under the asteroid fields)
# ----------------------------------------------------------------------------
BED_RES = ['iron', 'copper', 'ice', 'titanium', 'crystal', 'rare']
BED_ORE = {   # small accent clusters: swatch, sides, flat, tip, width factor, gradient max
    'iron':     ('st_ore_iron', 6, 1.0, 0.38, 0.2, 1.0),       # emission 0.9
    'copper':   ('st_ore_copper', 4, 1.0, 0.12, 0.3, 1.0),     # emission 0.7
    'ice':      ('ice_crust_blue', 6, 1.0, 0.38, 0.2, 1.0),    # no emission (st_ice_crystal is 1.6)
    'titanium': ('st_ore_ti', 4, 0.5, 0.38, 0.2, 1.0),         # emission 0.7
    'crystal':  ('cr_gem', 5, 1.0, 0.38, 0.2, 0.6),            # emission 1.0, gradient kept violet
    'rare':     ('accent_exotic_dark', 6, 1.0, 0.38, 0.2, 1.0),  # dull emerald, no emission
}
BED_SHAPE = [  # (stretch, squash, cuts) for variants 0..2: round, elongated, table slab
    (1.1, (0.7, 0.82), (5, 7)),
    (1.75, (0.55, 0.68), (5, 6)),
    (1.35, (0.36, 0.44), (5, 7)),
]
BED_DARK = 0.55           # COLOR_0 multiplier vs the minable rocks (greyscale rule: minable stays brightest)


def bed_rock(name, res, variant, seed):
    R_ = AS.RES[res]
    stretch, squash, cuts = BED_SHAPE[variant]

    def make(ratio):
        return facet_rock(name, seed, R_['rock'], stretch, squash, ratio, cuts=cuts, dissolve=4.0, chamfer=0.03,
                          chamfer_angle=18, subdiv=4, amp=0.26, detail=0.5, cut_depth=(0.8, 0.9), lobes=(2, 3))
    rock = fit_budget(make, 600, 1250, 0.07)
    unitize(rock)
    rng = random.Random(seed + 7)
    key, sides, fl, tip, wf, gmax = BED_ORE[res]
    pieces, centres = [], []
    bpy.context.view_layer.update()
    for ci, (p, n) in enumerate(AS.surface_points(rock, rng, rng.randint(1, 2), 1.0, bias=Vector((0, 0, 1)),
                                                   spacing=0.8)):
        centres.append(p)
        for j in range(rng.randint(2, 4)):
            big = 1.0 if j == 0 else rng.uniform(0.5, 0.8)
            L = 0.3 * big
            cr = crystal(f'{name}_c{ci}{j}', L, L * wf, key, sides=sides, flat_=fl, tip=tip, grad_max=gmax)
            d = (n + Vector([rng.uniform(-0.6, 0.6) for _ in range(3)]) * (0 if j == 0 else 1)).normalized()
            off = Vector([rng.uniform(-1, 1) for _ in range(3)]) * 0.06 * (j > 0)
            AS.align(cr, p + off - n * 0.03, d)
            G.bake_transform(cr)
            pieces.append(flat(cr))
    ob = join([rock] + pieces, name)
    unitize(ob)
    stain = (centres, R_['stain'], 0.45)
    shade(ob, rng, tint=R_['tint'], crev_tint=R_['crev'], floor=0.5, jitter=0.14, up=0.25, mult=BED_DARK,
          stain=stain)
    G.finalize(ob, ATLAS)
    return ob


def build_bed():
    objs, entries = [], []
    for ri, res in enumerate(BED_RES):
        for v in range(3):
            name = f'Bed_{res}_{v}'
            ob = bed_rock(name, res, v, 600 + ri * 10 + v)
            vs = [x.co for x in ob.data.vertices]
            ext = Vector([max(p[i] for p in vs) - min(p[i] for p in vs) for i in range(3)])
            objs.append(ob)
            entries.append(mesh_entry(ob, ext, resource=res, kind=['round', 'elongated', 'table'][v]))
    return objs, entries


# ----------------------------------------------------------------------------
# A6 - rubble chips (orbiting asteroids)
# ----------------------------------------------------------------------------
RUBBLE = [  # kind, seed, axes (x, y, z), points
    ('chip', 71, (1.0, 0.8, 0.62), 11), ('chip', 72, (1.0, 0.9, 0.7), 13), ('chip', 73, (1.0, 0.7, 0.55), 10),
    ('flake', 74, (1.0, 0.75, 0.24), 12), ('flake', 75, (1.0, 0.6, 0.2), 10),
    ('shard', 76, (1.0, 0.36, 0.3), 9), ('shard', 77, (1.0, 0.42, 0.26), 10),
    ('chunk', 78, (1.0, 0.95, 0.85), 14),
]


def rubble_chip(name, seed, axes, npts):
    rng = random.Random(seed)
    bm = bmesh.new()
    for _ in range(npts):
        d = _rand_dir(rng)
        r = rng.uniform(0.75, 1.0)
        bm.verts.new((d.x * axes[0] * r, d.y * axes[1] * r, d.z * axes[2] * r))
    bmesh.ops.convex_hull(bm, input=list(bm.verts))
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(8), verts=bm.verts, edges=bm.edges)
    ob = G.obj_from_bm(name, bm, ['base_concrete'])
    AS.bevel(ob, 0.06, 1, 35, harden=False)
    return flat(ob)


def build_rubble():
    objs, entries = [], []
    for i, (kind, seed, axes, npts) in enumerate(RUBBLE):
        ob = rubble_chip(f'Rubble_{i}', seed, axes, npts)
        ext = unitize(ob)
        shade(ob, random.Random(seed), tint=(1, 1, 1), floor=0.55, jitter=0.2, ao_rays=8)
        G.finalize(ob, ATLAS)
        objs.append(ob)
        entries.append(mesh_entry(ob, ext, kind=kind))
    return objs, entries


# ----------------------------------------------------------------------------
# sets, manifest, optimizer
# ----------------------------------------------------------------------------
SETS = {   # id -> (file, root node, builder, ring, budget)
    'rocks':    ('depth_rocks.glb', 'Depth_Rocks', build_rocks, 'all', (120, 260)),
    'scrap':    ('depth_ring2_scrap.glb', 'Depth_Ring2_Scrap', build_scrap, 2, (150, 400)),
    'crystal':  ('depth_ring3_crystal.glb', 'Depth_Ring3_Crystal', build_crystal, 3, (150, 350)),
    'obsidian': ('depth_ring4_obsidian.glb', 'Depth_Ring4_Obsidian', build_obsidian, 4, (150, 350)),
    'bed':      ('bed_rocks.glb', 'Bed_Rocks', build_bed, 'per field', (600, 1500)),
    'rubble':   ('rubble.glb', 'Rubble', build_rubble, 'all', (40, 120)),
}

USE = {
    'rocks': 'Far silhouettes in the DepthLayers debris layers (all rings) - replaces the 80-tri lumpy icosahedron.',
    'scrap': 'Ring-2 identity ("frontier graveyard"): mixed into the ring-2 depth layers.',
    'crystal': 'Ring-3 identity: crystal clusters on slate, mixed into the ring-3 depth layers.',
    'obsidian': 'Ring-4 identity: obsidian blades / split Kovaci shards, mixed into the ring-4 depth layers.',
    'bed': 'Belt bed: large NON-minable rocks 4-30 units below each asteroid field (render-only, no collision).',
    'rubble': 'Chips orbiting asteroids near the camera (AsteroidDust) - replaces IcosahedronGeometry(1, 0).',
}

# DepthLayers.DEBRIS_LAYERS (src/render/env/DepthLayers.ts): depth / count / scale stay as they are
DEPTH_LAYERS = [
    {'layer': 0, 'depth': [95, 150], 'count': 24, 'scale': [0.6, 1.8]},
    {'layer': 1, 'depth': [170, 260], 'count': 30, 'scale': [4, 11]},
    {'layer': 2, 'depth': [420, 620], 'count': 22, 'scale': [12, 30]},
]
# share of each set per ring and layer (sums to 1 per layer); the far layer keeps more plain rock
DEPTH_MIX = {
    '1': [{'rocks': 1.0}, {'rocks': 1.0}, {'rocks': 1.0}],
    '2': [{'rocks': 0.55, 'scrap': 0.45}, {'rocks': 0.55, 'scrap': 0.45}, {'rocks': 0.7, 'scrap': 0.3}],
    '3': [{'rocks': 0.5, 'crystal': 0.5}, {'rocks': 0.5, 'crystal': 0.5}, {'rocks': 0.6, 'crystal': 0.4}],
    '4': [{'rocks': 0.45, 'obsidian': 0.55}, {'rocks': 0.45, 'obsidian': 0.55}, {'rocks': 0.55, 'obsidian': 0.45}],
}
# multiply the instance scale per set (thin scrap plates and blades look smaller than a rock of the same radius)
SET_SCALE = {'rocks': 1.35, 'scrap': 1.6, 'crystal': 1.45, 'obsidian': 1.6}
# suggested per-ring instance colour for the neutral rock set (multiplies albedo before the haze)
ROCK_RING_TINT = {'1': '#FFFFFF', '2': '#F2DCCB', '3': '#D8DCEB', '4': '#B8B0BC'}

BED_SUGGEST = {
    'radius': [4, 10], 'count': [3, 8], 'depthBelowPlane': [4, 30], 'haze': 0.3, 'northShiftPerDepth': 0.7,
    'note': 'radius = instance scale (meshes are unit radius). Spread over the field footprint (field radius '
            '+ 30 %), deterministic from the field/chunk hash like AsteroidDust. Yaw any angle (around glTF +Y), '
            'tilt at most ~25 deg: the top (glTF +Y) side is shaded lighter. Shift each rock NORTH (world -z) by '
            'northShiftPerDepth x its depth (= depth / tan 55 deg, like lookAheadAtDepth) so that from the default '
            'camera it sits under the field instead of sliding out below it. Keep the TOP of each bed rock '
            '(depth - radius) at least 3 units below the plane so nothing pokes through the gameplay plane; '
            'bigger rocks deeper. Use the bed variants of the field resource (Bed_<field resource>_<0..2>). '
            'haze = suggested share of the zone haze colour mixed into the lit colour (the DepthLayers shader trick, '
            'no dim): the bed must stay a step darker and calmer than the minable rocks above it.',
}
RUBBLE_SUGGEST = {
    'scale': [0.09, 0.7],
    'note': 'Drop-in for the chip geometry: unit radius like IcosahedronGeometry(1, 0), so AsteroidDust keeps its '
            'size/orbit math. Neutral light grey albedo (base_concrete) x COLOR_0 AO - keep the per-resource '
            'instanceColor (RESOURCES[res].rockColor). Pick the mesh per chip with rand(seed, i + 77) * 8.',
}


def manifest(report):
    m = {
        '_schema': {
            'about': 'Batch A "Depth and belts" scenery (art audit 2026-10-16 section 6, A1-A6). Generated by '
                     'art/blender/scenery.py - do not edit by hand.',
            'coords': 'glTF: +X forward, +Y up, +Z starboard. Every mesh node is centred on its origin with bounding '
                      'radius 1 and an IDENTITY node transform (all meshes of a set overlap at the origin): take '
                      '`node.geometry` by name and instance it; scale = world radius.',
            'material': 'AF_Palette atlas (shared palette_default_*) + COLOR_0 (AO, facet jitter, grime) - the vertex '
                        'colours must be multiplied in (GLTFLoader sets vertexColors). Flat-shaded (split normals). '
                        'No lights, no animated nodes.',
            'sets.<id>': 'file, root (empty root node), ring, use, budget [min,max] tris, meshes[]: name, kind, '
                         'tris, radius (1), size (glTF x,y,z extents at unit radius), elongation (max/min extent); '
                         'bed meshes also carry resource.',
            'depth': 'layers = DepthLayers.DEBRIS_LAYERS (unchanged), mix[ring][layer] = share of each set, '
                     'setScale = per-set multiplier of the layer scale, rockTint = optional per-ring instance '
                     'colour for the neutral rocks.',
            'bed': 'per-field suggestions (radius = instance scale, count, depth band).',
            'rubble': 'AsteroidDust chip suggestions.',
        },
        'sets': {},
        'depth': {'layers': DEPTH_LAYERS, 'mix': DEPTH_MIX, 'setScale': SET_SCALE, 'rockTint': ROCK_RING_TINT},
        'bed': BED_SUGGEST,
        'rubble': RUBBLE_SUGGEST,
    }
    for sid, (fname, root, _, ring, budget) in SETS.items():
        if sid not in report:
            continue
        m['sets'][sid] = {'file': fname, 'root': root, 'ring': ring, 'use': USE[sid], 'budget': list(budget),
                          'meshes': report[sid]}
    if 'bed' in m['sets']:
        by_res = {}
        for e in m['sets']['bed']['meshes']:
            by_res.setdefault(e['resource'], []).append(e['name'])
        m['bed']['meshesByResource'] = by_res
    return m


def optimize_own():
    """Run the optimizer transform (art/tools/optimize_assets.mjs) on public/assets/models/scenery/ ONLY.
    Uses art/tools/optimize_files.mjs when present; otherwise a temporary copy of the optimizer with the
    model walk restricted to that folder, in art/out/ (same depth below the repo root, so its ROOT and
    node_modules resolve the same)."""
    node = shutil.which('node')
    if not node:
        print('WARNING optimize: node not found')
        return False
    files_tool = os.path.join(paths.ART, 'tools', 'optimize_files.mjs')
    if os.path.exists(files_tool):
        return subprocess.run([node, files_tool, OUT], cwd=paths.ROOT).returncode == 0
    src = os.path.join(paths.ART, 'tools', 'optimize_assets.mjs')
    with open(src, encoding='utf-8') as f:
        code = f.read()
    needle = "walk(MODELS, '.glb')"
    assert code.count(needle) >= 1, 'optimizer changed: model walk not found'
    code = code.replace("for (const file of walk(MODELS, '.glb'))",
                        "for (const file of walk(path.join(MODELS, 'scenery'), '.glb'))")
    assert "walk(path.join(MODELS, 'scenery')" in code, 'optimizer changed: could not restrict the walk'
    tmp = os.path.join(paths.OUT, 'tmp_optimize_scenery.mjs')
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(code)
    try:
        r = subprocess.run([node, tmp, '--only', 'models'], cwd=paths.ROOT)
    finally:
        os.remove(tmp)
    return r.returncode == 0


def build(only=None, optimize=True):
    os.makedirs(OUT, exist_ok=True)
    report = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding='utf-8') as f:
            prev = json.load(f)
        for sid, s in prev.get('sets', {}).items():
            report[sid] = s['meshes']
    for sid, (fname, root, builder, ring, budget) in SETS.items():
        if only and sid not in only:
            continue
        G.reset_scene()
        M.build_atlas_images(ATLAS)
        objs, entries = builder()
        lo, hi = budget
        for e in entries:
            flag = '' if lo <= e['tris'] <= hi else '  <-- OUTSIDE BUDGET'
            print(f"SCENERY {sid:9s} {e['name']:18s} {e['tris']:5d} tris  size {e['size']}{flag}")
        export_set(root, objs, fname)
        report[sid] = entries
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump(manifest(report), f, indent=2, ensure_ascii=False)
    print('MANIFEST', MANIFEST)
    if optimize:
        optimize_own()
    return report


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else None
    build(only, optimize='--no-optimize' not in argv)
