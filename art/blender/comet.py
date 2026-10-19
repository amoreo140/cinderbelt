"""Comet (spec 5.3.3, M4): a moving POI - the player catches it and mines the
tail (ice fragments) and the nucleus (He3 + Kr).

comet_nucleus.glb   origin = nucleus centre (the comet moves; no gameplay-plane
                    rule), ~6.4 x 4.6 x 4.2, AF_Palette + COLOR_0.
  Comet_Nucleus       dirty-snow body (comet_ice) with dark dust-crust patches
                      (vertex colour), glowing He3 pockets (he3_glow) and a few
                      violet Kr crystal clusters (st_ore_crystal)
    Comet_Jet_<i>     EMPTY on each active vent; local +X = jet direction
                      (outward).  Spawn gas-jet sprites here (comet_coma.png /
                      glow_soft.png, cyan) - they should point roughly sunward.
comet_tail.glb      origin = nucleus centre; the tail extends along local -X
                    (0 .. -30).  Rotate the node so -X points AWAY from the
                    star / along the anti-velocity.
  Comet_Tail          three crossed ribbons (0/60/120 deg around X), UV u = 0 at
                      the head .. 1 at the end, v across; its own material
                      "AF_CometTail" uses public/assets/vfx/comet_tail.png -
                      render it ADDITIVE, unlit, depthWrite false.
    Comet_Debris      ~60 small ice shards scattered along the tail (AF_Palette,
                      the visual "cloud of ice fragments" the player mines;
                      the game may replace them with asteroid_frag_ice_*).
"""
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from lib import geo as G
import paths
import asteroid_styles as S
import asteroids as A

TAIL_LEN = 30.0


def build_nucleus(atlas_dir, seed=8080):
    rng = random.Random(seed)
    R = 2.4
    bm = S.sculpt_bm(rng, R, subdiv=4, amp=0.24, detail=0.6, lobes=(2, 3), craters=(3, 4), stretch=1.35,
                     squash=(0.78, 0.88))
    tmp = G.obj_from_bm('tmp', bm, ['comet_ice'])
    S.decimate(tmp, ratio=0.1)
    bm = bmesh.new()
    bm.from_mesh(tmp.data)
    bpy.data.objects.remove(tmp)
    S.planar_cuts(bm, rng, 5, depth=(0.8, 0.88))
    body = G.obj_from_bm('CometBody', bm, ['comet_ice', 'comet_crust'])
    S.bevel(body, R * 0.02, 1, 12, harden=False)
    # dark dust crust on the lower / leeward faces (+ noise)
    from mathutils import noise
    o = Vector([rng.uniform(-40, 40) for _ in range(3)])
    for poly in body.data.polygons:
        c = poly.center
        n = noise.noise(c * 0.6 + o)
        if n + 0.25 * (-poly.normal.z) + 0.15 * (c.x / R) > 0.12:
            poly.material_index = 1
    pieces, centres, vents = [], [], []
    # He3 pockets: glowing rounded nodules half sunk into pits
    for k, (p, n) in enumerate(S.surface_points(body, rng, 10, R, spacing=0.3)):
        s = R * rng.uniform(0.09, 0.15)
        nd = S.nodule(f'He3_{k}', rng, s, 'he3_glow')
        nd.location = p - n * s * 0.4
        pieces.append(nd)
        centres.append(p)
    # Kr crystal clusters (2) on the upper side
    for ci, (p, n) in enumerate(S.surface_points(body, rng, 2, R, bias=Vector((0, 0, 1)), spacing=0.6)):
        centres.append(p)
        for j in range(rng.randint(4, 6)):
            big = 1.0 if j == 0 else rng.uniform(0.45, 0.8)
            cr = A._crystal(f'Kr{ci}_{j}', 'crystal', R * 0.5 * big)
            d = (n + Vector([rng.uniform(-0.6, 0.6) for _ in range(3)]) * (0 if j == 0 else 1)).normalized()
            off = Vector([rng.uniform(-1, 1) for _ in range(3)]) * R * 0.07 * (j > 0)
            S.align(cr, p + off - n * 0.05 * R, d)
            pieces.append(cr)
    # vents: rimmed pits with a glowing jet throat (sunward-ish: +X hemisphere)
    for k, (p, n) in enumerate(S.surface_points(body, rng, 3, R, bias=Vector((1, 0, 0.3)).normalized(), spacing=0.5)):
        rim = G.ring_band(f'VentRim{k}', 0.34, 0.2, -0.06, 0.08, 'comet_crust', verts=10, smooth=False)
        throat = G.cyl(f'VentGlow{k}', 0.2, 0.06, 'comet_jet', verts=10)
        for ob in (rim, throat):
            S.align(ob, p - n * 0.03, n)
        pieces += [rim, throat]
        vents.append((p + n * 0.05, n))
    ob = G.join([body] + pieces, 'Comet_Nucleus')
    G.finalize(ob, atlas_dir)
    S.vertex_colours(ob, 'comet', centres, R, rng, samples=16, facet=True)
    G.set_smooth(ob, False)
    for k, (p, n) in enumerate(vents):
        e = G.empty(f'Comet_Jet_{k}', loc=p, size=0.4)
        e.rotation_mode = 'QUATERNION'
        e.rotation_quaternion = Vector((1, 0, 0)).rotation_difference(n)
        e.parent = ob
    return ob


def _tail_material():
    m = bpy.data.materials.get('AF_CometTail')
    if m:
        return m
    m = bpy.data.materials.new('AF_CometTail')
    m.use_backface_culling = False
    try:
        m.surface_render_method = 'BLENDED'
    except Exception:
        pass
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    img_path = os.path.join(paths.VFX, 'comet_tail.png')
    if os.path.exists(img_path):
        img = bpy.data.images.load(img_path, check_existing=True)
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color'])
        nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    bsdf.inputs['Emission Strength'].default_value = 1.5
    bsdf.inputs['Roughness'].default_value = 1.0
    return m


def build_tail(atlas_dir, seed=8081):
    rng = random.Random(seed)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    n = 12
    for k in range(3):
        rot = Matrix.Rotation(math.radians(k * 60), 4, 'X')
        rows = []
        for i in range(n + 1):
            u = i / n
            x = -TAIL_LEN * u + 1.2
            w = 1.6 + 7.5 * u ** 0.8
            rows.append((u, [bm.verts.new(rot @ Vector((x, -w, 0))), bm.verts.new(rot @ Vector((x, w, 0)))]))
        for (u0, a), (u1, b) in zip(rows[:-1], rows[1:]):
            f = bm.faces.new((a[0], b[0], b[1], a[1]))
            for lp, (uu, vv) in zip(f.loops, ((u0, 0), (u1, 0), (u1, 1), (u0, 1))):
                lp[uv].uv = (uu, vv)
    me = bpy.data.meshes.new('Comet_Tail')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(_tail_material())
    tail = bpy.data.objects.new('Comet_Tail', me)
    G.link(tail)
    # ice debris cloud along the tail
    shards = []
    for i in range(60):
        u = rng.random() ** 1.4
        x = -TAIL_LEN * 0.85 * u - 1.0
        spread = 0.8 + 5.0 * u
        L = rng.uniform(0.18, 0.5) * (1.0 - 0.5 * u)
        cr = A._crystal(f'Shard{i}', 'ice', L, scale_w=1.6)
        cr.matrix_world = (Matrix.Translation((x, rng.gauss(0, spread * 0.5), rng.gauss(0, spread * 0.4)))
                           @ Matrix.Rotation(rng.uniform(0, 6.28), 4, Vector([rng.uniform(-1, 1) for _ in range(3)]).normalized()))
        shards.append(cr)
    deb = G.join(shards, 'Comet_Debris')
    G.finalize(deb, atlas_dir)
    G.set_smooth(deb, False)
    deb.parent = tail
    return tail


BUILDERS = {'comet_nucleus': build_nucleus, 'comet_tail': build_tail}
