"""Asteroid style study - three directions applied to the same 4 resources.

  A  "sculpted"  : smooth multi-octave rock, a few crisp bevelled cuts, AO +
                   tint baked into vertex colour, ore as clustered glowing
                   nodules / chunky crystals.  Uses AF_Palette + COLOR_0.
  B  "baked"     : high-detail sculpt baked to a low-poly with normal map and
                   AO-in-albedo (per-rock texture set), mineral bands, almost
                   no emission.
  C  "faceted"   : deliberate large facets with chamfered edges, gradient /
                   AO vertex colour, crystal clusters as hero, inlaid vein bands.
                   Uses AF_Palette + COLOR_0.
"""
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector, noise  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

from lib import geo as G  # noqa: E402
from lib import materials as M  # noqa: E402

RES = {
    'iron':     dict(rock='st_rock_iron', ore='st_ore_iron', band='st_band_iron',
                     tint=(1.0, 0.93, 0.88), stain=(1.0, 0.62, 0.45), crev=(0.42, 0.27, 0.22),
                     tone2=(0.82, 0.66, 0.58)),
    'copper':   dict(rock='st_rock_copper', ore='st_ore_copper', band='st_band_copper',
                     tint=(1.0, 0.96, 0.9), stain=(0.72, 0.95, 0.85), crev=(0.34, 0.3, 0.27),
                     tone2=(0.8, 0.72, 0.6)),
    'ice':      dict(rock='st_rock_ice', ore='st_ice_crystal', band='st_band_ice',
                     tint=(0.96, 1.0, 1.0), stain=(0.82, 0.93, 1.0), crev=(0.22, 0.38, 0.7),
                     tone2=(0.78, 0.88, 1.0)),
    'titanium': dict(rock='st_rock_ti', ore='st_ore_ti', band='st_band_ti',
                     tint=(0.96, 0.98, 1.0), stain=(0.86, 0.9, 1.0), crev=(0.3, 0.33, 0.42),
                     tone2=(0.78, 0.82, 0.92)),
    # M4 / M5a additions
    'crystal':  dict(rock='st_rock_crystal', ore='st_ore_crystal', band='st_band_crystal',
                     tint=(0.97, 0.95, 1.0), stain=(0.86, 0.74, 1.0), crev=(0.26, 0.2, 0.42),
                     tone2=(0.8, 0.76, 0.95)),
    'rare':     dict(rock='st_rock_rare', ore='st_ore_rare', band='st_band_rare',
                     tint=(1.0, 0.97, 0.93), stain=(0.74, 1.0, 0.84), crev=(0.3, 0.25, 0.21),
                     tone2=(0.72, 0.66, 0.6)),
    'exotic':   dict(rock='rock_ti_1', ore='ex_matter', band='ex_matter',
                     tint=(1.0, 0.95, 1.0), stain=(1.0, 0.7, 0.95), crev=(0.3, 0.22, 0.32),
                     tone2=(0.8, 0.75, 0.85)),
    'comet':    dict(rock='comet_ice', ore='he3_glow', band='comet_jet',
                     tint=(1.0, 1.0, 1.0), stain=(1.0, 0.95, 0.82), crev=(0.4, 0.45, 0.55),
                     tone2=(0.8, 0.84, 0.9)),
}
COL = 'Col'


def _rand_dir(rng):
    z = rng.uniform(-1, 1)
    a = rng.uniform(0, 2 * math.pi)
    s = math.sqrt(1 - z * z)
    return Vector((s * math.cos(a), s * math.sin(a), z))


def _smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def sculpt_bm(rng, radius, subdiv=5, amp=0.30, detail=1.0, craters=(2, 4), lobes=(2, 3), ledges=0.0,
              stretch=1.0, squash=(0.62, 0.78)):
    """Lumpy multi-lobe rock: fBm + ridges + soft craters (+ optional
    voronoi ledges).  Returns a bmesh (not decimated)."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    o1, o2, o3, o4 = (Vector([rng.uniform(-50, 50) for _ in range(3)]) for _ in range(4))
    cr = [(_rand_dir(rng), rng.uniform(0.22, 0.45), rng.uniform(0.05, 0.10)) for _ in range(rng.randint(*craters))]
    lb = [(_rand_dir(rng), rng.uniform(0.55, 0.9), rng.uniform(0.12, 0.25)) for _ in range(rng.randint(*lobes))]
    for v in bm.verts:
        d = v.co.normalized()
        w = d + 0.25 * Vector((noise.noise(d * 1.1 + o4), noise.noise(d * 1.1 + o4 + Vector((5, 0, 0))),
                                noise.noise(d * 1.1 + o4 + Vector((0, 9, 0)))))   # domain warp
        r = 1.0 + amp * noise.fractal(w * 0.75 + o1, 1.0, 2.0, 4)
        for ld, lw, ls in lb:
            r += ls * (1 - _smoothstep(0.0, 1.0, d.angle(ld) / lw))
        ridge = 1.0 - abs(noise.noise(w * 1.7 + o2))
        r += 0.07 * detail * ridge * ridge
        r += 0.025 * detail * noise.fractal(w * 4.5 + o3, 0.8, 2.0, 3)
        if ledges:
            r -= ledges * noise.noise(w * 2.2 + o3, noise_basis='VORONOI_F2F1')
        for cd, cs, depth in cr:
            a = d.angle(cd) / cs
            if a < 1.0:
                r -= depth * (1 - _smoothstep(0.0, 1.0, a)) * 1.3
            if 0.75 < a < 1.45:
                r += depth * 0.45 * math.sin((a - 0.75) / 0.7 * math.pi)
        v.co = d * r
    sx, sy, sz = stretch, rng.uniform(0.74, 0.9), rng.uniform(*squash)
    rot = Matrix.Rotation(rng.uniform(0, 2 * math.pi), 4, 'Z')
    bmesh.ops.transform(bm, matrix=rot @ Matrix.Diagonal((sx * radius, sy * radius, sz * radius, 1)),
                        verts=bm.verts)
    return bm


def planar_cuts(bm, rng, n, depth=(0.84, 0.9)):
    planes = []
    for _ in range(n):
        nrm = _rand_dir(rng)
        far = max(v.co.dot(nrm) for v in bm.verts)
        co = nrm * far * rng.uniform(*depth)
        res = bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                                     plane_co=co, plane_no=nrm, clear_outer=True)
        edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        if edges:
            bmesh.ops.edgenet_fill(bm, edges=edges)
            planes.append((co, nrm))
    return planes


def decimate(ob, ratio=None, planar=None):
    mod = ob.modifiers.new('Dec', 'DECIMATE')
    if planar:
        mod.decimate_type = 'DISSOLVE'
        mod.angle_limit = math.radians(planar)
    else:
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = ratio
    G.apply_modifiers(ob)


def bevel(ob, width, seg, angle, harden=True):
    G.add_bevel(ob, width, seg, angle=angle, harden=harden)
    G.apply_modifiers(ob)


def surface_points(rock, rng, count, radius, bias=None, spacing=0.45):
    bpy.context.view_layer.update()
    bvh = BVHTree.FromObject(rock, bpy.context.evaluated_depsgraph_get())
    pts, tries = [], 0
    while len(pts) < count and tries < count * 60:
        tries += 1
        d = _rand_dir(rng)
        if bias is not None and d.dot(bias) < 0.15:
            continue
        hit, nrm, _, _ = bvh.ray_cast(rock.matrix_world.inverted() @ (d * radius * 3), -d)
        if hit is None:
            continue
        if any((rock.matrix_world @ hit - p).length < radius * spacing for p, _ in pts):
            continue
        pts.append((rock.matrix_world @ hit, nrm.normalized()))
    return pts


def nodule(name, rng, size, key, smooth=True):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=size)
    o = Vector([rng.uniform(-9, 9) for _ in range(3)])
    for v in bm.verts:
        v.co *= 1.0 + 0.28 * noise.noise(v.co / size * 0.9 + o)
    bmesh.ops.scale(bm, vec=(1.0, rng.uniform(0.75, 1.0), rng.uniform(0.6, 0.85)), verts=bm.verts)
    ob = G.obj_from_bm(name, bm, [key])
    G.set_smooth(ob, smooth)
    return ob


def crystal(name, L, w, key, sides=6, flat=1.0, bevel_w=0.0, tip=0.38):
    bm = bmesh.new()
    rings = []
    for z, ww in ((-0.3 * L, w * 0.85), ((1 - tip) * L, w)):
        rings.append([bm.verts.new((ww * math.cos(2 * math.pi * k / sides + 0.3),
                                    flat * ww * math.sin(2 * math.pi * k / sides + 0.3), z)) for k in range(sides)])
    t = bm.verts.new((0, 0, L))
    bm.faces.new(list(reversed(rings[0])))
    for k in range(sides):
        j = (k + 1) % sides
        bm.faces.new((rings[0][k], rings[0][j], rings[1][j], rings[1][k]))
        bm.faces.new((rings[1][k], rings[1][j], t))

    def grad(v):
        return max(0.0, min(1.0, (v.co.z + 0.15 * L) / (1.15 * L)))
    ob = G.obj_from_bm(name, bm, [key], grad=grad)
    if bevel_w:
        bevel(ob, bevel_w, 1, 20, harden=False)
    G.set_smooth(ob, False)
    return ob


def align(ob, loc, direction):
    q = Vector((0, 0, 1)).rotation_difference(direction)
    ob.matrix_world = Matrix.Translation(loc) @ q.to_matrix().to_4x4()


def dress(rock, res, rng, radius, style):
    """Ore dressing.  Returns (pieces, cluster centres)."""
    R_ = RES[res]
    pieces, centres = [], []
    up = Vector((0, 0, 1))
    n_cl = 4 if style == 'A' else (4 if res == 'ice' else 3)
    for ci, (p, n) in enumerate(surface_points(rock, rng, n_cl, radius, bias=up)):
        centres.append(p)
        if res == 'ice' or (style == 'C'):
            k = rng.randint(4, 7) if style == 'C' else rng.randint(4, 6)
            for j in range(k):
                big = 1.0 if j == 0 else rng.uniform(0.45, 0.8)
                L = radius * (0.55 if style == 'C' else 0.5) * big * (1.15 if res == 'ice' else 1.0)
                sides = 6 if res in ('ice', 'iron') else 4
                flat = 0.5 if res == 'titanium' else 1.0
                w = L * (0.2 if res != 'copper' else 0.3)
                tipf = 0.12 if res == 'copper' else 0.38
                cr = crystal(f'Cr{ci}_{j}', L, w, R_['ore'], sides=sides, flat=flat,
                             bevel_w=w * 0.08, tip=tipf)
                dirn = (n + Vector([rng.uniform(-0.65, 0.65) for _ in range(3)]) * (0 if j == 0 else 1)).normalized()
                off = Vector([rng.uniform(-1, 1) for _ in range(3)]) * radius * 0.09 * (j > 0)
                align(cr, p + off - n * 0.05 * radius, dirn)
                pieces.append(cr)
        else:
            for j in range(rng.randint(6, 9)):
                s = radius * rng.uniform(0.08, 0.17) * (1.5 if j == 0 else 1.0)
                nd = nodule(f'Nd{ci}_{j}', rng, s, R_['ore'])
                off = Vector([rng.uniform(-1, 1) for _ in range(3)]) * radius * 0.13
                off -= n * off.dot(n)
                nd.location = p + off - n * s * 0.35
                nd.rotation_euler = [rng.uniform(0, 6.28) for _ in range(3)]
                pieces.append(nd)
    return pieces, centres


def vertex_colours(ob, res, centres, radius, rng, samples=20, facet=False):
    """AO (ray cast) x tint x low-frequency variation x ore stain -> COLOR_0.
    facet=True: per-face brightness jitter (corner domain)."""
    R_ = RES[res]
    me = ob.data
    bpy.context.view_layer.update()
    bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
    dirs = []
    for i in range(samples):   # fixed cosine-ish hemisphere set
        u, v = (i + 0.5) / samples, (i * 0.618034) % 1.0
        r_, th = math.sqrt(u), 2 * math.pi * v
        dirs.append((r_ * math.cos(th), r_ * math.sin(th), math.sqrt(max(0.0, 1 - u))))
    ao = []
    o = Vector([rng.uniform(-30, 30) for _ in range(3)])
    for vt in me.vertices:
        n = vt.normal
        t = n.orthogonal().normalized()
        b = n.cross(t)
        hits = 0
        for dx, dy, dz in dirs:
            d = (t * dx + b * dy + n * dz).normalized()
            h = bvh.ray_cast(vt.co + n * radius * 0.01, d, radius * 0.9)
            if h[0] is not None:
                hits += 1
        ao.append(1.0 - hits / samples)
    attr = me.color_attributes.new(COL, 'BYTE_COLOR', 'CORNER')
    face_j = []
    t2 = R_.get('tone2')
    for poly in me.polygons:
        j = 1.0 + (rng.uniform(-0.14, 0.14) if facet else 0.0)
        if facet and t2 and noise.noise(poly.center / radius * 0.9 + o * 0.5) > 0.22:
            j = (j * t2[0], j * t2[1], j * t2[2])
        face_j.append(j)
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            p = me.vertices[vi].co
            a = ao[vi] ** 1.6
            fj = face_j[poly.index]
            fj = fj if isinstance(fj, tuple) else (fj, fj, fj)
            var = 1.0 + 0.12 * noise.noise(p / radius * 1.3 + o)
            c = [R_['tint'][k] * (R_['crev'][k] + (1 - R_['crev'][k]) * a) * var * fj[k] for k in range(3)]
            if centres:
                dmin = min((p - cc).length for cc in centres) / radius
                s = 1.0 - _smoothstep(0.18, 0.55, dmin)
                c = [c[k] * (1 - s + s * R_['stain'][k]) for k in range(3)]
            attr.data[li].color = (min(1, c[0]), min(1, c[1]), min(1, c[2]), 1.0)
    me.color_attributes.active_color = attr
    return ob


# ----------------------------------------------------------------------------
# style A - sculpted
# ----------------------------------------------------------------------------
def build_A(name, res, seed, radius, atlas_dir):
    rng = random.Random(seed)
    bm = sculpt_bm(rng, radius, subdiv=5, amp=0.34, detail=1.3, craters=(3, 5), ledges=0.06)
    planar_cuts(bm, rng, rng.randint(2, 4), depth=(0.78, 0.86))
    rock = G.obj_from_bm(name + '_rock', bm, [RES[res]['rock']])
    decimate(rock, ratio=0.32)
    bevel(rock, radius * 0.03, 2, 38)
    G.set_smooth(rock, True)
    pieces, centres = dress(rock, res, rng, radius, 'A')
    ob = G.join([rock] + pieces, name)
    G.finalize(ob, atlas_dir)
    vertex_colours(ob, res, centres, radius, rng)
    return ob


# ----------------------------------------------------------------------------
# style C - refined facets
# ----------------------------------------------------------------------------
def band_cut(bm, rng, radius, n_bands, width):
    """Slice the rock with pairs of parallel planes; faces between a pair
    become an inlaid band (returns the set of band faces)."""
    bands = []
    for _ in range(n_bands):
        nrm = _rand_dir(rng)
        off = rng.uniform(-0.35, 0.35) * radius
        for o in (off - width / 2, off + width / 2):
            bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                                   plane_co=nrm * o, plane_no=nrm)
        bands.append((nrm, off))
    sel = set()
    for f in bm.faces:
        c = f.calc_center_median()
        for nrm, off in bands:
            if abs(c.dot(nrm) - off) < width / 2:
                sel.add(f)
    return sel


def build_C(name, res, seed, radius, atlas_dir):
    rng = random.Random(seed)
    bm = sculpt_bm(rng, radius, subdiv=4, amp=0.26, detail=0.5)
    tmp = G.obj_from_bm('tmpC', bm, [RES[res]['rock']])
    decimate(tmp, ratio=0.11)
    bm = bmesh.new()
    bm.from_mesh(tmp.data)
    bpy.data.objects.remove(tmp)
    planar_cuts(bm, rng, rng.randint(4, 6), depth=(0.8, 0.88))
    band = band_cut(bm, rng, radius, 2, radius * 0.09)
    for f in bm.faces:
        f.material_index = 1 if f in band else 0
    # push the band slightly inward -> inlay
    for v in {v for f in band for v in f.verts}:
        if all(lf in band for lf in v.link_faces):
            v.co -= v.co.normalized() * radius * 0.015
    rock = G.obj_from_bm(name + '_rock', bm, [RES[res]['rock'], RES[res]['band']])
    bevel(rock, radius * 0.022, 1, 12, harden=False)
    G.set_smooth(rock, False)
    pieces, centres = dress(rock, res, rng, radius, 'C')
    ob = G.join([rock] + pieces, name)
    G.finalize(ob, atlas_dir)
    vertex_colours(ob, res, centres, radius, rng, facet=True)
    G.set_smooth(ob, False)
    return ob


# ----------------------------------------------------------------------------
# style B - baked semi-realistic (per-rock textures)
# ----------------------------------------------------------------------------
B_COLORS = {  # rock base, rock light, crevice, band, band glint emission
    'iron':     ('#6E5446', '#9C7A64', '#2E221C', '#B4532C', (1.0, 0.35, 0.1)),
    'copper':   ('#5E5248', '#8E7C6A', '#2A231E', '#D9963A', (1.0, 0.7, 0.25)),
    'ice':      ('#8FB0D6', '#D8ECFA', '#3A5A86', '#E8FAFF', (0.5, 0.85, 1.0)),
    'titanium': ('#828A9C', '#BCC6DA', '#3C4252', '#EEF2FF', (0.75, 0.82, 1.0)),
}


def _lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def _hi_material(res, seed):
    """Procedural material for the high-poly sculpt (rock layers + mineral bands)."""
    base, light, crev, band, glint = B_COLORS[res]
    m = bpy.data.materials.new(f'Hi_{res}')
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    bsdf = N.get('Principled BSDF')
    tc = N.new('ShaderNodeTexCoord')
    mp = N.new('ShaderNodeMapping')
    mp.inputs['Location'].default_value = (seed * 1.7, seed * 0.3, seed * 0.9)
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    n1 = N.new('ShaderNodeTexNoise')
    n1.inputs['Scale'].default_value = 1.2
    n1.inputs['Detail'].default_value = 8
    n1.inputs['Roughness'].default_value = 0.6
    L.new(mp.outputs['Vector'], n1.inputs['Vector'])
    ramp = N.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.3
    ramp.color_ramp.elements[0].color = (*_lin(crev), 1)
    ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[1].color = (*_lin(light), 1)
    e = ramp.color_ramp.elements.new(0.5)
    e.color = (*_lin(base), 1)
    L.new(n1.outputs['Fac'], ramp.inputs['Fac'])
    # mineral veins: ridged (|noise - 0.5|) network, thin and wandering
    n2 = N.new('ShaderNodeTexNoise')
    n2.inputs['Scale'].default_value = 1.4
    n2.inputs['Detail'].default_value = 3.0
    n2.inputs['Roughness'].default_value = 0.55
    n2.inputs['Distortion'].default_value = 0.4
    L.new(mp.outputs['Vector'], n2.inputs['Vector'])
    sub = N.new('ShaderNodeMath')
    sub.operation = 'SUBTRACT'
    sub.inputs[1].default_value = 0.5
    L.new(n2.outputs['Fac'], sub.inputs[0])
    ab = N.new('ShaderNodeMath')
    ab.operation = 'ABSOLUTE'
    L.new(sub.outputs['Value'], ab.inputs[0])
    thr = N.new('ShaderNodeMapRange')
    thr.inputs['From Min'].default_value = 0.012
    thr.inputs['From Max'].default_value = 0.03
    thr.inputs['To Min'].default_value = 1.0
    thr.inputs['To Max'].default_value = 0.0
    L.new(ab.outputs['Value'], thr.inputs['Value'])
    # veins only in some regions (mask by a low-frequency noise)
    n3 = N.new('ShaderNodeTexNoise')
    n3.inputs['Scale'].default_value = 0.7
    L.new(mp.outputs['Vector'], n3.inputs['Vector'])
    msk = N.new('ShaderNodeMapRange')
    msk.inputs['From Min'].default_value = 0.42
    msk.inputs['From Max'].default_value = 0.55
    L.new(n3.outputs['Fac'], msk.inputs['Value'])
    mul = N.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    L.new(thr.outputs['Result'], mul.inputs[0])
    L.new(msk.outputs['Result'], mul.inputs[1])
    mix = N.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    L.new(mul.outputs['Value'], mix.inputs['Factor'])
    L.new(ramp.outputs['Color'], mix.inputs['A'])
    mix.inputs['B'].default_value = (*_lin(band), 1)
    L.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    return m


def build_B(name, res, seed, radius, atlas_dir, tex_dir, tex_size=512):
    """High-poly sculpt -> low-poly with baked normal + albedo(with AO)."""
    rng = random.Random(seed)
    bm = sculpt_bm(rng, radius, subdiv=6, detail=1.6)
    planar_cuts(bm, rng, 1)
    hi = G.obj_from_bm(name + '_hi', bm, [])
    hi.data.materials.clear()
    hi.data.materials.append(_hi_material(res, seed))
    G.set_smooth(hi, True)
    lo = hi.copy()
    lo.data = hi.data.copy()
    lo.name = name
    bpy.context.scene.collection.objects.link(lo)
    decimate(lo, ratio=0.075)
    G.set_smooth(lo, True)
    # UVs
    bpy.ops.object.select_all(action='DESELECT')
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    # images + low-poly material
    imgs = {}
    for k, cs in (('albedo', 'sRGB'), ('normal', 'Non-Color'), ('ao', 'Non-Color')):
        im = bpy.data.images.new(f'{name}_{k}', tex_size, tex_size, alpha=False)
        im.colorspace_settings.name = cs
        imgs[k] = im
    m = bpy.data.materials.new(f'{name}_mat')
    nt = m.node_tree
    N, Ln = nt.nodes, nt.links
    bsdf = N.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = 0.72 if res != 'ice' else 0.35
    bsdf.inputs['Metallic'].default_value = 0.25 if res in ('titanium', 'copper') else 0.05
    tnode = {}
    for k in imgs:
        n = N.new('ShaderNodeTexImage')
        n.image = imgs[k]
        tnode[k] = n
    lo.data.materials.clear()
    lo.data.materials.append(m)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 32
    bk = sc.render.bake
    bk.use_selected_to_active = True
    bk.cage_extrusion = radius * 0.08
    bk.margin = 4
    hi.select_set(True)
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    for k, typ in (('normal', 'NORMAL'), ('ao', 'AO')):
        for n in N:
            n.select = False
        tnode[k].select = True
        N.active = tnode[k]
        bpy.ops.object.bake(type=typ)
    for n in N:
        n.select = False
    tnode['albedo'].select = True
    N.active = tnode['albedo']
    bk.use_pass_direct = False
    bk.use_pass_indirect = False
    bk.use_pass_color = True
    bpy.ops.object.bake(type='DIFFUSE')
    # albedo x AO (lifted so shadow sides never go black)
    import numpy as np
    a = np.empty(tex_size * tex_size * 4, np.float32)
    o = np.empty_like(a)
    imgs['albedo'].pixels.foreach_get(a)
    imgs['ao'].pixels.foreach_get(o)
    a = a.reshape(-1, 4)
    o = o.reshape(-1, 4)
    a[:, :3] *= (0.45 + 0.55 * o[:, :1])
    imgs['albedo'].pixels.foreach_set(a.ravel())
    os.makedirs(tex_dir, exist_ok=True)
    for k in ('albedo', 'normal'):
        imgs[k].filepath_raw = os.path.join(tex_dir, f'{name}_{k}.png')
        imgs[k].file_format = 'PNG'
        imgs[k].save()
    # final material: albedo + normal map
    for n in list(N):
        if n.type == 'TEX_IMAGE' and n.image == imgs['ao']:
            N.remove(n)
    Ln.new(tnode['albedo'].outputs['Color'], bsdf.inputs['Base Color'])
    nm = N.new('ShaderNodeNormalMap')
    Ln.new(tnode['normal'].outputs['Color'], nm.inputs['Color'])
    Ln.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    bpy.data.objects.remove(hi)
    # small glints: a few tiny ore crystals (only emissive bits of style B)
    pieces = []
    up = Vector((0, 0, 1))
    for ci, (p, n) in enumerate(surface_points(lo, rng, 3, radius, bias=up)):
        for j in range(3):
            L_ = radius * rng.uniform(0.08, 0.16)
            key = RES[res]['ore']
            cr = crystal(f'Gl{ci}_{j}', L_, L_ * 0.3, key, sides=5 if res != 'titanium' else 4,
                         flat=0.5 if res == 'titanium' else 1.0)
            dirn = (n + Vector([rng.uniform(-0.6, 0.6) for _ in range(3)])).normalized()
            align(cr, p - n * 0.02 * radius + Vector([rng.uniform(-1, 1) for _ in range(3)]) * radius * 0.05, dirn)
            pieces.append(cr)
    if pieces:
        g = G.join(pieces, name + '_glints')
        G.finalize(g, atlas_dir)
        g.parent = lo
        g.matrix_parent_inverse = lo.matrix_world.inverted()
    return lo


# ----------------------------------------------------------------------------
def vc_material():
    """Preview variant of AF_Palette that multiplies the vertex colour (what
    three.js does automatically when COLOR_0 is present)."""
    base = bpy.data.materials.get(M.ATLAS_MAT)
    m = bpy.data.materials.get('AF_Palette_VC')
    if m:
        return m
    m = base.copy()
    m.name = 'AF_Palette_VC'
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    src = bsdf.inputs['Base Color'].links[0].from_socket
    ca = nt.nodes.new('ShaderNodeVertexColor')
    ca.layer_name = COL
    mul = nt.nodes.new('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1.0
    nt.links.new(src, mul.inputs['A'])
    nt.links.new(ca.outputs['Color'], mul.inputs['B'])
    nt.links.new(mul.outputs['Result'], bsdf.inputs['Base Color'])
    return m
