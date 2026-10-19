"""Shield generator 1x1 (game id "shield") - three emitter pylons around a
glowing core; the core with its fin ring spins.

Node layout (pivots = node origins):
  ShieldGenerator_<Tier>  root, static base (cell centre, z = 0)
    Shield_Emitter        spinning core + fin ring; pivot (0, 0, EMITTER_Z);
                          spin around local Z (Blender) = glTF local +Y.

Level 2: second (glowing) emitter ring, glowing pylon spines, corner brackets.
"""
import math
from lib import geo as G
from lib import palette as P
from parts import common as C

PART = 'shield_generator'

EMITTER_Z = C.DECK_TOP + 0.24


def build(tier, atlas_dir):
    t = P.TIERS[tier]
    lvl = C.level(t)
    top = C.DECK_TOP
    pcs = C.core_block(tier=t)
    pcs.append(C.deck_plate('Plate', mat=t['plate']))
    # octagonal plinth with a glow ring
    plinth = [(0.34 * math.cos(math.radians(22.5 + 45 * i)), 0.34 * math.sin(math.radians(22.5 + 45 * i)))
              for i in range(8)]
    pcs.append(G.prism('Plinth', plinth, top - 0.01, top + 0.06, 'hull_mid', bevel=0.012, seg=1))
    pcs.append(G.ring_band('PlinthGlow', 0.27, 0.22, top + 0.055, top + 0.07, 'shield_glow', verts=24))
    pcs.append(G.cyl('Socket', 0.10, 0.06, t['core'], loc=(0, 0, top + 0.08), verts=16, bevel=0.01, seg=1))
    # three emitter pylons leaning over the core
    for i in range(3):
        a = 90 + i * 120
        ar = math.radians(a)
        x, y = 0.30 * math.cos(ar), 0.30 * math.sin(ar)
        p = G.box(f'Pylon{i}', -0.035, 0.035, -0.045, 0.045, 0.0, 0.40, t['plate'], bevel=0.012, seg=1)
        G.transform(p, loc=(x, y, top + 0.04), rot=(0, -14, a))
        pcs.append(p)
        if lvl >= 2:
            sp = G.box(f'Spine{i}', -0.038, -0.03, -0.018, 0.018, 0.05, 0.36, t['glow'])
            G.transform(sp, loc=(x, y, top + 0.04), rot=(0, -14, a))
            pcs.append(sp)
        tloc = (0.30 * math.cos(ar) - 0.40 * math.sin(math.radians(14)) * math.cos(ar),
                0.30 * math.sin(ar) - 0.40 * math.sin(math.radians(14)) * math.sin(ar),
                top + 0.04 + 0.40 * math.cos(math.radians(14)))
        if lvl < 3:
            tip = G.ellipsoid(f'Tip{i}', 0.04, 0.04, 0.04, 'shield_glow', seg=10, rings=6)
            tip.location = tloc
        else:  # T3: crystal emitter tips continuing the pylon lean
            tip = C.gem(f'TipGem{i}', 0.13, 0.034, sides=6)
            C.place(tip, (tloc[0], tloc[1], tloc[2] - 0.04),
                    (-math.sin(math.radians(14)) * math.cos(ar), -math.sin(math.radians(14)) * math.sin(ar),
                     math.cos(math.radians(14))))
        pcs.append(tip)
        pcs.append(G.box(f'Foot{i}', -0.07, 0.07, -0.07, 0.07, top - 0.01, top + 0.07, t['accent'],
                         bevel=0.01, seg=1))
        G.transform(pcs[-1], loc=(x, y, 0), rot=(0, 0, a))
    pcs += C.bolts('Bolt', [(x, y) for x in (-0.40, 0.40) for y in (-0.40, 0.40)], top + 0.005, r=0.022)
    pcs += C.corner_brackets(t, top)
    root = G.join(pcs, f'ShieldGenerator_{tier.capitalize()}')
    G.finalize(root, atlas_dir)

    # ---- spinning emitter (around its pivot) ------------------------------
    ep = [G.ellipsoid('Core', 0.13, 0.13, 0.15, 'shield_glass', seg=16, rings=10),
          G.torus('FinRing', 0.20, 0.016, t['plate'], maj=24, mnr=6)]
    for i in range(3):
        f = G.box(f'Fin{i}', 0.15, 0.25, -0.02, 0.02, -0.03, 0.03, t['accent'], bevel=0.006, seg=1)
        G.transform(f, rot=(0, 0, 60 + i * 120))
        ep.append(f)
    if lvl >= 2:
        ep.append(G.torus('GlowRing', 0.165, 0.009, t['glow'], loc=(0, 0, 0.06), maj=24, mnr=4))
        ep.append(G.torus('GlowRing2', 0.165, 0.009, t['glow'], loc=(0, 0, -0.06), maj=24, mnr=4))
    if lvl >= 3:  # T3: crystal fin tips on the spinning ring
        for i in range(3):
            a = math.radians(60 + i * 120)
            g = C.gem(f'FinGem{i}', 0.09, 0.024, sides=4)
            C.place(g, (0.24 * math.cos(a), 0.24 * math.sin(a), 0), (math.cos(a), math.sin(a), 0.15))
            ep.append(g)
    emitter = G.join(ep, 'Shield_Emitter')
    G.finalize(emitter, atlas_dir)
    emitter.location = (0, 0, EMITTER_Z)
    emitter.parent = root
    return root
