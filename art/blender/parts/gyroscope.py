"""Gyroscope 1x1 - gimbal rings above a glowing well.

Animated child nodes (pivot = node origin):
  Gyro_Ring_Outer  - spin around its local Z (Blender) = glTF local +Y (up)
  Gyro_Ring_Inner  - child of the outer ring, tilt/spin around its local X
                   (glTF local +X)
"""
import math
from lib import geo as G
from lib import palette as P
from parts import common as C

PART = 'gyroscope'

RING_Z = 0.48   # gimbal centre height


def build(tier, atlas_dir):
    t = P.TIERS[tier]
    lvl = C.level(t)
    pcs = C.core_block(tier=t)
    pcs.append(C.deck_plate('Plate', mat=t['plate']))
    top = C.DECK_TOP
    # raised collar around the well
    pcs.append(G.ring_band('Collar', 0.37, 0.31, top - 0.02, top + 0.05, 'hull_mid',
                           verts=20, top_mat=t['plate']))
    pcs.append(G.cyl('WellFloor', 0.315, 0.04, 'trim_black', loc=(0, 0, top - 0.005), verts=20))
    pcs.append(G.ring_band('WellGlow', 0.27, 0.22, top + 0.012, top + 0.022, 'gyro_glow', verts=20))
    if lvl >= 2:  # second, outer glow ring on the collar + glowing wedge tips
        pcs.append(G.ring_band('CollarGlow', 0.355, 0.325, top + 0.05, top + 0.058, t['glow'], verts=20))
    # tier-coloured corner wedges
    h, c = C.PLATE_HALF, 0.17
    for i, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        tri = [(sx * h, sy * (h - c)), (sx * h, sy * (h - 0.07)), (sx * (h - 0.07), sy * h),
               (sx * (h - c), sy * h)]
        if sx * sy < 0:
            tri = list(reversed(tri))
        pcs.append(G.prism(f'Wedge{i}', tri, top - 0.01, top + 0.02, t['accent'], bevel=0.008, seg=1))
        if lvl >= 2:
            tip = [(sx * (h - 0.035), sy * (h - 0.115)), (sx * (h - 0.035), sy * (h - 0.075)),
                   (sx * (h - 0.075), sy * (h - 0.035)), (sx * (h - 0.115), sy * (h - 0.035))]
            if sx * sy < 0:
                tip = list(reversed(tip))
            pcs.append(G.prism(f'WedgeGlow{i}', tip, top + 0.015, top + 0.028, t['glow']))
    pcs += C.bolts('Bolt', [(0.36 * math.cos(a), 0.36 * math.sin(a))
                            for a in (math.radians(d) for d in (0, 90, 180, 270))],
                   top + 0.055, r=0.022)
    # axle + glowing core (static)
    pcs.append(G.cyl('Axle', 0.05, 0.06, 'metal_bare', loc=(0, 0, top + 0.03), verts=12,
                     bevel=0.01, seg=1))
    if lvl < 3:
        pcs.append(G.ellipsoid('CoreOrb', 0.085, 0.085, 0.085, 'gyro_glow', loc=(0, 0, RING_Z),
                               seg=12, rings=8))
    else:  # T3: floating double-pointed crystal + gems in the wedge tips
        for k, d in enumerate((1, -1)):
            g = C.gem(f'CoreGem{k}', 0.15, 0.07, sides=6, tip=0.55, base=0.0)
            C.place(g, (0, 0, RING_Z), (0, 0, d))
            pcs.append(g)
    root = G.join(pcs, f'Gyroscope_{tier.capitalize()}')
    G.finalize(root, atlas_dir)

    # ---- animated rings (built around their own pivot) -------------------
    outer = [G.torus('RingO', 0.285, 0.026, t['plate'], rot=(90, 0, 0), maj=24, mnr=6)]
    if lvl >= 2:  # glowing inlay lines on both faces of the outer ring
        for s in (1, -1):
            outer.append(G.torus(f'RingOGlow{s}', 0.285, 0.009, t['glow'], loc=(0, 0.02 * s, 0),
                                 rot=(90, 0, 0), maj=24, mnr=3))
    for i, a in enumerate((45, 135, 225, 315)):
        ang = math.radians(a)
        x, z = 0.285 * math.cos(ang), 0.285 * math.sin(ang)
        b = G.box(f'RingOBlock{i}', -0.03, 0.03, -0.04, 0.04, -0.045, 0.045, t['accent'],
                  bevel=0.01, seg=1)
        G.transform(b, loc=(x, 0, z), rot=(0, -a, 0))
        outer.append(b)
    for i, z in enumerate((0.285, -0.285)):
        outer.append(G.cyl(f'RingOHub{i}', 0.035, 0.05, 'metal_bare', loc=(0, 0, z), verts=10))
    ring_o = G.join(outer, 'Gyro_Ring_Outer')
    G.finalize(ring_o, atlas_dir)

    # inner ring lies flat (XY) and pivots on hubs along X that sit in the outer ring
    inner = [G.torus('RingI', 0.20, 0.02, 'hull_mid', maj=24, mnr=6),
             G.torus('RingIGlow', 0.176, 0.009, 'gyro_glow', maj=20, mnr=3)]
    for i, x in enumerate((0.235, -0.235)):
        inner.append(G.cyl(f'RingIHub{i}', 0.028, 0.08, t['accent_dark'], loc=(x, 0, 0),
                           axis='X', verts=10))
    ring_i = G.join(inner, 'Gyro_Ring_Inner')
    G.finalize(ring_i, atlas_dir)

    ring_o.location = (0, 0, RING_Z)
    ring_o.parent = root
    ring_i.parent = ring_o
    ring_i.location = (0, 0, 0)
    return root
