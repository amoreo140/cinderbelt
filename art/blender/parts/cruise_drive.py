"""Cruise drive 2x1 (game id "cruiseDrive", spec 3.3 / 2.1.2, M5b) - 150 u/s out of
combat after a 3 s spool-up, burns fuel cells (He3 + ice) by distance.

A long drive nacelle lying along X on the deck: intake cowl at the bow end,
three segmented spool coils (gold He3 plasma glow), fuel-cell cartridges on
both flanks, and a big bell nozzle at the stern (-X).  At rotation 0 it
pushes the ship toward +X like an engine.  Reads top-down as: a long
cylinder with gold rings + a round nozzle.

Footprint x in [-1, 1], y in [-0.5, 0.5] (2 cells along X, see parts/common.py).

Nodes (pivots = node origins):
  CruiseDrive_<Tier>   root, static
    Cruise_Spool       the three coil rings; pivot (0, NAC_Z, 0) on the nacelle axis
                       (glTF (0, 0.44, 0)); spin around local +X (glTF +X) while spooling up /
                       cruising (fast), glow emission can be ramped with the spool-up.
    Cruise_Exhaust     EMPTY at the nozzle exit, local +X = exhaust direction (-X of the part)
Level 2: fins on the cowl, tier glow strake on the spine; level 3: crystal focusing prisms
around the nozzle rim + gem bar on the spine.
"""
import math

from mathutils import Matrix

from lib import geo as G
from lib import palette as P
from parts import common as C

PART = 'cruise_drive'
CELLS = (2, 1)

NAC_Z = 0.44          # nacelle axis height
NAC_R = 0.2
NAC_X0, NAC_X1 = -0.58, 0.62
COILS = (-0.33, -0.03, 0.27)


def build(tier, atlas_dir):
    t = P.TIERS[tier]
    lvl = C.level(t)
    top = C.DECK_TOP
    px, py = C.plate_half(*CELLS)
    pcs = C.hull_base(t, *CELLS)

    # ---- saddles + nacelle -------------------------------------------------------
    for k, x in enumerate((-0.48, 0.12, 0.52)):
        pcs.append(G.box(f'Saddle{k}', x - 0.06, x + 0.06, -0.21, 0.21, top - 0.01, NAC_Z - 0.06, t['core'],
                         bevel=0.01, seg=1))
    pcs.append(G.cyl('Nacelle', NAC_R, NAC_X1 - NAC_X0, t['plate'], loc=((NAC_X0 + NAC_X1) / 2, 0, NAC_Z), axis='X',
                     verts=20, bevel=0.01, seg=1))
    pcs.append(G.ring_band('NacBelt', NAC_R + 0.012, NAC_R - 0.02, 0.4, 0.46, t['accent'], loc=(0, 0, NAC_Z), axis='X',
                           verts=20))
    # spine strip on top of the nacelle
    pcs.append(G.box('Spine', -0.5, 0.55, -0.045, 0.045, NAC_Z + NAC_R - 0.02, NAC_Z + NAC_R + 0.02, t['core'],
                     bevel=0.008, seg=1))
    # ---- bow intake cowl -------------------------------------------------------------
    pcs.append(G.lathe('Cowl', [(NAC_X1 - 0.02, NAC_R + 0.01), (0.86, 0.17), (0.9, 0.15), (0.88, 0.11), (0.8, 0.0)],
                       [0, 1, 2, 3], [t['plate'], t['accent'], 'trim_black', 'nozzle_in'], loc=(0, 0, NAC_Z),
                       axis='X', verts=20, closed=False))
    pcs.append(G.cyl('IntakeGlow', 0.08, 0.02, 'cruise_glow', loc=(0.84, 0, NAC_Z), axis='X', verts=12))
    # ---- fuel-cell cartridges on both flanks -----------------------------------------
    for s in (1, -1):
        y = 0.33 * s
        for k, x in enumerate((0.18, 0.5)):
            pcs.append(G.cyl(f'Cell{s}{k}', 0.075, 0.24, 'fuel_yellow', loc=(x, y, top + 0.085), axis='X', verts=10,
                             bevel=0.01, seg=1))
            pcs.append(G.cyl(f'CellCap{s}{k}', 0.06, 0.03, 'cruise_glow', loc=(x + 0.13, y, top + 0.085), axis='X',
                             verts=10))
        pcs.append(G.box(f'CellRack{s}', 0.02, 0.68, y - 0.09, y + 0.09, top - 0.01, top + 0.02, t['core']))
        pcs.append(G.cyl(f'Feed{s}', 0.022, 0.3, 'metal_bare', loc=(-0.1, y * 0.62, top + 0.09), axis='X', verts=6))
        # flank rails (tier accent) along the nacelle
        pcs.append(G.box(f'Rail{s}', -0.95, -0.15, 0.36 * s - 0.035, 0.36 * s + 0.035, top - 0.01, top + 0.05,
                         t['accent'], bevel=0.01, seg=1))
    # ---- stern nozzle -----------------------------------------------------------------
    bx = NAC_X0
    prof = [(0.0, NAC_R - 0.02), (-0.3, 0.215), (-0.33, 0.23), (-0.31, 0.25), (0.0, NAC_R + 0.01)]
    pcs.append(G.lathe('Bell', prof, [1, 2, 2, 0, 0], ['metal_bare', 'nozzle_in', t['accent_dark']],
                       loc=(bx, 0, NAC_Z), axis='X', verts=24))
    pcs.append(G.ring_band('BellGlow', 0.245, 0.21, -0.025, 0.025, 'cruise_glow', loc=(bx - 0.2, 0, NAC_Z), axis='X',
                           verts=24))
    pcs.append(G.cyl('Throat', NAC_R - 0.03, 0.02, 'cruise_core', loc=(bx - 0.01, 0, NAC_Z), axis='X', verts=20))
    pcs.append(G.cyl('ThroatCone', 0.0, 0.14, 'cruise_glow', loc=(bx - 0.08, 0, NAC_Z), axis='X', verts=16,
                     r2=NAC_R - 0.05, caps=False))
    pcs.append(G.box('BellMount', bx - 0.12, bx + 0.02, -0.12, 0.12, top - 0.01, NAC_Z - 0.18, t['core'],
                     bevel=0.01, seg=1))
    # status strip on the deck stern corner
    pcs.append(G.box('Status', -0.92, -0.86, -0.08, 0.08, top - 0.004, top + 0.02, 'cruise_glow', bevel=0.004, seg=1))
    if lvl >= 2:   # cowl fins + glowing strakes
        for s in (1, -1):
            fin = G.prism(f'Fin{s}', [(0.45, 0.0), (0.8, 0.0), (0.72, 0.12), (0.5, 0.12)], -0.012, 0.012, t['accent'],
                          bevel=0.004, seg=1)
            G.transform(fin, loc=(0, 0.0, NAC_Z), rot=(90 + 50 * s, 0, 0))
            pcs.append(fin)
        pcs.append(G.box('Strake', -0.5, 0.5, -0.02, 0.02, NAC_Z + NAC_R + 0.015, NAC_Z + NAC_R + 0.03, t['glow']))
        pcs += C.corner_brackets(t, top, hx=px, hy=py, arm=0.16, corners=(0, 3))
    if lvl >= 3:   # crystal focusing prisms around the nozzle rim + gem bar on the spine
        for i, a in enumerate((30, 90, 150, 210, 270, 330)):
            r = math.radians(a)
            d = (0.0, math.cos(r), math.sin(r))
            g = C.gem(f'Focus{i}', 0.09, 0.022, sides=4)
            C.place(g, (bx - 0.28, 0.24 * d[1], NAC_Z + 0.24 * d[2]), (-0.4, d[1], d[2]))
            pcs.append(g)
        pcs.append(C.gem_bar('SpineGem', (-0.35, 0, NAC_Z + NAC_R + 0.025), (0.4, 0, NAC_Z + NAC_R + 0.025), 0.05, 0.045))
    pcs += C.bolts('Bolt', [(x, y) for x in (-px + 0.06, px - 0.06) for y in (-py + 0.06, py - 0.06)], top + 0.005,
                   r=0.022)
    root = G.join(pcs, f'CruiseDrive_{tier.capitalize()}')
    G.finalize(root, atlas_dir)

    # ---- spool coils (segmented so the spin reads) --------------------------------------
    sp = []
    for k, x in enumerate(COILS):
        # dark collar, a protruding gold plasma band (the role colour) and 4 accent clamps on the rear edge
        sp.append(G.ring_band(f'Coil{k}', NAC_R + 0.03, NAC_R + 0.004, x - 0.065, x + 0.065, t['core'], axis='X',
                              verts=20))
        sp.append(G.ring_band(f'CoilGlow{k}', NAC_R + 0.055, NAC_R + 0.02, x - 0.032, x + 0.032, 'cruise_glow',
                              axis='X', verts=20))
        for j in range(4):
            b = G.box(f'Seg{k}{j}', x - 0.07, x - 0.04, -0.03, 0.03, NAC_R + 0.02, NAC_R + 0.065, t['accent'],
                      bevel=0.005, seg=1)
            G.transform(b, rot=(45 + 90 * j, 0, 0))
            sp.append(b)
    spool = G.join(sp, 'Cruise_Spool')
    G.finalize(spool, atlas_dir)
    # built around the X axis at z = 0 -> the node origin is the pivot
    spool.location = (0, 0, NAC_Z)
    spool.parent = root
    ex = G.empty('Cruise_Exhaust', loc=(bx - 0.33, 0, NAC_Z), size=0.1)
    ex.rotation_euler = (0, 0, math.radians(180))
    ex.parent = root
    return root
