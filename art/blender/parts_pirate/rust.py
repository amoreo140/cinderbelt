"""Rust (rust clan) part set - welded scrap, rust patches, spikes and teeth, red lights.

Hull: gunmetal deck under mismatched welded plates (worn plate / fresh rust), weld beads,
rivets; red running lights (pir_glow_red). T2 = salvaged polished titanium plates
(ti_polished) + more spikes + the red glow line on the core sides.
"""
import math

from lib import geo as G
from parts_pirate import kit as K

TOP = K.TOP
PH = K.PH
SCRAP = ('pir_plate_worn', 'pir_rust_patch', 'pir_gunmetal', 'pir_plate_worn')


def scrap_deck(ct, rng, n=2, spots=None, x0=-K.HALF, big=False):
    """Welded scrap plates on the deck corners (+ a weld bead and rivets each)."""
    pcs = []
    spots = list(spots or [(0.27, 0.27), (-0.27, 0.27), (-0.27, -0.27), (0.27, -0.27)])
    rng.shuffle(spots)
    for i, (cx, cy) in enumerate(spots[:n]):
        if x0 > -K.HALF and cx < x0 + 0.15:
            cx = x0 + 0.17
        w, h = (rng.uniform(0.26, 0.36), rng.uniform(0.22, 0.32)) if big else \
               (rng.uniform(0.18, 0.28), rng.uniform(0.16, 0.24))
        ang = rng.uniform(-14, 14)
        mat = SCRAP[(i + rng.randrange(2)) % len(SCRAP)]
        z0 = TOP - 0.004
        z1 = TOP + rng.uniform(0.012, 0.024)
        pcs.append(K.scrap_plate(f'Scrap{i}', cx, cy, w, h, ang, z0, z1, mat, rng))
        # weld bead along the inner edge + two rivets
        a = math.radians(ang)
        ex, ey = -math.copysign(1, cx) * w * 0.42, 0.0
        p0 = (cx + ex * math.cos(a) - (-h / 2) * math.sin(a), cy + ex * math.sin(a) + (-h / 2) * math.cos(a), z1)
        p1 = (cx + ex * math.cos(a) - (h / 2) * math.sin(a), cy + ex * math.sin(a) + (h / 2) * math.cos(a), z1)
        pcs.append(K.bar(f'Weld{i}', p0, p1, 0.011, 'pir_weld', hh=0.008))
        pcs += K.rivets(f'Riv{i}_', [(cx + math.copysign(w * 0.32, cx), cy + math.copysign(h * 0.3, cy)),
                                    (cx + math.copysign(w * 0.32, cx), cy - math.copysign(h * 0.3, cy))],
                        z1 + 0.004, 'metal_bare', r=0.013)
    return pcs


def t2_plate(name, cx, cy, w, h, ang, z, rng):
    """Salvaged polished titanium patch (the T2 cue of the rust set)."""
    return K.scrap_plate(name, cx, cy, w, h, ang, z - 0.004, z + 0.018, 'ti_polished', rng, jit=0.015)


def toothed_ring(name, r_out, r_in, z0, z1, n_teeth, mat, tooth_mat):
    pcs = [G.ring_band(name, r_out, r_in, z0, z1, mat, verts=12)]
    for i in range(n_teeth):
        a = 2 * math.pi * (i + 0.5) / n_teeth
        b = G.box(f'{name}T{i}', -0.026, 0.026, -0.02, 0.02, z0 + 0.005, z1 - 0.004, tooth_mat)
        G.transform(b, loc=(r_out * math.cos(a), r_out * math.sin(a), 0), rot=(0, 0, math.degrees(a)))
        pcs.append(b)
    return pcs


# ---------------------------------------------------------------------------
def cockpit(ct, lvl, rng, atlas):
    pcs = K.hull(ct, deck=False)
    h = PH
    fair = [(-h, -h + 0.03), (-h + 0.03, -h), (0.14, -h), (h, -0.14), (h, 0.14), (0.14, h),
            (-h + 0.03, h), (-h, h - 0.03)]
    pcs.append(K.poly('Fairing', fair, 0.06, TOP, 'pir_gunmetal', bevel=0.012))
    pcs += scrap_deck(ct, rng, 2, spots=[(-0.31, 0.31), (-0.31, -0.31)])
    # angular armour hump with a T-slit visor (the Rust helmet)
    bx0, bx1, tx0, tx1, zt = -0.40, 0.21, -0.32, 0.03, TOP + 0.21
    pcs.append(K.convex('Hump', [(bx0, -0.2, TOP), (bx0, 0.2, TOP), (bx1, -0.22, TOP), (bx1, 0.22, TOP),
                                 (bx1 - 0.05, -0.24, TOP + 0.06), (bx1 - 0.05, 0.24, TOP + 0.06),
                                 (tx0, -0.11, zt), (tx0, 0.11, zt), (tx1, -0.1, zt), (tx1, 0.1, zt),
                                 (bx0, -0.16, TOP + 0.13), (bx0, 0.16, TOP + 0.13)],
                        'pir_plate_worn', bevel=0.01))
    # visor: on the front slope from (bx1, TOP) to (tx1, zt)
    fx, fz = bx1 - tx1, zt - TOP
    n = (fz / math.hypot(fx, fz), fx / math.hypot(fx, fz))   # outward normal (x, z)

    def on_face(t, y, off):
        return (bx1 - fx * t + n[0] * off, y, TOP + fz * t + n[1] * off)

    def slit(name, t0, t1, hw):
        pts = [on_face(t, y, o) for t in (t0, t1) for y in (-hw, hw) for o in (-0.01, 0.014)]
        return K.convex(name, pts, ct['glass'])
    pcs.append(slit('VisorH', 0.56, 0.74, 0.1))
    pcs.append(slit('VisorV', 0.2, 0.6, 0.026))
    # horns raked back off the hump
    for s in (1, -1):
        pcs.append(K.spike(f'Horn{s}', (-0.22, 0.09 * s, zt - 0.02), (-0.75, 0.45 * s, 0.6), 0.2, 0.034,
                           'pir_gunmetal_dark'))
    # jaw: teeth on the nose
    for i, y in enumerate((-0.1, -0.035, 0.035, 0.1)):
        pcs.append(K.spike(f'Tooth{i}', (0.33, y, TOP + 0.012), (1, 0, 0.18), 0.13 - 0.03 * (abs(y) > 0.05),
                           0.03, 'metal_bare'))
    pcs.append(K.poly('JawPlate', [(0.24, -0.15), (0.38, -0.13), (0.38, 0.13), (0.24, 0.15)], TOP - 0.004,
                      TOP + 0.016, 'pir_rust', bevel=0.004))
    # claw scratches on the fairing shoulder (clan mark)
    for i in range(3):
        b = G.box(f'Claw{i}', -0.09, 0.09, -0.008, 0.008, TOP - 0.004, TOP + 0.006, 'pir_rust')
        G.transform(b, loc=(-0.06 + 0.05 * i, 0.33, 0), rot=(0, 0, 58))
        pcs.append(b)
    # red running lights + antenna
    for s in (1, -1):
        pcs.append(K.lamp(f'Nav{s}', (-0.12, 0.235 * s, TOP + 0.075), ct['light'], r=0.026))
    pcs.append(G.cyl('Antenna', 0.011, 0.2, 'metal_bare', loc=(-0.36, -0.06, TOP + 0.22), verts=5))
    pcs.append(K.lamp('AntennaTip', (-0.36, -0.06, TOP + 0.33), ct['light'], r=0.022))
    if lvl >= 2:
        for s in (1, -1):
            pcs.append(K.convex(f'Cheek{s}', [(-0.3, 0.2 * s, TOP), (0.12, 0.23 * s, TOP),
                                             (-0.26, 0.27 * s, TOP + 0.02), (0.08, 0.29 * s, TOP + 0.02),
                                             (-0.26, 0.2 * s, TOP + 0.12), (0.05, 0.215 * s, TOP + 0.09)],
                                'ti_polished', bevel=0.006))
            pcs.append(K.spike(f'Horn2{s}', (-0.05, 0.12 * s, zt - 0.03), (-0.5, 0.6 * s, 0.6), 0.13, 0.026,
                               'pir_gunmetal_dark'))
        pcs.append(G.box('VisorGlow', 0.2, 0.25, -0.12, 0.12, TOP + 0.0, TOP + 0.03, ct['role_glow']))
    return K.finish(pcs, f'Cockpit_{ct["tier"].capitalize()}_Rust', atlas)


def engine(ct, lvl, rng, atlas):
    ax = K.ENGINE_AXIS_Z
    pcs = K.hull(ct, x0=K.ENGINE_CORE_X0)
    pcs += scrap_deck(ct, rng, 1, spots=[(0.27, 0.25), (0.27, -0.25)], x0=K.ENGINE_CORE_X0)
    # intake maw with teeth bars
    pcs.append(G.box('Maw', 0.04, 0.34, -0.2, 0.2, TOP - 0.01, TOP + 0.012, 'char_black', bevel=0.008, seg=1))
    for i, y in enumerate((-0.15, -0.075, 0.0, 0.075, 0.15)):
        pcs.append(K.spike(f'MawTooth{i}', (0.19, y, TOP + 0.004), (0, 0, 1), 0.06, 0.028, 'metal_bare',
                           sides=4))
    # jagged rusty collar
    pcs.append(K.convex('Collar', [(-0.17, -0.4, -0.17), (-0.17, 0.4, -0.17), (-0.07, -0.4, -0.17),
                                   (-0.07, 0.4, -0.17), (-0.17, -0.36, TOP + 0.03), (-0.07, -0.4, TOP + 0.0),
                                   (-0.17, 0.4, TOP + 0.01), (-0.07, 0.34, TOP + 0.04)], 'pir_rust', bevel=0.01))
    pcs.append(K.lamp('Lamp', (-0.12, 0.0, TOP + 0.045), ct['light'], r=0.028))
    if lvl >= 2:
        for s in (1, -1):
            saw = [(0.38, 0.0), (0.38, 0.03), (0.3, 0.08), (0.24, 0.05), (0.16, 0.12), (0.1, 0.08),
                   (0.02, 0.15), (-0.06, 0.15), (-0.06, 0.0)]
            pcs.append(K.fin(f'Saw{s}', saw, 0.026, (0, 0.40 * s, TOP), 0, 'pir_gunmetal_dark'))
        pcs.append(t2_plate('TiPatch', 0.24, -0.27, 0.18, 0.14, 8, TOP + 0.006, rng))
    # crude octagonal bell
    pcs.append(G.cyl('Mount', 0.27, 0.10, 'pir_gunmetal_dark', loc=(-0.20, 0, ax), axis='X', verts=8))
    prof = [(0.0, 0.19), (-0.20, 0.30), (-0.215, 0.318), (-0.205, 0.336), (0.0, 0.27)]
    pcs.append(G.lathe('Bell', prof, [1, 2, 2, 0, 0], ['pir_gunmetal_dark', 'nozzle_in', 'pir_rust_dark'],
                       loc=(K.ENGINE_BELL_X, 0, ax), axis='X', verts=8, smooth=False))
    rings = ((-0.34, 0.316, 0.28),) if lvl < 2 else ((-0.30, 0.302, 0.27), (-0.39, 0.326, 0.29))
    for i, (x, ro, ri) in enumerate(rings):
        pcs.append(G.ring_band(f'Glow{i}', ro, ri, -0.013, 0.013, ct['role_glow'], loc=(x, 0, ax), axis='X',
                               verts=8, smooth=False))
    # welded teeth on the lip
    for i in range(8):
        a = 2 * math.pi * (i + 0.5) / 8
        d = (0.0, math.cos(a), math.sin(a))
        pcs.append(K.spike(f'LipTooth{i}', (-0.43, 0.3 * d[1], ax + 0.3 * d[2]), (-0.8, 0.6 * d[1], 0.6 * d[2]),
                           0.07, 0.024, 'pir_gunmetal'))
    pcs.append(G.cyl('Core', 0.19, 0.02, 'light_red', loc=(-0.255, 0, ax), axis='X', verts=8))
    pcs.append(G.cyl('CoreCone', 0.0, 0.10, ct['role_glow'], loc=(-0.31, 0, ax), axis='X', verts=8, r2=0.13,
                     caps=False))
    return K.finish(pcs, f'Engine_{ct["tier"].capitalize()}_Rust', atlas)


def cannon(ct, lvl, rng, atlas):
    pcs = K.hull(ct)
    pcs += scrap_deck(ct, rng, 2)
    pcs += toothed_ring('Swivel', 0.33, 0.26, TOP - 0.01, TOP + 0.05, 10, 'pir_gunmetal_dark', 'pir_weld')
    pcs.append(G.cyl('Well', 0.265, 0.03, 'char_black', loc=(0, 0, TOP + 0.005), verts=12))
    pcs.append(G.box('FrontTick', 0.37, 0.43, -0.012, 0.012, TOP - 0.004, TOP + 0.008, ct['light']))
    root = K.finish(pcs, f'Cannon_{ct["tier"].capitalize()}_Rust', atlas)

    bz = K.CANNON_BARREL_Z
    tp = [G.cyl('TurretBase', 0.245, 0.05, 'pir_gunmetal_dark', loc=(0, 0, 0.02), verts=10)]
    tp.append(K.convex('Housing', [(-0.24, -0.17, 0.04), (-0.24, 0.15, 0.04), (0.06, -0.17, 0.04),
                                   (0.06, 0.17, 0.04), (0.12, -0.07, 0.04), (0.12, 0.08, 0.04),
                                   (-0.19, -0.12, 0.22), (-0.2, 0.11, 0.21), (0.0, -0.12, 0.22), (0.02, 0.12, 0.2),
                                   (0.07, -0.05, 0.2), (0.07, 0.05, 0.2)], 'pir_plate_worn', bevel=0.01))
    tp.append(K.scrap_plate('RoofPatch', -0.09, 0.03, 0.15, 0.13, 12, 0.205, 0.235, 'pir_rust_patch', rng))
    tp.append(K.convex('Mantlet', [(0.07, -0.13, 0.05), (0.07, 0.13, 0.05), (0.15, -0.11, 0.06),
                                   (0.15, 0.11, 0.06), (0.07, -0.11, 0.22), (0.07, 0.11, 0.22),
                                   (0.13, -0.09, 0.2), (0.13, 0.09, 0.2)], 'pir_gunmetal_dark', bevel=0.006))
    for s in (1, -1):
        tp.append(K.spike(f'MantSpike{s}', (0.11, 0.07 * s, 0.2), (0.6, 0.15 * s, 1), 0.1, 0.025, 'metal_bare'))
    tp.append(G.cyl('Barrel', 0.055, 0.31, 'pir_gunmetal_dark', loc=(0.27, 0, bz), axis='X', verts=8))
    tp.append(G.ring_band('JawRing', 0.075, 0.05, 0.38, 0.42, 'pir_rust', loc=(0, 0, bz), axis='X', verts=8))
    for i in range(4):
        a = math.radians(45 + 90 * i)
        d = (0.0, math.cos(a), math.sin(a))
        tp.append(K.spike(f'Jaw{i}', (0.41, 0.06 * d[1], bz + 0.06 * d[2]), (1, 0.45 * d[1], 0.45 * d[2]),
                          0.075, 0.018, 'metal_bare'))
    tp.append(K.lamp('Sight', (-0.06, -0.08, 0.235), ct['light'], r=0.022))
    tp.append(G.box('Feed', -0.255, -0.235, -0.04, 0.04, 0.08, 0.17, ct['role_glow']))
    if lvl >= 2:
        tp.append(G.cyl('Shroud', 0.068, 0.15, 'ti_polished', loc=(0.24, 0, bz), axis='X', verts=8))
        for i, x in enumerate((0.19, 0.29)):
            tp.append(G.ring_band(f'Coil{i}', 0.078, 0.064, -0.009, 0.009, ct['role_glow'], loc=(x, 0, bz),
                                  axis='X', verts=8))
        for s in (1, -1):
            tp.append(K.spike(f'SideSpike{s}', (-0.08, 0.16 * s, 0.13), (0.2, s, 0.25), 0.1, 0.03,
                              'pir_gunmetal_dark'))
    turret = K.child(tp, 'Cannon_Turret', atlas, root, (0, 0, K.CANNON_HEAD_Z))
    m = G.empty('Cannon_Muzzle', loc=(K.CANNON_MUZZLE_X, 0, bz))
    m.parent = turret
    return root


def armor(ct, lvl, rng, atlas):
    pcs = K.hull(ct)
    # heavy overlapping scrap plates
    pcs.append(K.scrap_plate('Slab0', -0.06, 0.05, 0.62, 0.56, rng.uniform(-6, 6), TOP - 0.004, TOP + 0.03,
                             'pir_plate_worn', rng, jit=0.03, bevel=0.01))
    pcs.append(K.scrap_plate('Slab1', 0.16, -0.17, 0.34, 0.3, rng.uniform(8, 16), TOP + 0.02, TOP + 0.05,
                             'pir_gunmetal', rng, jit=0.02, bevel=0.008))
    pcs.append(K.scrap_plate('Rust0', -0.24, 0.22, 0.2, 0.16, -10, TOP + 0.024, TOP + 0.036, 'pir_rust_patch',
                             rng))
    pcs.append(K.bar('Weld0', (0.0, -0.33, TOP + 0.05), (0.32, -0.02, TOP + 0.05), 0.012, 'pir_weld', hh=0.01))
    # three claw marks (Rust emblem) across the main slab
    for i in range(3):
        b = G.box(f'Claw{i}', -0.17, 0.17, -0.014, 0.014, TOP + 0.024, TOP + 0.04, 'pir_rust_dark')
        G.transform(b, loc=(-0.14 + 0.075 * i, 0.08 + 0.02 * i, 0), rot=(0, 0, 62))
        pcs.append(b)
    # studs / short spikes
    studs = [(0.17, -0.17)] + ([(-0.3, -0.3), (0.3, 0.3)] if lvl >= 2 else [])
    for i, (x, y) in enumerate(studs):
        pcs.append(K.spike(f'Stud{i}', (x, y, TOP + 0.045), (0.25, 0, 1), 0.11, 0.04, 'metal_bare'))
    pcs += K.rivets('Riv', [(-0.33, -0.17), (-0.33, 0.27), (0.2, 0.3), (-0.05, -0.24)], TOP + 0.034,
                    'metal_bare')
    if lvl >= 2:
        pcs.append(t2_plate('TiPlate', -0.22, -0.22, 0.2, 0.17, -14, TOP + 0.04, rng))
        crack = [(-0.05, 0.3), (0.02, 0.12), (-0.03, 0.02), (0.06, -0.1)]
        for i in range(len(crack) - 1):
            pcs.append(K.bar(f'Crack{i}', (*crack[i], TOP + 0.034), (*crack[i + 1], TOP + 0.034), 0.009,
                             ct['role_glow'], hh=0.006))
    return K.finish(pcs, f'Armor_{ct["tier"].capitalize()}_Rust', atlas)


def shield_generator(ct, lvl, rng, atlas):
    pcs = K.hull(ct)
    pcs += scrap_deck(ct, rng, 2)
    plinth = [(0.34 * math.cos(math.radians(22.5 + 45 * i)) + rng.uniform(-0.02, 0.02),
               0.34 * math.sin(math.radians(22.5 + 45 * i)) + rng.uniform(-0.02, 0.02)) for i in range(8)]
    pcs.append(K.poly('Plinth', plinth, TOP - 0.01, TOP + 0.05, 'pir_gunmetal_dark', bevel=0.008))
    pcs.append(G.ring_band('PlinthGlow', 0.27, 0.22, TOP + 0.045, TOP + 0.06, ct['role_glow'], verts=12))
    pcs.append(G.cyl('Socket', 0.1, 0.06, 'pir_gunmetal', loc=(0, 0, TOP + 0.08), verts=8))
    # three bent scrap prongs (antlers) with glowing tips
    for i in range(3):
        a = math.radians(90 + 120 * i)
        ca, sa = math.cos(a), math.sin(a)
        p0 = (0.31 * ca, 0.31 * sa, TOP + 0.03)
        p1 = (0.33 * ca, 0.33 * sa, TOP + 0.24)
        p2 = (0.22 * ca, 0.22 * sa, TOP + 0.42)
        pcs.append(K.bar(f'ProngA{i}', p0, p1, 0.034, 'pir_plate_worn', hh=0.04))
        pcs.append(K.bar(f'ProngB{i}', p1, p2, 0.03, 'pir_gunmetal', hh=0.034))
        pcs.append(K.spike(f'Barb{i}', p1, (ca, sa, 0.5), 0.09, 0.022, 'metal_bare'))
        pcs.append(K.spike(f'ProngTip{i}', p2, (-ca, -sa, 0.6), 0.09, 0.03, 'metal_bare'))
        pcs.append(G.ellipsoid(f'TipGlow{i}', 0.034, 0.034, 0.034, ct['role_glow'], loc=p2, seg=8, rings=5))
        foot = G.box(f'Foot{i}', -0.07, 0.07, -0.07, 0.07, TOP - 0.01, TOP + 0.06, 'pir_rust', bevel=0.008,
                     seg=1)
        G.transform(foot, loc=(0.31 * ca, 0.31 * sa, 0), rot=(0, 0, math.degrees(a) + rng.uniform(-10, 10)))
        pcs.append(foot)
        if lvl >= 2:
            pcs.append(K.bar(f'Spine{i}', (p0[0] * 1.12, p0[1] * 1.12, p0[2] + 0.04),
                             (p1[0] * 1.1, p1[1] * 1.1, p1[2]), 0.012, ct['role_glow']))
    root = K.finish(pcs, f'ShieldGenerator_{ct["tier"].capitalize()}_Rust', atlas)

    ep = [G.ellipsoid('Core', 0.13, 0.13, 0.15, ct['glass'], seg=10, rings=7),
          G.torus('Ring', 0.2, 0.02, 'pir_gunmetal_dark', maj=12, mnr=4)]
    for i in range(6):
        a = math.radians(60 * i)
        ep.append(K.spike(f'RingTooth{i}', (0.21 * math.cos(a), 0.21 * math.sin(a), 0), (math.cos(a), math.sin(a), 0),
                          0.07, 0.022, 'metal_bare'))
    if lvl >= 2:
        ep.append(G.torus('GlowRing', 0.165, 0.01, ct['role_glow'], loc=(0, 0, 0.07), maj=12, mnr=4))
    K.child(ep, 'Shield_Emitter', atlas, root, (0, 0, K.SHIELD_EMITTER_Z))
    return root


def reactor(ct, lvl, rng, atlas):
    pcs = K.hull(ct)
    pcs.append(G.ring_band('BaseRing', 0.33, 0.13, TOP - 0.01, TOP + 0.06, 'pir_gunmetal_dark', verts=10,
                           top_mat='pir_gunmetal'))
    cz0, cz1 = TOP + 0.04, 0.53
    pcs.append(G.cyl('Core', 0.14, cz1 - cz0, ct['role_glow'], loc=(0, 0, (cz0 + cz1) / 2), verts=10))
    # crude barrel cage: six scrap bars + welded bands
    for i in range(6):
        a = 2 * math.pi * i / 6 + rng.uniform(-0.1, 0.1)
        b = G.box(f'Bar{i}', -0.03, 0.03, -0.022, 0.022, TOP + 0.04, 0.55, 'pir_gunmetal' if i % 2 else
                  'pir_plate_worn')
        G.transform(b, loc=(0.165 * math.cos(a), 0.165 * math.sin(a), 0), rot=(0, rng.uniform(-3, 3),
                                                                                math.degrees(a)))
        pcs.append(b)
    for i, z in enumerate((0.31, 0.45)):
        pcs.append(G.ring_band(f'Band{i}', 0.2, 0.16, z - 0.018, z + 0.018, 'pir_rust', verts=10))
    # cap plate with a spiked crown
    pcs.append(K.poly('Cap', [(0.2 * math.cos(math.radians(30 + 60 * i)) + rng.uniform(-0.015, 0.015),
                               0.2 * math.sin(math.radians(30 + 60 * i)) + rng.uniform(-0.015, 0.015))
                              for i in range(6)], 0.53, 0.575, 'pir_gunmetal_dark', bevel=0.006))
    for i in range(4):
        a = math.radians(45 + 90 * i)
        pcs.append(K.spike(f'Crown{i}', (0.14 * math.cos(a), 0.14 * math.sin(a), 0.57),
                           (0.4 * math.cos(a), 0.4 * math.sin(a), 1), 0.12, 0.03, 'metal_bare'))
    pcs.append(K.lamp('TopLamp', (0, 0, 0.59), ct['light'], r=0.04, h=0.03))
    # corner radiators: stacks of thin scrap fins
    for i, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        x, y = sx * 0.38, sy * 0.38
        for j in range(3):
            o = (j - 1) * 0.04
            f = G.box(f'Rad{i}{j}', -0.07, 0.07, -0.009, 0.009, TOP - 0.01, TOP + 0.07 + 0.02 * (j == 1),
                      'pir_plate_worn' if j != 1 else 'pir_rust')
            G.transform(f, loc=(x + o * sy * 0.7, y - o * sx * 0.7, 0), rot=(0, 0, 45 * sx * sy))
            pcs.append(f)
        if lvl >= 2:
            pcs.append(G.box(f'RadGlow{i}', x - 0.03, x + 0.03, y - 0.03, y + 0.03, TOP + 0.0, TOP + 0.02,
                             ct['role_glow']))
    if lvl >= 2:
        pcs.append(G.ring_band('TiBand', 0.205, 0.17, 0.375, 0.405, 'ti_polished', verts=10))
    return K.finish(pcs, f'Reactor_{ct["tier"].capitalize()}_Rust', atlas)


def gyroscope(ct, lvl, rng, atlas):
    pcs = K.hull(ct)
    pcs += toothed_ring('Collar', 0.37, 0.31, TOP - 0.02, TOP + 0.05, 12, 'pir_gunmetal_dark', 'pir_rust')
    pcs.append(G.cyl('WellFloor', 0.315, 0.04, 'char_black', loc=(0, 0, TOP - 0.005), verts=12))
    pcs.append(G.ring_band('WellGlow', 0.27, 0.22, TOP + 0.012, TOP + 0.022, ct['role_glow'], verts=12))
    for i, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        pcs.append(K.spike(f'Corner{i}', (sx * 0.41, sy * 0.41, TOP + 0.005), (sx, sy, 0.5), 0.08, 0.035,
                           'pir_rust' if i % 2 else 'pir_gunmetal'))
    pcs += K.rivets('Bolt', [(0.0, 0.36), (0.0, -0.36), (0.36, 0.0), (-0.36, 0.0)], TOP + 0.055, 'metal_bare')
    pcs.append(G.cyl('Axle', 0.05, 0.06, 'metal_bare', loc=(0, 0, TOP + 0.03), verts=8))
    pcs.append(G.ellipsoid('CoreOrb', 0.085, 0.085, 0.085, ct['role_glow'], loc=(0, 0, K.GYRO_RING_Z),
                           seg=8, rings=6))
    if lvl >= 2:
        pcs.append(t2_plate('TiPatch', 0.3, -0.3, 0.14, 0.12, 20, TOP + 0.004, rng))
    root = K.finish(pcs, f'Gyroscope_{ct["tier"].capitalize()}_Rust', atlas)

    outer = [G.torus('RingO', 0.285, 0.03, 'pir_plate_worn', rot=(90, 0, 0), maj=16, mnr=4)]
    for i, a in enumerate((0, 40, 140, 180, 215, 325)):
        r = math.radians(a)
        d = (math.cos(r), 0.0, math.sin(r))
        outer.append(K.spike(f'RingTooth{i}', (0.3 * d[0], 0, 0.3 * d[2]), d, 0.07, 0.024,
                             'pir_gunmetal_dark'))
    for i, z in enumerate((0.285, -0.285)):
        outer.append(G.cyl(f'RingOHub{i}', 0.035, 0.05, 'metal_bare', loc=(0, 0, z), verts=8))
    if lvl >= 2:
        outer.append(G.torus('RingOGlow', 0.285, 0.01, ct['role_glow'], loc=(0, 0.026, 0), rot=(90, 0, 0), maj=16,
                             mnr=3))
    ring_o = K.child(outer, 'Gyro_Ring_Outer', atlas, root, (0, 0, K.GYRO_RING_Z))
    inner = [G.torus('RingI', 0.2, 0.022, 'pir_rust', maj=12, mnr=4),
             G.torus('RingIGlow', 0.176, 0.009, ct['role_glow'], maj=12, mnr=3)]
    for i, x in enumerate((0.235, -0.235)):
        inner.append(G.cyl(f'RingIHub{i}', 0.03, 0.08, 'pir_gunmetal_dark', loc=(x, 0, 0), axis='X', verts=8))
    K.child(inner, 'Gyro_Ring_Inner', atlas, ring_o, (0, 0, 0))
    return root


def fuel_tank(ct, lvl, rng, atlas):
    pcs = K.hull(ct)
    pcs += scrap_deck(ct, rng, 1, spots=[(-0.3, 0.3), (0.3, -0.32)])
    tanks = ((0.2, 0.165, 0.2, 0.0), (-0.215, 0.13, 0.15, -0.06))
    for k, (y, R, L, dx) in enumerate(tanks):
        z = TOP + 0.04 + R
        pcs.append(K.capsule(f'Tank{k}', L, R, ('pir_hazard', 'pir_gunmetal'), (dx, y, z), verts=10, n=3))
        for j, x in enumerate((-0.12 + dx, 0.12 + dx)):
            pcs.append(G.ring_band(f'Strap{k}{j}', R + 0.014, R - 0.01, -0.022, 0.022,
                                   'pir_weld' if lvl < 2 else 'ti_polished', loc=(x, y, z), axis='X', verts=10))
        pcs.append(G.ring_band(f'RustBand{k}', R + 0.006, R - 0.01, -0.035, 0.035, 'pir_rust_patch',
                               loc=(dx + 0.02 - 0.01 * k, y, z), axis='X', verts=10))
        if lvl >= 2:
            pcs.append(G.box(f'Level{k}', dx - 0.08, dx + 0.08, y - 0.02, y + 0.02, z + R - 0.02, z + R + 0.008,
                             ct['role_glow']))
        pcs.append(G.box(f'Saddle{k}', dx - 0.2, dx + 0.2, y - 0.07, y + 0.07, TOP - 0.01, TOP + 0.05,
                         'pir_gunmetal_dark'))
    pcs.append(G.cyl('Pipe', 0.026, 0.3, 'metal_bare', loc=(-0.33, 0, TOP + 0.13), axis='Y', verts=6))
    pcs.append(G.box('Valve', -0.39, -0.27, -0.06, 0.06, TOP - 0.01, TOP + 0.18, 'pir_gunmetal', bevel=0.01,
                     seg=1))
    pcs.append(K.lamp('ValveLamp', (-0.33, 0.0, TOP + 0.195), ct['light'], r=0.03))
    pcs.append(K.spike('Spike', (0.36, 0.0, TOP + 0.01), (1, 0, 0.6), 0.1, 0.03, 'metal_bare'))
    return K.finish(pcs, f'FuelTank_{ct["tier"].capitalize()}_Rust', atlas)


def crate(name, cx, cy, w, h, ang, z0, z1, mat, band='pir_gunmetal_dark'):
    """Battered crate: box + dark belt + a welded cross strap on the lid."""
    def rect(dw):
        return K.rot2([(-w / 2 - dw, -h / 2 - dw), (w / 2 + dw, -h / 2 - dw), (w / 2 + dw, h / 2 + dw),
                       (-w / 2 - dw, h / 2 + dw)], ang, cx, cy)
    zb = z0 + (z1 - z0) * 0.45
    pcs = [K.poly(name, rect(0), z0, z1, mat, bevel=0.012),
           K.poly(name + 'Belt', rect(0.012), zb - 0.02, zb + 0.02, band)]
    a = math.radians(ang)
    for k, (dx, dy) in enumerate(((w / 2 - 0.03, h / 2 - 0.03), (w / 2 - 0.03, -(h / 2 - 0.03)))):
        p0 = (cx - dx * math.cos(a) + dy * math.sin(a), cy - dx * math.sin(a) - dy * math.cos(a), z1 + 0.006)
        p1 = (cx + dx * math.cos(a) - dy * math.sin(a), cy + dx * math.sin(a) + dy * math.cos(a), z1 + 0.006)
        pcs.append(K.bar(f'{name}X{k}', p0, p1, 0.014, band, hh=0.008))
    return pcs


def cargo(ct, lvl, rng, atlas):
    pcs = K.hull(ct)
    pcs += scrap_deck(ct, rng, 1, spots=[(0.3, 0.3), (-0.3, -0.32)])
    # a pile of mismatched crates under chains
    z0 = TOP - 0.01
    pcs += crate('CrateA', -0.1, 0.07, 0.44, 0.5, 7, z0, TOP + 0.24, 'pir_gunmetal')
    pcs += crate('CrateB', 0.24, -0.2, 0.26, 0.26, -16, z0, TOP + 0.17, 'pir_hazard', band='pir_rust_dark')
    pcs += crate('CrateC', -0.12, 0.1, 0.24, 0.26, -9, TOP + 0.24, TOP + 0.37, 'pir_rust_patch')
    pcs.append(K.spike('Spike', (0.3, 0.3, TOP + 0.01), (0.6, 0.6, 1), 0.1, 0.03, 'metal_bare'))
    # chains over the pile
    for i, x in enumerate((-0.27, 0.08)):
        pcs.append(K.bar(f'Chain{i}', (x, -0.38, TOP + 0.02), (x, -0.18, TOP + 0.25), 0.013, 'metal_bare'))
        pcs.append(K.bar(f'ChainB{i}', (x, -0.18, TOP + 0.25), (x - 0.03, 0.34, TOP + 0.25), 0.013, 'metal_bare'))
        pcs.append(K.bar(f'ChainC{i}', (x - 0.03, 0.34, TOP + 0.25), (x - 0.03, 0.4, TOP + 0.02), 0.013,
                         'metal_bare'))
    pcs.append(G.cyl('Post', 0.018, 0.22, 'pir_gunmetal_dark', loc=(0.38, 0.36, TOP + 0.11), verts=6))
    pcs.append(K.lamp('PostLamp', (0.38, 0.36, TOP + 0.235), ct['light'], r=0.028))
    if lvl >= 2:
        pcs.append(t2_plate('TiPatch', 0.25, -0.2, 0.16, 0.14, -16, TOP + 0.175, rng))
        pcs.append(G.box('GlowStrip', -0.3, 0.1, -0.205, -0.19, TOP + 0.07, TOP + 0.09, ct['role_glow']))
    return K.finish(pcs, f'Cargo_{ct["tier"].capitalize()}_Rust', atlas)


def tractor_beam(ct, lvl, rng, atlas):
    pcs = K.hull(ct)
    pcs += scrap_deck(ct, rng, 2, spots=[(-0.33, 0.33), (-0.33, -0.33)])
    pcs += toothed_ring('Swivel', 0.33, 0.27, TOP - 0.01, TOP + 0.05, 10, 'pir_gunmetal_dark', 'pir_weld')
    pcs.append(G.cyl('Well', 0.275, 0.03, 'char_black', loc=(0, 0, TOP + 0.005), verts=12))
    pcs.append(G.box('FrontTick', 0.37, 0.43, -0.012, 0.012, TOP - 0.004, TOP + 0.008, ct['light']))
    root = K.finish(pcs, f'TractorBeam_{ct["tier"].capitalize()}_Rust', atlas)

    az = K.TRACTOR_AXIS_Z
    hp = [G.cyl('HeadBase', 0.25, 0.05, 'pir_gunmetal_dark', loc=(0, 0, 0.02), verts=10)]
    hp.append(K.convex('Housing', [(-0.27, -0.15, 0.04), (-0.27, 0.15, 0.04), (0.02, -0.16, 0.04),
                                   (0.02, 0.16, 0.04), (-0.24, -0.12, az + 0.14), (-0.24, 0.12, az + 0.12),
                                   (-0.02, -0.12, az + 0.13), (-0.02, 0.12, az + 0.13)], 'pir_plate_worn',
                       bevel=0.01))
    hp.append(K.scrap_plate('HousePatch', -0.13, -0.02, 0.14, 0.16, -8, az + 0.115, az + 0.14, 'pir_rust_patch',
                            rng))
    hp.append(G.cyl('Spindle', 0.045, 0.3, 'metal_bare', loc=(0.17, 0, az), axis='X', verts=8))
    for i, x in enumerate((0.12, 0.22)):
        hp.append(G.torus(f'Coil{i}', 0.1 - 0.015 * i, 0.022, 'pir_rust' if i == 0 else ct['role_glow'],
                          loc=(x, 0, az), rot=(0, 90, 0), maj=10, mnr=4))
    # three-fingered grapple claw around the lens
    for i in range(3):
        a = math.radians(90 + 120 * i)
        cy, cz = math.cos(a), math.sin(a)
        p0 = (0.0, 0.13 * cy, az + 0.13 * cz)
        p1 = (0.3, 0.19 * cy, az + 0.19 * cz)
        p2 = (0.43, 0.08 * cy, az + 0.08 * cz)
        hp.append(K.bar(f'ClawA{i}', p0, p1, 0.026, 'pir_gunmetal'))
        hp.append(K.bar(f'ClawB{i}', p1, p2, 0.022, 'pir_gunmetal_dark'))
        hp.append(K.spike(f'ClawTip{i}', p2, (0.5, -cy, -cz), 0.05, 0.02, 'metal_bare'))
        if lvl >= 2:
            hp.append(K.bar(f'ClawGlow{i}', (0.08, 0.16 * cy, az + 0.16 * cz), (0.27, 0.205 * cy, az + 0.205 * cz),
                            0.009, ct['role_glow']))
    hp.append(G.ellipsoid('Lens', 0.03, 0.075, 0.075, ct['glass'], seg=10, rings=6))
    hp[-1].location = (0.31, 0, az)
    hp.append(G.ellipsoid('LensCore', 0.02, 0.035, 0.035, ct['role_glow'], seg=8, rings=5))
    hp[-1].location = (0.335, 0, az)
    hp.append(K.lamp('HeadLamp', (-0.14, 0.09, az + 0.15), ct['light'], r=0.02))
    head = K.child(hp, 'Tractor_Head', atlas, root, (0, 0, K.TRACTOR_HEAD_Z))
    tip = G.empty('Tractor_Emitter', loc=(K.TRACTOR_EMITTER_X, 0, az))
    tip.parent = head
    return root


BUILDERS = {'cockpit': cockpit, 'engine': engine, 'cannon': cannon, 'armor': armor,
            'shield_generator': shield_generator, 'reactor': reactor, 'gyroscope': gyroscope,
            'fuel_tank': fuel_tank, 'cargo': cargo, 'tractor_beam': tractor_beam}
