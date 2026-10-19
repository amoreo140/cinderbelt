"""Wardens (spec 6.2, M5a) - autonomous guardian machines of the Forge-smiths.
Forge-smith visual language (kovaci.py, README 2.7.5): 3-fold symmetry, tapering
obsidian blades, bronze edge inlays, ember glyph rhythms, levitating parts, no
plates/bolts/windows/nozzles.  NEW for the guardians: one acid-green sensor
"eye" (kov_warden, = the radar/map token --af-warden #a6f06a) that is also the
colour of their telegraphed beam (vfx/warden_telegraph.png).

straznik_hliadka.glb  Hliadka (patrol), ~5.0 x 3.0 x 2.0, origin = hull centre,
                      bow = +X.  Telegraphed sweeping beam (1.5 s charge).
  Hliadka               obsidian spindle hull + three blade fins (3-fold around X)
                        + three floating drive shards trailing behind
    Hliadka_Ring        floating segmented bronze halo around the hull waist;
                        spin around its local X (glTF +X) - idle animation
    Hliadka_Glyphs      ember glyph inlays (pulse emission; flare while charging)
    Hliadka_Emitter     bow emitter (bronze crown + green eye lens); pivot at
                        (EMIT_X, 0, 0); turn around local Z (Blender) = glTF +Y to
                        sweep the beam (+-50 deg)
      beam_origin       EMPTY at the lens tip, beam along local +X
straznik_roj.glb      Roj swarm drone (8-20 per swarm), ~1.1 x 1.0 x 0.4,
                      origin = centre, bow = +X.  ~0.5k tris.
  Roj                   three obsidian leaf blades in a Y (one forward) + bronze
                        inlays + green eye crystal hovering in the middle
    Roj_Ring            small floating 3-segment ring; spin around local Z (glTF +Y)
    link_0..2           EMPTY at each blade tip: where neighbouring drones snap on
                        when the swarm "joins into a bigger shape"
"""
import math
import random

import bmesh
from mathutils import Matrix, Vector

from lib import geo as G
import kovaci as K

EMIT_X = 2.35


def leaf(name, L, W, T, mat='kov_obsidian', steps=6, curl=0.0):
    """Flat leaf blade along +X from 0 to L, diamond section (width W, thickness
    T), widest at 35 %, sharp tip.  curl lifts the tip (z) a little."""
    secs = []
    for i in range(steps + 1):
        t = i / steps
        w = W * (math.sin(math.pi * min(1.0, t / 0.7) * 0.5) if t < 0.35 else (1 - (t - 0.35) / 0.65) ** 0.9)
        w = max(w, 0.01)
        th = T * max(0.15, 1 - t)
        z = curl * t * t
        c = Vector((L * t, 0, z))
        secs.append([c + Vector((0, -w / 2, 0)), c + Vector((0, 0, th / 2)), c + Vector((0, w / 2, 0)),
                     c + Vector((0, 0, -th / 2))])
    return K.loft(name, secs, mat)


def _rot(ob, axis, deg, origin=(0, 0, 0)):
    G.apply_modifiers(ob)
    G.bake_transform(ob)
    o = Vector(origin)
    ob.data.transform(Matrix.Translation(o) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-o))
    return ob


def _dashes(name, p0, p1, w, lift_n, out, scale=1.0):
    """Ember glyph rhythm (long-short-short) along the segment p0 -> p1."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    L = d.length
    t = 0.0
    k = 0
    pat = (0.26, 0.09, 0.09)
    while t < 1.0:
        seg = pat[k % 3] * scale / max(L, 1e-6)
        a, b = t, min(1.0, t + seg)
        out.append(K.bar(f'{name}{k}', p0 + d * a + lift_n, p0 + d * b + lift_n, w, 'kov_ember'))
        t = b + (0.16 if k % 3 == 2 else 0.07) * scale / max(L, 1e-6)
        k += 1


# ----------------------------------------------------------------------------
# Hliadka - patrol
# ----------------------------------------------------------------------------
def build_hliadka(atlas_dir, seed=11):
    rng = random.Random(seed)
    st, gl = [], []
    # spindle hull: lofted diamond sections along X, sharp at both ends
    secs = []
    n = 10
    for i in range(n + 1):
        t = i / n
        x = -2.3 + 4.4 * t
        r = 0.62 * math.sin(math.pi * t) ** 0.7 + 0.02
        secs.append([Vector((x, 0, r * 0.85)), Vector((x, r * 0.62, r * 0.42)), Vector((x, r, -0.05 * r)),
                     Vector((x, r * 0.45, -r * 0.5)), Vector((x, 0, -r * 0.62)), Vector((x, -r * 0.45, -r * 0.5)),
                     Vector((x, -r, -0.05 * r)), Vector((x, -r * 0.62, r * 0.42))])
    sp = K.loft('Spindle', secs, 'kov_obsidian')
    G.set_smooth(sp, True)          # smooth spindle (flat facets flashed in a checker pattern)
    st.append(sp)
    # bronze keel lines along the four ridges
    for k, (y, z) in enumerate(((0, 1), (1, 0), (-1, 0))):
        pts = [Vector((-2.0 + 3.8 * i / 8, 0, 0)) for i in range(9)]
        for i in range(8):
            t0, t1 = (pts[i].x + 2.3) / 4.4, (pts[i + 1].x + 2.3) / 4.4
            r0 = 0.62 * math.sin(math.pi * t0) ** 0.7 + 0.03
            r1 = 0.62 * math.sin(math.pi * t1) ** 0.7 + 0.03
            a = pts[i] + Vector((0, y * r0, z * r0 * 0.85))
            b = pts[i + 1] + Vector((0, y * r1, z * r1 * 0.85))
            st.append(K.bar(f'Keel{k}{i}', a, b, 0.05, 'kov_bronze'))
    # three blade fins, 3-fold around the X axis (dorsal + two lower laterals), swept back
    for k, ang in enumerate((90, 210, 330)):
        f = leaf(f'Fin{k}', 2.1, 1.1, 0.14, curl=0.0)
        _rot(f, 'Z', 180)                       # point backward (-X)
        G.transform(f, loc=(0.4, 0, 0))
        _rot(f, 'X', ang)                       # blade width along the radial direction
        # move out to the hull surface and sweep
        dirn = Vector((0, math.cos(math.radians(ang)), math.sin(math.radians(ang))))
        f.data.transform(Matrix.Translation(dirn * 0.82))
        # tilt the fin outward
        st.append(f)
        # ember glyphs along the fin
        tang = Vector((1, 0, 0)).cross(dirn).normalized()
        for sgn in (1, -1):
            _dashes(f'FinGl{k}{sgn}_', Vector((0.0, 0, 0)) + dirn * 0.95, Vector((-1.1, 0, 0)) + dirn * 0.95,
                    0.05, tang * sgn * 0.07, gl, 0.9)
    # ember glyph rhythm along the dorsal ridge
    _dashes('DorsalGl', (-1.6, 0, 0.5), (1.2, 0, 0.5), 0.05, Vector((0, 0, 0.04)), gl, 1.0)
    # three floating drive shards trailing behind (no nozzles - they levitate)
    for k, ang in enumerate((30, 150, 270)):
        dirn = Vector((0, math.cos(math.radians(ang)), math.sin(math.radians(ang))))
        sh = K.octa(f'Shard{k}', 0.16, 0.45, 'kov_obsidian')
        G.apply_modifiers(sh)
        sh.data.transform(Matrix.Translation(Vector((-2.75, 0, 0)) + dirn * 0.42) @ Matrix.Rotation(math.radians(-90), 4, 'Y'))
        st.append(sh)
        cr = K.octa(f'ShardGlow{k}', 0.07, 0.16, 'kov_crystal')
        G.apply_modifiers(cr)
        cr.data.transform(Matrix.Translation(Vector((-3.1, 0, 0)) + dirn * 0.42) @ Matrix.Rotation(math.radians(-90), 4, 'Y'))
        st.append(cr)
    root = G.join(st, 'Hliadka')
    G.finalize(root, atlas_dir)
    glyph = G.join(gl, 'Hliadka_Glyphs')
    G.finalize(glyph, atlas_dir)
    glyph.parent = root
    # floating halo ring around the waist (ring axis = X)
    ring, rgl = K.seg_ring('Halo', 1.05, 0.0, 5, 12.0, 0.16, 0.12)
    halo = G.join(ring + rgl, 'Hliadka_Ring')
    halo.data.transform(Matrix.Rotation(math.radians(90), 4, 'Y'))
    G.finalize(halo, atlas_dir)
    halo.location = (-0.3, 0, 0)
    halo.parent = root
    # bow emitter: bronze crown of three prongs + green eye lens
    ep = []
    for k, ang in enumerate((90, 210, 330)):
        dirn = Vector((0, math.cos(math.radians(ang)), math.sin(math.radians(ang))))
        pr = leaf(f'Prong{k}', 0.7, 0.22, 0.08, mat='kov_bronze')
        G.apply_modifiers(pr)
        # point the prong forward and slightly outward
        m = Matrix.Translation(dirn * 0.18) @ (Vector((1, 0, 0)).rotation_difference((Vector((1, 0, 0)) + dirn * 0.35).normalized())).to_matrix().to_4x4()
        pr.data.transform(m)
        ep.append(pr)
    eye = K.octa('Eye', 0.17, 0.32, 'kov_warden')
    G.apply_modifiers(eye)
    eye.data.transform(Matrix.Translation((0.32, 0, 0)) @ Matrix.Rotation(math.radians(-90), 4, 'Y'))
    ep.append(eye)
    ep.append(G.cyl('EyeSocket', 0.2, 0.14, 'kov_obsidian', loc=(0.05, 0, 0), axis='X', verts=6, r2=0.12))
    em = G.join(ep, 'Hliadka_Emitter')
    G.finalize(em, atlas_dir)
    G.set_smooth(em, False)
    em.location = (EMIT_X, 0, 0)
    em.parent = root
    bo = G.empty('beam_origin', loc=(0.64, 0, 0), size=0.2)
    bo.parent = em
    return root


# ----------------------------------------------------------------------------
# Roj - swarm drone
# ----------------------------------------------------------------------------
def build_roj(atlas_dir, seed=12):
    st, gl = [], []
    tips = []
    for k, ang in enumerate((0, 120, 240)):
        L = 0.62 if k == 0 else 0.5
        b = leaf(f'Blade{k}', L, 0.3, 0.09, steps=4, curl=0.04)
        G.transform(b, loc=(0.1, 0, 0))
        _rot(b, 'Z', ang)
        st.append(b)
        a = math.radians(ang)
        d = Vector((math.cos(a), math.sin(a), 0))
        tips.append(d * (0.1 + L))
        st.append(K.bar(f'Inlay{k}', d * 0.16 + Vector((0, 0, 0.035)), d * (0.1 + L * 0.7) + Vector((0, 0, 0.02)),
                        0.025, 'kov_bronze'))
        gl.append(K.bar(f'Gl{k}', d * 0.22 + Vector((0, 0, 0.05)), d * 0.34 + Vector((0, 0, 0.045)), 0.03,
                        'kov_ember'))
    eye = K.octa('Eye', 0.11, 0.17, 'kov_warden', loc=(0, 0, 0.16))
    st.append(eye)
    root = G.join(st + gl, 'Roj')
    G.finalize(root, atlas_dir)
    G.set_smooth(root, False)
    ring, rgl = K.seg_ring('R', 0.3, 0.0, 3, 30.0, 0.06, 0.05, glyph=False)
    rr = G.join(ring, 'Roj_Ring')
    G.finalize(rr, atlas_dir)
    rr.location = (0, 0, 0.16)
    rr.parent = root
    for k, p in enumerate(tips):
        e = G.empty(f'link_{k}', loc=p, size=0.1)
        e.rotation_euler = (0, 0, math.radians(k * 120))
        e.parent = root
    return root


BUILDERS = {'straznik_hliadka': build_hliadka, 'straznik_roj': build_roj}
