"""Reactor 1x1 - glowing teal core column inside an open 4-pillar cage.
Level 2: glowing containment coils, finned top cap, twin radiator slits."""
import math
from lib import geo as G
from lib import palette as P
from parts import common as C

PART = 'reactor'


def build(tier, atlas_dir):
    t = P.TIERS[tier]
    lvl = C.level(t)
    top = C.DECK_TOP
    pcs = C.core_block(tier=t)
    pcs.append(C.deck_plate('Plate', mat=t['plate']))
    # base collar
    pcs.append(G.ring_band('BaseRing', 0.33, 0.13, top - 0.01, top + 0.06, 'hull_mid', verts=24,
                           top_mat=t['plate']))
    pcs.append(G.ring_band('BaseGlow', 0.27, 0.2, top + 0.06, top + 0.07, 'reactor_glow', verts=24))
    # core column (wide, so it reads between the pillars)
    cz0, cz1 = top + 0.04, 0.53
    pcs.append(G.cyl('Core', 0.135, cz1 - cz0, 'reactor_glow', loc=(0, 0, (cz0 + cz1) / 2), verts=20))
    # thin containment bands (level 2: glowing coils)
    bands = (0.33, 0.43) if lvl < 2 else (0.31, 0.37, 0.43, 0.49)
    for i, z in enumerate(bands):
        mat = (t['accent'] if i == 0 else 'hull_dark') if lvl < 2 else (t['accent'] if i % 2 == 0 else t['glow'])
        pcs.append(G.ring_band(f'Band{i}', 0.152, 0.13, z - 0.009, z + 0.009, mat, verts=20))
    # open pillar cage: 4 slim pillars on the diagonals
    for i in range(4):
        a = math.pi / 4 + i * math.pi / 2
        b = G.box(f'Pillar{i}', -0.022, 0.022, -0.018, 0.018, top + 0.05, 0.55, t['plate'], bevel=0.008, seg=1)
        G.transform(b, loc=(0.215 * math.cos(a), 0.215 * math.sin(a), 0), rot=(0, 0, math.degrees(a)))
        pcs.append(b)
    # top cap with glowing vent
    pcs.append(G.ring_band('TopCap', 0.25, 0.085, 0.53, 0.575, 'hull_mid', verts=24, top_mat=t['plate']))
    pcs.append(G.cyl('TopGlow', 0.09, 0.03, 'reactor_glow', loc=(0, 0, 0.55), verts=16))
    pcs.append(G.cyl('TopCore', 0.045, 0.05, 'hull_dark', loc=(0, 0, 0.58), verts=12, bevel=0.01, seg=1))
    if lvl >= 2:  # four heat-sink fins on the cap
        for i in range(4):
            a = i * 90
            f = G.box(f'CapFin{i}', 0.10, 0.24, -0.012, 0.012, 0.57, 0.60, t['accent'], bevel=0.005, seg=1)
            G.transform(f, rot=(0, 0, a))
            pcs.append(f)
    if lvl >= 3:  # T3: four containment crystals leaning out of the cap
        for i in range(4):
            a = math.radians(45 + i * 90)
            g = C.gem(f'CapGem{i}', 0.16, 0.032, sides=6)
            C.place(g, (0.15 * math.cos(a), 0.15 * math.sin(a), 0.565),
                    (0.55 * math.cos(a), 0.55 * math.sin(a), 1.0))
            pcs.append(g)
    # corner radiator blocks with glow slits
    h = 0.39
    for i, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        x, y = sx * h, sy * h
        pcs.append(G.box(f'Radiator{i}', x - 0.06, x + 0.06, y - 0.06, y + 0.06, top - 0.01, top + 0.06,
                         t['core'], bevel=0.01, seg=1))
        slits = (0.0,) if lvl < 2 else (-0.025, 0.025)
        for j, o in enumerate(slits):
            pcs.append(G.box(f'RadGlow{i}{j}', x - 0.04, x + 0.04, y + o - 0.011, y + o + 0.011,
                             top + 0.055, top + 0.068, 'reactor_glow'))
        if lvl >= 3:
            g = C.gem(f'RadGem{i}', 0.07, 0.026, sides=4, base=0.0)
            C.place(g, (x, y, top + 0.06), (0, 0, 1), roll=45)
            pcs.append(g)
    root = G.join(pcs, f'Reactor_{tier.capitalize()}')
    G.finalize(root, atlas_dir)
    return root
