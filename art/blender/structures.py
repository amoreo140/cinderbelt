"""Stations, outposts and the docking clamp (M2).

Conventions (same as ship parts): 1 BU = 1 grid cell = 1 game unit, +X = port
direction (the docking arm points +X), +Y = left, +Z = up, z = 0 = gameplay
plane.  Single AF_Palette material.

Node layout of every station/outpost glb:
  <Root>               static structure, origin = station centre
    ring_rotor         (optional) rotating part; pivot = node origin, spins
                       around local Z (Blender) = glTF local +Y
    beacon_<i>         emissive beacon meshes (the game blinks them)
    dock_port          empty at (R, 0, 0): tip of the docking arm on the
                       gameplay plane; dock_clamp.glb is placed here and the
                       docked ship's centre sits at dock_port + (bR + 1) along +X
                       (spec 7.2: pos = station.pos + dir * (R + bR + 1)).

dock_clamp.glb: origin = dock_port; cradle opens toward +X; children
guide_light_0..3 (index grows outward along +X, each node = a left+right
lamp pair) for sequential blinking.

Collision layouts (circles in the station's local XY plane) are defined next
to each builder in LAYOUTS and written to art/blender/data/station_layouts.json.
"""
import math

from lib import geo as G

# ----------------------------------------------------------------------------
# layouts: collision circles (x, y, r), station radius R (dock_port at (R, 0)),
# clearRadius = no asteroids inside (R + 12 = docking gap).
# ----------------------------------------------------------------------------
LAYOUTS = {
    'station_home': dict(R=14.0, circles=[(0, 0, 10.6), (11.2, 0, 1.4), (12.9, 0, 1.15),
                                          (-11.5, 2.4, 2.3), (-11.5, -2.4, 2.3),
                                          # M4 module pylon collars (attach_fl/rl/rr/fr/port/aft)
                                          (7.85, 7.85, 0.9), (-7.85, 7.85, 0.9), (-7.85, -7.85, 0.9),
                                          (7.85, -7.85, 0.9), (0.0, 11.0, 0.9), (-13.6, 0.0, 0.5)]),
    'station_a': dict(R=10.0, circles=[(0, 0, 7.8), (8.0, 0, 1.1), (9.0, 0, 1.0),
                                       (-7.0, 1.6, 2.4), (-7.0, -1.6, 2.4)]),
    'station_b': dict(R=10.0, circles=[(0, 0, 3.3), (-4.8, 3.1, 2.2), (-4.8, -3.1, 2.2),
                                       (0.2, 5.0, 2.3), (0.4, -5.1, 2.2), (5.0, 0, 1.0),
                                       (7.0, 0, 1.0), (9.0, 0, 1.0)]),
    'station_c': dict(R=10.0, circles=[(-6.0, 0, 3.0), (-1.6, 0, 1.6), (1.0, 0, 1.6), (3.6, 0, 1.6),
                                       (-1.2, 2.9, 1.5), (-1.2, -2.9, 1.5),
                                       (1.6, 2.9, 1.5), (1.6, -2.9, 1.5), (4.2, 2.9, 1.2),
                                       (4.2, -2.9, 1.2), (6.0, 0, 1.0), (8.0, 0, 1.0), (9.0, 0, 1.0)]),
    'outpost_a': dict(R=6.0, circles=[(-1.4, 0, 2.0), (-3.6, 0, 1.6), (0.9, 0, 1.4), (3.4, 0, 1.0),
                                      (5.0, 0, 1.0), (-2.0, 3.3, 1.5), (-2.0, -3.3, 1.5)]),
    'outpost_b': dict(R=6.0, circles=[(-0.6, 0, 2.9), (-0.3, -2.9, 0.9), (-3.0, 2.2, 1.3), (-3.0, -2.2, 1.3),
                                      (2.8, 0, 1.0), (4.0, 0, 1.0), (5.0, 0, 1.0)]),
}
CLEAR_MARGIN = 12.0

# Home-station module attach points (spec 7.4, M4+): name -> (x, y, z, yaw deg).
# Each becomes an EMPTY `attach_<name>` child of Station_Home whose local +X
# points away from the station.  Station_Home carries a static PYLON (girder +
# walkway tube under the rotating ring) ending in a docking collar at every
# attach point; a home_module_<id>.glb is placed with its origin on the empty
# and its +X along the empty's +X (see home_modules.py and
# art/blender/data/home_modules.json).
HOME_SLOT_R = 11.4
HOME_SLOTS = {
    'fl': (HOME_SLOT_R * math.cos(math.radians(45)), HOME_SLOT_R * math.sin(math.radians(45)), -0.5, 45.0),
    'rl': (HOME_SLOT_R * math.cos(math.radians(135)), HOME_SLOT_R * math.sin(math.radians(135)), -0.5, 135.0),
    'rr': (HOME_SLOT_R * math.cos(math.radians(225)), HOME_SLOT_R * math.sin(math.radians(225)), -0.5, 225.0),
    'fr': (HOME_SLOT_R * math.cos(math.radians(315)), HOME_SLOT_R * math.sin(math.radians(315)), -0.5, 315.0),
    'port': (0.0, HOME_SLOT_R, -0.5, 90.0),
    'aft': (-13.9, 0.0, -0.5, 180.0),
}
# pylon start points (on the hub rim / depot / truss end)
HOME_PYLON_FROM = {'fl': 4.2, 'rl': 4.2, 'rr': 4.2, 'fr': 4.2, 'port': 7.7, 'aft': 13.1}


# ----------------------------------------------------------------------------
# kit
# ----------------------------------------------------------------------------
def deck_block(name, x0, x1, y0, y1, z0, z1, accent='accent_iron', plate='hull_light',
               core='hull_dark', inset=0.18, plate_h=0.28):
    """Station-scale version of the ship-part look: dark block, light chamfered
    top plate, accent belt on the sides."""
    out = [G.box(name, x0, x1, y0, y1, z0, z1 - plate_h * 0.5, core, bevel=0.07, seg=1)]
    c = min(0.45, (x1 - x0) * 0.15, (y1 - y0) * 0.15)
    out.append(G.prism(name + 'Plate', G.chamfer_rect(x0 + inset * 0.3, x1 - inset * 0.3,
                                                      y0 + inset * 0.3, y1 - inset * 0.3, c),
                       z1 - plate_h, z1, plate, bevel=0.05, seg=1))
    zb = z0 + (z1 - z0) * 0.3
    out.append(G.box(name + 'Belt', x0 - 0.05, x1 + 0.05, y0 - 0.05, y1 + 0.05, zb, zb + 0.22, accent,
                     bevel=0.03, seg=1))
    return out


def hub(name, r, z0, z1, accent='accent_iron', verts=16, windows=True):
    """Faceted drum: dark underside, accent band, light top."""
    h = z1 - z0
    prof = [(z0, 0.0), (z0, r * 0.6), (z0 + 0.25 * h, r * 0.95), (z0 + 0.42 * h, r),
            (z0 + 0.58 * h, r), (z0 + 0.75 * h, r * 0.95), (z1, r * 0.72), (z1, 0.0)]
    segs = [0, 0, 1, 2, 3, 3, 3]
    out = [G.lathe(name, prof, segs, ['hull_dark', 'hull_mid', accent, 'hull_light'],
                   axis='Z', verts=verts, closed=False, smooth=False)]
    if windows:
        zw = z0 + 0.66 * h
        out.append(G.ring_band(name + 'Win', r * 0.985, r * 0.9, zw - 0.06 * h, zw + 0.02 * h, 'window_warm',
                               verts=verts, smooth=False))
    return out


def ring_hab(name, R, w, h, z, accent='accent_iron', segs=48, ribs=12):
    """Rectangular-section habitat ring around Z with a window line + ribs."""
    prof = [(z - h / 2, R - w / 2), (z - h / 2, R + w / 2), (z + h / 2, R + w / 2), (z + h / 2, R - w / 2)]
    out = [G.lathe(name, prof, [0, 1, 2, 3], ['hull_dark', 'hull_light', 'hull_light', 'hull_mid'],
                   axis='Z', verts=segs, closed=True, smooth=False)]
    out.append(G.ring_band(name + 'Win', R + w / 2 + 0.03, R + w / 2 - 0.05, z - 0.1, z + 0.1,
                           'window_warm', verts=segs, smooth=False))
    out.append(G.ring_band(name + 'Top', R + 0.12, R - 0.12, z + h / 2, z + h / 2 + 0.06,
                           accent, verts=segs, smooth=False))
    for i in range(ribs):
        a = 360.0 * i / ribs
        b = G.box(f'{name}Rib{i}', R - w / 2 - 0.08, R + w / 2 + 0.08, -0.2, 0.2, z - h / 2 - 0.08,
                  z + h / 2 + 0.08, 'hull_mid' if i % 2 else accent, bevel=0.04, seg=1)
        G.transform(b, rot=(0, 0, a))
        out.append(b)
    return out


def spoke(name, r0, r1, angle, z, w=0.55, h=0.45):
    b = G.box(name, r0, r1, -w / 2, w / 2, z - h / 2, z + h / 2, 'hull_mid', bevel=0.05, seg=1)
    G.transform(b, rot=(0, 0, angle))
    return [b]


def arm(name, x0, x1, z0=-0.55, z1=0.2, w=1.6, accent='accent_iron'):
    """Docking arm along +X with ribs and runway lights."""
    out = deck_block(name, x0, x1, -w / 2, w / 2, z0, z1, accent)
    n = max(2, int((x1 - x0) / 1.4))
    for i in range(n):
        x = x0 + (i + 0.5) * (x1 - x0) / n
        out.append(G.box(f'{name}Rib{i}', x - 0.12, x + 0.12, -w / 2 - 0.1, w / 2 + 0.1, z0 - 0.08, z1 + 0.06,
                         'hull_mid', bevel=0.03, seg=1))
        for s in (1, -1):
            out.append(G.box(f'{name}Lamp{i}{s}', x + 0.3, x + 0.5, s * w / 2 - 0.16, s * w / 2 - 0.06,
                             z1 - 0.02, z1 + 0.04, 'engine_glow'))
    # mount plate where dock_clamp attaches
    out.append(G.box(name + 'Mount', x1 - 0.3, x1, -w / 2 - 0.25, w / 2 + 0.25, z0 - 0.1, z1 + 0.05,
                     'hull_dark', bevel=0.05, seg=1))
    return out


def vtank(name, loc, r, h, body='fuel_yellow', cap='hull_light', strap='trim_black'):
    x, y, z = loc
    L = max(0.0, h / 2 - r)
    prof = []
    n = 4
    for i in range(n + 1):
        a = math.pi / 2 * i / n
        prof.append((-L - r * math.cos(a), r * math.sin(a)))
    prof.append((L, r))
    for i in range(1, n + 1):
        a = math.pi / 2 * i / n
        prof.append((L + r * math.sin(a), r * math.cos(a)))
    segs = [1] * n + [0] + [1] * n
    out = [G.lathe(name, prof, segs, [body, cap], loc=(x, y, z), axis='Z', verts=16, closed=False)]
    for j, zz in enumerate((-L * 0.6, L * 0.6)):
        out.append(G.ring_band(f'{name}Strap{j}', r + 0.04, r - 0.05, z + zz - 0.07, z + zz + 0.07, strap,
                               loc=(x, y, 0), verts=16))
    return out


def solar_wing(name, x0, x1, y0, y1, z, cols=4, rows=2):
    out = [G.box(name + 'Frame', x0, x1, y0, y1, z - 0.07, z + 0.03, 'hull_mid', bevel=0.02, seg=1)]
    gx, gy = (x1 - x0) / cols, (y1 - y0) / rows
    for i in range(cols):
        for j in range(rows):
            out.append(G.box(f'{name}Cell{i}{j}', x0 + i * gx + 0.06, x0 + (i + 1) * gx - 0.06,
                             y0 + j * gy + 0.06, y0 + (j + 1) * gy - 0.06, z + 0.02, z + 0.06, 'solar_cell'))
    return out


def mast(name, loc, h, r=0.09, dish=0.0):
    x, y, z = loc
    out = [G.cyl(name, r, h, 'metal_bare', loc=(x, y, z + h / 2), verts=8)]
    for k in range(1, 3):
        out.append(G.box(f'{name}X{k}', x - r * 3, x + r * 3, y - 0.03, y + 0.03, z + h * k / 3 - 0.03,
                         z + h * k / 3 + 0.03, 'metal_bare'))
    if dish:
        prof = [(0.0, 0.0), (0.02, dish * 0.4), (0.08, dish), (0.06, dish * 1.04), (0.0, dish * 0.5),
                (-0.05, 0.0)]
        out.append(G.lathe(name + 'Dish', prof, [0, 0, 1, 2, 2], ['hull_white', 'accent_iron', 'hull_mid'],
                           loc=(x, y, z + h * 0.62), axis='Z', verts=16, closed=False, rot=(0, 55, 0)))
    return out


def beacon(name, loc, key, r=0.24):
    b = G.ellipsoid(name, r, r, r, key, seg=10, rings=6)
    b.location = loc
    G.bake_transform(b)
    return b


def container(name, x, y, z, sx, sy, sz, key, rot=0.0):
    out = [G.box(name, -sx / 2, sx / 2, -sy / 2, sy / 2, 0, sz, key, bevel=0.03, seg=1)]
    for k, f in enumerate((-0.3, 0.0, 0.3)):
        out.append(G.box(f'{name}R{k}', f * sx - 0.03, f * sx + 0.03, -sy / 2 - 0.02, sy / 2 + 0.02, 0.05,
                         sz - 0.05, 'hull_dark'))
    for o in out:
        G.transform(o, loc=(x, y, z), rot=(0, 0, rot))
    return out


def _finish(name, static, atlas_dir, R, beacons=(), rotor=None, rotor_loc=(0, 0, 0)):
    root = G.join(static, name)
    G.finalize(root, atlas_dir)
    if rotor:
        ro = G.join(rotor, 'ring_rotor')
        G.finalize(ro, atlas_dir)
        # move the pivot to rotor_loc (mesh was built in station space)
        from mathutils import Matrix
        ro.data.transform(Matrix.Translation([-c for c in rotor_loc]))
        ro.location = rotor_loc
        ro.parent = root
    for i, (loc, key) in enumerate(beacons):
        b = beacon(f'beacon_{i}', (0, 0, 0), key)
        G.finalize(b, atlas_dir)
        b.location = loc
        b.parent = root
    dp = G.empty('dock_port', loc=(R, 0, 0), size=0.6)
    dp.parent = root
    return root


def _home_pylon(name, r0, r1, yaw, z):
    """Static module pylon from radius r0 to r1 along angle yaw at height z:
    walkway tube with accent ribs on a dark keel, collar plate at the end."""
    out = [G.box(name, r0, r1 - 0.25, -0.38, 0.38, z - 0.32, z + 0.32, 'hull_mid', bevel=0.05, seg=1),
           G.box(name + 'Keel', r0, r1 - 0.2, -0.22, 0.22, z - 0.55, z - 0.3, 'hull_dark', bevel=0.03, seg=1),
           G.box(name + 'Win', r0 + 0.3, r1 - 0.6, -0.4, 0.4, z + 0.02, z + 0.12, 'window_warm')]
    n = max(2, int((r1 - r0) / 1.6))
    for i in range(n + 1):
        x = r0 + 0.3 + i * (r1 - r0 - 0.8) / n
        out.append(G.box(f'{name}Rib{i}', x - 0.1, x + 0.1, -0.46, 0.46, z - 0.42, z + 0.4,
                         'accent_iron' if i % 2 == 0 else 'hull_light', bevel=0.03, seg=1))
    out.append(G.box(name + 'Collar', r1 - 0.3, r1, -0.75, 0.75, z - 0.65, z + 0.65, 'hull_dark', bevel=0.06, seg=1))
    out.append(G.box(name + 'CollarRim', r1 - 0.06, r1 + 0.02, -0.6, 0.6, z - 0.5, z + 0.5, 'accent_iron', bevel=0.03,
                     seg=1))
    for o in out:
        G.transform(o, rot=(0, 0, yaw))
    return out


# ----------------------------------------------------------------------------
# home station "Zakladna Pociatok"  (R = 14)
# ----------------------------------------------------------------------------
def build_home_legacy(atlas_dir):
    R = LAYOUTS['station_home']['R']
    st = []
    st += hub('Hub', 4.4, -2.4, 2.0, verts=16)
    # command tower + bridge windows
    st.append(G.lathe('Tower', [(2.0, 0.0), (2.0, 2.2), (2.6, 2.1), (3.2, 1.8), (3.5, 1.2), (3.5, 0.0)],
                      [0, 0, 1, 2, 2], ['hull_mid', 'glass_cockpit', 'hull_light'], axis='Z', verts=16,
                      closed=False, smooth=False))
    st.append(G.ring_band('TowerBand', 2.25, 2.0, 2.0, 2.18, 'accent_iron', verts=16, smooth=False))
    st += mast('Antenna', (0, 0, 3.5), 1.5, r=0.1, dish=0.0)
    st += mast('AntennaB', (-1.1, 0.6, 3.3), 0.9, r=0.06, dish=0.55)
    # bottom spire
    st.append(G.lathe('Spire', [(-2.4, 2.6), (-3.0, 1.2), (-3.4, 0.0)], [0, 0], ['hull_dark'], axis='Z',
                      verts=16, closed=False, smooth=False))
    # top deck: radial panel seams, orange deck ring, glass domes, window lights
    for i in range(8):
        b = G.box(f'Seam{i}', 2.4, 3.8, -0.035, 0.035, 1.2, 1.9, 'trim_black')
        G.transform(b, rot=(0, -12, 22.5 + i * 45))
        st.append(b)
    st.append(G.ring_band('DeckRing', 3.35, 3.05, 1.55, 1.72, 'accent_iron', verts=16, smooth=False))
    for i, a in enumerate((0, 90, 180, 270)):
        x, y = 2.95 * math.cos(math.radians(a + 45)), 2.95 * math.sin(math.radians(a + 45))
        st.append(G.ellipsoid(f'Dome{i}', 0.62, 0.62, 0.48, 'glass_cockpit', loc=(x, y, 1.72), seg=12, rings=6,
                              upper_only=True))
        st.append(G.ring_band(f'DomeRing{i}', 0.72, 0.58, 1.66, 1.8, 'hull_mid', loc=(x, y, 0), verts=12))
    for i in range(16):
        a = math.radians(11.25 + i * 22.5)
        st.append(G.box(f'TopLamp{i}', -0.12, 0.12, -0.12, 0.12, 0, 0.08, 'window_warm'))
        G.transform(st[-1], loc=(3.7 * math.cos(a), 3.7 * math.sin(a), 1.32))
    # docking arm (+X), passes under the ring
    st += arm('Arm', 4.0, R - 2.2, z0=-0.6, z1=0.2, w=1.7)
    # hangar module with gate facing -Y
    st += deck_block('Hangar', -2.8, 2.8, -8.1, -3.5, -1.9, 0.25)
    for k, x in enumerate((-1.5, 0.0, 1.5)):   # roof: skylights + hazard chevrons
        st.append(G.box(f'Skylight{k}', x - 0.45, x + 0.45, -7.2, -4.4, 0.2, 0.3, 'trim_black'))
        st.append(G.box(f'SkyGlow{k}', x - 0.3, x + 0.3, -7.0, -4.6, 0.25, 0.32, 'glass_cockpit'))
    for k in range(6):
        b = G.box(f'RoofChev{k}', -0.5, 0.5, -0.1, 0.1, 0.24, 0.31, 'accent_iron' if k % 2 == 0 else 'trim_black')
        G.transform(b, loc=(-2.35 + k * 0.94, -7.75, 0), rot=(0, 0, 40))
        st.append(b)
    st.append(G.box('GateFrame', -2.4, 2.4, -8.32, -8.0, -1.75, 0.15, 'accent_iron', bevel=0.06, seg=1))
    st.append(G.box('GateOpen', -1.85, 1.85, -8.36, -8.1, -1.45, -0.15, 'trim_black'))
    st.append(G.box('GateGlowT', -1.85, 1.85, -8.4, -8.3, -0.24, -0.15, 'engine_glow'))
    st.append(G.box('GateGlowB', -1.85, 1.85, -8.4, -8.3, -1.45, -1.36, 'engine_glow'))
    for k in range(5):  # hazard stripes on the gate lintel
        x = -1.6 + k * 0.8
        b = G.box(f'Haz{k}', -0.12, 0.12, -0.05, 0.05, -0.3, 0.3, 'trim_black')
        G.transform(b, loc=(x, -8.36, -0.0), rot=(0, 35, 0))
        st.append(b)
    # fuel depot on +Y
    st += deck_block('Depot', -2.4, 2.4, 3.6, 7.8, -1.6, -0.6)
    for i, (x, y) in enumerate(((-1.25, 5.0), (1.25, 5.0), (0.0, 6.7))):
        st += vtank(f'Tank{i}', (x, y, 0.4), 0.85, 2.2, cap='fuel_yellow')
    # solar truss (-X) with two wing pairs, under the ring
    st.append(G.box('Truss', -13.2, -4.0, -0.35, 0.35, -0.75, -0.25, 'hull_dark', bevel=0.04, seg=1))
    for k in range(6):
        x = -5.0 - k * 1.6
        st.append(G.box(f'TrussRib{k}', x - 0.1, x + 0.1, -0.5, 0.5, -0.85, -0.15, 'accent_iron'))
    for s in (1, -1):
        y0, y1 = (0.6, 4.0) if s > 0 else (-4.0, -0.6)
        st += solar_wing(f'SolarOut{s}', -13.0, -10.0, y0, y1, -0.5, cols=3, rows=3)
        y0, y1 = (0.6, 3.3) if s > 0 else (-3.3, -0.6)
        st += solar_wing(f'SolarIn{s}', -8.4, -5.4, y0, y1, -0.5, cols=3, rows=3)
    # rotating habitat ring (above the arm/truss level)
    rot = ring_hab('Ring', 9.6, 1.7, 1.2, 1.0)
    for i, a in enumerate((45, 135, 225, 315)):
        rot += spoke(f'Spoke{i}', 3.9, 8.8, a, 1.0)
    beacons = [((R - 2.6, 1.15, 0.45), 'light_red'), ((R - 2.6, -1.15, 0.45), 'light_green'),
               ((0, 0, 5.15), 'light_white'), ((-13.1, 4.1, -0.3), 'light_amber'),
               ((-13.1, -4.1, -0.3), 'light_amber'), ((2.6, -8.4, 0.45), 'light_amber'),
               ((-2.6, -8.4, 0.45), 'light_amber'), ((0, 0, -3.55), 'light_red')]
    # module pylons: girder + walkway tube under the ring, docking collar at the attach point
    for nm, (x, y, z, yaw) in HOME_SLOTS.items():
        st += _home_pylon(f'Pylon_{nm}', HOME_PYLON_FROM[nm], math.hypot(x, y), yaw, z)
    root = _finish('Station_Home', st, atlas_dir, R, beacons, rot, (0, 0, 0))
    for nm, (x, y, z, yaw) in HOME_SLOTS.items():
        e = G.empty(f'attach_{nm}', loc=(x, y, z), size=0.8)
        e.rotation_euler = (0, 0, math.radians(yaw))
        e.parent = root
    return root


# ----------------------------------------------------------------------------
# station A - trade  (R = 10)
# ----------------------------------------------------------------------------
CONTAINER_KEYS = ('accent_iron', 'accent_titanium', 'fuel_yellow', 'accent_exotic', 'hull_light')


def build_a(atlas_dir):
    R = LAYOUTS['station_a']['R']
    st = []
    st += hub('Hub', 3.3, -1.8, 1.5, verts=16)
    st.append(G.lathe('Tower', [(1.5, 0.0), (1.5, 1.5), (2.0, 1.4), (2.5, 1.1), (2.7, 0.0)],
                      [0, 1, 2, 2], ['hull_mid', 'glass_cockpit', 'hull_light'], axis='Z', verts=12,
                      closed=False, smooth=False))
    st += mast('Antenna', (0, 0, 2.7), 1.1, r=0.08)
    st += arm('Arm', 3.0, R - 2.2, z0=-0.55, z1=0.2, w=1.5)
    # container yard on -X
    st += deck_block('Yard', -9.0, -4.2, -3.1, 3.1, -1.1, -0.45)
    k = 0
    for i, x in enumerate((-8.2, -6.9, -5.6)):
        for j, y in enumerate((-2.2, -0.75, 0.75, 2.2)):
            h = 1 + ((i * 7 + j * 3) % 3 == 0)
            for lvl in range(h):
                st += container(f'Box{i}{j}{lvl}', x, y, -0.45 + lvl * 0.62, 1.1, 1.3, 0.6,
                                CONTAINER_KEYS[k % len(CONTAINER_KEYS)])
                k += 1
    # small side pods on +-Y
    for s in (1, -1):
        st += deck_block(f'Pod{s}', -1.3, 1.3, 3.0 * s - 1.0 if s > 0 else -4.6, 4.6 if s > 0 else -2.0,
                         -1.3, -0.2)
    # rotating cargo carousel ring with hanging containers
    rot = ring_hab('Ring', 6.3, 1.1, 0.8, 0.9, ribs=8)
    for i, a in enumerate((0, 90, 180, 270)):
        rot += spoke(f'Spoke{i}', 2.9, 5.8, a + 22.5, 0.9, w=0.45, h=0.35)
    for i in range(8):
        a = math.radians(22.5 + i * 45)
        rot += container(f'Pod{i}', 7.25 * math.cos(a), 7.25 * math.sin(a), 0.45, 0.8, 1.2, 0.85,
                         CONTAINER_KEYS[i % 4], rot=math.degrees(a))
    beacons = [((R - 2.6, 1.0, 0.45), 'light_red'), ((R - 2.6, -1.0, 0.45), 'light_green'),
               ((0, 0, 3.95), 'light_white'), ((-9.0, 3.1, -0.2), 'light_amber'),
               ((-9.0, -3.1, -0.2), 'light_amber')]
    return _finish('Station_A', st, atlas_dir, R, beacons, rot)


# ----------------------------------------------------------------------------
# station B - industrial with ice refinery  (R = 10)
# ----------------------------------------------------------------------------
def build_b(atlas_dir):
    R = LAYOUTS['station_b']['R']
    st = []
    st += hub('Hub', 3.0, -1.8, 1.2, verts=12)
    # refinery tower with glowing ice vents
    st.append(G.lathe('Refinery', [(1.2, 0.0), (1.2, 1.4), (3.6, 1.15), (3.9, 0.7), (4.3, 0.0)],
                      [0, 1, 2, 2], ['hull_mid', 'hull_light', 'hull_dark'], axis='Z', verts=12,
                      closed=False, smooth=False))
    for i, z in enumerate((1.8, 2.5, 3.2)):
        st.append(G.ring_band(f'Vent{i}', 1.36 - 0.08 * i, 1.2 - 0.08 * i, z, z + 0.14, 'vein_ice', verts=12,
                              smooth=False))
    st += mast('Stack', (0.0, 0.0, 4.2), 0.9, r=0.18)
    # ice storage spheres on -X
    for s in (1, -1):
        y = 3.1 * s
        st.append(G.ellipsoid(f'Sphere{s}', 1.9, 1.9, 1.7, 'ice_crust_blue', loc=(-4.8, y, -0.1), seg=16,
                              rings=10, smooth=False))
        st.append(G.ring_band(f'SphereBand{s}', 1.96, 1.8, -0.25, 0.05, 'vein_ice', loc=(-4.8, y, 0),
                              verts=16, smooth=False))
        st.append(G.box(f'SphereLeg{s}', -5.2, -4.4, y - 0.4, y + 0.4, -2.0, -1.2, 'hull_dark'))
        st.append(G.cyl(f'Pipe{s}', 0.18, 2.6, 'metal_bare', loc=(-2.6, y * 0.55, 0.3), axis='X', verts=8))
    # processing block on +Y with cooling fins
    st += deck_block('Proc', -1.6, 2.2, 3.2, 6.9, -1.5, 0.6)
    for k in range(5):
        x = -1.2 + k * 0.8
        st.append(G.box(f'Fin{k}', x - 0.08, x + 0.08, 3.6, 6.5, 0.6, 1.5, 'hull_mid', bevel=0.02, seg=1))
        st.append(G.box(f'FinGlow{k}', x + 0.12, x + 0.2, 3.8, 6.3, 0.58, 0.64, 'vein_ice'))
    # radiator panels on -Y
    st.append(G.box('RadSpine', -0.3, 0.9, -7.1, -2.8, -0.9, -0.3, 'hull_dark', bevel=0.04, seg=1))
    for k in range(4):
        y = -3.6 - k * 1.0
        st.append(G.box(f'Radiator{k}', -1.6, 2.4, y - 0.38, y + 0.38, -0.7, -0.6,
                        'hull_light' if k % 2 else 'hull_mid'))
        st.append(G.box(f'RadStripe{k}', 2.2, 2.4, y - 0.38, y + 0.38, -0.6, -0.55, 'accent_iron'))
    st += arm('Arm', 2.8, R - 2.2, z0=-0.55, z1=0.2, w=1.5)
    # rotating centrifuge collar around the refinery tower
    rot = ring_hab('Centrifuge', 2.0, 0.5, 0.45, 2.3, ribs=6)
    beacons = [((R - 2.6, 1.0, 0.45), 'light_red'), ((R - 2.6, -1.0, 0.45), 'light_green'),
               ((0, 0, 5.3), 'light_red'), ((-4.8, 3.1, 1.75), 'light_amber'),
               ((-4.8, -3.1, 1.75), 'light_amber')]
    return _finish('Station_B', st, atlas_dir, R, beacons, rot, (0, 0, 2.3))


# ----------------------------------------------------------------------------
# station C - shipyard with a portal crane  (R = 10)
# ----------------------------------------------------------------------------
def build_c(atlas_dir):
    R = LAYOUTS['station_c']['R']
    st = []
    st += hub('Hub', 2.9, -1.6, 1.3, verts=12)
    for o in st:
        G.transform(o, loc=(-6.0, 0, 0))
    st += mast('Antenna', (-6.0, 0, 1.3), 1.4, r=0.08, dish=0.5)
    # dry-dock bay floor with hazard edges
    st.append(G.box('Bay', -3.0, 5.0, -2.2, 2.2, -1.2, -0.65, 'floor_dark', bevel=0.05, seg=1))
    for s in (1, -1):
        st.append(G.box(f'BayEdge{s}', -3.0, 5.0, 2.0 * s - 0.15, 2.0 * s + 0.15, -0.7, -0.6, 'accent_iron'))
        # side rails / walls
        st += deck_block(f'Wall{s}', -2.6, 5.4, 2.3 * s if s > 0 else -3.5, 3.5 if s > 0 else -2.3,
                         -1.4, 0.5)
    st.append(G.box('BayBack', -3.6, -2.6, -2.3, 2.3, -1.4, 0.3, 'hull_dark', bevel=0.05, seg=1))
    # portal crane: two towers + bridge + trolley + hook
    for s in (1, -1):
        y = 3.0 * s
        st.append(G.box(f'CraneLeg{s}', 0.7, 1.5, y - 0.4, y + 0.4, 0.5, 4.2, 'accent_iron', bevel=0.06, seg=1))
        st.append(G.box(f'CraneLegB{s}', 0.85, 1.35, y - 0.25, y + 0.25, 0.4, 4.3, 'hull_dark'))
    st.append(G.box('Bridge', 0.5, 1.7, -3.5, 3.5, 4.1, 4.7, 'hull_light', bevel=0.06, seg=1))
    st.append(G.box('BridgeStripe', 0.45, 1.75, -3.3, 3.3, 4.32, 4.45, 'trim_black'))
    st.append(G.box('Trolley', 0.6, 1.6, 0.4, 1.3, 3.75, 4.15, 'hull_dark', bevel=0.04, seg=1))
    st.append(G.cyl('Cable', 0.03, 2.2, 'metal_bare', loc=(1.1, 0.85, 2.65), verts=6))
    st.append(G.box('Hook', 0.85, 1.35, 0.6, 1.1, 1.35, 1.55, 'accent_iron'))
    st.append(G.box('WorkLight', 0.6, 1.6, -2.6, 2.6, 4.02, 4.1, 'light_white'))
    # hull skeleton under construction in the bay
    for k in range(5):
        x = -1.6 + k * 1.2
        st.append(G.box(f'Frame{k}', x - 0.12, x + 0.12, -1.2, 1.2, -0.6, -0.4, 'hull_mid'))
        st.append(G.box(f'FrameUp{k}L', x - 0.1, x + 0.1, 1.05, 1.25, -0.6, 0.4, 'hull_mid'))
        st.append(G.box(f'FrameUp{k}R', x - 0.1, x + 0.1, -1.25, -1.05, -0.6, 0.4, 'hull_mid'))
    st.append(G.box('Keel', -1.8, 3.4, -0.25, 0.25, -0.65, -0.35, 'accent_iron'))
    st += arm('Arm', 5.0, R - 2.2, z0=-0.55, z1=0.2, w=1.5)
    beacons = [((R - 2.6, 1.0, 0.45), 'light_red'), ((R - 2.6, -1.0, 0.45), 'light_green'),
               ((1.1, 3.0, 4.45), 'light_amber'), ((1.1, -3.0, 4.45), 'light_amber'),
               ((-6.0, 0, 2.95), 'light_white')]
    return _finish('Station_C', st, atlas_dir, R, beacons)


# ----------------------------------------------------------------------------
# outposts (R = 6)
# ----------------------------------------------------------------------------
def build_outpost_a(atlas_dir):
    R = LAYOUTS['outpost_a']['R']
    st = []
    # horizontal habitat capsule along X
    L, r = 2.6, 1.35
    prof = [(-L - r, 0.0), (-L - r * 0.7, r * 0.7), (-L, r), (L, r), (L + r * 0.5, r * 0.75), (L + r * 0.7, 0.0)]
    st.append(G.lathe('Hab', prof, [0, 0, 1, 2, 2], ['hull_mid', 'hull_light', 'hull_dark'],
                      loc=(-1.4, 0, 0), axis='X', verts=16, closed=False, smooth=False))
    for i, x in enumerate((-3.0, -1.4, 0.2)):
        st.append(G.ring_band(f'Band{i}', r + 0.08, r - 0.05, -0.12, 0.12, 'accent_iron' if i != 1 else 'window_warm',
                              loc=(x, 0, 0), axis='X', verts=16, smooth=False))
    st.append(G.box('Belly', -4.0, 1.2, -0.7, 0.7, -1.6, -1.0, 'hull_dark', bevel=0.05, seg=1))
    for s in (1, -1):
        st.append(G.box(f'WingArm{s}', -2.2, -1.8, 1.1 * s if s > 0 else -2.0, 2.0 if s > 0 else -1.1, -0.1, 0.1,
                        'metal_bare'))
        st += solar_wing(f'Solar{s}', -3.2, -0.8, 2.0 if s > 0 else -4.6, 4.6 if s > 0 else -2.0, 0.0,
                         cols=2, rows=3)
    st += mast('Antenna', (-3.4, 0, 1.2), 1.0, r=0.06, dish=0.4)
    st += arm('Arm', 1.4, R - 2.2, z0=-0.5, z1=0.15, w=1.3)
    beacons = [((R - 2.6, 0.9, 0.4), 'light_red'), ((R - 2.6, -0.9, 0.4), 'light_green'),
               ((-3.4, 0, 2.35), 'light_amber')]
    return _finish('Outpost_A', st, atlas_dir, R, beacons)


def build_outpost_b(atlas_dir):
    R = LAYOUTS['outpost_b']['R']
    st = []
    st += hub('Hub', 2.5, -1.4, 1.0, verts=6)
    for o in st:
        G.transform(o, loc=(-0.6, 0, 0), rot=(0, 0, 30))
    st.append(G.ellipsoid('Dome', 1.3, 1.3, 0.9, 'glass_cockpit', loc=(-0.6, 0, 0.95), seg=12, rings=6,
                          upper_only=True))
    for s in (1, -1):
        st += vtank(f'Tank{s}', (-3.0, 2.2 * s, -0.2), 0.75, 2.0)
    st.append(G.box('TankRack', -3.6, -2.4, -2.6, 2.6, -1.3, -1.0, 'hull_dark', bevel=0.04, seg=1))
    st += mast('Antenna', (0.2, 1.4, 1.0), 1.4, r=0.07, dish=0.45)
    st.append(G.box('Radiator', -1.0, 0.4, -3.3, -2.1, -0.4, -0.3, 'hull_light'))
    st.append(G.box('RadiatorStripe', 0.25, 0.4, -3.3, -2.1, -0.3, -0.25, 'accent_iron'))
    st += arm('Arm', 1.6, R - 2.2, z0=-0.5, z1=0.15, w=1.3)
    beacons = [((R - 2.6, 0.9, 0.4), 'light_red'), ((R - 2.6, -0.9, 0.4), 'light_green'),
               ((0.2, 1.4, 2.55), 'light_amber')]
    return _finish('Outpost_B', st, atlas_dir, R, beacons)


# ----------------------------------------------------------------------------
# docking clamp (~3 x 3), origin = dock_port
# ----------------------------------------------------------------------------
def build_clamp(atlas_dir):
    st = []
    st.append(G.box('Base', -2.4, -0.3, -1.5, 1.5, -0.5, -0.25, 'hull_dark', bevel=0.05, seg=1))
    st.append(G.prism('BasePlate', G.chamfer_rect(-2.3, -0.4, -1.4, 1.4, 0.3), -0.3, -0.18, 'hull_light',
                      bevel=0.03, seg=1))
    for s in (1, -1):  # cradle prongs opening toward +X
        y = 1.15 * s
        st.append(G.box(f'Prong{s}', -2.2, 0.55, y - 0.28, y + 0.28, -0.45, 0.2, 'accent_iron', bevel=0.06, seg=1))
        st.append(G.box(f'ProngTip{s}', 0.3, 0.6, y - 0.32, y + 0.32, -0.5, 0.26, 'hull_dark', bevel=0.04, seg=1))
        st.append(G.box(f'Pad{s}', -1.6, 0.2, y - 0.3 * s - 0.08, y - 0.3 * s + 0.08, -0.2, 0.05, 'trim_black'))
    st.append(G.box('Back', -2.4, -1.9, -1.45, 1.45, -0.45, 0.35, 'hull_mid', bevel=0.05, seg=1))
    st.append(G.box('BackGlow', -1.95, -1.88, -0.9, 0.9, -0.05, 0.15, 'engine_glow'))
    root = G.join(st, 'Dock_Clamp')
    G.finalize(root, atlas_dir)
    xs = (-1.6, -0.95, -0.3, 0.35)
    for i, x in enumerate(xs):
        lamps = [G.box(f'L{i}{s}', x - 0.13, x + 0.13, 1.15 * s - 0.1, 1.15 * s + 0.1, 0.18, 0.27,
                       'engine_glow', bevel=0.02, seg=1) for s in (1, -1)]
        gl = G.join(lamps, f'guide_light_{i}')
        G.finalize(gl, atlas_dir)
        gl.parent = root
    return root


LEGACY_BUILDERS = {   # pre-detail-pass (M2/M4) versions, kept for reference
    'station_home': build_home_legacy, 'station_a': build_a, 'station_b': build_b, 'station_c': build_c,
    'outpost_a': build_outpost_a, 'outpost_b': build_outpost_b, 'dock_clamp': build_clamp,
}


def _dtl(name):
    def build(atlas_dir):
        import stations_dtl
        return stations_dtl.BUILDERS[name](atlas_dir)
    build.__name__ = 'build_' + name
    return build


# detail pass ("dtl"): stations_dtl.py builds every station / outpost / the clamp
BUILDERS = {k: _dtl(k) for k in LEGACY_BUILDERS}


def layouts_json():
    out = {'_schema': {
        'units': 'game units = grid cells; local station frame, +X = dock direction, +Y = left',
        'circles': 'list of {x, y, r} collision circles covering the solid structure',
        'radius': 'station radius R (spec 5.4); dock_port lies at (R, 0)',
        'dockPort': '{x, y}: position of the dock_port node (clamp origin, gameplay plane z = 0)',
        'clearRadius': 'no asteroids inside this radius (R + 12 docking gap)'}}
    for k, v in LAYOUTS.items():
        out[k] = {'radius': v['R'], 'dockPort': {'x': v['R'], 'y': 0.0},
                  'clearRadius': v['R'] + CLEAR_MARGIN,
                  'circles': [{'x': x, 'y': y, 'r': r} for x, y, r in v['circles']]}
    return out


def coverage(objs, circles):
    """How well the collision circles cover the model: (fraction of vertices
    outside every circle, max distance outside).  Ignores z."""
    import bpy
    bpy.context.view_layer.update()
    out, n, worst = 0, 0, 0.0
    for o in objs:
        if o.type != 'MESH':
            continue
        mw = o.matrix_world
        for v in o.data.vertices:
            p = mw @ v.co
            n += 1
            d = min(math.hypot(p.x - x, p.y - y) - r for x, y, r in circles)
            if d > 0.05:
                out += 1
                worst = max(worst, d)
    return round(out / max(n, 1), 3), round(worst, 2)
