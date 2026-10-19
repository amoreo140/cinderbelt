"""M5a world previews (called from preview_m5a.py): Wardens + Colossus
(m5a-enemies.png), ring-3 crystal fields + rare-earth rocks (m5a-crystals.png)
and the M5a icon sheet (m5a-icons.png)."""
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
import preview_m2d as P2  # noqa: E402
import preview_m35 as P35  # noqa: E402
from lib import render as R  # noqa: E402

TMP = os.path.join(paths.OUT, 'tmp_tiles_m5a')
P2.HL.update({'crystal': (0.8, 0.55, 1.0), 'rare': (0.4, 1.0, 0.65)})


def _clear():
    for o in list(bpy.data.objects):
        if o.type in ('MESH', 'EMPTY', 'FONT'):
            bpy.data.objects.remove(o)


def _imp(folder, name, loc=(0, 0, 0), rot=0.0):
    _, new = PV.import_glb(os.path.join(paths.MODELS, folder, name + '.glb'), loc=loc, rot_z=rot)
    return new


def _canvas(W=1600, H=900):
    c = np.zeros((H, W, 4), np.float32)
    c[..., :3] = (0.02, 0.025, 0.035)
    c[..., 3] = 1
    return c


# ----------------------------------------------------------------------------
# crystal fields
# ----------------------------------------------------------------------------
def crystals_sheet(out_png):
    cam = PV._new_scene(1060, 900, 160, seed=4.0, key_az=-130)
    objs = []
    for j, v in enumerate('abc'):
        new = _imp('asteroids', f'asteroid_crystal_{v}', loc=(-7.5 + j * 7.0, 6.5, 0), rot=20 * j)
        P2.activate_veins(new, seg=(0.45, 0.6), kind='crystal')
        objs += new
    for j, v in enumerate('ab'):
        new = _imp('asteroids', f'asteroid_rare_{v}', loc=(-5.0 + j * 7.0, -0.8, 0), rot=40 * j)
        P2.activate_veins(new, seg=(0.3, 0.38), kind='rare')
        objs += new
    for j, v in enumerate('abc'):
        objs += _imp('asteroids', f'asteroid_frag_crystal_{v}', loc=(-8.0 + j * 1.4, -6.0, 0), rot=30 * j)
        objs += _imp('asteroids', f'asteroid_frag_rare_{v}', loc=(-2.6 + j * 1.4, -6.0, 0), rot=30 * j)
    # T2 ship for scale + a titanium rock for comparison
    for f, (x, y), rot in PV.M1_SHIP:
        _, new = PV.import_glb(os.path.join(paths.PARTS, f.replace('_iron', '_titanium') + '.glb'),
                               loc=(6.4 + x, -4.6 + y, 0), rot_z=rot)
    objs += _imp('asteroids', 'asteroid_titanium_a', loc=(8.5, -0.6, 0))
    R.aim_camera(cam, (0.4, 0.2, 0.0), 55, -90, 40.0)
    labs = [R.camera_label(cam, 'RING 3: KR CRYSTAL FIELD (singing veins)', y_frac=0.46, size_frac=0.03),
            R.camera_label(cam, 'RARE EARTH (VZ): 3 short fast veins', x_frac=-0.12, y_frac=-0.2, size_frac=0.026),
            R.camera_label(cam, 'fragments', x_frac=-0.3, y_frac=-0.4, size_frac=0.024),
            R.camera_label(cam, 'Ti rock + T2 ship for scale', x_frac=0.33, y_frac=-0.45, size_frac=0.024)]
    left = R.render_to(os.path.join(TMP, 'cr_left.png'))
    # close-ups
    cam2 = PV._new_scene(536, 448, 160, seed=5.0, key_az=-140)
    tiles = []
    for i, (name, kind, seg, txt) in enumerate((('asteroid_crystal_b', 'crystal', (0.45, 0.6),
                                                 'CRYSTAL B  singing vein, active segment'),
                                                ('asteroid_rare_a', 'rare', (0.3, 0.38), 'RARE A  short fast veins'))):
        _clear()
        new = _imp('asteroids', name)
        P2.activate_veins(new, seg=seg, kind=kind)
        c, r = R.bounds(new)
        R.aim_camera(cam2, c, 50, -80, R.fit_distance(cam2, r, margin=0.92))
        lb = R.camera_label(cam2, txt, y_frac=-0.44, size_frac=0.04)
        tiles.append(R.render_to(os.path.join(TMP, f'cr_{i}.png')))
        bpy.data.objects.remove(lb)
    canvas = _canvas()
    canvas[:, :1060] = R.read_png(left)
    canvas[452:, 1064:] = R.read_png(tiles[0])
    canvas[:448, 1064:] = R.read_png(tiles[1])
    R.write_png(canvas, out_png)


# ----------------------------------------------------------------------------
# Wardens + Colossus
# ----------------------------------------------------------------------------
def _ship(loc, tier='titanium'):
    out = []
    for f, (x, y), rot in PV.M1_SHIP:
        _, new = PV.import_glb(os.path.join(paths.PARTS, f.replace('_iron', '_' + tier) + '.glb'),
                               loc=(loc[0] + x, loc[1] + y, 0), rot_z=rot)
        out += new
    return out


def enemies_sheet(out_png, blend_path):
    import kolos as KO
    # left: Colossus hero shot
    cam = PV._new_scene(1060, 900, 160, seed=6.0, key_az=-130)
    _clear()
    objs = _imp('kovaci', 'kolos')
    P2.activate_veins(objs, seg=(0.4, 0.62), kind='crystal')
    c, r = R.bounds([o for o in objs if o.type == 'MESH'])
    R.aim_camera(cam, (c[0], c[1], c[2] * 0.6), 40, -62, R.fit_distance(cam, r, margin=0.78))
    labs = [R.camera_label(cam, 'KOLOS  (Rezonancny kolos, ring-3 boss)', y_frac=0.45, size_frac=0.032),
            R.camera_label(cam, 'weak_0..4 = singing-vein crystal outcrops (active segment shown)', y_frac=-0.45,
                           size_frac=0.024)]
    left = R.render_to(os.path.join(TMP, 'en_left.png'))
    for lb in labs:
        bpy.data.objects.remove(lb)
    PV._save_blend(blend_path)
    # top right: Hliadka + Roj close-up
    cam2 = PV._new_scene(536, 448, 160, seed=5.0, key_az=-140)
    _clear()
    objs = _imp('kovaci', 'straznik_hliadka', loc=(-1.2, 1.0, 0), rot=-25)
    for k, (x, y, z, rz) in enumerate(((2.4, -1.4, 0.3, 30), (3.3, -0.3, 0.7, 10), (1.6, -2.4, -0.1, 50),
                                       (3.1, -2.2, 1.0, 20))):
        objs += _imp('kovaci', 'straznik_roj', loc=(x, y, z), rot=rz)
    c, r = R.bounds([o for o in objs if o.type == 'MESH'])
    R.aim_camera(cam2, c, 38, -75, R.fit_distance(cam2, r, margin=0.62))
    labs = [R.camera_label(cam2, 'STRAZNICI:  HLIADKA (patrol)  +  ROJ drones', y_frac=0.43, size_frac=0.042)]
    tr = R.render_to(os.path.join(TMP, 'en_tr.png'))
    for lb in labs:
        bpy.data.objects.remove(lb)
    # bottom right: game scale with the T2 starter ship + collision circles
    _clear()
    objs = _imp('kovaci', 'kolos', loc=(-3, 0, 0))
    objs += P35.circle_overlay(KO.LAYOUTS['kolos']['circles'], origin=(-3, 0, 0), z=4.0)
    objs += _imp('kovaci', 'straznik_hliadka', loc=(16, 7, 0), rot=200)
    for k in range(10):
        a = k * 0.62
        objs += _imp('kovaci', 'straznik_roj', loc=(14 + 2.2 * math.cos(a) + k * 0.25, -7 + 1.8 * math.sin(a), 0),
                     rot=150 + k * 7)
    objs += _ship((17, -1))
    R.aim_camera(cam2, (3, -1, 0), 55, -90, 66)
    labs = [R.camera_label(cam2, 'game camera: Kolos + collision circles, Hliadka, Roj x10, T2 ship', y_frac=-0.45,
                           size_frac=0.034)]
    br = R.render_to(os.path.join(TMP, 'en_br.png'))
    canvas = _canvas()
    canvas[:, :1060] = R.read_png(left)
    canvas[452:, 1064:] = R.read_png(tr)
    canvas[:448, 1064:] = R.read_png(br)
    R.write_png(canvas, out_png)


# ----------------------------------------------------------------------------
# icons
# ----------------------------------------------------------------------------
def icons_sheet(out_png):
    """Row 1-2: T1/T2/T3 of the eleven core parts (1:1).  Row 3: T3 icons at
    2x.  Row 4: new part icons (T1/T2/T3) + resource icons Kr/VZ/He/Ex (2x)."""
    W, H = 1600, 900
    bg = _canvas(W, H)
    bg[..., :3] = (0.035, 0.045, 0.06)

    def paste(path, cx, cy_top, scale=1):
        a = R.read_png(path)
        if scale != 1:
            a = a.repeat(scale, 0).repeat(scale, 1)
        h, w, _ = a.shape
        x0, y0 = int(cx - w // 2), int(H - cy_top - h)
        al = a[..., 3:4]
        reg = bg[y0:y0 + h, x0:x0 + w, :3]
        bg[y0:y0 + h, x0:x0 + w, :3] = a[..., :3] * al + reg * (1 - al)

    core = ['cockpit', 'engine', 'miningLaser', 'reactor', 'cargo', 'armor', 'gyro', 'fuelTank', 'radar',
            'cannon', 'shield']
    d = os.path.join(paths.ICONS, 'parts')
    for row, tn in enumerate((1, 2, 3)):
        for i, pid in enumerate(core):
            paste(os.path.join(d, f'{pid}_t{tn}.png'), 100 + i * 140, 20 + row * 138)
    new = ['refinery', 'largeReactor', 'repairModule', 'shielding']
    for i, pid in enumerate(new):
        for k, tn in enumerate((1, 2, 3)):
            paste(os.path.join(d, f'{pid}_t{tn}.png'), 90 + (i * 3 + k) * 128 + i * 12, 450)
    # T3 at 2x (cockpit, engine, reactor) to check the facet corners
    for i, pid in enumerate(('cockpit', 'engine', 'reactor')):
        paste(os.path.join(d, f'{pid}_t3.png'), 150 + i * 280, 620, 2)
    res = ['crystal', 'rareEarth', 'helium3', 'exotic', 'iron', 'copper', 'ice', 'titanium']
    for i, rid in enumerate(res[:4]):
        paste(os.path.join(paths.ICONS, 'resources', f'{rid}.png'), 1000 + i * 150, 620, 2)
    for i, rid in enumerate(res[4:]):
        paste(os.path.join(paths.ICONS, 'resources', f'{rid}.png'), 1000 + i * 150, 790, 1)
    R.write_png(bg, out_png)
