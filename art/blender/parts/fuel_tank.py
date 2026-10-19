"""Fuel tank 1x1 - twin yellow capsule tanks on saddles."""
import math
from lib import geo as G
from lib import palette as P
from parts import common as C

PART = 'fuel_tank'

TANK_R = 0.155
TANK_Z = C.DECK_TOP + 0.04 + TANK_R


def _capsule(name, y, t):
    """Capsule along X: cylinder |x| <= 0.2 with hemispherical caps."""
    L, R = 0.21, TANK_R
    prof = []
    n = 5
    for i in range(n + 1):                       # rear cap: pole -> equator
        a = math.pi / 2 * i / n
        prof.append((-L - R * math.cos(a), R * math.sin(a)))
    prof.append((L, R))                          # body
    for i in range(1, n + 1):                    # front cap: equator -> pole
        a = math.pi / 2 * i / n
        prof.append((L + R * math.sin(a), R * math.cos(a)))
    segs = [1] * n + [0] + [1] * n
    return G.lathe(name, prof, segs, ['fuel_yellow', t['plate']], loc=(0, y, TANK_Z), axis='X',
                   verts=20, closed=False)


def build(tier, atlas_dir):
    t = P.TIERS[tier]
    top = C.DECK_TOP
    lvl = C.level(t)
    pcs = C.core_block(tier=t)
    pcs.append(C.deck_plate('Plate', mat=t['plate']))
    for k, y in enumerate((0.205, -0.205)):
        pcs.append(_capsule(f'Tank{k}', y, t))
        for j, x in enumerate((-0.13, 0.13)):
            pcs.append(G.ring_band(f'Strap{k}{j}', TANK_R + 0.012, TANK_R - 0.01, -0.02, 0.02,
                                   'trim_black' if lvl < 2 else t['accent'],
                                   loc=(x, y, TANK_Z), axis='X', verts=20))
        if lvl >= 2:  # glowing fuel-level window along the top of each tank
            pcs.append(G.box(f'Level{k}', -0.09, 0.09, y - 0.022, y + 0.022, TANK_Z + TANK_R - 0.02,
                             TANK_Z + TANK_R + 0.008, 'fuel_glow', bevel=0.006, seg=1))
        if lvl >= 3:  # T3: cut-crystal ridge riding on each tank
            pcs.append(C.gem_bar(f'TankGem{k}', (-0.26, y, TANK_Z + TANK_R - 0.012),
                                 (-0.11, y, TANK_Z + TANK_R - 0.012), 0.045, 0.04))
    # saddles under the tanks
    for j, x in enumerate((-0.13, 0.13)):
        pcs.append(G.box(f'Saddle{j}', x - 0.04, x + 0.04, -0.40, 0.40, top - 0.01, TANK_Z - 0.06,
                         'hull_dark', bevel=0.01, seg=1))
    # cross-feed pipe + valve with a fuel-level glow window between the tanks
    pcs.append(G.cyl('Pipe', 0.026, 0.32, 'metal_bare', loc=(-0.30, 0, TANK_Z - 0.02), axis='Y', verts=10))
    pcs.append(G.box('Valve', -0.06, 0.06, -0.06, 0.06, top - 0.01, TANK_Z + 0.03, 'hull_mid', bevel=0.012, seg=1))
    pcs.append(G.box('Gauge', -0.04, 0.04, -0.035, 0.035, TANK_Z + 0.02, TANK_Z + 0.045, 'fuel_glow',
                     bevel=0.006, seg=1))
    pcs.append(G.cyl('Cap', 0.03, 0.04, t['accent'], loc=(-0.30, 0, TANK_Z + 0.02), verts=10))
    pcs += C.corner_brackets(t, top)
    root = G.join(pcs, f'FuelTank_{tier.capitalize()}')
    G.finalize(root, atlas_dir)
    return root
