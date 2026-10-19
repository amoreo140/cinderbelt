"""Slanted Star (slantedStar clan) part set - sleek raiders: black lacquer, graphite panels cut
by one slanted gold slash, raked blade fins, sheared four-point stars, yellow lights.

Hull: black lacquer deck with a raised graphite panel cut on a slant + a gold inlay along the
cut, dark-gold skirt. T2 = extra blades / gold trim + the yellow glow line on the core sides.
"""
import math

from lib import geo as G
from parts import common as C
from parts_pirate import kit as K

TOP = K.TOP
PH = K.PH
SL = 0.55          # slant of the clan slash: x offset per unit y


def slash_panel(x0=-PH, mirror=1, inset=0.05, gap=0.045, z1=TOP + 0.014, cut=0.06):
    """Raised graphite panel over the deck, split by a slanted gold inlay (the clan slash)."""
    a, b = x0 + inset, PH - inset
    y0, y1 = -PH + inset, PH - inset
    xm = (a + b) / 2 + cut

    def sx(y):
        return xm + mirror * SL * y
    left = [(a, y0), (sx(y0) - gap, y0), (sx(y1) - gap, y1), (a, y1)]
    right = [(sx(y0) + gap, y0), (b, y0), (b, y1), (sx(y1) + gap, y1)]
    pcs = [K.poly('PanelL', left, TOP - 0.004, z1, 'sst_graphite', bevel=0.006),
           K.poly('PanelR', right, TOP - 0.004, z1 - 0.004, 'sst_lacquer', bevel=0.006)]
    inlay = [(sx(y0) - gap * 0.45, y0 + 0.01), (sx(y0) + gap * 0.45, y0 + 0.01),
             (sx(y1) + gap * 0.45, y1 - 0.01), (sx(y1) - gap * 0.45, y1 - 0.01)]
    pcs.append(K.poly('SlashGold', inlay, TOP - 0.004, z1 + 0.004, 'sst_gold'))
    return pcs


def hull(ct, x0=-K.HALF, panel=True, mirror=1, **kw):
    pcs = K.hull(ct, x0=x0)
    if panel:
        pcs += slash_panel(-PH if x0 <= -K.HALF + 1e-6 else x0 + 0.005, mirror=mirror, **kw)
    return pcs


def blade(name, root_x0, root_x1, tip_x, height, thick, loc, yaw, mat, tilt=0.0):
    """Raked blade fin: root from root_x0..root_x1 on the deck, swept tip at (tip_x, height)."""
    prof = [(root_x0, 0.0), (root_x1, 0.0), (tip_x + 0.03, height), (tip_x - 0.03, height)]
    return K.fin(name, prof, thick, loc, yaw, mat, tilt=tilt)


def gold_edge(name, root_x1, tip_x, height, loc, yaw, tilt=0.0, w=0.012):
    """Gold strip along a blade's leading edge (same frame as blade())."""
    prof = [(root_x1 - 0.005, 0.0), (root_x1 + 0.025, 0.0), (tip_x + 0.045, height + 0.006), (tip_x + 0.015, height)]
    return K.fin(name, prof, w * 2.2, loc, yaw, 'sst_gold', tilt=tilt)


# ---------------------------------------------------------------------------
def cockpit(ct, lvl, rng, atlas):
    pcs = K.hull(ct, deck=False)
    h = PH
    fair = [(-h, -h + 0.03), (-h + 0.03, -h), (0.05, -h), (h, -0.14), (h, 0.14), (0.05, h), (-h + 0.03, h),
            (-h, h - 0.03)]
    pcs.append(K.poly('Fairing', fair, 0.06, TOP, 'sst_lacquer', bevel=0.012))
    # long dart hull with a faceted smoked-gold canopy
    pcs.append(K.convex('Dart', [(-0.44, -0.2, TOP), (-0.44, 0.2, TOP), (0.47, 0.0, TOP + 0.005),
                                 (0.3, -0.07, TOP), (0.3, 0.07, TOP), (-0.36, -0.12, TOP + 0.12),
                                 (-0.36, 0.12, TOP + 0.12), (0.1, -0.05, TOP + 0.1), (0.1, 0.05, TOP + 0.1)],
                        'sst_graphite', bevel=0.006))
    pcs.append(K.convex('Canopy', [(-0.12, -0.085, TOP + 0.1), (-0.12, 0.085, TOP + 0.1), (0.3, 0.0, TOP + 0.06),
                                   (0.18, -0.05, TOP + 0.085), (0.18, 0.05, TOP + 0.085),
                                   (-0.06, -0.05, TOP + 0.175), (-0.06, 0.05, TOP + 0.175), (0.08, 0.0, TOP + 0.16)],
                        ct['glass']))
    # gold chines along the fairing edges + nose spike
    for s in (1, -1):
        pcs.append(K.bar(f'Chine{s}', (-0.42, 0.29 * s, TOP + 0.004), (0.06, 0.29 * s, TOP + 0.004), 0.012, 'sst_gold',
                         hh=0.008))
        pcs.append(K.bar(f'ChineB{s}', (0.06, 0.29 * s, TOP + 0.004), (0.42, 0.13 * s, TOP + 0.004), 0.012, 'sst_gold',
                         hh=0.008))
    pcs.append(K.spike('NoseSpike', (0.42, 0.0, TOP + 0.012), (1, 0, 0.05), 0.075, 0.02, 'sst_gold'))
    # raked twin blades, canted outward (slanted)
    for s in (1, -1):
        loc = (0.0, 0.22 * s, TOP)
        pcs.append(blade(f'Blade{s}', -0.46, -0.2, -0.44, 0.27, 0.022, loc, 0, 'sst_lacquer', tilt=-18 * s))
        pcs.append(gold_edge(f'BladeEdge{s}', -0.2, -0.44, 0.27, loc, 0, tilt=-18 * s))
        tip = (-0.44 + 0.0, 0.22 * s + 0.27 * math.sin(math.radians(18)) * s, TOP + 0.27 * math.cos(math.radians(18)))
        pcs.append(K.lamp(f'TipLamp{s}', (tip[0] - 0.02, tip[1], tip[2] + 0.005), ct['light'], r=0.02, h=0.02))
    # sheared star emblem on the deck behind the canopy
    pcs.append(K.star4('Star', 0.09, 0.03, TOP - 0.002, TOP + 0.012, 'sst_gold', loc=(-0.3, 0.0, 0.0)))
    if lvl >= 2:
        for s in (1, -1):
            pcs.append(K.bar(f'Strake{s}', (-0.3, 0.16 * s, TOP + 0.06), (0.18, 0.07 * s, TOP + 0.06), 0.008,
                             ct['role_glow'], hh=0.008))
            pcs.append(blade(f'Canard{s}', 0.12, 0.26, 0.1, 0.1, 0.016, (0.0, 0.33 * s, TOP), 0, 'sst_gold_dark',
                             tilt=-35 * s))
    return K.finish(pcs, f'Cockpit_{ct["tier"].capitalize()}_SlantedStar', atlas)


def engine(ct, lvl, rng, atlas):
    ax = K.ENGINE_AXIS_Z
    pcs = hull(ct, x0=K.ENGINE_CORE_X0, panel=False)
    # slanted intake slots (yellow) on a graphite plate
    pcs.append(K.poly('Intake', [(-0.02, -0.3), (0.26, -0.3), (0.38, 0.3), (0.1, 0.3)], TOP - 0.004, TOP + 0.014,
                      'sst_graphite', bevel=0.005))
    for i, o in enumerate((-0.08, 0.0, 0.08)):
        pcs.append(K.poly(f'Slot{i}', [(0.1 + o, -0.22), (0.135 + o, -0.22), (0.235 + o, 0.22), (0.2 + o, 0.22)],
                          TOP + 0.01, TOP + 0.02, ct['role_glow'] if i == 1 or lvl >= 2 else 'char_black'))
    pcs.append(K.frustum('Collar', -0.17, -0.07, -0.40, 0.40, -0.17, -0.16, -0.08, -0.36, 0.36, TOP + 0.03,
                         'sst_gold', bevel=0.008))
    # raked side blades
    for s in (1, -1):
        loc = (0.0, 0.40 * s, TOP)
        pcs.append(blade(f'Blade{s}', -0.08, 0.3, -0.08, 0.12, 0.02, loc, 0, 'sst_gold_dark', tilt=-24 * s))
        pcs.append(gold_edge(f'BladeEdge{s}', 0.3, -0.08, 0.12, loc, 0, tilt=-24 * s))
    pcs.append(K.lamp('Lamp', (0.38, -0.2 if lvl < 2 else 0.0, TOP + 0.03), ct['light'], r=0.024))
    # hexagonal nozzle with a gold lip
    pcs.append(G.cyl('Mount', 0.26, 0.10, 'sst_lacquer', loc=(-0.20, 0, ax), axis='X', verts=6))
    prof = [(0.0, 0.19), (-0.20, 0.30), (-0.215, 0.318), (-0.205, 0.336), (0.0, 0.255)]
    pcs.append(G.lathe('Bell', prof, [1, 2, 2, 0, 0], ['sst_graphite', 'nozzle_in', 'sst_gold'],
                       loc=(K.ENGINE_BELL_X, 0, ax), axis='X', verts=6, smooth=False, rot=(30, 0, 0)))
    rings = ((-0.34, 0.316, 0.282),) if lvl < 2 else ((-0.30, 0.302, 0.272), (-0.39, 0.326, 0.292))
    for i, (x, ro, ri) in enumerate(rings):
        r = G.ring_band(f'Glow{i}', ro, ri, -0.012, 0.012, ct['role_glow'], loc=(x, 0, ax), axis='X', verts=6,
                        smooth=False)
        pcs.append(r)
    pcs.append(G.cyl('Core', 0.19, 0.02, 'cruise_core', loc=(-0.255, 0, ax), axis='X', verts=6))
    pcs.append(G.cyl('CoreCone', 0.0, 0.10, ct['role_glow'], loc=(-0.31, 0, ax), axis='X', verts=6, r2=0.13,
                     caps=False))
    return K.finish(pcs, f'Engine_{ct["tier"].capitalize()}_SlantedStar', atlas)


def cannon(ct, lvl, rng, atlas):
    pcs = hull(ct, cut=-0.12)
    pcs.append(G.ring_band('Swivel', 0.32, 0.27, TOP - 0.01, TOP + 0.045, 'sst_graphite', verts=12, top_mat='sst_lacquer'))
    pcs.append(G.cyl('Well', 0.27, 0.03, 'char_black', loc=(0, 0, TOP + 0.005), verts=12))
    for i, a in enumerate((-90, -45, 0, 45, 90)):
        r = math.radians(a)
        b = G.box(f'Tick{i}', -0.024, 0.024, -0.008, 0.008, TOP + 0.012, TOP + 0.022, ct['light'] if a == 0 else 'sst_gold')
        G.transform(b, loc=(0.385 * math.cos(r), 0.385 * math.sin(r), 0), rot=(0, 0, a + 20))
        pcs.append(b)
    root = K.finish(pcs, f'Cannon_{ct["tier"].capitalize()}_SlantedStar', atlas)

    bz = K.CANNON_BARREL_Z
    tp = [G.cyl('TurretBase', 0.24, 0.05, 'sst_graphite', loc=(0, 0, 0.02), verts=12)]
    tp.append(K.convex('Wedge', [(-0.24, -0.15, 0.04), (-0.24, 0.15, 0.04), (0.14, -0.08, 0.04), (0.14, 0.08, 0.04),
                                 (-0.2, -0.09, 0.19), (-0.2, 0.09, 0.19), (0.08, -0.04, 0.17), (0.08, 0.04, 0.17)],
                       'sst_lacquer', bevel=0.006))
    # dorsal raked blade (slanted) with a gold edge
    tp.append(blade('Dorsal', -0.24, -0.02, -0.25, 0.14, 0.02, (0.0, 0.0, 0.18), 0, 'sst_graphite', tilt=-22))
    tp.append(gold_edge('DorsalEdge', -0.02, -0.25, 0.14, (0.0, 0.0, 0.18), 0, tilt=-22))
    # long rail barrel: core + twin gold rails + yellow coil
    tp.append(G.cyl('Barrel', 0.03, 0.36, 'sst_graphite', loc=(0.28, 0, bz), axis='X', verts=8))
    for s in (1, -1):
        tp.append(G.box(f'Rail{s}', 0.08, 0.46, 0.032 * s - 0.012, 0.032 * s + 0.012, bz - 0.022, bz + 0.022, 'sst_gold'))
    tp.append(G.ring_band('Coil', 0.05, 0.03, -0.012, 0.012, ct['role_glow'], loc=(0.2, 0, bz), axis='X', verts=8))
    tp.append(K.lamp('Sight', (-0.12, -0.08, 0.2), ct['light'], r=0.018, h=0.02))
    if lvl >= 2:
        for i, x in enumerate((0.3, 0.38)):
            tp.append(G.ring_band(f'Coil2{i}', 0.05, 0.03, -0.01, 0.01, ct['role_glow'], loc=(x, 0, bz), axis='X',
                                  verts=8))
        for s in (1, -1):
            tp.append(blade(f'Side{s}', -0.22, 0.0, -0.22, 0.08, 0.016, (0.0, 0.12 * s, 0.1), 0, 'sst_gold_dark',
                            tilt=-50 * s))
    turret = K.child(tp, 'Cannon_Turret', atlas, root, (0, 0, K.CANNON_HEAD_Z))
    m = G.empty('Cannon_Muzzle', loc=(K.CANNON_MUZZLE_X, 0, bz))
    m.parent = turret
    return root


def armor(ct, lvl, rng, atlas):
    pcs = K.hull(ct)
    # two slanted wedge plates forming a sheared chevron, gold slash between them
    a, b, y0, y1 = -0.4, 0.4, -0.4, 0.4

    def sx(y):
        return 0.02 + SL * y
    gap = 0.035
    left = [(a, y0), (sx(y0) - gap, y0), (sx(y1) - gap, y1), (a, y1)]
    right = [(sx(y0) + gap, y0), (b, y0), (b, y1), (sx(y1) + gap, y1)]
    pcs.append(K.convex('WedgeL', [(x, y, TOP - 0.004) for x, y in left] +
                        [(x + 0.03, y * 0.94, TOP + 0.05) for x, y in left[1:3]] +
                        [(x + 0.03, y * 0.94, TOP + 0.02) for x, y in (left[0], left[3])], 'sst_graphite', bevel=0.006))
    pcs.append(K.convex('WedgeR', [(x, y, TOP - 0.004) for x, y in right] +
                        [(x - 0.03, y * 0.94, TOP + 0.05) for x, y in right[:1] + right[3:]] +
                        [(x - 0.03, y * 0.94, TOP + 0.025) for x, y in right[1:3]], 'sst_lacquer', bevel=0.006))
    inlay = [(sx(y0) - gap * 0.5, y0 + 0.01), (sx(y0) + gap * 0.5, y0 + 0.01), (sx(y1) + gap * 0.5, y1 - 0.01),
             (sx(y1) - gap * 0.5, y1 - 0.01)]
    pcs.append(K.poly('SlashGold', inlay, TOP - 0.004, TOP + 0.03, 'sst_gold'))
    # small gold corner slashes
    for i, (cx, cy) in enumerate(((0.33, 0.36), (-0.33, -0.36))):
        pcs.append(K.poly(f'Nick{i}', [(cx - 0.06, cy - 0.012), (cx + 0.03, cy - 0.012), (cx + 0.06, cy + 0.012),
                                       (cx - 0.03, cy + 0.012)], TOP + 0.004, TOP + 0.03, 'sst_gold'))
    if lvl >= 2:
        g = [(sx(y0) - 0.006 + 0.07, y0 + 0.05), (sx(y0) + 0.006 + 0.07, y0 + 0.05), (sx(y1) + 0.006 + 0.07, y1 - 0.05),
             (sx(y1) - 0.006 + 0.07, y1 - 0.05)]
        pcs.append(K.poly('GlowSlash', g, TOP + 0.02, TOP + 0.05, ct['role_glow']))
        pcs.append(K.star4('Star', 0.07, 0.024, TOP + 0.02, TOP + 0.045, 'sst_gold', loc=(-0.25, 0.14, 0.0)))
    return K.finish(pcs, f'Armor_{ct["tier"].capitalize()}_SlantedStar', atlas)


def shield_generator(ct, lvl, rng, atlas):
    pcs = hull(ct, panel=False)
    plinth = [(0.34 * math.cos(math.radians(22.5 + 45 * i)), 0.34 * math.sin(math.radians(22.5 + 45 * i)))
              for i in range(8)]
    pcs.append(K.poly('Plinth', plinth, TOP - 0.01, TOP + 0.05, 'sst_graphite', bevel=0.01))
    pcs.append(G.ring_band('PlinthGlow', 0.27, 0.23, TOP + 0.045, TOP + 0.058, ct['role_glow'], verts=16))
    pcs.append(G.cyl('Socket', 0.1, 0.06, 'sst_lacquer', loc=(0, 0, TOP + 0.08), verts=8))
    # four pinwheel blades leaning over the core - a slanted star seen from above
    for i in range(4):
        a = 45 + 90 * i
        ar = math.radians(a)
        loc = (0.33 * math.cos(ar), 0.33 * math.sin(ar), TOP + 0.03)
        yaw = a + 90 + 25          # blade plane tangential, skewed 25 deg (pinwheel)
        from mathutils import Matrix
        for nm, prof, th, mat in ((f'Blade{i}', [(-0.06, 0.0), (0.06, 0.0), (0.01, 0.36), (-0.05, 0.36)], 0.022,
                                   'sst_lacquer'),
                                  (f'BladeEdge{i}', [(0.045, 0.0), (0.075, 0.0), (0.025, 0.37), (0.0, 0.36)], 0.03,
                                   'sst_gold')):
            f = K.fin(nm, prof, th, loc, yaw, mat)
            # lean the blade toward the centre
            f.data.transform(Matrix.Rotation(math.radians(-16), 4, 'X'))
            pcs.append(f)
        pcs.append(K.lamp(f'Tip{i}', (0.3 * math.cos(ar), 0.3 * math.sin(ar), TOP + 0.38), ct['light'], r=0.022,
                          h=0.02))
        foot = G.box(f'Foot{i}', -0.06, 0.06, -0.035, 0.035, TOP - 0.01, TOP + 0.06, 'sst_gold', bevel=0.006, seg=1)
        G.transform(foot, loc=(0.33 * math.cos(ar), 0.33 * math.sin(ar), 0), rot=(0, 0, yaw))
        pcs.append(foot)
    root = K.finish(pcs, f'ShieldGenerator_{ct["tier"].capitalize()}_SlantedStar', atlas)

    ep = [G.ellipsoid('Core', 0.1, 0.1, 0.12, ct['glass'], seg=10, rings=7),
          K.star4('Star', 0.23, 0.07, -0.025, 0.025, 'sst_gold', shear=0.3)]
    if lvl >= 2:
        ep.append(K.star4('Star2', 0.15, 0.05, 0.03, 0.05, ct['role_glow'], shear=0.3, rot=45))
    K.child(ep, 'Shield_Emitter', atlas, root, (0, 0, K.SHIELD_EMITTER_Z))
    return root


def reactor(ct, lvl, rng, atlas):
    pcs = hull(ct, panel=False)
    pcs.append(G.ring_band('BaseRing', 0.33, 0.12, TOP - 0.01, TOP + 0.06, 'sst_graphite', verts=6,
                           top_mat='sst_lacquer'))
    pcs.append(G.ring_band('BaseGlow', 0.27, 0.2, TOP + 0.055, TOP + 0.068, ct['role_glow'], verts=6))
    # tilted glowing hex core inside two crossing gold arches
    core = G.cyl('Core', 0.11, 0.42, ct['role_glow'], verts=6)
    from mathutils import Matrix, Vector
    q = Vector((0, 0, 1)).rotation_difference(Vector((0.32, 0.0, 1.0)).normalized())
    core.matrix_world = Matrix.Translation((0.0, 0.0, TOP + 0.25)) @ q.to_matrix().to_4x4()
    pcs.append(core)
    for i, z in enumerate((0.33, 0.45)):
        band = G.ring_band(f'Band{i}', 0.135, 0.105, -0.016, 0.016, 'sst_gold', verts=6)
        band.matrix_world = Matrix.Translation((0.32 * (z - TOP - 0.25) / 1.0, 0.0, z)) @ q.to_matrix().to_4x4()
        pcs.append(band)
    for s in (1, -1):
        pcs.append(K.bar(f'ArchA{s}', (-0.3, 0.26 * s, TOP + 0.02), (0.0, 0.16 * s, 0.6), 0.02, 'sst_gold'))
        pcs.append(K.bar(f'ArchB{s}', (0.0, 0.16 * s, 0.6), (0.3, 0.26 * s, TOP + 0.02), 0.02, 'sst_lacquer'))
    pcs.append(K.star4('Cap', 0.1, 0.035, 0.595, 0.615, 'sst_gold', loc=(0.0, 0.0, 0.0)))
    for i, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        x, y = sx * 0.39, sy * 0.39
        pcs.append(K.poly(f'Corner{i}', [(x - 0.06, y - 0.03), (x + 0.03, y - 0.03), (x + 0.06, y + 0.03),
                                         (x - 0.03, y + 0.03)], TOP - 0.004, TOP + 0.04, 'sst_graphite', bevel=0.004))
        if lvl >= 2 or i % 2 == 0:
            pcs.append(K.poly(f'CornerGlow{i}', [(x - 0.04, y - 0.01), (x + 0.02, y - 0.01), (x + 0.04, y + 0.01),
                                                 (x - 0.02, y + 0.01)], TOP + 0.04, TOP + 0.05, ct['role_glow']))
    return K.finish(pcs, f'Reactor_{ct["tier"].capitalize()}_SlantedStar', atlas)


def gyroscope(ct, lvl, rng, atlas):
    pcs = hull(ct, panel=False)
    pcs.append(G.ring_band('Collar', 0.37, 0.31, TOP - 0.02, TOP + 0.05, 'sst_graphite', verts=24, top_mat='sst_lacquer'))
    pcs.append(G.cyl('WellFloor', 0.315, 0.04, 'char_black', loc=(0, 0, TOP - 0.005), verts=24))
    pcs.append(G.ring_band('WellGlow', 0.27, 0.23, TOP + 0.012, TOP + 0.022, ct['role_glow'], verts=24))
    for i, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        cx, cy = sx * 0.4, sy * 0.4
        pcs.append(K.poly(f'Slash{i}', [(cx - 0.07, cy - 0.014), (cx + 0.03, cy - 0.014), (cx + 0.07, cy + 0.014),
                                        (cx - 0.03, cy + 0.014)], TOP - 0.004, TOP + 0.025, 'sst_gold'))
    pcs.append(G.cyl('Axle', 0.045, 0.06, 'sst_gold', loc=(0, 0, TOP + 0.03), verts=8))
    pcs.append(G.ellipsoid('CoreOrb', 0.075, 0.075, 0.075, ct['role_glow'], loc=(0, 0, K.GYRO_RING_Z), seg=10, rings=6))
    root = K.finish(pcs, f'Gyroscope_{ct["tier"].capitalize()}_SlantedStar', atlas)

    outer = [G.torus('RingO', 0.285, 0.018, 'sst_gold', rot=(90, 0, 0), maj=24, mnr=4)]
    for i, a in enumerate((0, 180)):
        r = math.radians(a)
        # thin raked blade fins on the ring (in the ring plane)
        f = K.poly(f'RingBlade{i}', [(-0.02, -0.07), (0.03, -0.07), (0.1, 0.06), (0.05, 0.06)], -0.01, 0.01,
                   'sst_lacquer')
        G.transform(f, loc=(0.29 * math.cos(r), 0, 0.29 * math.sin(r)), rot=(90, 0 if i == 0 else 180, 0))
        outer.append(f)
    for i, z in enumerate((0.285, -0.285)):
        outer.append(G.cyl(f'Hub{i}', 0.03, 0.05, 'sst_lacquer', loc=(0, 0, z), verts=8))
    if lvl >= 2:
        outer.append(G.torus('RingOGlow', 0.285, 0.008, ct['role_glow'], loc=(0, 0.017, 0), rot=(90, 0, 0), maj=24,
                             mnr=3))
    ring_o = K.child(outer, 'Gyro_Ring_Outer', atlas, root, (0, 0, K.GYRO_RING_Z))
    inner = [G.torus('RingI', 0.2, 0.016, 'sst_graphite', maj=20, mnr=4),
             G.torus('RingIGlow', 0.18, 0.007, ct['role_glow'], maj=20, mnr=3)]
    for i, x in enumerate((0.235, -0.235)):
        inner.append(G.cyl(f'RingIHub{i}', 0.026, 0.08, 'sst_gold', loc=(x, 0, 0), axis='X', verts=8))
    K.child(inner, 'Gyro_Ring_Inner', atlas, ring_o, (0, 0, 0))
    return root


def fuel_tank(ct, lvl, rng, atlas):
    pcs = hull(ct, panel=False)
    # one long tank laid along the cell diagonal (the slant), gold bands, glow window
    R, L = 0.135, 0.28
    z = TOP + 0.04 + R
    yaw = 45
    pcs.append(K.capsule('Tank', L, R, ('sst_lacquer', 'sst_graphite'), (0, 0, z), axis_rot=yaw, verts=12, n=4))
    ca, sa = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    for i, t in enumerate((-0.2, 0.0, 0.2)):
        band = G.ring_band(f'Band{i}', R + 0.012, R - 0.01, -0.016, 0.016, 'sst_gold', axis='X', verts=12)
        G.transform(band, loc=(t * ca, t * sa, z), rot=(0, 0, yaw))
        pcs.append(band)
    win = G.box('Window', -0.15, 0.15, -0.02, 0.02, R - 0.02, R + 0.008, ct['role_glow'] if lvl >= 2 else 'sst_glass')
    G.transform(win, loc=(0, 0, z), rot=(0, 0, yaw))
    pcs.append(win)
    for i, t in enumerate((-0.18, 0.18)):
        sad = G.box(f'Saddle{i}', -0.04, 0.04, -0.13, 0.13, TOP - 0.01, z - 0.06, 'sst_graphite', bevel=0.008, seg=1)
        G.transform(sad, loc=(t * ca, t * sa, 0), rot=(0, 0, yaw))
        pcs.append(sad)
    # small spherical tanks in the free corners
    for i, (sx, sy) in enumerate(((1, -1), (-1, 1))):
        pcs.append(G.ellipsoid(f'Sphere{i}', 0.1, 0.1, 0.1, 'sst_graphite', loc=(sx * 0.28, sy * 0.28, TOP + 0.1),
                               seg=10, rings=6))
        pcs.append(G.ring_band(f'SphereBand{i}', 0.108, 0.09, -0.012, 0.012, 'sst_gold',
                               loc=(sx * 0.28, sy * 0.28, TOP + 0.1), verts=10))
    pcs.append(K.lamp('Lamp', (0.38, 0.38, TOP + 0.02), ct['light'], r=0.024))
    if lvl >= 2:
        fin_ = blade('Fin', -0.14, 0.1, -0.16, 0.1, 0.016, (0, 0, z + R - 0.02), yaw, 'sst_gold_dark')
        pcs.append(fin_)
    return K.finish(pcs, f'FuelTank_{ct["tier"].capitalize()}_SlantedStar', atlas)


def cargo(ct, lvl, rng, atlas):
    pcs = K.hull(ct)
    # parallelogram container with slanted, gold-capped ends and a raked blade on top
    para = [(-0.38, -0.33), (0.2, -0.33), (0.38, 0.33), (-0.2, 0.33)]
    z1 = TOP + 0.22
    pcs.append(K.poly('Box', para, TOP - 0.005, z1, 'sst_lacquer', bevel=0.012))
    lid = [(-0.3, -0.27), (0.16, -0.27), (0.3, 0.27), (-0.16, 0.27)]
    pcs.append(K.poly('Lid', lid, z1 - 0.004, z1 + 0.02, 'sst_graphite', bevel=0.006))
    for k, (pa, pb) in enumerate(((para[0], para[3]), (para[1], para[2]))):
        d = 0.03 if k else -0.03
        cap = [(pa[0], pa[1]), (pa[0] + d, pa[1]), (pb[0] + d, pb[1]), (pb[0], pb[1])]
        pcs.append(K.poly(f'EndCap{k}', cap, TOP + 0.02, z1 + 0.012, 'sst_gold', bevel=0.004))
    pcs.append(K.poly('Stripe', [(-0.04, -0.27), (0.03, -0.27), (0.17, 0.27), (0.1, 0.27)], z1 + 0.014, z1 + 0.028,
                      'sst_gold'))
    pcs.append(K.star4('Star', 0.075, 0.025, z1 + 0.016, z1 + 0.03, 'sst_gold', loc=(-0.17, -0.1, 0.0)))
    pcs.append(K.poly('LightStrip', [(0.12, -0.27), (0.15, -0.27), (0.29, 0.27), (0.26, 0.27)], z1 + 0.014,
                      z1 + 0.026, ct['role_glow']))
    for s_ in (1, -1):
        xa, xb = (-0.14, 0.32) if s_ > 0 else (-0.32, 0.14)
        pcs.append(K.poly(f'Rib{s_}', [(xa, 0.326 * s_), (xb, 0.326 * s_), (xb, 0.342 * s_), (xa, 0.342 * s_)],
                          TOP + 0.1, TOP + 0.13, 'sst_gold_dark'))
    if lvl >= 2:
        pcs.append(blade('Blade', -0.1, 0.16, -0.12, 0.1, 0.016, (0.0, 0.0, z1 + 0.02), 28, 'sst_gold_dark'))
        for i, (x, y) in enumerate(((0.33, 0.3), (-0.33, -0.3))):
            pcs.append(K.spike(f'CornerBlade{i}', (x, y, z1 - 0.02), (math.copysign(0.4, x), 0, 1), 0.08, 0.02,
                               'sst_gold'))
    pcs.append(K.lamp('Lamp', (0.4, -0.38, TOP + 0.02), ct['light'], r=0.024))
    return K.finish(pcs, f'Cargo_{ct["tier"].capitalize()}_SlantedStar', atlas)


def tractor_beam(ct, lvl, rng, atlas):
    pcs = hull(ct, cut=-0.12)
    pcs.append(G.ring_band('Swivel', 0.33, 0.28, TOP - 0.01, TOP + 0.045, 'sst_graphite', verts=12, top_mat='sst_lacquer'))
    pcs.append(G.cyl('Well', 0.28, 0.03, 'char_black', loc=(0, 0, TOP + 0.005), verts=12))
    pcs.append(G.box('FrontTick', 0.37, 0.43, -0.01, 0.01, TOP + 0.012, TOP + 0.022, ct['light']))
    root = K.finish(pcs, f'TractorBeam_{ct["tier"].capitalize()}_SlantedStar', atlas)

    az = K.TRACTOR_AXIS_Z
    hp = [G.cyl('HeadBase', 0.25, 0.05, 'sst_graphite', loc=(0, 0, 0.02), verts=12)]
    hp.append(K.convex('Housing', [(-0.27, -0.14, 0.04), (-0.27, 0.14, 0.04), (0.06, -0.1, 0.04), (0.06, 0.1, 0.04),
                                   (-0.22, -0.08, az + 0.12), (-0.22, 0.08, az + 0.12), (0.02, -0.06, az + 0.06),
                                   (0.02, 0.06, az + 0.06)], 'sst_lacquer', bevel=0.006))
    hp.append(G.cyl('Spindle', 0.04, 0.3, 'sst_graphite', loc=(0.18, 0, az), axis='X', verts=8))
    # forked emitter: two raked gold prongs either side of the lens
    for s in (1, -1):
        hp.append(K.bar(f'Prong{s}', (-0.02, 0.1 * s, az + 0.02), (0.44, 0.075 * s, az + 0.07), 0.02, 'sst_gold',
                        hh=0.03))
        hp.append(K.spike(f'ProngTip{s}', (0.44, 0.075 * s, az + 0.07), (1, -0.4 * s, 0.1), 0.04, 0.018, 'sst_gold'))
    for i, x in enumerate((0.15, 0.24)):
        hp.append(G.torus(f'Coil{i}', 0.07, 0.014, ct['role_glow'] if i == 1 or lvl >= 2 else 'sst_graphite',
                          loc=(x, 0, az), rot=(0, 90, 0), maj=10, mnr=4))
    hp.append(G.ellipsoid('Lens', 0.03, 0.07, 0.07, ct['glass'], seg=10, rings=6))
    hp[-1].location = (0.31, 0, az)
    hp.append(G.ellipsoid('LensCore', 0.02, 0.033, 0.033, ct['role_glow'], seg=8, rings=5))
    hp[-1].location = (0.335, 0, az)
    hp.append(K.star4('Star', 0.06, 0.02, az + 0.118, az + 0.13, 'sst_gold', loc=(-0.14, 0.0, 0.0)))
    if lvl >= 2:
        for s in (1, -1):
            hp.append(blade(f'Fin{s}', -0.26, -0.06, -0.27, 0.08, 0.014, (0.0, 0.12 * s, 0.12), 0, 'sst_gold_dark',
                            tilt=-40 * s))
    head = K.child(hp, 'Tractor_Head', atlas, root, (0, 0, K.TRACTOR_HEAD_Z))
    tip = G.empty('Tractor_Emitter', loc=(K.TRACTOR_EMITTER_X, 0, az))
    tip.parent = head
    return root


BUILDERS = {'cockpit': cockpit, 'engine': engine, 'cannon': cannon, 'armor': armor,
            'shield_generator': shield_generator, 'reactor': reactor, 'gyroscope': gyroscope,
            'fuel_tank': fuel_tank, 'cargo': cargo, 'tractor_beam': tractor_beam}
