"""Final asteroid previews: all 12 rocks + ship at the game camera, and a
game-zoom field scene."""
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402

import paths  # noqa: E402
import preview as PV  # noqa: E402
from lib import render as R  # noqa: E402

KINDS = ('iron', 'copper', 'ice', 'titanium')


def lineup(out_png):
    cam = PV._new_scene(1600, 900, 160, seed=3.0, key_az=-140)
    for i, k in enumerate(KINDS):
        for j, v in enumerate('abc'):
            PV.add_rocks([(f'asteroid_{k}_{v}', (-15 + i * 8.2, 7.5 - j * 7.5, 0), 20 + 40 * j)])
    for i, k in enumerate(KINDS):     # breakup fragments under each column
        for j, v in enumerate('abc'):
            for m in range(2):
                PV.add_rocks([(f'asteroid_frag_{k}_{v}',
                               (-17.2 + i * 8.2 + j * 1.5, -12.2 + m * 1.4 - (j % 2) * 0.5, 0), 40 * j + 90 * m)])
    lay = [(f, (c[0] + 19.5, c[1]), r) for f, c, r in PV.M1_SHIP]
    PV.build_ship(lay, connectors=True)
    R.aim_camera(cam, (2.0, -2.2, 0.0), 55, -90, 54.0)
    R.camera_label(cam, 'breakup fragments (bottom row)', y_frac=-0.44, x_frac=-0.2, size_frac=0.022)
    for i, k in enumerate(KINDS):
        R.camera_label(cam, k.upper(), y_frac=0.44, x_frac=-0.355 + i * 0.165, size_frac=0.028)
    R.render_to(out_png)
    PV._save_blend(os.path.join(paths.BLEND, 'asteroids-final.blend'))


def field(out_png):
    """Game-like zoom: ship among a random field (random scale + rotation)."""
    cam = PV._new_scene(1600, 900, 160, seed=5.0, key_az=-140)
    rng = random.Random(4)
    names = [f'asteroid_{k}_{v}' for k in KINDS for v in 'abc']
    placed = []
    while len(placed) < 14:
        x, y = rng.uniform(-24, 24), rng.uniform(-14, 14)
        if abs(x) < 5 and abs(y) < 4:
            continue
        if any(math.hypot(x - a, y - b) < 6.5 for a, b in placed):
            continue
        placed.append((x, y))
        n = names[len(placed) % len(names)]
        before = set(bpy.data.objects)
        PV.add_rocks([(n, (x, y, rng.uniform(-1.5, -0.5)), rng.uniform(0, 360))])
        for o in bpy.data.objects:
            if o not in before and o.parent is None:
                s = rng.uniform(0.8, 1.5)
                o.scale = (s, s, s)
                o.rotation_euler = (rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6), rng.uniform(0, 6.3))
    PV.build_ship(PV.M1_SHIP, connectors=True)
    R.aim_camera(cam, (0.5, 0.0, 0.0), 55, -90, 36.0)
    R.render_to(out_png)


def main(iter_tag=None):
    a = os.path.join(paths.PREVIEWS, 'asteroids-final.png')
    b = os.path.join(paths.PREVIEWS, 'asteroids-gamezoom.png')
    lineup(a)
    field(b)
    PV._keep_iterations(iter_tag, ((a, 'asteroids-final'), (b, 'asteroids-gamezoom')))


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(argv[argv.index('--iter') + 1] if '--iter' in argv else None)
