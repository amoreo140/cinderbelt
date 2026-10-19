"""Giant asteroids (M3.5b, spec 5.3 / 6.5 "Obri asteroid"): a breakable rock
shell with no yield around a crystal-rich core.  Style C language (big
chamfered facets, per-facet vertex colour, ray-cast AO, tinted crevices).

asteroid_giant_<iron|copper|ice|titanium>.glb   ~9-12 units across,
origin = centre.
    asteroid_giant_<res>   empty root
      Shell                empty: hide / break this to expose the core
        Shell_0..6         thick shell plates; each origin = the plate's
                           centroid, so the game can push it outward along
                           its local position vector when the shell breaks
      Core                 the inner rock, densely dressed with the resource
                           (ice: blue crystals); always fully inside the shell
COLOR_0 on every mesh (multiplies the atlas colour).
"""
import math
import random

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from lib import geo as G
import asteroid_styles as S
import asteroids as A

GIANTS = [  # name, kind, seed, radius
    ('asteroid_giant_iron', 'iron', 601, 5.0),
    ('asteroid_giant_copper', 'copper', 613, 5.2),
    ('asteroid_giant_ice', 'ice', 619, 5.6),
    ('asteroid_giant_titanium', 'titanium', 631, 5.3),
]
INNER = {'iron': 'rock_iron_1', 'copper': 'rock_copper_1', 'ice': 'rock_ice_1', 'titanium': 'rock_ti_1'}
PLATES = 7
THICK = 0.17          # shell thickness as a fraction of the radius


def _shell_rock(rng, R):
    bm = S.sculpt_bm(rng, R, subdiv=4, amp=0.22, detail=0.45, lobes=(2, 3), craters=(2, 3), squash=(0.66, 0.76))
    tmp = G.obj_from_bm('tmpGiant', bm, ['hull_light'])
    S.decimate(tmp, ratio=0.11)
    bm = bmesh.new()
    bm.from_mesh(tmp.data)
    bpy.data.objects.remove(tmp)
    S.planar_cuts(bm, rng, rng.randint(5, 7), depth=(0.84, 0.9))
    return bm


def _split_plates(bm, rng, R, kind):
    """Partition the shell faces into PLATES groups by nearest seed direction,
    solidify each inward.  Returns plate objects (origin = centroid)."""
    seeds = []
    while len(seeds) < PLATES:
        d = S._rand_dir(rng)
        if all(d.angle(s) > 0.75 for s in seeds):
            seeds.append(d)
    bm.faces.ensure_lookup_table()
    groups = [[] for _ in seeds]
    for f in bm.faces:
        c = f.calc_center_median().normalized()
        # wobble the boundaries so the plates are not perfect Voronoi cells
        w = Vector((math.sin(c.y * 7.1), math.sin(c.z * 6.3), math.sin(c.x * 5.7))) * 0.12
        groups[min(range(len(seeds)), key=lambda i: (c + w).angle(seeds[i]))].append(f.index)
    plates = []
    rock_key = S.RES[kind]['rock']
    for gi, idx in enumerate(groups):
        if not idx:
            continue
        pb = bmesh.new()
        vmap = {}
        bm.faces.ensure_lookup_table()
        for fi in idx:
            f = bm.faces[fi]
            vs = []
            for v in f.verts:
                if v.index not in vmap:
                    vmap[v.index] = pb.verts.new(v.co)
                vs.append(vmap[v.index])
            try:
                pb.faces.new(vs)
            except ValueError:
                pass
        n_outer = len(pb.faces)
        bmesh.ops.recalc_face_normals(pb, faces=pb.faces)
        res = bmesh.ops.solidify(pb, geom=list(pb.faces), thickness=R * THICK)
        new_faces = [g for g in res['geom'] if isinstance(g, bmesh.types.BMFace)]
        for f in pb.faces:
            f.material_index = 0
        for f in new_faces:
            f.material_index = 1
        # shrink toward the centroid -> crisp seams between the plates
        cen = sum((v.co for v in pb.verts), Vector()) / len(pb.verts)
        for v in pb.verts:
            v.co = cen + (v.co - cen) * 0.972
        ob = G.obj_from_bm(f'Shell_{gi}', pb, [rock_key, INNER[kind]])
        plates.append(ob)
    return plates


def _fit_core(core, plates, margin=0.93):
    """Scale the core so every vertex stays inside the shell's inner surface."""
    bpy.context.view_layer.update()
    bvhs = [(BVHTree.FromObject(p, bpy.context.evaluated_depsgraph_get()), p.matrix_world.inverted()) for p in plates]
    k = 1.0
    for v in core.data.vertices:
        p = core.matrix_world @ v.co
        L = p.length
        if L < 1e-4:
            continue
        d = p / L
        best = None
        for b, inv in bvhs:
            hit = b.ray_cast(inv @ Vector((0, 0, 0)), inv.to_3x3() @ d, L * 3)
            if hit[0] is not None and (best is None or hit[3] < best):
                best = hit[3]
        if best is not None:
            k = min(k, best * margin / L)
    if k < 1.0:
        core.scale = (k, k, k)
        G.bake_transform(core)
    return k


def build_giant(name, kind, seed, R, atlas_dir):
    rng = random.Random(seed)
    root = G.empty(name, size=1.0)
    shell = G.empty('Shell', size=1.0)
    shell.parent = root
    # ---- shell plates --------------------------------------------------------
    bm = _shell_rock(rng, R)
    plates = _split_plates(bm, rng, R, kind)
    bm.free()
    for p in plates:
        S.bevel(p, R * 0.012, 1, 25, harden=False)
        G.set_smooth(p, False)
    # small embedded nuggets on every plate + crystal clusters breaking
    # through 3 of the (upper) plates - the resource reads from afar
    hero = sorted(plates, key=lambda p: -sum((v.co.z for v in p.data.vertices)) / len(p.data.vertices))[:3]
    for p in plates:
        nug = []
        for k, (pt, n) in enumerate(S.surface_points(p, rng, 3, R, spacing=0.25)):
            L = R * rng.uniform(0.07, 0.12)
            cr = A._crystal(f'{p.name}_N{k}', kind, L, scale_w=1.2)
            S.align(cr, pt - n * L * 0.35, (n + Vector([rng.uniform(-0.4, 0.4) for _ in range(3)])).normalized())
            nug.append(cr)
        if p in hero:
            pts = S.surface_points(p, rng, 2, R, bias=Vector((0, 0, 1)), spacing=0.3)
            for (pt, n) in pts:
                for j in range(rng.randint(4, 6)):
                    big = 1.0 if j == 0 else rng.uniform(0.45, 0.8)
                    L = R * 0.44 * big * (1.1 if kind == 'ice' else 1.0)
                    cr = A._crystal(f'{p.name}_H{j}', kind, L)
                    d = (n + Vector([rng.uniform(-0.6, 0.6) for _ in range(3)]) * (0 if j == 0 else 1)).normalized()
                    off = Vector([rng.uniform(-1, 1) for _ in range(3)]) * R * 0.05 * (j > 0)
                    S.align(cr, pt + off - n * 0.05 * R, d)
                    nug.append(cr)
        nm = p.name
        ob = G.join([p] + nug, nm)
        G.finalize(ob, atlas_dir)
        S.vertex_colours(ob, kind, [], R, rng, samples=12, facet=True)
        G.set_smooth(ob, False)
        # origin -> centroid (the game pushes plates outward along it)
        cen = sum((v.co for v in ob.data.vertices), Vector()) / len(ob.data.vertices)
        from mathutils import Matrix
        ob.data.transform(Matrix.Translation(-cen))
        ob.location = cen
        ob.parent = shell
    plates = [o for o in shell.children]
    # ---- core ----------------------------------------------------------------
    rc = R * 0.44
    core_rock = A.make_rock('Core', kind, rng, rc, 'round')
    pieces, centres = [], []
    up = Vector((0, 0, 1))
    for ci, (p, n) in enumerate(S.surface_points(core_rock, rng, 7, rc, spacing=0.5)):
        centres.append(p)
        for j in range(rng.randint(5, 7)):
            big = 1.0 if j == 0 else rng.uniform(0.45, 0.8)
            L = rc * 0.62 * big * (1.1 if kind == 'ice' else 1.0)
            cr = A._crystal(f'CoreCr{ci}_{j}', kind, L)
            d = (n + Vector([rng.uniform(-0.6, 0.6) for _ in range(3)]) * (0 if j == 0 else 1)).normalized()
            off = Vector([rng.uniform(-1, 1) for _ in range(3)]) * rc * 0.1 * (j > 0)
            S.align(cr, p + off - n * 0.05 * rc, d)
            pieces.append(cr)
    core = G.join([core_rock] + pieces, 'Core')
    _fit_core(core, plates)
    G.finalize(core, atlas_dir)
    S.vertex_colours(core, kind, centres, rc, rng, samples=12, facet=True)
    G.set_smooth(core, False)
    core.parent = root
    return root


BUILDERS = {g[0]: (lambda atlas_dir, g=g: build_giant(g[0], g[1], g[2], g[3], atlas_dir)) for g in GIANTS}
