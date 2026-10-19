"""Radar 1x1 - parabolic dish on a pedestal.

Node layout (pivots = node origins):
  Radar_Iron        root, static base (cell centre, z = 0)
    Radar_Dish      dish + yoke; pivot (0, 0, PIVOT_Z) on the cell's vertical
                    axis.  The game spins it around local Z (Blender)
                    = glTF local +Y.  At rotation 0 the dish faces +X, tilted
                    30 deg up.
"""
import math
from mathutils import Euler, Matrix, Vector
from lib import geo as G
from lib import palette as P
from parts import common as C

PART = 'radar'

PIVOT_Z = 0.42
DISH_TILT = 60          # deg: rotation about Y of the dish axis from +Z (-> 30 deg elevation)
DISH_OFFSET = 0.17      # dish centre above the pivot


def build(tier, atlas_dir):
    t = P.TIERS[tier]
    top = C.DECK_TOP
    lvl = C.level(t)
    pcs = C.core_block(tier=t)
    pcs.append(C.deck_plate('Plate', mat=t['plate']))
    pcs.append(G.ring_band('MountRing', 0.24, 0.14, top - 0.01, top + 0.04, 'hull_mid', verts=24,
                           top_mat=t['plate']))
    if lvl >= 2:  # auxiliary sensor mast with a beacon in the rear corner
        pcs.append(G.box('MastBase', -0.40, -0.30, 0.30, 0.40, top - 0.01, top + 0.04, 'hull_mid', bevel=0.01, seg=1))
        pcs.append(G.cyl('Mast', 0.014, 0.22, 'metal_bare', loc=(-0.35, 0.35, top + 0.14), verts=6))
        pcs.append(G.ellipsoid('Beacon', 0.026, 0.026, 0.026, t['glow'], loc=(-0.35, 0.35, top + 0.26),
                               seg=10, rings=6))
        pcs.append(G.box('MastFin', -0.36, -0.34, 0.27, 0.43, top + 0.18, top + 0.2, t['accent']))
        if lvl >= 3:
            g = C.gem('MastGem', 0.10, 0.026, sides=4)
            C.place(g, (-0.35, 0.35, top + 0.27), (0, 0, 1))
            pcs.append(g)
        pcs += C.corner_brackets(t, top, corners=(0, 2, 3))
    pcs.append(G.cyl('Mount', 0.14, 0.08, 'hull_dark', loc=(0, 0, top + 0.03), verts=20, bevel=0.012, seg=1))
    pcs.append(G.cyl('Post', 0.05, PIVOT_Z - top - 0.06, 'metal_bare',
                     loc=(0, 0, (top + 0.06 + PIVOT_Z) / 2), verts=12))
    pcs.append(G.ring_band('MountGlow', 0.205, 0.17, top + 0.035, top + 0.045, 'radar_glow', verts=24))
    pcs += C.bolts('Bolt', [(x, y) for x in (-0.39, 0.39) for y in (-0.39, 0.39)
                            if lvl < 2 or (x, y) != (-0.39, 0.39)], top + 0.005, r=0.022)
    root = G.join(pcs, f'Radar_{tier.capitalize()}')
    G.finalize(root, atlas_dir)

    # ---- dish (modelled around the pivot) --------------------------------
    dp = []
    dp.append(G.cyl('Swivel', 0.07, 0.05, 'hull_dark', loc=(0, 0, 0.02), verts=16, bevel=0.01, seg=1))
    dp.append(G.box('Yoke', -0.05, 0.05, -0.04, 0.04, 0.03, DISH_OFFSET - 0.02, t['plate'], bevel=0.012, seg=1))
    # paraboloid a = r^2 (concave side facing +Z before tilting)
    prof = [(0.0, 0.0), (0.01, 0.1), (0.04, 0.2), (0.09, 0.3), (0.095, 0.318),
            (0.07, 0.315), (0.0, 0.18), (-0.03, 0.0)]
    segs = [0, 0, 0, 1, 1, 2, 2]
    rot = (0, DISH_TILT, 0)
    dp.append(G.lathe('Dish', prof, segs, ['hull_white', t['accent'], 'hull_mid'], loc=(0, 0, DISH_OFFSET),
                      axis='Z', verts=24, closed=False, rot=rot))
    if lvl >= 2:  # glowing ring on the dish face
        dp.append(G.ring_band('DishGlow', 0.215, 0.19, 0.0, 0.006, t['glow'], verts=24))
        dp[-1].matrix_world = (Matrix.Translation((0, 0, DISH_OFFSET))
                               @ Euler([0, math.radians(DISH_TILT), 0]).to_matrix().to_4x4()
                               @ Matrix.Translation((0, 0, 0.0462)))
    # feed horn on three struts
    R = Euler([math.radians(a) for a in rot]).to_matrix()
    c = Vector((0, 0, DISH_OFFSET))
    focal = c + R @ Vector((0, 0, 0.22))
    feed = G.cyl('Feed', 0.022, 0.06, 'hull_dark', verts=10)
    feed.matrix_world = Matrix.Translation(focal) @ R.to_4x4()
    dp.append(feed)
    if lvl < 3:
        tip = G.ellipsoid('FeedTip', 0.022, 0.022, 0.022, 'radar_glow', seg=10, rings=6)
        tip.location = focal + R @ Vector((0, 0, 0.04))
    else:  # T3: crystal feed horn pointing back into the dish
        tip = C.gem('FeedGem', 0.10, 0.03, sides=6)
        C.place(tip, focal + R @ Vector((0, 0, 0.02)), R @ Vector((0, 0, 1)))
    dp.append(tip)
    for i, ang in enumerate((90, 210, 330)):
        a = math.radians(ang)
        rim = c + R @ Vector((0.27 * math.cos(a), 0.27 * math.sin(a), 0.073))
        d = focal - rim
        st = G.cyl(f'Strut{i}', 0.008, d.length, 'metal_bare', verts=6)
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        st.matrix_world = Matrix.Translation((rim + focal) / 2) @ q.to_matrix().to_4x4()
        dp.append(st)
    dish = G.join(dp, 'Radar_Dish')
    G.finalize(dish, atlas_dir)
    dish.location = (0, 0, PIVOT_Z)
    dish.parent = root
    return root
