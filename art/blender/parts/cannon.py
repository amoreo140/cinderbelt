"""Cannon 1x1 (game id "cannon") - armoured turret on a swivel ring, barrel
facing +X at rest.

Node layout (pivots = node origins):
  Cannon_<Tier>           root, static base (cell centre, z = 0)
    Cannon_Turret         turret; pivot (0, 0, HEAD_Z) on the cell's vertical
                          axis.  Rotate around local Z (Blender) = glTF local +Y
                          (aim arc about +-90 deg; everything stays above the deck).
      Cannon_Muzzle       empty at the barrel tip = projectile origin, points +X.

Level 2: cooled barrel shroud with glowing coil, side armour fins, twin feed glow.
"""
import math
from lib import geo as G
from lib import palette as P
from parts import common as C

PART = 'cannon'

HEAD_Z = C.DECK_TOP + 0.05      # top of the swivel ring
BARREL_Z = 0.14                 # barrel axis height above the pivot
MUZZLE_X = 0.47


def build(tier, atlas_dir):
    t = P.TIERS[tier]
    lvl = C.level(t)
    top = C.DECK_TOP
    pcs = C.core_block(tier=t)
    pcs.append(C.deck_plate('Plate', mat=t['plate']))
    pcs.append(G.ring_band('Swivel', 0.32, 0.26, top - 0.01, top + 0.05, 'hull_mid', verts=24, top_mat=t['plate']))
    pcs.append(G.cyl('Well', 0.265, 0.03, 'trim_black', loc=(0, 0, top + 0.005), verts=24))
    for i, a in enumerate((-90, -45, 0, 45, 90)):   # firing-arc ticks
        r = math.radians(a)
        b = G.box(f'Tick{i}', -0.022, 0.022, -0.009, 0.009, top - 0.004, top + 0.006,
                  'cannon_glow' if a == 0 else t['accent'])
        G.transform(b, loc=(0.385 * math.cos(r), 0.385 * math.sin(r), 0), rot=(0, 0, a))
        pcs.append(b)
    pcs += C.bolts('Bolt', [(x, y) for x in (-0.40, 0.40) for y in (-0.40, 0.40)], top + 0.005, r=0.022)
    pcs += C.corner_brackets(t, top)
    root = G.join(pcs, f'Cannon_{tier.capitalize()}')
    G.finalize(root, atlas_dir)

    # ---- turret (modelled around its pivot) -------------------------------
    tp = []
    tp.append(G.cyl('TurretBase', 0.245, 0.05, t['core'], loc=(0, 0, 0.02), verts=24, bevel=0.01, seg=1))
    hull = [(-0.22, -0.16), (0.0, -0.16), (0.10, -0.08), (0.10, 0.08), (0.0, 0.16), (-0.22, 0.16)]
    tp.append(G.prism('Housing', hull, 0.04, 0.20, t['plate'], bevel=0.02, seg=2))
    roof = [(-0.18, -0.11), (-0.02, -0.11), (0.05, -0.05), (0.05, 0.05), (-0.02, 0.11), (-0.18, 0.11)]
    tp.append(G.prism('Roof', roof, 0.19, 0.235, t['plate'], bevel=0.012, seg=1))
    tp.append(G.box('RoofStripe', -0.16, 0.02, -0.035, 0.035, 0.23, 0.245, t['accent'], bevel=0.004, seg=1))
    tp.append(G.box('Hatch', -0.16, -0.09, 0.05, 0.10, 0.23, 0.25, t['core'], bevel=0.006, seg=1))
    tp.append(G.box('Mantlet', 0.07, 0.15, -0.10, 0.10, 0.05, 0.21, t['core'], bevel=0.015, seg=1))
    # ammo feed glow on the rear
    feeds = (0.0,) if lvl < 2 else (-0.07, 0.07)
    for i, y in enumerate(feeds):
        tp.append(G.box(f'Feed{i}', -0.245, -0.225, y - 0.035, y + 0.035, 0.08, 0.17, 'cannon_glow'))
    # barrel + muzzle brake
    tp.append(G.cyl('Barrel', 0.05, 0.32, 'metal_bare', loc=(0.29, 0, BARREL_Z), axis='X', verts=12))
    tp.append(G.cyl('Brake', 0.066, 0.075, t['core'], loc=(0.43, 0, BARREL_Z), axis='X', verts=8,
                    bevel=0.008, seg=1))
    tp.append(G.box('BrakeSlot', 0.415, 0.455, -0.065, 0.065, BARREL_Z - 0.012, BARREL_Z + 0.012, 'trim_black'))
    if lvl < 2:
        for i, x in enumerate((0.19, 0.32)):
            tp.append(G.ring_band(f'Collar{i}', 0.07, 0.048, -0.015, 0.015, t['accent'], loc=(x, 0, BARREL_Z),
                                  axis='X', verts=12))
    else:
        tp.append(G.cyl('Shroud', 0.066, 0.17, t['plate'], loc=(0.25, 0, BARREL_Z), axis='X', verts=12,
                        bevel=0.008, seg=1))
        for i, x in enumerate((0.19, 0.25, 0.31)):
            tp.append(G.ring_band(f'Cool{i}', 0.076, 0.062, -0.008, 0.008,
                                  t['glow'] if i == 1 else t['accent'], loc=(x, 0, BARREL_Z), axis='X', verts=12))
        for s in (1, -1):
            fin = [(-0.20, 0.0), (0.06, 0.0), (0.0, 0.07), (-0.20, 0.07)]
            f = G.prism(f'ArmorFin{s}', fin, -0.012, 0.012, t['accent'], bevel=0.004, seg=1)
            G.transform(f, loc=(-0.02, 0.17 * s, 0.10), rot=(90, 0, 0))
            tp.append(f)
    if lvl >= 3:  # T3: crystal accelerator rails along the barrel shroud + gem roof ridge
        for s in (1, -1):
            tp.append(C.gem_bar(f'RailGem{s}', (0.17, 0.068 * s, BARREL_Z + 0.03), (0.34, 0.068 * s, BARREL_Z + 0.03),
                                0.03, 0.03))
        tp.append(C.gem_bar('RoofGem', (-0.15, 0, 0.243), (0.01, 0, 0.243), 0.05, 0.04))
    turret = G.join(tp, 'Cannon_Turret')
    G.finalize(turret, atlas_dir)
    turret.location = (0, 0, HEAD_Z)
    turret.parent = root

    muzzle = G.empty('Cannon_Muzzle', loc=(MUZZLE_X, 0, BARREL_Z))
    muzzle.parent = turret
    return root
