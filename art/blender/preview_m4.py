"""M4 previews: new parts (refinery 2x1, large reactor 2x2, repair module),
POIs (abandoned stations + relay, comet, NPC trader) and the home-station
modules on their attach points.

  blender --background --factory-startup --python art/blender/preview_m4.py -- [--only parts,pois,home] [--iter m4a1]

Outputs (art/out/previews/): m4-parts.png, m4-pois.png, m4-home-modules.png
(+ m4-home.blend in art/out/blend/).
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
from lib import render as R  # noqa: E402

TMP = os.path.join(paths.OUT, 'tmp_tiles_m4')

CELLS = {'refinery': (2, 1), 'large_reactor': (2, 2), 'repair_module': (1, 1), 'shielding': (1, 1),
         'heavy_laser': (2, 1), 'large_cargo': (2, 2)}


def _clear():
    for o in list(bpy.data.objects):
        if o.type in ('MESH', 'EMPTY'):
            bpy.data.objects.remove(o)


def _labels(cam, items):
    return [R.camera_label(cam, txt, y_frac=y, x_frac=x, size_frac=s) for txt, x, y, s in items]


def _drop(labs):
    for lb in labs:
        bpy.data.objects.remove(lb)


def tier_tile(cam, part, label, tiers, path, node=None, deg=0, el=38, az=-58, margin=0.84, spread=1.0):
    """Same part in several tiers on a diagonal line (front-left -> back-right)."""
    _clear()
    w, h = CELLS.get(part, (1, 1))
    objs = []
    n = len(tiers)
    gap = (0.62 + 0.5 * (h - 1) + 0.25 * (w - 1)) * spread
    for k, (tier, _) in enumerate(tiers):
        f = (k - (n - 1) / 2)
        loc = (f * gap * 1.1, -f * gap * 1.8, 0)
        _, new = PV.import_glb(os.path.join(paths.PARTS, f'{part}_{tier}.glb'), loc=loc)
        if node:
            P2._turn(new, node, deg)
        objs += new
    c, r = R.bounds(objs)
    R.aim_camera(cam, c, el, az, R.fit_distance(cam, r, margin=margin))
    items = [(label, 0, 0.42, 0.05)]
    xs = [-0.30, 0.0, 0.30] if n == 3 else [-0.16, 0.16]
    for k, (_, txt) in enumerate(tiers):
        items.append((txt, xs[k], -0.43, 0.038))
    if node:
        items.append((f'{node} turned {deg} deg', 0, 0.35, 0.03))
    labs = _labels(cam, items)
    out = R.render_to(path)
    _drop(labs)
    return out


T12 = (('iron', 'T1  IRON'), ('titanium', 'T2  TITANIUM'))


def parts_sheet(out_png, tile_w=798, tile_h=448):
    cam = PV._new_scene(tile_w, tile_h, 128, key_az=-120)
    tiles = [
        tier_tile(cam, 'refinery', 'ONBOARD REFINERY  2x1   ice > fuel, ore > ingot', T12,
                  os.path.join(TMP, 'p0.png'), spread=1.15),
        tier_tile(cam, 'large_reactor', 'LARGE REACTOR  2x2   explodes when destroyed', T12,
                  os.path.join(TMP, 'p1.png'), spread=1.1),
        tier_tile(cam, 'repair_module', 'REPAIR MODULE  1x1   repairs neighbours', T12,
                  os.path.join(TMP, 'p2.png'), node='Repair_Arm', deg=-35, margin=0.8),
    ]
    # footprint check: top view, T2, arm swung toward each neighbour
    _clear()
    objs = []
    for f, loc in (('refinery_titanium', (0, 1.2, 0)), ('large_reactor_titanium', (0, -1.0, 0)),
                   ('repair_module_titanium', (2.4, 1.2, 0)), ('repair_module_iron', (2.4, -0.5, 0))):
        _, new = PV.import_glb(os.path.join(paths.PARTS, f + '.glb'), loc=loc)
        if 'repair' in f:
            P2._turn(new, 'Repair_Arm', 90 if loc[1] > 0 else -150)
        objs += new
        mod = f.rsplit('_', 1)[0]
        w, h = CELLS[mod]
        objs.append(P2._outline(loc, w, h, z=0.95))
    c, r = R.bounds(objs)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 4.4
    R.aim_camera(cam, (c[0], c[1] + 0.25, 0), 89.9, -90, 30)
    labs = _labels(cam, [('FOOTPRINT CHECK  (top view, ortho, cell outlines)', 0, 0.45, 0.04),
                         ('repair arm at +90 / -150', 0.3, -0.46, 0.03)])
    for lb in labs:
        lb.location.z = -1.0
        lb.data.size = lb.data.size * 4.4 / (2 * math.tan(math.atan(12 / 50)))
        lb.location.x *= 4.4 / (2 * math.tan(math.atan(12 / 50)))
        lb.location.y *= 4.4 / (2 * math.tan(math.atan(12 / 50)))
    tiles.append(R.render_to(os.path.join(TMP, 'p3.png')))
    _drop(labs)
    cam.data.type = 'PERSP'
    R.stitch(tiles, 2, tile_w, tile_h, out_png, gap=4)


def paints_sheet(out_png):
    """The M2d ship (T2) in the stock colours + the four Lakovna paints
    (palette_paint_*), game camera."""
    import preview_m3 as P3
    cam = PV._new_scene(1600, 560, 128, seed=3.0, key_az=-140)
    lay = [(f.replace('_iron', '_titanium'), c, r) for f, c, r in P2.M2D_SHIP]
    names = ['default', 'paint_graphite', 'paint_sand', 'paint_navy', 'paint_racing']
    for i, lv in enumerate(names):
        dx = (i - 2) * 9.0
        objs = P2.build_ship_multi([(f, (c[0] + dx, c[1]), r) for f, c, r in lay])
        if lv != 'default':
            P3.apply_livery(objs, lv)
        R.camera_label(cam, lv.replace('paint_', 'paint: '), y_frac=-0.2, x_frac=(i - 2) * 0.15, size_frac=0.04)
    R.aim_camera(cam, (0.0, 0.0, 0), 62, -90, 44)
    R.camera_label(cam, 'LAKOVNA paints (laky): hull only, tier accents and role glows stay', y_frac=0.44, size_frac=0.04)
    R.render_to(out_png)


# ----------------------------------------------------------------------------
def main(only=None, iter_tag=None):
    os.makedirs(paths.PREVIEWS, exist_ok=True)
    P = paths.PREVIEWS
    files = []
    if not only or 'parts' in only:
        p = os.path.join(P, 'm4-parts.png')
        parts_sheet(p)
        files.append((p, 'm4-parts'))
    if not only or 'paints' in only:
        p = os.path.join(P, 'm4-paints.png')
        paints_sheet(p)
        files.append((p, 'm4-paints'))
    if not only or 'pois' in only:
        import preview_m4_pois as PP
        p = os.path.join(P, 'm4-pois.png')
        PP.pois_sheet(p)
        files.append((p, 'm4-pois'))
    if not only or 'home' in only:
        import preview_m4_pois as PP
        p = os.path.join(P, 'm4-home-modules.png')
        PP.home_sheet(p, os.path.join(paths.BLEND, 'm4-home.blend'))
        files.append((p, 'm4-home-modules'))
    shutil.rmtree(TMP, ignore_errors=True)
    PV._keep_iterations(iter_tag, files)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else None,
         argv[argv.index('--iter') + 1] if '--iter' in argv else None)
