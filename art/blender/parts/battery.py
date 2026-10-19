"""Battery 1x1 (game id "battery") - three energy storage cells shaped like
battery icons (terminal nub toward +X), each with a segmented teal/cyan
charge indicator on top, tied together by a bus bar at the rear.
No animated nodes (the game may tint the indicator via emissive if wanted).

Level 2: five charge segments instead of four, glowing side strips, cooling
fins between the cells, corner brackets, tier glow line.
"""
from lib import geo as G
from lib import palette as P
from parts import common as C

PART = 'battery'

CELL_Y = (-0.235, 0.0, 0.235)
CELL_W = 0.095          # half width of a cell
CX0, CX1 = -0.31, 0.25  # cell body along X
CELL_TOP = 0.42


def build(tier, atlas_dir):
    t = P.TIERS[tier]
    lvl = C.level(t)
    top = C.DECK_TOP
    pcs = C.hull_base(t)
    # tray the cells stand in
    pcs.append(G.prism('Tray', G.chamfer_rect(-0.40, 0.40, -0.40, 0.40, 0.05), top - 0.01, top + 0.05,
                       'hull_mid', bevel=0.01, seg=1))
    nseg = 4 if lvl < 2 else 5
    lit = nseg - 1
    for k, y in enumerate(CELL_Y):
        # cell casing: light shell with a dark band at the bottom
        pcs.append(G.prism(f'Cell{k}', G.chamfer_rect(CX0, CX1, y - CELL_W, y + CELL_W, 0.025), top + 0.04,
                           CELL_TOP, t['plate'], bevel=0.016, seg=2))
        pcs.append(G.box(f'CellBand{k}', CX0 - 0.006, CX1 + 0.006, y - CELL_W - 0.006, y + CELL_W + 0.006,
                         top + 0.05, top + 0.11, t['core'], bevel=0.006, seg=1))
        pcs.append(G.box(f'CellStripe{k}', CX0 - 0.004, CX1 + 0.004, y - CELL_W - 0.004, y + CELL_W + 0.004,
                         top + 0.135, top + 0.155, t['accent'], bevel=0.003, seg=1))
        # terminal nub (+X) - the battery-icon silhouette
        pcs.append(G.box(f'Nub{k}', CX1 - 0.01, CX1 + 0.075, y - 0.045, y + 0.045, top + 0.12, CELL_TOP - 0.06,
                         'metal_bare', bevel=0.01, seg=1))
        pcs.append(G.box(f'NubCap{k}', CX1 + 0.06, CX1 + 0.09, y - 0.05, y + 0.05, top + 0.13, CELL_TOP - 0.07,
                         t['core'], bevel=0.006, seg=1))
        # charge indicator window: dark frame, lit segments rear -> front
        wx0, wx1 = CX0 + 0.05, CX1 - 0.05
        pcs.append(G.box(f'Window{k}', wx0, wx1, y - 0.055, y + 0.055, CELL_TOP - 0.01, CELL_TOP + 0.012,
                         'trim_black', bevel=0.005, seg=1))
        step = (wx1 - wx0 - 0.02) / nseg
        for j in range(nseg):
            x0 = wx0 + 0.01 + j * step + 0.008
            x1 = x0 + step - 0.016
            pcs.append(G.box(f'Seg{k}{j}', x0, x1, y - 0.038, y + 0.038, CELL_TOP + 0.004, CELL_TOP + 0.018,
                             'battery_glow' if j < lit else 'battery_dim'))
        if lvl >= 2:
            for s in (1, -1):
                pcs.append(G.box(f'SideGlow{k}{s}', CX0 + 0.06, CX1 - 0.06, y + s * CELL_W - 0.004,
                                 y + s * CELL_W + 0.004, top + 0.2, top + 0.214, 'battery_glow'))
    # rear bus bar + cable clamps
    pcs.append(G.box('BusBar', -0.385, -0.33, -0.36, 0.36, top + 0.05, top + 0.20, t['core'], bevel=0.012, seg=1))
    pcs.append(G.box('BusTop', -0.38, -0.335, -0.33, 0.33, top + 0.195, top + 0.215, t['accent'], bevel=0.004,
                     seg=1))
    for k, y in enumerate(CELL_Y):
        pcs.append(G.box(f'Clamp{k}', -0.345, -0.30, y - 0.04, y + 0.04, top + 0.12, top + 0.19, 'metal_bare',
                         bevel=0.006, seg=1))
    # front terminal rail the nubs plug into
    pcs.append(G.box('FrontRail', 0.335, 0.375, -0.34, 0.34, top + 0.04, top + 0.15, 'hull_dark', bevel=0.01, seg=1))
    if lvl >= 2:  # cooling fins between the cells
        for k, y in enumerate((-0.1175, 0.1175)):
            for j, x in enumerate((-0.2, -0.06, 0.08)):
                pcs.append(G.box(f'CoolFin{k}{j}', x - 0.03, x + 0.03, y - 0.008, y + 0.008, top + 0.05,
                                 CELL_TOP - 0.05, t['accent'], bevel=0.003, seg=1))
    if lvl >= 3:  # T3: crystal bus bar on the rear rail
        pcs.append(C.gem_bar('BusGem', (-0.358, -0.30, top + 0.215), (-0.358, 0.30, top + 0.215), 0.04, 0.04))
    pcs += C.bolts('Bolt', [(x, y) for x in (-0.43, 0.43) for y in (-0.43, 0.43)], top + 0.005, r=0.02)
    pcs += C.corner_brackets(t, top)
    root = G.join(pcs, f'Battery_{tier.capitalize()}')
    G.finalize(root, atlas_dir)
    return root
