"""Engine 1x1 - housing at the front (+X), bell nozzle pointing -X.
At rotation 0 it pushes the ship toward +X.
Level 2: twin glow rings, glowing grille, stabiliser fins on the housing."""
from lib import geo as G
from lib import palette as P
from parts import common as C

PART = 'engine'

AXIS_Z = -0.02  # nozzle axis height


def build(tier, atlas_dir):
    t = P.TIERS[tier]
    lvl = C.level(t)
    top = C.DECK_TOP
    pcs = C.core_block(x0=-0.12, tier=t)
    pcs.append(C.deck_plate('Plate', x0=-0.115, mat=t['plate']))
    # intake grille on top (level 2: glowing backing behind the slats)
    pcs.append(G.box('Grille', 0.02, 0.33, -0.24, 0.24, top - 0.01, top + 0.015,
                     'trim_black' if lvl < 2 else t['glow'], bevel=0.01, seg=1))
    for i, y in enumerate((-0.16, -0.08, 0.0, 0.08, 0.16)):
        pcs.append(G.box(f'Slat{i}', 0.04, 0.31, y - 0.022, y + 0.022, top,
                         top + 0.035, 'hull_mid', bevel=0.008, seg=1))
    # tier-coloured collar where the nozzle meets the housing
    pcs.append(G.box('Collar', -0.17, -0.07, -0.40, 0.40, -0.17, top + 0.02,
                     t['accent'], bevel=0.02, seg=2))
    # glowing status strip on the collar top
    pcs.append(G.box('StatusGlow', -0.15, -0.09, -0.30, 0.30, top + 0.015,
                     top + 0.03, 'engine_glow', bevel=0.005, seg=1))
    if lvl >= 2:
        # stabiliser fins on both housing edges
        for s in (1, -1):
            fin = [(0.40, 0.0), (0.40, 0.035), (-0.02, 0.15), (-0.06, 0.15), (-0.06, 0.0)]
            f = G.prism('Fin', fin, -0.014, 0.014, t['accent'], bevel=0.006, seg=1)
            G.transform(f, loc=(0, 0.40 * s, top), rot=(90, 0, 0))
            pcs.append(f)
        pcs += C.corner_brackets(t, top, corners=(0, 3))
    # nozzle mount + bell
    pcs.append(G.cyl('Mount', 0.27, 0.10, 'metal_bare', loc=(-0.20, 0, AXIS_Z), axis='X',
                     verts=24, bevel=0.012, seg=1))
    # bell profile: a = offset along +X from the bell base (x = -0.25), r = radius
    prof = [(0.0, 0.19),      # throat (inner)
            (-0.20, 0.30),    # inner wall to exit
            (-0.215, 0.318),  # lip inner
            (-0.205, 0.336),  # lip outer
            (0.0, 0.265)]     # outer wall back to the mount; closes to throat
    segs = [1, 2, 2, 0, 0]
    pcs.append(G.lathe('Bell', prof, segs, ['metal_bare', 'nozzle_in', t['accent_dark']],
                       loc=(-0.25, 0, AXIS_Z), axis='X', verts=24))
    # glowing ring(s) around the bell
    rings = ((-0.34, 0.316, 0.28),) if lvl < 2 else ((-0.305, 0.304, 0.27), (-0.39, 0.326, 0.29))
    for i, (x, ro, ri) in enumerate(rings):
        pcs.append(G.ring_band(f'GlowRing{i}', ro, ri, -0.013, 0.013, 'engine_glow',
                               loc=(x, 0, AXIS_Z), axis='X', verts=24))
    if lvl >= 3:  # T3: crown of focusing crystals on the upper half of the bell rim
        import math
        for i, a in enumerate((25, 60, 90, 120, 155)):
            r = math.radians(a)
            d = (0.0, math.cos(r), math.sin(r))
            g = C.gem(f'Crown{i}', 0.11 if a == 90 else 0.085, 0.024, sides=4)
            C.place(g, (-0.33, 0.30 * d[1], AXIS_Z + 0.30 * d[2]), (-0.35, d[1], d[2]))
            pcs.append(g)
        pcs.append(C.gem_bar('StatusGem', (-0.12, -0.27, top + 0.03), (-0.12, 0.27, top + 0.03), 0.045, 0.04))
    # hot core in the throat
    pcs.append(G.cyl('Core', 0.19, 0.02, 'engine_core', loc=(-0.255, 0, AXIS_Z), axis='X',
                     verts=24))
    pcs.append(G.cyl('CoreCone', 0.0, 0.10, 'engine_glow', loc=(-0.31, 0, AXIS_Z), axis='X',
                     verts=16, r2=0.13, caps=False))
    root = G.join(pcs, f'Engine_{tier.capitalize()}')
    G.finalize(root, atlas_dir)
    return root
