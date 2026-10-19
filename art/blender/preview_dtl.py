"""Detail-pass ("dtl") previews: before/after comparisons at the 55 deg game
camera (ship docked next to the structure for scale) and closer 3/4 views.

  blender --background --factory-startup --python art/blender/preview_dtl.py -- --only home[,stations,...] [--iter dtl1]

The "before" GLBs are the pre-detail-pass copies in art/out/before_dtl/<folder>/.
"""
import math
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402

import paths  # noqa: E402
import preview as PV  # noqa: E402
import preview_stations as PS  # noqa: E402
from lib import render as R  # noqa: E402

BEFORE = os.path.join(paths.OUT, 'before_dtl')
TMP = os.path.join(paths.OUT, 'tmp_tiles')


def _paths(folder, name):
    return (os.path.join(BEFORE, folder, name + '.glb'), os.path.join(paths.MODELS, folder, name + '.glb'))


def _tris(objs):
    return PV._tri_count(objs)


def _place_station(path, loc, R_=None, clamp_path=None, ship=True):
    _, objs = PV.import_glb(path, loc=loc)
    if R_:
        cp = clamp_path or os.path.join(paths.STATIONS, 'dock_clamp.glb')
        _, c = PV.import_glb(cp, loc=(loc[0] + R_, loc[1], loc[2]))
        objs += c
        if ship:
            lay, br = PS.docked_ship_layout(R_)
            lay = [(f, (x + loc[0], y + loc[1]), r) for f, (x, y), r in lay]
            s, cn = PV.build_ship(lay, connectors=True)
            objs += s + cn
    return objs


def _hide_all_but(objs, allobjs):
    PV._hide(allobjs, True)
    PV._hide(objs, False)


def before_after(name, folder, out_png, R_=None, target=(3.0, 0.0, 0.0), dist=62.0, el=55, az=-90,
                 label=None, ship_far=None, w=1600, h=900, clamp=True):
    """Two frames (before above, after below) from the same game camera."""
    b, a = _paths(folder, name)
    cam = PV._new_scene(w, h, 160, seed=3.0, key_az=-140)
    cam.data.clip_end = 2000
    ob = _place_station(b, (0, 0, 0), R_ if clamp else None,
                        clamp_path=os.path.join(BEFORE, 'stations', 'dock_clamp.glb'))
    oa = _place_station(a, (400, 0, 0), R_ if clamp else None)
    if not R_ and ship_far:   # scale reference ship next to POIs without a dock
        for off, objs in ((0, ob), (400, oa)):
            lay = [(f, (x + off + ship_far[0], y + ship_far[1]), r) for f, (x, y), r in PV.M1_SHIP]
            s, c = PV.build_ship(lay, connectors=True)
            objs += s + c
    allobjs = ob + oa
    tiles = []
    for tag, objs, off in (('BEFORE', ob, 0), ('AFTER  (dtl)', oa, 400)):
        _hide_all_but(objs, allobjs)
        R.aim_camera(cam, (target[0] + off, target[1], target[2]), el, az, dist)
        st = [o for o in objs if o.type == 'MESH']
        lab = R.camera_label(cam, f'{label or name}  -  {tag}', y_frac=0.44, size_frac=0.03)
        tiles.append(R.render_to(os.path.join(TMP, f'ba_{name}_{len(tiles)}.png')))
        bpy.data.objects.remove(lab)
    R.stitch(tiles, 1, w, h, out_png, gap=6)
    shutil.rmtree(TMP, ignore_errors=True)
    return out_png


def close_view(name, folder, out_png, R_=None, target=(0.0, 0.0, 0.0), dist=34.0, el=35, az=-58, w=1600, h=900,
               before=False, label=None, clamp=True):
    b, a = _paths(folder, name)
    cam = PV._new_scene(w, h, 192, seed=2.0, key_az=-150)
    cam.data.clip_end = 2000
    objs = _place_station(b if before else a, (0, 0, 0), R_ if clamp else None,
                          clamp_path=os.path.join(BEFORE, 'stations', 'dock_clamp.glb') if before else None)
    R.aim_camera(cam, target, el, az, dist)
    R.camera_label(cam, label or name, y_frac=-0.45, size_frac=0.026)
    R.render_to(out_png)
    return out_png


def pair_close(name, folder, out_png, R_=None, target=(0.0, 0.0, 0.0), dist=34.0, el=35, az=-58, label=None,
               clamp=True):
    """Side-by-side close 3/4 view: before | after (each 798 x 900)."""
    tiles = []
    for i, bf in enumerate((True, False)):
        p = os.path.join(TMP, f'pc_{name}_{i}.png')
        close_view(name, folder, p, R_, target, dist, el, az, w=798, h=900, before=bf,
                   label=f'{label or name}  -  {"BEFORE" if bf else "AFTER"}', clamp=clamp)
        tiles.append(p)
    R.stitch(tiles, 2, 798, 900, out_png, gap=4)
    shutil.rmtree(TMP, ignore_errors=True)
    return out_png


def pairs_sheet(entries, out_png, tw=798, th=450, samples=128):
    """Rows of (before | after) 3/4 tiles.  entries: (folder, name, label, R or None, el, az, margin)."""
    cam = PV._new_scene(tw, th, samples, seed=1.0, key_az=-140)
    cam.data.clip_end = 3000
    groups = []
    for i, (folder, name, label, R_, el, az, margin) in enumerate(entries):
        b, a = _paths(folder, name)
        ob = _place_station(b, (i * 120.0, 0, 0), R_, clamp_path=os.path.join(BEFORE, 'stations', 'dock_clamp.glb'),
                            ship=False)
        oa = _place_station(a, (i * 120.0, 60.0, 0), R_, ship=False)
        groups.append((ob, oa, label, el, az, margin))
    allobjs = [o for g in groups for o in g[0] + g[1]]
    tiles = []
    for gi, (ob, oa, label, el, az, margin) in enumerate(groups):
        for tag, objs in (('BEFORE', ob), ('AFTER', oa)):
            _hide_all_but(objs, allobjs)
            c, r = R.bounds(objs)
            R.aim_camera(cam, c, el, az, R.fit_distance(cam, r, margin=margin))
            st = [o for o in objs if o.type == 'MESH' and not o.name.startswith(('guide_light', 'Dock_Clamp'))]
            lab = R.camera_label(cam, f'{label}  {tag}   {_tris(st)} tris', y_frac=-0.43, size_frac=0.05)
            tiles.append(R.render_to(os.path.join(TMP, f'ps_{gi}_{tag}.png')))
            bpy.data.objects.remove(lab)
    R.stitch(tiles, 2, tw, th, out_png, gap=4)
    shutil.rmtree(TMP, ignore_errors=True)
    return out_png


def base_pair(out_png, w=798, h=900):
    """Base hub at U3 (ground) with the PREVIEW_FIT modules on their slots: before | after."""
    import base_modules as B
    tiles = []
    for i, before in enumerate((True, False)):
        cam = PV._new_scene(w, h, 160, seed=2.0, key_az=-140)
        cam.data.clip_end = 2000
        root = (os.path.join(BEFORE, 'base') if before else os.path.join(paths.MODELS, 'base'))
        _, objs = PV.import_glb(os.path.join(root, 'base_hub.glb'))
        for o in objs:
            if o.name.startswith('Hub_Floats'):
                o.hide_render = True
        bpy.context.view_layer.update()
        slots = {o.name: o for o in objs if o.name.startswith('slot_')}
        for k, mid in B.PREVIEW_FIT.items():
            sl = slots[f'slot_{k}']
            r, mo = PV.import_glb(os.path.join(root, f'base_module_{mid}.glb'))
            for rr in r:
                rr.matrix_world = sl.matrix_world.copy()
        R.aim_camera(cam, (0.0, 0.0, 1.0), 42, -60, 34.0)
        R.camera_label(cam, f'PLANETARY BASE  -  {"BEFORE" if before else "AFTER"}', y_frac=-0.45, size_frac=0.03)
        tiles.append(R.render_to(os.path.join(TMP, f'base_{i}.png')))
    R.stitch(tiles, 2, w, h, out_png, gap=4)
    shutil.rmtree(TMP, ignore_errors=True)
    return out_png


def _iter(tag, files):
    PV._keep_iterations(tag, files)


def main(only, tag):
    P = paths.PREVIEWS
    out = []
    if 'home' in only:
        ba = os.path.join(P, 'detail-home-before-after.png')
        before_after('station_home', 'stations', ba, R_=14.0, target=(3.0, 0.0, 0.0), dist=58.0,
                     label='HOME STATION')
        cl = os.path.join(P, 'detail-home-close.png')
        close_view('station_home', 'stations', cl, R_=14.0, target=(2.0, -0.5, 0.5), dist=37.0, el=38, az=-62,
                   label='HOME STATION  (dtl)  3/4 close')
        out += [(ba, 'detail-home-before-after'), (cl, 'detail-home-close')]
    if 'homegame' in only:
        g = os.path.join(P, 'detail-home-gamecam.png')
        pair_close('station_home', 'stations', g, R_=14.0, target=(8.0, -2.0, 0.0), dist=28.0, el=55, az=-90,
                   label='HOME  game cam d=28')
        out += [(g, 'detail-home-gamecam')]
    if 'stations' in only:
        p1 = os.path.join(P, 'detail-stations-before-after.png')
        pairs_sheet([('stations', 'station_a', 'STATION A trade', 10.0, 40, -58, 0.8),
                     ('stations', 'station_b', 'STATION B refinery', 10.0, 40, -58, 0.8),
                     ('stations', 'station_c', 'STATION C shipyard', 10.0, 40, -58, 0.8)], p1)
        p2 = os.path.join(P, 'detail-outposts-before-after.png')
        pairs_sheet([('stations', 'outpost_a', 'OUTPOST A', 6.0, 40, -58, 0.8),
                     ('stations', 'outpost_b', 'OUTPOST B', 6.0, 40, -58, 0.8),
                     ('stations', 'dock_clamp', 'DOCK CLAMP', None, 42, -58, 0.95)], p2)
        g = os.path.join(P, 'detail-stations-gamescale.png')
        before_after('station_a', 'stations', g, R_=10.0, target=(2.0, 0.0, 0.0), dist=44.0, label='STATION A')
        out += [(p1, 'detail-stations-before-after'), (p2, 'detail-outposts-before-after'),
                (g, 'detail-stations-gamescale')]
    if 'fortress' in only:
        f1 = os.path.join(P, 'detail-fortress-before-after.png')
        before_after('hrdzava_pevnost', 'pirates', f1, R_=None, target=(1.0, 0.0, 0.0), dist=60.0,
                     label='HRDZAVA PEVNOST', ship_far=(17.0, -8.0))
        f2 = os.path.join(P, 'detail-fortress-close.png')
        pair_close('hrdzava_pevnost', 'pirates', f2, R_=None, target=(2.0, -1.0, 1.5), dist=30.0, el=38, az=-55,
                   label='FORTRESS', clamp=False)
        out += [(f1, 'detail-fortress-before-after'), (f2, 'detail-fortress-close')]
    if 'derelicts' in only:
        d1 = os.path.join(P, 'detail-derelicts-before-after.png')
        pairs_sheet([('derelicts', 'derelict_a', 'DERELICT A', None, 42, -58, 0.8),
                     ('derelicts', 'derelict_b', 'DERELICT B', None, 42, -58, 0.8),
                     ('derelicts', 'derelict_c', 'DERELICT C', None, 42, -58, 0.8),
                     ('derelicts', 'derelict_d', 'DERELICT D', None, 42, -58, 0.8)], d1)
        out += [(d1, 'detail-derelicts-before-after')]
    if 'base' in only:
        b1 = os.path.join(P, 'detail-base-before-after.png')
        base_pair(b1)
        b2 = os.path.join(P, 'detail-base-modules-before-after.png')
        pairs_sheet([('base', f'base_module_{m}', m.upper(), None, 40, -55, 0.85)
                     for m in ('drill', 'solar', 'reactor', 'storage', 'refinery', 'launcher', 'defense_tower',
                               'drone_dock', 'gas_probe')], b2, th=400)
        out += [(b1, 'detail-base-before-after'), (b2, 'detail-base-modules-before-after')]
    if 'dronedock' in only:
        d = os.path.join(P, 'detail-dronedock-before-after.png')
        pair_close('base_module_drone_dock', 'base', d, R_=None, target=(0.2, 0.0, 0.7), dist=7.5, el=45, az=-60,
                   label='DRONE DOCK', clamp=False)
        out += [(d, 'detail-dronedock-before-after')]
    _iter(tag, out)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else {'home'}
    main(only, argv[argv.index('--iter') + 1] if '--iter' in argv else None)
