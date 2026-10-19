"""Detail pass ("dtl") versions of the stations, outposts and dock clamp.

Same node contract as structures.py (README 2.3 / 2.5): <Root> static mesh,
optional `ring_rotor` (pivot = node origin, spins around Blender Z = glTF +Y),
`beacon_<i>` lamps (same order/colours as before), `dock_port` at (R, 0, 0),
home: `attach_<slot>` empties.  Layout circles stay in structures.LAYOUTS.

Everything static is ONE mesh, the rotor another (shared AF_Palette + COLOR_0
AO/grime) -> draw calls unchanged.  Greebles: lib/greebles.py, finishing:
station_kit.finish().
"""
import math
import random

from mathutils import Matrix

from lib import geo as G
from lib import greebles as GR
import station_kit as K
import structures as S


# ----------------------------------------------------------------------------
# home station "Zakladna Pociatok"  (R = 14)
# ----------------------------------------------------------------------------
# rotor envelope (static details must stay out of the swept volume)
H_RING_R, H_RING_W, H_RING_H, H_RING_Z = 9.55, 1.6, 1.2, 1.0
H_SPOKE_Z, H_SPOKE_R = 1.0, 0.27
H_COLLAR = (3.66, 4.36, 0.5, 1.5)      # rotating bearing collar r0, r1, z0, z1


def _home_zones(R):
    z = GR.Zones()
    # ring + spokes + collar sweep (static side)
    z.annulus(H_RING_R - H_RING_W / 2 - 0.15, H_RING_R + H_RING_W / 2 + 0.25, H_RING_Z - H_RING_H / 2 - 0.14, 9.0)
    z.annulus(H_COLLAR[0] - 0.08, H_RING_R, H_SPOKE_Z - H_SPOKE_R - 0.12, H_SPOKE_Z + 0.5)
    # dock clamp + docked ship corridor
    z.box(R - 2.5, R + 20, -1.7, 1.7, -3, 9)
    # module attach points
    for nm, (x, y, zz, yaw) in S.HOME_SLOTS.items():
        z.cyl(x, y, 1.15, zz - 1.0, zz + 1.6)
    return z


def _rotor_zones():
    z = GR.Zones()
    # keep ring greebles inside the collision circle (10.6) and off the hub
    z.annulus(10.52, 99, -9, 9)
    z.cyl(0, 0, 3.6, -9, 9)
    return z


def _home_hub():
    """Layered hub: spire, lower drum, equator wall, overhang flange, upper
    drum, bearing groove (collar rotates in it), upper deck + top deck."""
    st = []
    prof = [(-3.75, 0.0), (-3.75, 0.45), (-3.0, 1.45), (-2.75, 2.75), (-2.45, 3.35), (-1.95, 4.3), (-1.25, 4.6),
            (-0.5, 4.6), (-0.48, 5.05), (-0.2, 5.05), (-0.15, 4.5), (0.4, 4.42), (0.46, 3.62), (1.56, 3.62),
            (1.62, 4.22), (2.3, 4.22), (2.46, 4.02), (2.46, 0.0)]
    mats = ['hull_dark', 'hull_dark', 'hull_mid', 'hull_dark', 'hull_mid', 'hull_light', 'hull_light',
            'hull_dark', 'accent_iron', 'hull_light', 'hull_light', 'hull_dark', 'trim_black', 'hull_dark',
            'hull_light', 'hull_mid', 'hull_light']
    keys = list(dict.fromkeys(mats))
    st.append(G.lathe('Hub', prof, [keys.index(m) for m in mats], keys, axis='Z', verts=32, closed=False,
                      smooth=False))
    # structural ribs on the lower drum + equator wall (24, between window bays)
    for i in range(16):
        a = i * 22.5 + 11.25
        st.append(K.rbox(f'HubRib{i}', 4.28, 4.72, 0.11, -1.85, -0.52, a, 'hull_mid'))
        st.append(K.rbox(f'HubRibF{i}', 4.95, 5.12, 0.13, -0.5, -0.12, a, 'hull_mid'))
    # flange rim lights (warm) + amber marker lights every 90 deg
    st += K.ring_lights('FlangeLamp', 5.06, -0.36, 48, 'window_warm', s=0.05, h=0.05, a0=3.75)
    # upper drum ribs
    for i in range(12):
        a = i * 30 + 15
        st.append(K.rbox(f'UpRib{i}', 4.12, 4.3, 0.1, 1.64, 2.36, a, 'hull_mid'))
    # top deck ring: accent + lamp ring + radial seams
    st.append(G.ring_band('DeckEdge', 4.06, 3.86, 2.44, 2.52, 'accent_iron', verts=32, smooth=False))
    st += K.ring_lights('DeckLamp', 3.96, 2.52, 32, 'window_warm', s=0.045, h=0.03)
    # command tower: stepped
    tw = [(2.46, 2.75), (2.95, 2.75), (3.0, 2.35), (3.15, 2.35), (3.25, 2.38), (3.85, 2.22), (3.95, 1.95),
          (4.35, 1.85), (4.45, 1.3), (4.7, 1.2), (4.75, 0.0)]
    tm = ['hull_mid', 'hull_light', 'hull_dark', 'accent_iron', 'glass_cockpit', 'hull_light', 'hull_light',
          'hull_mid', 'hull_light', 'hull_light']
    tk = list(dict.fromkeys(tm))
    st.append(G.lathe('Tower', tw, [tk.index(m) for m in tm], tk, axis='Z', verts=24, closed=False, smooth=False))
    for i in range(12):   # bridge mullions
        a = i * 30
        b = G.box(f'Mull{i}', 2.18, 2.42, -0.045, 0.045, 3.22, 3.88, 'hull_mid')
        G.transform(b, rot=(0, 0, a))
        st.append(b)
    st.append(G.ring_band('TowerWin', 2.78, 2.7, 2.62, 2.74, 'window_warm', verts=24, smooth=False))
    st.append(G.ring_band('TowerWin2', 1.945, 1.84, 4.04, 4.16, 'window_warm', verts=24, smooth=False))
    for i in range(12):   # roof ribs + vents on the tower crown
        a = i * 30 + 15
        st.append(K.rbox(f'CrownRib{i}', 1.3, 1.9, 0.05, 4.36, 4.47, a, 'hull_mid'))
        if i % 3 == 0:
            st.append(K.rbox(f'CrownVent{i}', 1.45, 1.75, 0.16, 4.38, 4.46, a + 15, 'trim_black'))
    # antenna farm on the tower top
    st += S.mast('Antenna', (0, 0, 4.72), 1.55, r=0.1)
    st += S.mast('AntennaB', (-0.75, 0.55, 4.6), 0.95, r=0.06, dish=0.55)
    st += S.mast('AntennaC', (0.7, -0.6, 4.62), 0.7, r=0.05)
    st.append(G.box('AntennaCLamp', 0.65, 0.75, -0.65, -0.55, 5.32, 5.42, 'light_red'))
    # domes + pods on the top deck
    for i in range(4):
        a = math.radians(45 + 90 * i)
        x, y = 3.32 * math.cos(a), 3.32 * math.sin(a)
        st.append(G.ellipsoid(f'Dome{i}', 0.5, 0.5, 0.4, 'glass_cockpit', loc=(x, y, 2.5), seg=12, rings=6,
                              upper_only=True))
        st.append(G.ring_band(f'DomeRing{i}', 0.62, 0.47, 2.44, 2.6, 'hull_mid', loc=(x, y, 0), verts=12))
        for j in range(2):
            rb = G.box(f'DomeArc{i}{j}', -0.02, 0.02, -0.48, 0.48, 2.5, 2.88, 'hull_mid')
            G.transform(rb, loc=(x, y, 0), rot=(0, 0, j * 90 + 45))
            st.append(rb)
    for i in range(4):   # equipment pods between the domes (radiator / comm / hab)
        a = 90 * i
        p = K.rbox(f'Pod{i}', 2.95, 3.85, 0.42, 2.46, 2.86, a, 'hull_light', bevel=0.04)
        st.append(p)
        st.append(K.rbox(f'PodTop{i}', 3.0, 3.8, 0.34, 2.86, 2.92, a, 'hull_mid'))
        st.append(K.rbox(f'PodWin{i}', 3.85, 3.87, 0.3, 2.62, 2.72, a, 'window_warm'))
    # underside: spire lights
    st += K.ring_lights('SpireLamp', 2.78, -2.82, 16, 'light_amber', s=0.05, h=0.05)
    return st


def _home_ring():
    """Rotating habitat ring (in station space): profiled section, 12 modules
    between structural collars, varied roofs, spine walkway, 4 spoke tubes and
    the bearing collar on the hub."""
    R, w, h, z = H_RING_R, H_RING_W, H_RING_H, H_RING_Z
    ri, ro = R - w / 2, R + w / 2
    z0, z1 = z - h / 2, z + h / 2
    prof = [(z0, ri + 0.12), (z0, ro - 0.12), (z0 + 0.14, ro), (z1 - 0.18, ro), (z1, ro - 0.2), (z1, ri + 0.18),
            (z1 - 0.16, ri), (z0 + 0.14, ri)]
    mats = ['hull_dark', 'hull_mid', 'hull_light', 'hull_mid', 'hull_light', 'accent_iron', 'hull_mid', 'hull_dark']
    keys = list(dict.fromkeys(mats))
    rot = [G.lathe('Ring', prof, [keys.index(m) for m in mats], keys, axis='Z', verts=72, closed=True,
                   smooth=False)]
    # keel band + spine walkway + accent lines on the roof
    rot.append(G.ring_band('RingKeel', R + 0.35, R - 0.35, z0 - 0.1, z0 + 0.02, 'hull_dark', verts=72, smooth=False))
    rot.append(G.ring_band('RingAccO', ro - 0.24, ro - 0.32, z1 - 0.01, z1 + 0.025, 'accent_iron', verts=72,
                           smooth=False))
    # 12 structural collars
    for i in range(12):
        a = i * 30.0
        acc = 'accent_iron' if i % 2 == 0 else 'hull_mid'
        rot.append(K.rbox(f'Collar{i}', ri - 0.1, ro + 0.07, 0.2, z0 - 0.08, z1 + 0.14, a, acc, bevel=0.04))
        rot.append(K.rbox(f'CollarCap{i}', ri - 0.02, ro - 0.02, 0.12, z1 + 0.14, z1 + 0.2, a, 'hull_dark'))
        for s in (-1, 1):
            b = G.box(f'CollarLamp{i}{s}', ro - 0.1, ro + 0.0, s * 0.27 - 0.05, s * 0.27 + 0.05, z1 + 0.02,
                      z1 + 0.09, 'light_amber' if i % 2 == 0 else 'window_warm')
            G.transform(b, rot=(0, 0, a))
            rot.append(b)
    # module roofs (between collars): glass gallery / radiator bank / hab pods / plain (greebled)
    for i in range(12):
        a0, a1 = i * 30 + 2.5, i * 30 + 27.5
        kind = (0, 1, 3, 2, 3, 1)[i % 6]
        if kind == 1:      # glass gallery roof with ribs
            rot.append(K.arc_box(f'Gal{i}', R + 0.32, 0.5, 0.2, z1 + 0.1, a0 + 1.5, a1 - 1.5, 'glass_cockpit'))
            for k in range(7):
                aa = a0 + 1.5 + (a1 - a0 - 3) * k / 6
                rot.append(K.rbox(f'GalRib{i}{k}', R + 0.04, R + 0.6, 0.03, z1, z1 + 0.23, aa, 'hull_light'))
        elif kind == 2:    # radiator bank
            n = 9
            for k in range(n):
                aa = a0 + 2 + (a1 - a0 - 4) * (k + 0.5) / n
                rot.append(K.rbox(f'Rad{i}{k}', R - 0.45, R + 0.45, 0.035, z1 + 0.02, z1 + 0.3, aa,
                                  'hull_white' if k % 3 else 'accent_iron'))
            rot.append(K.arc_box(f'RadBase{i}', R, 1.0, 0.06, z1 + 0.03, a0 + 1, a1 - 1, 'hull_dark'))
        elif kind == 3:    # two hab pods with window bands
            for k, aa in enumerate((a0 + 6, a1 - 6)):
                rot.append(K.rbox(f'Pod{i}{k}', R - 0.42, R + 0.42, 0.42, z1, z1 + 0.32, aa, 'hull_light',
                                  bevel=0.03))
                rot.append(K.rbox(f'PodWin{i}{k}', R - 0.44, R + 0.44, 0.3, z1 + 0.14, z1 + 0.22, aa,
                                  'window_warm'))
                rot.append(K.rbox(f'PodCap{i}{k}', R - 0.3, R + 0.3, 0.3, z1 + 0.32, z1 + 0.36, aa, 'hull_mid'))
    # spokes: tube + conduit + brackets + lights
    for k, a in enumerate((45, 135, 225, 315)):
        r0, r1 = H_COLLAR[1] - 0.05, ri + 0.05
        ar = math.radians(a)
        d = (math.cos(ar), math.sin(ar))
        t = (-d[1], d[0])
        tube = G.cyl(f'Spoke{k}', H_SPOKE_R, r1 - r0, 'hull_light', loc=((r0 + r1) / 2, 0, H_SPOKE_Z), axis='X',
                     verts=10, smooth=True)
        G.transform(tube, rot=(0, 0, a))
        rot.append(tube)
        pipe = G.cyl(f'SpokePipe{k}', 0.08, r1 - r0, 'metal_bare', loc=((r0 + r1) / 2, 0.36, H_SPOKE_Z + 0.05),
                     axis='X', verts=6)
        G.transform(pipe, rot=(0, 0, a))
        rot.append(pipe)
        n = 6
        for j in range(n + 1):
            rr = r0 + 0.35 + (r1 - r0 - 0.7) * j / n
            acc = 'accent_iron' if j in (0, n) else 'hull_mid'
            rot.append(K.rbox(f'SpokeBand{k}{j}', rr - 0.09, rr + 0.09, H_SPOKE_R + 0.03, H_SPOKE_Z - H_SPOKE_R - 0.03,
                              H_SPOKE_Z + H_SPOKE_R + 0.03, a, acc))
            rot.append(K.rbox(f'SpokeBr{k}{j}', rr - 0.04, rr + 0.04, 0.42, H_SPOKE_Z - 0.03, H_SPOKE_Z + 0.07, a,
                              'hull_dark'))
            if 0 < j < n:
                lp = G.box(f'SpokeLamp{k}{j}', rr + 0.25, rr + 0.33, -0.05, 0.05, H_SPOKE_Z + H_SPOKE_R - 0.02,
                           H_SPOKE_Z + H_SPOKE_R + 0.05, 'window_warm')
                G.transform(lp, rot=(0, 0, a))
                rot.append(lp)
        # elevator car parked on the spoke
        rot.append(K.rbox(f'Car{k}', 6.2, 6.8, 0.33, H_SPOKE_Z - 0.33, H_SPOKE_Z + 0.33, a, 'hull_white', bevel=0.04))
        rot.append(K.rbox(f'CarWin{k}', 6.28, 6.72, 0.345, H_SPOKE_Z + 0.04, H_SPOKE_Z + 0.16, a, 'window_warm'))
    # bearing collar (rotates in the hub groove)
    c0, c1, cz0, cz1 = H_COLLAR
    rot.append(G.lathe('Collar', [(cz0, c0), (cz0, c1 - 0.08), (cz0 + 0.1, c1), (cz1 - 0.1, c1), (cz1, c1 - 0.08),
                                  (cz1, c0)],
                       [0, 1, 2, 1, 0], ['hull_dark', 'hull_mid', 'hull_light'], axis='Z', verts=32, closed=False,
                       smooth=False))
    rot.append(G.ring_band('CollarBand', c1 + 0.015, c1 - 0.05, 0.94, 1.06, 'accent_iron', verts=32, smooth=False))
    rot += K.ring_lights('CollarLamp', c1 - 0.04, cz1, 16, 'light_amber', s=0.04, h=0.04, a0=11.25)
    return rot


def _home_arm(R):
    """Docking arm along +X: walkway deck with side tubes, runway lights, under
    girder, rib collars, approach gantry at the tip, clamp mount."""
    x0, x1 = 4.7, R - 2.2
    w = 1.7
    st = []
    st.append(G.box('ArmCore', x0, x1, -w / 2, w / 2, -0.62, -0.06, 'hull_dark', bevel=0.05, seg=1))
    st.append(G.prism('ArmDeck', G.chamfer_rect(x0, x1, -w / 2 + 0.06, w / 2 - 0.06, 0.2), -0.1, 0.16,
                      'hull_light', bevel=0.03, seg=1))
    st.append(G.box('ArmCenter', x0 + 0.3, x1 - 0.35, -0.2, 0.2, 0.15, 0.19, 'hull_mid'))
    for s in (1, -1):
        y = s * (w / 2 + 0.2)
        st.append(G.cyl(f'ArmTube{s}', 0.2, x1 - x0 - 0.6, 'hull_light', loc=((x0 + x1) / 2 - 0.1, y, -0.32), axis='X',
                        verts=10))
        st.append(G.box(f'ArmTubeWin{s}', x0 + 0.5, x1 - 0.9, y + s * 0.185 - 0.02, y + s * 0.185 + 0.02, -0.36,
                        -0.27, 'window_warm'))
        st.append(G.box(f'ArmBelt{s}', x0, x1, s * w / 2 - 0.04, s * w / 2 + 0.04, -0.46, -0.36, 'accent_iron'))
        # runway lights along both deck edges (cyan, ship-part language)
        st += K.light_row(f'Runway{s}', (x0 + 0.4, s * (w / 2 - 0.2), 0.15), (x1 - 0.4, s * (w / 2 - 0.2), 0.15), 9,
                          'engine_glow', s=0.07, h=0.04)
    # rib collars
    n = 6
    for i in range(n):
        x = x0 + 0.6 + i * (x1 - x0 - 1.2) / (n - 1)
        st.append(G.box(f'ArmRib{i}', x - 0.1, x + 0.1, -w / 2 - 0.45, w / 2 + 0.45, -0.68, 0.0, 'hull_mid',
                        bevel=0.03, seg=1))
        st.append(G.box(f'ArmRibAcc{i}', x - 0.11, x + 0.11, -w / 2 - 0.46, w / 2 + 0.46, -0.3, -0.2,
                        'accent_iron'))
    # under girder
    st += K.box_truss('ArmGirder', (x0 + 0.2, 0, -0.9), (x1 - 0.4, 0, -0.9), w=0.8, h=0.45, bar_w=0.07,
                      mat='hull_dark', rung_mat='hull_mid')
    # approach gantry (outside the ring sweep) with landing lights
    gx = R - 2.7
    for s in (1, -1):
        st.append(G.box(f'GantryLeg{s}', gx - 0.16, gx + 0.16, s * 1.18 - 0.14, s * 1.18 + 0.14, -0.6, 1.25, 'hull_mid',
                        bevel=0.03, seg=1))
        st.append(G.box(f'GantryAcc{s}', gx - 0.17, gx + 0.17, s * 1.18 - 0.15, s * 1.18 + 0.15, 0.55, 0.7,
                        'accent_iron'))
    st.append(G.box('GantryTop', gx - 0.2, gx + 0.2, -1.36, 1.36, 1.2, 1.42, 'hull_light', bevel=0.04, seg=1))
    st += K.light_row('GantryLamp', (gx + 0.21, -1.0, 1.25), (gx + 0.21, 1.0, 1.25), 5, 'engine_glow', s=0.06, h=0.1)
    # control cab on the arm root (low: under the spokes)
    st.append(G.box('ArmCab', x0 + 0.1, x0 + 1.3, -0.75, 0.75, 0.1, 0.5, 'hull_light', bevel=0.04, seg=1))
    st.append(G.box('ArmCabWin', x0 + 1.28, x0 + 1.33, -0.55, 0.55, 0.26, 0.4, 'window_warm'))
    st.append(G.box('ArmCabRoof', x0 + 0.2, x0 + 1.2, -0.65, 0.65, 0.5, 0.56, 'hull_mid'))
    # clamp mount plate
    st.append(G.box('ArmMount', x1 - 0.3, x1, -w / 2 - 0.25, w / 2 + 0.25, -0.7, 0.21, 'hull_dark', bevel=0.05,
                    seg=1))
    # beacons 0/1 sit on the gantry legs
    for s in (1, -1):
        st.append(G.box(f'BeaconCap{s}', gx - 0.12, gx + 0.12, s * 1.18 - 0.12, s * 1.18 + 0.12, 1.42, 1.5, 'hull_dark'))
    return st


def _home_hangar():
    """Hangar on -Y: lower bay, stepped roof, control cabin, gate with glow and
    hazard frame (everything below the spoke sweep z 0.62)."""
    st = []
    x0, x1, y0, y1 = -2.8, 2.8, -8.05, -3.6
    st.append(G.box('HgBody', x0, x1, y0, y1, -1.9, -0.05, 'hull_dark', bevel=0.06, seg=1))
    st.append(G.box('HgBelt', x0 - 0.05, x1 + 0.05, y0 - 0.05, y1, -1.42, -1.22, 'accent_iron'))
    st.append(G.prism('HgRoof', G.chamfer_rect(x0 + 0.05, x1 - 0.05, y0 + 0.05, y1, 0.35), -0.1, 0.22,
                      'hull_light', bevel=0.04, seg=1))
    # raised roof spine with skylights
    st.append(G.box('HgSpine', -1.0, 1.0, y0 + 0.5, y1 - 0.2, 0.2, 0.42, 'hull_mid', bevel=0.03, seg=1))
    for k in range(4):
        yy = y0 + 0.9 + k * 0.95
        st.append(G.box(f'HgSky{k}', -0.8, 0.8, yy - 0.3, yy + 0.3, 0.42, 0.46, 'trim_black'))
        st.append(G.box(f'HgSkyG{k}', -0.72, 0.72, yy - 0.24, yy + 0.24, 0.44, 0.48, 'window_warm'))
    # control cabin (corner) with wrap windows
    st.append(G.box('HgCab', x0 + 0.2, x0 + 1.5, y0 + 0.25, y0 + 1.45, 0.2, 0.58, 'hull_white', bevel=0.04, seg=1))
    st.append(G.box('HgCabWin', x0 + 0.17, x0 + 1.53, y0 + 0.22, y0 + 1.48, 0.36, 0.48, 'glass_cockpit'))
    # roof equipment: grille housings + vent rows on the side lanes (hand-placed greebles)
    hk = GR.Kit()
    S_ = GR.STYLES['home']
    import random as _r
    hr = _r.Random(77)
    for k, yy in enumerate((-5.9, -5.1, -4.3)):
        GR.g_grille(hk, GR.top_frame((-1.85, yy, 0.22)), 0.42, 0.3, hr, S_, 'hull_light')
    for k, yy in enumerate((-7.5, -6.6, -5.7, -4.8, -4.0)):
        GR.g_vent(hk, GR.top_frame((2.45, yy, 0.22), (0, 1, 0)), 0.3, 0.13, hr, S_, 'hull_light')
    st.append(hk.obj('HgRoofKit'))
    # roof crane rails
    for s in (1, -1):
        st.append(G.box(f'HgRail{s}', s * 1.9 - 0.06, s * 1.9 + 0.06, y0 + 0.3, y1 - 0.3, 0.2, 0.3, 'metal_bare'))
    st.append(G.box('HgCrane', 1.2, 2.4, -6.2, -5.8, 0.3, 0.45, 'accent_iron'))
    # gate (-Y face)
    st.append(G.box('GateFrame', -2.45, 2.45, y0 - 0.25, y0 + 0.05, -1.8, 0.12, 'accent_iron', bevel=0.05, seg=1))
    st.append(G.box('GateOpen', -1.85, 1.85, y0 - 0.3, y0 - 0.1, -1.5, -0.2, 'trim_black'))
    st.append(G.box('GateGlowT', -1.85, 1.85, y0 - 0.34, y0 - 0.26, -0.3, -0.2, 'engine_glow'))
    st.append(G.box('GateGlowB', -1.85, 1.85, y0 - 0.34, y0 - 0.26, -1.5, -1.4, 'engine_glow'))
    for k in range(6):   # hazard chevrons on the lintel
        b = G.box(f'Haz{k}', -0.1, 0.1, -0.04, 0.04, -0.13, 0.13, 'trim_black')
        G.transform(b, loc=(-1.75 + k * 0.7, y0 - 0.27, -0.03), rot=(0, 35, 0))
        st.append(b)
    for s in (1, -1):   # side door lamps + light columns
        st += K.light_row(f'GateCol{s}', (s * 2.15, y0 - 0.28, -1.6), (s * 2.15, y0 - 0.28, -0.1), 5, 'window_warm',
                          s=0.05, h=0.08)
    return st


def _home_depot():
    """Fuel depot on +Y: low deck with three horizontal tanks, manifold,
    catwalk (below the spoke sweep)."""
    st = []
    st += S.deck_block('Depot', -2.5, 2.5, 3.9, 8.1, -1.7, -0.5)
    for i, y in enumerate((4.6, 5.95, 7.3)):
        st += K.tank_h(f'Tank{i}', -2.05, 2.05, y, 0.0, 0.56, body='fuel_yellow', cap='hull_light', straps=3)
        for x in (-1.2, 1.2):
            st.append(G.box(f'Saddle{i}{x}', x - 0.14, x + 0.14, y - 0.45, y + 0.45, -0.55, -0.3, 'hull_dark'))
    st.append(G.cyl('Manifold', 0.11, 3.6, 'metal_bare', loc=(-2.25, 5.95, -0.25), axis='Y', verts=8))
    for i, y in enumerate((4.6, 5.95, 7.3)):
        st.append(G.cyl(f'Feed{i}', 0.07, 0.5, 'metal_bare', loc=(-2.05, y, -0.25), axis='X', verts=6))
        st.append(G.box(f'Valve{i}', -2.38, -2.12, y - 0.13, y + 0.13, -0.38, -0.12, 'accent_iron'))
    st.append(G.box('Catwalk', 2.15, 2.45, 4.0, 7.9, -0.5, -0.44, 'metal_bare'))
    st += K.light_row('DepotLamp', (2.42, 4.1, -0.45), (2.42, 7.8, -0.45), 6, 'light_amber', s=0.05, h=0.05)
    return st


def _home_truss():
    """Solar truss (-X): box girder, rotators, framed arrays (outer pair tilted
    10 deg), radiator fins under the truss (all under the ring sweep z 0.25)."""
    st = []
    st += K.box_truss('Truss', (-4.9, 0, -0.5), (-13.3, 0, -0.5), w=0.7, h=0.5, bar_w=0.09, mat='hull_dark',
                      rung_mat='hull_mid')
    st.append(G.box('TrussSpine', -13.3, -4.9, -0.12, 0.12, -0.3, -0.2, 'accent_iron'))
    for side in (1, -1):
        for (xa, xb, ya, yb, tilt) in ((-13.0, -10.0, 0.75, 4.0, 10.0), (-8.4, -5.5, 0.75, 3.3, 0.0)):
            y0, y1 = (ya, yb) if side > 0 else (-yb, -ya)
            st += K.solar_array(f'Sol{side}{int(xa)}', xa, xb, y0, y1, -0.5, cols=4, rows=4,
                                tilt=tilt * side, pivot_y=side * 0.75)
            st += K.rotator(f'Rot{side}{int(xa)}', ((xa + xb) / 2, side * 0.55, -0.5), r=0.16, L=0.36, axis='Y')
    # radiator fins hanging under the truss
    for k in range(5):
        x = -6.0 - k * 1.5
        st.append(G.box(f'RadFin{k}', x - 0.5, x + 0.5, -0.04, 0.04, -1.55, -0.75, 'hull_white'))
        st.append(G.box(f'RadFinE{k}', x - 0.5, x + 0.5, -0.05, 0.05, -1.6, -1.52, 'accent_iron'))
    # truss-end cap (aft pylon starts here) + nav lamps at the wing tips (beacons 3/4)
    st.append(G.box('TrussEnd', -13.45, -13.05, -0.55, 0.55, -0.85, -0.15, 'hull_mid', bevel=0.04, seg=1))
    return st


def _home_pylon(name, r0, r1, yaw, z):
    """Module pylon (same envelope as structures._home_pylon) with walkway
    windows, keel lights and a conduit."""
    out = S._home_pylon(name, r0, r1, yaw, z)
    extra = [G.cyl(name + 'Pipe', 0.07, r1 - r0 - 0.6, 'metal_bare', loc=((r0 + r1) / 2 - 0.2, 0.47, z - 0.36),
                   axis='X', verts=6)]
    n = max(2, int((r1 - r0) / 0.9))
    for i in range(n):
        x = r0 + 0.4 + i * (r1 - r0 - 1.0) / max(1, n - 1)
        extra.append(G.box(f'{name}KL{i}', x - 0.05, x + 0.05, -0.05, 0.05, z - 0.6, z - 0.54, 'light_amber'))
    for o in extra:
        G.transform(o, rot=(0, 0, yaw))
    return out + extra


def _home_service_ring():
    """Static conduit ring under the rotating ring: two pipes + brackets."""
    st = []
    for r, key in ((6.55, 'metal_bare'), (6.9, 'hull_mid')):
        st.append(G.torus(f'Svc{r}', r, 0.09, key, loc=(0, 0, -1.05), maj=72, mnr=6, smooth=True))
    for i in range(16):
        a = i * 22.5 + 11.25
        st.append(K.rbox(f'SvcBr{i}', 6.35, 7.1, 0.07, -1.22, -0.92, a, 'hull_dark'))
        if i % 2 == 0:   # struts back to the hub
            st.append(K.rbox(f'SvcStrut{i}', 4.4, 6.5, 0.05, -1.1, -1.0, a, 'hull_mid'))
    return st


def build_home(atlas_dir, seed=1401):
    R = S.LAYOUTS['station_home']['R']
    st = []
    st += _home_hub()
    st += _home_arm(R)
    st += _home_hangar()
    st += _home_depot()
    st += _home_truss()
    st += _home_service_ring()
    for nm, (x, y, z, yaw) in S.HOME_SLOTS.items():
        st += _home_pylon(f'Pylon_{nm}', S.HOME_PYLON_FROM[nm], math.hypot(x, y), yaw, z)
    rot = _home_ring()
    beacons = [((R - 2.7, 1.18, 1.72), 'light_red'), ((R - 2.7, -1.18, 1.72), 'light_green'),
               ((0, 0, 6.45), 'light_white'), ((-13.1, 4.1, -0.3), 'light_amber'),
               ((-13.1, -4.1, -0.3), 'light_amber'), ((2.6, -8.3, 0.12), 'light_amber'),
               ((-2.6, -8.3, 0.12), 'light_amber'), ((0, 0, -3.95), 'light_red')]
    zones = _home_zones(R)
    zones.functional(4.6, R, -0.8, 0.8, 0.12)            # dock arm walkway deck stays clear
    for (x, y, z), _ in beacons:
        zones.cyl(x, y, 0.4, z - 0.4, z + 0.4)
    static_cfg = dict(
        panels=True, panel_cell=1.15,
        rows=[(-0.86, 0.1), (-0.5, 0.07), (-1.45, 0.08), (2.0, 0.09), (0.12, 0.07)],
        scatter=[dict(density=1.0, top=1.0, side=1.0)])
    rotor_cfg = dict(
        panels=True, panel_cell=0.85, panel_min_area=0.5,
        rows=[(0.78, 0.1), (1.18, 0.07)],
        scatter=[dict(density=1.1, top=1.0, side=0.8, extra={'antenna': 0.2, 'dish': 0.3, 'tank': 0.3,
                                                              'rack': 0.5, 'window': 0.6})])
    root, stats = K.finish('Station_Home', st, atlas_dir, R, beacons, rot, (0, 0, 0), style='home', seed=seed,
                           zones=zones, rotor_zones=_rotor_zones(), static_cfg=static_cfg, rotor_cfg=rotor_cfg,
                           weather_cfg=dict(grime=0.3), beacon='cage')
    for nm, (x, y, z, yaw) in S.HOME_SLOTS.items():
        e = G.empty(f'attach_{nm}', loc=(x, y, z), size=0.8)
        e.rotation_euler = (0, 0, math.radians(yaw))
        e.parent = root
    return root



# ----------------------------------------------------------------------------
# generic dtl blocks for the smaller stations
# ----------------------------------------------------------------------------
def _lathe(name, prof, mats, verts=24, loc=(0, 0, 0)):
    keys = list(dict.fromkeys(mats))
    return G.lathe(name, prof, [keys.index(m) for m in mats], keys, loc=loc, axis='Z', verts=verts, closed=False,
                   smooth=False)


def _moved(objs, loc):
    for o in objs:
        G.apply_modifiers(o)
        G.bake_transform(o)
        o.data.transform(Matrix.Translation(loc))
    return objs


def hub_dtl(name, r, z0, z1, accent='accent_iron', groove=None, flange_z=None, verts=24, loc=(0, 0, 0),
            spire=0.8):
    """Layered hub: spire, lower drum, window wall, overhang flange, upper
    drum (optional bearing groove (zg0, zg1, rg) for a rotating collar), top
    deck at z1.  Window rows come from the dress pass."""
    zf = flange_z if flange_z is not None else (groove[0] - 0.55 if groove else z0 + 0.55 * (z1 - z0))
    prof = [(z0 - spire, 0.0), (z0 - spire, r * 0.12), (z0 - 0.15, r * 0.4), (z0, r * 0.72), (z0 + 0.4, r * 0.97),
            (zf - 0.05, r), (zf, r + 0.38), (zf + 0.26, r + 0.38), (zf + 0.31, r - 0.04)]
    mats = ['hull_dark', 'hull_dark', 'hull_mid', 'hull_mid', 'hull_light', 'hull_dark', accent, 'hull_light']
    if groove:
        zg0, zg1, rg = groove
        prof += [(zg0 - 0.05, r - 0.08), (zg0, rg), (zg1, rg), (zg1 + 0.05, r - 0.12)]
        mats += ['hull_light', 'hull_dark', 'trim_black', 'hull_dark']
        prof += [(z1 - 0.14, r - 0.12), (z1, r - 0.3), (z1, 0.0)]
    else:
        prof += [(z1 - 0.14, r - 0.1), (z1, r - 0.3), (z1, 0.0)]
    mats += ['hull_light', 'hull_mid', 'hull_light']
    st = [_lathe(name, prof, mats, verts=verts)]
    n = verts // 2
    for i in range(n):
        a = (i + 0.5) * 360 / n
        st.append(K.rbox(f'{name}Rib{i}', r * 0.93, r + 0.1, 0.09, z0 + 0.42, zf - 0.02, a, 'hull_mid'))
    st += K.ring_lights(name + 'FlL', r + 0.39, zf + 0.08, verts * 2, 'window_warm', s=0.045, h=0.05,
                        a0=180 / verts)
    rt = r - 0.12 if groove else r - 0.1
    st.append(G.ring_band(name + 'Edge', rt - 0.2, rt - 0.32, z1 - 0.05, z1 + 0.04, accent, verts=verts, smooth=False))
    if any(loc):
        _moved(st, loc)
    return st


def ring_dtl(name, R, w, h, z, collars=8, spokes=(), spoke_r0=None, spoke_rad=0.2, accent='accent_iron',
             verts=48, roofs=True, collar_hub=None):
    """Rotating habitat ring (station space): profiled section, structural
    collars with lamps, varied roofs, spoke tubes, optional hub collar
    (r0, r1, z0, z1) that turns in a hub_dtl groove."""
    ri, ro = R - w / 2, R + w / 2
    z0, z1 = z - h / 2, z + h / 2
    b = min(0.16, w * 0.12)
    prof = [(z0, ri + b), (z0, ro - b), (z0 + b, ro), (z1 - b, ro), (z1, ro - b), (z1, ri + b), (z1 - b, ri),
            (z0 + b, ri)]
    mats = ['hull_dark', 'hull_mid', 'hull_light', 'hull_mid', 'hull_light', accent, 'hull_mid', 'hull_dark']
    keys = list(dict.fromkeys(mats))
    rot = [G.lathe(name, prof, [keys.index(m) for m in mats], keys, axis='Z', verts=verts, closed=True, smooth=False)]
    rot.append(G.ring_band(name + 'Acc', ro - b - 0.04, ro - b - 0.1, z1 - 0.01, z1 + 0.025, accent, verts=verts,
                           smooth=False))
    rot.append(G.ring_band(name + 'Keel', R + w * 0.22, R - w * 0.22, z0 - 0.08, z0 + 0.02, 'hull_dark', verts=verts,
                           smooth=False))
    step = 360.0 / collars
    for i in range(collars):
        a = i * step
        acc = accent if i % 2 == 0 else 'hull_mid'
        rot.append(K.rbox(f'{name}Col{i}', ri - 0.08, ro + 0.06, 0.16, z0 - 0.06, z1 + 0.12, a, acc, bevel=0.03))
        rot.append(K.rbox(f'{name}ColCap{i}', ri, ro - 0.02, 0.1, z1 + 0.12, z1 + 0.17, a, 'hull_dark'))
        lb = G.box(f'{name}ColL{i}', ro - 0.08, ro + 0.01, -0.05, 0.05, z1 + 0.02, z1 + 0.08,
                   'light_amber' if i % 2 == 0 else 'window_warm')
        G.transform(lb, rot=(0, 0, a))
        rot.append(lb)
        if roofs:
            a0, a1 = a + 3, a + step - 3
            kind = i % 3
            if kind == 1:
                rot.append(K.arc_box(f'{name}Gal{i}', R + w * 0.12, w * 0.38, 0.16, z1 + 0.08, a0 + 1, a1 - 1,
                                     'glass_cockpit'))
                for k in range(5):
                    aa = a0 + 1 + (a1 - a0 - 2) * k / 4
                    rot.append(K.rbox(f'{name}GalR{i}{k}', R - w * 0.1, R + w * 0.34, 0.025, z1, z1 + 0.18, aa,
                                      'hull_light'))
            elif kind == 2:
                n = max(4, int((a1 - a0) / 3.5))
                for k in range(n):
                    aa = a0 + 1 + (a1 - a0 - 2) * (k + 0.5) / n
                    rot.append(K.rbox(f'{name}Rad{i}{k}', R - w * 0.3, R + w * 0.3, 0.03, z1 + 0.01, z1 + 0.24, aa,
                                      'hull_white' if k % 3 else accent))
    r0 = spoke_r0 if spoke_r0 is not None else 0.0
    for k, a in enumerate(spokes):
        L = ri + 0.05 - r0
        tube = G.cyl(f'{name}Sp{k}', spoke_rad, L, 'hull_light', loc=(r0 + L / 2, 0, z), axis='X', verts=8)
        G.transform(tube, rot=(0, 0, a))
        rot.append(tube)
        n = max(2, int(L / 0.9))
        for j in range(n + 1):
            rr = r0 + 0.25 + (L - 0.5) * j / n
            rot.append(K.rbox(f'{name}SpB{k}{j}', rr - 0.07, rr + 0.07, spoke_rad + 0.025, z - spoke_rad - 0.025,
                              z + spoke_rad + 0.025, a, accent if j in (0, n) else 'hull_mid'))
            if 0 < j < n:
                lp = G.box(f'{name}SpL{k}{j}', rr + 0.2, rr + 0.27, -0.04, 0.04, z + spoke_rad - 0.02,
                           z + spoke_rad + 0.04, 'window_warm')
                G.transform(lp, rot=(0, 0, a))
                rot.append(lp)
        pipe = G.cyl(f'{name}SpP{k}', 0.06, L, 'metal_bare', loc=(r0 + L / 2, spoke_rad + 0.1, z + 0.03), axis='X',
                     verts=6)
        G.transform(pipe, rot=(0, 0, a))
        rot.append(pipe)
    if collar_hub:
        c0, c1, cz0, cz1 = collar_hub
        rot.append(G.lathe(name + 'Hub', [(cz0, c0), (cz0, c1 - 0.06), (cz0 + 0.08, c1), (cz1 - 0.08, c1),
                                          (cz1, c1 - 0.06), (cz1, c0)], [0, 1, 2, 1, 0],
                           ['hull_dark', 'hull_mid', 'hull_light'], axis='Z', verts=24, closed=False, smooth=False))
        rot.append(G.ring_band(name + 'HubBand', c1 + 0.015, c1 - 0.04, (cz0 + cz1) / 2 - 0.05,
                               (cz0 + cz1) / 2 + 0.05, accent, verts=24, smooth=False))
        rot += K.ring_lights(name + 'HubL', c1 - 0.03, cz1, 12, 'light_amber', s=0.035, h=0.035, a0=15)
    return rot


def arm_dtl(name, x0, R, w=1.5, gantry=True, z0=-0.55, z1=0.18, accent='accent_iron', ribs=None):
    """Docking arm along +X (x0 .. R-2.2): core, chamfered deck, side walkway
    tubes with windows, runway lights, rib collars, under girder, optional
    approach gantry at x = R - 2.7 carrying beacons 0/1.  Returns (parts,
    [red_pos, green_pos])."""
    x1 = R - 2.2
    st = []
    st.append(G.box(name + 'Core', x0, x1, -w / 2, w / 2, z0, z1 - 0.22, 'hull_dark', bevel=0.05, seg=1))
    st.append(G.prism(name + 'Deck', G.chamfer_rect(x0, x1, -w / 2 + 0.06, w / 2 - 0.06, 0.18), z1 - 0.26, z1,
                      'hull_light', bevel=0.03, seg=1))
    st.append(G.box(name + 'Mid', x0 + 0.3, x1 - 0.35, -0.17, 0.17, z1 - 0.01, z1 + 0.03, 'hull_mid'))
    L = x1 - x0
    for s in (1, -1):
        y = s * (w / 2 + 0.12)
        st.append(G.cyl(f'{name}Tube{s}', 0.13, L - 0.5, 'hull_light', loc=((x0 + x1) / 2 - 0.1, y, z0 + 0.25),
                        axis='X', verts=8))
        st.append(G.box(f'{name}TubeWin{s}', x0 + 0.4, x1 - 0.7, y + s * 0.115 - 0.02, y + s * 0.115 + 0.02,
                        z0 + 0.21, z0 + 0.29, 'window_warm'))
        st.append(G.box(f'{name}Belt{s}', x0, x1, s * w / 2 - 0.04, s * w / 2 + 0.04, z0 + 0.1, z0 + 0.18, accent))
        st += K.light_row(f'{name}Run{s}', (x0 + 0.35, s * (w / 2 - 0.18), z1 - 0.01),
                          (x1 - 0.35, s * (w / 2 - 0.18), z1 - 0.01), max(3, int(L / 0.75)), 'engine_glow',
                          s=0.065, h=0.04)
    n = ribs or max(2, int(L / 1.3))
    for i in range(n):
        x = x0 + 0.5 + i * (L - 1.0) / max(1, n - 1)
        st.append(G.box(f'{name}Rib{i}', x - 0.09, x + 0.09, -w / 2 - 0.24, w / 2 + 0.24, z0 - 0.06, z1 - 0.2,
                        'hull_mid', bevel=0.03, seg=1))
        st.append(G.box(f'{name}RibA{i}', x - 0.1, x + 0.1, -w / 2 - 0.25, w / 2 + 0.25, z0 + 0.22, z0 + 0.3, accent))
    st += K.box_truss(name + 'Gird', (x0 + 0.2, 0, z0 - 0.28), (x1 - 0.4, 0, z0 - 0.28), w=w * 0.5, h=0.38,
                      bar_w=0.06, mat='hull_dark', rung_mat='hull_mid')
    st.append(G.box(name + 'Mount', x1 - 0.3, x1, -w / 2 - 0.25, w / 2 + 0.25, z0 - 0.1, z1 + 0.02, 'hull_dark',
                    bevel=0.05, seg=1))
    if gantry:
        gx = R - 2.7
        yl = w / 2 + 0.16
        for s in (1, -1):
            st.append(G.box(f'{name}GLeg{s}', gx - 0.14, gx + 0.14, s * yl - 0.1, s * yl + 0.1, z0, 1.05,
                            'hull_mid', bevel=0.03, seg=1))
            st.append(G.box(f'{name}GAcc{s}', gx - 0.15, gx + 0.15, s * yl - 0.11, s * yl + 0.11, 0.45, 0.58, accent))
            st.append(G.box(f'{name}GCap{s}', gx - 0.11, gx + 0.11, s * yl - 0.11, s * yl + 0.11, 1.2, 1.27,
                            'hull_dark'))
        st.append(G.box(name + 'GTop', gx - 0.17, gx + 0.17, -yl - 0.1, yl + 0.1, 1.0, 1.2, 'hull_light', bevel=0.03,
                        seg=1))
        st += K.light_row(name + 'GL', (gx + 0.18, -yl + 0.25, 1.05), (gx + 0.18, yl - 0.25, 1.05), 4, 'engine_glow',
                          s=0.05, h=0.09)
        bpos = [(gx, yl, 1.48), (gx, -yl, 1.48)]
    else:
        yb = w / 2 + 0.2
        for s in (1, -1):
            st.append(G.box(f'{name}BPost{s}', R - 2.72, R - 2.48, s * yb - 0.1, s * yb + 0.1, z0 + 0.1, z1 - 0.05,
                            'hull_dark'))
        bpos = [(R - 2.6, yb, z1 + 0.15), (R - 2.6, -yb, z1 + 0.15)]
    return st, bpos


def arm_zone(z, x0, R, w, z1):
    """The dock arm deck is a walkway (functional surface): no greebles on top."""
    return z.functional(x0 - 0.1, R, -w / 2 + 0.02, w / 2 - 0.02, z1 - 0.06)


def _std_zones(R, rotor_annuli=()):
    z = GR.Zones()
    if R:
        z.box(R - 2.5, R + 20, -1.7, 1.7, -3, 9)
    for a in rotor_annuli:
        z.annulus(*a)
    return z


def _beacon_zones(z, beacons):
    for (x, y, zz), _ in beacons:
        z.cyl(x, y, 0.4, zz - 0.4, zz + 0.4)
    return z


def _rows(levels, hh=0.08):
    return [(z, hh) for z in levels]


def _cfg(rows=(), panels=True, cell=1.0, density=1.0, **kw):
    c = dict(panels=panels, panel_cell=cell, rows=_rows(rows), scatter=[dict(density=density)])
    c.update(kw)
    return c


def _container_dtl(name, x, y, z, sx, sy, sz, key, rot=0.0):
    """Shipping container with corrugation ribs, corner castings and a door end."""
    out = [G.box(name, -sx / 2, sx / 2, -sy / 2, sy / 2, 0, sz, key, bevel=0.025, seg=1)]
    n = max(2, int(sx / 0.18))
    for k in range(n):
        f = -sx / 2 + 0.08 + (sx - 0.16) * (k + 0.5) / n
        out.append(G.box(f'{name}R{k}', f - 0.025, f + 0.025, -sy / 2 - 0.015, sy / 2 + 0.015, 0.06, sz - 0.06,
                         'hull_dark' if k % 2 else key))
    for cx in (-1, 1):
        for cy in (-1, 1):
            xa, xb = (sx / 2 - 0.07, sx / 2 + 0.005) if cx > 0 else (-sx / 2 - 0.005, -sx / 2 + 0.07)
            ya, yb = (sy / 2 - 0.07, sy / 2 + 0.005) if cy > 0 else (-sy / 2 - 0.005, -sy / 2 + 0.07)
            out.append(G.box(f'{name}C{cx}{cy}', xa, xb, ya, yb, sz - 0.06, sz + 0.012, 'trim_black'))
    out.append(G.box(name + 'Door', sx / 2 - 0.01, sx / 2 + 0.02, -sy / 2 + 0.08, sy / 2 - 0.08, 0.08, sz - 0.08,
                     'hull_dark'))
    for o in out:
        G.transform(o, loc=(x, y, z), rot=(0, 0, rot))
    return out


# ----------------------------------------------------------------------------
# station A - trade (R = 10): hub + cargo carousel ring + container yard
# ----------------------------------------------------------------------------
def build_a(atlas_dir, seed=1001):
    R = S.LAYOUTS['station_a']['R']
    rng = random.Random(seed)
    st = []
    st += hub_dtl('Hub', 3.3, -1.8, 1.5, accent='accent_trader', groove=(0.52, 1.28, 2.62), flange_z=-0.45)
    st.append(_lathe('Tower', [(1.5, 2.2), (1.85, 2.2), (1.9, 1.75), (2.45, 1.62), (2.6, 1.3), (2.85, 1.15),
                               (2.9, 0.0)],
                     ['hull_mid', 'hull_dark', 'glass_cockpit', 'hull_light', 'hull_mid', 'hull_light'], verts=16))
    st.append(G.ring_band('TowerWin', 2.24, 2.15, 1.6, 1.7, 'window_warm', verts=16, smooth=False))
    for i in range(8):
        b = G.box(f'TMull{i}', 1.62, 1.82, -0.035, 0.035, 1.92, 2.42, 'hull_mid')
        G.transform(b, rot=(0, 0, i * 45 + 22.5))
        st.append(b)
    st += S.mast('Antenna', (0, 0, 2.88), 1.1, r=0.08)
    st += S.mast('AntennaB', (0.6, -0.5, 2.8), 0.6, r=0.05, dish=0.4)
    arm, bpos = arm_dtl('Arm', 3.6, R, w=1.5, gantry=False, z0=-0.6, z1=0.12)
    bpos = [(x, y, 0.05) for x, y, _ in bpos]          # under the carousel sweep (pods from z 0.45)
    st += arm
    # container yard (-X): stacked containers (double only outside the rotor sweep), yard crane
    st += S.deck_block('Yard', -9.0, -4.2, -3.1, 3.1, -1.1, -0.45, accent='accent_trader')
    k = 0
    for i, x in enumerate((-8.3, -7.0, -5.7)):
        for j, y in enumerate((-2.25, -0.75, 0.75, 2.25)):
            hgt = 2 if (i == 0 and (j in (1, 2) or rng.random() < 0.5)) else 1
            for lvl in range(hgt):
                st += _container_dtl(f'Box{i}{j}{lvl}', x, y, -0.45 + lvl * 0.62, 1.1, 1.3, 0.6,
                                     S.CONTAINER_KEYS[k % len(S.CONTAINER_KEYS)])
                k += 1
    for s in (1, -1):   # yard crane (outside the carousel sweep)
        st.append(G.box(f'YCLeg{s}', -9.25, -8.95, s * 3.0 - 0.15, s * 3.0 + 0.15, -1.1, 1.6, 'accent_trader',
                        bevel=0.03, seg=1))
    st.append(G.box('YCBeam', -9.3, -8.9, -3.2, 3.2, 1.5, 1.8, 'hull_light', bevel=0.03, seg=1))
    st.append(G.box('YCTrolley', -9.35, -8.85, 0.6, 1.2, 1.3, 1.5, 'hull_dark'))
    st += K.light_row('YCL', (-8.88, -2.6, 1.5), (-8.88, 2.6, 1.5), 6, 'light_amber', s=0.05, h=0.06)
    # side pods (trade offices) on +-Y
    for s in (1, -1):
        y0, y1 = (2.9, 4.5) if s > 0 else (-4.5, -2.9)
        st += S.deck_block(f'Pod{s}', -1.3, 1.3, y0, y1, -1.4, -0.25, accent='accent_trader')
        ys = y1 if s > 0 else y0
        st.append(G.box(f'PodSign{s}', -0.8, 0.8, ys - 0.05, ys + 0.05, -0.95, -0.7, 'accent_trader'))
    # rotor: cargo carousel ring + hanging cargo pods
    rot = ring_dtl('Ring', 6.3, 1.1, 0.8, 0.9, collars=8, spokes=(22.5, 112.5, 202.5, 292.5), spoke_r0=3.2,
                   spoke_rad=0.17, accent='accent_trader', verts=48, collar_hub=(2.66, 3.22, 0.56, 1.24))
    for i in range(8):
        a = 22.5 + i * 45
        ar = math.radians(a)
        rot += _container_dtl(f'Pod{i}', 7.25 * math.cos(ar), 7.25 * math.sin(ar), 0.45, 0.8, 1.2, 0.85,
                              S.CONTAINER_KEYS[i % 4], rot=a)
        rot.append(K.rbox(f'PodArm{i}', 6.75, 6.95, 0.12, 0.75, 1.05, a, 'hull_dark'))
    beacons = [(bpos[0], 'light_red'), (bpos[1], 'light_green'), ((0, 0, 4.15), 'light_white'),
               ((-9.1, 3.2, 1.95), 'light_amber'), ((-9.1, -3.2, 1.95), 'light_amber')]
    zones = _beacon_zones(_std_zones(R, [(5.55, 8.0, 0.32, 9.0), (2.55, 5.8, 0.55, 1.3)]), beacons)
    arm_zone(zones, 3.6, R, 1.5, 0.12)
    rz = GR.Zones().annulus(7.75, 99, -9, 9).cyl(0, 0, 2.6, -9, 9)
    rcfg = dict(panels=True, panel_cell=0.8, panel_min_area=0.4, rows=_rows((0.9,)),
                scatter=[dict(density=1.0, side=0.6)])
    root, _ = K.finish('Station_A', st, atlas_dir, R, beacons, rot, (0, 0, 0), style='trade', seed=seed, zones=zones,
                       rotor_zones=rz, static_cfg=_cfg((-1.05, -0.65, 0.0, 1.0, 1.95)), rotor_cfg=rcfg,
                       beacon='cage')
    return root


# ----------------------------------------------------------------------------
# station B - ice refinery (R = 10)
# ----------------------------------------------------------------------------
def build_b(atlas_dir, seed=2002):
    R = S.LAYOUTS['station_b']['R']
    st = []
    st += hub_dtl('Hub', 3.0, -1.8, 1.2, flange_z=-0.5)
    st.append(_lathe('Refinery', [(1.2, 1.45), (1.6, 1.42), (1.65, 1.25), (3.55, 1.12), (3.7, 1.3), (3.9, 1.0),
                                  (4.3, 0.75), (4.35, 0.0)],
                     ['hull_mid', 'hull_dark', 'hull_light', 'hull_dark', 'accent_iron', 'hull_mid', 'hull_dark'],
                     verts=16))
    for i, z in enumerate((1.8, 2.75, 3.3)):
        st.append(G.ring_band(f'Vent{i}', 1.27 - 0.02 * i, 1.08, z, z + 0.12, 'vein_ice', verts=16, smooth=False))
    for i in range(8):   # ice pipes up the tower
        a = math.radians(i * 45 + 22.5)
        st.append(G.cyl(f'TPipe{i}', 0.06, 2.0, 'metal_bare', loc=(1.28 * math.cos(a), 1.28 * math.sin(a), 2.65),
                        verts=6))
    st += S.mast('Stack', (0.0, 0.0, 4.3), 0.9, r=0.18)
    st.append(G.ring_band('StackGlow', 0.24, 0.17, 4.95, 5.05, 'vein_ice', verts=10, smooth=False))
    # ice storage spheres (-X): equator band, walkway ring, legs, cap, feed pipes
    for s in (1, -1):
        y = 3.1 * s
        st.append(G.ellipsoid(f'Sphere{s}', 1.9, 1.9, 1.7, 'ice_crust_blue', loc=(-4.8, y, -0.1), seg=20, rings=10,
                              smooth=False))
        st.append(G.ring_band(f'SphereBand{s}', 1.97, 1.82, -0.25, 0.05, 'vein_ice', loc=(-4.8, y, 0), verts=20,
                              smooth=False))
        st.append(G.ring_band(f'SphereWalk{s}', 2.12, 1.9, -0.42, -0.3, 'hull_mid', loc=(-4.8, y, 0), verts=20,
                              smooth=False))
        for k in range(6):
            a = math.radians(k * 60 + 30)
            lg = G.box(f'SphereLeg{s}{k}', -0.1, 0.1, -0.1, 0.1, -2.0, -0.3, 'hull_dark')
            G.transform(lg, loc=(-4.8 + 1.6 * math.cos(a), y + 1.6 * math.sin(a), 0))
            st.append(lg)
        st.append(G.ellipsoid(f'SphereCap{s}', 0.45, 0.45, 0.22, 'hull_light', loc=(-4.8, y, 1.55), seg=10, rings=4,
                              upper_only=True))
        st.append(G.cyl(f'Pipe{s}', 0.16, 2.6, 'metal_bare', loc=(-2.6, y * 0.55, 0.3), axis='X', verts=8))
        st.append(G.cyl(f'PipeB{s}', 0.1, 2.6, 'accent_iron', loc=(-2.6, y * 0.55 + 0.32 * s, 0.1), axis='X', verts=6))
        for k in range(3):
            x = -3.6 + k * 0.9
            st.append(G.box(f'PipeBr{s}{k}', x - 0.06, x + 0.06, y * 0.55 - 0.3, y * 0.55 + 0.3, -0.1, 0.42,
                            'hull_dark'))
    # processing block (+Y) with cooling fins + glow
    st += S.deck_block('Proc', -1.6, 2.2, 3.2, 6.9, -1.5, 0.6)
    for k in range(7):
        x = -1.25 + k * 0.55
        st.append(G.box(f'Fin{k}', x - 0.06, x + 0.06, 3.6, 6.5, 0.6, 1.35, 'hull_white' if k % 3 else 'accent_iron',
                        bevel=0.015, seg=1))
        if k < 6:
            st.append(G.box(f'FinGlow{k}', x + 0.2, x + 0.35, 3.8, 6.3, 0.58, 0.64, 'vein_ice'))
    # radiator wing (-Y) on a box truss
    st += K.box_truss('RadSpine', (0.3, -2.8, -0.6), (0.3, -7.2, -0.6), w=0.6, h=0.45, bar_w=0.07, mat='hull_dark',
                      rung_mat='hull_mid')
    for k in range(4):
        y = -3.6 - k * 1.0
        st += K.solar_array(f'Rad{k}', -1.6, 2.4, y - 0.4, y + 0.4, -0.3, cols=6, rows=1, frame='hull_mid',
                            cell='hull_white' if k % 2 else 'hull_light')
        st.append(G.box(f'RadStripe{k}', 2.2, 2.4, y - 0.38, y + 0.38, -0.26, -0.22, 'accent_iron'))
    arm, bpos = arm_dtl('Arm', 2.9, R, w=1.5, gantry=True)
    st += arm
    rot = ring_dtl('Centrifuge', 2.0, 0.5, 0.45, 2.3, collars=6, roofs=False, verts=32)
    rot += K.ring_lights('CfL', 2.26, 2.3, 6, 'vein_ice', s=0.04, h=0.05, a0=30)
    beacons = [(bpos[0], 'light_red'), (bpos[1], 'light_green'), ((0, 0, 5.3), 'light_red'),
               ((-4.8, 3.1, 1.95), 'light_amber'), ((-4.8, -3.1, 1.95), 'light_amber')]
    zones = _beacon_zones(_std_zones(R, [(1.45, 2.55, 1.9, 2.75)]), beacons)
    arm_zone(zones, 2.9, R, 1.5, 0.18)
    zones.cyl(0, 0, 0.5, 4.2, 9)
    rz = GR.Zones().cyl(0, 0, 1.6, -9, 9).annulus(2.45, 99, -9, 9)
    rcfg = dict(panels=False, rows=(), scatter=[dict(density=0.8, side=0.6)])
    root, _ = K.finish('Station_B', st, atlas_dir, R, beacons, rot, (0, 0, 2.3), style='refinery', seed=seed,
                       zones=zones, rotor_zones=rz, static_cfg=_cfg((-1.05, -0.65, 0.0, 0.3)), rotor_cfg=rcfg,
                       beacon='cage')
    return root


# ----------------------------------------------------------------------------
# station C - shipyard with a portal crane (R = 10)
# ----------------------------------------------------------------------------
def build_c(atlas_dir, seed=3003):
    R = S.LAYOUTS['station_c']['R']
    st = []
    st += hub_dtl('Hub', 2.9, -1.6, 1.3, verts=20, flange_z=-0.3, loc=(-6.0, 0, 0))
    st += S.mast('Antenna', (-6.0, 0, 1.3), 1.4, r=0.08, dish=0.5)
    st += S.mast('AntennaB', (-6.9, 1.0, 1.3), 0.8, r=0.05)
    # dry-dock bay: floor grid, guide lamps, hazard edges, walls with tool arms
    st.append(G.box('Bay', -3.0, 5.0, -2.2, 2.2, -1.2, -0.65, 'floor_dark', bevel=0.05, seg=1))
    for k in range(9):
        x = -2.6 + k * 0.9
        st.append(G.box(f'BayLine{k}', x - 0.02, x + 0.02, -1.95, 1.95, -0.66, -0.63, 'panel_line'))
        if k % 2 == 0:
            for s in (1, -1):
                st.append(G.box(f'BayLamp{k}{s}', x - 0.05, x + 0.05, s * 1.9 - 0.05, s * 1.9 + 0.05, -0.66, -0.6,
                                'engine_glow'))
    for s in (1, -1):
        st.append(G.box(f'BayEdge{s}', -3.0, 5.0, 2.0 * s - 0.15, 2.0 * s + 0.15, -0.7, -0.6, 'accent_iron'))
        st += S.deck_block(f'Wall{s}', -2.6, 5.4, 2.3 * s if s > 0 else -3.5, 3.5 if s > 0 else -2.3, -1.4, 0.5)
        st += K.light_row(f'WallL{s}', (-2.2, s * 2.27, 0.15), (5.0, s * 2.27, 0.15), 9, 'light_white', s=0.05,
                          h=0.05)
        for k in range(4):
            x = -1.5 + k * 1.9
            st.append(K.bar(f'ToolArm{s}{k}', (x, s * 2.4, 0.35), (x + 0.5, s * 1.6, 0.0), 0.09, 'accent_iron'))
            st.append(G.box(f'ToolHead{s}{k}', x + 0.42, x + 0.62, s * 1.6 - 0.1, s * 1.6 + 0.1, -0.12, 0.08,
                            'hull_dark'))
            st.append(G.box(f'ToolTip{s}{k}', x + 0.48, x + 0.56, s * 1.6 - 0.04, s * 1.6 + 0.04, -0.2, -0.12,
                            'light_amber'))
    st.append(G.box('BayBack', -3.6, -2.6, -2.3, 2.3, -1.4, 0.3, 'hull_dark', bevel=0.05, seg=1))
    # portal crane: lattice towers + bridge + cab + trolley + hook
    for s in (1, -1):
        y = 3.0 * s
        st += K.box_truss(f'CraneLeg{s}', (1.1, y, 0.5), (1.1, y, 4.15), w=0.8, h=0.7, bar_w=0.09, mat='accent_iron',
                          rung_mat='hull_dark')
        st.append(G.box(f'CraneFoot{s}', 0.55, 1.65, y - 0.5, y + 0.5, 0.45, 0.62, 'hull_dark', bevel=0.03, seg=1))
    st.append(G.box('Bridge', 0.5, 1.7, -3.5, 3.5, 4.1, 4.7, 'hull_light', bevel=0.06, seg=1))
    st.append(G.box('BridgeStripe', 0.45, 1.75, -3.3, 3.3, 4.32, 4.45, 'trim_black'))
    for k in range(7):
        y = -3.0 + k
        st.append(G.box(f'BridgeHaz{k}', 0.44, 1.76, y - 0.12, y + 0.12, 4.33, 4.44, 'accent_iron'))
    st.append(G.box('CraneCab', 1.7, 2.3, 2.2, 2.9, 4.0, 4.6, 'hull_white', bevel=0.03, seg=1))
    st.append(G.box('CraneCabWin', 2.28, 2.33, 2.3, 2.8, 4.25, 4.45, 'glass_cockpit'))
    st.append(G.box('Trolley', 0.6, 1.6, 0.4, 1.3, 3.75, 4.15, 'hull_dark', bevel=0.04, seg=1))
    st.append(G.cyl('Cable', 0.03, 2.2, 'metal_bare', loc=(1.1, 0.85, 2.65), verts=6))
    st.append(G.cyl('CableB', 0.03, 2.2, 'metal_bare', loc=(1.0, 0.75, 2.65), verts=6))
    st.append(G.box('Hook', 0.85, 1.35, 0.6, 1.1, 1.35, 1.55, 'accent_iron'))
    st.append(G.box('WorkLight', 0.6, 1.6, -2.6, 2.6, 4.02, 4.1, 'light_white'))
    # hull under construction: keel, frames, partial plating, welding sparks
    for k in range(7):
        x = -1.9 + k * 0.85
        st.append(G.box(f'Frame{k}', x - 0.1, x + 0.1, -1.2, 1.2, -0.6, -0.42, 'hull_mid'))
        st.append(G.box(f'FrameUp{k}L', x - 0.08, x + 0.08, 1.05, 1.22, -0.6, 0.35, 'hull_mid'))
        st.append(G.box(f'FrameUp{k}R', x - 0.08, x + 0.08, -1.22, -1.05, -0.6, 0.35, 'hull_mid'))
        st.append(G.box(f'FrameTop{k}', x - 0.06, x + 0.06, -1.15, 1.15, 0.3, 0.38, 'hull_dark'))
    st.append(G.box('Keel', -2.2, 3.6, -0.25, 0.25, -0.65, -0.35, 'accent_iron'))
    st.append(G.box('PlatingL', 1.6, 3.6, 1.0, 1.25, -0.55, 0.32, 'hull_light'))
    st.append(G.box('PlatingR', 2.4, 3.6, -1.25, -1.0, -0.55, 0.32, 'hull_light'))
    st.append(G.box('PlatingTop', 2.5, 3.5, -1.1, 1.1, 0.3, 0.4, 'hull_light'))
    for k, (x, y, z) in enumerate(((1.55, 1.05, 0.1), (2.35, -1.0, -0.2), (0.3, 1.1, 0.33))):
        st.append(G.ellipsoid(f'Spark{k}', 0.07, 0.07, 0.07, 'engine_core', loc=(x, y, z), seg=6, rings=4))
    arm, bpos = arm_dtl('Arm', 5.0, R, w=1.5, gantry=True)
    st += arm
    beacons = [(bpos[0], 'light_red'), (bpos[1], 'light_green'), ((1.1, 3.0, 4.95), 'light_amber'),
               ((1.1, -3.0, 4.95), 'light_amber'), ((-6.0, 0, 2.95), 'light_white')]
    zones = _beacon_zones(_std_zones(R), beacons)
    zones.functional(-2.9, 4.9, -2.05, 2.05, -0.65)      # dry-dock build floor stays clear
    arm_zone(zones, 5.0, R, 1.5, 0.18)
    root, _ = K.finish('Station_C', st, atlas_dir, R, beacons, style='shipyard', seed=seed, zones=zones,
                       static_cfg=_cfg((-1.0, -0.5, 0.05)), beacon='cage')
    return root


# ----------------------------------------------------------------------------
# outposts (R = 6)
# ----------------------------------------------------------------------------
def build_outpost_a(atlas_dir, seed=4004):
    R = S.LAYOUTS['outpost_a']['R']
    st = []
    L, r = 2.6, 1.35
    prof = [(-L - r, 0.0), (-L - r * 0.7, r * 0.7), (-L - 0.1, r), (L, r), (L + r * 0.5, r * 0.75), (L + r * 0.7, 0.0)]
    st.append(G.lathe('Hab', prof, [0, 0, 1, 2, 2], ['hull_mid', 'hull_light', 'hull_dark'], loc=(-1.4, 0, 0),
                      axis='X', verts=16, closed=False, smooth=False))
    for i, x in enumerate((-3.6, -2.2, -0.6, 0.8)):
        st.append(G.ring_band(f'Band{i}', r + 0.08, r - 0.05, -0.12, 0.12, 'accent_iron' if i % 2 == 0 else 'hull_mid',
                              loc=(x, 0, 0), axis='X', verts=16, smooth=False))
    st.append(G.box('Belly', -4.0, 1.2, -0.7, 0.7, -1.6, -1.0, 'hull_dark', bevel=0.05, seg=1))
    st.append(G.box('Spine', -3.8, 0.9, -0.28, 0.28, 1.28, 1.48, 'hull_mid', bevel=0.03, seg=1))
    for s in (1, -1):
        st.append(G.box(f'WingArm{s}', -2.15, -1.85, 1.1 * s if s > 0 else -2.0, 2.0 if s > 0 else -1.1, -0.1, 0.1,
                        'metal_bare'))
        st += K.rotator(f'WRot{s}', (-2.0, s * 1.75, 0.0), r=0.14, L=0.3, axis='Y')
        st += K.solar_array(f'Solar{s}', -3.3, -0.7, 2.0 if s > 0 else -4.6, 4.6 if s > 0 else -2.0, 0.0, cols=3,
                            rows=4)
    st += S.mast('Antenna', (-3.4, 0, 1.2), 1.0, r=0.06, dish=0.4)
    arm, bpos = arm_dtl('Arm', 1.4, R, w=1.3, gantry=False, z0=-0.5, z1=0.15)
    st += arm
    beacons = [(bpos[0], 'light_red'), (bpos[1], 'light_green'), ((-3.4, 0, 2.35), 'light_amber')]
    zones = arm_zone(_beacon_zones(_std_zones(R), beacons), 1.4, R, 1.3, 0.15)
    root, _ = K.finish('Outpost_A', st, atlas_dir, R, beacons, style='outpost', seed=seed, zones=zones,
                       static_cfg=_cfg((), panels=False, density=1.2), beacon='cage')
    return root


def build_outpost_b(atlas_dir, seed=5005):
    R = S.LAYOUTS['outpost_b']['R']
    st = []
    hb = hub_dtl('Hub', 2.4, -1.4, 0.95, verts=12, flange_z=-0.55, spire=0.5)
    for o in hb:
        G.apply_modifiers(o)
        G.bake_transform(o)
        o.data.transform(Matrix.Translation((-0.6, 0, 0)) @ Matrix.Rotation(math.radians(15), 4, 'Z'))
    st += hb
    st.append(G.ellipsoid('Dome', 1.25, 1.25, 0.85, 'glass_cockpit', loc=(-0.6, 0, 0.95), seg=12, rings=6,
                          upper_only=True))
    for j in range(3):
        rb = G.box(f'DomeRib{j}', -0.025, 0.025, -1.25, 1.25, 0.95, 1.05, 'hull_mid')
        G.transform(rb, loc=(-0.6, 0, 0), rot=(0, 0, j * 60))
        st.append(rb)
    for s in (1, -1):
        st += S.vtank(f'Tank{s}', (-3.0, 2.2 * s, -0.2), 0.75, 2.0)
        st.append(G.cyl(f'TankPipe{s}', 0.07, 1.3, 'metal_bare', loc=(-2.3, 1.55 * s, -0.5), axis='X', verts=6))
    st.append(G.box('TankRack', -3.6, -2.4, -2.6, 2.6, -1.3, -1.0, 'hull_dark', bevel=0.04, seg=1))
    st += S.mast('Antenna', (0.2, 1.4, 0.95), 1.4, r=0.07, dish=0.45)
    st += K.solar_array('Radiator', -1.0, 0.4, -3.3, -2.1, -0.35, cols=3, rows=1, cell='hull_white')
    st.append(G.box('RadiatorStripe', 0.25, 0.4, -3.3, -2.1, -0.3, -0.25, 'accent_iron'))
    st.append(G.box('RadArm', -0.4, -0.2, -2.2, -1.4, -0.45, -0.3, 'hull_dark'))
    arm, bpos = arm_dtl('Arm', 1.6, R, w=1.3, gantry=False, z0=-0.5, z1=0.15)
    st += arm
    beacons = [(bpos[0], 'light_red'), (bpos[1], 'light_green'), ((0.2, 1.4, 2.55), 'light_amber')]
    zones = arm_zone(_beacon_zones(_std_zones(R), beacons), 1.6, R, 1.3, 0.15)
    root, _ = K.finish('Outpost_B', st, atlas_dir, R, beacons, style='outpost', seed=seed, zones=zones,
                       static_cfg=_cfg((-0.95, -0.25), cell=0.9, density=1.2),
                       beacon='cage')
    return root


# ----------------------------------------------------------------------------
# docking clamp, detail pass 1 (superseded by the v2 build_clamp below, kept for reference)
# ----------------------------------------------------------------------------
def build_clamp_dtl1(atlas_dir, seed=6006):
    rng = random.Random(seed)
    st = []
    st.append(G.box('Base', -2.4, -0.3, -1.5, 1.5, -0.5, -0.25, 'hull_dark', bevel=0.05, seg=1))
    st.append(G.prism('BasePlate', G.chamfer_rect(-2.3, -0.4, -1.4, 1.4, 0.3), -0.3, -0.18, 'hull_light',
                      bevel=0.03, seg=1))
    for s in (1, -1):
        y = 1.15 * s
        st.append(G.box(f'Prong{s}', -2.2, 0.55, y - 0.28, y + 0.28, -0.45, 0.2, 'accent_iron', bevel=0.06, seg=1))
        st.append(G.box(f'ProngTip{s}', 0.3, 0.6, y - 0.32, y + 0.32, -0.5, 0.26, 'hull_dark', bevel=0.04, seg=1))
        st.append(G.box(f'Pad{s}', -1.6, 0.2, y - 0.3 * s - 0.08, y - 0.3 * s + 0.08, -0.2, 0.05, 'trim_black'))
        # hydraulic ram + hazard ticks on the outer flank, grille on the tip
        st.append(G.cyl(f'Ram{s}', 0.07, 1.2, 'metal_bare', loc=(-1.2, y + 0.33 * s, -0.15), axis='X', verts=8))
        st.append(G.cyl(f'RamB{s}', 0.1, 0.5, 'hull_mid', loc=(-1.9, y + 0.33 * s, -0.15), axis='X', verts=8))
        for k in range(5):
            b = G.box(f'Tick{s}{k}', -0.06, 0.06, -0.02, 0.02, -0.22, 0.12, 'trim_black')
            G.transform(b, loc=(-1.9 + k * 0.5, y + 0.29 * s, 0.0), rot=(0, 30, 0))
            st.append(b)
        st.append(G.box(f'ProngGrille{s}', 0.33, 0.57, y - 0.2, y + 0.2, 0.26, 0.29, 'trim_black'))
    st.append(G.box('Back', -2.4, -1.9, -1.45, 1.45, -0.45, 0.35, 'hull_mid', bevel=0.05, seg=1))
    st.append(G.box('BackGlow', -1.95, -1.88, -0.9, 0.9, -0.05, 0.15, 'engine_glow'))
    kit = GR.Kit()
    for y in (-0.95, -0.35, 0.35, 0.95):
        GR.g_vent(kit, GR.top_frame((-2.15, y, 0.35), (0, 1, 0)), 0.2, 0.12, rng, GR.STYLES['home'], 'hull_mid')
    st.append(kit.obj('ClampKit'))
    zones = GR.Zones().functional(-2.0, 0.75, -0.9, 0.9, -0.18)   # cradle floor stays clear (docked ship)
    cfg = dict(panels=True, panel_cell=0.6, panel_min_area=0.4, rows=(), scatter=[dict(density=1.6)])
    root, _ = K.finish('Dock_Clamp', st, atlas_dir, 0, (), style='home', seed=seed, zones=zones, static_cfg=cfg,
                       weather_cfg=dict(near=0.25, far=1.2))
    for i, x in enumerate((-1.6, -0.95, -0.3, 0.35)):
        lamps = [G.box(f'L{i}{s}', x - 0.13, x + 0.13, 1.15 * s - 0.1, 1.15 * s + 0.1, 0.18, 0.27,
                       'engine_glow', bevel=0.02, seg=1) for s in (1, -1)]
        gl = G.join(lamps, f'guide_light_{i}')
        G.finalize(gl, atlas_dir)
        GR.ensure_col(gl)
        gl.parent = root
    return root


# ----------------------------------------------------------------------------
# docking clamp v2 (batch D, audit D1): hydraulic jaws, pistons, approach light
# ladder, flat cradle floor with an emissive docking-target glyph.
# Contract unchanged: origin = dock_port, cradle opens toward +X, extent
# x -2.4 .. 0.6, y -1.5 .. 1.5, guide_light_0..3 (left+right lamp pair each,
# index grows outward along +X).  New nodes: Clamp_Jaw_L / Clamp_Jaw_R (pivot =
# outer hinge, closed pose = default; open = +35 deg (L) / -35 deg (R) about
# glTF local +Y).
# ----------------------------------------------------------------------------
CLAMP_HINGE = (-0.25, 1.17, -0.15)          # left jaw hinge (right = mirrored y)
CLAMP_GUIDE_X = (-1.95, -1.5, -1.05, -0.6)
CLAMP_RAIL_Y = (0.86, 1.2)


def _clamp_glyph(st):
    """Emissive docking target on the cradle floor: corner brackets, reticle,
    tick marks and two chevrons pointing in toward the station (-X)."""
    z0, z1 = -0.183, -0.176
    g = 'engine_glow'
    x0, x1, y0, y1 = -1.56, -0.19, -0.54, 0.54
    L, w = 0.26, 0.04
    for cx, sx in ((x0, 1), (x1, -1)):
        for cy, sy in ((y0, 1), (y1, -1)):
            xa, xb = sorted((cx, cx + sx * L))
            ya, yb = sorted((cy, cy + sy * w))
            st.append(G.box('GlyLa', xa, xb, ya, yb, z0, z1, g))
            xa, xb = sorted((cx, cx + sx * w))
            ya, yb = sorted((cy, cy + sy * L))
            st.append(G.box('GlyLb', xa, xb, ya, yb, z0, z1, g))
    cx = -0.98
    st.append(G.ring_band('GlyRing', 0.25, 0.205, z0, z1, g, loc=(cx, 0, 0), verts=16, smooth=False))
    for k in range(4):
        b = G.box(f'GlyTick{k}', 0.29, 0.41, -0.018, 0.018, z0, z1, g)
        G.transform(b, loc=(cx, 0, 0), rot=(0, 0, 90 * k))
        st.append(b)
    st.append(G.box('GlyDot', cx - 0.035, cx + 0.035, -0.035, 0.035, z0, z1, g))
    for k, x in enumerate((-0.52, -0.36)):        # chevrons "<" pointing at the station
        for sy in (1, -1):
            b = G.box(f'GlyChev{k}{sy}', 0.0, 0.2, -0.022, 0.022, z0, z1, g)
            G.transform(b, loc=(x, 0, 0), rot=(0, 0, sy * 38))
            st.append(b)


def _clamp_jaw(side, atlas_dir, root, rng):
    """One jaw arm, built around its hinge (local frame), finished to the atlas
    with COLOR_0 AO against the static clamp.  side = +1 left (+Y), -1 right."""
    import bpy
    s = side
    hx, hy, hz = CLAMP_HINGE
    hy *= s
    p = []
    # knuckle around the hinge pin
    p.append(G.cyl('JKnuckle', 0.17, 0.62, 'hull_mid', loc=(0, 0, -0.02), verts=10, smooth=False))
    p.append(G.ring_band('JKnuckleBand', 0.175, 0.12, 0.17, 0.24, 'accent_iron', verts=10, smooth=False))
    # claw body: curves from the hinge forward and inward (toward y = 0)
    outline = [(0.0, 0.19), (0.46, 0.15), (0.72, -0.03), (0.84, -0.3), (0.84, -0.6), (0.62, -0.7),
               (0.56, -0.46), (0.45, -0.29), (0.26, -0.18), (0.0, -0.18)]
    pts = [(x, s * y) for x, y in outline]
    if s > 0:
        pts = list(reversed(pts))
    p.append(G.prism('JBody', pts, -0.34, -0.0, 'hull_dark'))
    inset = [(x * 0.985 + 0.01, s * (y * 0.94)) for x, y in outline]
    if s > 0:
        inset = list(reversed(inset))
    p.append(G.prism('JTop', inset, -0.02, 0.1, 'accent_iron', bevel=0.015, seg=1))
    # two broad hazard bands across the claw near the tip
    for k, (x, y, a) in enumerate(((0.6, -0.1, 52), (0.79, -0.4, 80))):
        b = G.box(f'JHaz{k}', -0.045, 0.045, -0.2, 0.2, 0.095, 0.11, 'trim_black')
        G.transform(b, loc=(x, s * y, 0), rot=(0, 0, s * a))
        p.append(b)
    # rubber grip pad along the inner edge + gripper block at the tip
    inner = [(0.03, -0.2), (0.26, -0.2), (0.45, -0.31), (0.55, -0.47)]
    for k in range(len(inner) - 1):
        a, b_ = inner[k], inner[k + 1]
        p.append(K.bar(f'JPad{k}', (a[0], s * a[1], -0.17), (b_[0], s * b_[1], -0.17), 0.05, 'trim_black', hgt=0.24))
    grip = G.box('JGrip', -0.13, 0.13, -0.09, 0.09, -0.36, 0.12, 'trim_black')
    G.transform(grip, loc=(0.62, s * -0.62, 0), rot=(0, 0, s * -22))
    p.append(grip)
    p.append(G.box('JTipLamp', 0.7, 0.78, s * -0.52 - 0.04, s * -0.52 + 0.04, 0.1, 0.15, 'light_amber'))
    # rod lug + piston rod (slides into the static barrel)
    ly, lz = 0.16, 0.15
    p.append(G.box('JLug', 0.1, 0.3, s * ly - 0.075, s * ly + 0.075, lz - 0.12, lz + 0.08, 'hull_dark'))
    p.append(G.cyl('JRod', 0.042, 0.72, 'metal_bare', loc=(-0.16, s * ly, lz), axis='X', verts=8))
    p.append(G.box('JRodEye', 0.12, 0.22, s * ly - 0.06, s * ly + 0.06, lz - 0.05, lz + 0.05, 'hull_mid'))
    jaw = G.join(p, 'Clamp_Jaw_L' if s > 0 else 'Clamp_Jaw_R')
    # AO against the static clamp (brought into hinge-local space)
    tmp = root.copy()
    tmp.data = root.data.copy()
    bpy.context.scene.collection.objects.link(tmp)
    tmp.data.transform(Matrix.Translation((-hx, -hy, -hz)))
    GR.weather(jaw, rng, extra=[tmp], near=0.18, far=0.9, grime=0.25)
    bpy.data.objects.remove(tmp)
    G.finalize(jaw, atlas_dir)
    jaw.location = (hx, hy, hz)
    jaw.parent = root
    return jaw


def build_clamp(atlas_dir, seed=6106):
    rng = random.Random(seed)
    st = []
    # spine + cradle floor (functional: kept clear) with the target inset
    st.append(G.box('Spine', -2.4, -0.12, -0.98, 0.98, -0.52, -0.24, 'hull_dark', bevel=0.05, seg=1))
    st.append(G.prism('Floor', G.chamfer_rect(-2.02, 0.22, -0.84, 0.84, 0.2), -0.27, -0.19, 'hull_light',
                      bevel=0.02, seg=1))
    st.append(G.box('Target', -1.62, -0.13, -0.6, 0.6, -0.2, -0.184, 'floor_dark'))
    _clamp_glyph(st)
    # front lip with hazard stripes (below the docked ship's corridor)
    st.append(G.box('Lip', 0.05, 0.3, -0.82, 0.82, -0.36, -0.2, 'accent_iron'))
    for k in range(6):
        b = G.box(f'LipHaz{k}', -0.03, 0.03, -0.1, 0.1, -0.205, -0.192, 'trim_black')
        G.transform(b, loc=(0.17, -0.62 + k * 0.25, 0), rot=(0, 0, 40))
        st.append(b)
    y0, y1 = CLAMP_RAIL_Y
    hx, hy, hz = CLAMP_HINGE
    for s in (1, -1):
        ya, yb = (y0, y1) if s > 0 else (-y1, -y0)
        # cradle side rail: wall + cap + outer accent band + inner bumper
        st.append(G.box(f'Rail{s}', -2.3, -0.42, ya, yb, -0.5, 0.06, 'hull_light', bevel=0.04, seg=1))
        st.append(G.box(f'RailCap{s}', -2.26, -0.46, ya + 0.04, yb - 0.04, 0.05, 0.1, 'hull_mid'))
        st.append(G.box(f'RailBand{s}', -2.3, -0.42, s * y1 - 0.015, s * y1 + 0.015, -0.33, -0.2, 'accent_iron'))
        bya, byb = sorted((s * (y0 - 0.03), s * (y0 + 0.005)))
        st.append(G.box(f'RailBump{s}', -2.1, -0.52, bya, byb, -0.17, -0.03, 'trim_black'))
        # guide-light bezels (the lamps are the guide_light_<i> nodes)
        for i, x in enumerate(CLAMP_GUIDE_X):
            st.append(G.box(f'Bezel{s}{i}', x - 0.15, x + 0.15, s * 1.03 - 0.11, s * 1.03 + 0.11, 0.09, 0.125,
                            'hull_dark'))
        # hinge block + pin at the rail front
        hya, hyb = sorted((s * 0.95, s * 1.42))
        st.append(G.box(f'HingeBlk{s}', -0.5, -0.06, hya, hyb, -0.5, -0.18, 'hull_dark'))
        st.append(G.cyl(f'HingePin{s}', 0.055, 0.86, 'metal_bare', loc=(hx, s * hy, -0.06), verts=8))
        st.append(G.cyl(f'HingeCap{s}', 0.09, 0.05, 'hull_mid', loc=(hx, s * hy, 0.37), verts=8))
        # hydraulic piston barrel (static) + bracket + hose
        by = s * 1.33
        st.append(G.cyl(f'Barrel{s}', 0.085, 0.78, 'hull_mid', loc=(-1.06, by, 0.0), axis='X', verts=10))
        st.append(G.ring_band(f'BarrelBand{s}', 0.095, 0.075, -0.05, 0.05, 'accent_iron', loc=(-0.78, by, 0.0),
                              axis='X', verts=10, smooth=False))
        st.append(G.box(f'BarrelCap{s}', -1.5, -1.42, by - 0.1, by + 0.1, -0.1, 0.1, 'hull_dark'))
        mya, myb = sorted((s * 1.18, by))
        st.append(G.box(f'BarrelMnt{s}', -1.52, -1.38, mya, myb, -0.2, -0.04, 'hull_dark'))
        st.append(G.box(f'BarrelMntF{s}', -0.62, -0.52, mya, myb, -0.2, -0.05, 'hull_dark'))
        st.append(K.bar(f'Hose{s}', (-2.08, s * 1.3, -0.2), (-1.5, by, -0.02), 0.045, 'metal_bare'))
    # backstop: status strip toward the cradle, hazard band, roof
    st.append(G.box('Back', -2.4, -2.04, -1.36, 1.36, -0.5, 0.36, 'hull_mid', bevel=0.05, seg=1))
    st.append(G.prism('BackRoof', G.chamfer_rect(-2.37, -2.07, -1.3, 1.3, 0.08), 0.34, 0.42, 'hull_light'))
    st.append(G.box('BackGlow', -2.06, -2.025, -0.72, 0.72, 0.0, 0.13, 'engine_glow'))
    st.append(G.box('BackHazBand', -2.045, -2.03, -0.72, 0.72, -0.2, -0.0, 'accent_iron'))
    for k in range(7):
        b = G.box(f'BackHaz{k}', -0.012, 0.012, -0.05, 0.05, -0.1, 0.1, 'trim_black')
        G.transform(b, loc=(-2.027, -0.6 + k * 0.2, -0.1), rot=(40, 0, 0))
        st.append(b)
    # underside hydraulic manifold
    st.append(G.box('Manifold', -1.8, -0.6, -0.5, 0.5, -0.7, -0.5, 'hull_dark'))
    for s in (1, -1):
        st.append(K.bar(f'MPipe{s}', (-1.2, s * 0.45, -0.62), (-1.45, s * 1.3, -0.24), 0.05, 'metal_bare'))
    kit = GR.Kit()
    for y in (-0.95, -0.35, 0.35, 0.95):
        GR.g_vent(kit, GR.top_frame((-2.22, y, 0.42), (0, 1, 0)), 0.1, 0.1, rng, GR.STYLES['home'], 'hull_light')
    st.append(kit.obj('ClampKit'))
    zones = GR.Zones().functional(-2.04, 0.75, -0.9, 0.9, -0.19)   # cradle floor (docked ship side)
    for s in (1, -1):
        ya, yb = (0.82, 1.5) if s > 0 else (-1.5, -0.82)
        zones.box(-2.32, -0.4, ya, yb, 0.0, 9)                  # rail caps: approach light ladder
        za, zb = sorted((s * 0.25, s * 1.55))
        zones.box(-0.6, 0.7, za, zb, -9, 9)                    # jaw sweep
        za, zb = sorted((s * 1.2, s * 1.55))
        zones.box(-1.56, -0.6, za, zb, -9, 9)                  # piston
    cfg = dict(panels=True, panel_cell=0.55, panel_min_area=0.35, rows=(), scatter=[dict(density=1.0)])
    root, _ = K.finish('Dock_Clamp', st, atlas_dir, 0, (), style='home', seed=seed, zones=zones, static_cfg=cfg,
                       weather_cfg=dict(near=0.25, far=1.2))
    for i, x in enumerate(CLAMP_GUIDE_X):
        lamps = [G.box(f'L{i}{s}', x - 0.11, x + 0.11, s * 1.03 - 0.075, s * 1.03 + 0.075, 0.12, 0.19,
                       'engine_glow', bevel=0.02, seg=1) for s in (1, -1)]
        gl = G.join(lamps, f'guide_light_{i}')
        G.finalize(gl, atlas_dir)
        GR.ensure_col(gl)
        gl.parent = root
    for s in (1, -1):
        _clamp_jaw(s, atlas_dir, root, random.Random(seed + (11 if s > 0 else 23)))
    return root


BUILDERS = {'station_home': build_home, 'station_a': build_a, 'station_b': build_b, 'station_c': build_c,
            'outpost_a': build_outpost_a, 'outpost_b': build_outpost_b, 'dock_clamp': build_clamp}
