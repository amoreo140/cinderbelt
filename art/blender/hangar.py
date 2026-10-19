"""Shipyard scene: hangar_platform.glb (editor platform) + hangar_bay.glb (surroundings).

hangar_platform.glb - 17 x 17 units centred on the origin: a 15 x 15 build grid
(cell centres at integer coordinates -7..7, seams on the half-integers) plus a
1-unit rim.  FLOOR_TOP is the z of the walkable floor.  Ship parts have their
dark core bottom at z = -0.20, but the engine bell hangs down to z = -0.356, so
the floor sits just below the lowest part geometry: parts never clip into it.

v2 (art audit 2026-10-16, batch D3): same floor contract; detail-pass rim
(cable trays, vents, wall panels, corner posts with lamps), pedestal down to the
bay deck.  Everything stays below PLATFORM_MAX_Y (glTF y) so HangarView's
GANTRY_CUT ghosting (0.55) has nothing left to ghost: the old 4.6-tall gantry
towers + overhead crane are gone (the bay carries the tall structures, outside
the camera's occlusion cone).

hangar_bay.glb - the bay around the platform (same frame: origin = platform
centre, +X = bow / door side).  HEIGHT RULE (shipyard camera orbits 360 deg,
pitch >= 35 deg, FOV 34 deg): a vertex at horizontal distance r from the centre
stays below z = FLOOR_TOP + 0.6 * (r - 8.5); nothing over the platform.
check_height_rule() verifies it on every build.
"""
import math
import random

from mathutils import Matrix, Vector

from lib import geo as G
from lib import greebles as GR

FLOOR_TOP = -0.37
GRID = 15
HALF_GRID = GRID / 2.0          # 7.5
OUTER = HALF_GRID + 1.0         # 8.5
PLATFORM_MAX_Y = 0.5            # glTF y (= Blender z) ceiling for the platform model
BAY_DECK = -1.9                 # top of the bay deck (the pedestal stands on it)
RULE_K, RULE_R0 = 0.6, 8.5      # height rule z <= FLOOR_TOP + RULE_K * (r - RULE_R0)
ARM_RAIL_Y = 13.0
ARM_RAIL_X = (-8.0, 8.0)


def _floor(pcs):
    ft = FLOOR_TOP
    pcs.append(G.box('Floor', -HALF_GRID, HALF_GRID, -HALF_GRID, HALF_GRID, ft - 0.35, ft, 'floor_dark'))
    for i in range(GRID + 1):
        p = -HALF_GRID + i
        if i in (0, GRID):
            continue
        pcs.append(G.box(f'SeamX{i}', p - 0.012, p + 0.012, -HALF_GRID, HALF_GRID, ft - 0.01, ft + 0.004,
                         'trim_black'))
        pcs.append(G.box(f'SeamY{i}', -HALF_GRID, HALF_GRID, p - 0.012, p + 0.012, ft - 0.01, ft + 0.004,
                         'trim_black'))


def build_v1(atlas_dir):
    """The M2 platform (gantry towers + crane), kept for reference."""
    ft = FLOOR_TOP
    pcs = []
    _floor(pcs)
    for s in (1, -1):
        pcs.append(G.box(f'RimX{s}', -OUTER, OUTER, s * HALF_GRID if s > 0 else -OUTER,
                         OUTER if s > 0 else -HALF_GRID, ft - 0.5, ft + 0.08, 'hull_dark', bevel=0.04, seg=1))
        pcs.append(G.box(f'RimY{s}', s * HALF_GRID if s > 0 else -OUTER, OUTER if s > 0 else -HALF_GRID,
                         -HALF_GRID, HALF_GRID, ft - 0.5, ft + 0.08, 'hull_dark', bevel=0.04, seg=1))
    root = G.join(pcs, 'Hangar_Platform')
    G.finalize(root, atlas_dir)
    return root


# ----------------------------------------------------------------------------
# platform v2
# ----------------------------------------------------------------------------
def _sides():
    """(name, fn mapping (t, d) -> (x, y), rotation deg) for the four rim sides:
    t runs along the side, d = outward distance from the centre line."""
    return (('E', lambda t, d: (d, t), 0.0), ('W', lambda t, d: (-d, -t), 180.0),
            ('N', lambda t, d: (-t, d), 90.0), ('S', lambda t, d: (t, -d), 270.0))


def build(atlas_dir, seed=8101):
    import station_kit as K
    ft = FLOOR_TOP
    rt = ft + 0.08                     # rim top
    pcs = []
    _floor(pcs)
    for s in (1, -1):
        pcs.append(G.box(f'RimX{s}', -OUTER, OUTER, s * HALF_GRID if s > 0 else -OUTER,
                         OUTER if s > 0 else -HALF_GRID, ft - 0.5, rt, 'hull_dark', bevel=0.04, seg=1))
        pcs.append(G.box(f'RimY{s}', s * HALF_GRID if s > 0 else -OUTER, OUTER if s > 0 else -HALF_GRID,
                         -HALF_GRID, HALF_GRID, ft - 0.5, rt, 'hull_dark', bevel=0.04, seg=1))
        # inner glow lines (the build-area border)
        pcs.append(G.box(f'GlowX{s}', -HALF_GRID, HALF_GRID, s * HALF_GRID - 0.04, s * HALF_GRID + 0.04,
                         ft + 0.06, ft + 0.1, 'engine_glow'))
        pcs.append(G.box(f'GlowY{s}', s * HALF_GRID - 0.04, s * HALF_GRID + 0.04, -HALF_GRID, HALF_GRID,
                         ft + 0.06, ft + 0.1, 'engine_glow'))
    # hazard chevrons along the rim (as v1)
    k = 0
    for s in (1, -1):
        for i in range(16):
            t = -7.5 + i + 0.5
            for (x, y, rz) in ((t, s * 8.0, 45), (s * 8.0, t, -45)):
                b = G.box(f'Haz{k}', -0.18, 0.18, -0.07, 0.07, rt, rt + 0.02,
                          'accent_iron' if i % 2 == 0 else 'trim_black')
                G.transform(b, loc=(x, y, 0), rot=(0, 0, rz))
                pcs.append(b)
                k += 1
    # outer lip: light band + cable tray hanging on the outer rim wall, lamp studs
    for nm, f, rot in _sides():
        lip = G.box(f'Lip{nm}', -0.06, 0.06, -OUTER, OUTER, rt - 0.02, rt + 0.03, 'hull_mid')
        G.transform(lip, loc=(*f(0, OUTER - 0.06), 0), rot=(0, 0, rot))
        pcs.append(lip)
        # cable tray: open channel on the outer wall
        tray = []
        tray.append(G.box(f'TrayB{nm}', 0.0, 0.22, -7.6, 7.6, ft - 0.3, ft - 0.27, 'hull_mid'))
        tray.append(G.box(f'TrayL{nm}', 0.19, 0.22, -7.6, 7.6, ft - 0.3, ft - 0.16, 'hull_mid'))
        for j, (yy, key) in enumerate(((0.07, 'trim_black'), (0.13, 'accent_iron'), (0.17, 'trim_black'))):
            tray.append(G.cyl(f'Cab{nm}{j}', 0.022, 15.0, key, loc=(yy, 0, ft - 0.245), axis='Y', verts=5))
        for j in range(9):
            yy = -7.0 + j * 1.75
            tray.append(G.box(f'TrayBr{nm}{j}', -0.01, 0.24, yy - 0.04, yy + 0.04, ft - 0.33, ft - 0.13, 'hull_dark'))
        for o in tray:
            G.apply_modifiers(o)
            o.data.transform(Matrix.Rotation(math.radians(rot), 4, 'Z') @ Matrix.Translation((OUTER, 0, 0)))
        pcs += tray
        # light strip under the lip (bay side) + small lamp studs on the rim top between chevrons
        ls = G.box(f'RimGlow{nm}', 0.0, 0.03, -7.4, 7.4, rt - 0.12, rt - 0.07, 'window_warm')
        G.transform(ls, loc=(*f(0, OUTER), 0), rot=(0, 0, rot))
        pcs.append(ls)
    # corner posts (outside the 15 x 15): low pedestal, hazard band, amber lamp
    for i, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        x, y = sx * 8.0, sy * 8.0
        pcs.append(G.box(f'Post{i}', x - 0.42, x + 0.42, y - 0.42, y + 0.42, rt - 0.02, rt + 0.24, 'hull_mid',
                         bevel=0.03, seg=1))
        pcs.append(G.box(f'PostBand{i}', x - 0.43, x + 0.43, y - 0.43, y + 0.43, rt + 0.04, rt + 0.1, 'accent_iron'))
        pcs.append(G.cyl(f'PostLampB{i}', 0.15, 0.08, 'hull_dark', loc=(x, y, rt + 0.28), verts=8))
        pcs.append(G.cyl(f'PostLamp{i}', 0.1, 0.14, 'light_amber', loc=(x, y, rt + 0.39), verts=8))
        pcs.append(G.cyl(f'PostLampC{i}', 0.12, 0.03, 'hull_dark', loc=(x, y, rt + 0.475), verts=8))
    # pedestal down to the bay deck: tapered octagonal column + struts to the rim corners
    pz = ft - 0.5
    pcs.append(G.lathe('Pedestal', [(BAY_DECK - 0.05, 5.4), (pz - 0.55, 5.6), (pz - 0.2, 6.6), (pz + 0.02, 6.6)],
                       [0, 1, 0], ['hull_dark', 'hull_mid'], axis='Z', verts=8, closed=False, smooth=False,
                       rot=(0, 0, 22.5)))
    pcs.append(G.ring_band('PedGlow', 5.6, 5.4, pz - 0.82, pz - 0.72, 'engine_glow', verts=8, smooth=False))
    for i in range(4):
        a = math.radians(45 + 90 * i)
        pcs.append(K.bar(f'Strut{i}', (5.3 * math.cos(a), 5.3 * math.sin(a), BAY_DECK + 0.3),
                         (7.9 * math.cos(a), 7.9 * math.sin(a), pz + 0.05), 0.3, 'hull_dark'))
    zones = GR.Zones().functional(-OUTER - 0.1, OUTER + 0.1, -OUTER - 0.1, OUTER + 0.1, rt)
    zones.box(-HALF_GRID - 0.12, HALF_GRID + 0.12, -HALF_GRID - 0.12, HALF_GRID + 0.12, -9, 9)   # inner rim walls
    cfg = dict(panels=False, rows=(), scatter=[dict(density=0.9, top=0.0, side=1.0, max_size=0.3)])
    root, _ = K.finish('Hangar_Platform', pcs, atlas_dir, 0, (), style='home', seed=seed, zones=zones,
                       static_cfg=cfg, weather_cfg=dict(near=0.3, far=1.6, grime=0.25))
    return root


def check_platform(objs):
    """Floor contract: nothing above the floor inside the 15 x 15 (except the seams, < +0.005), nothing
    above PLATFORM_MAX_Y anywhere, floor top at FLOOR_TOP."""
    import bpy
    bpy.context.view_layer.update()
    bad_floor = bad_top = 0
    zmax = -9.0
    for o in objs:
        if o.type != 'MESH':
            continue
        mw = o.matrix_world
        for v in o.data.vertices:
            p = mw @ v.co
            zmax = max(zmax, p.z)
            if abs(p.x) < HALF_GRID - 0.06 and abs(p.y) < HALF_GRID - 0.06 and p.z > FLOOR_TOP + 0.005:
                bad_floor += 1
                if bad_floor <= 3:
                    print('  above floor:', o.name, tuple(round(c, 3) for c in p))
            if p.z > PLATFORM_MAX_Y:
                bad_top += 1
    return {'verts_above_floor_in_grid': bad_floor, 'verts_above_max_y': bad_top, 'max_z': round(zmax, 3)}


def check_height_rule(objs):
    """Bay occlusion rule: count vertices above FLOOR_TOP + RULE_K * (r - RULE_R0) (inside r 8.5: above the floor)."""
    import bpy
    bpy.context.view_layer.update()
    bad, worst, n = 0, 0.0, 0
    for o in objs:
        if o.type != 'MESH':
            continue
        mw = o.matrix_world
        for v in o.data.vertices:
            p = mw @ v.co
            n += 1
            r = math.hypot(p.x, p.y)
            lim = FLOOR_TOP + RULE_K * max(0.0, r - RULE_R0) if r > RULE_R0 else FLOOR_TOP
            if p.z > lim + 1e-4:
                bad += 1
                worst = max(worst, p.z - lim)
    return {'verts': n, 'violations': bad, 'worst': round(worst, 3)}


# ----------------------------------------------------------------------------
# hangar bay
# ----------------------------------------------------------------------------
BAY_HALF = 24.0         # inner wall faces at x = -24, y = +-24; door frame at x = +24.5
WALL_TOP = 7.4
DOOR_X = 24.5


def _deck(st, rng):
    """Deck tiles (3 shades) with lane markings and floor lights; ends at the door threshold."""
    z = BAY_DECK
    step = 4.0
    n = int(2 * BAY_HALF / step)
    for i in range(n):
        for j in range(n):
            x0 = -BAY_HALF + i * step
            y0 = -BAY_HALF + j * step
            if max(abs(x0 + step / 2), abs(y0 + step / 2)) < 7.0:      # under the pedestal - skip
                continue
            key = ('hull_dark', 'floor_dark', 'floor_dark', 'panel_line')[rng.randrange(4)]
            st.append(G.box(f'Tile{i}_{j}', x0 + 0.04, x0 + step - 0.04, y0 + 0.04, y0 + step - 0.04, z - 0.3, z, key))
    # threshold apron out to the door (x 24 .. 26.5)
    st.append(G.box('Apron', BAY_HALF, DOOR_X + 2.0, -15.0, 15.0, z - 0.3, z, 'hull_dark'))
    st.append(G.box('Under', -BAY_HALF, DOOR_X + 2.0, -BAY_HALF, BAY_HALF, z - 0.9, z - 0.3, 'trim_black'))
    # painted lanes: a ring lane around the platform (yellow) + the lane to the door (orange)
    for s in (1, -1):
        st.append(G.box(f'LaneX{s}', -12.4, 12.4, s * 12.2 - 0.1, s * 12.2 + 0.1, z, z + 0.01, 'fuel_yellow'))
        st.append(G.box(f'LaneY{s}', s * 12.2 - 0.1, s * 12.2 + 0.1, -12.4, 12.4, z, z + 0.01, 'fuel_yellow'))
        st.append(G.box(f'DoorLane{s}', 12.4, DOOR_X + 1.8, s * 4.0 - 0.12, s * 4.0 + 0.12, z, z + 0.01,
                        'accent_iron'))
    for k in range(9):          # chevrons on the door lane pointing out to space
        x = 14.0 + k * 1.3
        for s in (1, -1):
            b = G.box(f'DChev{k}{s}', -0.5, 0.0, -0.08, 0.08, z, z + 0.012, 'accent_iron')
            G.transform(b, loc=(x, 0, 0), rot=(0, 0, s * 35))
            st.append(b)
    # floor lights along the door lane + threshold glow line
    for k in range(10):
        x = 13.0 + k * 1.3
        for s in (1, -1):
            st.append(G.box(f'FL{k}{s}', x - 0.12, x + 0.12, s * 4.4 - 0.08, s * 4.4 + 0.08, z, z + 0.03,
                            'engine_glow'))
    st.append(G.box('Threshold', DOOR_X + 1.9, DOOR_X + 2.0, -15.0, 15.0, z - 0.05, z + 0.04, 'engine_glow'))


def _catwalk(st):
    """Square service catwalk around the platform (below the platform top) with railings + legs."""
    import station_kit as K
    z = -0.95
    ri, ro = 9.0, 11.0
    for nm, f, rot in _sides():
        parts = [G.box(f'CW{nm}', ri, ro, -ro, ro, z - 0.12, z, 'hull_dark')]
        for j in range(22):
            t = -ro + 0.5 + j * 1.0
            parts.append(G.box(f'CWg{nm}{j}', ri + 0.1, ro - 0.1, t - 0.02, t + 0.02, z, z + 0.012, 'panel_line'))
        parts.append(G.box(f'CWr{nm}', ro - 0.06, ro, -ro, ro, z + 0.42, z + 0.47, 'accent_iron'))
        parts.append(G.box(f'CWk{nm}', ro - 0.05, ro, -ro, ro, z, z + 0.08, 'hull_dark'))
        for j in range(12):
            t = -ro + j * (2 * ro) / 11
            parts.append(G.box(f'CWp{nm}{j}', ro - 0.06, ro, t - 0.03, t + 0.03, z, z + 0.45, 'hull_dark'))
        for j in range(5):
            t = -8.0 + j * 4.0
            parts.append(G.box(f'CWleg{nm}{j}', 9.9, 10.1, t - 0.1, t + 0.1, BAY_DECK, z - 0.12, 'hull_dark'))
        for o in parts:
            G.apply_modifiers(o)
            o.data.transform(Matrix.Rotation(math.radians(rot), 4, 'Z'))
        st += parts
        # stair down to the deck at the middle of the W side only
    st += K.light_row('CWLamp', (ri + 0.1, -8.5, z), (ri + 0.1, 8.5, z), 8, 'window_warm', s=0.05, h=0.03)


def _tower(st, name, x, y):
    """Corner gantry tower: lattice from the deck, cap deck, work-light head aimed at the platform, amber lamp."""
    import station_kit as K
    top = 5.6
    st += K.box_truss(name, (x, y, BAY_DECK), (x, y, top), w=1.4, h=1.4, bar_w=0.14, mat='accent_iron',
                      rung_mat='hull_dark', rung=5)
    st.append(G.box(name + 'Foot', x - 1.0, x + 1.0, y - 1.0, y + 1.0, BAY_DECK, BAY_DECK + 0.35, 'hull_dark'))
    st.append(G.box(name + 'Cap', x - 1.05, x + 1.05, y - 1.05, y + 1.05, top, top + 0.3, 'hull_mid'))
    st.append(G.box(name + 'CapB', x - 1.07, x + 1.07, y - 1.07, y + 1.07, top + 0.05, top + 0.15, 'accent_iron'))
    d = Vector((-x, -y, 0)).normalized()
    head = Vector((x, y, top - 0.2)) + d * 1.25
    # light housing tilted down toward the platform
    h = G.box(name + 'Head', -0.3, 0.3, -0.75, 0.75, -0.35, 0.35, 'hull_dark')
    G.transform(h, loc=head, rot=(0, 35, math.degrees(math.atan2(d.y, d.x))))
    st.append(h)
    gl = G.box(name + 'Glow', 0.3, 0.33, -0.65, 0.65, -0.27, 0.27, 'light_white')
    G.transform(gl, loc=head, rot=(0, 35, math.degrees(math.atan2(d.y, d.x))))
    st.append(gl)
    st.append(K.bar(name + 'HeadArm', Vector((x, y, top - 0.1)), head, 0.18, 'hull_mid'))
    st.append(G.cyl(name + 'LampB', 0.18, 0.1, 'hull_dark', loc=(x, y, top + 0.35), verts=8))
    st.append(G.cyl(name + 'Lamp', 0.12, 0.18, 'light_amber', loc=(x, y, top + 0.49), verts=8))


def _racks(st, rng, x0, x1, y, face, levels=3):
    """Part racks along a wall: posts, shelves, T1/T2/T3-coloured crates (face = +1: open toward +y)."""
    keys = ('accent_iron', 'accent_iron', 'accent_titanium', 'accent_titanium', 'hull_light', 'accent_crystal')
    depth = 1.2
    ya, yb = (y, y + face * depth)
    ya, yb = min(ya, yb), max(ya, yb)
    n = int((x1 - x0) / 2.0)
    for i in range(n + 1):
        x = x0 + i * (x1 - x0) / n
        st.append(G.box(f'RkPost{x:.0f}{y:.0f}', x - 0.07, x + 0.07, ya, yb, BAY_DECK, BAY_DECK + 3.3, 'hull_dark'))
    for lv in range(levels):
        z = BAY_DECK + 0.25 + lv * 1.05
        st.append(G.box(f'RkShelf{lv}{y:.0f}{x0:.0f}', x0, x1, ya, yb, z - 0.06, z, 'hull_mid'))
        st.append(G.box(f'RkEdge{lv}{y:.0f}{x0:.0f}', x0, x1, (yb if face > 0 else ya) - 0.03,
                        (yb if face > 0 else ya) + 0.03, z - 0.12, z - 0.02, 'fuel_yellow'))
        x = x0 + 0.15
        while x < x1 - 0.7:
            w = rng.choice((0.6, 0.8, 0.8, 1.0))
            h = rng.choice((0.45, 0.6, 0.75))
            if rng.random() < 0.85 and x + w < x1 - 0.1:
                key = keys[rng.randrange(len(keys))]
                st.append(G.box(f'Crate{x:.1f}{lv}{y:.0f}', x, x + w, ya + 0.12, yb - 0.12, z, z + h, key))
                st.append(G.box(f'CrateS{x:.1f}{lv}{y:.0f}', x + w * 0.45, x + w * 0.55, ya + 0.1, yb - 0.1, z,
                                z + h + 0.01, 'hull_dark'))
            x += w + 0.12


def _cart(st, name, x, y, yaw, key='accent_iron'):
    """Tool cart: body, tool board, handle, wheels, stripe."""
    parts = [G.box(name, -0.5, 0.5, -0.32, 0.32, BAY_DECK + 0.15, BAY_DECK + 0.75, 'hull_mid'),
             G.box(name + 'Top', -0.52, 0.52, -0.34, 0.34, BAY_DECK + 0.75, BAY_DECK + 0.8, 'hull_dark'),
             G.box(name + 'Strip', -0.51, 0.51, -0.33, 0.33, BAY_DECK + 0.55, BAY_DECK + 0.62, key),
             G.box(name + 'Board', -0.45, 0.45, 0.26, 0.3, BAY_DECK + 0.8, BAY_DECK + 1.25, 'trim_black'),
             G.box(name + 'Tool', -0.3, -0.05, 0.31, 0.33, BAY_DECK + 0.9, BAY_DECK + 1.15, 'metal_bare'),
             G.box(name + 'Tool2', 0.05, 0.3, 0.31, 0.33, BAY_DECK + 0.95, BAY_DECK + 1.1, 'fuel_yellow'),
             G.box(name + 'Handle', -0.62, -0.55, -0.25, 0.25, BAY_DECK + 0.7, BAY_DECK + 0.95, 'hull_dark'),
             G.box(name + 'Lamp', 0.38, 0.46, -0.335, -0.325, BAY_DECK + 0.65, BAY_DECK + 0.71, 'light_green')]
    for sx in (-0.38, 0.38):
        for sy in (-0.26, 0.26):
            parts.append(G.cyl(f'{name}W{sx}{sy}', 0.1, 0.06, 'trim_black', loc=(sx, sy, BAY_DECK + 0.1), axis='Y',
                               verts=6))
    for o in parts:
        G.apply_modifiers(o)
        o.data.transform(Matrix.Translation((x, y, 0)) @ Matrix.Rotation(math.radians(yaw), 4, 'Z'))
    st += parts


def _wall(st, name, side):
    """Bay wall: side 'W' (x = -24), 'N' (y = +24), 'S' (y = -24).  Pilasters, gallery with windows,
    hazard foot band, wall lights; the N/S walls end at the door pillars."""
    if side == 'W':
        rot, L0, L1 = 180.0, -BAY_HALF - 1.0, BAY_HALF + 1.0
    elif side == 'N':
        rot, L0, L1 = 90.0, -BAY_HALF - 1.0, DOOR_X
    else:
        rot, L0, L1 = 270.0, -DOOR_X, BAY_HALF + 1.0
    d = BAY_HALF
    parts = [G.box(name, d, d + 1.0, L0, L1, BAY_DECK - 0.9, WALL_TOP, 'hull_dark'),
             G.box(name + 'Cap', d - 0.1, d + 1.1, L0, L1, WALL_TOP - 0.3, WALL_TOP, 'hull_mid'),
             G.box(name + 'Foot', d - 0.06, d, L0, L1, BAY_DECK, BAY_DECK + 0.5, 'accent_iron'),
             G.box(name + 'Gal', d - 1.2, d, L0, L1, 2.6, 2.8, 'hull_mid'),
             G.box(name + 'GalRail', d - 1.22, d - 1.15, L0, L1, 2.8, 3.3, 'accent_iron'),
             G.box(name + 'Win', d - 0.04, d, L0 + 1.0, L1 - 1.0, 3.5, 4.4, 'window_warm'),
             G.box(name + 'Band', d - 0.05, d, L0, L1, 5.4, 5.6, 'accent_iron')]
    n = int((L1 - L0) / 4.0)
    for j in range(n + 1):
        t = L0 + j * (L1 - L0) / n
        parts.append(G.box(f'{name}Pil{j}', d - 0.45, d, t - 0.35, t + 0.35, BAY_DECK, WALL_TOP - 0.3, 'hull_mid'))
        parts.append(G.box(f'{name}PilH{j}', d - 0.47, d - 0.44, t - 0.3, t + 0.3, BAY_DECK + 0.6, BAY_DECK + 1.1,
                           'trim_black'))
        if j % 2 == 0:
            parts.append(G.box(f'{name}WL{j}', d - 0.62, d - 0.45, t - 0.22, t + 0.22, 4.8, 5.05, 'light_white'))
    # hazard chevrons on the foot band
    for j in range(int((L1 - L0) / 1.2)):
        t = L0 + 0.6 + j * 1.2
        b = G.box(f'{name}Hz{j}', -0.03, 0.0, -0.12, 0.12, -0.25, 0.25, 'trim_black')
        G.apply_modifiers(b)
        b.data.transform(Matrix.Translation((d - 0.06, t, BAY_DECK + 0.25)) @ Matrix.Rotation(math.radians(40), 4, 'X'))
        parts.append(b)
    for o in parts:
        G.apply_modifiers(o)
        o.data.transform(Matrix.Rotation(math.radians(rot), 4, 'Z'))
    st += parts


def _door(st):
    """Bay door frame on +X, open to space: pillars, lintel, retracted door leaves, side light columns."""
    import station_kit as K
    x0, x1 = DOOR_X, DOOR_X + 1.6
    for s in (1, -1):
        ya, yb = sorted((s * 15.0, s * (BAY_HALF + 1.0)))
        st.append(G.box(f'Pillar{s}', x0, x1, ya, yb, BAY_DECK - 0.9, 9.0, 'hull_dark'))
        st.append(G.box(f'PillarFace{s}', x0 - 0.06, x0, ya, yb, BAY_DECK, 8.6, 'hull_mid'))
        yi = s * 15.0
        st.append(G.box(f'PillarHaz{s}', x0 - 0.1, x1 + 0.1, min(yi, yi - s * 0.3), max(yi, yi - s * 0.3),
                        BAY_DECK, 8.7, 'accent_iron'))
        for j in range(12):
            z = BAY_DECK + 0.4 + j * 0.85
            st.append(G.box(f'PHz{s}{j}', x0 - 0.12, x1 + 0.12, min(yi, yi - s * 0.31), max(yi, yi - s * 0.31),
                            z, z + 0.32, 'trim_black'))
        # retracted door leaves (stacked plates in the pillar recess)
        for k in range(3):
            yy = s * (16.0 + k * 1.6)
            st.append(G.box(f'Leaf{s}{k}', x0 - 0.9 + k * 0.25, x0 - 0.45 + k * 0.25, yy - 0.7, yy + 0.7, BAY_DECK,
                            7.6 - k * 0.3, 'hull_light' if k % 2 == 0 else 'hull_mid'))
            st.append(G.box(f'LeafB{s}{k}', x0 - 0.92 + k * 0.25, x0 - 0.88 + k * 0.25, yy - 0.7, yy + 0.7, 1.0, 1.5,
                            'accent_iron'))
        st += K.light_row(f'PCol{s}', (x0 - 0.12, yi - s * 0.45, BAY_DECK + 0.4), (x0 - 0.12, yi - s * 0.45, 8.2), 10,
                          'light_amber', s=0.07, h=0.12)
    st.append(G.box('Lintel', x0 + 0.1, x1, -BAY_HALF - 1.0, BAY_HALF + 1.0, 7.9, 9.0, 'hull_mid'))
    st.append(G.box('LintelB', x0 + 0.05, x0 + 0.1, -15.0, 15.0, 8.1, 8.4, 'accent_iron'))
    st += K.light_row('LintelL', (x0 + 0.04, -14.0, 7.82), (x0 + 0.04, 14.0, 7.82), 14, 'light_white', s=0.09, h=0.08)


def _arm(name, atlas_dir, x, side, rng):
    """Robotic assembly arm on a rail carriage.  Node `name` (origin = carriage on the rail top, slides along
    local X), child `name_Head` (pivot = wrist, turns about local +Y in glTF), `name_Tip` EMPTY (tool tip)."""
    import station_kit as K
    s = side                   # +1: rail at y = +13 reaching toward -y
    rz = BAY_DECK + 0.3        # rail top
    p = []
    p.append(G.box(name + 'Car', -0.75, 0.75, -0.6, 0.6, 0.0, 0.42, 'hull_dark'))
    p.append(G.box(name + 'CarB', -0.77, 0.77, -0.62, 0.62, 0.15, 0.27, 'accent_iron'))
    p.append(G.cyl(name + 'Base', 0.5, 0.42, 'hull_mid', loc=(0, 0, 0.62), verts=12, smooth=False))
    p.append(G.ring_band(name + 'BaseR', 0.52, 0.42, 0.75, 0.83, 'accent_iron', verts=12, smooth=False))
    shoulder = Vector((0, -s * 0.1, 1.15))
    elbow = Vector((0.3, -s * 1.25, 2.55))
    wrist = Vector((0.5, -s * 2.85, 1.75))
    p.append(G.box(name + 'Sh', -0.35, 0.35, -0.38, 0.38, 0.83, 1.4, 'accent_iron'))
    p.append(G.cyl(name + 'ShJ', 0.3, 0.9, 'hull_dark', loc=tuple(shoulder), axis='X', verts=10))
    p.append(K.bar(name + 'Up', shoulder, elbow, 0.38, 'accent_iron'))
    p.append(K.bar(name + 'UpS', shoulder + Vector((0.22, 0, 0)), elbow + Vector((0.22, 0, 0)), 0.1, 'hull_dark'))
    p.append(G.cyl(name + 'ElJ', 0.25, 0.7, 'hull_dark', loc=tuple(elbow), axis='X', verts=10))
    p.append(K.bar(name + 'Fo', elbow, wrist, 0.28, 'accent_iron'))
    p.append(K.bar(name + 'Hose', shoulder + Vector((-0.25, 0, 0.2)), elbow + Vector((-0.25, 0, 0.15)), 0.06,
                   'trim_black'))
    p.append(G.ellipsoid(name + 'Wr', 0.2, 0.2, 0.2, 'hull_dark', loc=tuple(wrist), seg=8, rings=4))
    p.append(G.box(name + 'Lamp', -0.08, 0.08, -0.08, 0.08, 1.4, 1.48, 'light_amber'))
    root = G.join(p, name)
    # head: welding torch pointing down/inward, pivot = wrist
    h = []
    tip = Vector((0.0, -s * 0.45, -0.55))
    h.append(K.bar(name + 'HTorch', Vector((0, 0, 0)), tip, 0.13, 'hull_mid'))
    h.append(G.box(name + 'HBody', -0.17, 0.17, -0.17, 0.17, -0.25, 0.05, 'hull_dark'))
    h.append(K.bar(name + 'HNoz', tip * 0.85, tip, 0.08, 'metal_bare'))
    h.append(G.box(name + 'HGlow', tip.x - 0.04, tip.x + 0.04, tip.y - 0.04, tip.y + 0.04, tip.z - 0.06, tip.z,
                   'engine_core'))
    head = G.join(h, name + '_Head')
    for ob, extra in ((root, []), (head, [])):
        GR.weather(ob, rng, extra=extra, near=0.3, far=1.2, grime=0.3)
        G.finalize(ob, atlas_dir)
    head.location = tuple(wrist)
    head.parent = root
    t = G.empty(name + '_Tip', loc=tuple(tip), size=0.1)
    t.parent = head
    root.location = (x, s * ARM_RAIL_Y, rz)
    return root


def build_bay(atlas_dir, seed=8202):
    import station_kit as K
    rng = random.Random(seed)
    st = []
    _deck(st, rng)
    _catwalk(st)
    # arm rails on +-Y with toothed racks + end stops
    for s in (1, -1):
        y = s * ARM_RAIL_Y
        st.append(G.box(f'Rail{s}', -9.5, 9.5, y - 0.45, y + 0.45, BAY_DECK, BAY_DECK + 0.3, 'hull_mid'))
        st.append(G.box(f'RailT{s}', -9.4, 9.4, y - 0.12, y + 0.12, BAY_DECK + 0.3, BAY_DECK + 0.34, 'metal_bare'))
        for e in (-9.7, 9.7):
            st.append(G.box(f'RailStop{s}{e}', e - 0.25, e + 0.25, y - 0.55, y + 0.55, BAY_DECK, BAY_DECK + 0.6,
                            'accent_iron'))
        st += K.light_row(f'RailL{s}', (-9.2, y - s * 0.47, BAY_DECK + 0.1), (9.2, y - s * 0.47, BAY_DECK + 0.1), 10,
                          'light_amber', s=0.05, h=0.05)
    # corner gantry towers
    for i, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        _tower(st, f'Tower{i}', sx * 17.0, sy * 17.0)
    # walls + door
    _wall(st, 'WallW', 'W')
    _wall(st, 'WallN', 'N')
    _wall(st, 'WallS', 'S')
    _door(st)
    # part racks: back wall and the back halves of the side walls
    rk = []
    _racks(rk, rng, -13.0, 13.0, 0.0, 1, levels=3)
    for o in rk:
        G.apply_modifiers(o)
        o.data.transform(Matrix.Translation((-BAY_HALF + 0.05, 0, 0)) @ Matrix.Rotation(math.radians(-90), 4, 'Z'))
    st += rk
    for s in (1, -1):
        rk = []
        _racks(rk, rng, -21.0, -5.0, 0.0, 1, levels=3)
        for o in rk:          # N wall: mirrored in y (normals flipped back), S wall: as built
            G.apply_modifiers(o)
            o.data.transform(Matrix.Translation((0, s * (BAY_HALF - 0.05), 0)) @ Matrix.Scale(-s, 4, (0, 1, 0)))
            if s > 0:
                o.data.flip_normals()
        st += rk
    # fuel tanks in the back corners + fuel lines to the pedestal
    for s in (1, -1):
        for k in range(2):
            y = s * (20.0 - k * 1.7)
            st += K.tank_h(f'FTank{s}{k}', -21.5, -15.5, y, BAY_DECK + 0.85, 0.75, body='fuel_yellow', cap='hull_light',
                           straps=3)
            for x in (-20.3, -16.7):
                st.append(G.box(f'FSad{s}{k}{x}', x - 0.2, x + 0.2, y - 0.6, y + 0.6, BAY_DECK, BAY_DECK + 0.35,
                                'hull_dark'))
        st.append(G.box(f'FMan{s}', -15.2, -14.4, s * 17.6 - 0.6, s * 17.6 + 0.6, BAY_DECK, BAY_DECK + 0.9,
                        'hull_mid'))
        st.append(G.box(f'FManV{s}', -14.45, -14.35, s * 17.6 - 0.3, s * 17.6 + 0.3, BAY_DECK + 0.4,
                        BAY_DECK + 0.7, 'accent_iron'))
        for j, (dy, key, r) in enumerate(((0.0, 'fuel_yellow', 0.09), (0.32, 'metal_bare', 0.07),
                                         (-0.32, 'accent_iron', 0.06))):
            pts = [(-14.8 + dy, s * 17.6, BAY_DECK + 0.25), (-14.8 + dy, s * 7.0, BAY_DECK + 0.25),
                   (-6.0, s * 7.0, BAY_DECK + 0.25)]
            for a, b in zip(pts[:-1], pts[1:]):
                st.append(K.bar(f'FL{s}{j}{a[0]:.0f}{a[1]:.0f}', a, b, 2 * r, key))
    # tool carts near the catwalk
    for i, (x, y, yaw, key) in enumerate(((-12.5, 6.0, 15, 'accent_iron'), (-13.0, -4.0, -10, 'accent_titanium'),
                                          (5.0, 15.5, 80, 'accent_iron'), (-4.0, -15.8, 100, 'fuel_yellow'),
                                          (11.5, -14.0, 40, 'accent_iron'), (14.5, 9.0, -30, 'accent_titanium'))):
        _cart(st, f'Cart{i}', x, y, yaw, key)
    # weather + atlas: the bay is one static mesh + the two arm nodes
    zones = GR.Zones().box(-12, 12, -12, 12, -9, 99)
    cfg = dict(panels=False, rows=(),
               scatter=[dict(density=0.06, top=0.5, side=1.0, max_size=0.6,
                             region=lambda p: abs(p.x) > BAY_HALF - 0.6 or abs(p.y) > BAY_HALF - 0.6)])
    root, _ = K.finish('Hangar_Bay', st, atlas_dir, 0, (), style='shipyard', seed=seed, zones=zones,
                       static_cfg=cfg, weather_cfg=dict(near=0.5, far=4.0, grime=0.35, scale=3.0))
    for i, (x, side) in enumerate(((-3.0, 1), (3.5, -1))):
        arm = _arm(f'Arm_{i}', atlas_dir, x, side, random.Random(seed + i))
        arm.parent = root
    return root
