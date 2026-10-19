"""Render the asteroid style comparison sheet (art/out/previews/asteroid-styles.png).

  blender --background --factory-startup --python art/blender/style_study.py -- [--styles A,B,C] [--iter tag]
"""
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
import asteroid_styles as AS  # noqa: E402
from lib import materials as M  # noqa: E402
from lib import render as R  # noqa: E402

RESOURCES = ('iron', 'copper', 'ice', 'titanium')
SEEDS = {'iron': 11, 'copper': 53, 'ice': 37, 'titanium': 71}
RADIUS = 2.3
ROW_W, ROW_H, CU_W = 1100, 400, 496
TMP = os.path.join(paths.OUT, 'tmp_tiles')
LABELS = {'A': 'A  -  STYLIZED SCULPTED', 'B': 'B  -  BAKED SEMI-REALISTIC', 'C': 'C  -  REFINED FACETED'}


def build_rocks(style, xs):
    rocks = []
    for res, x in zip(RESOURCES, xs):
        name = f'{style}_{res}'
        if style == 'A':
            ob = AS.build_A(name, res, SEEDS[res], RADIUS, paths.ATLAS)
        elif style == 'C':
            ob = AS.build_C(name, res, SEEDS[res], RADIUS, paths.ATLAS)
        else:
            ob = AS.build_B(name, res, SEEDS[res], RADIUS, paths.ATLAS,
                            os.path.join(paths.OUT, 'style_study_tex'))
        if style in ('A', 'C'):
            vc = AS.vc_material()
            for s in ob.material_slots:
                s.material = vc
        ob.location = (x, 0, 0)
        rocks.append(ob)
    bpy.context.view_layer.update()
    return rocks


def render_style(style):
    cam = PV._new_scene(ROW_W, ROW_H, 128, seed=3.0, key_az=-140)
    M.build_atlas_images(paths.ATLAS)
    xs = (-13.0, -6.6, -0.2, 6.2)
    rocks = build_rocks(style, xs)
    lay = [(f, (c[0] + 12.5, c[1]), r) for f, c, r in PV.M1_SHIP]
    PV.build_ship(lay, connectors=True)
    # game-like camera: 55 deg, ship ~170 px wide
    R.aim_camera(cam, (0.0, 0.0, 0.0), 55, -90, 27.0)
    R.camera_label(cam, LABELS[style], y_frac=0.42, x_frac=-0.36, size_frac=0.05, align='LEFT')
    row = R.render_to(os.path.join(TMP, f'row_{style}.png'))
    # close-up of the copper rock
    sc = bpy.context.scene
    sc.render.resolution_x = CU_W
    for o in list(bpy.data.objects):
        if o.type == 'FONT':
            bpy.data.objects.remove(o)
    target = rocks[1]
    c, r = R.bounds([target] + list(target.children_recursive))
    R.aim_camera(cam, c, 40, -62, R.fit_distance(cam, r, margin=0.85))
    R.camera_label(cam, 'close-up (copper)', y_frac=-0.43, size_frac=0.045)
    cu = R.render_to(os.path.join(TMP, f'cu_{style}.png'))
    PV._save_blend(os.path.join(paths.BLEND, f'asteroid-style-{style}.blend'))
    return row, cu


def compose(rows, out_png, gap=4):
    H = len(rows) * ROW_H + (len(rows) - 1) * gap
    W = ROW_W + gap + CU_W
    canvas = np.zeros((H, W, 4), np.float32)
    canvas[..., :3] = (0.02, 0.025, 0.035)
    canvas[..., 3] = 1
    for i, (row, cu) in enumerate(rows):
        y0 = H - (i + 1) * ROW_H - i * gap
        canvas[y0:y0 + ROW_H, 0:ROW_W] = R.read_png(row)
        canvas[y0:y0 + ROW_H, ROW_W + gap:] = R.read_png(cu)
    R.write_png(canvas, out_png)


def main(argv):
    styles = argv[argv.index('--styles') + 1].split(',') if '--styles' in argv else ['A', 'B', 'C']
    tag = argv[argv.index('--iter') + 1] if '--iter' in argv else None
    rows = [render_style(s) for s in styles]
    out = os.path.join(paths.PREVIEWS, 'asteroid-styles.png')
    compose(rows, out)
    if tag:
        os.makedirs(os.path.join(paths.PREVIEWS, 'iterations'), exist_ok=True)
        shutil.copyfile(out, os.path.join(paths.PREVIEWS, 'iterations', f'{tag}-asteroid-styles.png'))
    shutil.rmtree(TMP, ignore_errors=True)
    print('SHEET', out)


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
