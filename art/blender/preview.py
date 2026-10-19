"""Preview renders built from the EXPORTED .glb files (so the previews
validate the real deliverables): contact sheets, assembled ships at the 55 deg
game camera, a game-scale shot and a connectors before/after comparison.
Also saves orbit-able .blend scenes.

Hull connector placement (same rule the game should use), cells = set of
occupied integer grid cells (x, y):
  * edge:   for every pair (x, y),(x+1, y) both occupied -> hull_connector_edge
            at (x + 0.5, y), rotation 0.
            for every pair (x, y),(x, y+1) both occupied -> hull_connector_edge
            at (x, y + 0.5), rotation 90 deg about the up axis.
  * corner: for every (x, y) where (x, y),(x+1, y),(x, y+1),(x+1, y+1) are all
            occupied -> hull_connector_corner at (x + 0.5, y + 0.5).
"""
import math
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402

from lib import geo as G  # noqa: E402
from lib import render as R  # noqa: E402
import paths  # noqa: E402

# ----------------------------------------------------------------------------
# content
# ----------------------------------------------------------------------------
M1_SHEET = [  # (folder, file, label, camera azimuth, elevation)
    ('parts', 'mining_laser_iron', 'MINING LASER', -55, 36),
    ('parts', 'cargo_iron', 'CARGO', -55, 36),
    ('parts', 'fuel_tank_iron', 'FUEL TANK', -55, 36),
    ('parts', 'reactor_iron', 'REACTOR', -55, 36),
    ('parts', 'radar_iron', 'RADAR', -55, 36),
    ('asteroids', 'asteroid_copper_a', 'COPPER  A', -70, 32),
    ('asteroids', 'asteroid_copper_b', 'COPPER  B', -70, 32),
    ('asteroids', 'asteroid_titanium_a', 'TITANIUM  A', -70, 32),
    ('asteroids', 'asteroid_titanium_b', 'TITANIUM  B', -70, 32),
    ('asteroids', 'asteroid_iron_a', 'IRON  A  (wider veins)', -70, 32),
]

# starter ship: (part file, (x, y), rotation_deg)
M1_SHIP = [
    ('cockpit_iron', (1, 0), 0),
    ('gyroscope_iron', (0, 0), 0),
    ('mining_laser_iron', (2, 0), 0),
    ('reactor_iron', (-1, 0), 0),
    ('cargo_iron', (0, 1), 0), ('cargo_iron', (0, -1), 0),
    ('fuel_tank_iron', (1, 1), 0),
    ('radar_iron', (1, -1), 0),
    ('engine_iron', (-1, 1), 0), ('engine_iron', (-1, -1), 0),
    ('engine_iron', (2, 1), 180), ('engine_iron', (2, -1), 180),
    ('engine_iron', (0, -2), 90),     # thrusts +Y, nozzle toward -Y
    ('engine_iron', (0, 2), 270),     # thrusts -Y, nozzle toward +Y
]

M1_ROCKS = [  # game-scale shot: (file, location, rot_z)
    ('asteroid_iron_a', (6.5, 4.0, -1.0), 30),
    ('asteroid_ice_b', (-7.0, 4.2, -1.6), 70),
    ('asteroid_copper_b', (-5.8, -4.6, -1.2), 140),
    ('asteroid_titanium_a', (8.0, -4.4, -1.4), 200),
    ('asteroid_copper_a', (11.5, 1.0, -2.0), 90),
    ('asteroid_titanium_b', (-12.0, -0.5, -2.5), 10),
]


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
def import_glb(path, loc=(0, 0, 0), rot_z=0.0):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None]
    for r in roots:
        r.location = loc
        r.rotation_mode = 'XYZ'
        r.rotation_euler = (0, 0, math.radians(rot_z))
    bpy.context.view_layer.update()   # refresh matrix_world before bounds()
    return roots, new


def _hide(objs, hidden):
    for o in objs:
        o.hide_render = hidden
        o.hide_viewport = hidden


def _tri_count(objs):
    return sum(G.tri_count(o) for o in objs if o.type == 'MESH')


def connector_placements(cells):
    """cells: iterable of (x, y).  Returns [(file, (x, y), rot_deg)]."""
    cells = set(cells)
    out = []
    for (x, y) in sorted(cells):
        if (x + 1, y) in cells:
            out.append(('hull_connector_edge', (x + 0.5, y), 0))
        if (x, y + 1) in cells:
            out.append(('hull_connector_edge', (x, y + 0.5), 90))
        if {(x + 1, y), (x, y + 1), (x + 1, y + 1)} <= cells:
            out.append(('hull_connector_corner', (x + 0.5, y + 0.5), 0))
    return out


def _save_blend(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        bpy.ops.file.pack_all()
    except Exception as e:
        print('pack_all failed:', e)
    bpy.context.preferences.filepaths.save_version = 0   # no .blend1 backups
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)


def _new_scene(w, h, samples, seed=0.0, key_az=-120):
    G.reset_scene()
    R.setup_render(w, h, samples=samples)
    R.setup_world(seed=seed)
    R.setup_lights(key_az=key_az)
    return R.make_camera(lens=50)


# ----------------------------------------------------------------------------
# contact sheet
# ----------------------------------------------------------------------------
def contact_sheet(entries, cols, tile_w, tile_h, out_png, blend_path, gap_x=4, gap_y=4, label_size=0.036):
    cam = _new_scene(tile_w, tile_h, 128, key_az=-120)
    tile_dir = os.path.join(paths.OUT, 'tmp_tiles')
    groups = []
    for i, (folder, f, label, az, el) in enumerate(entries):
        big = folder == 'asteroids'
        loc = ((i % cols) * (7.0 if big else 1.8) - 8, (12.0 if big else 0.0), 0)
        roots, objs = import_glb(os.path.join(paths.MODELS, folder, f + '.glb'), loc=loc)
        groups.append((objs, label + ('' if big else '\nT1  IRON'), az, el))
    allobjs = [o for g in groups for o in g[0]]
    tiles = []
    for gi, (objs, label, az, el) in enumerate(groups):
        _hide(allobjs, True)
        _hide(objs, False)
        c, r = R.bounds(objs)
        R.aim_camera(cam, c, el, az, R.fit_distance(cam, r, margin=1.12))
        lab = R.camera_label(cam, f'{label}\n{_tri_count(objs)} tris', y_frac=-0.40, size_frac=label_size)
        tiles.append(R.render_to(os.path.join(tile_dir, f'tile_{gi}.png')))
        bpy.data.objects.remove(lab)
    R.stitch(tiles, cols, tile_w, tile_h, out_png, gap=gap_x, gap_y=gap_y)
    shutil.rmtree(tile_dir, ignore_errors=True)
    _hide(allobjs, False)
    R.aim_camera(cam, (0, 6, 0), 40, -90, 30)
    if blend_path:
        _save_blend(blend_path)


# ----------------------------------------------------------------------------
# ships
# ----------------------------------------------------------------------------
def build_ship(layout, connectors=True):
    objs, conn = [], []
    for f, (x, y), rot in layout:
        roots, new = import_glb(os.path.join(paths.PARTS, f + '.glb'), loc=(x, y, 0), rot_z=rot)
        objs += new
    if connectors:
        for f, (x, y), rot in connector_placements([c for _, c, _ in layout]):
            roots, new = import_glb(os.path.join(paths.PARTS, f + '.glb'), loc=(x, y, 0), rot_z=rot)
            conn += new
    return objs, conn


def add_rocks(rocks):
    out = []
    for f, loc, rz in rocks:
        r, new = import_glb(os.path.join(paths.ASTEROIDS, f + '.glb'), loc=loc, rot_z=rz)
        out += new
    return out


def ship_bounds_centre(layout):
    xs = [c[0] for _, c, _ in layout]
    ys = [c[1] for _, c, _ in layout]
    return ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, 0.0)


def render_m1_ship(ship_png, gamescale_png, blend_path, compare_png, iter_dir=None, tag=None):
    centre = ship_bounds_centre(M1_SHIP)
    # --- before / after (two 800x900 halves) --------------------------------
    halves = []
    for with_conn in (False, True):
        cam = _new_scene(798, 900, 128, seed=3.0, key_az=-140)
        build_ship(M1_SHIP, connectors=with_conn)
        R.aim_camera(cam, centre, 55, -90, 15.5)
        lab = R.camera_label(cam, 'WITH CONNECTORS' if with_conn else 'WITHOUT CONNECTORS',
                             y_frac=-0.44, size_frac=0.032)
        halves.append(R.render_to(os.path.join(paths.OUT, 'tmp_tiles', f'half_{int(with_conn)}.png')))
    R.stitch(halves, 2, 798, 900, compare_png, gap=4)
    shutil.rmtree(os.path.join(paths.OUT, 'tmp_tiles'), ignore_errors=True)
    # --- hero ship shot + game scale ----------------------------------------
    cam = _new_scene(1600, 900, 160, seed=3.0, key_az=-140)
    ship, conn = build_ship(M1_SHIP, connectors=True)
    rocks = add_rocks(M1_ROCKS)
    R.aim_camera(cam, centre, 55, -90, 11.0)
    _hide(rocks, True)
    R.render_to(ship_png)
    _hide(rocks, False)
    R.aim_camera(cam, centre, 55, -90, 40.0)
    R.render_to(gamescale_png)
    R.aim_camera(cam, centre, 55, -90, 11.0)
    _save_blend(blend_path)


def main_m1(iter_tag=None):
    os.makedirs(paths.PREVIEWS, exist_ok=True)
    a = os.path.join(paths.PREVIEWS, 'm1-assets.png')
    s = os.path.join(paths.PREVIEWS, 'm1-ship.png')
    g = os.path.join(paths.PREVIEWS, 'm1-gamescale.png')
    c = os.path.join(paths.PREVIEWS, 'm1-connectors-before-after.png')
    contact_sheet(M1_SHEET, 5, 316, 448, a, os.path.join(paths.BLEND, 'm1-assets.blend'), gap_x=5, gap_y=4)
    render_m1_ship(s, g, os.path.join(paths.BLEND, 'm1-ship.blend'), c)
    _keep_iterations(iter_tag, ((a, 'm1-assets'), (s, 'm1-ship'), (g, 'm1-gamescale'), (c, 'm1-connectors')))


# ----------------------------------------------------------------------------
# M2: titanium tier + asteroid variety
# ----------------------------------------------------------------------------
M2_PARTS = [  # (part, label, camera azimuth)
    ('cockpit', 'COCKPIT', -60), ('armor', 'ARMOR', -60), ('engine', 'ENGINE', -125),
    ('gyroscope', 'GYROSCOPE', -60), ('mining_laser', 'MINING LASER', -60), ('cargo', 'CARGO', -60),
    ('fuel_tank', 'FUEL TANK', -60), ('reactor', 'REACTOR', -60), ('radar', 'RADAR', -60),
]
M2_ROCK_KINDS = ('iron', 'ice', 'copper', 'titanium')


def tier_sheet(out_png, tile_w=530, tile_h=297, cols=3):
    """Each tile: the same part in T1 iron (left) and T2 titanium (right)."""
    cam = _new_scene(tile_w, tile_h, 128, key_az=-120)
    tile_dir = os.path.join(paths.OUT, 'tmp_tiles')
    tiles = []
    for i, (part, label, az) in enumerate(M2_PARTS):
        r_az = math.radians(az)
        right = (-math.sin(r_az), math.cos(r_az))
        base = (i * 4.0, 0.0)
        objs = []
        for tier, side in (('iron', -1), ('titanium', 1)):
            loc = (base[0] + side * 0.66 * right[0], base[1] + side * 0.66 * right[1], 0)
            _, new = import_glb(os.path.join(paths.PARTS, f'{part}_{tier}.glb'), loc=loc)
            objs += new
        _hide([o for o in bpy.data.objects if o.type in ('MESH', 'EMPTY')], True)
        _hide(objs, False)
        c, r = R.bounds(objs)
        R.aim_camera(cam, c, 36, az, R.fit_distance(cam, r, margin=0.82))
        labs = [R.camera_label(cam, label, y_frac=0.41, size_frac=0.06),
                R.camera_label(cam, 'T1  IRON', y_frac=-0.42, x_frac=-0.2, size_frac=0.05),
                R.camera_label(cam, 'T2  TITANIUM', y_frac=-0.42, x_frac=0.2, size_frac=0.05)]
        tiles.append(R.render_to(os.path.join(tile_dir, f'tier_{i}.png')))
        for lb in labs:
            bpy.data.objects.remove(lb)
    R.stitch(tiles, cols, tile_w, tile_h, out_png, gap=5, gap_y=4)
    shutil.rmtree(tile_dir, ignore_errors=True)


def asteroid_sheet(out_png, blend_path):
    entries = []
    for row in ('a', 'b', 'c'):
        for kind in M2_ROCK_KINDS:
            entries.append(('asteroids', f'asteroid_{kind}_{row}', f'{kind.upper()}  {row.upper()}', -70, 32))
    contact_sheet(entries, 4, 397, 297, out_png, blend_path, gap_x=4, gap_y=4, label_size=0.055)


def _ship_layout(tier):
    return [(f.replace('_iron', '_' + tier), c, r) for f, c, r in M1_SHIP]


def render_m2_ship(ship_png, gamescale_png, blend_path):
    layout = _ship_layout('titanium')
    centre = ship_bounds_centre(layout)
    cam = _new_scene(1600, 900, 160, seed=3.0, key_az=-140)
    ship, conn = build_ship(layout, connectors=True)
    R.aim_camera(cam, centre, 55, -90, 11.0)
    R.render_to(ship_png)
    _save_blend(blend_path)
    # game scale: iron ship (left) next to the titanium ship (right) among rocks
    cam = _new_scene(1600, 900, 160, seed=3.0, key_az=-140)
    for tier, dx in (('iron', -3.2), ('titanium', 3.2)):
        lay = [(f, (c[0] + dx, c[1]), r) for f, c, r in _ship_layout(tier)]
        build_ship(lay, connectors=True)
    add_rocks([('asteroid_iron_c', (-10.5, 4.5, -1.5), 30), ('asteroid_ice_c', (11.5, 4.8, -1.8), 70),
               ('asteroid_copper_c', (-10.0, -4.8, -1.2), 140), ('asteroid_titanium_c', (11.0, -4.6, -1.4), 200)])
    R.aim_camera(cam, (centre[0], 0, 0), 55, -90, 40.0)
    R.camera_label(cam, 'T1  IRON', y_frac=-0.2, x_frac=-0.085, size_frac=0.025)
    R.camera_label(cam, 'T2  TITANIUM', y_frac=-0.2, x_frac=0.11, size_frac=0.025)
    R.render_to(gamescale_png)


def main_m2(iter_tag=None):
    os.makedirs(paths.PREVIEWS, exist_ok=True)
    t = os.path.join(paths.PREVIEWS, 'm2-tiers.png')
    s = os.path.join(paths.PREVIEWS, 'm2-ship.png')
    g = os.path.join(paths.PREVIEWS, 'm2-gamescale.png')
    a = os.path.join(paths.PREVIEWS, 'm2-asteroids.png')
    tier_sheet(t)
    render_m2_ship(s, g, os.path.join(paths.BLEND, 'm2-ship.blend'))
    asteroid_sheet(a, os.path.join(paths.BLEND, 'm2-asteroids.blend'))
    _keep_iterations(iter_tag, ((t, 'm2-tiers'), (s, 'm2-ship'), (g, 'm2-gamescale'), (a, 'm2-asteroids')))


def _keep_iterations(iter_tag, files):
    if iter_tag:
        it = os.path.join(paths.PREVIEWS, 'iterations')
        os.makedirs(it, exist_ok=True)
        for src, nm in files:
            shutil.copyfile(src, os.path.join(it, f'{iter_tag}-{nm}.png'))
    print('PREVIEWS', [f for f, _ in files])


def main(iter_tag=None, mode='m3'):
    if mode == 'm3':
        import preview_m3
        return preview_m3.main(iter_tag)
    if mode == 'm2s':
        import preview_stations
        return preview_stations.main(iter_tag)
    {'m1': main_m1, 'm2': main_m2}[mode](iter_tag)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(argv[argv.index('--iter') + 1] if '--iter' in argv else None,
         argv[argv.index('--preview') + 1] if '--preview' in argv else 'm3')
