"""Onboard refinery 2x1 (game id "refinery", spec 3.3, M4) - ice -> fuel and
ore -> ingots during flight.

Rear cell (x < 0): square ore hopper with a spinning crusher disc inside,
a chute into a squat crucible with a glowing molten pool, and an ingot tray
with three hot ingots.  Front cell (x > 0): a tall distillation column
(ice-blue coils at the bottom -> fuel-yellow coils at the top) feeding a
yellow fuel capsule, plus an ice intake.  Reads top-down as: square hopper,
orange pool, round column.

Footprint x in [-1, 1], y in [-0.5, 0.5] (2 cells along X, centred on the
footprint centre, see parts/common.py multi-cell convention).

Node layout (pivots = node origins):
  Refinery_<Tier>         root, static (footprint centre, z = 0)
    Refinery_Crusher      crusher disc in the hopper; pivot (HOP_X, 0, CRUSH_Z);
                          spin around local Z (Blender) = glTF local +Y while
                          refining.
Level 2: glowing column coils + tier glow line, cooling fins on the column,
corner brackets.  Level 3: crystal catalyst prisms on the column cap.
"""
import math
from lib import geo as G
from lib import palette as P
from parts import common as C

PART = 'refinery'
CELLS = (2, 1)

HOP_X = -0.62          # hopper centre
CRUSH_Z = 0.36         # crusher disc height (inside the hopper)
COL_X, COL_Y = 0.42, 0.13
COL_TOP = 0.86


def build(tier, atlas_dir):
    t = P.TIERS[tier]
    lvl = C.level(t)
    top = C.DECK_TOP
    px, py = C.plate_half(*CELLS)
    pcs = C.hull_base(t, *CELLS)

    # ---- rear cell: hopper -------------------------------------------------
    hz0, hz1 = top - 0.01, 0.58
    s2 = math.sqrt(2)
    prof = [(hz0, 0.20 * s2), (hz1 - 0.05, 0.31 * s2), (hz1, 0.31 * s2), (hz1, 0.26 * s2),
            (CRUSH_Z - 0.02, 0.13 * s2), (CRUSH_Z - 0.02, 0.0)]
    hop = G.lathe('Hopper', prof, [0, 1, 2, 3, 3], [t['plate'], t['accent'], 'hull_mid', 'trim_black'],
                  axis='Z', verts=4, closed=False, smooth=False)
    G.transform(hop, loc=(HOP_X, 0, 0), rot=(0, 0, 45))
    pcs.append(hop)
    # hazard ticks on the rim + corner posts
    for i, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        pcs.append(G.box(f'HopPost{i}', HOP_X + sx * 0.29 - 0.035, HOP_X + sx * 0.29 + 0.035, sy * 0.29 - 0.035,
                         sy * 0.29 + 0.035, top, hz1 + 0.03, t['core'], bevel=0.01, seg=1))
    for k in range(4):
        b = G.box(f'HopHaz{k}', -0.012, 0.012, -0.045, 0.045, hz1 - 0.004, hz1 + 0.006, 'trim_black')
        G.transform(b, loc=(HOP_X - 0.12 + k * 0.08, 0.285, 0), rot=(0, 0, 35))
        pcs.append(b)
    # chute from the hopper into the crucible
    pcs.append(G.box('Chute', HOP_X + 0.24, -0.30, -0.075, 0.075, top - 0.01, top + 0.16, t['core'], bevel=0.015, seg=1))
    pcs.append(G.box('ChuteTop', HOP_X + 0.26, -0.32, -0.055, 0.055, top + 0.15, top + 0.175, 'metal_bare',
                     bevel=0.006, seg=1))
    # crucible with a molten pool
    cx = -0.17
    pcs.append(G.lathe('Crucible', [(top - 0.01, 0.0), (top - 0.01, 0.17), (top + 0.05, 0.215), (0.43, 0.215),
                                    (0.455, 0.19), (0.43, 0.165), (0.40, 0.0)],
                       [0, 1, 1, 2, 2, 3], ['hull_dark', t['plate'], t['accent'], 'ember'],
                       loc=(cx, 0, 0), axis='Z', verts=20, closed=False))
    pcs.append(G.ring_band('CrucibleBand', 0.222, 0.2, 0.30, 0.335, t['core'], loc=(cx, 0, 0), verts=20))
    if lvl >= 2:
        pcs.append(G.ring_band('CrucibleGlow', 0.224, 0.2, 0.355, 0.367, t['glow'], loc=(cx, 0, 0), verts=20))
    # ingot tray (starboard of the crucible) with three hot ingots
    pcs.append(G.box('Tray', cx - 0.20, cx + 0.12, -0.44, -0.27, top - 0.01, top + 0.06, 'hull_mid', bevel=0.012, seg=1))
    pcs.append(G.box('TrayWell', cx - 0.18, cx + 0.10, -0.42, -0.29, top + 0.04, top + 0.065, 'trim_black'))
    for k in range(3):
        x = cx - 0.13 + k * 0.09
        ing = [(x - 0.032, -0.405), (x + 0.032, -0.405), (x + 0.024, -0.305), (x - 0.024, -0.305)]
        pcs.append(G.prism(f'Ingot{k}', ing, top + 0.05, top + 0.09, 'cannon_glow', bevel=0.006, seg=1))
    # port side: ore bin with a rib
    pcs.append(G.box('OreBin', cx - 0.20, cx + 0.12, 0.26, 0.44, top - 0.01, top + 0.13, t['core'], bevel=0.014, seg=1))
    pcs.append(G.box('OreBinLid', cx - 0.18, cx + 0.10, 0.28, 0.42, top + 0.12, top + 0.15, t['plate'], bevel=0.01, seg=1))

    # ---- front cell: distillation column + fuel capsule ---------------------
    pcs.append(G.cyl('ColBase', 0.215, 0.07, 'hull_mid', loc=(COL_X, COL_Y, top + 0.025), verts=20, bevel=0.012, seg=1))
    pcs.append(G.cyl('Column', 0.16, COL_TOP - top - 0.02, t['plate'], loc=(COL_X, COL_Y, (top + COL_TOP) / 2),
                     verts=20))
    coils = ((0.36, 'vein_ice'), (0.46, 'vein_ice'), (0.60, 'fuel_glow'), (0.70, 'fuel_glow'))
    for i, (z, m) in enumerate(coils):
        glow = m if (lvl >= 2 or i in (0, 3)) else t['core']
        pcs.append(G.ring_band(f'Coil{i}', 0.178, 0.15, z - 0.018, z + 0.018, glow, loc=(COL_X, COL_Y, 0), verts=20))
    pcs.append(G.ring_band('ColBelt', 0.185, 0.15, 0.515, 0.545, t['accent'], loc=(COL_X, COL_Y, 0), verts=20))
    pcs.append(G.lathe('ColCap', [(COL_TOP - 0.02, 0.0), (COL_TOP - 0.02, 0.19), (COL_TOP + 0.03, 0.19),
                                  (COL_TOP + 0.07, 0.12), (COL_TOP + 0.07, 0.0)], [0, 1, 1, 2],
                       ['hull_dark', t['plate'], 'hull_mid'], loc=(COL_X, COL_Y, 0), axis='Z', verts=20, closed=False))
    pcs.append(G.cyl('Vent', 0.05, 0.08, 'metal_bare', loc=(COL_X, COL_Y, COL_TOP + 0.10), verts=10))
    pcs.append(G.cyl('VentGlow', 0.035, 0.012, 'fuel_glow', loc=(COL_X, COL_Y, COL_TOP + 0.145), verts=10))
    if lvl >= 2:  # cooling fins around the column
        for i in range(4):
            a = 45 + i * 90
            f = G.box(f'ColFin{i}', 0.16, 0.235, -0.012, 0.012, top + 0.07, 0.52, t['accent'], bevel=0.004, seg=1)
            G.transform(f, loc=(COL_X, COL_Y, 0), rot=(0, 0, a))
            pcs.append(f)
    if lvl >= 3:  # crystal catalyst prisms around the cap
        for i in range(3):
            a = math.radians(30 + i * 120)
            g = C.gem(f'CatGem{i}', 0.13, 0.03, sides=6)
            C.place(g, (COL_X + 0.12 * math.cos(a), COL_Y + 0.12 * math.sin(a), COL_TOP + 0.05),
                    (0.5 * math.cos(a), 0.5 * math.sin(a), 1.0))
            pcs.append(g)
    # fuel capsule along X on the starboard side
    L, R = 0.24, 0.105
    prof = []
    n = 4
    for i in range(n + 1):
        a = math.pi / 2 * i / n
        prof.append((-L - R * math.cos(a), R * math.sin(a)))
    prof.append((L, R))
    for i in range(1, n + 1):
        a = math.pi / 2 * i / n
        prof.append((L + R * math.sin(a), R * math.cos(a)))
    tz = top + 0.035 + R
    pcs.append(G.lathe('FuelTank', prof, [1] * n + [0] + [1] * n, ['fuel_yellow', t['plate']],
                       loc=(0.52, -0.29, tz), axis='X', verts=16, closed=False))
    for j, x in enumerate((0.40, 0.64)):
        pcs.append(G.ring_band(f'TankStrap{j}', R + 0.012, R - 0.01, -0.016, 0.016, t['accent'] if lvl >= 2 else 'trim_black',
                               loc=(x, -0.29, tz), axis='X', verts=16))
        pcs.append(G.box(f'TankSaddle{j}', x - 0.03, x + 0.03, -0.42, -0.16, top - 0.01, tz - 0.05, 'hull_dark',
                         bevel=0.008, seg=1))
    # pipes: column -> tank, crucible -> column (heat exchange)
    pcs.append(G.cyl('PipeA', 0.025, 0.30, 'metal_bare', loc=(COL_X, -0.06, top + 0.10), axis='Y', verts=8))
    pcs.append(G.cyl('PipeB', 0.025, 0.42, 'metal_bare', loc=(0.12, 0.13, top + 0.10), axis='X', verts=8))
    # ice intake on the bow corner
    pcs.append(G.box('IceIntake', 0.76, 0.92, 0.22, 0.42, top - 0.01, top + 0.12, t['core'], bevel=0.014, seg=1))
    pcs.append(G.box('IceGlow', 0.79, 0.89, 0.25, 0.39, top + 0.11, top + 0.125, 'vein_ice'))
    pcs.append(G.box('Status', 0.84, 0.90, -0.06, 0.06, top - 0.004, top + 0.02, 'light_amber', bevel=0.005, seg=1))
    pcs += C.bolts('Bolt', [(x, y) for x in (-px + 0.06, px - 0.06) for y in (-py + 0.06, py - 0.06)],
                   top + 0.005, r=0.022)
    pcs += C.corner_brackets(t, top, hx=px, hy=py, arm=0.16)
    root = G.join(pcs, f'Refinery_{tier.capitalize()}')
    G.finalize(root, atlas_dir)

    # ---- crusher disc (spins, modelled around its pivot) --------------------
    cp = [G.cyl('Disc', 0.12, 0.04, 'metal_bare', verts=12, bevel=0.006, seg=1)]
    for i in range(6):
        tooth = G.box(f'Tooth{i}', 0.08, 0.16, -0.022, 0.022, -0.02, 0.035, t['core'], bevel=0.005, seg=1)
        G.transform(tooth, rot=(0, 0, i * 60 + 15))
        cp.append(tooth)
    cp.append(G.cyl('Hub', 0.04, 0.06, t['accent'], loc=(0, 0, 0.02), verts=10))
    crusher = G.join(cp, 'Refinery_Crusher')
    G.finalize(crusher, atlas_dir)
    crusher.location = (HOP_X, 0, CRUSH_Z)
    crusher.parent = root
    return root
