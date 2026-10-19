"""Heavy laser 2x1 (game id "heavyLaser") - a big mining laser.  The rear cell
carries the static power plant (capacitor bank + heat-sink housing), the front
cell a chunky turret with a finned barrel and a large emitter lens facing +X.

Footprint: x in [-1, 1], y in [-0.5, 0.5] (2 cells along X, centred on the
footprint centre; see parts/common.py multi-cell convention).

Node layout (pivots = node origins):
  HeavyLaser_<Tier>       root, static base (footprint centre, z = 0)
    Laser_Head            turret head; pivot (HEAD_X, 0, HEAD_Z) = centre of
                          the front cell.  Rotate around local Z (Blender) =
                          glTF local +Y to aim (+-60 deg from +X).
      Muzzle              empty at the lens tip = beam origin, points +X.

The head stays inside the 2x1 footprint at any aim angle within +-60 deg.
Level 2: glowing coils between the heat-sink discs, capacitor glow bands,
side capacitor pods on the head, corner brackets, tier glow line.
"""
import math
from lib import geo as G
from lib import palette as P
from parts import common as C

PART = 'heavy_laser'
CELLS = (2, 1)

HEAD_X = 0.45                  # turret pivot = centre of the front cell (+0.05 forward)
HEAD_Z = C.DECK_TOP + 0.055    # top of the swivel ring
BARREL_Z = 0.21                # barrel axis height above the pivot
MUZZLE_X = 0.52                # lens tip, local to the head (world x = 0.97 at rest)


def _capacitor(name, y, t, lvl, x0=-0.90, x1=-0.16, z=None, r=0.095):
    """Horizontal capacitor cylinder along X with end caps and glow bands."""
    z = C.DECK_TOP + 0.02 + r if z is None else z
    L = x1 - x0
    cx = (x0 + x1) / 2
    out = [G.cyl(name, r, L, t['plate'], loc=(cx, y, z), axis='X', verts=14, bevel=0.012, seg=1)]
    for i, x in enumerate((x0 + 0.035, x1 - 0.035)):
        out.append(G.ring_band(f'{name}Cap{i}', r + 0.012, r - 0.03, -0.03, 0.03, t['core'],
                               loc=(x, y, z), axis='X', verts=14))
    bands = (-0.27, -0.09, 0.09, 0.27)
    for i, o in enumerate(bands):
        glow = (i in (1, 2)) if lvl < 2 else True
        out.append(G.ring_band(f'{name}Band{i}', r + 0.008, r - 0.01, -0.016, 0.016,
                               'laser_glow' if glow else t['accent'], loc=(cx + o, y, z), axis='X', verts=14))
    return out


def build(tier, atlas_dir):
    t = P.TIERS[tier]
    lvl = C.level(t)
    top = C.DECK_TOP
    px, py = C.plate_half(*CELLS)
    pcs = C.hull_base(t, *CELLS)

    # ---- rear cell: power plant ------------------------------------------
    # heat-sink housing in the middle, capacitors on both sides
    hx0, hx1 = -0.86, -0.16
    pcs.append(G.prism('PlantBase', G.chamfer_rect(-0.93, -0.10, -0.42, 0.42, 0.06), top - 0.01, top + 0.035,
                       'hull_mid', bevel=0.01, seg=1))
    pcs.append(G.prism('Housing', G.chamfer_rect(hx0, hx1, -0.20, 0.20, 0.05), top + 0.02, top + 0.25,
                       t['plate'], bevel=0.02, seg=2))
    pcs.append(G.box('HousingWell', hx0 + 0.06, hx1 - 0.06, -0.15, 0.15, top + 0.20, top + 0.255,
                     'trim_black', bevel=0.006, seg=1))
    nf = 9 if lvl < 2 else 11
    for i in range(nf):     # heat-sink fins across the housing top (reads as a grille)
        x = hx0 + 0.09 + i * (hx1 - hx0 - 0.18) / (nf - 1)
        pcs.append(G.box(f'Sink{i}', x - 0.014, x + 0.014, -0.16, 0.16, top + 0.2, top + 0.31,
                         'metal_bare' if lvl < 2 else t['core'], bevel=0.004, seg=1))
    pcs.append(G.box('SinkRail', hx0 + 0.05, hx1 - 0.05, -0.012, 0.012, top + 0.30, top + 0.325,
                     t['accent'], bevel=0.004, seg=1))
    if lvl >= 2:
        for s in (1, -1):
            pcs.append(G.box(f'SinkGlow{s}', hx0 + 0.07, hx1 - 0.07, s * 0.165 - 0.008, s * 0.165 + 0.008,
                             top + 0.205, top + 0.22, t['glow']))
    for s in (1, -1):
        pcs += _capacitor(f'Cap{"L" if s > 0 else "R"}', 0.32 * s, t, lvl)
        # capacitor saddles
        for j, x in enumerate((-0.74, -0.32)):
            pcs.append(G.box(f'Saddle{s}{j}', x - 0.035, x + 0.035, 0.32 * s - 0.11, 0.32 * s + 0.11,
                             top - 0.01, top + 0.08, 'hull_dark', bevel=0.008, seg=1))
    # rear warning stripe + status light
    pcs.append(G.box('RearStripe', -0.95, -0.905, -0.18, 0.18, top - 0.004, top + 0.008, t['accent']))
    pcs.append(G.box('Status', -0.86, -0.80, 0.225, 0.255, top + 0.02, top + 0.045, 'light_amber',
                     bevel=0.006, seg=1))
    # power conduit from the plant to the turret ring
    pcs.append(G.box('Conduit', -0.16, 0.10, -0.075, 0.075, top - 0.01, top + 0.075, t['core'],
                     bevel=0.015, seg=1))
    for i, x in enumerate((-0.10, -0.04, 0.02)):
        pcs.append(G.box(f'ConduitRib{i}', x - 0.012, x + 0.012, -0.085, 0.085, top + 0.0, top + 0.085,
                         'metal_bare', bevel=0.004, seg=1))
    pcs.append(G.box('ConduitGlow', -0.15, 0.06, -0.018, 0.018, top + 0.07, top + 0.082, 'laser_glow'))

    # ---- front cell: swivel ring + firing arc ----------------------------
    pcs.append(G.ring_band('Swivel', 0.40, 0.34, top - 0.01, top + 0.055, 'hull_mid', verts=32,
                           top_mat=t['plate'], loc=(HEAD_X, 0, 0)))
    pcs.append(G.cyl('Well', 0.345, 0.03, 'trim_black', loc=(HEAD_X, 0, top + 0.005), verts=32))
    for i, a in enumerate((-60, -30, 0, 30, 60)):
        r = math.radians(a)
        b = G.box(f'Tick{i}', -0.026, 0.026, -0.009, 0.009, top - 0.004, top + 0.006,
                  'laser_glow' if a == 0 else t['accent'])
        G.transform(b, loc=(HEAD_X + 0.445 * math.cos(r), 0.445 * math.sin(r), 0), rot=(0, 0, a))
        pcs.append(b)
    pcs += C.bolts('Bolt', [(x, y) for x in (-px + 0.08, px - 0.08) for y in (-py + 0.08, py - 0.08)],
                   top + 0.005, r=0.024)
    pcs += C.corner_brackets(t, top, hx=px, hy=py, arm=0.16)
    root = G.join(pcs, f'HeavyLaser_{tier.capitalize()}')
    G.finalize(root, atlas_dir)

    # ---- turret head, modelled around its pivot --------------------------
    hp = []
    hp.append(G.cyl('HeadBase', 0.335, 0.06, t['core'], loc=(0, 0, 0.025), verts=32, bevel=0.012, seg=1))
    hp.append(G.prism('Housing', G.chamfer_rect(-0.34, 0.14, -0.235, 0.235, 0.08), 0.05, 0.37,
                      t['plate'], bevel=0.028, seg=2))
    # top: accent stripe, power window, rear vent
    hp.append(G.box('TopStripe', -0.29, 0.08, -0.05, 0.05, 0.365, 0.384, t['accent'], bevel=0.006, seg=1))
    hp.append(G.box('PowerGlow', -0.32, -0.22, -0.15, 0.15, 0.365, 0.38, 'laser_glow', bevel=0.005, seg=1))
    for s in (1, -1):
        hp.append(G.box(f'TopPanel{s}', -0.18, 0.06, s * 0.105 - 0.05, s * 0.105 + 0.05, 0.365, 0.378,
                        t['core'], bevel=0.005, seg=1))
    # side heat-sink fins on the housing flanks
    for s in (1, -1):
        for i, x in enumerate((-0.27, -0.19, -0.11, -0.03)):
            hp.append(G.box(f'Fin{s}{i}', x - 0.022, x + 0.022, min(0.235 * s, 0.285 * s),
                            max(0.235 * s, 0.285 * s), 0.09, 0.33, 'trim_black'))
        if lvl >= 2:   # capacitor pods with glowing caps
            hp.append(G.cyl(f'Pod{s}', 0.05, 0.20, t['accent'], loc=(0.06, 0.255 * s, 0.13), axis='X', verts=12))
            hp.append(G.cyl(f'PodGlow{s}', 0.036, 0.016, t['glow'], loc=(0.165, 0.255 * s, 0.13), axis='X',
                            verts=12))
    # barrel: mantlet, finned heat-sink sleeve, shroud, lens
    hp.append(G.box('Mantlet', 0.10, 0.19, -0.16, 0.16, 0.08, 0.34, t['core'], bevel=0.02, seg=1))
    hp.append(G.cyl('Barrel', 0.095, 0.30, 'metal_bare', loc=(0.30, 0, BARREL_Z), axis='X', verts=16))
    discs = (0.215, 0.255, 0.295, 0.335)
    for i, x in enumerate(discs):
        hp.append(G.ring_band(f'SinkDisc{i}', 0.15, 0.09, -0.011, 0.011, t['core'] if i % 2 else 'metal_bare',
                              loc=(x, 0, BARREL_Z), axis='X', verts=14))
    if lvl >= 2:
        for i, x in enumerate((0.235, 0.315)):
            hp.append(G.ring_band(f'Coil{i}', 0.12, 0.09, -0.008, 0.008, 'laser_glow',
                                  loc=(x, 0, BARREL_Z), axis='X', verts=16))
    hp.append(G.ring_band('FocusRing', 0.135, 0.09, -0.02, 0.02, t['accent'], loc=(0.37, 0, BARREL_Z),
                          axis='X', verts=16))
    hp.append(G.lathe('Shroud', [(0.0, 0.10), (0.0, 0.15), (0.09, 0.158), (0.105, 0.125), (0.095, 0.098)],
                      [0, 0, 1, 1, 0], ['hull_dark', 'trim_black'], loc=(0.395, 0, BARREL_Z), axis='X', verts=20))
    if lvl >= 3:  # T3: gem ridge + four focusing prisms around the shroud
        hp.append(C.gem_bar('RidgeGem', (-0.27, 0, 0.375), (0.06, 0, 0.375), 0.06, 0.05))
        for i, a in enumerate((45, 135, 225, 315)):
            r = math.radians(a)
            g = C.gem(f'Prism{i}', 0.12, 0.026, sides=4)
            C.place(g, (0.43, 0.14 * math.cos(r), BARREL_Z + 0.14 * math.sin(r)),
                    (1.0, 0.25 * math.cos(r), 0.25 * math.sin(r)))
            hp.append(g)
    hp.append(G.ellipsoid('Lens', 0.04, 0.105, 0.105, 'laser_glow', seg=14, rings=6))
    hp[-1].location = (MUZZLE_X - 0.04, 0, BARREL_Z)
    head = G.join(hp, 'Laser_Head')
    G.finalize(head, atlas_dir)
    head.location = (HEAD_X, 0, HEAD_Z)
    head.parent = root

    muzzle = G.empty('Muzzle', loc=(MUZZLE_X, 0, BARREL_Z))
    muzzle.parent = head
    return root
