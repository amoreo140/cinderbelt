"""M5a previews: T3 crystal tier (T1/T2/T3 side by side), Wardens + Colossus,
ring-3 crystal fields + rare-earth asteroids, icons.

  blender --background --factory-startup --python art/blender/preview_m5a.py -- [--only t3,enemies,crystals,icons] [--iter m5a1]

Outputs (art/out/previews/): m5a-t3.png (+ m5a-t3-b.png), m5a-t3-ship.png,
m5a-enemies.png, m5a-crystals.png, m5a-icons.png.
"""
import math
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import paths  # noqa: E402
import preview as PV  # noqa: E402
import preview_m2d as P2  # noqa: E402
import preview_m4 as P4  # noqa: E402
from lib import render as R  # noqa: E402

TMP = os.path.join(paths.OUT, 'tmp_tiles_m5a')
T123 = (('iron', 'T1  IRON'), ('titanium', 'T2  TITANIUM'), ('crystal', 'T3  CRYSTAL'))

SHEET_A = [  # (module, label, turn node, deg, camera azimuth)
    ('cockpit', 'COCKPIT', None, 0, -60), ('engine', 'ENGINE', None, 0, -125),
    ('mining_laser', 'MINING LASER', 'Laser_Head', -25, -60), ('reactor', 'REACTOR', None, 0, -60),
    ('cargo', 'CARGO', None, 0, -60), ('armor', 'ARMOR', None, 0, -60),
    ('gyroscope', 'GYROSCOPE', None, 0, -60), ('fuel_tank', 'FUEL TANK', None, 0, -60),
    ('radar', 'RADAR', None, 0, -60), ('cannon', 'CANNON', 'Cannon_Turret', -25, -60),
    ('shield_generator', 'SHIELD', None, 0, -60), ('shielding', 'SHIELDING (radiation)  new', None, 0, -60),
]
SHEET_B = [
    ('heavy_laser', 'HEAVY LASER 2x1', 'Laser_Head', -25, -58), ('large_cargo', 'LARGE CARGO 2x2', None, 0, -58),
    ('battery', 'BATTERY', None, 0, -60), ('tractor_beam', 'TRACTOR BEAM', 'Tractor_Head', -25, -60),
    ('refinery', 'REFINERY 2x1', None, 0, -58), ('large_reactor', 'LARGE REACTOR 2x2', None, 0, -58),
    ('repair_module', 'REPAIR MODULE', 'Repair_Arm', -30, -60),
]


def _clear():
    for o in list(bpy.data.objects):
        if o.type in ('MESH', 'EMPTY'):
            bpy.data.objects.remove(o)


def tier_sheet(entries, out_png, tw=530, th=300, cols=3):
    cam = PV._new_scene(tw, th, 128, key_az=-120)
    tiles = []
    for i, (part, label, node, deg, az) in enumerate(entries):
        _clear()
        w, h = P4.CELLS.get(part, (1, 1))
        r_az = math.radians(az)
        right = (-math.sin(r_az), math.cos(r_az))
        step = 1.3 * max(w, h) + (0.2 if max(w, h) > 1 else 0.0)
        objs = []
        for k, (tier, _) in enumerate(T123):
            off = (k - 1) * step
            loc = (off * right[0], off * right[1], 0)
            _, new = PV.import_glb(os.path.join(paths.PARTS, f'{part}_{tier}.glb'), loc=loc)
            if node:
                P2._turn(new, node, deg)
            objs += new
        c, r = R.bounds(objs)
        R.aim_camera(cam, c, 36, az, R.fit_distance(cam, r, margin=0.78))
        labs = [R.camera_label(cam, label, y_frac=0.41, size_frac=0.06)]
        for k, (_, txt) in enumerate(T123):
            labs.append(R.camera_label(cam, txt, y_frac=-0.43, x_frac=(k - 1) * 0.31, size_frac=0.045))
        tiles.append(R.render_to(os.path.join(TMP, f't_{i}.png')))
        for lb in labs:
            bpy.data.objects.remove(lb)
    R.stitch(tiles, cols, tw, th, out_png, gap=5, gap_y=4)


def t3_ship(out_png, game_png):
    """The M2d ship layout in T3 (+ a T2 copy at game scale for comparison)."""
    lay3 = [(f.replace('_iron', '_crystal'), c, r) for f, c, r in P2.M2D_SHIP]
    cam = PV._new_scene(1600, 900, 160, seed=3.0, key_az=-140)
    objs = P2.build_ship_multi(lay3)
    c, r = R.bounds([o for o in objs if o.type == 'MESH'])
    R.aim_camera(cam, (c[0], c[1], 0), 55, -90, 13.0)
    R.camera_label(cam, 'T3 CRYSTAL ship (M2d layout)', y_frac=0.44, size_frac=0.03)
    R.render_to(out_png)
    for o in list(bpy.data.objects):
        if o.type == 'FONT':
            bpy.data.objects.remove(o)
    lay2 = [(f.replace('_iron', '_titanium'), (c_[0], c_[1] + 7.5), r_) for f, c_, r_ in P2.M2D_SHIP]
    lay1 = [(f, (c_[0], c_[1] - 7.5), r_) for f, c_, r_ in P2.M2D_SHIP]
    P2.build_ship_multi(lay2)
    P2.build_ship_multi(lay1)
    R.aim_camera(cam, (c[0], -1.2, 0), 55, -90, 44.0)
    for txt, y in (('T2', 0.21), ('T3', 0.02), ('T1', -0.2)):
        R.camera_label(cam, txt, y_frac=y, x_frac=-0.2, size_frac=0.03)
    R.render_to(game_png)


def main(only=None, iter_tag=None):
    os.makedirs(paths.PREVIEWS, exist_ok=True)
    P = paths.PREVIEWS
    files = []
    if not only or 't3' in only:
        a = os.path.join(P, 'm5a-t3.png')
        b = os.path.join(P, 'm5a-t3-b.png')
        tier_sheet(SHEET_A, a)
        tier_sheet(SHEET_B, b)
        s = os.path.join(P, 'm5a-t3-ship.png')
        g = os.path.join(P, 'm5a-t3-gamescale.png')
        t3_ship(s, g)
        files += [(a, 'm5a-t3'), (b, 'm5a-t3-b'), (s, 'm5a-t3-ship'), (g, 'm5a-t3-gamescale')]
    if not only or 'enemies' in only:
        import preview_m5a_world as W
        p = os.path.join(P, 'm5a-enemies.png')
        W.enemies_sheet(p, os.path.join(paths.BLEND, 'm5a-kolos.blend'))
        files.append((p, 'm5a-enemies'))
    if not only or 'crystals' in only:
        import preview_m5a_world as W
        p = os.path.join(P, 'm5a-crystals.png')
        W.crystals_sheet(p)
        files.append((p, 'm5a-crystals'))
    if not only or 'icons' in only:
        import preview_m5a_world as W
        p = os.path.join(P, 'm5a-icons.png')
        W.icons_sheet(p)
        files.append((p, 'm5a-icons'))
    shutil.rmtree(TMP, ignore_errors=True)
    PV._keep_iterations(iter_tag, files)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else None,
         argv[argv.index('--iter') + 1] if '--iter' in argv else None)
