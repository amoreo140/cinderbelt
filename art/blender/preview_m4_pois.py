"""M4 POI previews (called from preview_m4.py): abandoned stations + relay,
comet, NPC trader (m4-pois.png) and the home-station modules
(m4-home-modules.png).  Also usable directly:

  blender --background --factory-startup --python art/blender/preview_m4_pois.py -- [--only pois,home,collision]
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import paths  # noqa: E402
import preview as PV  # noqa: E402
import preview_m35 as P35  # noqa: E402
from lib import render as R  # noqa: E402

TMP = os.path.join(paths.OUT, 'tmp_tiles_m4p')
SHIP = 'cockpit_titanium'


def _clear():
    for o in list(bpy.data.objects):
        if o.type in ('MESH', 'EMPTY'):
            bpy.data.objects.remove(o)


def _imp(folder, name, loc=(0, 0, 0), rot=0.0):
    p = os.path.join(paths.MODELS, folder, name + '.glb')
    if not os.path.exists(p):
        return []
    _, new = PV.import_glb(p, loc=loc, rot_z=rot)
    return new


def _starter_ship(loc):
    """The M1 starter ship (iron) for scale."""
    out = []
    for f, (x, y), rot in PV.M1_SHIP:
        _, new = PV.import_glb(os.path.join(paths.PARTS, f + '.glb'), loc=(loc[0] + x, loc[1] + y, loc[2]), rot_z=rot)
        out += new
    return out


def _tile(cam, objs, label, path, el=42, az=-62, margin=0.95, sub=None, target=None):
    meshes = [o for o in objs if o.type == 'MESH']
    c, r = R.bounds(meshes) if meshes else ((0, 0, 0), 5.0)
    if target is not None:
        c = target
    R.aim_camera(cam, c, el, az, R.fit_distance(cam, r, margin=margin))
    labs = [R.camera_label(cam, label, y_frac=0.43, size_frac=0.045)]
    if sub:
        labs.append(R.camera_label(cam, sub, y_frac=-0.44, size_frac=0.032))
    out = R.render_to(path)
    for lb in labs:
        bpy.data.objects.remove(lb)
    return out


def _tris(objs):
    from lib import geo as G
    return sum(G.tri_count(o) for o in objs if o.type == 'MESH')


def pois_sheet(out_png, tw=398, th=448):
    cam = PV._new_scene(tw, th, 128, key_az=-120)
    tiles = []
    labels = {'derelict_a': 'DERELICT A  broken wheel', 'derelict_b': 'DERELICT B  research pods',
              'derelict_c': 'DERELICT C  mining rig', 'derelict_d': 'DERELICT D  comm spire'}
    for i, (n, lab) in enumerate(labels.items()):
        _clear()
        objs = _imp('derelicts', n)
        tiles.append(_tile(cam, objs, lab, os.path.join(TMP, f'd{i}.png'), sub=f'{_tris(objs)} tris, weathered + COLOR_0'))
    # relay + starter ship for scale
    _clear()
    objs = _imp('derelicts', 'derelict_relay')
    objs += _starter_ship((3.4, -0.6, 0))
    tiles.append(_tile(cam, objs, 'POWER RELAY  (x3 per station)', os.path.join(TMP, 'r.png'), margin=0.8,
                       sub='starter ship for scale'))
    # comet nucleus + tail
    _clear()
    objs = _imp('comets', 'comet_nucleus') + _imp('comets', 'comet_tail')
    tiles.append(_tile(cam, objs, 'COMET  nucleus + tail', os.path.join(TMP, 'c.png'), el=34, az=-25, margin=0.4,
                       target=(-3.0, 0, 0), sub='He3 pockets, Kr crystals, 3 jets; tail = additive ribbons'))
    # trader + ship for scale
    _clear()
    objs = _imp('npc', 'trader')
    tiles.append(_tile(cam, objs, 'NPC TRADER  (Volni obchodnici)', os.path.join(TMP, 't.png'), el=38, az=-55,
                       margin=0.85, sub=f'{_tris(objs)} tris'))
    # game camera: trader convoy next to the starter ship + a derelict
    _clear()
    objs = _imp('npc', 'trader', loc=(-4, 6, 0), rot=10) + _starter_ship((4, 0, 0))
    objs += _imp('derelicts', 'derelict_a', loc=(-14, -9, 0), rot=30)
    tiles.append(_tile(cam, objs, 'game camera (55 deg)', os.path.join(TMP, 'g.png'), el=55, az=-90, margin=0.55,
                       target=(-3, -1, 0)))
    R.stitch(tiles, 4, tw, th, out_png, gap=4)


def collision_sheet(out_png, tw=398, th=448):
    """Top view of each derelict with its collision circles."""
    import derelicts as DR
    cam = PV._new_scene(tw, th, 64, key_az=-120)
    tiles = []
    for i, n in enumerate(('derelict_a', 'derelict_b', 'derelict_c', 'derelict_d')):
        _clear()
        objs = _imp('derelicts', n)
        objs += P35.circle_overlay(DR.LAYOUTS[n]['circles'], z=2.0)
        tiles.append(_tile(cam, objs, n, os.path.join(TMP, f'col{i}.png'), el=89.9, az=-90, margin=0.8))
    R.stitch(tiles, 4, tw, th, out_png, gap=4)


def gantry_clearance(objs, slide=1.2):
    """Slide Paint_Gantry to +slide and print its clearance (station plane) from a docked ship of any
    size: the dock puts the ship centre at (radius + r, 0) for a ship bounding radius r."""
    from mathutils import Vector
    g = [o for o in objs if o.name.split('.')[0] == 'Paint_Gantry'][0]
    base = g.location.copy()
    worst = []
    for s in (-slide, slide):
        g.location = base + Vector((s, 0, 0))
        bpy.context.view_layer.update()
        pts = [g.matrix_world @ v.co for v in g.data.vertices]
        for r in (1.0, 2.0, 3.0, 4.0, 6.0, 8.0, 12.0):
            c = Vector((14.0 + r, 0.0))
            worst.append((min((Vector((p.x, p.y)) - c).length - r for p in pts), s, r))
    print('CLEARANCE gantry vs docked ship (min gap, slide, ship radius):', [f'{d:.2f}@{s:+.1f}/r{r:.0f}' for d, s, r in worst])
    g.location = base + Vector((slide, 0, 0))
    bpy.context.view_layer.update()
    return min(worst)


def home_sheet(out_png, blend_path):
    import home_modules as HM
    import json
    lay = HM.layouts_json()
    W, H = 1600, 900
    tiles = []
    # big shot: home station with all modules attached
    cam = PV._new_scene(1060, 900, 160, seed=3.0, key_az=-130)
    _clear()
    objs = _imp('stations', 'station_home')
    for mod, slot in HM.PREVIEW_FIT.items():
        s = lay['slots'][slot]
        objs += _imp('stations', HM.MODULES[mod]['file'], loc=(s['x'], s['y'], s['z']), rot=s['yawDeg'])
    _, ship = PV.import_glb(os.path.join(paths.MODELS, 'stations', 'dock_clamp.glb'), loc=(14, 0, 0))
    objs += ship
    # M4c A1: the docked ship in a Lakovna paint, the paint gantry at its slide limit toward the dock,
    # trophies on the trophy hall pedestals
    import preview_m3 as P3
    import preview_m4c as PC
    painted = _starter_ship((14 + 4.2, 0, 0))
    P3.apply_livery(painted, 'paint_racing')
    objs += painted
    gantry_clearance(objs, slide=1.2)
    PC.dress_shelf([o for o in objs if o.name.split('.')[0].startswith('trophy_')])
    R.aim_camera(cam, (1.0, 0.0, 0), 56, -90, 74)
    labs = [R.camera_label(cam, 'HOME STATION + modules on attach_<slot> empties', y_frac=0.44, size_frac=0.034),
            R.camera_label(cam, '  '.join(f'{m} > {s}' for m, s in HM.PREVIEW_FIT.items()), y_frac=-0.45,
                           size_frac=0.024),
            R.camera_label(cam, 'docked ship: paint_racing, gantry at +1.2, trophies on the pedestals',
                           y_frac=-0.415, size_frac=0.022)]
    big = R.render_to(os.path.join(TMP, 'h_big.png'))
    for lb in labs:
        bpy.data.objects.remove(lb)
    PV._save_blend(blend_path)
    # module close-ups
    cam = PV._new_scene(536, 448, 128, key_az=-120)
    small = []
    for i, (mod, info) in enumerate(list(HM.MODULES.items())[:2]):
        _clear()
        objs = _imp('stations', info['file'])
        sub = f'{_tris(objs)} tris'
        if mod == 'trophy_hall':
            PC.dress_shelf(objs)
            sub += '  (shelf: 2 fortress trophies + 4 clan replicas)'
        small.append(_tile(cam, objs, info['label'], os.path.join(TMP, f'h{i}.png'), el=38, az=-50, margin=0.85,
                           sub=sub))
    canvas = np.zeros((H, W, 4), np.float32)
    canvas[..., :3] = (0.02, 0.025, 0.035)
    canvas[..., 3] = 1
    canvas[:, :1060] = R.read_png(big)
    canvas[452:, 1064:] = R.read_png(small[0])
    canvas[:448, 1064:] = R.read_png(small[1])
    R.write_png(canvas, out_png)
    # third module close-up as an extra file
    if len(HM.MODULES) > 2:
        cam = PV._new_scene(800, 450, 128, key_az=-120)
        rows = []
        for i, (mod, info) in enumerate(list(HM.MODULES.items())[2:]):
            _clear()
            objs = _imp('stations', info['file'])
            rows.append(_tile(cam, objs, info['label'], os.path.join(TMP, f'hx{i}.png'), el=38, az=-50, margin=0.85,
                              sub=f'{_tris(objs)} tris'))
        R.stitch(rows, 2, 800, 450, out_png.replace('.png', '-b.png'), gap=4)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else {'pois'}
    P = paths.PREVIEWS
    if 'pois' in only:
        pois_sheet(os.path.join(P, 'm4-pois.png'))
    if 'collision' in only:
        collision_sheet(os.path.join(P, 'm4-derelict-collision.png'))
    if 'home' in only:
        home_sheet(os.path.join(P, 'm4-home-modules.png'), os.path.join(paths.BLEND, 'm4-home.blend'))
