"""Mining laser 1x1 (game id "miningLaser") - a turret head on a swivel ring,
barrel and glowing emitter lens facing +X.

Node layout (pivots = node origins):
  MiningLaser_<Tier>          root, static base (cell centre, z = 0)
    Laser_Head                turret head; pivot (0, 0, HEAD_Z) on the cell's
                              vertical axis.  Rotate around local Z (Blender)
                              = glTF local +Y to aim (+-60 deg from +X).
      Muzzle                  empty at the lens tip = beam origin, points +X.

Level 2: heat-sink rings along the barrel, glowing coil, side capacitor pods.
"""
import math
from lib import geo as G
from lib import palette as P
from parts import common as C

PART = 'mining_laser'

HEAD_Z = C.DECK_TOP + 0.05     # top of the swivel ring
BARREL_Z = 0.17                # barrel axis height above the pivot
MUZZLE_X = 0.47                # stays inside the cell at any aim angle


def build(tier, atlas_dir):
    t = P.TIERS[tier]
    lvl = C.level(t)
    top = C.DECK_TOP
    pcs = C.core_block(tier=t)
    pcs.append(C.deck_plate('Plate', mat=t['plate']))
    # swivel ring + dark well
    pcs.append(G.ring_band('Swivel', 0.33, 0.27, top - 0.01, top + 0.05, 'hull_mid', verts=24,
                           top_mat=t['plate']))
    pcs.append(G.cyl('Well', 0.275, 0.03, 'trim_black', loc=(0, 0, top + 0.005), verts=24))
    # arc of tick marks showing the +-60 deg firing arc
    for i, a in enumerate((-60, -30, 0, 30, 60)):
        r = math.radians(a)
        b = G.box(f'Tick{i}', -0.02, 0.02, -0.008, 0.008, top - 0.004, top + 0.006,
                  'laser_glow' if a == 0 else t['accent'])
        G.transform(b, loc=(0.39 * math.cos(r), 0.39 * math.sin(r), 0), rot=(0, 0, a))
        pcs.append(b)
    pcs += C.bolts('Bolt', [(x, y) for x in (-0.40, 0.40) for y in (-0.40, 0.40)], top + 0.005, r=0.022)
    pcs += C.corner_brackets(t, top)
    root = G.join(pcs, f'MiningLaser_{tier.capitalize()}')
    G.finalize(root, atlas_dir)

    # ---- turret head, modelled around its pivot --------------------------
    hp = []
    hp.append(G.cyl('HeadBase', 0.255, 0.05, t['core'], loc=(0, 0, 0.02), verts=24, bevel=0.01, seg=1))
    hp.append(G.prism('Housing', G.chamfer_rect(-0.24, 0.14, -0.175, 0.175, 0.06), 0.04, 0.29,
                      t['plate'], bevel=0.024, seg=2))
    hp.append(G.box('TopStripe', -0.20, 0.09, -0.04, 0.04, 0.285, 0.302, t['accent'], bevel=0.005, seg=1))
    hp.append(G.box('PowerGlow', -0.225, -0.15, -0.12, 0.12, 0.285, 0.298, 'laser_glow', bevel=0.004, seg=1))
    for s in (1, -1):
        for i, x in enumerate((-0.18, -0.11, -0.04)):
            hp.append(G.box(f'Fin{s}{i}', x - 0.02, x + 0.02, min(0.175 * s, 0.22 * s), max(0.175 * s, 0.22 * s),
                            0.07, 0.25, 'trim_black'))
        if lvl >= 2:  # capacitor pods with glowing caps on the head sides
            hp.append(G.cyl(f'Pod{s}', 0.045, 0.16, t['accent'], loc=(0.03, 0.2 * s, 0.11), axis='X', verts=10))
            hp.append(G.cyl(f'PodGlow{s}', 0.032, 0.015, t['glow'], loc=(0.115, 0.2 * s, 0.11), axis='X', verts=12))
    # barrel: sleeve, focusing rings, emitter shroud, lens
    hp.append(G.cyl('Barrel', 0.072, 0.30, 'metal_bare', loc=(0.27, 0, BARREL_Z), axis='X', verts=16))
    rings = ((0.19, t['accent']), (0.30, t['core'])) if lvl < 2 else \
        ((0.18, t['accent']), (0.235, t['core']), (0.29, t['accent']))
    for i, (x, m) in enumerate(rings):
        hp.append(G.ring_band(f'FocusRing{i}', 0.10, 0.07, -0.018, 0.018, m,
                              loc=(x, 0, BARREL_Z), axis='X', verts=16))
    if lvl >= 2:
        hp.append(G.ring_band('Coil', 0.085, 0.07, -0.012, 0.012, 'laser_glow',
                              loc=(0.345, 0, BARREL_Z), axis='X', verts=16))
    hp.append(G.lathe('Shroud', [(0.0, 0.08), (0.0, 0.108), (0.06, 0.112), (0.068, 0.085), (0.06, 0.068)],
                      [0, 0, 1, 1, 0], ['hull_dark', 'trim_black'], loc=(0.385, 0, BARREL_Z), axis='X', verts=16))
    if lvl >= 3:  # T3: three focusing prisms around the shroud + gem ridge on the housing
        for i, a in enumerate((90, 210, 330)):
            r = math.radians(a)
            g = C.gem(f'Prism{i}', 0.10, 0.022, sides=4)
            C.place(g, (0.36, 0.105 * math.cos(r), BARREL_Z + 0.105 * math.sin(r)), (1.0, 0.25 * math.cos(r),
                                                                                    0.25 * math.sin(r)))
            hp.append(g)
        hp.append(C.gem_bar('RidgeGem', (-0.19, 0, 0.295), (0.08, 0, 0.295), 0.05, 0.04))
    hp.append(G.ellipsoid('Lens', 0.032, 0.078, 0.078, 'laser_glow', seg=12, rings=6))
    hp[-1].location = (MUZZLE_X - 0.03, 0, BARREL_Z)
    head = G.join(hp, 'Laser_Head')
    G.finalize(head, atlas_dir)
    head.location = (0, 0, HEAD_Z)
    head.parent = root

    muzzle = G.empty('Muzzle', loc=(MUZZLE_X, 0, BARREL_Z))
    muzzle.parent = head
    return root
