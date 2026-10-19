"""M4c "Home and Workshop" art previews (task A1).

  blender --background --factory-startup --python art/blender/preview_m4c.py -- [--only trophy,home,parts,icons] [--iter m4cN]

Outputs (art/out/previews/):
  m4c-trophy.png        fortress trophy close-up | trophy hall with a full shelf (2 fortresses + 4 captain
                        replicas on the trophy_<i> empties) | game camera (pitch 55) on the hall, focus + 48
  m4-home-modules.png   re-shot by preview_m4_pois.home_sheet: painted ship in the bay, gantry at its slide
                        limit, trophies on the pedestals (+ the gantry clearance numbers printed as CLEARANCE)
  m4c-parts-shell.png   refinery 2x1, large reactor 2x2, repair module on a ship with the SL2 hull shell
                        (mock-up geometry, art/blender/mockups) at the game camera, distance 48 and close-up
  m4c-icons.png         the six Rozvoj module icons (public/assets/icons/home/<module>.png) 1:1 and 2x
"""
import math
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, 'mockups')):
    if p not in sys.path:
        sys.path.insert(0, p)

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix  # noqa: E402

import paths  # noqa: E402
import preview as PV  # noqa: E402
from lib import geo as G  # noqa: E402
from lib import render as R  # noqa: E402

TMP = os.path.join(paths.OUT, 'tmp_tiles_m4c')

# a small pirate captain ship (clan parts) standing in for a runtime replica (T5 builds the real ones)
CAPTAIN = [('cockpit', (1, 0), 0), ('cannon', (2, 0), 0), ('cannon', (2, 1), 0), ('cannon', (2, -1), 0),
           ('armor', (1, 1), 0), ('armor', (1, -1), 0), ('reactor', (0, 0), 0), ('shield_generator', (0, 1), 0),
           ('gyroscope', (0, -1), 0), ('engine', (-1, 0), 0), ('engine', (-1, 1), 0), ('engine', (-1, -1), 0)]
CLANS = ('rust', 'cauldron', 'slantedStar')


def _clear():
    for o in list(bpy.data.objects):
        if o.type in ('MESH', 'EMPTY'):
            bpy.data.objects.remove(o)


def _imp(folder, name, loc=(0, 0, 0), rot=0.0):
    _, new = PV.import_glb(os.path.join(paths.MODELS, folder, name + '.glb'), loc=loc, rot_z=rot)
    return new


def _tris(objs):
    return sum(G.tri_count(o) for o in objs if o.type == 'MESH')


def trophy_empties(objs):
    es = [o for o in objs if o.type == 'EMPTY' and o.name.split('.')[0].startswith('trophy_')]
    return sorted(es, key=lambda o: o.name)


def captain_replica(clan, fit):
    """Clan-part captain ship under an empty, scaled so its footprint fits `fit` (max extent)."""
    piv = G.empty('Replica_' + clan)
    objs = []
    for m, (x, y), r in CAPTAIN:
        p = os.path.join(paths.MODELS, 'parts_pirate', clan, f'{m}_iron.glb')
        if not os.path.exists(p):
            p = os.path.join(paths.PARTS, f'{m}_iron.glb')
        roots, new = PV.import_glb(p, loc=(x - 0.5, y, 0.36), rot_z=r)
        for o in roots:
            o.parent = piv
        objs += new
    k = fit / 4.0      # 4 x 3 cells -> the longer side fills the fit box
    piv.scale = (k, k, k)
    return piv, objs


def place(root, mw):
    root.matrix_world = mw @ root.matrix_basis
    bpy.context.view_layer.update()


REPLICA_FIT = 1.4    # proposed for T5: 1.6 (the hard limit, home_modules.TROPHY_FIT) packs the shelf too tight


def dress_shelf(hall_objs, fit=REPLICA_FIT, fortress=(0, 2)):
    """Fortress trophies on the `fortress` pedestals, clan captain replicas on the others."""
    out = []
    for i, e in enumerate(trophy_empties(hall_objs)):
        if i in fortress:
            new = _imp('stations', 'trophy_fortress')
            root = [o for o in new if o.parent is None][0]
            root.location = (0, 0, 0)
            root.rotation_euler = (0, 0, 0)
            place(root, e.matrix_world)
        else:
            root, new = captain_replica(CLANS[i % 3], fit)
            place(root, e.matrix_world)
        out += new
    return out


# ----------------------------------------------------------------------------
def trophy_sheet(out_png):
    import home_modules as HM
    lay = HM.layouts_json()
    tw, th = 640, 560
    tiles = []
    cam = PV._new_scene(tw, th, 128, seed=3.0, key_az=-120)
    # 1: the trophy on its own (3/4 view from the front-left, as the hall camera sees it)
    _clear()
    objs = _imp('stations', 'trophy_fortress')
    c, r = R.bounds([o for o in objs if o.type == 'MESH'])
    d = [o for o in objs if o.type == 'MESH'][0].dimensions
    R.aim_camera(cam, c, 34, -60, R.fit_distance(cam, r, margin=0.95))
    labs = [R.camera_label(cam, 'FORTRESS TROPHY  trophy_fortress.glb', y_frac=0.43, size_frac=0.045),
            R.camera_label(cam, f'{_tris(objs)} tris, {d.x:.2f} x {d.y:.2f} x {d.z:.2f} u, origin = pedestal top',
                           y_frac=-0.44, size_frac=0.034)]
    tiles.append(R.render_to(os.path.join(TMP, 't0.png')))
    for lb in labs:
        bpy.data.objects.remove(lb)
    # 2: the hall with a full shelf (module frame, close-up)
    _clear()
    hall = _imp('stations', 'home_module_trophy_hall')
    shelf = dress_shelf(hall)
    c, r = R.bounds([o for o in hall if o.type == 'MESH'])
    R.aim_camera(cam, c, 40, -55, R.fit_distance(cam, r, margin=0.78))
    labs = [R.camera_label(cam, 'TROFEJNA SIEN  full shelf', y_frac=0.43, size_frac=0.045),
            R.camera_label(cam, f'2 fortress trophies + 4 clan replicas (fit {REPLICA_FIT} u), '
                                f'shelf {_tris(shelf)} tris', y_frac=-0.44, size_frac=0.032)]
    tiles.append(R.render_to(os.path.join(TMP, 't1.png')))
    for lb in labs:
        bpy.data.objects.remove(lb)
    # 3 + 4: game camera on the home station (hall on slot rl), dock focus and the flight zoom 48
    _clear()
    s = lay['slots']['rl']
    objs = _imp('stations', 'station_home')
    hall = _imp('stations', 'home_module_trophy_hall', loc=(s['x'], s['y'], s['z']), rot=s['yawDeg'])
    dress_shelf(hall)
    centre = (s['x'] + 2.8 * math.cos(math.radians(s['yawDeg'])), s['y'] + 2.8 * math.sin(math.radians(s['yawDeg'])),
              0)
    for dist, tag in ((16, 'hall focus, distance 16'), (48, 'flight camera 48')):
        cam.data.lens = PV.GAME_LENS if hasattr(PV, 'GAME_LENS') else 12.0 / math.tan(math.radians(25))
        R.aim_camera(cam, centre, 55, -90, dist)
        labs = [R.camera_label(cam, f'game camera (pitch 55, vFOV 50): {tag}', y_frac=0.43, size_frac=0.04)]
        tiles.append(R.render_to(os.path.join(TMP, f't{2 + (dist > 20)}.png')))
        for lb in labs:
            bpy.data.objects.remove(lb)
    cam.data.lens = 50
    R.stitch(tiles, 2, tw, th, out_png, gap=4)


# ----------------------------------------------------------------------------
def parts_shell_sheet(out_png):
    """The three M4c parts on a mid-size player ship with the SL2 hull shell (mock-up), game camera."""
    import ship2_mockup as SM
    from ship2_geo import P_
    layouts = {
        1: [P_('cockpit', 3, 0), P_('mining_laser', 4, 0), P_('refinery', 1.5, 0), P_('large_reactor', -0.5, 0.5),
            P_('repair_module', 1, 1), P_('cargo', 2, 1), P_('cargo', 2, -1), P_('armor', 3, 1), P_('armor', 3, -1),
            P_('battery', 1, -1), P_('gyroscope', -1, -1), P_('radar', 0, -1),
            P_('engine', -2, 0), P_('engine', -2, 1), P_('engine', -2, -1)],
    }
    files = []
    for tier, tname in ((1, 'iron'), (2, 'titanium')):
        cam = SM.new_scene(960, 540, 128, seed=3.0)
        sh = SM.make(f'm4c_{tname}', layouts[1], tier=tname)
        files.append(SM.render_native(sh, os.path.join(TMP, f'p_native_{tname}.png'), 48,
                                      f'T{tier} camera 48 (3x): reactor 2x2 aft-port, refinery 2x1 mid, repair 1x1 port'))
        files.append(SM.render_close([sh], os.path.join(TMP, f'p_close_{tname}.png'),
                                     f'T{tier} close-up (pitch 35)', el=40, az=-62, w=960, h=540))
    # the native crops are tiny (1:1 pixels of a 1080p frame): show them 3x, nearest neighbour
    for i in (0, 2):
        a = R.read_png(files[i])
        R.write_png(np.kron(a, np.ones((3, 3, 1), np.float32)), files[i])
    SM.compose([[files[0], files[2]], [files[1], files[3]]], out_png)
    return out_png


# ----------------------------------------------------------------------------
def icons_sheet(out_png):
    import home_modules as HM
    imgs = [R.read_png(os.path.join(paths.ICONS, 'home', f'{m}.png')) for m in HM.MODULES]
    n = len(imgs)
    W = n * 128 + (n + 1) * 12
    H = 128 + 256 + 3 * 12
    canvas = np.zeros((H, W, 4), np.float32)
    canvas[..., :3] = (0.035, 0.04, 0.055)
    canvas[..., 3] = 1
    for i, a in enumerate(imgs):
        x = 12 + i * 140
        al = a[..., 3:4]
        canvas[12:140, x:x + 128, :3] = a[..., :3] * al + canvas[12:140, x:x + 128, :3] * (1 - al)
    big = [np.kron(a, np.ones((2, 2, 1), np.float32)) for a in imgs[:3]]   # rows are bottom-up: 2x row on top
    for i, a in enumerate(big):
        x = 12 + i * 268
        al = a[..., 3:4]
        canvas[152:408, x:x + 256, :3] = a[..., :3] * al + canvas[152:408, x:x + 256, :3] * (1 - al)
    R.write_png(canvas, out_png)


def main(only=None, iter_tag=None):
    os.makedirs(paths.PREVIEWS, exist_ok=True)
    P = paths.PREVIEWS
    files = []
    if not only or 'trophy' in only:
        p = os.path.join(P, 'm4c-trophy.png')
        trophy_sheet(p)
        files.append((p, 'm4c-trophy'))
    if not only or 'home' in only:
        import preview_m4_pois as PP
        p = os.path.join(P, 'm4-home-modules.png')
        PP.home_sheet(p, os.path.join(paths.BLEND, 'm4-home.blend'))
        files.append((p, 'm4-home-modules'))
    if not only or 'parts' in only:
        p = os.path.join(P, 'm4c-parts-shell.png')
        parts_shell_sheet(p)
        files.append((p, 'm4c-parts-shell'))
    if not only or 'icons' in only:
        p = os.path.join(P, 'm4c-icons.png')
        icons_sheet(p)
        files.append((p, 'm4c-icons'))
    shutil.rmtree(TMP, ignore_errors=True)
    PV._keep_iterations(iter_tag, files)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else None,
         argv[argv.index('--iter') + 1] if '--iter' in argv else None)
