"""M3.5 / M3.6 previews: Rust Fortress + pirate beacon, anomalies, Echo
beacon, giant asteroids, contract buoys + faction emblems.

  blender --background --factory-startup --python art/blender/preview_m35.py -- [--only fortress,anomalies,ozvena,giants,buoys] [--iter y1]
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
from lib import render as R  # noqa: E402

TMP = os.path.join(paths.OUT, 'tmp_tiles_m35')


def _emit_mat(name, color, strength=2.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1)
    em.inputs['Strength'].default_value = strength
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return m


def circle_overlay(circles, origin=(0, 0, 0), z=0.0, color=(0.3, 1.0, 0.4)):
    from lib import geo as G
    m = _emit_mat('AF_Overlay', color, 2.0)
    obs = []
    for i, (x, y, r) in enumerate(circles):
        t = G.torus(f'Circle{i}', r, 0.05, 'hull_light', loc=(origin[0] + x, origin[1] + y, z), maj=64, mnr=4)
        t.data.materials.clear()
        t.data.materials.append(m)
        t.visible_shadow = False
        obs.append(t)
    return obs


def _node(objs, name):
    for o in objs:
        if o.name.split('.')[0] == name:
            return o
    return None


def place_turrets(objs, livery=True):
    """Put pirate-livery cannon parts on the fortress turret_<i> empties (what
    the game will do), scaled 1.6x."""
    import preview_m3 as P3
    out = []
    for i in range(8):
        e = _node(objs, f'turret_{i}')
        if e is None:
            break
        bpy.context.view_layer.update()
        mw = e.matrix_world
        loc = mw.translation
        yaw = math.degrees(mw.to_euler().z)
        _, new = PV.import_glb(os.path.join(paths.PARTS, 'cannon_titanium.glb'), loc=tuple(loc), rot_z=yaw)
        for o in new:
            if o.parent is None:
                o.scale = (1.6, 1.6, 1.6)
        out += new
    if livery:
        P3.apply_livery(out, 'pirate')
    bpy.context.view_layer.update()
    return out


# ----------------------------------------------------------------------------
def fortress_sheet(out_png, game_png, blend_path):
    import pirates as PI
    W, H = 1600, 900
    # hero 3/4 view (left, 1060 wide)
    cam = PV._new_scene(1060, 900, 160, seed=2.0, key_az=-150)
    cam.data.clip_end = 2000
    _, fort = PV.import_glb(os.path.join(paths.PIRATES, 'hrdzava_pevnost.glb'))
    tur = place_turrets(fort)
    R.aim_camera(cam, (-1.5, 0.5, 1.0), 36, -42, 50.0)
    R.camera_label(cam, 'HRDZAVA PEVNOST  (pirate stronghold, ~36 x 30 u)', y_frac=0.44, size_frac=0.03)
    R.camera_label(cam, f'{PV._tri_count(fort)} tris  +  4 turret mounts (pirate cannons shown 1.6x)',
                   y_frac=-0.45, size_frac=0.022)
    left = R.render_to(os.path.join(TMP, 'fort_hero.png'))
    PV._save_blend(blend_path)
    # top view with collision circles + nodes (right top, 536 x 448)
    cam = PV._new_scene(536, 448, 96, seed=2.0, key_az=-150)
    cam.data.clip_end = 2000
    _, fort = PV.import_glb(os.path.join(paths.PIRATES, 'hrdzava_pevnost.glb'))
    circle_overlay(PI.LAYOUTS['hrdzava_pevnost']['circles'], z=4.5)
    R.aim_camera(cam, (1.5, 0, 0), 89.9, -90, 62.0)
    R.camera_label(cam, 'top view: collision circles', y_frac=-0.44, size_frac=0.045)
    tr = R.render_to(os.path.join(TMP, 'fort_top.png'))
    # pirate beacon (right bottom)
    cam = PV._new_scene(536, 448, 128, seed=4.0, key_az=-140)
    _, bea = PV.import_glb(os.path.join(paths.PIRATES, 'pirate_beacon.glb'))
    _, ship_part = PV.import_glb(os.path.join(paths.PARTS, 'cargo_iron.glb'), loc=(1.3, 0.8, -0.6))
    c, r = R.bounds(bea + ship_part)
    R.aim_camera(cam, c, 22, -60, R.fit_distance(cam, r, margin=0.85))
    R.camera_label(cam, f'PIRATE BEACON  "Vyzva klanu"\n{PV._tri_count(bea)} tris, 1x1 cargo for scale',
                   y_frac=-0.41, size_frac=0.045)
    br = R.render_to(os.path.join(TMP, 'fort_beacon.png'))
    canvas = np.zeros((H, W, 4), np.float32)
    canvas[..., :3] = (0.02, 0.025, 0.035)
    canvas[..., 3] = 1
    canvas[:, :1060] = R.read_png(left)
    canvas[452:, 1064:] = R.read_png(tr)
    canvas[:448, 1064:] = R.read_png(br)
    R.write_png(canvas, out_png)
    # game scale with the starter ship
    cam = PV._new_scene(1600, 900, 160, seed=2.0, key_az=-140)
    cam.data.clip_end = 2000
    _, fort = PV.import_glb(os.path.join(paths.PIRATES, 'hrdzava_pevnost.glb'), loc=(-6.5, 1.0, 0))
    place_turrets(fort)
    lay = [(f, (c_[0] + 15.5, c_[1] - 3.0), r_ + 180) for f, c_, r_ in PV.M1_SHIP]
    PV.build_ship(lay, connectors=True)
    _, pb = PV.import_glb(os.path.join(paths.PIRATES, 'pirate_beacon.glb'), loc=(12.0, 7.5, 0))
    PV.add_rocks([('asteroid_iron_b', (24.0, 9.0, -1.5), 30), ('asteroid_titanium_c', (23.0, -12.0, -1.5), 70)])
    R.aim_camera(cam, (3.5, 0.0, 0), 55, -90, 58.0)
    R.render_to(game_png)


def _three_panel(out_png, left, tr, br):
    W, H = 1600, 900
    canvas = np.zeros((H, W, 4), np.float32)
    canvas[..., :3] = (0.02, 0.025, 0.035)
    canvas[..., 3] = 1
    canvas[:, :1060] = R.read_png(left)
    canvas[452:, 1064:] = R.read_png(tr)
    canvas[:448, 1064:] = R.read_png(br)
    R.write_png(canvas, out_png)


def ozvena_sheet(out_png):
    f = os.path.join(paths.KOVACI, 'ozvena_beacon.glb')
    cam = PV._new_scene(1060, 900, 192, seed=6.0, key_az=-140)
    _, oz = PV.import_glb(f)
    c, r = R.bounds(oz)
    R.aim_camera(cam, (c[0], c[1], c[2] + 0.2), 24, -60, R.fit_distance(cam, r, margin=0.95))
    R.camera_label(cam, 'OZVENA  -  Kovaci signal beacon', y_frac=0.44, size_frac=0.034)
    R.camera_label(cam, f'{PV._tri_count(oz)} tris   rings + crystal float (separate nodes)', y_frac=-0.45,
                   size_frac=0.022)
    left = R.render_to(os.path.join(TMP, 'oz_hero.png'))
    PV._save_blend(os.path.join(paths.BLEND, 'm35-ozvena.blend'))
    # game camera next to the starter ship
    cam = PV._new_scene(536, 448, 128, seed=6.0, key_az=-140)
    PV.import_glb(f, loc=(-4.0, 0.5, 0))
    lay = [(f_, (c_[0] + 4.0, c_[1]), r_) for f_, c_, r_ in PV.M1_SHIP]
    PV.build_ship(lay, connectors=True)
    R.aim_camera(cam, (0.3, 0.6, 2.2), 55, -90, 28.0)
    R.camera_label(cam, 'game camera, starter ship for scale', y_frac=-0.44, size_frac=0.045)
    tr = R.render_to(os.path.join(TMP, 'oz_game.png'))
    # glyph close-up
    cam = PV._new_scene(536, 448, 128, seed=6.0, key_az=-140)
    _, oz = PV.import_glb(f)
    R.aim_camera(cam, (0.0, -1.0, 2.0), 12, -75, 5.2)
    R.camera_label(cam, 'obsidian, bronze inlay, ember glyph rhythm', y_frac=-0.44, size_frac=0.045)
    br = R.render_to(os.path.join(TMP, 'oz_close.png'))
    _three_panel(out_png, left, tr, br)


ANOMALIES = [('anomaly_gravity', 'GRAVITATIONAL'), ('anomaly_ion', 'IONIC'), ('anomaly_radiation', 'RADIATION'),
             ('anomaly_time', 'TIME ECHO')]


def anomalies_sheet(out_png):
    """2x2 hero tiles + a strip at the game camera with the starter ship."""
    tile_w, tile_h = 798, 448
    cam = PV._new_scene(tile_w, tile_h, 160, seed=7.0, key_az=-140)
    tiles = []
    for i, (f, label) in enumerate(ANOMALIES):
        for o in list(bpy.data.objects):
            if o.type in ('MESH', 'EMPTY'):
                bpy.data.objects.remove(o)
        _, objs = PV.import_glb(os.path.join(paths.ANOMALIES, f + '.glb'))
        c, r = R.bounds(objs)
        R.aim_camera(cam, c, 40, -60, R.fit_distance(cam, r, margin=0.78))
        labs = [R.camera_label(cam, f'{label}  ANOMALY', y_frac=0.42, size_frac=0.05),
                R.camera_label(cam, f'{PV._tri_count(objs)} tris', y_frac=-0.43, size_frac=0.035)]
        tiles.append(R.render_to(os.path.join(TMP, f'an_{i}.png')))
        for lb in labs:
            bpy.data.objects.remove(lb)
    top = os.path.join(TMP, 'an_top.png')
    R.stitch(tiles, 2, tile_w, tile_h, top, gap=4)
    # game camera strip: all four in a row + starter ship
    cam = PV._new_scene(1600, 500, 160, seed=7.0, key_az=-140)
    for i, (f, _) in enumerate(ANOMALIES):
        PV.import_glb(os.path.join(paths.ANOMALIES, f + '.glb'), loc=(-22 + i * 11.5, 0, 0))
    lay = [(f_, (c_[0] + 23.0, c_[1]), r_) for f_, c_, r_ in PV.M1_SHIP]
    PV.build_ship(lay, connectors=True)
    R.aim_camera(cam, (1.0, -0.5, 0), 55, -90, 37.0)
    R.camera_label(cam, 'game camera (starter ship for scale)', y_frac=-0.43, x_frac=0.36, size_frac=0.05)
    strip = R.render_to(os.path.join(TMP, 'an_strip.png'))
    a, b = R.read_png(top), R.read_png(strip)
    canvas = np.zeros((a.shape[0] + b.shape[0] + 4, 1600, 4), np.float32)
    canvas[..., :3] = (0.02, 0.025, 0.035)
    canvas[..., 3] = 1
    canvas[:b.shape[0]] = b
    canvas[b.shape[0] + 4:] = a
    R.write_png(canvas, out_png)


def giants_sheet(out_png):
    """Per resource: intact (left) + exploded shell exposing the core (right);
    bottom strip: game camera with the starter ship."""
    kinds = ('iron', 'copper', 'ice', 'titanium')
    tile_w, tile_h = 798, 448
    cam = PV._new_scene(tile_w, tile_h, 160, seed=8.0, key_az=-140)
    tiles = []
    for i, k in enumerate(kinds):
        for o in list(bpy.data.objects):
            if o.type in ('MESH', 'EMPTY'):
                bpy.data.objects.remove(o)
        f = os.path.join(paths.ASTEROIDS, f'asteroid_giant_{k}.glb')
        _, a = PV.import_glb(f, loc=(-6.5, 3.2, 0), rot_z=20)
        _, b = PV.import_glb(f, loc=(6.5, -3.2, 0), rot_z=20)
        bpy.context.view_layer.update()
        for o in b:   # explode: push plates outward along their local position
            if o.name.split('.')[0].startswith('Shell_'):
                o.location = o.location * 1.75
        bpy.context.view_layer.update()
        c, r = R.bounds(a + b)
        R.aim_camera(cam, c, 34, -64, R.fit_distance(cam, r, margin=0.74))
        labs = [R.camera_label(cam, f'GIANT {k.upper()}', y_frac=0.42, size_frac=0.05),
                R.camera_label(cam, f'intact   |   Shell_* pushed out -> Core   ({PV._tri_count(a)} tris)',
                               y_frac=-0.43, size_frac=0.033)]
        tiles.append(R.render_to(os.path.join(TMP, f'gi_{i}.png')))
        for lb in labs:
            bpy.data.objects.remove(lb)
    top = os.path.join(TMP, 'gi_top.png')
    R.stitch(tiles, 2, tile_w, tile_h, top, gap=4)
    cam = PV._new_scene(1600, 500, 160, seed=8.0, key_az=-140)
    for i, k in enumerate(kinds):
        PV.import_glb(os.path.join(paths.ASTEROIDS, f'asteroid_giant_{k}.glb'), loc=(-24 + i * 13.0, 0, -1.5),
                      rot_z=30 * i)
    lay = [(f_, (c_[0] + 27.5, c_[1]), r_) for f_, c_, r_ in PV.M1_SHIP]
    PV.build_ship(lay, connectors=True)
    PV.add_rocks([('asteroid_iron_a', (22.0, 5.0, -1.0), 40)])
    R.aim_camera(cam, (2.0, -0.5, 0), 55, -90, 40.0)
    R.camera_label(cam, 'game camera: giants vs starter ship + normal iron A', y_frac=-0.43, x_frac=0.25,
                   size_frac=0.05)
    strip = R.render_to(os.path.join(TMP, 'gi_strip.png'))
    a, b = R.read_png(top), R.read_png(strip)
    canvas = np.zeros((a.shape[0] + b.shape[0] + 4, 1600, 4), np.float32)
    canvas[..., :3] = (0.02, 0.025, 0.035)
    canvas[..., 3] = 1
    canvas[:b.shape[0]] = b
    canvas[b.shape[0] + 4:] = a
    R.write_png(canvas, out_png)


def raster_svg(path, size, ss=4):
    """Minimal rasterizer for our emblem SVGs (polygons + M/L/Z paths with
    evenodd), RGBA float array (size x size), rows top-down."""
    import re
    txt = open(path, encoding='utf-8').read()
    n = size * ss
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    xx = (xx + 0.5) * 128.0 / n
    yy = (yy + 0.5) * 128.0 / n
    img = np.zeros((n, n, 4), np.float32)

    def inside(poly):
        px = np.array([p[0] for p in poly], np.float32)
        py = np.array([p[1] for p in poly], np.float32)
        res = np.zeros(xx.shape, bool)
        j = len(poly) - 1
        for i in range(len(poly)):
            cond = ((py[i] > yy) != (py[j] > yy)) &                 (xx < (px[j] - px[i]) * (yy - py[i]) / (py[j] - py[i] + 1e-9) + px[i])
            res ^= cond
            j = i
        return res

    def hexrgb(h):
        h = h.lstrip('#')
        return [((int(h[k:k + 2], 16) / 255.0)) for k in (0, 2, 4)]

    for m in re.finditer(r'<(polygon|path)\s+(points|d)="([^"]+)"\s+fill="(#[0-9a-fA-F]{6})"', txt):
        kind, _, data, fill = m.groups()
        if kind == 'polygon':
            polys = [[tuple(map(float, p.split(','))) for p in data.split()]]
        else:
            polys = []
            for sub in data.split('M')[1:]:
                sub = sub.replace('Z', '').replace('L', ' ')
                polys.append([tuple(map(float, p.split(','))) for p in sub.split()])
        mask = np.zeros(xx.shape, bool)
        for pl in polys:
            mask ^= inside(pl)
        img[mask, :3] = hexrgb(fill)
        img[mask, 3] = 1.0
    img = img.reshape(size, ss, size, ss, 4).mean(axis=(1, 3))
    return img


def buoys_sheet(out_png):
    W, H = 1600, 900
    # buoys hero (left top)
    cam = PV._new_scene(796, 448, 160, seed=9.0, key_az=-140)
    _, a = PV.import_glb(os.path.join(paths.PROPS, 'buoy_survey.glb'), loc=(-0.9, 0.6, 0))
    _, b = PV.import_glb(os.path.join(paths.PROPS, 'buoy_marker.glb'), loc=(1.0, -0.6, 0))
    _, c_ = PV.import_glb(os.path.join(paths.PARTS, 'cargo_iron.glb'), loc=(2.4, 1.2, -0.4))
    c, r = R.bounds(a + b + c_)
    R.aim_camera(cam, c, 24, -62, R.fit_distance(cam, r, margin=0.8))
    R.camera_label(cam, 'CONTRACT BUOYS:  survey (Institut)  |  marker (Cech)', y_frac=0.43, size_frac=0.045)
    R.camera_label(cam, f'{PV._tri_count(a)} / {PV._tri_count(b)} tris, 1x1 cargo for scale', y_frac=-0.44,
                   size_frac=0.035)
    hero = R.render_to(os.path.join(TMP, 'bu_hero.png'))
    # game camera: ship deploying a triangle of survey buoys + a marker
    cam = PV._new_scene(796, 448, 128, seed=9.0, key_az=-140)
    PV.build_ship(PV.M1_SHIP, connectors=True)
    for k in range(3):
        ang = math.radians(90 + k * 120)
        PV.import_glb(os.path.join(paths.PROPS, 'buoy_survey.glb'), loc=(0.5 + 8 * math.cos(ang), 8 * math.sin(ang), 0))
    PV.import_glb(os.path.join(paths.PROPS, 'buoy_marker.glb'), loc=(9.5, -4.0, 0))
    R.aim_camera(cam, (0.8, 0, 0), 55, -90, 30.0)
    R.camera_label(cam, 'game camera: 3 survey buoys (Meranie) + marker', y_frac=-0.44, size_frac=0.04)
    game = R.render_to(os.path.join(TMP, 'bu_game.png'))
    canvas = np.zeros((H, W, 4), np.float32)
    canvas[..., 3] = 1
    canvas[..., :3] = (0.02, 0.025, 0.035)
    canvas[452:, :796] = R.read_png(hero)
    canvas[:448, :796] = R.read_png(game)
    # emblems: dark band (top) and light hull plate (bottom), 2x scale
    import emblems as EM
    names = list(EM.EMBLEMS)
    for row, (bg, y0) in enumerate((((0.105, 0.133, 0.176), 452), ((0.85, 0.87, 0.90), 0))):
        canvas[y0:y0 + 448, 800:, :3] = bg
        for i, k in enumerate(names):
            em = raster_svg(os.path.join(paths.UI, 'emblems', f'{k}.svg'), 128)[::-1]   # to bottom-up rows
            col, rr = i % 4, i // 4
            x = 800 + 40 + col * 190
            y = y0 + 448 - 40 - (rr + 1) * 180 + 20
            al = em[..., 3:4]
            reg = canvas[y:y + 128, x:x + 128, :3]
            canvas[y:y + 128, x:x + 128, :3] = em[..., :3] * al + reg * (1 - al)
    R.write_png(canvas, out_png)


def main(only=None, iter_tag=None):
    os.makedirs(paths.PREVIEWS, exist_ok=True)
    P = paths.PREVIEWS
    files = []
    if not only or 'fortress' in only:
        a, b = os.path.join(P, 'm35-fortress.png'), os.path.join(P, 'm35-fortress-gamescale.png')
        fortress_sheet(a, b, os.path.join(paths.BLEND, 'm35-fortress.blend'))
        files += [(a, 'm35-fortress'), (b, 'm35-fortress-gamescale')]
    for key, fn in (('anomalies', 'anomalies_sheet'), ('ozvena', 'ozvena_sheet'), ('giants', 'giants_sheet'),
                    ('buoys', 'buoys_sheet')):
        if (not only or key in only) and fn in globals():
            p = os.path.join(P, f'm35-{key if key != "buoys" else "buoys-emblems"}.png')
            globals()[fn](p)
            files.append((p, os.path.basename(p)[:-4]))
    shutil.rmtree(TMP, ignore_errors=True)
    PV._keep_iterations(iter_tag, files)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else None,
         argv[argv.index('--iter') + 1] if '--iter' in argv else None)
