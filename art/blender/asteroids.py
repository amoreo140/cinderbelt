"""Asteroids - final style "C, refined faceted" (chosen by the user, without
inlaid bands).

  * deliberate large facets, every facet edge chamfered so it catches light
  * per-facet brightness variation + ray-cast AO + resource tint in vertex
    colour (glTF COLOR_0; three.js GLTFLoader enables vertexColors on its
    own).  Crevices fade to a resource-tinted colour, never black.
  * 2-4 crystal / ore clusters of varied size as the hero feature, plus small
    embedded nuggets so the rock is not bare between clusters
  * three silhouettes per resource: round (a), elongated (b), chunky/blocky (c)

Shared AF_Palette material (st_rock_* / st_ore_* swatches).  <= ~3k tris.
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
from mathutils import Vector  # noqa: E402

from lib import geo as G  # noqa: E402
import asteroid_styles as S  # noqa: E402
import veins as V  # noqa: E402

# name, kind, seed, radius, shape
VARIANTS = [
    ('asteroid_iron_a', 'iron', 11, 1.6, 'round'),
    ('asteroid_iron_b', 'iron', 23, 2.2, 'elongated'),
    ('asteroid_iron_c', 'iron', 97, 2.4, 'chunky'),
    ('asteroid_ice_a', 'ice', 37, 1.8, 'round'),
    ('asteroid_ice_b', 'ice', 41, 2.3, 'elongated'),
    ('asteroid_ice_c', 'ice', 103, 2.6, 'chunky'),
    ('asteroid_copper_a', 'copper', 53, 1.6, 'round'),
    ('asteroid_copper_b', 'copper', 67, 2.2, 'elongated'),
    ('asteroid_copper_c', 'copper', 109, 2.4, 'chunky'),
    ('asteroid_titanium_a', 'titanium', 71, 1.7, 'round'),
    ('asteroid_titanium_b', 'titanium', 89, 2.2, 'elongated'),
    ('asteroid_titanium_c', 'titanium', 113, 2.5, 'chunky'),
    # M5a ring 3: crystal fields (Kr, singing veins, radiation shadow) + rare-earth VZ rocks (fast short veins)
    ('asteroid_crystal_a', 'crystal', 131, 2.0, 'round'),
    ('asteroid_crystal_b', 'crystal', 137, 2.5, 'elongated'),
    ('asteroid_crystal_c', 'crystal', 139, 2.6, 'chunky'),
    ('asteroid_rare_a', 'rare', 149, 1.7, 'round'),
    ('asteroid_rare_b', 'rare', 151, 2.1, 'chunky'),
]
KIND_OF = {v[0]: v[1] for v in VARIANTS}

SHAPES = {
    # sculpt params, decimate ratio, number of chisel cuts, cut depth
    'round':     dict(sculpt=dict(amp=0.20, detail=0.5, lobes=(1, 2), craters=(2, 3)),
                      ratio=0.12, cuts=(3, 4), depth=(0.84, 0.9)),
    'elongated': dict(sculpt=dict(amp=0.22, detail=0.5, lobes=(2, 3), craters=(1, 3), stretch=1.55,
                                  squash=(0.55, 0.68)),
                      ratio=0.12, cuts=(4, 5), depth=(0.82, 0.88)),
    'chunky':    dict(sculpt=dict(amp=0.30, detail=0.4, lobes=(2, 3), craters=(1, 2), squash=(0.7, 0.85)),
                      ratio=0.07, cuts=(6, 8), depth=(0.72, 0.84)),
}

# crystal look per resource: sides, flatness, width/length, tip fraction
CRYSTAL = {
    'iron':     dict(sides=6, flat=1.0, w=0.22, tip=0.35),
    'copper':   dict(sides=4, flat=1.0, w=0.34, tip=0.12),
    'ice':      dict(sides=6, flat=1.0, w=0.20, tip=0.38),
    'titanium': dict(sides=4, flat=0.45, w=0.30, tip=0.30),
    'crystal':  dict(sides=6, flat=1.0, w=0.15, tip=0.42),     # long slender "singing" crystals
    'rare':     dict(sides=4, flat=0.75, w=0.26, tip=0.22),    # emerald rare-earth prisms
    'comet':    dict(sides=6, flat=1.0, w=0.22, tip=0.35),
    'exotic':   dict(sides=3, flat=1.0, w=0.2, tip=0.5),       # T4 exotic matter (icon only for now)
}


def _crystal(name, res, L, scale_w=1.0):
    c = CRYSTAL[res]
    w = L * c['w'] * scale_w
    bev = w * 0.1 if (c['sides'] == 4 and L > 0.25) else 0.0   # chamfer only the blocky, larger ones
    return S.crystal(name, L, w, S.RES[res]['ore'], sides=c['sides'], flat=c['flat'],
                     bevel_w=bev, tip=c['tip'])


def make_rock(name, res, rng, radius, shape):
    sh = SHAPES[shape]
    bm = S.sculpt_bm(rng, radius, subdiv=4, **sh['sculpt'])
    tmp = G.obj_from_bm('tmp_rock', bm, [S.RES[res]['rock']])
    S.decimate(tmp, ratio=sh['ratio'])
    bm = bmesh.new()
    bm.from_mesh(tmp.data)
    bpy.data.objects.remove(tmp)
    S.planar_cuts(bm, rng, rng.randint(*sh['cuts']), depth=sh['depth'])
    rock = G.obj_from_bm(name + '_rock', bm, [S.RES[res]['rock']])
    S.bevel(rock, radius * 0.024, 1, 12, harden=False)
    G.set_smooth(rock, False)
    return rock


def dress(rock, res, rng, radius):
    """2-4 hero clusters of varied size + small embedded nuggets."""
    pieces, centres = [], []
    up = Vector((0, 0, 1))
    n_cl = rng.randint(3, 4) if res != 'crystal' else 5
    pts = S.surface_points(rock, rng, n_cl, radius, bias=up)
    for ci, (p, n) in enumerate(pts):
        centres.append(p)
        size = (1.0, 0.8, 0.65, 0.55, 0.5)[ci] * rng.uniform(0.9, 1.1)
        for j in range(rng.randint(5, 7) + (2 if res == 'crystal' else 0)):
            big = 1.0 if j == 0 else rng.uniform(0.45, 0.8)
            L = radius * 0.64 * size * big * {'ice': 1.1, 'crystal': 1.3, 'rare': 0.8, 'exotic': 1.35, 'comet': 1.15}.get(res, 1.0)
            cr = _crystal(f'Cr{ci}_{j}', res, L)
            dirn = (n + Vector([rng.uniform(-0.65, 0.65) for _ in range(3)]) * (0 if j == 0 else 1)).normalized()
            off = Vector([rng.uniform(-1, 1) for _ in range(3)]) * radius * 0.09 * size * (j > 0)
            S.align(cr, p + off - n * 0.05 * radius, dirn)
            pieces.append(cr)
    # embedded nuggets / glints between the clusters (only the tips poke out)
    for k, (p, n) in enumerate(S.surface_points(rock, rng, rng.randint(15, 20), radius, spacing=0.24)):
        if any((p - c).length < radius * 0.32 for c in centres):
            continue
        L = radius * rng.uniform(0.11, 0.19)
        cr = _crystal(f'Ng{k}', res, L, scale_w=1.2)
        dirn = (n + Vector([rng.uniform(-0.5, 0.5) for _ in range(3)])).normalized()
        S.align(cr, p - n * L * 0.35, dirn)
        pieces.append(cr)
    return pieces, centres


def build(name, kind, seed, radius, atlas_dir, shape=None, veins=False):
    """veins=True (iron/copper/titanium only): carve 1-3 ore-vein grooves and
    add the `Vein_<i>` fill meshes as children (see veins.py).  The vein
    layout comes from its own RNG, so the rock shape and the crystal dressing
    stay exactly as without veins (only nuggets that would sit in a groove
    are dropped).  The planned veins.Vein objects end up in VEINS[name]."""
    rng = random.Random(seed)
    shape = shape if isinstance(shape, str) else 'round'
    rock = make_rock(name, kind, rng, radius, shape)
    pieces, centres = dress(rock, kind, rng, radius)
    vs = []
    if veins and kind in V.KINDS:
        vs = V.plan(rock, random.Random(seed * 7919 + 13), radius, shape, centres, kind=kind)
        V.carve(rock, vs)
        keep = [p for p in pieces if not V.intersects(p, vs)]
        for p in pieces:
            if p not in keep:
                bpy.data.objects.remove(p)
        pieces = keep
    ob = G.join([rock] + pieces, name)
    G.finalize(ob, atlas_dir)
    S.vertex_colours(ob, kind, centres, radius, rng, facet=True)
    G.set_smooth(ob, False)
    if vs:
        V.groove_tint(ob, vs, kind)
        nrng = random.Random(seed * 31 + 5)
        for i, v in enumerate(vs):
            f = V.fill_mesh(v, kind, f'Vein_{i}', nrng)
            f = V.add_nuggets(f, v, kind, nrng)
            G.finalize(f, atlas_dir)
            V.fill_colours(f)
            f.parent = ob
    VEINS[name] = vs
    return ob


VEINS = {}   # name -> [veins.Vein] of the last build (for veins.json)


# ----------------------------------------------------------------------------
# fragments (visual-only breakup shards): asteroid_frag_<res>_<a|b|c>
# ----------------------------------------------------------------------------
FRAG_SHAPES = {   # radius, sculpt params, cuts, crystal bits
    'a': dict(r=0.30, sculpt=dict(amp=0.25, detail=0.3, lobes=(1, 1), craters=(0, 0)), cuts=(3, 4), bits=0),
    'b': dict(r=0.32, sculpt=dict(amp=0.2, detail=0.3, lobes=(1, 1), craters=(0, 0), stretch=1.8,
                                 squash=(0.45, 0.6)), cuts=(3, 4), bits=1),
    'c': dict(r=0.36, sculpt=dict(amp=0.22, detail=0.3, lobes=(1, 2), craters=(0, 0), squash=(0.4, 0.5)),
              cuts=(2, 3), bits=2),
}
FRAGMENTS = [(f'asteroid_frag_{k}_{v}', k, 300 + i * 7 + j, v)
             for i, k in enumerate(('iron', 'ice', 'copper', 'titanium', 'crystal', 'rare')) for j, v in enumerate('abc')]


def build_fragment(name, kind, seed, variant, atlas_dir):
    rng = random.Random(seed)
    fs = FRAG_SHAPES[variant]
    r = fs['r']
    bm = S.sculpt_bm(rng, r, subdiv=2, **fs['sculpt'])
    S.planar_cuts(bm, rng, rng.randint(*fs['cuts']), depth=(0.55, 0.75))
    rock = G.obj_from_bm(name + '_rock', bm, [S.RES[kind]['rock']])
    S.bevel(rock, r * 0.05, 1, 20, harden=False)
    pieces, centres = [], []
    for k, (p, n) in enumerate(S.surface_points(rock, rng, fs['bits'], r, spacing=0.6)):
        L = r * rng.uniform(0.5, 0.8)
        cr = _crystal(f'Bit{k}', kind, L, scale_w=1.1)
        S.align(cr, p - n * L * 0.3, (n + Vector([rng.uniform(-0.4, 0.4) for _ in range(3)])).normalized())
        pieces.append(cr)
        centres.append(p)
    ob = G.join([rock] + pieces, name)
    G.finalize(ob, atlas_dir)
    S.vertex_colours(ob, kind, centres, r, rng, samples=8, facet=True)
    G.set_smooth(ob, False)
    return ob


if __name__ == '__main__':
    import build_all
    build_all.main(['--only', 'asteroids'])
