"""Kotol (cauldron clan) part set - heavy industrial: sooty cast iron, riveted rims, copper
pipes, hazard stripes, smokestacks with glowing throats, furnace grilles, orange lights.

Hull: dark cast-iron deck inside a riveted rim frame, orange clan skirt. T2 = more stacks /
copper plumbing + the furnace-glow line on the core sides.
"""
import math

from lib import geo as G
from parts import common as C
from parts_pirate import kit as K

TOP = K.TOP
PH = K.PH
HAZ = ('pir_hazard', 'char_black')


def rim(x0=-PH, rivet=True):
    """Riveted raised frame around the deck edge (kept below the connector strap height)."""
    pcs = []
    inset = 0.004
    outer = G.chamfer_rect(x0 + inset, PH - inset, -PH + inset, PH - inset, C.PLATE_CHAMFER)
    w = 0.045
    inner = G.chamfer_rect(x0 + inset + w, PH - inset - w, -PH + inset + w, PH - inset - w, C.PLATE_CHAMFER * 0.6)
    pcs.append(C.frame_ring('Rim', outer, inner, TOP - 0.004, TOP + 0.016, 'kot_iron_dark'))
    if rivet:
        e = PH - 0.026
        xs = [x for x in (-0.3, 0.3) if x > x0 + 0.08]
        pts = [(x, s * e) for x in xs for s in (1, -1)] + [(s * e, y) for s in (1, -1) for y in (-0.3, 0.3)
                                                         if s * e > x0 + 0.05]
        pcs += K.rivets('RimRiv', pts, TOP + 0.02, 'kot_copper', r=0.013, h=0.014)
    return pcs


def hull(ct, x0=-K.HALF):
    pcs = K.hull(ct, x0=x0)
    pcs += rim(-PH if x0 <= -K.HALF + 1e-6 else x0 + 0.005)
    return pcs


def grille(name, x0, x1, y0, y1, z, n, glow, bar_mat='kot_iron_dark', along='x'):
    """Glowing furnace grille: a glow plate under n dark bars."""
    pcs = [G.box(name + 'Glow', x0, x1, y0, y1, z - 0.006, z + 0.004, glow)]
    if along == 'x':     # bars run along Y, spaced along X
        step = (x1 - x0) / n
        for i in range(n + 1):
            x = x0 + i * step
            pcs.append(G.box(f'{name}Bar{i}', x - 0.012, x + 0.012, y0 - 0.01, y1 + 0.01, z - 0.004, z + 0.022,
                             bar_mat))
    else:
        step = (y1 - y0) / n
        for i in range(n + 1):
            y = y0 + i * step
            pcs.append(G.box(f'{name}Bar{i}', x0 - 0.01, x1 + 0.01, y - 0.012, y + 0.012, z - 0.004, z + 0.022,
                             bar_mat))
    return pcs


def pipe(name, pts, r, mat='kot_copper'):
    """Pipe run through 3D points (square-ish 6-sided segments + joints)."""
    out = []
    for i in range(len(pts) - 1):
        out.append(K.bar(f'{name}{i}', pts[i], pts[i + 1], r, mat))
    for i, p in enumerate(pts[1:-1]):
        out.append(G.box(f'{name}J{i}', p[0] - r * 1.5, p[0] + r * 1.5, p[1] - r * 1.5, p[1] + r * 1.5,
                         p[2] - r * 1.5, p[2] + r * 1.5, 'kot_iron_dark'))
    return out


# ---------------------------------------------------------------------------
def cockpit(ct, lvl, rng, atlas):
    pcs = hull(ct)
    # boxy riveted bunker cab
    pcs.append(K.frustum('Cab', -0.40, 0.24, -0.31, 0.31, TOP - 0.005, -0.36, 0.12, -0.26, 0.26, TOP + 0.21,
                         'kot_iron', bevel=0.012))
    pcs.append(K.frustum('CabRoof', -0.3, 0.06, -0.2, 0.2, TOP + 0.2, -0.28, 0.04, -0.18, 0.18, TOP + 0.235,
                         'kot_iron_dark', bevel=0.006))
    # orange armour cheeks on the cab flanks
    for s in (1, -1):
        pcs.append(K.convex(f'Cheek{s}', [(-0.34, 0.31 * s, TOP), (0.2, 0.31 * s, TOP), (-0.34, 0.335 * s, TOP + 0.01),
                                          (0.18, 0.335 * s, TOP + 0.01), (-0.32, 0.275 * s, TOP + 0.17),
                                          (0.1, 0.275 * s, TOP + 0.17), (-0.32, 0.3 * s, TOP + 0.16),
                                          (0.1, 0.3 * s, TOP + 0.16)], 'kot_paint', bevel=0.005))
    # three glowing portholes on the front slope (the welding-mask grille of the Kotol captains)
    fx, fz = 0.24 - 0.12, 0.21
    nrm = (fz / math.hypot(fx, fz), 0.0, fx / math.hypot(fx, fz))
    for i, y in enumerate((-0.15, 0.0, 0.15)):
        t = 0.5
        c = (0.24 - fx * t + nrm[0] * 0.004, y, TOP + fz * t + nrm[2] * 0.004)
        rim_ = G.ring_band(f'PortRim{i}', 0.058, 0.04, -0.012, 0.012, 'kot_copper', verts=10)
        C.place(rim_, c, nrm)
        pcs.append(rim_)
        gl = G.cyl(f'Port{i}', 0.042, 0.016, ct['glass'], verts=10)
        C.place(gl, c, nrm)
        pcs.append(gl)
    # nose: glowing furnace grille (the "mouth")
    pcs += grille('Mouth', 0.27, 0.44, -0.2, 0.2, TOP + 0.01, 4, ct['role_glow'])
    # riveted dome hatch + smokestack
    pcs.append(G.ellipsoid('Dome', 0.1, 0.1, 0.07, 'kot_iron_dark', loc=(-0.14, 0.0, TOP + 0.235), seg=10, rings=6,
                           upper_only=True))
    pcs.append(G.ring_band('DomeRing', 0.115, 0.09, TOP + 0.232, TOP + 0.252, 'kot_copper', loc=(-0.14, 0, 0),
                           verts=10))
    pcs += K.stack('Stack', -0.36, 0.3, TOP, 0.66, 0.06)
    if lvl >= 2:
        pcs += K.stack('Stack2', -0.36, -0.3, TOP, 0.56, 0.05)
        pcs += pipe('Pipe', [(-0.36, 0.22, TOP + 0.1), (-0.36, -0.22, TOP + 0.1)], 0.018)
    for s in (1, -1):
        pcs.append(K.lamp(f'Lamp{s}', (0.4, 0.28 * s, TOP + 0.03), ct['light'], r=0.03))
    return K.finish(pcs, f'Cockpit_{ct["tier"].capitalize()}_Cauldron', atlas)


def engine(ct, lvl, rng, atlas):
    ax = K.ENGINE_AXIS_Z
    pcs = hull(ct, x0=K.ENGINE_CORE_X0)
    # riveted firebox housing with glowing top slots + hazard band
    pcs.append(G.box('Firebox', -0.06, 0.3, -0.3, 0.3, TOP - 0.005, TOP + 0.07, 'kot_iron', bevel=0.012, seg=1))
    pcs += grille('Slots', -0.03, 0.17, -0.22, 0.22, TOP + 0.072, 3, ct['role_glow'], along='x')
    pcs += K.hazard('Haz', 0.2, 0.28, -0.3, 0.3, TOP + 0.06, TOP + 0.075, 6, HAZ, along='y')
    pcs.append(G.box('Collar', -0.17, -0.07, -0.40, 0.40, -0.17, TOP + 0.03, 'kot_copper', bevel=0.02, seg=2))
    pcs += K.rivets('CollarRiv', [(-0.12, y) for y in (-0.3, -0.1, 0.1, 0.3)], TOP + 0.035, 'kot_iron_dark',
                    r=0.016)
    pcs.append(K.lamp('Lamp', (0.38, 0.0, TOP + 0.03), ct['light'], r=0.03))
    if lvl >= 2:
        pcs += K.stack('Stack', 0.36, 0.3, TOP, 0.5, 0.045)
        for s in (1, -1):
            pcs += pipe(f'Heat{s}', [(0.32, 0.36 * s, TOP + 0.03), (-0.04, 0.36 * s, TOP + 0.03),
                                     (-0.14, 0.36 * s, TOP + 0.06)], 0.018)
    # fat ribbed barrel bell
    pcs.append(G.cyl('Mount', 0.28, 0.10, 'kot_iron_dark', loc=(-0.20, 0, ax), axis='X', verts=12))
    prof = [(0.0, 0.2), (-0.19, 0.3), (-0.215, 0.322), (-0.205, 0.338), (-0.1, 0.33), (0.0, 0.3)]
    pcs.append(G.lathe('Bell', prof, [1, 2, 2, 0, 0, 0], ['kot_iron', 'nozzle_in', 'kot_paint'],
                       loc=(K.ENGINE_BELL_X, 0, ax), axis='X', verts=12, smooth=False))
    for i in range(8):
        a = 2 * math.pi * (i + 0.5) / 8
        f = G.box(f'Fin{i}', -0.13, 0.0, -0.011, 0.011, 0.29, 0.355, 'kot_iron_dark')
        G.transform(f, loc=(K.ENGINE_BELL_X - 0.02, 0, ax), rot=(math.degrees(a) - 90, 0, 0))
        pcs.append(f)
    rings = ((-0.36, 0.336, 0.3),) if lvl < 2 else ((-0.33, 0.33, 0.3), (-0.40, 0.341, 0.31))
    for i, (x, ro, ri) in enumerate(rings):
        pcs.append(G.ring_band(f'Glow{i}', ro, ri, -0.012, 0.012, ct['role_glow'], loc=(x, 0, ax), axis='X',
                               verts=12, smooth=False))
    pcs.append(G.cyl('Core', 0.2, 0.02, 'light_amber', loc=(-0.255, 0, ax), axis='X', verts=12))
    pcs.append(G.cyl('CoreCone', 0.0, 0.10, ct['role_glow'], loc=(-0.31, 0, ax), axis='X', verts=12, r2=0.14,
                     caps=False))
    return K.finish(pcs, f'Engine_{ct["tier"].capitalize()}_Cauldron', atlas)


def cannon(ct, lvl, rng, atlas):
    pcs = hull(ct)
    pcs.append(G.ring_band('Swivel', 0.33, 0.26, TOP - 0.01, TOP + 0.05, 'kot_iron_dark', verts=16,
                           top_mat='kot_iron'))
    pcs += K.rivets('SwivelRiv', [(0.295 * math.cos(a), 0.295 * math.sin(a)) for a in
                                  (math.radians(22.5 + 45 * i) for i in range(8))], TOP + 0.055, 'kot_copper',
                    r=0.013, h=0.014)
    pcs.append(G.cyl('Well', 0.265, 0.03, 'char_black', loc=(0, 0, TOP + 0.005), verts=16))
    pcs.append(G.box('FrontTick', 0.37, 0.43, -0.014, 0.014, TOP - 0.004, TOP + 0.022, ct['light']))
    root = K.finish(pcs, f'Cannon_{ct["tier"].capitalize()}_Cauldron', atlas)

    bz = K.CANNON_BARREL_Z
    tp = [G.cyl('Drum', 0.22, 0.17, 'kot_iron', loc=(-0.03, 0, 0.115), verts=12)]
    tp.append(G.ring_band('DrumBand', 0.232, 0.2, 0.06, 0.09, 'kot_copper', loc=(-0.03, 0, 0), verts=12))
    tp.append(G.ellipsoid('DrumDome', 0.18, 0.18, 0.06, 'kot_iron_dark', loc=(-0.03, 0, 0.2), seg=12, rings=6,
                          upper_only=True))
    tp += K.rivets('DrumRiv', [(-0.03 + 0.15 * math.cos(a), 0.15 * math.sin(a)) for a in
                               (math.radians(45 * i) for i in range(8))], 0.21, 'kot_copper', r=0.012, h=0.014)
    # hazard-striped mantlet + blunderbuss barrel with a flared copper muzzle
    tp.append(G.box('Mantlet', 0.14, 0.2, -0.13, 0.13, 0.04, 0.2, 'kot_iron_dark', bevel=0.01, seg=1))
    tp += K.hazard('MantHaz', 0.195, 0.21, -0.12, 0.12, 0.06, 0.19, 5, HAZ, along='y')
    tp.append(G.cyl('Barrel', 0.068, 0.22, 'kot_iron_dark', loc=(0.3, 0, bz), axis='X', verts=10))
    tp.append(G.cyl('Muzzle', 0.068, 0.07, 'kot_copper', loc=(0.435, 0, bz), axis='X', verts=10, r2=0.092))
    tp.append(G.ring_band('MuzzleGlow', 0.06, 0.04, 0.462, 0.47, ct['role_glow'], loc=(0, 0, bz), axis='X',
                          verts=10))
    tp += K.stack('Vent', -0.2, 0.0, 0.12, 0.36, 0.04)
    tp.append(K.lamp('Sight', (0.06, -0.1, 0.24), ct['light'], r=0.022))
    if lvl >= 2:
        for i, x in enumerate((0.25, 0.33)):
            tp.append(G.ring_band(f'Jacket{i}', 0.084, 0.066, -0.014, 0.014, 'kot_copper' if i else ct['role_glow'],
                                  loc=(x, 0, bz), axis='X', verts=10))
        for s in (1, -1):
            tp.append(G.cyl(f'AmmoDrum{s}', 0.07, 0.07, 'kot_paint', loc=(-0.06, 0.25 * s, 0.11), axis='Y', verts=10))
    turret = K.child(tp, 'Cannon_Turret', atlas, root, (0, 0, K.CANNON_HEAD_Z))
    m = G.empty('Cannon_Muzzle', loc=(K.CANNON_MUZZLE_X, 0, bz))
    m.parent = turret
    return root


def armor(ct, lvl, rng, atlas):
    pcs = hull(ct)
    pcs.append(K.poly('Slab', G.chamfer_rect(-0.36, 0.36, -0.36, 0.36, 0.07), TOP - 0.004, TOP + 0.05, 'kot_iron',
                      bevel=0.012))
    pcs += K.hazard('Haz', 0.12, 0.3, -0.34, 0.34, TOP + 0.048, TOP + 0.058, 7, HAZ, along='y')
    pcs += grille('Vent', -0.3, -0.06, -0.2, 0.2, TOP + 0.055, 4, ct['role_glow'])
    pcs += K.rivets('SlabRiv', [(x, y) for x in (-0.32, 0.0) for y in (-0.31, 0.31)] + [(0.32, -0.31), (0.32, 0.31)],
                    TOP + 0.055, 'kot_copper', r=0.014, h=0.014)
    if lvl >= 2:
        pcs.append(K.poly('PaintPlate', G.chamfer_rect(-0.02, 0.08, -0.3, 0.3, 0.02), TOP + 0.046, TOP + 0.062,
                          'kot_paint', bevel=0.004))
        pcs.append(G.box('GlowSeam', 0.09, 0.11, -0.3, 0.3, TOP + 0.046, TOP + 0.06, ct['role_glow']))
    return K.finish(pcs, f'Armor_{ct["tier"].capitalize()}_Cauldron', atlas)


def shield_generator(ct, lvl, rng, atlas):
    pcs = hull(ct)
    pcs.append(G.ring_band('PipeRing', 0.3, 0.26, TOP, TOP + 0.04, 'kot_copper', verts=16))
    pcs.append(G.cyl('Hearth', 0.2, 0.04, 'kot_iron_dark', loc=(0, 0, TOP + 0.02), verts=12))
    pcs.append(G.cyl('Coals', 0.14, 0.012, ct['role_glow'], loc=(0, 0, TOP + 0.045), verts=12))
    # tripod legs holding the crucible
    for i in range(3):
        a = math.radians(90 + 120 * i)
        ca, sa = math.cos(a), math.sin(a)
        pcs.append(K.bar(f'Leg{i}', (0.36 * ca, 0.36 * sa, TOP + 0.02), (0.2 * ca, 0.2 * sa, K.SHIELD_EMITTER_Z - 0.06),
                         0.035, 'kot_iron', hh=0.03))
        foot = G.box(f'Foot{i}', -0.06, 0.06, -0.06, 0.06, TOP - 0.01, TOP + 0.06, 'kot_paint', bevel=0.008, seg=1)
        G.transform(foot, loc=(0.36 * ca, 0.36 * sa, 0), rot=(0, 0, math.degrees(a)))
        pcs.append(foot)
        if lvl >= 2:
            pcs.append(K.bar(f'LegGlow{i}', (0.335 * ca, 0.335 * sa, TOP + 0.08),
                             (0.215 * ca, 0.215 * sa, K.SHIELD_EMITTER_Z - 0.09), 0.01, ct['role_glow']))
    pcs.append(G.ring_band('Cradle', 0.215, 0.18, K.SHIELD_EMITTER_Z - 0.085, K.SHIELD_EMITTER_Z - 0.06,
                           'kot_iron_dark', verts=12))
    root = K.finish(pcs, f'ShieldGenerator_{ct["tier"].capitalize()}_Cauldron', atlas)

    # spinning crucible: bowl with a molten top, pouring lips and copper handles
    prof = [(-0.11, 0.0), (-0.11, 0.07), (-0.07, 0.15), (0.03, 0.185), (0.06, 0.19), (0.06, 0.155), (0.035, 0.0)]
    ep = [G.lathe('Bowl', prof, [0, 0, 0, 0, 1, 1, 1], ['kot_iron', 'kot_iron_dark'], verts=12, smooth=False)]
    ep.append(G.cyl('Molten', 0.155, 0.01, ct['role_glow'], loc=(0, 0, 0.045), verts=12))
    ep.append(G.ring_band('Lip', 0.2, 0.17, 0.045, 0.07, 'kot_copper', verts=12))
    for i in range(3):
        a = math.radians(60 + 120 * i)
        h = G.torus(f'Handle{i}', 0.045, 0.012, 'kot_copper', loc=(0.21 * math.cos(a), 0.21 * math.sin(a), 0.0),
                    rot=(90, 0, 60 + 120 * i + 90), maj=8, mnr=4)
        ep.append(h)
    if lvl >= 2:
        ep.append(G.torus('GlowRing', 0.15, 0.01, ct['role_glow'], loc=(0, 0, -0.04), maj=12, mnr=4))
    K.child(ep, 'Shield_Emitter', atlas, root, (0, 0, K.SHIELD_EMITTER_Z))
    return root


def reactor(ct, lvl, rng, atlas):
    pcs = hull(ct)
    # furnace firebox with an open glowing grate at the front
    pcs.append(K.frustum('Firebox', -0.32, 0.3, -0.3, 0.3, TOP - 0.005, -0.3, 0.26, -0.27, 0.27, TOP + 0.24,
                         'kot_iron', bevel=0.012))
    pcs.append(G.box('Grate', 0.255, 0.305, -0.17, 0.17, TOP + 0.04, TOP + 0.18, ct['role_glow']))
    for i, y in enumerate((-0.11, -0.04, 0.04, 0.11)):
        pcs.append(G.box(f'GrateBar{i}', 0.29, 0.32, y - 0.014, y + 0.014, TOP + 0.03, TOP + 0.19, 'kot_iron_dark'))
    pcs.append(G.box('GrateFrame', 0.285, 0.315, -0.2, 0.2, TOP + 0.18, TOP + 0.21, 'kot_copper'))
    pcs += K.hazard('Haz', -0.3, 0.26, 0.235, 0.27, TOP + 0.236, TOP + 0.246, 6, HAZ, along='x', slant=0.8)
    pcs += K.rivets('BoxRiv', [(x, y) for x in (-0.24, 0.2) for y in (-0.2, 0.2)], TOP + 0.24, 'kot_copper')
    # the tall stack (signature)
    stacks = [(-0.1, 0.0, 0.1)] if lvl < 2 else [(-0.12, 0.11, 0.08), (-0.12, -0.11, 0.08)]
    for i, (x, y, r) in enumerate(stacks):
        pcs += K.stack(f'Stack{i}', x, y, TOP + 0.2, 0.84 if i == 0 else 0.76, r, verts=12)
    pcs += pipe('Pipe', [(0.15, 0.3, TOP + 0.1), (0.15, 0.36, TOP + 0.1), (-0.36, 0.36, TOP + 0.1),
                         (-0.36, 0.36, TOP + 0.02)], 0.02)
    pcs.append(K.lamp('Lamp', (0.2, -0.2, TOP + 0.255), ct['light'], r=0.028))
    return K.finish(pcs, f'Reactor_{ct["tier"].capitalize()}_Cauldron', atlas)


def gyroscope(ct, lvl, rng, atlas):
    pcs = hull(ct)
    pcs.append(G.ring_band('Collar', 0.37, 0.31, TOP - 0.02, TOP + 0.05, 'kot_iron_dark', verts=16, top_mat='kot_iron'))
    pcs += K.rivets('CollarRiv', [(0.34 * math.cos(a), 0.34 * math.sin(a)) for a in
                                  (math.radians(45 * i) for i in range(8))], TOP + 0.055, 'kot_copper', r=0.013,
                    h=0.014)
    pcs.append(G.cyl('WellFloor', 0.315, 0.04, 'char_black', loc=(0, 0, TOP - 0.005), verts=16))
    pcs.append(G.ring_band('WellGlow', 0.27, 0.22, TOP + 0.012, TOP + 0.022, ct['role_glow'], verts=16))
    h, c = PH, 0.2
    for i, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        tri = [(sx * h, sy * (h - c)), (sx * h, sy * (h - 0.06)), (sx * (h - 0.06), sy * h), (sx * (h - c), sy * h)]
        pcs.append(K.poly(f'Wedge{i}', tri, TOP - 0.01, TOP + 0.03, 'kot_paint', bevel=0.006))
    pcs.append(G.cyl('Axle', 0.05, 0.06, 'kot_copper', loc=(0, 0, TOP + 0.03), verts=10))
    pcs.append(G.ellipsoid('CoreOrb', 0.085, 0.085, 0.085, ct['role_glow'], loc=(0, 0, K.GYRO_RING_Z), seg=10, rings=6))
    root = K.finish(pcs, f'Gyroscope_{ct["tier"].capitalize()}_Cauldron', atlas)

    outer = [G.torus('RingO', 0.285, 0.036, 'kot_iron', rot=(90, 0, 0), maj=20, mnr=6)]
    for i, a in enumerate((45, 135, 225, 315)):
        r = math.radians(a)
        b = G.box(f'Block{i}', -0.035, 0.035, -0.05, 0.05, -0.05, 0.05, 'kot_copper')
        G.transform(b, loc=(0.285 * math.cos(r), 0, 0.285 * math.sin(r)), rot=(0, -a, 0))
        outer.append(b)
    for i, z in enumerate((0.285, -0.285)):
        outer.append(G.cyl(f'Hub{i}', 0.04, 0.06, 'kot_iron_dark', loc=(0, 0, z), verts=10))
    if lvl >= 2:
        for s in (1, -1):
            outer.append(G.torus(f'RingOGlow{s}', 0.285, 0.009, ct['role_glow'], loc=(0, 0.034 * s, 0),
                                 rot=(90, 0, 0), maj=20, mnr=3))
    ring_o = K.child(outer, 'Gyro_Ring_Outer', atlas, root, (0, 0, K.GYRO_RING_Z))
    inner = [G.torus('RingI', 0.2, 0.024, 'kot_copper', maj=16, mnr=5),
             G.torus('RingIGlow', 0.174, 0.009, ct['role_glow'], maj=16, mnr=3)]
    for i, x in enumerate((0.235, -0.235)):
        inner.append(G.cyl(f'RingIHub{i}', 0.03, 0.08, 'kot_iron_dark', loc=(x, 0, 0), axis='X', verts=8))
    K.child(inner, 'Gyro_Ring_Inner', atlas, ring_o, (0, 0, 0))
    return root


def boiler(name, x, y, r, z1, lvl):
    """Upright riveted copper boiler with iron bands and a domed cap."""
    pcs = [G.cyl(name, r, z1 - TOP, 'kot_copper', loc=(x, y, (TOP + z1) / 2), verts=12)]
    for i, z in enumerate((TOP + 0.08, z1 - 0.07)):
        pcs.append(G.ring_band(f'{name}Band{i}', r + 0.014, r - 0.004, z - 0.02, z + 0.02, 'kot_iron_dark',
                               loc=(x, y, 0), verts=12))
    pcs.append(G.ellipsoid(f'{name}Cap', r, r, r * 0.45, 'kot_iron', loc=(x, y, z1), seg=12, rings=6, upper_only=True))
    pcs.append(G.cyl(f'{name}Valve', 0.025, 0.05, 'kot_iron_dark', loc=(x, y, z1 + r * 0.45 + 0.02), verts=8))
    return pcs


def fuel_tank(ct, lvl, rng, atlas):
    pcs = hull(ct)
    pcs += boiler('Boiler', -0.08, 0.04, 0.22, 0.56, lvl)
    pcs += boiler('Small', 0.26, -0.25, 0.11, 0.42, lvl)
    if lvl >= 2:
        pcs += boiler('Small2', 0.27, 0.27, 0.1, 0.38, lvl)
        pcs.append(G.box('Gauge', -0.08 + 0.205, -0.08 + 0.235, -0.02 + 0.04, 0.02 + 0.04, TOP + 0.12, TOP + 0.3,
                         ct['role_glow']))
    # gauge porthole on the boiler front + valve wheel + pipes
    g = G.cyl('GaugeGlass', 0.04, 0.02, ct['glass'], verts=10)
    C.place(g, (0.135, 0.04, TOP + 0.24), (1, 0, 0))
    pcs.append(g)
    wheel = G.torus('Wheel', 0.05, 0.012, 'kot_paint', maj=10, mnr=4)
    C.place(wheel, (-0.08, -0.205, TOP + 0.2), (0, -1, 0))
    pcs.append(wheel)
    pcs += pipe('Feed', [(0.26, -0.25, TOP + 0.08), (0.1, -0.1, TOP + 0.08)], 0.02, 'kot_iron_dark')
    pcs += K.hazard('Haz', -0.42, -0.34, -0.4, 0.4, TOP, TOP + 0.012, 7, HAZ, along='y')
    pcs.append(K.lamp('Lamp', (0.3, 0.3, TOP + 0.03), ct['light'], r=0.028) if lvl < 2 else
               K.lamp('Lamp', (0.38, -0.05, TOP + 0.03), ct['light'], r=0.028))
    return K.finish(pcs, f'FuelTank_{ct["tier"].capitalize()}_Cauldron', atlas)


def cargo(ct, lvl, rng, atlas):
    pcs = hull(ct)
    # ore skip / hopper: wider at the top, riveted, hazard rim, heap of glowing slag
    z1 = TOP + 0.25
    for i, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        pcs.append(G.box(f'Leg{i}', sx * 0.3 - 0.04, sx * 0.3 + 0.04, sy * 0.3 - 0.04, sy * 0.3 + 0.04, TOP - 0.01,
                         TOP + 0.1, 'kot_iron_dark'))
    pcs.append(K.frustum('Hopper', -0.27, 0.27, -0.27, 0.27, TOP + 0.02, -0.38, 0.38, -0.38, 0.38, z1, 'kot_iron',
                         bevel=0.01))
    outer = G.chamfer_rect(-0.39, 0.39, -0.39, 0.39, 0.05)
    inner = G.chamfer_rect(-0.33, 0.33, -0.33, 0.33, 0.03)
    pcs.append(C.frame_ring('Rim', outer, inner, z1 - 0.01, z1 + 0.03, 'kot_paint'))
    pcs += K.hazard('RimHaz', -0.39, 0.39, 0.345, 0.385, z1 + 0.028, z1 + 0.036, 8, HAZ, along='x', slant=0.9)
    pcs += K.hazard('RimHaz2', -0.39, 0.39, -0.385, -0.345, z1 + 0.028, z1 + 0.036, 8, HAZ, along='x', slant=0.9)
    # slag heap
    for i in range(7):
        x, y = rng.uniform(-0.22, 0.22), rng.uniform(-0.22, 0.22)
        s = rng.uniform(0.06, 0.11)
        lump = K.convex(f'Lump{i}', [(x + rng.uniform(-s, s), y + rng.uniform(-s, s), z1 - 0.01 + rng.uniform(0, s))
                                     for _ in range(9)], 'kot_iron_dark' if i % 3 else 'ember')
        pcs.append(lump)
    pcs.append(G.box('Fill', -0.34, 0.34, -0.34, 0.34, z1 - 0.002, z1 + 0.008, 'char_black'))
    pcs.append(K.lamp('Lamp', (0.4, -0.4, TOP + 0.03), ct['light'], r=0.028))
    if lvl >= 2:
        for i, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
            pcs.append(G.box(f'Cap{i}', sx * 0.36 - 0.045, sx * 0.36 + 0.045, sy * 0.36 - 0.045, sy * 0.36 + 0.045,
                             z1 + 0.02, z1 + 0.05, 'kot_copper'))
        pcs.append(G.box('GlowBand', -0.3, 0.3, -0.335, -0.315, TOP + 0.13, TOP + 0.15, ct['role_glow']))
    return K.finish(pcs, f'Cargo_{ct["tier"].capitalize()}_Cauldron', atlas)


def tractor_beam(ct, lvl, rng, atlas):
    pcs = hull(ct)
    pcs.append(G.ring_band('Swivel', 0.33, 0.27, TOP - 0.01, TOP + 0.05, 'kot_iron_dark', verts=16, top_mat='kot_iron'))
    pcs += K.rivets('SwivelRiv', [(0.3 * math.cos(a), 0.3 * math.sin(a)) for a in
                                  (math.radians(22.5 + 45 * i) for i in range(8))], TOP + 0.055, 'kot_copper',
                    r=0.013, h=0.014)
    pcs.append(G.cyl('Well', 0.275, 0.03, 'char_black', loc=(0, 0, TOP + 0.005), verts=16))
    pcs.append(G.box('FrontTick', 0.37, 0.43, -0.014, 0.014, TOP - 0.004, TOP + 0.022, ct['light']))
    root = K.finish(pcs, f'TractorBeam_{ct["tier"].capitalize()}_Cauldron', atlas)

    az = K.TRACTOR_AXIS_Z
    hp = [G.cyl('HeadBase', 0.25, 0.05, 'kot_iron_dark', loc=(0, 0, 0.02), verts=12)]
    hp.append(G.box('Housing', -0.27, 0.06, -0.15, 0.15, 0.04, az + 0.13, 'kot_iron', bevel=0.014, seg=1))
    hp += K.hazard('HouseHaz', -0.25, 0.04, -0.15, 0.15, az + 0.13, az + 0.14, 5, HAZ, along='x', slant=0.6)
    hp += K.stack('Vent', -0.2, 0.0, az + 0.1, az + 0.27, 0.035)
    hp.append(K.bar('Arm', (0.0, 0.0, az), (0.3, 0.0, az), 0.05, 'kot_iron_dark'))
    # electromagnet: copper-wound disc with a glowing face
    hp.append(G.cyl('Magnet', 0.19, 0.08, 'kot_iron_dark', loc=(0.34, 0, az), axis='X', verts=14))
    for i, x in enumerate((0.31, 0.34, 0.37)):
        hp.append(G.torus(f'Coil{i}', 0.195, 0.014, 'kot_copper', loc=(x, 0, az), rot=(0, 90, 0), maj=14, mnr=4))
    hp.append(G.cyl('Face', 0.13, 0.012, ct['role_glow'], loc=(0.383, 0, az), axis='X', verts=14))
    hp.append(G.cyl('Pole', 0.04, 0.04, 'kot_copper', loc=(0.4, 0, az), axis='X', verts=8))
    if lvl >= 2:
        hp.append(G.torus('CoilGlow', 0.205, 0.008, ct['role_glow'], loc=(0.325, 0, az), rot=(0, 90, 0), maj=14,
                          mnr=3))
        for s in (1, -1):
            hp.append(G.box(f'Fin{s}', -0.24, -0.02, 0.15 * s - 0.01, 0.15 * s + 0.01, 0.06, az + 0.1, 'kot_copper'))
    head = K.child(hp, 'Tractor_Head', atlas, root, (0, 0, K.TRACTOR_HEAD_Z))
    tip = G.empty('Tractor_Emitter', loc=(K.TRACTOR_EMITTER_X, 0, az))
    tip.parent = head
    return root


BUILDERS = {'cockpit': cockpit, 'engine': engine, 'cannon': cannon, 'armor': armor,
            'shield_generator': shield_generator, 'reactor': reactor, 'gyroscope': gyroscope,
            'fuel_tank': fuel_tank, 'cargo': cargo, 'tractor_beam': tractor_beam}
