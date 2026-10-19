"""Batch D previews (art audit 2026-10-16 §6 D): clamp, caged beacons, station variants (+ collision),
game-camera sheet (+ greyscale), shipyard camera poses for the hangar platform + bay.

  blender --background --factory-startup --python art/blender/preview_batch_d.py -- --only clamp,beacons,
          stations,collision,gamecam,hangar [--iter bd1]

Outputs art/out/previews/batch-d-*.png.  "Before" = art/out/before_batch_d/models/stations/ (copies of the
shipped files taken before batch D).
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
from mathutils import Vector  # noqa: E402

import paths  # noqa: E402
import preview as PV  # noqa: E402
import preview_stations as PS  # noqa: E402
import structures as S  # noqa: E402
from lib import render as R  # noqa: E402

BEFORE = os.path.join(paths.OUT, 'before_batch_d', 'models', 'stations')
TMP = os.path.join(paths.OUT, 'tmp_tiles_batch_d')
P = paths.PREVIEWS
GAME_LENS = 12.0 / math.tan(math.radians(25.0))       # vFOV 50 (sensor 24 vertical)
HANGAR_FOV = 34.0
HANGAR_FLOOR = -0.37
FIT_SIZE = 16.4


def _layouts():
    import stations_var as V
    out = {k: v for k, v in S.LAYOUTS.items()}
    out.update(V.LAYOUTS_D)
    return out


def _path(name, before=False):
    return os.path.join(BEFORE if before else paths.STATIONS, name + '.glb')


def _scene(w, h, samples=128, seed=2.0, key_az=-140, lens=50.0):
    cam = PV._new_scene(w, h, samples, seed=seed, key_az=key_az)
    cam.data.lens = lens
    cam.data.clip_end = 3000
    return cam


def place_station(name, loc=(0, 0, 0), before=False, ship=True, clamp=True):
    """Station + clamp on its dock_port (+ the starter ship docked per spec 7.2)."""
    lay = _layouts()
    _, objs = PV.import_glb(_path(name, before), loc=loc)
    R_ = lay[name]['R'] if name in lay else None
    if R_ and clamp:
        _, c = PV.import_glb(_path('dock_clamp', before), loc=(loc[0] + R_, loc[1], loc[2]))
        objs += c
    if R_ and ship:
        sl, br = PS.docked_ship_layout(R_)
        sl = [(f, (x + loc[0], y + loc[1]), r) for f, (x, y), r in sl]
        s, cn = PV.build_ship(sl, connectors=True)
        objs += s + cn
    return objs


def _only(objs, allobjs):
    PV._hide(allobjs, True)
    PV._hide(objs, False)


def _label(cam, text, y=-0.44, size=0.03):
    return R.camera_label(cam, text, y_frac=y, size_frac=size)


def _render_tile(name):
    os.makedirs(TMP, exist_ok=True)
    return R.render_to(os.path.join(TMP, name + '.png'))


def _done():
    shutil.rmtree(TMP, ignore_errors=True)


def greyscale(src, dst):
    a = R.read_png(src)
    lum = a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722
    a[..., 0] = a[..., 1] = a[..., 2] = lum
    R.write_png(a, dst)
    return dst


# ----------------------------------------------------------------------------
# D1 clamp: before / after, 3/4 close + game camera with the docked ship
# ----------------------------------------------------------------------------
def clamp_sheet(out_png, w=798, h=520):
    cam = _scene(w, h, 160, key_az=-135)
    groups = []
    for i, before in enumerate((True, False)):
        _, c = PV.import_glb(_path('dock_clamp', before), loc=(i * 60.0, 0, 0))
        g = place_station('station_home', (i * 60.0 - 14.0, 40.0, 0), before=before)
        groups.append((before, c, g))
    allobjs = [o for _, c, g in groups for o in c + g]
    tiles = []
    for before, c, g in groups:
        tag = 'BEFORE' if before else 'AFTER  (v2: jaws, pistons, target glyph)'
        ox = 0.0 if before else 60.0
        _only(c, allobjs)
        R.aim_camera(cam, (ox - 0.9, 0, -0.1), 40, -60, 7.2)
        lab = _label(cam, f'DOCK CLAMP  {tag}   {PV._tri_count(c)} tris')
        tiles.append(_render_tile(f'cl_close_{int(before)}'))
        bpy.data.objects.remove(lab)
        R.aim_camera(cam, (ox - 0.9, 0, -0.1), 72, -95, 6.6)
        lab = _label(cam, f'top  {tag}')
        tiles.append(_render_tile(f'cl_top_{int(before)}'))
        bpy.data.objects.remove(lab)
    cam.data.lens = GAME_LENS
    for before, c, g in groups:
        ox = 0.0 if before else 60.0
        _only(g, allobjs)
        R.aim_camera(cam, (ox - 1.5, 40.0, 0), 55, -90, 28.0)
        lab = _label(cam, f'game camera d=28 (zoomed in)  {"BEFORE" if before else "AFTER"}')
        tiles.append(_render_tile(f'cl_game_{int(before)}'))
        bpy.data.objects.remove(lab)
    order = [tiles[0], tiles[2], tiles[1], tiles[3], tiles[4], tiles[5]]
    R.stitch(order, 2, w, h, out_png, gap=4)
    _done()
    return out_png


# ----------------------------------------------------------------------------
# caged beacons: before / after close-ups on the home arm gantry, outposts
# ----------------------------------------------------------------------------
def beacons_sheet(out_png, w=798, h=450):
    cam = _scene(w, h, 160, key_az=-135)
    shots = [('station_home', (14.0 - 2.7, 0.0, 1.5), 40, -70, 5.5, 'HOME arm gantry'),
             ('outpost_a', (6.0 - 2.6, 0.0, 0.3), 45, -60, 4.6, 'OUTPOST A arm tip'),
             ('station_b', (0.0, 0.0, 5.0), 35, -60, 4.5, 'STATION B stack top')]
    groups = []
    for i, (name, tgt, el, az, d, lab) in enumerate(shots):
        for j, before in enumerate((True, False)):
            loc = (i * 80.0, j * 80.0, 0)
            objs = place_station(name, loc, before=before, ship=False)
            groups.append((objs, (tgt[0] + loc[0], tgt[1] + loc[1], tgt[2]), el, az, d,
                           f'{lab}  {"BEFORE (sphere)" if before else "AFTER (caged lamp)"}'))
    allobjs = [o for g in groups for o in g[0]]
    tiles = []
    for gi, (objs, tgt, el, az, d, lab) in enumerate(groups):
        _only(objs, allobjs)
        R.aim_camera(cam, tgt, el, az, d)
        lb = _label(cam, lab)
        tiles.append(_render_tile(f'bc_{gi}'))
        bpy.data.objects.remove(lb)
    R.stitch(tiles, 2, w, h, out_png, gap=4)
    _done()
    return out_png


# ----------------------------------------------------------------------------
# D2 station variants: 3/4 views + collision top views
# ----------------------------------------------------------------------------
VARIANTS = [('station_d', 'STATION D  -  INSTITUTE RESEARCH'), ('station_e', 'STATION E  -  FORTIFIED FRONTIER POST'),
            ('outpost_c', 'OUTPOST C  -  ICE-MOORED'), ('outpost_d', 'OUTPOST D  -  ARMOURED RELAY')]


def stations_sheet(out_png, w=798, h=560):
    cam = _scene(w, h, 160, key_az=-135)
    groups = []
    for i, (name, label) in enumerate(VARIANTS):
        objs = place_station(name, (i * 80.0, 0, 0), ship=False)
        groups.append((name, label, objs, i * 80.0))
    allobjs = [o for g in groups for o in g[2]]
    tiles = []
    for name, label, objs, ox in groups:
        _only(objs, allobjs)
        st = [o for o in objs if o.type == 'MESH' and not o.name.startswith(('guide_light', 'Dock_Clamp', 'Clamp_Jaw'))]
        c, r = R.bounds(st)
        for el, az, m in ((38, -58, 0.78), (30, 135, 0.8)):
            R.aim_camera(cam, c, el, az, R.fit_distance(cam, r, margin=m))
            lb = _label(cam, f'{label}   {PV._tri_count(st)} tris' if az < 0 else f'{label}  (rear)')
            tiles.append(_render_tile(f'st_{name}_{az}'))
            bpy.data.objects.remove(lb)
    R.stitch(tiles, 2, w, h, out_png, gap=4)
    _done()
    return out_png


def collision_sheet(out_png, w=640, h=640):
    lay = _layouts()
    cam = _scene(w, h, 64, key_az=-135)
    red = PS._debug_mat('BD_Circle', (1.0, 0.15, 0.1), 4.0)
    blue = PS._debug_mat('BD_Clear', (0.2, 0.6, 1.0), 2.0)
    groups = []
    for i, (name, label) in enumerate(VARIANTS):
        ox = i * 80.0
        objs = place_station(name, (ox, 0, 0), ship=False)
        rings = []
        for x, y, r in lay[name]['circles']:
            rings.append(PS._ring('C', ox + x, y, r, 0.06, red, z=8.0))
        rings.append(PS._ring('R', ox + lay[name]['R'], 0, 0.35, 0.08, blue, z=8.0))
        groups.append((label, objs + rings, ox, lay[name]['R']))
    allobjs = [o for g in groups for o in g[1]]
    tiles = []
    for label, objs, ox, R_ in groups:
        _only(objs, allobjs)
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = 2 * R_ + 6
        cam.location = (ox + 1.0, 0, 60)
        cam.rotation_euler = (0, 0, 0)
        lb = _label(cam, label + '  collision', y=-0.45, size=0.035)
        tiles.append(_render_tile(f'col_{ox}'))
        bpy.data.objects.remove(lb)
    R.stitch(tiles, 4, w, h, out_png, gap=4)
    _done()
    return out_png


# ----------------------------------------------------------------------------
# game camera sheet (pitch 55, vFOV 50, distance 48 and 210) + greyscale
# ----------------------------------------------------------------------------
def gamecam_sheet(out_png, grey_png, w=800, h=450):
    cam = _scene(w, h, 128, key_az=-140, lens=GAME_LENS)
    groups = []
    names = [n for n, _ in VARIANTS] + ['station_home']
    for i, name in enumerate(names):
        ox = i * 400.0
        objs = place_station(name, (ox, 0, 0), ship=True)
        rocks = PV.add_rocks([('asteroid_iron_b', (ox - 22.0, 14.0, -2.0), 30),
                              ('asteroid_ice_a', (ox + 26.0, 16.0, -2.5), 70),
                              ('asteroid_copper_c', (ox - 20.0, -15.0, -2.0), 140)])
        groups.append((name, objs + rocks, ox))
    allobjs = [o for g in groups for o in g[1]]
    tiles = []
    for name, objs, ox in groups:
        _only(objs, allobjs)
        R_ = _layouts()[name]['R']
        for d in (48.0, 210.0):
            R.aim_camera(cam, (ox + R_ * 0.55, 0, 0), 55, -90, d)
            lb = _label(cam, f'{name}  game cam  d={int(d)}', y=-0.45, size=0.032)
            tiles.append(_render_tile(f'gc_{name}_{int(d)}'))
            bpy.data.objects.remove(lb)
    R.stitch(tiles, 2, w, h, out_png, gap=4)
    greyscale(out_png, grey_png)
    _done()
    return out_png, grey_png


# ----------------------------------------------------------------------------
# D3 hangar: shipyard camera poses (hangarCamera.ts placeCamera / fitDistance)
# ----------------------------------------------------------------------------
def hangar_fit_distance(pitch_deg, aspect, zoom):
    t = math.tan(math.radians(HANGAR_FOV) / 2)
    by_h = (FIT_SIZE * math.sin(math.radians(pitch_deg)) * 0.5 + 1.2) / t
    by_w = (FIT_SIZE * 0.5) / (t * max(1e-3, aspect))
    return max(by_h, by_w) / zoom


def hangar_camera(cam, yaw_deg, pitch_deg, zoom, aspect, pan=(0.0, 0.0)):
    """The game's hangar camera in Blender coords.  Game world: yard rotated +90 deg about Y, so the
    ship's +X (bow) = world -Z; yaw 0 = camera at world +Z looking toward -Z (bow up on screen).
    In the yard frame (= Blender frame of the models) yaw 0 puts the camera on the -X side (behind
    the stern) looking toward +X; yaw turns it around Z."""
    d = hangar_fit_distance(pitch_deg, aspect, zoom)
    el = math.radians(pitch_deg)
    # yard frame: camera direction from target at yaw 0 = -X; yaw rotates clockwise seen from above
    az = math.radians(180.0 - yaw_deg)
    tgt = Vector((pan[0], pan[1], HANGAR_FLOOR))
    off = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el))) * d
    cam.location = tgt + off
    up = Vector((math.cos(az + math.pi), math.sin(az + math.pi), 0.0))     # screen-up = toward +X at yaw 0
    fwd = (tgt - cam.location).normalized()
    right = fwd.cross(up).normalized()
    upv = right.cross(fwd).normalized()
    from mathutils import Matrix
    rot = Matrix((right, upv, -fwd)).transposed()
    cam.rotation_euler = rot.to_euler()


def hangar_sheet(out_png, w=640, h=360, bay=True, tag=''):
    cam = _scene(w, h, 96, seed=2.0, key_az=-130)
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.lens = 12.0 / math.tan(math.radians(HANGAR_FOV / 2))
    cam.data.clip_start = 0.1
    cam.data.clip_end = 400
    PV.import_glb(_path('hangar_platform'))
    if bay and os.path.exists(_path('hangar_bay')):
        PV.import_glb(_path('hangar_bay'))
    PV.build_ship(PV.M1_SHIP, connectors=True)
    aspect = w / h
    tiles = []
    for pitch, zoom in ((35, 0.6), (35, 1.3), (55, 1.3), (90, 1.3)):
        for yaw in (0, 90, 180, 270):
            hangar_camera(cam, yaw, pitch, zoom, aspect)
            lb = _label(cam, f'yaw {yaw}  pitch {pitch}  zoom {zoom}', y=-0.44, size=0.05)
            tiles.append(_render_tile(f'hg_{pitch}_{zoom}_{yaw}'))
            bpy.data.objects.remove(lb)
    R.stitch(tiles, 4, w, h, out_png, gap=4)
    _done()
    return out_png


def hangar_hero(out_png, w=1600, h=900):
    cam = _scene(w, h, 160, seed=2.0, key_az=-130)
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.lens = 12.0 / math.tan(math.radians(HANGAR_FOV / 2))
    cam.data.clip_end = 400
    PV.import_glb(_path('hangar_platform'))
    if os.path.exists(_path('hangar_bay')):
        PV.import_glb(_path('hangar_bay'))
    PV.build_ship(PV.M1_SHIP, connectors=True)
    hangar_camera(cam, 30, 35, 0.6, w / h)
    R.render_to(out_png)
    PV._save_blend(os.path.join(paths.BLEND, 'batch-d-hangar.blend'))
    return out_png


def main(only, tag):
    out = []
    if 'clamp' in only:
        out.append((clamp_sheet(os.path.join(P, 'batch-d-clamp.png')), 'batch-d-clamp'))
    if 'beacons' in only:
        out.append((beacons_sheet(os.path.join(P, 'batch-d-beacons.png')), 'batch-d-beacons'))
    if 'stations' in only:
        out.append((stations_sheet(os.path.join(P, 'batch-d-stations.png')), 'batch-d-stations'))
    if 'collision' in only:
        out.append((collision_sheet(os.path.join(P, 'batch-d-stations-collision.png')), 'batch-d-stations-collision'))
    if 'gamecam' in only:
        a, b = gamecam_sheet(os.path.join(P, 'batch-d-gamecam.png'), os.path.join(P, 'batch-d-gamecam-grey.png'))
        out += [(a, 'batch-d-gamecam'), (b, 'batch-d-gamecam-grey')]
    if 'hangar' in only:
        out.append((hangar_sheet(os.path.join(P, 'batch-d-hangar.png')), 'batch-d-hangar'))
    if 'hangarhero' in only:
        out.append((hangar_hero(os.path.join(P, 'batch-d-hangar-hero.png')), 'batch-d-hangar-hero'))
    if 'hangarbefore' in only:
        out.append((hangar_sheet(os.path.join(P, 'batch-d-hangar-platform-only.png'), bay=False),
                    'batch-d-hangar-platform-only'))
    if tag:
        PV._keep_iterations(tag, out)
    for p, _ in out:
        print('PREVIEW', p)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else {'clamp'}
    main(only, argv[argv.index('--iter') + 1] if '--iter' in argv else None)
